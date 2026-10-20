/*
 * CatchCrypt town (overworld) shown between PokeRogue battles. AGPL-3.0.
 * Map, tileset and player sprite: aaron5670/PokeMMO-Online-Realtime-Multiplayer-Game (WTFPL), see CREDITS.md.
 * Movement is a small grid-free walker with tile collision, modeled on that repo's Player.js.
 */
import Phaser from "phaser";

const KEY = "catchcrypt_town";
const TILE_COLLIDES = "collides";
let resumeCb: (() => void) | null = null;
let lastPos: { x: number; y: number } | null = null;

export class TownScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private world!: Phaser.Tilemaps.TilemapLayer;
  private grass!: Phaser.Tilemaps.TilemapLayer | null;
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private lastGrass = "";
  private leaving = false;
  private rate = 0.15;
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
  }

  create() {
    this.leaving = false;
    const map = this.make.tilemap({ key: "cc_route1" });
    const ts = map.addTilesetImage("tuxmon-sample-32px-extruded", "cc_tiles")!;
    map.createLayer("Below Player", ts, 0, 0);
    this.grass = map.createLayer("Grass", ts, 0, 0);
    this.world = map.createLayer("World", ts, 0, 0)!;
    map.createLayer("Above Player", ts, 0, 0)?.setDepth(10);
    const r = (this.grass?.layer.properties as any[])?.find?.(p => p.name === "encounterRate");
    if (r) {
      this.rate = Number(r.value) || this.rate;
    }
    const spawn = map.findObject("SpawnPoints", o => o.name === "Spawn Point") as any;
    this.player = this.add.sprite(lastPos?.x ?? spawn.x, lastPos?.y ?? spawn.y, "cc_player", "misa-front").setDepth(5);
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
    cam.setZoom(2).setBounds(0, 0, map.widthInPixels, map.heightInPixels).startFollow(this.player, true);
    cam.fadeIn(250, 0, 0, 0);
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("UP,DOWN,LEFT,RIGHT,W,A,S,D") as any;
    this.keys = {
      up: (this.keys as any).UP, down: (this.keys as any).DOWN, left: (this.keys as any).LEFT, right: (this.keys as any).RIGHT,
      w: (this.keys as any).W, a: (this.keys as any).A, s: (this.keys as any).S, d: (this.keys as any).D,
    };
    // Fixed Battle button, bottom right (screen space)
    const { width, height } = this.scale;
    const btn = this.add
      .text(width - 40, height - 40, "BATTLE", { fontFamily: "emerald, monospace", fontSize: "48px", color: "#ffffff", backgroundColor: "#e3342f", padding: { x: 24, y: 12 } })
      .setOrigin(1, 1).setScrollFactor(0).setDepth(100).setInteractive({ useHandCursor: true });
    btn.setScale(1 / cam.zoom).setPosition(width / 2 + (width / 2 - 20) / cam.zoom, height / 2 + (height / 2 - 20) / cam.zoom);
    btn.setName("battle-button");
    btn.on("pointerdown", () => this.leave("button"));
    kb.on("keydown-B", () => this.leave("button"));
  }

  private blocked(x: number, y: number): boolean {
    const t = this.world.getTileAtWorldXY(x, y);
    return !!t && (t.properties as any)?.[TILE_COLLIDES] === true;
  }

  update(_t: number, dtMs: number) {
    if (this.leaving) {
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
      const atEdge = nx < 16 || ny < 16 || nx > this.world.width - 16 || ny > this.world.height - 16;
      if (!atEdge && !this.blocked(nx - 10, foot) && !this.blocked(nx + 10, foot)) {
        p.setPosition(nx, ny);
      } else {
        this.showLocked();
      }
      p.anims.play(`cc-${this.dir}`, true);
      this.checkGrass();
    } else {
      p.anims.stop();
      p.setFrame(`misa-${this.dir}`);
    }
  }

  /** Throttled: at most once every 2.5 s. */
  private showLocked() {
    const now = this.time.now;
    if (now - this.lockedMsgAt < 2500) {
      return;
    }
    this.lockedMsgAt = now;
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    this.lockedText?.destroy();
    this.lockedText = this.add
      .text(width / 2, height / 2 + (height / 2 - 70) / cam.zoom, "You haven't unlocked this area yet.", {
        fontFamily: "emerald, monospace", fontSize: "44px", color: "#ffffff", backgroundColor: "#1b2440cc", padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5, 1).setScrollFactor(0).setDepth(100).setScale(1 / cam.zoom);
    (window as any).__ccLockedShown = ((window as any).__ccLockedShown ?? 0) + 1;
    this.time.delayedCall(1800, () => this.lockedText?.destroy());
  }

  private checkGrass() {
    const t = this.grass?.getTileAtWorldXY(this.player.x, this.player.y + 14);
    if (!t || t.index < 0) {
      this.lastGrass = "";
      return;
    }
    const key = `${t.x},${t.y}`;
    if (key === this.lastGrass) {
      return;
    }
    this.lastGrass = key;
    if (Math.random() < this.rate) {
      this.leave("grass");
    }
  }

  /** Leave town and hand control back to PokeRogue's encounter. */
  leave(_why: "grass" | "button") {
    if (this.leaving) {
      return;
    }
    this.leaving = true;
    lastPos = { x: this.player.x, y: this.player.y };
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

/** Pause the battle scene, show the town, and call `resume` when the player walks into grass or presses Battle. */
export function enterTown(battle: Phaser.Scene, resume: () => void): void {
  const releaseKeys = () => (battle as any).inputController?.deactivatePressedKey?.();
  resumeCb = () => {
    releaseKeys(); // keys held when the town opened never got a keyup in the paused scene
    battle.scene.resume();
    battle.scene.setVisible(true);
    (window as any).__ccInTown = false;
    resume();
  };
  const mgr = battle.game.scene;
  if (!mgr.getScene(KEY)) {
    mgr.add(KEY, TownScene, false);
  }
  releaseKeys();
  battle.scene.pause();
  battle.scene.setVisible(false);
  (window as any).__ccScenes = () => mgr.getScenes(false).map(sc => `${sc.scene.key}:${sc.scene.isActive()}:${sc.scene.isVisible()}`);
  (window as any).__ccInTown = true;
  mgr.start(KEY);
  mgr.bringToTop(KEY);
}
