/*
 * CatchCrypt town (overworld) shown between PokeRogue battles. AGPL-3.0.
 * Map, tileset and player sprite: aaron5670/PokeMMO-Online-Realtime-Multiplayer-Game (WTFPL), see CREDITS.md.
 * Movement is a small grid-free walker with tile collision, modeled on that repo's Player.js.
 */
import { AREAS, type AreaId, type BuiltMap, buildOverworld, type Dir, tiledFromCache } from "#app/catch/town-maps";
import { globalScene } from "#app/global-scene";
import { PartyUiMode } from "#enums/party-ui-mode";
import { UiMode } from "#enums/ui-mode";
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
  private grassAt: (tx: number, ty: number) => boolean = () => false;
  private lastTileKey = "";
  private grassReadyAt = 0;
  private dir = "front";
  private lockedMsgAt = 0;
  private lockedText?: Phaser.GameObjects.Text;

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
    this.leaving = false;
    this.switching = false;
    this.area = data?.area ?? lastArea;
    lastArea = this.area;
    const built = buildOverworld(this.area, tiledFromCache(this.cache.tilemap.get("cc_town")));
    this.paint(built);
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
    kb.on("keydown-B", () => this.leave("button"));
    kb.on("keydown-ESC", () => {
      if (!this.partyOpen) {
        this.leave("button");
      }
    });
    this.add
      .text(
        width / 2 - (width / 2 - 20) / cam.zoom,
        height / 2 + (height / 2 - 20) / cam.zoom,
        "Arrows or WASD to walk.  P for your Pokémon.  Battle, B or Esc for the next wave.",
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
    const ts = map.addTilesetImage("cc_tiles", "cc_tiles", 32, 32, 1, 2, 0)!;
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
    if (this.leaving || this.switching || this.partyOpen) {
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
        this.grassStep(p.x, p.y + 14);
      }
      p.anims.play(`cc-${this.dir}`, true);
    } else {
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
    if (this.leaving || this.switching || this.partyOpen || !battleRef) {
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
    if (resumeCb && (!sc || sc.sys.settings.status <= Phaser.Scenes.INIT)) {
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
