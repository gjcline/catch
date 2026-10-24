/*
 * CatchCrypt town (overworld) shown between PokeRogue battles. AGPL-3.0.
 * Map, tileset and player sprite: aaron5670/PokeMMO-Online-Realtime-Multiplayer-Game (WTFPL), see CREDITS.md.
 * Movement is a small grid-free walker with tile collision, modeled on that repo's Player.js.
 */
import { loggedInUser } from "#app/account";
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
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { MAX_PER_TYPE_POKEBALLS } from "#data/pokeball";
import { ChallengeType } from "#enums/challenge-type";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokeballType } from "#enums/pokeball";
import { UiMode } from "#enums/ui-mode";
import { AddPokeballModifier } from "#modifiers/modifier";
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
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private leaving = false;
  private switching = false;
  private partyOpen = false;
  private menu: TownMenu | null = null;
  private menuRoot: Phaser.GameObjects.Container | undefined;
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
    this.player = this.add.sprite(start.x, start.y, "cc_player", `misa-${this.dir}`).setDepth(5);
    for (const d of ["left", "right", "front", "back"]) {
      if (!this.anims.exists(`cc-${d}`)) {
        this.anims.create({
          key: `cc-${d}`,
          frames: this.anims.generateFrameNames("cc_player", {
            prefix: `misa-${d}-walk.`,
            start: 0,
            end: 3,
            zeroPad: 3,
          }),
          frameRate: 10,
          repeat: -1,
        });
      }
    }
    const cam = this.cameras.main;
    this.lastTileKey = "";
    this.grassReadyAt = this.time.now + 1500;
    cam.setZoom(2).setBounds(0, 0, this.mapW, this.mapH).startFollow(this.player, true);
    cam.fadeIn(250, 0, 0, 0);
    const kb = this.input.keyboard!;
    const k = kb.addKeys("UP,DOWN,LEFT,RIGHT,W,A,S,D") as any;
    this.keys = { up: k.UP, down: k.DOWN, left: k.LEFT, right: k.RIGHT, w: k.W, a: k.A, s: k.S, d: k.D };
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
    kb.on("keydown-P", () => this.openParty());
    kb.on("keydown-B", () => this.onTownKey("b"));
    kb.on("keydown-ESC", () => this.onTownKey("esc"));
    kb.on("keydown-SPACE", () => this.onTownKey("space"));
    kb.on("keydown-Z", () => this.onTownKey("z"));
    kb.on("keydown-ENTER", () => this.onTownKey("enter"));
    kb.on("keydown-UP", () => this.nudgeMenu(-1));
    kb.on("keydown-DOWN", () => this.nudgeMenu(1));
    kb.on("keydown-W", () => this.nudgeMenu(-1));
    kb.on("keydown-S", () => this.nudgeMenu(1));
    this.add
      .text(
        width / 2 - (width / 2 - 20) / cam.zoom,
        height / 2 + (height / 2 - 20) / cam.zoom,
        "Arrows or WASD to walk.  Space or Z at a door.  P for your Pokémon.  Battle, B or Esc for the next wave.",
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
    this.showBanner();
    (window as any).__ccArea = this.area;
    this.attachPresence();
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
    if (this.worldPaused()) {
      return;
    }
    const k = this.keys;
    const sp = (150 * dtMs) / 1000;
    let dx = 0;
    let dy = 0;
    if (k.left.isDown || k.a.isDown) {
      dx = -sp;
      this.dir = "left";
    } else if (k.right.isDown || k.d.isDown) {
      dx = sp;
      this.dir = "right";
    } else if (k.up.isDown || k.w.isDown) {
      dy = -sp;
      this.dir = "back";
    } else if (k.down.isDown || k.s.isDown) {
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
      if (!this.menu) {
        p.anims.play(`cc-${this.dir}`, true);
      }
    } else if (!this.menu) {
      p.anims.stop();
      p.setFrame(`misa-${this.dir}`);
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
    if (this.leaving || this.switching || this.partyOpen || this.menu || !battleRef) {
      return;
    }
    this.partyOpen = true;
    (window as any).__ccPartyOpen = true;
    this.input.keyboard?.resetKeys();
    this.player.anims.stop();
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
    if (this.leaving || this.switching || this.partyOpen) {
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
    this.events.once("shutdown", () => {
      const retain = this.retainPresence;
      this.retainPresence = false;
      this.clearRemotes();
      if (!retain) {
        this.releasePresence();
      }
    });
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
        sprite: "misa",
        area: this.area,
      });
    } catch (err) {
      console.error("CatchCrypt: presence skipped", err);
    }
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
    let sprite = this.remotes.get(peer.id);
    if (sprite?.active) {
      this.remoteLabels.get(peer.id)?.setText(peer.name);
    } else {
      sprite = this.add.sprite(peer.x, peer.y, "cc_player", `misa-${peer.facing}`).setDepth(5);
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
    const moved = Math.hypot(sprite.x - x, sprite.y - y) > 0.5;
    sprite.setPosition(x, y);
    if (moved) {
      sprite.anims.play(`cc-${facing}`, true);
      const prev = sprite.getData("ccStop") as Phaser.Time.TimerEvent | undefined;
      prev?.remove(false);
      sprite.setData(
        "ccStop",
        this.time.delayedCall(140, () => {
          if (!sprite.active) {
            return;
          }
          sprite.anims.stop();
          sprite.setFrame(`misa-${facing}`);
        }),
      );
    } else {
      sprite.anims.stop();
      sprite.setFrame(`misa-${facing}`);
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
    if (this.leaving || this.switching || this.partyOpen) {
      return;
    }
    this.wallet = { ...this.wallet, money: this.currentMoney() };
    this.menu = openTownMenu(spot, this.wallet.money);
    this.doorLatch = spot.id;
    this.player.anims.stop();
    this.player.setFrame(`misa-${this.dir}`);
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
    if (!menu) {
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
        if (this.menu || this.partyOpen || this.leaving || this.switching) {
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
