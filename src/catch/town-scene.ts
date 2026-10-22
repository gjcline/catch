/*
 * CatchCrypt town (overworld) shown between PokeRogue battles. AGPL-3.0.
 * Map, tileset and player sprite: aaron5670/PokeMMO-Online-Realtime-Multiplayer-Game (WTFPL), see CREDITS.md.
 * Movement is a small grid-free walker with tile collision, modeled on that repo's Player.js.
 */
import { globalScene } from "#app/global-scene";
import { PartyUiMode } from "#enums/party-ui-mode";
import { UiMode } from "#enums/ui-mode";
import Phaser from "phaser";

const KEY = "catchcrypt_town";
const TILE_COLLIDES = "collides";
let resumeCb: (() => void) | null = null;
let lastPos: { x: number; y: number } | null = null;
let lastArea: AreaId = "town";
let battleRef: Phaser.Scene | null = null;
const releaseBattleKeys = () => (battleRef as any)?.inputController?.deactivatePressedKey?.();

type Dir = "north" | "south" | "east" | "west";
type AreaId = "town" | "route1" | "beach" | "cave";
interface Exit { to: AreaId; level: number; }
interface AreaDef { name: string; bg?: string; exits: Partial<Record<Dir, Exit>>; }

/** Tile indexes in the town tileset (0 based). */
const T = { grass: 125, path: 149, tall: 121, treeTL: 168, treeTR: 169, treeBL: 192, treeBR: 193, sand: 124, water: 250, rock: 224, sign: 359, flower: 31 };
const OPP: Record<Dir, Dir> = { north: "south", south: "north", east: "west", west: "east" };

const AREAS: Record<AreaId, AreaDef> = {
  town: { name: "Town", exits: { north: { to: "route1", level: 8 }, south: { to: "beach", level: 10 }, east: { to: "cave", level: 10 } } },
  route1: { name: "Route 1", bg: "grass", exits: { south: { to: "town", level: 0 } } },
  beach: { name: "Beach", bg: "beach", exits: { north: { to: "town", level: 0 } } },
  cave: { name: "Cave Entrance", bg: "cave", exits: { west: { to: "town", level: 0 } } },
};

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

/** Builds a generated area as grids of tile indexes plus a solid mask. */
function buildArea(id: AreaId): { w: number; h: number; ground: number[][]; deco: number[][]; solid: boolean[][]; tint: number | undefined; spawn: Record<Dir, { x: number; y: number }> } {
  const w = 30, h = 22;
  const g = (v: number) => Array.from({ length: h }, () => Array<number>(w).fill(v));
  const ground = g(id === "route1" ? T.grass : T.sand);
  const deco = g(-1);
  const solid = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const tree = (x: number, y: number) => {
    const set = (xx: number, yy: number, t: number) => {
      if (xx < w && yy < h) {
        deco[yy][xx] = t;
        solid[yy][xx] = true;
      }
    };
    set(x, y, T.treeTL); set(x + 1, y, T.treeTR); set(x, y + 1, T.treeBL); set(x + 1, y + 1, T.treeBR);
  };
  const rock = (x: number, y: number) => {
    deco[y][x] = T.rock;
    solid[y][x] = true;
  };
  const gapX = [13, 14, 15, 16], gapY = [9, 10, 11, 12];
  if (id === "route1") {
    for (let x = 0; x < w; x += 2) { if (!gapX.includes(x)) { tree(x, 0); tree(x, h - 2); } }
    for (let y = 2; y < h - 2; y += 2) { tree(0, y); tree(w - 2, y); }
    for (let y = 0; y < h; y++) { for (const x of gapX) { ground[y][x] = T.path; } }
    for (const [x0, y0] of [[3, 4], [19, 4], [3, 13], [19, 13]]) {
      for (let y = y0; y < y0 + 5; y++) { for (let x = x0; x < x0 + 8; x++) { deco[y][x] = T.tall; } }
    }
    // the far end is closed for now
    for (const x of gapX) { if (x % 2 === 0) { tree(x, 0); } }
  } else if (id === "beach") {
    for (let y = 14; y < h; y++) { for (let x = 0; x < w; x++) { ground[y][x] = T.water; solid[y][x] = true; } }
    for (let x = 0; x < w; x += 2) { if (!gapX.includes(x)) { tree(x, 0); } }
    for (let y = 2; y < 14; y += 2) { tree(0, y); tree(w - 2, y); }
    for (const [x, y] of [[6, 6], [22, 5], [9, 10], [20, 11], [25, 8]]) { rock(x, y); }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edge = x < 1 || y < 1 || x >= w - 1 || y >= h - 1;
        if (edge && !(x === 0 && gapY.includes(y))) { rock(x, y); }
      }
    }
    for (const [x, y] of [[5, 4], [6, 4], [12, 6], [20, 3], [24, 9], [8, 15], [17, 16], [23, 17], [26, 14]]) { rock(x, y); }
  }
  const mid = (a: number[]) => (a[1] + 1) * 32;
  return {
    w, h, ground, deco, solid, tint: id === "cave" ? 0x8a7a9a : undefined,
    spawn: { north: { x: mid(gapX), y: 48 }, south: { x: mid(gapX), y: h * 32 - 48 }, west: { x: 48, y: mid(gapY) }, east: { x: w * 32 - 48, y: mid(gapY) } },
  };
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
    this.load.tilemapTiledJSON("cc_route1", "route1.json");
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
    let spawn: { x: number; y: number };
    if (this.area === "town") {
      spawn = this.buildTown(data?.from);
    } else {
      spawn = this.buildGenerated(this.area, data?.from);
    }
    const start = data?.from ? spawn : (lastPos ?? spawn);
    this.player = this.add.sprite(start.x, start.y, "cc_player", `misa-${this.dir}`).setDepth(5);
    for (const d of ["left", "right", "front", "back"]) {
      if (!this.anims.exists(`cc-${d}`)) {
        this.anims.create({
          key: `cc-${d}`,
          frames: this.anims.generateFrameNames("cc_player", { prefix: `misa-${d}-walk.`, start: 0, end: 3, zeroPad: 3 }),
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
      .text(width - 40, height - 40, "BATTLE", { fontFamily: "emerald, monospace", fontSize: "48px", color: "#ffffff", backgroundColor: "#e3342f", padding: { x: 24, y: 12 } })
      .setOrigin(1, 1).setScrollFactor(0).setDepth(100).setInteractive({ useHandCursor: true });
    btn.setScale(1 / cam.zoom).setPosition(width / 2 + (width / 2 - 20) / cam.zoom, height / 2 + (height / 2 - 20) / cam.zoom);
    btn.setName("battle-button");
    btn.on("pointerdown", () => this.leave("button"));
    const pbtn = this.add
      .text(0, 0, "\u25D3 Pokémon", { fontFamily: "emerald, monospace", fontSize: "48px", color: "#ffffff", backgroundColor: "#2b6cb0", padding: { x: 24, y: 12 } })
      .setOrigin(1, 1).setScrollFactor(0).setDepth(100).setInteractive({ useHandCursor: true }).setName("party-button");
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
      .text(width / 2 - (width / 2 - 20) / cam.zoom, height / 2 + (height / 2 - 20) / cam.zoom, "Arrows or WASD to walk.  P for your Pokémon.  Battle, B or Esc for the next wave.", {
        fontFamily: "emerald, monospace", fontSize: "36px", color: "#ffffff", backgroundColor: "#1b2440cc", padding: { x: 16, y: 8 },
      })
      .setOrigin(0, 1).setScrollFactor(0).setDepth(100).setScale(1 / cam.zoom).setName("town-hint");
    this.showBanner();
    (window as any).__ccArea = this.area;
  }

  /** Area name card, using PokeRogue's own biome art for the generated areas. */
  private showBanner() {
    const def = AREAS[this.area];
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const cx = width / 2, top = height / 2 - (height / 2 - 16) / cam.zoom;
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (def.bg) {
      parts.push(this.add.image(cx, top, `cc_bg_${def.bg}`).setOrigin(0.5, 0).setScrollFactor(0).setDepth(110).setDisplaySize(160, 60));
    }
    parts.push(
      this.add.text(cx, top + (def.bg ? 30 : 0), def.name, { fontFamily: "emerald, monospace", fontSize: "48px", color: "#ffffff", backgroundColor: "#1b2440cc", padding: { x: 18, y: 6 } })
        .setOrigin(0.5, def.bg ? 0.5 : 0).setScrollFactor(0).setDepth(111).setScale(1 / cam.zoom),
    );
    this.tweens.add({ targets: parts, alpha: 0, delay: 1800, duration: 600, onComplete: () => parts.forEach(p => p.destroy()) });
  }

  private buildTown(from?: Dir): { x: number; y: number } {
    const map = this.make.tilemap({ key: "cc_route1" });
    const ts = map.addTilesetImage("tuxmon-sample-32px-extruded", "cc_tiles")!;
    const below = map.createLayer("Below Player", ts, 0, 0)!;
    const grass = map.createLayer("Grass", ts, 0, 0);
    this.grassAt = (tx, ty) => !!grass?.getTileAt(tx, ty);
    const world = map.createLayer("World", ts, 0, 0)!;
    map.createLayer("Above Player", ts, 0, 0)?.setDepth(10);
    // Open the east wall (cave) and the west wall (not built yet) with a short path.
    for (const y of [12, 13, 14, 15]) {
      for (const x of [0, 1, map.width - 2, map.width - 1]) {
        world.removeTileAt(x, y);
        below.putTileAt(T.path + 1, x, y);
      }
    }
    this.mapW = map.widthInPixels;
    this.mapH = map.heightInPixels;
    this.solidAt = (tx, ty) => {
      const t = world.getTileAt(tx, ty);
      return !!t && (t.properties as any)?.[TILE_COLLIDES] === true;
    };
    // Signs and gates at each entrance.
    const signAt = (tx: number, ty: number, label: string, gx: number, gy: number, gw: number, gh: number) => {
      const sign = map.putTileAt(T.sign + 1, tx, ty, true, world);
      if (sign) {
        sign.properties = { ...(sign.properties as any), [TILE_COLLIDES]: true };
      }
      this.add.text(tx * 32 + 16, ty * 32 - 2, label, { fontFamily: "emerald, monospace", fontSize: "28px", color: "#ffffff", backgroundColor: "#1b2440dd", padding: { x: 8, y: 3 } })
        .setOrigin(0.5, 1).setScale(0.5).setDepth(20);
      const gate = this.add.graphics().setDepth(4);
      gate.fillStyle(0xc89b3c, 0.9);
      gate.fillRect(gx, gy, gw, gh);
      gate.fillStyle(0x6b4a1a, 1);
      for (let i = 0; i <= (gw > gh ? gw : gh); i += 16) {
        gw > gh ? gate.fillRect(gx + i, gy - 3, 3, gh + 6) : gate.fillRect(gx - 3, gy + i, gw + 6, 3);
      }
    };
    const W = map.width, H = map.height;
    signAt(16, 1, "Route 1  Lv 8", 17 * 32, 4, 6 * 32, 6);
    signAt(16, H - 2, "Beach  Lv 10", 17 * 32, H * 32 - 10, 6 * 32, 6);
    signAt(W - 3, 11, "Cave  Lv 10", W * 32 - 10, 12 * 32, 6, 4 * 32);
    const spawnObj = map.findObject("SpawnPoints", o => o.name === "Spawn Point") as any;
    const midX = 20 * 32, midY = 14 * 32;
    const spawns: Record<Dir, { x: number; y: number }> = {
      north: { x: midX, y: 56 }, south: { x: midX, y: H * 32 - 56 }, east: { x: W * 32 - 56, y: midY }, west: { x: 56, y: midY },
    };
    return from ? spawns[from] : { x: spawnObj.x, y: spawnObj.y };
  }

  private buildGenerated(id: AreaId, from?: Dir): { x: number; y: number } {
    const a = buildArea(id);
    const map = this.make.tilemap({ tileWidth: 32, tileHeight: 32, width: a.w, height: a.h });
    const ts = map.addTilesetImage("cc_tiles", "cc_tiles", 32, 32, 1, 2, 0)!;
    const ground = map.createBlankLayer("g", ts)!;
    const deco = map.createBlankLayer("d", ts)!;
    for (let y = 0; y < a.h; y++) {
      for (let x = 0; x < a.w; x++) {
        ground.putTileAt(a.ground[y][x], x, y);
        if (a.deco[y][x] >= 0) {
          deco.putTileAt(a.deco[y][x], x, y);
        }
      }
    }
    if (a.tint) {
      ground.setTint(a.tint);
      deco.setTint(a.tint);
    }
    this.mapW = a.w * 32;
    this.mapH = a.h * 32;
    this.solidAt = (tx, ty) => a.solid[ty]?.[tx] ?? true;
    this.grassAt = (tx, ty) => a.deco[ty]?.[tx] === T.tall;
    return a.spawn[from ?? (Object.keys(AREAS[id].exits)[0] as Dir)];
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
    let dx = 0, dy = 0;
    if (k.left.isDown || k.a.isDown) { dx = -sp; this.dir = "left"; }
    else if (k.right.isDown || k.d.isDown) { dx = sp; this.dir = "right"; }
    else if (k.up.isDown || k.w.isDown) { dy = -sp; this.dir = "back"; }
    else if (k.down.isDown || k.s.isDown) { dy = sp; this.dir = "front"; }
    const p = this.player;
    if (dx || dy) {
      const nx = p.x + dx, ny = p.y + dy, foot = ny + 14;
      const edge: Dir | null = nx < 16 ? "west" : nx > this.mapW - 16 ? "east" : ny < 16 ? "north" : ny > this.mapH - 16 ? "south" : null;
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
    const tx = Math.floor(x / 32), ty = Math.floor(y / 32), key = `${tx},${ty}`;
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
        fontFamily: "emerald, monospace", fontSize: "44px", color: "#ffffff", backgroundColor: "#1b2440cc", padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5, 1).setScrollFactor(0).setDepth(100).setScale(1 / cam.zoom);
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
  (window as any).__ccScenes = () => mgr.getScenes(false).map(sc => `${sc.scene.key}:${sc.scene.isActive()}:${sc.scene.isVisible()}`);
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
