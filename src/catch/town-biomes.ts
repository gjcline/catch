/**
 * CatchCrypt biome areas for the between-wave overworld. AGPL-3.0.
 * Each PokeRogue biome the run can reach (except Town and the End) gets a
 * walkable room, its own presence id, and encounter tiles drawn from that
 * biome's wild species pool. Cave rolls lean Rock. Beach rolls lean Water
 * and Ground.
 */

import { BIOME_PREFIX, biomeLayout, layoutTiles } from "#app/catch/overworld-areas";
import type { AreaId, BuiltMap, GeneratedAreaSpec, WarpRequest } from "#app/catch/town-maps";
import { buildGeneratedArea } from "#app/catch/town-maps";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allBiomes } from "#data/data-lists";
import { initSpeciesDataRegistry } from "#data/species-data-registry";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { initBiomes } from "#init/init-biomes";
import { enumValueToKey } from "#utils/enums";

/** Same 0-based tuxmon indexes the town maps use. */
const GROUND = { grass: 125, sand: 124, path: 149 };

const WILD_TIERS = [
  BiomePoolTier.COMMON,
  BiomePoolTier.UNCOMMON,
  BiomePoolTier.RARE,
  BiomePoolTier.SUPER_RARE,
  BiomePoolTier.ULTRA_RARE,
] as const;

/** How many biome pads fit on the town gate. The current biome is always kept. */
export const MAX_LINKED_BIOMES = 8;

/** Grass encounters in Cave and on the Beach prefer these types about three times in four. */
export const CAVE_BIAS_TYPES = [PokemonType.ROCK] as const;
export const BEACH_BIAS_TYPES = [PokemonType.WATER, PokemonType.GROUND] as const;
export const TYPE_BIAS_CHANCE = 0.75;

interface Theme {
  name: string;
  ground?: number;
  border: "tree" | "rock";
  tint?: number;
  grassTint: number;
  treeDensity: number;
  rockDensity: number;
  flowers: boolean;
}

export interface TownEncounterSpec {
  biomeId: BiomeId;
  biasTypes?: readonly PokemonType[];
  biasChance?: number;
}

const visited: BiomeId[] = [];
let pending: TownEncounterSpec | null = null;

function field(name: string, extra: Partial<Theme> = {}): Theme {
  return {
    name,
    border: "tree",
    treeDensity: 42,
    rockDensity: 0,
    flowers: true,
    grassTint: 0x7ec850,
    ...extra,
  };
}

function city(name: string, extra: Partial<Theme> = {}): Theme {
  return {
    name,
    ground: GROUND.path,
    border: "rock",
    treeDensity: 8,
    rockDensity: 4,
    flowers: false,
    grassTint: 0x68b05a,
    ...extra,
  };
}

function shore(name: string, extra: Partial<Theme> = {}): Theme {
  return {
    name,
    ground: GROUND.sand,
    border: "tree",
    treeDensity: 6,
    rockDensity: 6,
    flowers: false,
    grassTint: 0x3aa0c8,
    ...extra,
  };
}

function cave(name: string, extra: Partial<Theme> = {}): Theme {
  return {
    name,
    ground: GROUND.sand,
    border: "rock",
    treeDensity: 0,
    rockDensity: 24,
    flowers: false,
    grassTint: 0x6f9a62,
    tint: 0x8a7a9a,
    ...extra,
  };
}

function ridge(name: string, extra: Partial<Theme> = {}): Theme {
  return {
    name,
    ground: GROUND.sand,
    border: "rock",
    treeDensity: 8,
    rockDensity: 28,
    flowers: false,
    grassTint: 0x8a9a68,
    ...extra,
  };
}

const THEMES: Partial<Record<BiomeId, Theme>> = {
  [BiomeId.PLAINS]: field("Plains", { treeDensity: 36, grassTint: 0x8fd15a }),
  [BiomeId.GRASS]: field("Grassy Field", { tint: 0xc5e6a4, treeDensity: 58, grassTint: 0x67c23a }),
  [BiomeId.TALL_GRASS]: field("Tall Grass", { tint: 0x9ed56a, treeDensity: 70, grassTint: 0x4ea428 }),
  [BiomeId.METROPOLIS]: city("Metropolis", { tint: 0xc5ccd6, treeDensity: 4, rockDensity: 2 }),
  [BiomeId.FOREST]: field("Forest", { tint: 0x6d9a58, treeDensity: 78, grassTint: 0x3f8a32 }),
  [BiomeId.SEA]: shore("Sea", { tint: 0x8ec8e6, treeDensity: 0, rockDensity: 2, grassTint: 0x2f8ec4 }),
  [BiomeId.SWAMP]: field("Swamp", { tint: 0x8aa06a, treeDensity: 48, grassTint: 0x6a9a40 }),
  [BiomeId.BEACH]: shore("Beach", { tint: 0xf2e2b0, rockDensity: 8, grassTint: 0x49b0c8 }),
  [BiomeId.LAKE]: shore("Lake", {
    ground: GROUND.grass,
    tint: 0xb7d7ee,
    treeDensity: 22,
    flowers: true,
    grassTint: 0x5eb0d8,
  }),
  [BiomeId.SEABED]: cave("Seabed", { tint: 0x6a9ec4, grassTint: 0x3a88b0, rockDensity: 16 }),
  [BiomeId.MOUNTAIN]: ridge("Mountain", { tint: 0xd0c8bc, rockDensity: 34, treeDensity: 6 }),
  [BiomeId.BADLANDS]: ridge("Badlands", { tint: 0xd8b07a, rockDensity: 22, treeDensity: 2, grassTint: 0xa89048 }),
  [BiomeId.CAVE]: cave("Cave"),
  [BiomeId.DESERT]: ridge("Desert", { tint: 0xe7c98a, rockDensity: 14, treeDensity: 0, grassTint: 0xc4b05a }),
  [BiomeId.ICE_CAVE]: cave("Ice Cave", { tint: 0xd5e7f5, grassTint: 0xb7d8ee, rockDensity: 20 }),
  [BiomeId.MEADOW]: field("Meadow", { tint: 0xd4efb0, treeDensity: 28, flowers: true, grassTint: 0x9ad85a }),
  [BiomeId.POWER_PLANT]: city("Power Plant", { tint: 0xcfd6a8, grassTint: 0x8aaa48 }),
  [BiomeId.VOLCANO]: ridge("Volcano", { tint: 0xe0a090, rockDensity: 30, treeDensity: 0, grassTint: 0xc47048 }),
  [BiomeId.GRAVEYARD]: ridge("Graveyard", {
    ground: GROUND.grass,
    tint: 0xb7b3c9,
    treeDensity: 18,
    rockDensity: 16,
    grassTint: 0x8a9a68,
  }),
  [BiomeId.DOJO]: city("Dojo", { tint: 0xe6d2b0, grassTint: 0x7aaa50 }),
  [BiomeId.FACTORY]: city("Factory", { tint: 0xb7bdc6, treeDensity: 0, rockDensity: 8, grassTint: 0x6a9458 }),
  [BiomeId.RUINS]: ridge("Ruins", { tint: 0xd8d0b0, rockDensity: 20, treeDensity: 10 }),
  [BiomeId.WASTELAND]: ridge("Wasteland", { tint: 0xc4b49a, rockDensity: 26, treeDensity: 2, grassTint: 0x98a060 }),
  [BiomeId.ABYSS]: cave("Abyss", { tint: 0x6a5a88, grassTint: 0x5a6a48, rockDensity: 22 }),
  [BiomeId.SPACE]: cave("Space", { tint: 0x9aa0d0, grassTint: 0x88a0c0, rockDensity: 12 }),
  [BiomeId.CONSTRUCTION_SITE]: city("Construction Site", {
    ground: GROUND.sand,
    tint: 0xd8c4a0,
    rockDensity: 12,
    grassTint: 0x8aaa58,
  }),
  [BiomeId.JUNGLE]: field("Jungle", { tint: 0x4f8f4a, treeDensity: 82, grassTint: 0x2f8a30 }),
  [BiomeId.FAIRY_CAVE]: cave("Fairy Cave", { tint: 0xf0c6e0, grassTint: 0xd8a0c8, rockDensity: 14 }),
  [BiomeId.TEMPLE]: ridge("Temple", { tint: 0xe6d7a8, rockDensity: 18, treeDensity: 8, grassTint: 0xa8b868 }),
  [BiomeId.SLUM]: city("Slum", { tint: 0xb7a898, treeDensity: 12, rockDensity: 8, grassTint: 0x6a9850 }),
  [BiomeId.SNOWY_FOREST]: field("Snowy Forest", {
    tint: 0xe7f2f8,
    treeDensity: 64,
    flowers: false,
    grassTint: 0xc5e6c0,
  }),
  [BiomeId.ISLAND]: shore("Island", { tint: 0x9ed68a, treeDensity: 18, flowers: true, grassTint: 0x49b86a }),
  [BiomeId.LABORATORY]: city("Laboratory", { tint: 0xd0e4ef, treeDensity: 2, rockDensity: 2, grassTint: 0x78b0a0 }),
};

export function overworldBiomeIds(): BiomeId[] {
  return (Object.values(BiomeId) as BiomeId[])
    .filter(id => id !== BiomeId.TOWN && id !== BiomeId.END)
    .sort((a, b) => a - b);
}

export function isOverworldBiome(id: BiomeId): boolean {
  return id !== BiomeId.TOWN && id !== BiomeId.END && THEMES[id] !== undefined;
}

export function biomeSlug(biomeId: BiomeId): string {
  return enumValueToKey(BiomeId, biomeId).toLowerCase().replaceAll("_", "-");
}

/** Presence room id. One room per biome area, separate from town, route, beach, and cave. */
export function biomeAreaId(biomeId: BiomeId): AreaId {
  return `${BIOME_PREFIX}${biomeSlug(biomeId)}`;
}

export function presenceRoomId(area: AreaId): string {
  return area;
}

export function biomeIdFromArea(area: string): BiomeId | null {
  if (!area.startsWith(BIOME_PREFIX)) {
    return null;
  }
  const slug = area.slice(BIOME_PREFIX.length);
  for (const id of overworldBiomeIds()) {
    if (biomeSlug(id) === slug) {
      return id;
    }
  }
  return null;
}

export function isBiomeArea(area: AreaId): area is `biome-${string}` {
  return area.startsWith(BIOME_PREFIX);
}

export function biomeName(biomeId: BiomeId): string {
  return THEMES[biomeId]?.name ?? biomeSlug(biomeId);
}

/** Arena background key, matching PokeRogue's `images/arenas/<key>_bg.png`. */
export function biomeBgKey(biomeId: BiomeId): string {
  return enumValueToKey(BiomeId, biomeId).toLowerCase();
}

export function areaExits(area: AreaId): { south?: { to: "town"; level: 0 } } | null {
  if (!isBiomeArea(area)) {
    return null;
  }
  return { south: { to: "town", level: 0 } };
}

export function biomeAreaName(area: AreaId): string | null {
  const id = biomeIdFromArea(area);
  return id == null ? null : biomeName(id);
}

export function biomeAreaBg(area: AreaId): string | null {
  const id = biomeIdFromArea(area);
  return id == null ? null : biomeBgKey(id);
}

function themeFor(biomeId: BiomeId): Theme {
  const theme = THEMES[biomeId];
  if (!theme) {
    throw new Error(`CatchCrypt has no overworld theme for biome ${biomeId}`);
  }
  return theme;
}

export function buildBiomeArea(biomeId: BiomeId): BuiltMap {
  return buildGeneratedArea(specFor(biomeId, themeFor(biomeId)));
}

function specFor(biomeId: BiomeId, theme: Theme): GeneratedAreaSpec {
  const salt = biomeId * 17 + 5;
  const layout = biomeLayout(biomeSlug(biomeId));
  switch (layout) {
    case "city":
      return citySpec(theme, salt);
    case "shore":
      return shoreSpec(theme, salt, biomeId);
    case "cave":
      return caveSpec(theme, salt);
    case "ridge":
      return ridgeSpec(theme, salt);
    case "field":
      return fieldSpec(theme, salt, biomeId);
    default:
      throw new Error(`CatchCrypt has no overworld layout for ${biomeSlug(biomeId)}`);
  }
}

function baseSpec(theme: Theme, salt: number, w: number, h: number, at: number): GeneratedAreaSpec {
  const spec: GeneratedAreaSpec = {
    w,
    h,
    mouths: [{ dir: "south", at, len: 6, label: "Town" }],
    trails: [],
    trailWidth: 4,
    salt,
    border: theme.border,
    grassTint: theme.grassTint,
    defaultDir: "south",
    flowers: theme.flowers,
    treeDensity: theme.treeDensity,
    rockDensity: theme.rockDensity,
    extraLabels: [{ x: 6, y: 6, label: theme.name, blocking: false }],
  };
  if (theme.ground !== undefined) {
    spec.ground = theme.ground;
  }
  if (theme.tint !== undefined) {
    spec.tint = theme.tint;
  }
  return spec;
}

function fieldSpec(theme: Theme, salt: number, biomeId: BiomeId): GeneratedAreaSpec {
  const { w, h } = layoutTiles("field");
  const spec = baseSpec(theme, salt, w, h, 22);
  spec.trails = [
    [
      { x: 25, y: 38 },
      { x: 25, y: 28 },
      { x: 12, y: 28 },
      { x: 12, y: 16 },
      { x: 36, y: 16 },
      { x: 36, y: 8 },
      { x: 24, y: 8 },
    ],
  ];
  spec.grass = [
    { x: 4, y: 4, w: 16, h: 10 },
    { x: 30, y: 4, w: 16, h: 8 },
    { x: 18, y: 18, w: 14, h: 8 },
    { x: 4, y: 20, w: 12, h: 10 },
    { x: 32, y: 24, w: 14, h: 10 },
    { x: 8, y: 32, w: 12, h: 6 },
  ];
  if (biomeId % 2 === 0) {
    spec.ponds = [{ x: 20, y: 30, w: 8, h: 4 }];
  } else {
    spec.ponds = [{ x: 36, y: 34, w: 8, h: 4 }];
  }
  return spec;
}

function citySpec(theme: Theme, salt: number): GeneratedAreaSpec {
  const { w, h } = layoutTiles("city");
  const spec = baseSpec(theme, salt, w, h, 20);
  spec.trails = [
    [
      { x: 23, y: 32 },
      { x: 23, y: 22 },
      { x: 10, y: 22 },
      { x: 10, y: 12 },
      { x: 34, y: 12 },
      { x: 34, y: 8 },
      { x: 23, y: 8 },
    ],
    [
      { x: 10, y: 22 },
      { x: 10, y: 28 },
      { x: 34, y: 28 },
      { x: 34, y: 22 },
    ],
  ];
  spec.grass = [
    { x: 4, y: 4, w: 10, h: 6 },
    { x: 32, y: 4, w: 10, h: 6 },
    { x: 16, y: 16, w: 12, h: 6 },
    { x: 4, y: 24, w: 10, h: 6 },
    { x: 32, y: 24, w: 10, h: 6 },
  ];
  spec.fences = [
    { x: 6, y: 14, len: 8 },
    { x: 30, y: 14, len: 10 },
    { x: 14, y: 26, len: 8 },
  ];
  spec.rooms = [{ x: 16, y: 8, w: 14, h: 6 }];
  return spec;
}

function shoreSpec(theme: Theme, salt: number, biomeId: BiomeId): GeneratedAreaSpec {
  const { w, h } = layoutTiles("shore");
  const spec = baseSpec(theme, salt, w, h, 21);
  spec.trails = [
    [
      { x: 24, y: 32 },
      { x: 24, y: 20 },
      { x: 12, y: 20 },
      { x: 12, y: 14 },
      { x: 36, y: 14 },
      { x: 36, y: 20 },
      { x: 24, y: 20 },
    ],
  ];
  // Water sits on the far side of the area so the south exit back to town stays open.
  const deep = biomeId === BiomeId.SEA || biomeId === BiomeId.LAKE;
  spec.ponds = deep
    ? [{ x: 4, y: 3, w: 40, h: 10 }]
    : [
        { x: 4, y: 3, w: 16, h: 8 },
        { x: 28, y: 3, w: 16, h: 8 },
      ];
  spec.grass = [
    { x: 4, y: 16, w: 12, h: 8 },
    { x: 32, y: 16, w: 12, h: 8 },
    { x: 8, y: 24, w: 12, h: 6 },
    { x: 28, y: 24, w: 14, h: 6 },
  ];
  return spec;
}

function caveSpec(theme: Theme, salt: number): GeneratedAreaSpec {
  const { w, h } = layoutTiles("cave");
  const spec = baseSpec(theme, salt, w, h, 18);
  spec.trails = [
    [
      { x: 21, y: 30 },
      { x: 21, y: 22 },
      { x: 10, y: 22 },
      { x: 10, y: 12 },
      { x: 30, y: 12 },
      { x: 30, y: 20 },
      { x: 21, y: 20 },
    ],
  ];
  spec.rooms = [{ x: 14, y: 14, w: 14, h: 8 }];
  spec.grass = [
    { x: 4, y: 6, w: 10, h: 6 },
    { x: 28, y: 6, w: 10, h: 6 },
    { x: 4, y: 16, w: 8, h: 6 },
    { x: 30, y: 22, w: 8, h: 6 },
    { x: 6, y: 24, w: 10, h: 5 },
  ];
  return spec;
}

function ridgeSpec(theme: Theme, salt: number): GeneratedAreaSpec {
  const { w, h } = layoutTiles("ridge");
  const spec = baseSpec(theme, salt, w, h, 19);
  spec.trails = [
    [
      { x: 22, y: 32 },
      { x: 22, y: 24 },
      { x: 10, y: 24 },
      { x: 10, y: 14 },
      { x: 32, y: 14 },
      { x: 32, y: 8 },
      { x: 20, y: 8 },
    ],
  ];
  spec.grass = [
    { x: 4, y: 6, w: 12, h: 6 },
    { x: 28, y: 6, w: 12, h: 6 },
    { x: 16, y: 16, w: 12, h: 6 },
    { x: 4, y: 20, w: 10, h: 6 },
    { x: 30, y: 22, w: 10, h: 6 },
  ];
  spec.shrine = { x: 22, y: 10 };
  return spec;
}

export function resetVisitedBiomes(): void {
  visited.length = 0;
}

/** Remember a biome the run has entered. The newest one stays on the town gate. */
export function noteRunBiome(id: BiomeId | null | undefined): void {
  if (id == null || !isOverworldBiome(id)) {
    return;
  }
  const index = visited.indexOf(id);
  if (index >= 0) {
    visited.splice(index, 1);
  }
  visited.push(id);
}

export function currentRunBiome(): BiomeId | null {
  try {
    const id = globalScene?.arena?.biomeId;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

/** Biomes currently linked from town, oldest dropped past the pad limit, current kept. */
export function linkedBiomeIds(): BiomeId[] {
  const recent = visited.slice(-MAX_LINKED_BIOMES);
  return [...recent].sort((a, b) => a - b);
}

export function townWarpRequests(): WarpRequest[] {
  return linkedBiomeIds().map(id => ({ to: biomeAreaId(id), label: biomeName(id) }));
}

export function encounterForArea(area: AreaId): TownEncounterSpec | null {
  if (area === "cave") {
    return { biomeId: BiomeId.CAVE, biasTypes: CAVE_BIAS_TYPES, biasChance: TYPE_BIAS_CHANCE };
  }
  if (area === "beach") {
    return { biomeId: BiomeId.BEACH, biasTypes: BEACH_BIAS_TYPES, biasChance: TYPE_BIAS_CHANCE };
  }
  const biomeId = biomeIdFromArea(area);
  if (biomeId == null) {
    return null;
  }
  if (biomeId === BiomeId.CAVE) {
    return { biomeId, biasTypes: CAVE_BIAS_TYPES, biasChance: TYPE_BIAS_CHANCE };
  }
  if (biomeId === BiomeId.BEACH) {
    return { biomeId, biasTypes: BEACH_BIAS_TYPES, biasChance: TYPE_BIAS_CHANCE };
  }
  return { biomeId };
}

export function setTownEncounter(spec: TownEncounterSpec | null): void {
  pending = spec;
}

export function consumeTownEncounter(): TownEncounterSpec | null {
  const spec = pending;
  pending = null;
  return spec;
}

function ensureBiomes(): void {
  if (!allBiomes.has(BiomeId.PLAINS)) {
    initBiomes();
  }
}

function ensureSpecies(): void {
  if (!speciesDataRegistry) {
    initSpeciesDataRegistry();
  }
}

/** Wild and boss species that PokeRogue can roll in this biome, every time of day. */
export function biomeSpeciesIds(biomeId: BiomeId): SpeciesId[] {
  ensureBiomes();
  const biome = allBiomes.get(biomeId);
  if (!biome) {
    return [];
  }
  const ids = new Set<SpeciesId>();
  for (const byTime of Object.values(biome.pokemonPool)) {
    for (const list of Object.values(byTime)) {
      for (const id of list) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

function wildTierSpecies(biomeId: BiomeId, tier: BiomePoolTier): SpeciesId[] {
  ensureBiomes();
  const biome = allBiomes.get(biomeId);
  if (!biome) {
    return [];
  }
  const byTime = biome.pokemonPool[tier];
  const ids = new Set<SpeciesId>();
  for (const list of Object.values(byTime)) {
    for (const id of list) {
      ids.add(id);
    }
  }
  return [...ids];
}

function tierIndex(unit: number): number {
  const value = Math.min(511, Math.max(0, Math.floor(unit * 512)));
  if (value >= 156) {
    return 0;
  }
  if (value >= 32) {
    return 1;
  }
  if (value >= 6) {
    return 2;
  }
  if (value >= 1) {
    return 3;
  }
  return 4;
}

export function speciesMatchesTypes(id: SpeciesId, types: readonly PokemonType[]): boolean {
  ensureSpecies();
  const data = speciesDataRegistry.getSpeciesData(id);
  if (!data?.species) {
    return false;
  }
  return types.some(type => data.species.isOfType(type));
}

function pickFromTiers(pools: SpeciesId[][], rng: () => number, accept: (id: SpeciesId) => boolean): SpeciesId | null {
  let index = tierIndex(rng());
  while (index > 0 && !pools[index].some(accept)) {
    index--;
  }
  const list = pools[index].filter(accept);
  if (list.length === 0) {
    return null;
  }
  const pick = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[pick] ?? null;
}

/**
 * Roll a wild species from a biome pool. Tier weights follow the field odds
 * (common through ultra rare). `rng` returns a number in `[0, 1)`.
 * When bias types are set, that fraction of rolls prefers a matching species.
 */
export function rollBiomeSpeciesId(
  biomeId: BiomeId,
  rng: () => number,
  biasTypes?: readonly PokemonType[],
  biasChance = TYPE_BIAS_CHANCE,
): SpeciesId | null {
  const pools = WILD_TIERS.map(tier => wildTierSpecies(biomeId, tier));
  if (pools.every(pool => pool.length === 0)) {
    return null;
  }
  const useBias = biasTypes !== undefined && biasTypes.length > 0 && rng() < biasChance;
  if (useBias) {
    const biased = pickFromTiers(pools, rng, id => speciesMatchesTypes(id, biasTypes));
    if (biased != null) {
      return biased;
    }
  }
  return pickFromTiers(pools, rng, () => true);
}

export function speciesFromTownEncounter(spec: TownEncounterSpec, rng: () => number): SpeciesId | null {
  return rollBiomeSpeciesId(spec.biomeId, rng, spec.biasTypes, spec.biasChance ?? TYPE_BIAS_CHANCE);
}
