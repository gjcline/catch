import {
  AREAS,
  type AreaId,
  buildOverworld,
  overworldIssues,
  type TiledMap,
  tiledFromCache,
} from "#app/catch/town-maps";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stagePublicFiles } from "../../plugins/vite/vite-minify-json-plugin";

const town = JSON.parse(readFileSync("catchcrypt/public/town/town.json", "utf8")) as TiledMap;
const areas: AreaId[] = ["town", "grove", "route1", "forest", "beach", "cave"];

describe("CatchCrypt overworld", () => {
  it("keeps Grant's level gates", () => {
    expect(AREAS.town.exits.north).toEqual({ to: "route1", level: 8 });
    expect(AREAS.town.exits.south).toEqual({ to: "beach", level: 10 });
    expect(AREAS.town.exits.east).toEqual({ to: "cave", level: 10 });
    expect(AREAS.town.exits.west).toEqual({ to: "grove", level: 0 });
    expect(AREAS.route1.exits.north).toEqual({ to: "forest", level: 8 });
    expect(AREAS.route1.exits.south).toEqual({ to: "town", level: 0 });
    expect(AREAS.forest.exits.south).toEqual({ to: "route1", level: 0 });
    expect(AREAS.grove.exits.east).toEqual({ to: "town", level: 0 });
    expect(AREAS.beach.exits.north).toEqual({ to: "town", level: 0 });
    expect(AREAS.cave.exits.west).toEqual({ to: "town", level: 0 });
  });

  it("builds a larger town and a forest the player can actually walk", () => {
    const maps = Object.fromEntries(areas.map(id => [id, buildOverworld(id, town)])) as Record<
      AreaId,
      ReturnType<typeof buildOverworld>
    >;
    expect(maps.town.w * maps.town.h).toBeGreaterThan(40 * 28);
    expect(maps.route1.w * maps.route1.h).toBeGreaterThan(30 * 22 * 4);
    expect(maps.forest.w * maps.forest.h).toBeGreaterThan(maps.route1.w * maps.route1.h);
    for (const id of areas) {
      expect(overworldIssues(id, maps[id]), id).toEqual([]);
    }
  });

  it("reads Phaser's tilemap cache entry ({ format, data })", () => {
    const parsed = tiledFromCache({ format: 1, data: town });
    expect(parsed?.width).toBe(town.width);
    expect(parsed?.layers.length).toBeGreaterThan(0);
    expect(overworldIssues("town", buildOverworld("town", parsed))).toEqual([]);
  });

  it("still builds a walkable town when town.json never loaded", () => {
    expect(tiledFromCache(undefined)).toBeNull();
    expect(tiledFromCache({ data: { layers: "nope" } })).toBeNull();
    const built = buildOverworld("town", null);
    expect(built.w * built.h).toBeGreaterThan(40 * 28);
    expect(overworldIssues("town", built)).toEqual([]);
    expect(built.labels.some(label => label.label.includes("Lv 8"))).toBe(true);
    expect(built.labels.some(label => label.label.includes("Lv 10"))).toBe(true);
  });

  it("copies town assets into the vite build output", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-town-"));
    try {
      const jsonCount = stagePublicFiles(join("catchcrypt", "public"), dir);
      expect(jsonCount).toBeGreaterThan(0);
      const staged = JSON.parse(readFileSync(join(dir, "town", "town.json"), "utf8")) as TiledMap;
      expect(staged.layers.length).toBeGreaterThan(0);
      expect(staged.width).toBe(town.width);
      expect(existsSync(join(dir, "town", "tuxmon-sample-32px-extruded.png"))).toBe(true);
      expect(existsSync(join(dir, "town", "atlas.png"))).toBe(true);
      expect(existsSync(join(dir, "town", "atlas.json"))).toBe(true);
      const parsed = tiledFromCache({ format: 1, data: staged });
      expect(overworldIssues("town", buildOverworld("town", parsed))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
