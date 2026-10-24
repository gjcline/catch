import {
  biomeAreaId,
  biomeBgKey,
  biomeIdFromArea,
  biomeName,
  biomeSlug,
  biomeSpeciesIds,
  buildBiomeArea,
  encounterForArea,
  linkedBiomeIds,
  MAX_LINKED_BIOMES,
  noteRunBiome,
  overworldBiomeIds,
  presenceRoomId,
  resetVisitedBiomes,
  rollBiomeSpeciesId,
  speciesFromTownEncounter,
  speciesMatchesTypes,
  TYPE_BIAS_CHANCE,
  townWarpRequests,
} from "#app/catch/town-biomes";
import { buildOverworld, overworldIssues, type TiledMap } from "#app/catch/town-maps";
import { BiomeId } from "#enums/biome-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const town = JSON.parse(readFileSync("catchcrypt/public/town/town.json", "utf8")) as TiledMap;

const REQUIRED = [
  BiomeId.PLAINS,
  BiomeId.GRASS,
  BiomeId.METROPOLIS,
  BiomeId.LAKE,
  BiomeId.TALL_GRASS,
  BiomeId.FOREST,
  BiomeId.BEACH,
  BiomeId.CAVE,
  BiomeId.MOUNTAIN,
  BiomeId.SEA,
  BiomeId.SWAMP,
  BiomeId.DESERT,
  BiomeId.JUNGLE,
  BiomeId.MEADOW,
  BiomeId.SLUM,
] as const;

function rngFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("CatchCrypt biome overworld", () => {
  beforeEach(() => {
    resetVisitedBiomes();
  });

  it("maps the early biomes onto named rooms with their own presence ids", () => {
    expect(biomeName(BiomeId.PLAINS)).toBe("Plains");
    expect(biomeName(BiomeId.GRASS)).toBe("Grassy Field");
    expect(biomeName(BiomeId.METROPOLIS)).toBe("Metropolis");
    expect(biomeName(BiomeId.LAKE)).toBe("Lake");
    expect(biomeName(BiomeId.TALL_GRASS)).toBe("Tall Grass");
    expect(biomeName(BiomeId.FOREST)).toBe("Forest");
    expect(biomeName(BiomeId.BEACH)).toBe("Beach");
    expect(biomeName(BiomeId.CAVE)).toBe("Cave");
    expect(biomeName(BiomeId.MOUNTAIN)).toBe("Mountain");

    expect(biomeBgKey(BiomeId.GRASS)).toBe("grass");
    expect(biomeBgKey(BiomeId.TALL_GRASS)).toBe("tall_grass");
    expect(biomeAreaId(BiomeId.PLAINS)).toBe("biome-plains");
    expect(biomeIdFromArea("biome-grassy-field")).toBeNull();
    expect(biomeIdFromArea("biome-grass")).toBe(BiomeId.GRASS);
    expect(biomeIdFromArea("biome-tall-grass")).toBe(BiomeId.TALL_GRASS);
    expect(biomeIdFromArea("town")).toBeNull();

    const ids = overworldBiomeIds();
    expect(ids).not.toContain(BiomeId.TOWN);
    expect(ids).not.toContain(BiomeId.END);
    for (const biomeId of REQUIRED) {
      expect(ids).toContain(biomeId);
    }

    const rooms = new Set<string>(["town", "grove", "route1", "forest", "beach", "cave"]);
    for (const biomeId of ids) {
      const room = presenceRoomId(biomeAreaId(biomeId));
      expect(rooms.has(room), room).toBe(false);
      rooms.add(room);
      expect(biomeName(biomeId).length).toBeGreaterThan(0);
    }
  });

  it("builds a walkable encounter area for every early biome and links them from town", () => {
    for (const biomeId of overworldBiomeIds()) {
      const area = biomeAreaId(biomeId);
      const built = buildBiomeArea(biomeId);
      expect(overworldIssues(area, built), biomeName(biomeId)).toEqual([]);
      expect(built.labels.some(label => label.label === "Town")).toBe(true);
      expect(built.labels.some(label => label.label === biomeName(biomeId))).toBe(true);
    }

    noteRunBiome(BiomeId.TOWN);
    noteRunBiome(BiomeId.END);
    expect(townWarpRequests()).toEqual([]);

    noteRunBiome(BiomeId.PLAINS);
    noteRunBiome(BiomeId.GRASS);
    noteRunBiome(BiomeId.METROPOLIS);
    noteRunBiome(BiomeId.LAKE);
    const warps = townWarpRequests();
    expect(warps.map(warp => warp.label)).toEqual(["Plains", "Grassy Field", "Metropolis", "Lake"]);
    expect(warps.map(warp => warp.to)).toEqual(["biome-plains", "biome-grass", "biome-metropolis", "biome-lake"]);

    const linkedTown = buildOverworld("town", town, warps);
    expect(overworldIssues("town", linkedTown)).toEqual([]);
    expect(overworldIssues("town", buildOverworld("town", null, warps))).toEqual([]);

    resetVisitedBiomes();
    const many = [
      BiomeId.PLAINS,
      BiomeId.GRASS,
      BiomeId.TALL_GRASS,
      BiomeId.METROPOLIS,
      BiomeId.FOREST,
      BiomeId.SEA,
      BiomeId.SWAMP,
      BiomeId.BEACH,
      BiomeId.LAKE,
    ];
    for (const biomeId of many) {
      noteRunBiome(biomeId);
    }
    const linked = linkedBiomeIds();
    expect(linked).toHaveLength(MAX_LINKED_BIOMES);
    expect(linked).toContain(BiomeId.LAKE);
    expect(linked).not.toContain(BiomeId.PLAINS);
    expect(overworldIssues("town", buildOverworld("town", town, townWarpRequests()))).toEqual([]);
  });

  it("rolls encounter species from the biome pool, with Rock and Water or Ground bias", () => {
    const plains = biomeSpeciesIds(BiomeId.PLAINS);
    const cave = biomeSpeciesIds(BiomeId.CAVE);
    const beach = biomeSpeciesIds(BiomeId.BEACH);
    expect(plains).toContain(SpeciesId.SENTRET);
    expect(plains).toContain(SpeciesId.ZIGZAGOON);
    expect(plains).not.toContain(SpeciesId.GEODUDE);
    expect(cave).toContain(SpeciesId.GEODUDE);
    expect(beach).toContain(SpeciesId.KRABBY);

    const plainsRng = rngFrom(7);
    for (let i = 0; i < 40; i++) {
      const id = rollBiomeSpeciesId(BiomeId.PLAINS, plainsRng);
      expect(id).not.toBeNull();
      expect(plains).toContain(id);
    }

    const rockRng = rngFrom(11);
    for (let i = 0; i < 30; i++) {
      const id = rollBiomeSpeciesId(BiomeId.CAVE, rockRng, [PokemonType.ROCK], 1);
      expect(id).not.toBeNull();
      expect(speciesMatchesTypes(id!, [PokemonType.ROCK])).toBe(true);
      expect(cave).toContain(id);
    }

    const shoreRng = rngFrom(13);
    for (let i = 0; i < 30; i++) {
      const id = rollBiomeSpeciesId(BiomeId.BEACH, shoreRng, [PokemonType.WATER, PokemonType.GROUND], 1);
      expect(id).not.toBeNull();
      expect(speciesMatchesTypes(id!, [PokemonType.WATER, PokemonType.GROUND])).toBe(true);
      expect(beach).toContain(id);
    }

    expect(encounterForArea("town")).toBeNull();
    expect(encounterForArea("route1")).toBeNull();
    expect(encounterForArea("forest")).toBeNull();
    expect(encounterForArea("grove")).toBeNull();

    const caveArea = encounterForArea("cave");
    expect(caveArea).toMatchObject({ biomeId: BiomeId.CAVE, biasChance: TYPE_BIAS_CHANCE });
    expect(caveArea?.biasTypes).toEqual([PokemonType.ROCK]);

    const beachArea = encounterForArea("beach");
    expect(beachArea?.biomeId).toBe(BiomeId.BEACH);
    expect(beachArea?.biasTypes).toEqual([PokemonType.WATER, PokemonType.GROUND]);

    const grassy = encounterForArea(biomeAreaId(BiomeId.GRASS));
    expect(grassy).toEqual({ biomeId: BiomeId.GRASS });
    const rolled = speciesFromTownEncounter(grassy!, rngFrom(3));
    expect(biomeSpeciesIds(BiomeId.GRASS)).toContain(rolled);

    const caveBiome = encounterForArea(biomeAreaId(BiomeId.CAVE));
    expect(caveBiome?.biasTypes).toEqual([PokemonType.ROCK]);
    const beachBiome = encounterForArea(biomeAreaId(BiomeId.BEACH));
    expect(beachBiome?.biasTypes).toEqual([PokemonType.WATER, PokemonType.GROUND]);
  });

  it("keeps an overview image for each biome area", async () => {
    if (process.env.WRITE_BIOME_PREVIEWS === "1") {
      const { drawBiomePreviews } = await import("../../catchcrypt/scripts/draw-biome-previews");
      drawBiomePreviews();
    }
    for (const biomeId of overworldBiomeIds()) {
      const file = join("catchcrypt", "previews", "biomes", `${biomeSlug(biomeId)}.png`);
      expect(existsSync(file), file).toBe(true);
    }
  }, 120_000);
});
