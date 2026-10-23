import { AREAS, type AreaId, buildOverworld, overworldIssues, type TiledMap } from "#app/catch/town-maps";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
