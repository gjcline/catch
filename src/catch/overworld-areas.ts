/**
 * Tile sizes for every between-wave presence room. AGPL-3.0.
 * The catalog lives in `presence/area-tiles.json` because that service
 * deploys from the `presence/` directory on its own. Map builders read it
 * here so a room's footprint cannot disagree with the server bounds.
 */

import catalog from "../../presence/area-tiles.json";

export interface AreaTiles {
  w: number;
  h: number;
}

export const TILE = catalog.tile;
export const BIOME_PREFIX = catalog.biomePrefix as "biome-";
export const CORE_AREA_TILES: Record<string, AreaTiles> = catalog.core;
export const LAYOUT_TILES: Record<string, AreaTiles> = catalog.layouts;
export const BIOME_LAYOUTS: Record<string, string> = catalog.biomes;

export function layoutTiles(layout: string): AreaTiles {
  const size = LAYOUT_TILES[layout];
  if (!size) {
    throw new Error(`Unknown overworld layout ${layout}`);
  }
  return size;
}

export function biomeLayout(slug: string): string | null {
  return BIOME_LAYOUTS[slug] ?? null;
}

/** Every presence room id and its size in tiles. */
export function areaTiles(): Record<string, AreaTiles> {
  const tiles: Record<string, AreaTiles> = { ...CORE_AREA_TILES };
  for (const [slug, layout] of Object.entries(BIOME_LAYOUTS)) {
    tiles[`${BIOME_PREFIX}${slug}`] = layoutTiles(layout);
  }
  return tiles;
}
