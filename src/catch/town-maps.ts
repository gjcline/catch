/**
 * CatchCrypt overworld maps (town, grove, route, forest, beach, cave, biome areas). AGPL-3.0.
 * Tile indexes are 0-based ids in the vendored tuxmon tileset. The town stamps
 * `town.json` from that same map pack, then opens districts around it.
 * Level gates follow the existing rules: Route 1 and Deep Forest are level 8,
 * Beach and Cave are level 10, and the Grove beside town is open.
 * Biome areas (`biome-plains` and the rest) are built from the same tiles and
 * connect back to town. The town grows a gate for the biomes the run has reached.
 * Room sizes come from `presence/area-tiles.json`.
 */

import { CORE_AREA_TILES } from "#app/catch/overworld-areas";

export type Dir = "north" | "south" | "east" | "west";
export type CoreAreaId = "town" | "grove" | "route1" | "forest" | "beach" | "cave";
/** `biome-plains`, `biome-tall-grass`, and the other between-wave biome rooms. */
export type BiomeAreaId = `biome-${string}`;
export type AreaId = CoreAreaId | BiomeAreaId;

export interface ExitDef {
  to: AreaId;
  level: number;
}

export interface AreaDef {
  name: string;
  bg?: string;
  exits: Partial<Record<Dir, ExitDef>>;
}

export interface TiledProperty {
  name: string;
  type?: string;
  value: boolean | string | number;
}

export interface TiledObject {
  id?: number;
  name?: string;
  type?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  name: string;
  type: string;
  data?: number[];
  objects?: TiledObject[];
}

export interface TiledMap {
  width: number;
  height: number;
  layers: TiledLayer[];
  tilesets: { tiles?: { id: number; properties?: TiledProperty[] }[] }[];
}

export interface MapLabel {
  x: number;
  y: number;
  label: string;
  /** Sign tile that blocks the cell. Floating labels are text only. */
  blocking: boolean;
}

export interface MapGate {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A door or person you can talk to. Pixel rect in built-map space. */
export type ShopKind = "center" | "mart" | "house" | "npc";

export interface TownSpot {
  id: string;
  kind: ShopKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** One to three lines. Shops leave this empty and use their own menu. */
  lines: string[];
}

/** A walk-on pad. Stepping on it changes area. Pixel-free tile coordinates. */
export interface MapWarp {
  x: number;
  y: number;
  to: AreaId;
  label: string;
}

export interface WarpRequest {
  to: AreaId;
  label: string;
}

export interface BuiltMap {
  w: number;
  h: number;
  ground: number[][];
  world: number[][];
  above: number[][];
  grass: boolean[][];
  solid: boolean[][];
  defaultSpawn: { x: number; y: number };
  spawns: Partial<Record<Dir, { x: number; y: number }>>;
  labels: MapLabel[];
  gates: MapGate[];
  /** Doors and people. Empty outside town. */
  spots: TownSpot[];
  /** Biome pads. Empty until the run has reached a biome. */
  warps: MapWarp[];
  tint?: number;
  /** Encounter-tile multiply color. Falls back to `tint`. */
  grassTint?: number;
}

/** Level gates. Returning to a previous area is always open (level 0). */
export const AREAS: Record<CoreAreaId, AreaDef> = {
  town: {
    name: "Town",
    exits: {
      north: { to: "route1", level: 8 },
      south: { to: "beach", level: 10 },
      east: { to: "cave", level: 10 },
      west: { to: "grove", level: 0 },
    },
  },
  grove: { name: "Grove", bg: "grass", exits: { east: { to: "town", level: 0 } } },
  route1: {
    name: "Route 1",
    bg: "grass",
    exits: { south: { to: "town", level: 0 }, north: { to: "forest", level: 8 } },
  },
  forest: { name: "Deep Forest", bg: "grass", exits: { south: { to: "route1", level: 0 } } },
  beach: { name: "Beach", bg: "beach", exits: { north: { to: "town", level: 0 } } },
  cave: { name: "Cave Entrance", bg: "cave", exits: { west: { to: "town", level: 0 } } },
};

/** Tile indexes in the town tileset (0 based). Same ids the town scene already used. */
const T = {
  flower: 31,
  grass: 125,
  tall: 121,
  sand: 124,
  path: 149,
  treeTL: 168,
  treeTR: 169,
  treeBL: 192,
  treeBR: 193,
  fenceL: 216,
  fenceM: 217,
  fenceR: 218,
  rock: 224,
  water: 250,
  sign: 359,
};

const TREE = [
  [T.treeTL, T.treeTR],
  [T.treeBL, T.treeBR],
];

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Mouth {
  dir: Dir;
  at: number;
  len: number;
  label: string;
}

/** Pull a parsed Tiled JSON object out of Phaser's tilemap cache entry. */
export function tiledFromCache(entry: unknown): TiledMap | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as { data?: TiledMap; layers?: unknown };
  if (record.data && Array.isArray(record.data.layers)) {
    return record.data;
  }
  if (Array.isArray(record.layers) && typeof (record as TiledMap).width === "number") {
    return record as TiledMap;
  }
  return null;
}

export function buildOverworld(id: CoreAreaId, town: TiledMap | null, warps: readonly WarpRequest[] = []): BuiltMap {
  switch (id) {
    case "town":
      return buildTown(town, warps);
    case "grove":
      return buildGrove();
    case "route1":
      return buildRoute();
    case "forest":
      return buildForest();
    case "beach":
      return buildBeach();
    case "cave":
      return buildCave();
  }
}

/**
 * Walkability problems for tests and the map preview: blocked spawns, exits
 * that cannot be reached, tall grass the player can never step on.
 */
export function overworldIssues(area: AreaId, built: BuiltMap): string[] {
  const issues: string[] = [];
  const seen = reachable(built, built.defaultSpawn);
  if (!seen) {
    issues.push("default spawn is blocked");
    return issues;
  }
  const exits = Object.keys(exitsFor(area)) as Dir[];
  for (const dir of exits) {
    const spawn = built.spawns[dir];
    if (!spawn) {
      issues.push(`missing ${dir} spawn`);
      continue;
    }
    if (!footprintOpen(built, spawn)) {
      issues.push(`${dir} spawn is blocked`);
    }
    const key = tileKey(Math.floor(spawn.x / 32), Math.floor(spawn.y / 32));
    if (!seen.has(key)) {
      issues.push(`${dir} spawn is unreachable`);
    }
    if (!reachesEdge(seen, built, dir)) {
      issues.push(`${dir} edge is unreachable`);
    }
  }
  let grass = 0;
  let solidGrass = 0;
  for (let y = 0; y < built.h; y++) {
    for (let x = 0; x < built.w; x++) {
      if (!built.grass[y][x]) {
        continue;
      }
      grass++;
      if (built.solid[y][x]) {
        solidGrass++;
      } else if (seen.has(tileKey(x, y))) {
        // counted below via a second pass only when needed
      }
    }
  }
  if (solidGrass > 0) {
    issues.push(`${solidGrass} tall grass tiles are solid`);
  }
  const minGrass = minReachableGrass(area);
  if (minGrass > 0) {
    let reach = 0;
    for (const key of seen) {
      const [x, y] = key.split(",").map(Number);
      if (built.grass[y]?.[x]) {
        reach++;
      }
    }
    if (reach < minGrass) {
      issues.push(`reachable tall grass ${reach} < ${minGrass} (painted ${grass})`);
    }
  }
  for (const label of built.labels) {
    if (!label.blocking) {
      continue;
    }
    if (!built.solid[label.y]?.[label.x]) {
      issues.push(`sign is not solid: ${label.label}`);
    }
  }
  for (const warp of built.warps) {
    if (built.solid[warp.y]?.[warp.x]) {
      issues.push(`warp is solid: ${warp.label}`);
    }
    if (!seen.has(tileKey(warp.x, warp.y))) {
      issues.push(`warp is unreachable: ${warp.label}`);
    }
    const approach = tileKey(warp.x, warp.y + 1);
    if (warp.y + 1 >= built.h || !seen.has(approach) || built.solid[warp.y + 1]?.[warp.x]) {
      issues.push(`warp has no south approach: ${warp.label}`);
    }
  }
  return issues;
}

function exitsFor(area: AreaId): Partial<Record<Dir, ExitDef>> {
  if (area.startsWith("biome-")) {
    return { south: { to: "town", level: 0 } };
  }
  return AREAS[area as CoreAreaId].exits;
}

function minReachableGrass(area: AreaId): number {
  if (area.startsWith("biome-")) {
    return 40;
  }
  return MIN_REACHABLE_GRASS[area as CoreAreaId] ?? 0;
}

const MIN_REACHABLE_GRASS: Partial<Record<CoreAreaId, number>> = {
  town: 40,
  grove: 60,
  route1: 180,
  forest: 280,
  beach: 24,
  cave: 20,
};

function collisionSet(map: TiledMap): Set<number> {
  const set = new Set<number>();
  for (const tile of map.tilesets[0]?.tiles ?? []) {
    if (tile.properties?.some(p => p.name === "collides" && p.value === true)) {
      set.add(tile.id);
    }
  }
  return set;
}

function layerData(map: TiledMap, name: string): number[] {
  const layer = map.layers.find(l => l.name === name);
  if (!layer?.data) {
    throw new Error(`CatchCrypt town map is missing the ${name} layer`);
  }
  return layer.data;
}

class Draft {
  readonly w: number;
  readonly h: number;
  readonly ground: number[][];
  readonly world: number[][];
  readonly above: number[][];
  readonly grass: boolean[][];
  readonly path: boolean[][];
  readonly water: boolean[][];
  readonly solid: boolean[][];
  collides: Set<number>;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.ground = Array.from({ length: h }, () => new Array(w).fill(T.grass));
    this.world = Array.from({ length: h }, () => new Array(w).fill(-1));
    this.above = Array.from({ length: h }, () => new Array(w).fill(-1));
    this.grass = Array.from({ length: h }, () => new Array(w).fill(false));
    this.path = Array.from({ length: h }, () => new Array(w).fill(false));
    this.water = Array.from({ length: h }, () => new Array(w).fill(false));
    this.solid = Array.from({ length: h }, () => new Array(w).fill(false));
    this.collides = new Set<number>();
  }

  in(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  fillGround(tile: number): void {
    for (const row of this.ground) {
      row.fill(tile);
    }
  }

  carve(x: number, y: number, w: number, h: number, tile = T.path): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.in(xx, yy)) {
          continue;
        }
        this.ground[yy][xx] = tile;
        this.world[yy][xx] = -1;
        this.above[yy][xx] = -1;
        this.grass[yy][xx] = false;
        this.water[yy][xx] = false;
        this.path[yy][xx] = true;
      }
    }
  }

  /** Orthogonal trail. `width` is the walkable thickness in tiles. */
  corridor(points: { x: number; y: number }[], width: number): void {
    const half = Math.floor((width - 1) / 2);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const x0 = Math.min(a.x, b.x) - half;
      this.carve(x0, a.y - half, Math.abs(b.x - a.x) + width, width);
      this.carve(b.x - half, Math.min(a.y, b.y) - half, width, Math.abs(b.y - a.y) + width);
    }
  }

  stamp(src: TiledMap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number): void {
    const below = layerData(src, "Below Player");
    const world = layerData(src, "World");
    const above = layerData(src, "Above Player");
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const tx = dx + x;
        const ty = dy + y;
        if (!this.in(tx, ty)) {
          continue;
        }
        const i = (sy + y) * src.width + (sx + x);
        const ground = below[i] ?? 0;
        if (ground > 0) {
          this.ground[ty][tx] = ground - 1;
        }
        const w = world[i] ?? 0;
        const a = above[i] ?? 0;
        this.world[ty][tx] = w > 0 ? w - 1 : -1;
        this.above[ty][tx] = a > 0 ? a - 1 : -1;
        this.path[ty][tx] = false;
        this.grass[ty][tx] = false;
        this.water[ty][tx] = false;
      }
    }
  }

  grassRect(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.in(xx, yy) || this.path[yy][xx] || this.water[yy][xx] || this.world[yy][xx] >= 0) {
          continue;
        }
        this.grass[yy][xx] = true;
      }
    }
  }

  pond(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.in(xx, yy) || this.path[yy][xx]) {
          continue;
        }
        this.water[yy][xx] = true;
        this.grass[yy][xx] = false;
        this.world[yy][xx] = -1;
        this.above[yy][xx] = -1;
      }
    }
  }

  tree(x: number, y: number): boolean {
    if (!this.canTree(x, y)) {
      return false;
    }
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        this.world[y + dy][x + dx] = TREE[dy][dx];
        this.above[y + dy][x + dx] = -1;
        this.grass[y + dy][x + dx] = false;
        this.water[y + dy][x + dx] = false;
      }
    }
    return true;
  }

  canTree(x: number, y: number): boolean {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const blocked =
          !this.in(xx, yy) || this.path[yy][xx] || this.water[yy][xx] || this.grass[yy][xx] || this.world[yy][xx] >= 0;
        if (blocked) {
          return false;
        }
      }
    }
    return true;
  }

  scatterTrees(density: number, salt: number): void {
    for (let y = 2; y < this.h - 3; y += 2) {
      for (let x = 2; x < this.w - 3; x += 2) {
        if (hash(x, y, salt) % 100 < density) {
          this.tree(x, y);
        }
      }
    }
  }

  scatterRocks(density: number, salt: number): void {
    for (let y = 2; y < this.h - 2; y++) {
      for (let x = 2; x < this.w - 2; x++) {
        if (this.path[y][x] || this.water[y][x] || this.grass[y][x] || this.world[y][x] >= 0) {
          continue;
        }
        if (hash(x, y, salt) % 100 < density) {
          this.world[y][x] = T.rock;
        }
      }
    }
  }

  fenceH(x: number, y: number, len: number): void {
    for (let i = 0; i < len; i++) {
      const xx = x + i;
      if (!this.in(xx, y) || this.path[y][xx]) {
        continue;
      }
      let tile = T.fenceM;
      if (i === 0) {
        tile = T.fenceL;
      } else if (i === len - 1) {
        tile = T.fenceR;
      }
      this.world[y][xx] = tile;
      this.above[y][xx] = -1;
      this.grass[y][xx] = false;
    }
  }

  flowers(salt: number): void {
    for (let y = 2; y < this.h - 2; y++) {
      for (let x = 2; x < this.w - 2; x++) {
        if (this.path[y][x] || this.water[y][x] || this.world[y][x] >= 0 || this.grass[y][x]) {
          continue;
        }
        if (!this.besidePath(x, y) || hash(x, y, salt) % 6 !== 0) {
          continue;
        }
        this.world[y][x] = T.flower;
      }
    }
  }

  besidePath(x: number, y: number): boolean {
    return (
      (this.in(x - 1, y) && this.path[y][x - 1])
      || (this.in(x + 1, y) && this.path[y][x + 1])
      || (this.in(x, y - 1) && this.path[y - 1][x])
      || (this.in(x, y + 1) && this.path[y + 1][x])
    );
  }

  /**
   * Visible tree or rock wall on the outer two tiles, leaving path and water open
   * so exits stay on the mouths and the shoreline stays water.
   */
  seal(kind: "tree" | "rock"): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const edge = x < 2 || y < 2 || x >= this.w - 2 || y >= this.h - 2;
        if (!edge || this.path[y][x] || this.water[y][x]) {
          continue;
        }
        this.grass[y][x] = false;
        this.above[y][x] = -1;
        if (kind === "rock") {
          this.world[y][x] = T.rock;
        } else {
          this.world[y][x] = TREE[y % 2][x % 2];
        }
      }
    }
  }

  /** Clear props on a door mat and mark it walkable. Does not repaint the ground. */
  openMat(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.in(xx, yy)) {
          continue;
        }
        this.world[yy][xx] = -1;
        this.above[yy][xx] = -1;
        this.grass[yy][xx] = false;
        this.water[yy][xx] = false;
        this.path[yy][xx] = true;
      }
    }
  }

  sign(x: number, y: number): void {
    if (!this.in(x, y)) {
      return;
    }
    this.path[y][x] = false;
    this.grass[y][x] = false;
    this.water[y][x] = false;
    this.above[y][x] = -1;
    this.world[y][x] = T.sign;
    if (this.ground[y][x] === T.path) {
      this.ground[y][x] = T.grass;
    }
  }

  shrine(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!this.in(x, y)) {
          continue;
        }
        const edge = Math.abs(dx) === 2 || Math.abs(dy) === 2;
        const door = dy === 2 && dx === 0;
        if (!edge || door) {
          continue;
        }
        this.path[y][x] = false;
        this.grass[y][x] = false;
        this.water[y][x] = false;
        this.world[y][x] = T.rock;
        this.above[y][x] = -1;
      }
    }
    if (this.in(cx, cy)) {
      this.path[cy][cx] = false;
      this.world[cy][cx] = T.flower;
    }
  }

  finish(): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.path[y][x]) {
          this.world[y][x] = -1;
          this.above[y][x] = -1;
          this.grass[y][x] = false;
          this.solid[y][x] = false;
          continue;
        }
        if (this.water[y][x]) {
          this.ground[y][x] = T.water;
          this.world[y][x] = -1;
          this.above[y][x] = -1;
          this.grass[y][x] = false;
          this.solid[y][x] = true;
          continue;
        }
        const id = this.world[y][x];
        this.solid[y][x] = id === T.sign || (id >= 0 && this.collides.has(id));
      }
    }
  }

  toMap(
    spawns: Partial<Record<Dir, { x: number; y: number }>>,
    defaultSpawn: { x: number; y: number },
    labels: MapLabel[],
    gates: MapGate[],
    tint?: number,
    spots: TownSpot[] = [],
  ): BuiltMap {
    const map: BuiltMap = {
      w: this.w,
      h: this.h,
      ground: this.ground,
      world: this.world,
      above: this.above,
      grass: this.grass,
      solid: this.solid,
      defaultSpawn: this.nearestOpen(defaultSpawn),
      spawns,
      labels,
      gates,
      spots,
      warps: [],
    };
    if (tint !== undefined) {
      map.tint = tint;
    }
    return map;
  }

  /** Slide a spawn onto a nearby open tile if the preferred cell is blocked. */
  nearestOpen(p: { x: number; y: number }): { x: number; y: number } {
    const sx = Math.max(0, Math.min(this.w - 1, Math.floor(p.x / 32)));
    const sy = Math.max(0, Math.min(this.h - 1, Math.floor(p.y / 32)));
    const q: { x: number; y: number }[] = [{ x: sx, y: sy }];
    const seen = new Set<string>([tileKey(sx, sy)]);
    while (q.length > 0) {
      const cur = q.shift();
      if (!cur) {
        break;
      }
      if (!this.solid[cur.y][cur.x]) {
        return { x: cur.x * 32 + 16, y: cur.y * 32 + 16 };
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const key = tileKey(nx, ny);
        if (!this.in(nx, ny) || seen.has(key)) {
          continue;
        }
        seen.add(key);
        q.push({ x: nx, y: ny });
      }
    }
    return p;
  }
}

function hash(x: number, y: number, salt: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function spanCenter(start: number, len: number): number {
  return (start + len / 2) * 32;
}

function mouthSpawn(dir: Dir, at: number, len: number, w: number, h: number): { x: number; y: number } {
  const along = spanCenter(at, len);
  switch (dir) {
    case "north":
      return { x: along, y: 48 };
    case "south":
      return { x: along, y: h * 32 - 48 };
    case "west":
      return { x: 48, y: along };
    case "east":
      return { x: w * 32 - 48, y: along };
  }
}

function mouthRect(dir: Dir, at: number, len: number, w: number, h: number): TileRect {
  switch (dir) {
    case "north":
      return { x: at, y: 0, w: len, h: 4 };
    case "south":
      return { x: at, y: h - 4, w: len, h: 4 };
    case "west":
      return { x: 0, y: at, w: 4, h: len };
    case "east":
      return { x: w - 4, y: at, w: 4, h: len };
  }
}

function gateGraphic(rect: TileRect, dir: Dir): MapGate {
  if (dir === "north") {
    return { x: rect.x * 32, y: 4, w: rect.w * 32, h: 6 };
  }
  if (dir === "south") {
    return { x: rect.x * 32, y: (rect.y + rect.h) * 32 - 10, w: rect.w * 32, h: 6 };
  }
  if (dir === "west") {
    return { x: 4, y: rect.y * 32, w: 6, h: rect.h * 32 };
  }
  return { x: (rect.x + rect.w) * 32 - 10, y: rect.y * 32, w: 6, h: rect.h * 32 };
}

function signBeside(dir: Dir, at: number, len: number, w: number, h: number): { x: number; y: number } {
  if (dir === "north" || dir === "south") {
    const y = dir === "north" ? 3 : h - 4;
    const x = at > 3 ? at - 2 : at + len + 1;
    return { x, y };
  }
  const x = dir === "west" ? 3 : w - 4;
  const y = at > 3 ? at - 2 : at + len + 1;
  return { x, y };
}

export interface GeneratedAreaSpec {
  w: number;
  h: number;
  ground?: number;
  mouths: Mouth[];
  trails: { x: number; y: number }[][];
  trailWidth: number;
  grass?: TileRect[];
  ponds?: TileRect[];
  rooms?: TileRect[];
  treeDensity?: number;
  rockDensity?: number;
  salt: number;
  border: "tree" | "rock";
  shrine?: { x: number; y: number };
  extraLabels?: MapLabel[];
  tint?: number;
  grassTint?: number;
  defaultDir: Dir;
  flowers?: boolean;
  fences?: { x: number; y: number; len: number }[];
}

/** Shared builder for the hand-made routes and the biome areas. */
export function buildGeneratedArea(opts: GeneratedAreaSpec): BuiltMap {
  return buildScenic(opts);
}

function buildScenic(opts: GeneratedAreaSpec): BuiltMap {
  const d = new Draft(opts.w, opts.h);
  // Trees, rocks, fences and signs. Water is forced solid in finish().
  d.collides = new Set<number>([T.treeTL, T.treeTR, T.treeBL, T.treeBR, T.fenceL, T.fenceM, T.fenceR, T.rock, T.sign]);
  if (opts.ground !== undefined) {
    d.fillGround(opts.ground);
  }
  for (const trail of opts.trails) {
    d.corridor(trail, opts.trailWidth);
  }
  for (const room of opts.rooms ?? []) {
    d.carve(room.x, room.y, room.w, room.h);
  }
  for (const mouth of opts.mouths) {
    const rect = mouthRect(mouth.dir, mouth.at, mouth.len, opts.w, opts.h);
    d.carve(rect.x, rect.y, rect.w, rect.h);
  }
  for (const pond of opts.ponds ?? []) {
    d.pond(pond.x, pond.y, pond.w, pond.h);
  }
  for (const patch of opts.grass ?? []) {
    d.grassRect(patch.x, patch.y, patch.w, patch.h);
  }
  if (opts.shrine) {
    d.shrine(opts.shrine.x, opts.shrine.y);
  }
  const labels: MapLabel[] = [];
  for (const mouth of opts.mouths) {
    const at = signBeside(mouth.dir, mouth.at, mouth.len, opts.w, opts.h);
    d.sign(at.x, at.y);
    labels.push({ x: at.x, y: at.y, label: mouth.label, blocking: true });
  }
  for (const label of opts.extraLabels ?? []) {
    if (label.blocking) {
      d.sign(label.x, label.y);
    }
    labels.push(label);
  }
  if (opts.flowers) {
    d.flowers(opts.salt + 3);
  }
  for (const fence of opts.fences ?? []) {
    d.fenceH(fence.x, fence.y, fence.len);
  }
  if ((opts.treeDensity ?? 0) > 0) {
    d.scatterTrees(opts.treeDensity ?? 0, opts.salt);
  }
  if ((opts.rockDensity ?? 0) > 0) {
    d.scatterRocks(opts.rockDensity ?? 0, opts.salt + 9);
  }
  d.seal(opts.border);
  // Signs sit just inside the border; seal paints the outer ring after them, so put them back.
  for (const label of labels) {
    if (label.blocking) {
      d.sign(label.x, label.y);
    }
  }
  d.finish();
  const spawns: Partial<Record<Dir, { x: number; y: number }>> = {};
  const gates: MapGate[] = [];
  for (const mouth of opts.mouths) {
    spawns[mouth.dir] = mouthSpawn(mouth.dir, mouth.at, mouth.len, opts.w, opts.h);
    gates.push(gateGraphic(mouthRect(mouth.dir, mouth.at, mouth.len, opts.w, opts.h), mouth.dir));
  }
  const home = opts.mouths.find(m => m.dir === opts.defaultDir) ?? opts.mouths[0];
  const fallback = mouthSpawn(home.dir, home.at, home.len, opts.w, opts.h);
  const map = d.toMap(spawns, spawns[opts.defaultDir] ?? fallback, labels, gates, opts.tint);
  if (opts.grassTint !== undefined) {
    map.grassTint = opts.grassTint;
  }
  return map;
}

function buildRoute(): BuiltMap {
  return buildScenic({
    w: CORE_AREA_TILES.route1.w,
    h: CORE_AREA_TILES.route1.h,
    mouths: [
      { dir: "south", at: 25, len: 6, label: "Town" },
      { dir: "north", at: 25, len: 6, label: "Deep Forest  Lv 8" },
    ],
    trails: [
      [
        { x: 28, y: 76 },
        { x: 28, y: 62 },
        { x: 14, y: 62 },
        { x: 14, y: 46 },
        { x: 40, y: 46 },
        { x: 40, y: 30 },
        { x: 18, y: 30 },
        { x: 18, y: 16 },
        { x: 34, y: 16 },
        { x: 34, y: 8 },
        { x: 28, y: 4 },
      ],
    ],
    trailWidth: 4,
    ponds: [{ x: 22, y: 36, w: 6, h: 4 }],
    grass: [
      { x: 4, y: 8, w: 12, h: 10 },
      { x: 36, y: 8, w: 14, h: 8 },
      { x: 4, y: 34, w: 12, h: 10 },
      { x: 30, y: 50, w: 16, h: 12 },
      { x: 6, y: 56, w: 14, h: 10 },
      { x: 36, y: 64, w: 14, h: 10 },
    ],
    treeDensity: 62,
    salt: 11,
    border: "tree",
    extraLabels: [{ x: 30, y: 38, label: "Pond", blocking: false }],
    defaultDir: "south",
    flowers: true,
  });
}

function buildForest(): BuiltMap {
  return buildScenic({
    w: CORE_AREA_TILES.forest.w,
    h: CORE_AREA_TILES.forest.h,
    mouths: [{ dir: "south", at: 29, len: 6, label: "Route 1" }],
    trails: [
      [
        { x: 32, y: 84 },
        { x: 32, y: 70 },
        { x: 14, y: 70 },
        { x: 14, y: 52 },
        { x: 48, y: 52 },
        { x: 48, y: 34 },
        { x: 20, y: 34 },
        { x: 20, y: 18 },
        { x: 36, y: 18 },
        { x: 36, y: 10 },
      ],
      [
        { x: 14, y: 52 },
        { x: 14, y: 34 },
        { x: 20, y: 34 },
      ],
      [
        { x: 48, y: 34 },
        { x: 48, y: 16 },
      ],
    ],
    trailWidth: 4,
    rooms: [{ x: 44, y: 12, w: 12, h: 8 }],
    ponds: [{ x: 24, y: 42, w: 7, h: 5 }],
    grass: [
      { x: 4, y: 6, w: 16, h: 12 },
      { x: 36, y: 6, w: 18, h: 8 },
      { x: 22, y: 22, w: 16, h: 10 },
      { x: 4, y: 40, w: 14, h: 14 },
      { x: 34, y: 56, w: 18, h: 12 },
      { x: 6, y: 64, w: 16, h: 12 },
      { x: 40, y: 70, w: 16, h: 10 },
    ],
    shrine: { x: 50, y: 15 },
    treeDensity: 78,
    salt: 29,
    border: "tree",
    extraLabels: [{ x: 44, y: 18, label: "Old Shrine", blocking: false }],
    defaultDir: "south",
    flowers: true,
  });
}

function buildGrove(): BuiltMap {
  return buildScenic({
    w: CORE_AREA_TILES.grove.w,
    h: CORE_AREA_TILES.grove.h,
    mouths: [{ dir: "east", at: 16, len: 6, label: "Town" }],
    trails: [
      [
        { x: 40, y: 19 },
        { x: 24, y: 19 },
        { x: 24, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 24 },
        { x: 18, y: 24 },
      ],
    ],
    trailWidth: 4,
    ponds: [{ x: 6, y: 28, w: 6, h: 4 }],
    grass: [
      { x: 4, y: 4, w: 16, h: 8 },
      { x: 28, y: 6, w: 10, h: 8 },
      { x: 4, y: 16, w: 10, h: 6 },
      { x: 26, y: 24, w: 12, h: 8 },
    ],
    treeDensity: 42,
    salt: 7,
    border: "tree",
    extraLabels: [{ x: 14, y: 26, label: "Clearing", blocking: false }],
    defaultDir: "east",
    flowers: true,
  });
}

function buildBeach(): BuiltMap {
  const { w, h } = CORE_AREA_TILES.beach;
  const built = buildScenic({
    w,
    h,
    ground: T.sand,
    mouths: [{ dir: "north", at: 18, len: 6, label: "Town" }],
    trails: [
      [
        { x: 21, y: 2 },
        { x: 21, y: 20 },
      ],
    ],
    trailWidth: 4,
    ponds: [{ x: 0, y: 24, w, h: h - 24 }],
    grass: [
      { x: 4, y: 6, w: 12, h: 8 },
      { x: 26, y: 6, w: 12, h: 8 },
      { x: 6, y: 16, w: 10, h: 6 },
      { x: 26, y: 16, w: 12, h: 6 },
    ],
    treeDensity: 0,
    rockDensity: 8,
    salt: 4,
    border: "tree",
    grassTint: 0x49b0c8,
    defaultDir: "north",
  });
  return built;
}

function buildCave(): BuiltMap {
  return buildScenic({
    w: CORE_AREA_TILES.cave.w,
    h: CORE_AREA_TILES.cave.h,
    ground: T.sand,
    mouths: [{ dir: "west", at: 12, len: 6, label: "Town" }],
    trails: [
      [
        { x: 2, y: 15 },
        { x: 12, y: 15 },
        { x: 12, y: 8 },
        { x: 26, y: 8 },
        { x: 26, y: 18 },
        { x: 16, y: 18 },
      ],
    ],
    trailWidth: 4,
    rooms: [{ x: 14, y: 12, w: 12, h: 8 }],
    grass: [
      { x: 4, y: 6, w: 8, h: 6 },
      { x: 28, y: 6, w: 6, h: 8 },
      { x: 6, y: 20, w: 10, h: 6 },
      { x: 28, y: 16, w: 6, h: 8 },
    ],
    rockDensity: 22,
    salt: 17,
    border: "rock",
    tint: 0x8a7a9a,
    grassTint: 0x6f9a62,
    defaultDir: "west",
  });
}

/** Original town.json is 40x40. Districts wrap it: north Route 1, south Beach, east Cave, west Grove. */
const OX = 18;
const OY = 16;
const SRC_W = 40;
const SRC_H = 40;
const TOWN_W = CORE_AREA_TILES.town.w;
const TOWN_H = CORE_AREA_TILES.town.h;

const COTTAGE: TileRect = { x: 4, y: 30, w: 8, h: 6 };

function asShopKind(value: string | undefined): ShopKind | null {
  const key = value?.trim().toLowerCase();
  if (key === "center" || key === "mart" || key === "house" || key === "npc") {
    return key;
  }
  return null;
}

function objectProp(obj: TiledObject, name: string): string | undefined {
  const found = obj.properties?.find(prop => prop.name === name);
  if (found === undefined || found.value === undefined || found.value === null) {
    return undefined;
  }
  return String(found.value);
}

function defaultSpotName(kind: ShopKind): string {
  if (kind === "center") {
    return "Poké Center";
  }
  if (kind === "mart") {
    return "Mart";
  }
  if (kind === "house") {
    return "House";
  }
  return "Local";
}

function defaultSpotLines(kind: ShopKind): string[] {
  if (kind === "house") {
    return ["The house is quiet."];
  }
  if (kind === "npc") {
    return ["They nod hello."];
  }
  return [];
}

/** Doors and people from town.json, shifted into the wrapped town. At most three talk lines. */
export function spotsFromTiled(town: TiledMap, originX = 0, originY = 0): TownSpot[] {
  const spots: TownSpot[] = [];
  for (const layer of town.layers) {
    if (layer.name !== "Doors" && layer.name !== "Npcs") {
      continue;
    }
    for (const obj of layer.objects ?? []) {
      const kind = asShopKind(objectProp(obj, "shop") ?? obj.type);
      if (!kind) {
        continue;
      }
      const parsed = (objectProp(obj, "lines") ?? "")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .slice(0, 3);
      const lines = parsed.length > 0 ? parsed : defaultSpotLines(kind);
      const width = obj.width && obj.width > 0 ? obj.width : 32;
      const height = obj.height && obj.height > 0 ? obj.height : 32;
      spots.push({
        id: `${kind}-${obj.id ?? spots.length}`,
        kind,
        name: obj.name && obj.name.trim().length > 0 ? obj.name : defaultSpotName(kind),
        x: obj.x + originX,
        y: obj.y + originY,
        w: width,
        h: height,
        lines,
      });
    }
  }
  return spots;
}

function plantNpc(solid: boolean[][], world: number[][], spot: TownSpot): void {
  if (spot.kind !== "npc") {
    return;
  }
  const tx = Math.floor((spot.x + spot.w / 2) / 32);
  const ty = Math.floor((spot.y + spot.h / 2) / 32);
  if (solid[ty]?.[tx] === undefined) {
    return;
  }
  world[ty][tx] = -1;
  solid[ty][tx] = true;
}

function tileSpot(id: string, kind: ShopKind, name: string, tx: number, ty: number, lines: string[]): TownSpot {
  return { id, kind, name, x: tx * 32, y: ty * 32, w: 32, h: 32, lines };
}

/** Counters for the walkable stand-in town, inside the square and off the roads. */
function fallbackTownSpots(): TownSpot[] {
  return [
    tileSpot("center", "center", "Poké Center", 33, 31, []),
    tileSpot("mart", "mart", "Mart", 42, 31, []),
    tileSpot("house", "house", "House", 33, 33, ["A quiet house off the square."]),
    tileSpot("npc", "npc", "Local", 42, 33, ["North leads to Route 1, once your team is ready."]),
  ];
}

function openDoorMats(draft: Draft, spots: readonly TownSpot[]): void {
  for (const spot of spots) {
    if (spot.kind === "npc") {
      continue;
    }
    const tx = Math.floor(spot.x / 32);
    const ty = Math.floor(spot.y / 32);
    const tw = Math.max(1, Math.round(spot.w / 32));
    const th = Math.max(1, Math.round(spot.h / 32));
    draft.openMat(tx, ty, tw, th);
  }
}

/** Used when town.json never reached the Phaser cache (404 on a git deploy). Still walkable, same gates. */
function buildTownFallback(warps: readonly WarpRequest[]): BuiltMap {
  const built = buildScenic({
    w: TOWN_W,
    h: TOWN_H,
    mouths: [
      { dir: "north", at: 49, len: 6, label: "Route 1  Lv 8" },
      { dir: "south", at: 35, len: 6, label: "Beach  Lv 10" },
      { dir: "east", at: 33, len: 4, label: "Cave  Lv 10" },
      { dir: "west", at: 33, len: 5, label: "Grove" },
    ],
    trails: [
      [
        { x: 52, y: 4 },
        { x: 52, y: 36 },
        { x: 38, y: 36 },
        { x: 38, y: 68 },
      ],
      [
        { x: 4, y: 35 },
        { x: 72, y: 35 },
      ],
    ],
    trailWidth: 4,
    rooms: [{ x: 30, y: 28, w: 16, h: 12 }],
    grass: [
      { x: 8, y: 8, w: 10, h: 6 },
      { x: 58, y: 8, w: 10, h: 6 },
      { x: 8, y: 56, w: 12, h: 6 },
      { x: 56, y: 56, w: 10, h: 6 },
    ],
    treeDensity: 30,
    salt: 3,
    border: "tree",
    extraLabels: [{ x: 34, y: 32, label: "Town Square", blocking: false }],
    defaultDir: "south",
    flowers: true,
  });
  built.spots = fallbackTownSpots();
  for (const spot of built.spots) {
    plantNpc(built.solid, built.world, spot);
  }
  carveWarpGate(built, warps);
  return built;
}

function buildTown(town: TiledMap | null, warps: readonly WarpRequest[]): BuiltMap {
  if (!town) {
    return buildTownFallback(warps);
  }
  const d = new Draft(TOWN_W, TOWN_H);
  d.collides = collisionSet(town);
  d.collides.add(T.sign);
  d.stamp(town, 0, 0, SRC_W, SRC_H, OX, OY);

  // Roads punch the original tree wall and run out to each map edge.
  const northX = OX + 31;
  const southX = OX + 17;
  const roadY = OY + 17;
  d.carve(northX, 0, 6, OY + 4);
  d.carve(OX + 26, OY - 6, 16, 6);
  d.carve(southX, OY + 36, 6, TOWN_H - (OY + 36));
  d.carve(OX + 12, OY + SRC_H + 2, 18, 6);
  d.carve(0, roadY, OX + 2, 5);
  d.carve(OX + 36, roadY, TOWN_W - (OX + 36), 4);

  const cottages: { x: number; y: number }[] = [
    { x: 6, y: 2 },
    { x: 62, y: 2 },
    { x: 4, y: 22 },
    { x: 62, y: 22 },
    { x: 4, y: 44 },
    { x: 62, y: 44 },
    { x: 6, y: 58 },
    { x: 52, y: 58 },
  ];
  for (const spot of cottages) {
    d.stamp(town, COTTAGE.x, COTTAGE.y, COTTAGE.w, COTTAGE.h, spot.x, spot.y);
  }

  d.fenceH(44, 9, 5);
  d.fenceH(56, 9, 5);
  d.grassRect(2, 10, 8, 5);
  d.grassRect(66, 10, 8, 5);
  d.grassRect(2, 50, 12, 6);
  d.grassRect(64, 52, 8, 6);
  d.grassRect(20, 64, 8, 4);
  d.flowers(5);
  for (const [x, y] of [
    [4, 16],
    [66, 16],
    [22, 4],
    [68, 64],
  ] as const) {
    d.tree(x, y);
  }
  d.seal("tree");

  const labels: MapLabel[] = [
    { x: northX - 2, y: 3, label: "Route 1  Lv 8", blocking: true },
    { x: southX - 2, y: TOWN_H - 4, label: "Beach  Lv 10", blocking: true },
    { x: TOWN_W - 4, y: roadY - 2, label: "Cave  Lv 10", blocking: true },
    { x: 3, y: roadY - 2, label: "Grove", blocking: true },
    { x: OX + 9, y: OY + 17, label: "Poké Center", blocking: false },
    { x: OX + 22, y: OY + 22, label: "Town Square", blocking: false },
  ];
  for (const label of labels) {
    if (label.blocking) {
      d.sign(label.x, label.y);
    }
  }
  const spots = spotsFromTiled(town, OX * 32, OY * 32);
  openDoorMats(d, spots);
  d.finish();
  for (const spot of spots) {
    plantNpc(d.solid, d.world, spot);
  }

  const spawns: Partial<Record<Dir, { x: number; y: number }>> = {
    north: { x: spanCenter(northX, 6), y: 48 },
    south: { x: spanCenter(southX, 6), y: TOWN_H * 32 - 48 },
    west: { x: 48, y: spanCenter(roadY, 5) },
    east: { x: TOWN_W * 32 - 48, y: spanCenter(roadY, 4) },
  };
  const gates: MapGate[] = [
    gateGraphic({ x: northX, y: 0, w: 6, h: 4 }, "north"),
    gateGraphic({ x: southX, y: TOWN_H - 4, w: 6, h: 4 }, "south"),
    gateGraphic({ x: 0, y: roadY, w: 4, h: 5 }, "west"),
    gateGraphic({ x: TOWN_W - 4, y: roadY, w: 4, h: 4 }, "east"),
  ];
  // Prefer the open square in front of the center buildings.
  const built = d.toMap(spawns, { x: (OX + 20) * 32 + 16, y: (OY + 20) * 32 + 16 }, labels, gates, undefined, spots);
  carveWarpGate(built, warps);
  return built;
}

/**
 * Pads just north of a walkway that joins the north road. The walkway is the
 * approach, so crossing from one pad to the next is not required.
 * At most eight pads fit beside the road without covering the Route 1 mouth.
 */
function carveWarpGate(built: BuiltMap, requests: readonly WarpRequest[]): void {
  if (requests.length === 0) {
    return;
  }
  const count = Math.min(8, requests.length);
  for (let y = 12; y <= 13; y++) {
    for (let x = 16; x < 56; x++) {
      openCell(built, x, y);
    }
  }
  built.labels.push({ x: 16, y: 13, label: "Biome gate", blocking: false });
  for (let i = 0; i < count; i++) {
    const x = 18 + i * 3;
    const y = 11;
    openCell(built, x, y);
    const request = requests[i];
    built.warps.push({ x, y, to: request.to, label: request.label });
    built.labels.push({ x, y, label: request.label, blocking: false });
  }
}

function openCell(built: BuiltMap, x: number, y: number): void {
  if (y < 0 || x < 0 || y >= built.h || x >= built.w) {
    return;
  }
  built.ground[y][x] = T.path;
  built.world[y][x] = -1;
  built.above[y][x] = -1;
  built.grass[y][x] = false;
  built.solid[y][x] = false;
}

function footprintOpen(built: BuiltMap, p: { x: number; y: number }): boolean {
  const points = [
    [p.x, p.y],
    [p.x - 10, p.y + 14],
    [p.x + 10, p.y + 14],
  ];
  for (const [x, y] of points) {
    const tx = Math.floor(x / 32);
    const ty = Math.floor(y / 32);
    if (ty < 0 || tx < 0 || ty >= built.h || tx >= built.w || built.solid[ty][tx]) {
      return false;
    }
  }
  return true;
}

function reachable(built: BuiltMap, origin: { x: number; y: number }): Set<string> | null {
  if (!footprintOpen(built, origin)) {
    return null;
  }
  const sx = Math.floor(origin.x / 32);
  const sy = Math.floor(origin.y / 32);
  const seen = new Set<string>([tileKey(sx, sy)]);
  const q = [[sx, sy]];
  while (q.length > 0) {
    const cur = q.shift();
    if (!cur) {
      break;
    }
    const [x, y] = cur;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || nx < 0 || ny >= built.h || nx >= built.w || built.solid[ny][nx]) {
        continue;
      }
      const key = tileKey(nx, ny);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  return seen;
}

function reachesEdge(seen: Set<string>, built: BuiltMap, dir: Dir): boolean {
  for (const key of seen) {
    const [x, y] = key.split(",").map(Number);
    if (dir === "north" && y === 0) {
      return true;
    }
    if (dir === "south" && y === built.h - 1) {
      return true;
    }
    if (dir === "west" && x === 0) {
      return true;
    }
    if (dir === "east" && x === built.w - 1) {
      return true;
    }
  }
  return false;
}
