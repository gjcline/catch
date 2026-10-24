/*
 * CatchCrypt town (overworld) shown between PokeRogue battles. AGPL-3.0.
 * Map, tileset and player sprite: aaron5670/PokeMMO-Online-Realtime-Multiplayer-Game (WTFPL), see CREDITS.md.
 * Movement is a small grid-free walker with tile collision, modeled on that repo's Player.js.
 */
import { loggedInUser } from "#app/account";
import {
  allTownSprites,
  type CharacterPickerState,
  characterPickerKey,
  DEFAULT_TOWN_SPRITE,
  idleFrame,
  loadTownSprite,
  misaVariants,
  moveCharacterPicker,
  moveMisaVariant,
  openCharacterPicker,
  playerAtlasKey,
  previewCaption,
  resolveTownSprite,
  saveTownSprite,
  selectedTownCharacter,
  townCharacters,
  townFacings,
  walkAnimKey,
  walkFramePrefix,
} from "#app/catch/town-characters";
import {
  AREAS,
  type AreaId,
  type BuiltMap,
  buildOverworld,
  type Dir,
  type TownSpot,
  tiledFromCache,
} from "#app/catch/town-maps";
import { type Facing, type PresenceMove, type PresencePeer, TownPresence } from "#app/catch/town-presence";
import {
  confirmTownMenu,
  doorUnderFeet,
  healTownParty,
  type MartItemId,
  martTitle,
  moveTownMenu,
  openTownMenu,
  potionTarget,
  readMoney,
  resolveBuy,
  spotAt,
  spotForAction,
  type TownMenu,
  type TownWallet,
  tileAhead,
  townKeyAction,
  townShouldMove,
} from "#app/catch/town-shops";
import { type Cardinal, setBattleTouchSuppressed, stepPixels, TownTouchUi, walkAxis } from "#app/catch/town-touch";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { MAX_PER_TYPE_POKEBALLS } from "#data/pokeball";
import { ChallengeType } from "#enums/challenge-type";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokeballType } from "#enums/pokeball";
import { UiMode } from "#enums/ui-mode";
import { AddPokeballModifier } from "#modifiers/modifier";
import { hasTouchscreen } from "#utils/app-utils";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";

const KEY = "catchcrypt_town";
/** Tall grass tile (0-based) in the tuxmon tileset. */
const TALL = 121;
let resumeCb: (() => void) | null = null;
let lastPos: { x: number; y: number } | null = null;
let lastArea: AreaId = "town";
let battleRef: Phaser.Scene | null = null;
const releaseBattleKeys = () => (battleRef as any)?.inputController?.deactivatePressedKey?.();

const OPP: Record<Dir, Dir> = { north: "south", south: "north", east: "west", west: "east" };

/** Highest level in the current party. On localhost only, `localStorage.cc_debug_level` overrides it for testing. */
function partyMaxLevel(): number {
  if (location.hostname === "localhost") {
    const d = Number(localStorage.getItem("cc_debug_level"));
    if (d > 0) {
      return d;
    }
  }
  try {
    return Math.max(0, ...globalScene.getPlayerParty().map(p => p.level ?? 0));
  } catch {
    return 0;
  }
}

export class TownScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private solidAt: (tx: number, ty: number) => boolean = () => false;
  private mapW = 0;
  private mapH = 0;
  private area: AreaId = "town";
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", { isDown: boolean }>;
  private touchUi = false;
  private townTouch?: TownTouchUi;
  private touchDir: Cardinal | null = null;
  private padHeld: Cardinal | null = null;
  private padRepeatAt = 0;
  private wasHidden = false;
  private lifeBound = false;
  private leaving = false;
  private switching = false;
  private partyOpen = false;
  private menu: TownMenu | null = null;
  private menuRoot: Phaser.GameObjects.Container | undefined;
  private picker: CharacterPickerState | null = null;
  private pickerRoot: Phaser.GameObjects.Container | undefined;
  private previewTimer: Phaser.Time.TimerEvent | undefined;
  private spriteId = DEFAULT_TOWN_SPRITE;
  private spots: TownSpot[] = [];
  private wallet: TownWallet = { money: null, freeTaken: {} };
  /** Door or person already opened, so holding into them does not reopen the menu. */
  private doorLatch: string | null = null;
  private grassAt: (tx: number, ty: number) => boolean = () => false;
  private lastTileKey = "";
  private grassReadyAt = 0;
  private dir: Facing = "front";
  private lockedMsgAt = 0;
  private lockedText?: Phaser.GameObjects.Text;
  private readonly remotes = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly remoteLabels = new Map<string, Phaser.GameObjects.Text>();
  private presence: TownPresence | null = null;
  /** Keep the socket across an area restart. Leave and shutdown still disconnect. */
  private retainPresence = false;

  constructor() {
    super({ key: KEY });
  }

  preload() {
    this.load.setPath("town/");
    this.load.tilemapTiledJSON("cc_town", "town.json");
    this.load.image("cc_tiles", "tuxmon-sample-32px-extruded.png");
    this.load.atlas("cc_player", "atlas.png", "atlas.json");
    for (const character of allTownSprites()) {
      if (character.file === "atlas.png") {
        continue;
      }
      this.load.atlas(playerAtlasKey(character.id), character.file, "atlas.json");
    }
    this.load.setPath("images/arenas/");
    for (const b of ["grass", "beach", "cave"]) {
      this.load.image(`cc_bg_${b}`, `${b}_bg.png`);
    }
  }

  create(data?: { area?: AreaId; from?: Dir }) {
    try {
      this.boot(data);
    } catch (err) {
      // A throw here used to leave the battle paused and hidden: solid black, no buttons.
      console.error("CatchCrypt: town failed to start", err);
      this.leaving = true;
      this.releasePresence();
      this.time.delayedCall(0, () => {
        const cb = resumeCb;
        resumeCb = null;
        this.scene.stop();
        cb?.();
      });
    }
  }

  private boot(data?: { area?: AreaId; from?: Dir }) {
    this.bindPresenceLifecycle();
    this.leaving = false;
    this.switching = false;
    this.menu = null;
    this.menuRoot = undefined;
    this.picker = null;
    this.pickerRoot = undefined;
    this.clearPreviewTimer();
    this.spriteId = loadTownSprite(this.accountName());
    this.doorLatch = null;
    this.wallet = { money: this.currentMoney(), freeTaken: {} };
    (window as any).__ccTownMenu = null;
    this.clearRemotes();
    this.area = data?.area ?? lastArea;
    lastArea = this.area;
    const built = buildOverworld(this.area, tiledFromCache(this.cache.tilemap.get("cc_town")));
    this.paint(built);
    this.spots = built.spots;
    this.drawSpots();
    const entrance = (data?.from && built.spawns[data.from]) || built.defaultSpawn;
    const start = data?.from ? entrance : (lastPos ?? entrance);
    this.ensureCharacterAnims();
    this.player = this.add.sprite(start.x, start.y, playerAtlasKey(this.spriteId), idleFrame(this.dir)).setDepth(5);
    (window as any).__ccSprite = this.spriteId;
    const cam = this.cameras.main;
    this.lastTileKey = "";
    this.grassReadyAt = this.time.now + 1500;
    cam.setZoom(2).setBounds(0, 0, this.mapW, this.mapH).startFollow(this.player, true);
    cam.fadeIn(250, 0, 0, 0);
    this.touchUi = hasTouchscreen();
    if (this.touchUi) {
      cam.roundPixels = true;
    }
    this.bindKeys();
    if (this.touchUi) {
      this.mountTouch();
    } else {
      this.mountPointerHud(cam);
    }
    this.showBanner();
    (window as any).__ccArea = this.area;
    this.attachPresence();
  }

  /** Keyboard still works on a phone with a keyboard attached. A missing plugin must not blank the town. */
  private bindKeys() {
    const idle = { isDown: false };
    this.keys = { up: idle, down: idle, left: idle, right: idle, w: idle, a: idle, s: idle, d: idle };
    const kb = this.input.keyboard;
    if (!kb) {
      return;
    }
    const k = kb.addKeys("UP,DOWN,LEFT,RIGHT,W,A,S,D") as Record<string, { isDown: boolean }>;
    this.keys = { up: k.UP, down: k.DOWN, left: k.LEFT, right: k.RIGHT, w: k.W, a: k.A, s: k.S, d: k.D };
    kb.on("keydown-P", () => this.openParty());
    kb.on("keydown-C", () => this.openPicker());
    kb.on("keydown-B", () => this.onTownKey("b"));
    kb.on("keydown-ESC", () => this.onTownKey("esc"));
    kb.on("keydown-SPACE", () => this.onTownKey("space"));
    kb.on("keydown-Z", () => this.onTownKey("z"));
    kb.on("keydown-ENTER", () => this.onTownKey("enter"));
    kb.on("keydown-UP", () => this.nudgeMenu(-1));
    kb.on("keydown-DOWN", () => this.nudgeMenu(1));
    kb.on("keydown-W", () => this.nudgeMenu(-1));
    kb.on("keydown-S", () => this.nudgeMenu(1));
    kb.on("keydown-LEFT", () => this.onPickerStep(-1));
    kb.on("keydown-RIGHT", () => this.onPickerStep(1));
    kb.on("keydown-A", () => this.onPickerStep(-1));
    kb.on("keydown-D", () => this.onPickerStep(1));
  }

  /** Mouse HUD. Touch devices use the DOM pad instead, sized in CSS pixels. */
  private mountPointerHud(cam: Phaser.Cameras.Scene2D.Camera) {
    const { width, height } = this.scale;
    const btn = this.add
      .text(width - 40, height - 40, "BATTLE", {
        fontFamily: "emerald, monospace",
        fontSize: "48px",
        color: "#ffffff",
        backgroundColor: "#e3342f",
        padding: { x: 24, y: 12 },
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true });
    btn
      .setScale(1 / cam.zoom)
      .setPosition(width / 2 + (width / 2 - 20) / cam.zoom, height / 2 + (height / 2 - 20) / cam.zoom);
    btn.setName("battle-button");
    btn.on("pointerdown", () => this.leave("button"));
    const pbtn = this.add
      .text(0, 0, "\u25D3 Pokémon", {
        fontFamily: "emerald, monospace",
        fontSize: "48px",
        color: "#ffffff",
        backgroundColor: "#2b6cb0",
        padding: { x: 24, y: 12 },
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true })
      .setName("party-button");
    pbtn.setScale(1 / cam.zoom).setPosition(btn.x - btn.displayWidth - 6 / cam.zoom, btn.y);
    pbtn.on("pointerdown", () => this.openParty());
    const cbtn = this.add
      .text(0, 0, "Character", {
        fontFamily: "emerald, monospace",
        fontSize: "48px",
        color: "#ffffff",
        backgroundColor: "#2f6b4a",
        padding: { x: 24, y: 12 },
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true })
      .setName("character-button");
    cbtn.setScale(1 / cam.zoom).setPosition(pbtn.x - pbtn.displayWidth - 6 / cam.zoom, btn.y);
    cbtn.on("pointerdown", () => this.openPicker());
    this.add
      .text(
        width / 2 - (width / 2 - 20) / cam.zoom,
        height / 2 + (height / 2 - 20) / cam.zoom,
        "Arrows or WASD to walk.  Space or Z at a door.  P for your Pokémon.  C for your character.  Battle, B or Esc for the next wave.",
        {
          fontFamily: "emerald, monospace",
          fontSize: "36px",
          color: "#ffffff",
          backgroundColor: "#1b2440cc",
          padding: { x: 16, y: 8 },
        },
      )
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(100)
      .setScale(1 / cam.zoom)
      .setName("town-hint");
  }

  /** D-pad, A, and B. Battle touch controls stay hidden until the party screen needs them. */
  private mountTouch() {
    this.townTouch?.destroy();
    document.getElementById("touchControls")?.classList.add("visible");
    setBattleTouchSuppressed(true);
    this.townTouch = new TownTouchUi(document, {
      onMove: dir => this.onTouchMove(dir),
      onAction: () => this.onTownKey("space"),
      onBack: () => this.onTownKey("b"),
      onBattle: () => this.leave("button"),
      onParty: () => this.openParty(),
      onCharacter: () => this.openPicker(),
      onMenuPick: index => this.onTouchPick(index),
      onCharacterPick: index => this.onTouchCharacter(index),
      onVariantPick: index => this.onTouchVariant(index),
    });
    this.townTouch.setPortrait(window.matchMedia?.("(orientation: portrait)")?.matches === true);
  }

  private onTouchMove(dir: Cardinal | null) {
    if (this.leaving || this.switching || this.partyOpen) {
      this.touchDir = null;
      this.padHeld = null;
      return;
    }
    if (this.menu || this.picker) {
      this.touchDir = null;
      if (dir === this.padHeld) {
        return;
      }
      this.padHeld = dir;
      this.padRepeatAt = this.time.now + 360;
      if (dir) {
        this.applyPad(dir);
      }
      return;
    }
    this.padHeld = null;
    this.touchDir = dir;
  }

  private onTouchPick(index: number) {
    if (!this.menu || this.partyOpen || this.leaving) {
      return;
    }
    this.menu.index = index;
    this.confirmOpenMenu();
  }

  private onTouchCharacter(index: number) {
    if (!this.picker || this.partyOpen || this.leaving) {
      return;
    }
    if (this.picker.index === index) {
      this.confirmPicker();
      return;
    }
    this.picker.index = index;
    this.picker.variant = 0;
    this.renderPicker();
  }

  private onTouchVariant(index: number) {
    if (!this.picker || this.leaving) {
      return;
    }
    this.picker.variant = index;
    this.renderPicker();
  }

  private repeatPad() {
    if (!this.padHeld || (!this.menu && !this.picker)) {
      return;
    }
    if (this.time.now < this.padRepeatAt) {
      return;
    }
    this.padRepeatAt = this.time.now + 180;
    this.applyPad(this.padHeld);
  }

  private applyPad(dir: Cardinal) {
    if (this.picker) {
      if (dir === "left") {
        this.onPickerStep(-1);
      } else if (dir === "right") {
        this.onPickerStep(1);
      } else if (dir === "up") {
        this.onVariantStep(-1);
      } else if (dir === "down") {
        this.onVariantStep(1);
      }
      return;
    }
    if (this.menu) {
      if (dir === "up") {
        this.nudgeMenu(-1);
      } else if (dir === "down") {
        this.nudgeMenu(1);
      }
    }
  }

  private syncTouchOverlay() {
    this.townTouch?.setOverlay({ menu: this.menu, picker: this.picker });
  }

  /** Area name card, using PokeRogue's own biome art for the generated areas. */
  private showBanner() {
    const def = AREAS[this.area];
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const cx = width / 2;
    const top = height / 2 - (height / 2 - 16) / cam.zoom;
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (def.bg) {
      parts.push(
        this.add
          .image(cx, top, `cc_bg_${def.bg}`)
          .setOrigin(0.5, 0)
          .setScrollFactor(0)
          .setDepth(110)
          .setDisplaySize(160, 60),
      );
    }
    parts.push(
      this.add
        .text(cx, top + (def.bg ? 30 : 0), def.name, {
          fontFamily: "emerald, monospace",
          fontSize: "48px",
          color: "#ffffff",
          backgroundColor: "#1b2440cc",
          padding: { x: 18, y: 6 },
        })
        .setOrigin(0.5, def.bg ? 0.5 : 0)
        .setScrollFactor(0)
        .setDepth(111)
        .setScale(1 / cam.zoom),
    );
    this.tweens.add({
      targets: parts,
      alpha: 0,
      delay: 1800,
      duration: 600,
      onComplete: () => parts.forEach(p => p.destroy()),
    });
  }

  /** Blit a built map. Same tileset margin and spacing the generated areas already used. */
  private paint(built: BuiltMap) {
    const map = this.make.tilemap({ tileWidth: 32, tileHeight: 32, width: built.w, height: built.h });
    const ts = map.addTilesetImage("cc_tiles", "cc_tiles", 32, 32, 1, 2, 0);
    if (!ts) {
      throw new Error("CatchCrypt tileset failed to load");
    }
    const ground = map.createBlankLayer("g", ts)!;
    const grass = map.createBlankLayer("grass", ts)!;
    const world = map.createBlankLayer("w", ts)!;
    const above = map.createBlankLayer("a", ts)!.setDepth(10);
    for (let y = 0; y < built.h; y++) {
      for (let x = 0; x < built.w; x++) {
        const tile = built.ground[y][x];
        if (tile >= 0) {
          ground.putTileAt(tile, x, y);
        }
        if (built.grass[y][x]) {
          grass.putTileAt(TALL, x, y);
        }
        const prop = built.world[y][x];
        if (prop >= 0) {
          world.putTileAt(prop, x, y);
        }
        const canopy = built.above[y][x];
        if (canopy >= 0) {
          above.putTileAt(canopy, x, y);
        }
      }
    }
    if (built.tint !== undefined) {
      ground.setTint(built.tint);
      grass.setTint(built.tint);
      world.setTint(built.tint);
      above.setTint(built.tint);
    }
    this.mapW = built.w * 32;
    this.mapH = built.h * 32;
    const solid = built.solid;
    const tall = built.grass;
    this.solidAt = (tx, ty) => solid[ty]?.[tx] ?? true;
    this.grassAt = (tx, ty) => tall[ty]?.[tx] === true;
    this.drawOverlay(built);
  }

  /** Exit signs, landmark names, and the gold gate bars. */
  private drawOverlay(built: BuiltMap) {
    for (const label of built.labels) {
      this.add
        .text(label.x * 32 + 16, label.y * 32 - 2, label.label, {
          fontFamily: "emerald, monospace",
          fontSize: "28px",
          color: "#ffffff",
          backgroundColor: "#1b2440dd",
          padding: { x: 8, y: 3 },
        })
        .setOrigin(0.5, 1)
        .setScale(0.5)
        .setDepth(20);
    }
    for (const gate of built.gates) {
      const g = this.add.graphics().setDepth(4);
      g.fillStyle(0xc89b3c, 0.9);
      g.fillRect(gate.x, gate.y, gate.w, gate.h);
      g.fillStyle(0x6b4a1a, 1);
      const horizontal = gate.w > gate.h;
      const span = horizontal ? gate.w : gate.h;
      for (let i = 0; i <= span; i += 16) {
        if (horizontal) {
          g.fillRect(gate.x + i, gate.y - 3, 3, gate.h + 6);
        } else {
          g.fillRect(gate.x - 3, gate.y + i, gate.w + 6, 3);
        }
      }
    }
  }

  private blocked(x: number, y: number): boolean {
    return this.solidAt(Math.floor(x / 32), Math.floor(y / 32));
  }

  update(_t: number, dtMs: number) {
    this.repeatPad();
    if (this.worldPaused()) {
      return;
    }
    const k = this.keys;
    const axis = walkAxis(
      k.left.isDown || k.a.isDown || this.touchDir === "left",
      k.right.isDown || k.d.isDown || this.touchDir === "right",
      k.up.isDown || k.w.isDown || this.touchDir === "up",
      k.down.isDown || k.s.isDown || this.touchDir === "down",
    );
    const sp = stepPixels(dtMs);
    let dx = 0;
    let dy = 0;
    if (axis === "left") {
      dx = -sp;
      this.dir = "left";
    } else if (axis === "right") {
      dx = sp;
      this.dir = "right";
    } else if (axis === "up") {
      dy = -sp;
      this.dir = "back";
    } else if (axis === "down") {
      dy = sp;
      this.dir = "front";
    }
    const p = this.player;
    if (dx || dy) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      const foot = ny + 14;
      const edge: Dir | null =
        nx < 16 ? "west" : nx > this.mapW - 16 ? "east" : ny < 16 ? "north" : ny > this.mapH - 16 ? "south" : null;
      if (edge) {
        this.tryExit(edge);
      } else if (!this.blocked(nx - 10, foot) && !this.blocked(nx + 10, foot)) {
        p.setPosition(nx, ny);
        this.emitPresence();
        this.tryAutoDoor();
        if (!this.menu) {
          this.grassStep(p.x, p.y + 14);
        }
      } else if (!edge) {
        this.tryBumpNpc();
      }
      if (!this.menu && !this.picker) {
        p.anims.play(walkAnimKey(this.spriteId, this.dir), true);
      }
    } else if (!this.menu && !this.picker) {
      p.anims.stop();
      p.setFrame(idleFrame(this.dir));
    }
  }

  /** Classic tall grass: each new grass tile stepped on has about a 1 in 10 chance to start the next wave. */
  private grassStep(x: number, y: number) {
    const tx = Math.floor(x / 32);
    const ty = Math.floor(y / 32);
    const key = `${tx},${ty}`;
    if (key === this.lastTileKey) {
      return;
    }
    this.lastTileKey = key;
    if (!this.grassAt(tx, ty) || this.time.now < this.grassReadyAt) {
      return;
    }
    const w = window as any;
    w.__ccGrassSteps = (w.__ccGrassSteps ?? 0) + 1;
    const chance = typeof w.__ccGrassChance === "number" ? w.__ccGrassChance : 0.1;
    if (Math.random() < chance) {
      w.__ccGrassBattle = (w.__ccGrassBattle ?? 0) + 1;
      this.leave("button");
    }
  }

  private tryExit(edge: Dir) {
    const exit = AREAS[this.area].exits[edge];
    if (!exit) {
      this.showLocked("You haven't unlocked this area yet.");
      return;
    }
    if (partyMaxLevel() < exit.level) {
      this.showLocked(`You need a Level ${exit.level} Pokémon to enter this area.`);
      (window as any).__ccLevelBlocked = ((window as any).__ccLevelBlocked ?? 0) + 1;
      return;
    }
    this.switching = true;
    this.retainPresence = true;
    this.clearRemotes();
    lastPos = null;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.time.delayedCall(220, () => this.scene.restart({ area: exit.to, from: OPP[edge] }));
  }

  /** Throttled: at most once every 2.5 s. */
  private showLocked(text: string) {
    const now = this.time.now;
    if (now - this.lockedMsgAt < 2500) {
      return;
    }
    this.lockedMsgAt = now;
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    this.lockedText?.destroy();
    this.lockedText = this.add
      .text(width / 2, height / 2 + (height / 2 - 70) / cam.zoom, text, {
        fontFamily: "emerald, monospace",
        fontSize: "44px",
        color: "#ffffff",
        backgroundColor: "#1b2440cc",
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(100)
      .setScale(1 / cam.zoom);
    (window as any).__ccLockedShown = ((window as any).__ccLockedShown ?? 0) + 1;
    (window as any).__ccLockedText = text;
    this.time.delayedCall(1800, () => this.lockedText?.destroy());
  }

  /** Show PokeRogue's own party screen (check mode: summary, moves, reorder) over a paused town. */
  openParty() {
    if (this.leaving || this.switching || this.partyOpen || this.menu || this.picker || !battleRef) {
      return;
    }
    this.partyOpen = true;
    (window as any).__ccPartyOpen = true;
    this.input.keyboard?.resetKeys();
    this.touchDir = null;
    this.padHeld = null;
    this.player.anims.stop();
    this.townTouch?.setHidden(true);
    setBattleTouchSuppressed(false);
    const battle = battleRef;
    this.scene.pause();
    this.scene.setVisible(false);
    battle.scene.resume();
    battle.scene.setVisible(true);
    releaseBattleKeys();
    globalScene.ui.setMode(UiMode.PARTY, PartyUiMode.CHECK, -1, () => {
      // Called once, when the player backs out of the party screen.
      globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        globalScene.ui.clearText?.();
        releaseBattleKeys();
        battle.scene.pause();
        battle.scene.setVisible(false);
        this.scene.resume();
        this.scene.setVisible(true);
        this.input.keyboard?.resetKeys();
        this.touchDir = null;
        this.padHeld = null;
        if (this.touchUi) {
          setBattleTouchSuppressed(true);
          this.townTouch?.setHidden(false);
        }
        // ignore the key that closed the party for a moment so it cannot also start the battle
        this.time.delayedCall(500, () => {
          this.partyOpen = false;
          (window as any).__ccPartyOpen = false;
        });
      });
    });
  }

  /** Leave town and hand control back to PokeRogue's encounter. Only Battle, B or Esc do this. */
  leave(_why: "button") {
    if (this.leaving || this.switching || this.partyOpen || this.picker) {
      return;
    }
    this.leaving = true;
    this.releasePresence();
    lastPos = { x: this.player.x, y: this.player.y };
    lastArea = this.area;
    (window as any).__ccTownLeft = _why;
    this.cameras.main.flash(300, 255, 255, 255);
    this.time.delayedCall(320, () => {
      const cb = resumeCb;
      resumeCb = null;
      this.scene.stop();
      cb?.();
    });
  }

  /** Disconnect only when the scene is really going away. Area restarts set retainPresence. */
  private bindPresenceLifecycle() {
    this.bindLife();
    this.events.once("shutdown", () => {
      const retain = this.retainPresence;
      this.retainPresence = false;
      this.clearRemotes();
      this.destroyTouchUi();
      if (!retain) {
        this.releasePresence();
        this.unbindLife();
      }
    });
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") {
      this.wasHidden = true;
      this.touchDir = null;
      this.padHeld = null;
      this.townTouch?.release();
      return;
    }
    this.afterForeground();
  };

  private readonly onPageShow = () => {
    if (document.visibilityState === "visible") {
      this.afterForeground();
    }
  };

  private readonly onOnline = () => {
    if (document.visibilityState !== "visible" || this.leaving || !this.player) {
      return;
    }
    this.reconnectPresence();
  };

  private readonly onViewport = () => {
    this.townTouch?.setPortrait(window.matchMedia?.("(orientation: portrait)")?.matches === true);
  };

  /** Phones drop the socket while the tab is frozen. A fresh hello puts this player back. */
  private afterForeground() {
    if (!this.wasHidden || this.leaving || !this.player) {
      return;
    }
    this.wasHidden = false;
    this.reconnectPresence();
  }

  private reconnectPresence() {
    try {
      this.presence?.reconnect({
        name: this.presenceName(),
        x: this.player.x,
        y: this.player.y,
        facing: this.dir,
        sprite: this.spriteId,
        area: this.area,
      });
    } catch (err) {
      console.error("CatchCrypt: presence reconnect failed", err);
    }
  }

  private bindLife() {
    if (this.lifeBound) {
      return;
    }
    this.lifeBound = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pageshow", this.onPageShow);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("resize", this.onViewport);
    window.addEventListener("orientationchange", this.onViewport);
  }

  private unbindLife() {
    if (!this.lifeBound) {
      return;
    }
    this.lifeBound = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pageshow", this.onPageShow);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("resize", this.onViewport);
    window.removeEventListener("orientationchange", this.onViewport);
  }

  private destroyTouchUi() {
    this.townTouch?.destroy();
    this.townTouch = undefined;
    this.touchDir = null;
    this.padHeld = null;
    setBattleTouchSuppressed(false);
  }

  private attachPresence() {
    try {
      if (!this.presence || this.presence.isClosed()) {
        this.presence = new TownPresence({
          spawn: peer => this.spawnRemote(peer),
          move: step => this.moveRemote(step),
          leave: id => this.removeRemote(id),
        });
      }
      this.presence.hello({
        name: this.presenceName(),
        x: this.player.x,
        y: this.player.y,
        facing: this.dir,
        sprite: this.spriteId,
        area: this.area,
      });
    } catch (err) {
      console.error("CatchCrypt: presence skipped", err);
    }
  }

  private accountName(): string | null {
    const username = loggedInUser?.username?.trim();
    return username && username.length > 0 ? username : null;
  }

  private presenceName(): string {
    try {
      const custom = localStorage.getItem("cc_presence_name");
      if (custom && custom.trim().length > 0) {
        return custom.trim();
      }
    } catch {
      // Storage can throw in private modes. The account name still works.
    }
    const username = loggedInUser?.username?.trim();
    return username && username.length > 0 ? username : "Guest";
  }

  /** Four-direction walk cycles for every character sheet. Textures are loaded in preload. */
  private ensureCharacterAnims() {
    for (const character of allTownSprites()) {
      const atlas = playerAtlasKey(character.id);
      for (const facing of townFacings()) {
        const key = walkAnimKey(character.id, facing);
        if (this.anims.exists(key)) {
          continue;
        }
        this.anims.create({
          key,
          frames: this.anims.generateFrameNames(atlas, {
            prefix: walkFramePrefix(facing),
            start: 0,
            end: 3,
            zeroPad: 3,
          }),
          frameRate: 10,
          repeat: -1,
        });
      }
    }
  }

  /** Throttled inside TownPresence. Skipped while a menu, the party screen, or an area fade pauses update(). */
  private emitPresence() {
    if (this.worldPaused()) {
      return;
    }
    this.presence?.move({
      x: this.player.x,
      y: this.player.y,
      facing: this.dir,
      area: this.area,
    });
  }

  private spawnRemote(peer: PresencePeer) {
    if (this.leaving || this.switching || peer.area !== this.area) {
      return;
    }
    const spriteId = resolveTownSprite(peer.sprite);
    let sprite = this.remotes.get(peer.id);
    if (sprite?.active) {
      this.remoteLabels.get(peer.id)?.setText(peer.name);
    } else {
      sprite = this.add.sprite(peer.x, peer.y, playerAtlasKey(spriteId), idleFrame(peer.facing)).setDepth(5);
      this.remotes.set(peer.id, sprite);
      const label = this.add
        .text(peer.x, peer.y - 22, peer.name, {
          fontFamily: "emerald, monospace",
          fontSize: "14px",
          color: "#ffffff",
          backgroundColor: "#1b2440cc",
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(6);
      this.remoteLabels.set(peer.id, label);
    }
    sprite.setData("ccSprite", spriteId);
    this.placeRemote(peer.id, peer.x, peer.y, peer.facing);
    (window as any).__ccPresencePeers = this.remotes.size;
  }

  private moveRemote(step: PresenceMove) {
    if (this.leaving || this.switching || step.area !== this.area || !this.remotes.get(step.id)?.active) {
      return;
    }
    this.placeRemote(step.id, step.x, step.y, step.facing);
  }

  private placeRemote(id: string, x: number, y: number, facing: Facing) {
    const sprite = this.remotes.get(id);
    if (!sprite?.active) {
      return;
    }
    const spriteId = resolveTownSprite(sprite.getData("ccSprite"));
    const atlas = playerAtlasKey(spriteId);
    if (sprite.texture.key !== atlas) {
      sprite.setTexture(atlas, idleFrame(facing));
    }
    const moved = Math.hypot(sprite.x - x, sprite.y - y) > 0.5;
    sprite.setPosition(x, y);
    if (moved) {
      sprite.anims.play(walkAnimKey(spriteId, facing), true);
      const prev = sprite.getData("ccStop") as Phaser.Time.TimerEvent | undefined;
      prev?.remove(false);
      sprite.setData(
        "ccStop",
        this.time.delayedCall(140, () => {
          if (!sprite.active) {
            return;
          }
          sprite.anims.stop();
          sprite.setFrame(idleFrame(facing));
        }),
      );
    } else {
      sprite.anims.stop();
      sprite.setFrame(idleFrame(facing));
    }
    this.remoteLabels.get(id)?.setPosition(x, y - 22);
  }

  private removeRemote(id: string) {
    const sprite = this.remotes.get(id);
    if (sprite?.active) {
      const timer = sprite.getData("ccStop") as Phaser.Time.TimerEvent | undefined;
      timer?.remove(false);
      sprite.destroy();
    }
    const label = this.remoteLabels.get(id);
    if (label?.active) {
      label.destroy();
    }
    this.remotes.delete(id);
    this.remoteLabels.delete(id);
    (window as any).__ccPresencePeers = this.remotes.size;
  }

  private clearRemotes() {
    for (const id of [...this.remotes.keys()]) {
      this.removeRemote(id);
    }
  }

  /** Walking, grass, and presence all wait while a menu is open. */
  private worldPaused(): boolean {
    return !townShouldMove({
      leaving: this.leaving,
      switching: this.switching,
      partyOpen: this.partyOpen,
      menuOpen: this.menu !== null,
      pickerOpen: this.picker !== null,
    });
  }

  private currentMoney(): number | null {
    try {
      return readMoney(globalScene.money);
    } catch (err) {
      console.error("CatchCrypt: money unreadable", err);
      return null;
    }
  }

  private onTownKey(key: string) {
    if (this.leaving || this.switching || this.partyOpen) {
      return;
    }
    if (this.picker) {
      const pickerAction = characterPickerKey(key);
      if (pickerAction === "close") {
        this.closePicker();
      } else if (pickerAction === "confirm") {
        this.confirmPicker();
      } else if (pickerAction === "prev") {
        this.onPickerStep(-1);
      } else if (pickerAction === "next") {
        this.onPickerStep(1);
      } else if (pickerAction === "variant-prev") {
        this.onVariantStep(-1);
      } else if (pickerAction === "variant-next") {
        this.onVariantStep(1);
      }
      return;
    }
    const action = townKeyAction(key, this.menu !== null);
    if (action === "close") {
      this.closeMenu();
      return;
    }
    if (action === "leave") {
      this.leave("button");
      return;
    }
    if (action === "confirm") {
      this.confirmOpenMenu();
      return;
    }
    if (action === "open") {
      this.interact();
    }
  }

  private nudgeMenu(dir: -1 | 1) {
    if (this.picker) {
      this.onVariantStep(dir);
      return;
    }
    if (!this.menu || this.leaving || this.switching || this.partyOpen) {
      return;
    }
    moveTownMenu(this.menu, dir);
    this.renderMenu();
  }

  /** Step onto a center, mart, or house mat. */
  private tryAutoDoor() {
    const door = doorUnderFeet(this.spots, this.player.x, this.player.y);
    if (!door) {
      this.doorLatch = null;
      return;
    }
    if (this.doorLatch === door.id) {
      return;
    }
    this.openSpot(door);
  }

  /** Walk into a person. Their tile is solid, so the step itself never lands. */
  private tryBumpNpc() {
    const ahead = tileAhead(this.player.x, this.player.y, this.dir);
    const npc = spotAt(this.spots, ahead.x, ahead.y, ["npc"]);
    if (!npc || this.doorLatch === npc.id) {
      return;
    }
    this.openSpot(npc);
  }

  private interact() {
    if (this.menu) {
      this.confirmOpenMenu();
      return;
    }
    const spot = spotForAction(this.spots, this.player.x, this.player.y, this.dir);
    if (spot) {
      this.openSpot(spot);
    }
  }

  private openSpot(spot: TownSpot) {
    if (this.leaving || this.switching || this.partyOpen || this.picker) {
      return;
    }
    this.wallet = { ...this.wallet, money: this.currentMoney() };
    this.menu = openTownMenu(spot, this.wallet.money);
    this.doorLatch = spot.id;
    this.player.anims.stop();
    this.player.setFrame(idleFrame(this.dir));
    this.input.keyboard?.resetKeys();
    (window as any).__ccTownMenu = spot.kind;
    (window as any).__ccTownMenuName = spot.name;
    this.renderMenu();
  }

  private closeMenu() {
    this.menu = null;
    this.menuRoot?.destroy(true);
    this.menuRoot = undefined;
    (window as any).__ccTownMenu = null;
    this.input.keyboard?.resetKeys();
    this.syncTouchOverlay();
  }

  private onPickerStep(dir: -1 | 1) {
    if (!this.picker || this.leaving || this.switching || this.partyOpen) {
      return;
    }
    moveCharacterPicker(this.picker, dir);
    this.renderPicker();
  }

  private onVariantStep(dir: -1 | 1) {
    if (!this.picker || this.leaving || this.switching || this.partyOpen) {
      return;
    }
    moveMisaVariant(this.picker, dir);
    this.renderPicker();
  }

  /** Character sheet. Movement stays blocked until this closes. */
  private openPicker() {
    if (this.leaving || this.switching || this.partyOpen || this.menu || this.picker) {
      return;
    }
    this.picker = openCharacterPicker(this.spriteId);
    this.player.anims.stop();
    this.player.setFrame(idleFrame(this.dir));
    this.input.keyboard?.resetKeys();
    (window as any).__ccPicker = true;
    this.renderPicker();
  }

  private closePicker() {
    this.clearPreviewTimer();
    this.picker = null;
    this.pickerRoot?.destroy(true);
    this.pickerRoot = undefined;
    (window as any).__ccPicker = false;
    this.input.keyboard?.resetKeys();
    this.syncTouchOverlay();
  }

  private confirmPicker() {
    if (!this.picker || this.leaving || this.switching) {
      return;
    }
    const next = selectedTownCharacter(this.picker).id;
    const changed = next !== this.spriteId;
    this.spriteId = saveTownSprite(this.accountName(), next);
    this.player.setTexture(playerAtlasKey(this.spriteId), idleFrame(this.dir));
    this.player.anims.stop();
    this.player.setFrame(idleFrame(this.dir));
    (window as any).__ccSprite = this.spriteId;
    this.closePicker();
    if (changed) {
      this.announceSprite();
    }
  }

  /** Re-hello so other players redraw this sprite. Solo play ignores a missing socket. */
  private announceSprite() {
    try {
      this.presence?.hello({
        name: this.presenceName(),
        x: this.player.x,
        y: this.player.y,
        facing: this.dir,
        sprite: this.spriteId,
        area: this.area,
      });
    } catch (err) {
      console.error("CatchCrypt: character was saved, presence skipped", err);
    }
  }

  private clearPreviewTimer() {
    this.previewTimer?.remove(false);
    this.previewTimer = undefined;
  }

  private confirmOpenMenu() {
    if (!this.menu) {
      return;
    }
    const result = confirmTownMenu(this.menu);
    if (result.type === "close") {
      this.closeMenu();
      return;
    }
    if (result.type === "heal") {
      this.menu.message = this.healParty();
      this.renderMenu();
      return;
    }
    if (result.type === "buy") {
      this.menu.message = this.buyItem(result.itemId);
      this.renderMenu();
      return;
    }
    this.renderMenu();
  }

  private healParty(): string {
    try {
      const party = globalScene.getPlayerParty();
      if (!party || party.length === 0) {
        return "You don't have any Pokémon with you.";
      }
      const prevent = new BooleanHolder(false);
      applyChallenges(ChallengeType.PREVENT_REVIVE, prevent);
      const healed = healTownParty(party, mon => !(prevent.value && mon.isFainted()));
      if (healed === 0) {
        return "There is nobody here the nurse can heal.";
      }
      return "Your Pokémon are fully healed.";
    } catch (err) {
      console.error("CatchCrypt: heal failed", err);
      return "The nurse cannot reach your party right now.";
    }
  }

  private buyItem(itemId: MartItemId): string {
    if (itemId === "potion" && this.partyNeedsPotion() === false) {
      return "Your party doesn't need a Potion right now.";
    }
    if (itemId === "pokeball" && this.pokeballBagFull()) {
      return "You cannot carry any more Poké Balls.";
    }
    const before = this.wallet.money;
    const result = resolveBuy(
      this.wallet,
      itemId,
      () => (itemId === "pokeball" ? this.grantPokeball() : this.grantPotion()),
      "The mart is out of those right now.",
    );
    this.wallet = result.wallet;
    if (result.wallet.money !== before) {
      this.writeMoney();
    }
    if (this.menu?.spot.kind === "mart") {
      this.menu.title = martTitle(this.wallet.money);
    }
    return result.message;
  }

  private partyNeedsPotion(): boolean | null {
    try {
      return potionTarget(globalScene.getPlayerParty()) !== null;
    } catch (err) {
      console.error("CatchCrypt: party check failed", err);
      return null;
    }
  }

  private pokeballBagFull(): boolean {
    try {
      const counts = globalScene.pokeballCounts;
      if (!counts) {
        return false;
      }
      return (counts[PokeballType.POKEBALL] ?? 0) >= MAX_PER_TYPE_POKEBALLS;
    } catch {
      return false;
    }
  }

  private grantPokeball(): boolean {
    try {
      const make = modifierTypes.POKEBALL;
      if (typeof make !== "function") {
        return false;
      }
      const modifier = new AddPokeballModifier(make(), PokeballType.POKEBALL, 1);
      return globalScene.addModifier(modifier, true, false, false, true);
    } catch (err) {
      console.error("CatchCrypt: pokeball failed", err);
      return false;
    }
  }

  private grantPotion(): boolean {
    try {
      const party = globalScene.getPlayerParty();
      const target = potionTarget(party);
      if (!target) {
        return false;
      }
      const make = modifierTypes.POTION;
      if (typeof make !== "function") {
        return false;
      }
      const modifier = make().newModifier(target);
      if (!modifier) {
        return false;
      }
      return globalScene.addModifier(modifier, true, false, false, true);
    } catch (err) {
      console.error("CatchCrypt: potion failed", err);
      return false;
    }
  }

  private writeMoney() {
    if (this.wallet.money === null) {
      return;
    }
    try {
      globalScene.money = this.wallet.money;
      globalScene.updateMoneyText(false);
      globalScene.animateMoneyChanged(false);
    } catch (err) {
      console.error("CatchCrypt: money update failed", err);
    }
  }

  private renderMenu() {
    this.menuRoot?.destroy(true);
    this.menuRoot = undefined;
    const menu = this.menu;
    this.syncTouchOverlay();
    if (!menu || this.touchUi) {
      return;
    }
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const scale = 1 / cam.zoom;
    const panelW = 640;
    const panelH = 168 + menu.options.length * 48;
    const screenLeft = (width - panelW * scale) / 2;
    const screenTop = (height - panelH * scale) / 2;
    const originX = width / 2 + (screenLeft - width / 2) / cam.zoom;
    const originY = height / 2 + (screenTop - height / 2) / cam.zoom;
    const root = this.add.container(originX, originY).setScrollFactor(0).setDepth(200).setScale(scale);
    root.setName("town-menu");
    const accent = menuAccent(menu.spot.kind);
    const bg = this.add.graphics();
    bg.fillStyle(0x1b2440, 0.94);
    bg.fillRoundedRect(0, 0, panelW, panelH, 12);
    bg.lineStyle(4, accent.border, 1);
    bg.strokeRoundedRect(0, 0, panelW, panelH, 12);
    root.add(bg);
    const titleColor = accent.title;
    root.add(
      this.add.text(28, 18, menu.title, {
        fontFamily: "emerald, monospace",
        fontSize: "40px",
        color: titleColor,
      }),
    );
    root.add(
      this.add.text(28, 68, menu.message, {
        fontFamily: "emerald, monospace",
        fontSize: "28px",
        color: "#ffffff",
        wordWrap: { width: panelW - 56 },
      }),
    );
    for (let index = 0; index < menu.options.length; index++) {
      const option = menu.options[index];
      const rowY = 124 + index * 48;
      const selected = index === menu.index;
      const hit = this.add
        .rectangle(panelW / 2, rowY + 18, panelW - 36, 42, selected ? 0x31406e : 0x000000, selected ? 1 : 0.15)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => {
        if (!this.menu || this.partyOpen) {
          return;
        }
        this.menu.index = index;
        this.confirmOpenMenu();
      });
      root.add(hit);
      root.add(
        this.add.text(40, rowY, `${selected ? "> " : "  "}${option.label}`, {
          fontFamily: "emerald, monospace",
          fontSize: "32px",
          color: selected ? "#ffe08a" : "#ffffff",
        }),
      );
    }
    root.add(
      this.add.text(28, panelH - 36, "Arrows choose.  Space confirms.  B or Esc closes.", {
        fontFamily: "emerald, monospace",
        fontSize: "22px",
        color: "#c5cbe0",
      }),
    );
    this.menuRoot = root;
  }

  private renderPicker() {
    this.clearPreviewTimer();
    this.pickerRoot?.destroy(true);
    this.pickerRoot = undefined;
    const picker = this.picker;
    this.syncTouchOverlay();
    if (!picker || this.touchUi) {
      return;
    }
    const selected = selectedTownCharacter(picker);
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const scale = 1 / cam.zoom;
    const panelW = 560;
    const columns = 2;
    const rowH = 46;
    const showColors = townCharacters[picker.index]?.id === "misa";
    const gridTop = showColors ? 286 : 228;
    const rows = Math.ceil(townCharacters.length / columns);
    const chooseY = gridTop + rows * rowH + 6;
    const panelH = chooseY + 100;
    const screenLeft = (width - panelW * scale) / 2;
    const screenTop = (height - panelH * scale) / 2;
    const originX = width / 2 + (screenLeft - width / 2) / cam.zoom;
    const originY = height / 2 + (screenTop - height / 2) / cam.zoom;
    const root = this.add.container(originX, originY).setScrollFactor(0).setDepth(200).setScale(scale);
    root.setName("character-picker");
    const bg = this.add.graphics();
    bg.fillStyle(0x1b2440, 0.94);
    bg.fillRoundedRect(0, 0, panelW, panelH, 12);
    bg.lineStyle(4, 0x7dcea0, 1);
    bg.strokeRoundedRect(0, 0, panelW, panelH, 12);
    root.add(bg);
    root.add(
      this.add.text(28, 16, "Character", {
        fontFamily: "emerald, monospace",
        fontSize: "40px",
        color: "#b7ebc6",
      }),
    );
    const preview = this.add.sprite(panelW / 2, 128, playerAtlasKey(selected.id), idleFrame("front")).setScale(4);
    preview.anims.play(walkAnimKey(selected.id, "front"), true);
    root.add(preview);
    const facings = townFacings();
    let tick = 0;
    this.previewTimer = this.time.addEvent({
      delay: 640,
      loop: true,
      callback: () => {
        if (!preview.active) {
          return;
        }
        tick = (tick + 1) % facings.length;
        const facing = facings[tick] ?? "front";
        preview.anims.play(walkAnimKey(selected.id, facing), true);
      },
    });
    root.add(
      this.add
        .text(panelW / 2, 188, previewCaption(picker), {
          fontFamily: "emerald, monospace",
          fontSize: "32px",
          color: "#ffe08a",
        })
        .setOrigin(0.5, 0),
    );
    if (showColors) {
      const chipW = (panelW - 56) / misaVariants.length;
      for (let index = 0; index < misaVariants.length; index++) {
        const variant = misaVariants[index];
        if (!variant) {
          continue;
        }
        const x = 28 + index * chipW;
        const chosen = index === picker.variant;
        const chip = this.add
          .rectangle(x + chipW / 2, 230, chipW - 6, 32, chosen ? 0x2f6b4a : 0x000000, chosen ? 1 : 0.2)
          .setInteractive({ useHandCursor: true });
        chip.on("pointerdown", () => {
          if (!this.picker || this.leaving) {
            return;
          }
          this.picker.variant = index;
          this.renderPicker();
        });
        root.add(chip);
        root.add(
          this.add
            .text(x + chipW / 2, 218, variant.name, {
              fontFamily: "emerald, monospace",
              fontSize: "20px",
              color: chosen ? "#ffe08a" : "#ffffff",
            })
            .setOrigin(0.5, 0),
        );
      }
    }
    const cellW = (panelW - 64) / columns;
    for (let index = 0; index < townCharacters.length; index++) {
      const character = townCharacters[index];
      if (!character) {
        continue;
      }
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = 28 + col * (cellW + 8);
      const y = gridTop + row * rowH;
      const highlighted = index === picker.index;
      const hit = this.add
        .rectangle(x + cellW / 2, y + 18, cellW, 42, highlighted ? 0x31406e : 0x000000, highlighted ? 1 : 0.15)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => {
        if (!this.picker || this.partyOpen || this.leaving) {
          return;
        }
        if (this.picker.index === index) {
          this.confirmPicker();
          return;
        }
        this.picker.index = index;
        this.picker.variant = 0;
        this.renderPicker();
      });
      root.add(hit);
      root.add(
        this.add.text(x + 12, y + 2, `${highlighted ? "> " : "  "}${character.name}`, {
          fontFamily: "emerald, monospace",
          fontSize: "30px",
          color: highlighted ? "#ffe08a" : "#ffffff",
        }),
      );
    }
    const choose = this.add
      .rectangle(panelW / 2, chooseY + 22, panelW - 56, 44, 0x2f6b4a, 1)
      .setInteractive({ useHandCursor: true });
    choose.on("pointerdown", () => this.confirmPicker());
    root.add(choose);
    root.add(
      this.add
        .text(panelW / 2, chooseY + 6, "Choose", {
          fontFamily: "emerald, monospace",
          fontSize: "32px",
          color: "#ffffff",
        })
        .setOrigin(0.5, 0),
    );
    root.add(
      this.add.text(
        28,
        panelH - 58,
        "Left and right choose a person. Up and down recolor Misa. Space confirms. B or Esc closes.",
        {
          fontFamily: "emerald, monospace",
          fontSize: "20px",
          color: "#c5cbe0",
          wordWrap: { width: panelW - 56 },
        },
      ),
    );
    this.pickerRoot = root;
  }

  private drawSpots() {
    const matColor: Partial<Record<TownSpot["kind"], number>> = {
      center: 0xe85d75,
      mart: 0x3d8bfd,
      house: 0xe0b15a,
    };
    for (let index = 0; index < this.spots.length; index++) {
      const spot = this.spots[index];
      const zone = this.add
        .zone(spot.x + spot.w / 2, spot.y + spot.h / 2, spot.w, spot.h)
        .setInteractive({ useHandCursor: true })
        .setDepth(6);
      zone.setName(`town-spot-${spot.id}`);
      zone.on("pointerdown", () => {
        if (this.menu || this.picker || this.partyOpen || this.leaving || this.switching) {
          return;
        }
        this.openSpot(spot);
      });
      if (spot.kind === "npc") {
        const sprite = this.add
          .sprite(spot.x + spot.w / 2, spot.y + spot.h / 2, "cc_player", "misa-front")
          .setDepth(4)
          .setTint(index % 2 === 0 ? 0xb9d6ff : 0xc8f0c2);
        this.add
          .text(sprite.x, sprite.y - 24, spot.name, {
            fontFamily: "emerald, monospace",
            fontSize: "28px",
            color: "#ffffff",
            backgroundColor: "#1b2440dd",
            padding: { x: 6, y: 2 },
          })
          .setOrigin(0.5, 1)
          .setScale(0.5)
          .setDepth(6);
        continue;
      }
      const color = matColor[spot.kind];
      if (color !== undefined) {
        const mat = this.add.graphics().setDepth(3);
        mat.fillStyle(color, 0.9);
        mat.fillRect(spot.x + 4, spot.y + spot.h - 8, spot.w - 8, 6);
      }
      if (spot.kind !== "center") {
        this.add
          .text(spot.x + spot.w / 2, spot.y, spot.name, {
            fontFamily: "emerald, monospace",
            fontSize: "28px",
            color: "#ffffff",
            backgroundColor: "#1b2440dd",
            padding: { x: 8, y: 3 },
          })
          .setOrigin(0.5, 1)
          .setScale(0.5)
          .setDepth(20);
      }
    }
  }

  private releasePresence() {
    this.clearRemotes();
    this.presence?.disconnect();
    this.presence = null;
  }
}

function menuAccent(kind: TownSpot["kind"]): { border: number; title: string } {
  if (kind === "mart") {
    return { border: 0x6ec1ff, title: "#9fd0ff" };
  }
  if (kind === "center") {
    return { border: 0xff8fa3, title: "#ffb3c2" };
  }
  return { border: 0xf6d36b, title: "#ffe08a" };
}

export function townEnabled(): boolean {
  return (import.meta as any).env?.VITE_CATCH_TOWN !== "0";
}

/** Pause the battle scene, show the town, and call `resume` when the player presses Battle, B or Esc. */
export function enterTown(battle: Phaser.Scene, resume: () => void): void {
  battleRef = battle;
  const releaseKeys = () => (battle as any).inputController?.deactivatePressedKey?.();
  resumeCb = () => {
    releaseKeys(); // keys held when the town opened never got a keyup in the paused scene
    battle.scene.resume();
    battle.scene.setVisible(true);
    (window as any).__ccInTown = false;
    resume();
  };
  battleRef = battle;
  const mgr = battle.game.scene;
  releaseKeys();
  battle.scene.pause();
  battle.scene.setVisible(false);
  (window as any).__ccScenes = () =>
    mgr.getScenes(false).map(sc => `${sc.scene.key}:${sc.scene.isActive()}:${sc.scene.isVisible()}`);
  (window as any).__ccInTown = true;
  // Phaser defers scene.add() while its scene manager is processing (a Continue from a save opens the town
  // from inside the game loop). A direct start() then finds no scene and the screen stays black.
  // autoStart covers both cases: immediate add, or start once the pending add is processed.
  const existing = mgr.getScene(KEY);
  if (existing) {
    if (existing.sys.isActive() || existing.sys.isVisible()) {
      mgr.stop(KEY); // never stack a second town start on a half started one
    }
    mgr.start(KEY);
  } else {
    mgr.add(KEY, TownScene, true);
  }
  mgr.bringToTop(KEY);
  // Safety net: if the town never started, skip it and go straight to the battle.
  setTimeout(() => {
    const sc = mgr.getScene(KEY);
    // CREATING means create() threw and Phaser never reached RUNNING, which the old INIT check missed.
    const status = sc?.sys.settings.status;
    const stuck = !sc || status <= Phaser.Scenes.INIT || status === Phaser.Scenes.CREATING;
    if (resumeCb && stuck) {
      console.warn("CatchCrypt: town did not start, continuing to the battle");
      const cb = resumeCb;
      resumeCb = null;
      if (sc) {
        mgr.stop(KEY);
      }
      cb();
    }
  }, 4000);
}
