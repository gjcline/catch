import { buildOverworld, overworldIssues, spotsFromTiled, type TiledMap } from "#app/catch/town-maps";
import {
  commitBuy,
  confirmTownMenu,
  doorUnderFeet,
  freePerVisit,
  healTownParty,
  martItems,
  moveTownMenu,
  openTownMenu,
  potionTarget,
  quoteBuy,
  readMoney,
  resolveBuy,
  spotAt,
  spotForAction,
  type TownHealPokemon,
  tileAhead,
  townKeyAction,
  townShouldMove,
} from "#app/catch/town-shops";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const town = JSON.parse(readFileSync("catchcrypt/public/town/town.json", "utf8")) as TiledMap;

function mon(hp: number, maxHp: number, ppUsed: number[], fainted = false): TownHealPokemon {
  return {
    hp,
    getMaxHp: () => maxHp,
    isFainted: () => fainted || hp <= 0,
    moveset: ppUsed.map(used => ({ ppUsed: used })),
    resetStatus() {
      this.hp = this.getMaxHp();
    },
  };
}

describe("CatchCrypt town shops", () => {
  it("heals HP and PP, and can leave a fainted Pokémon down", () => {
    const healthy = mon(4, 20, [3, 0]);
    const fainted = mon(0, 18, [5], true);
    const healed = healTownParty([healthy, fainted], pokemon => !pokemon.isFainted());
    expect(healed).toBe(1);
    expect(healthy.hp).toBe(20);
    expect(healthy.moveset.map(move => move?.ppUsed)).toEqual([0, 0]);
    expect(fainted.hp).toBe(0);
    expect(fainted.moveset[0]?.ppUsed).toBe(5);

    const revived = mon(0, 18, [2], true);
    expect(healTownParty([revived])).toBe(1);
    expect(revived.hp).toBe(18);
    expect(revived.moveset[0]?.ppUsed).toBe(0);
  });

  it("charges run money, and gives one free sample of each item when money is absent", () => {
    expect(readMoney(undefined)).toBeNull();
    expect(readMoney(Number.NaN)).toBeNull();
    expect(readMoney(0)).toBe(0);

    const broke = quoteBuy({ money: 100, freeTaken: {} }, "pokeball");
    expect(broke.ok).toBe(false);
    expect(broke.message).toMatch(/Not enough money/);

    const priced = quoteBuy({ money: 1000, freeTaken: {} }, "potion");
    expect(priced).toMatchObject({ ok: true, price: 300 });
    expect(commitBuy({ money: 1000, freeTaken: {} }, "potion", priced.price).money).toBe(700);

    const wallet = { money: null, freeTaken: {} };
    const first = resolveBuy(wallet, "pokeball", () => true, "out");
    expect(first.message).toMatch(/received a Poké Ball/);
    expect(first.wallet.freeTaken.pokeball).toBe(1);
    const second = resolveBuy(first.wallet, "pokeball", () => true, "out");
    expect(second.message).toMatch(/already took/);
    expect(second.wallet.freeTaken.pokeball).toBe(freePerVisit);
    const other = resolveBuy(second.wallet, "potion", () => false, "out");
    expect(other.message).toBe("out");
    expect(other.wallet.freeTaken.potion).toBeUndefined();
  });

  it("picks the conscious Pokémon missing the most HP", () => {
    const lead = mon(10, 20, []);
    const hurt = mon(1, 30, []);
    const fainted = mon(0, 40, [], true);
    expect(potionTarget([lead, fainted, hurt])).toBe(hurt);
    expect(potionTarget([mon(20, 20, [])])).toBeNull();
  });

  it("walks a center menu, a mart purchase, and three lines of talk", () => {
    const center = openTownMenu(
      { id: "center", kind: "center", name: "Poké Center", x: 0, y: 0, w: 32, h: 32, lines: [] },
      500,
    );
    expect(confirmTownMenu(center)).toEqual({ type: "heal" });
    moveTownMenu(center, 1);
    expect(confirmTownMenu(center)).toEqual({ type: "close" });

    const mart = openTownMenu({ id: "mart", kind: "mart", name: "Mart", x: 0, y: 0, w: 32, h: 32, lines: [] }, null);
    expect(mart.options.map(option => option.id)).toEqual(["pokeball", "potion", "close"]);
    expect(mart.options[0]?.label).toMatch(/free/);
    expect(confirmTownMenu(mart)).toEqual({ type: "buy", itemId: "pokeball" });

    const talk = openTownMenu(
      {
        id: "house",
        kind: "house",
        name: "House",
        x: 0,
        y: 0,
        w: 32,
        h: 32,
        lines: ["One.", "Two.", "Three.", "Dropped."],
      },
      0,
    );
    expect(talk.spot.lines).toEqual(["One.", "Two.", "Three."]);
    expect(confirmTownMenu(talk).type).toBe("stay");
    expect(talk.message).toBe("Two.");
    expect(confirmTownMenu(talk).type).toBe("stay");
    expect(talk.message).toBe("Three.");
    expect(confirmTownMenu(talk)).toEqual({ type: "close" });
  });

  it("closes a menu with B or Esc and does not walk or send presence while it is open", () => {
    expect(townKeyAction("b", false)).toBe("leave");
    expect(townKeyAction("Escape", false)).toBe("leave");
    expect(townKeyAction("b", true)).toBe("close");
    expect(townKeyAction("esc", true)).toBe("close");
    expect(townKeyAction("space", true)).toBe("confirm");
    expect(townKeyAction("z", false)).toBe("open");
    expect(townKeyAction("enter", false)).toBe("open");
    expect(townKeyAction("p", true)).toBe("ignore");
    expect(townShouldMove({ leaving: false, switching: false, partyOpen: false, menuOpen: false })).toBe(true);
    expect(townShouldMove({ leaving: false, switching: false, partyOpen: true, menuOpen: false })).toBe(false);
    expect(townShouldMove({ leaving: false, switching: false, partyOpen: false, menuOpen: true })).toBe(false);
    expect(
      townShouldMove({ leaving: false, switching: false, partyOpen: false, menuOpen: false, pickerOpen: true }),
    ).toBe(false);
  });

  it("puts walkable doors and solid people on the town map", () => {
    const built = buildOverworld("town", town);
    expect(overworldIssues("town", built)).toEqual([]);
    const kinds = built.spots.map(spot => spot.kind);
    expect(kinds).toContain("center");
    expect(kinds).toContain("mart");
    expect(kinds.filter(kind => kind === "house").length).toBeGreaterThanOrEqual(1);
    expect(kinds.filter(kind => kind === "npc").length).toBeGreaterThanOrEqual(1);

    for (const spot of built.spots) {
      const tx = Math.floor((spot.x + spot.w / 2) / 32);
      const ty = Math.floor((spot.y + spot.h / 2) / 32);
      if (spot.kind === "npc") {
        expect(built.solid[ty]?.[tx], spot.name).toBe(true);
        expect(built.solid[ty + 1]?.[tx], `${spot.name} south`).toBe(false);
        const playerX = tx * 32 + 16;
        const playerY = (ty + 1) * 32 + 16;
        const ahead = tileAhead(playerX, playerY, "back");
        expect(spotAt(built.spots, ahead.x, ahead.y, ["npc"])?.id).toBe(spot.id);
        expect(spot.lines.length).toBeGreaterThanOrEqual(1);
        expect(spot.lines.length).toBeLessThanOrEqual(3);
        continue;
      }
      expect(built.solid[ty]?.[tx], spot.name).toBe(false);
      expect(built.grass[ty]?.[tx], spot.name).toBe(false);
      expect(doorUnderFeet(built.spots, tx * 32 + 16, ty * 32 + 2)?.id).toBe(spot.id);
      if (spot.kind === "house") {
        expect(spot.lines.length).toBeGreaterThanOrEqual(1);
        expect(spot.lines.length).toBeLessThanOrEqual(3);
      }
    }

    const center = built.spots.find(spot => spot.kind === "center");
    expect(center).toBeTruthy();
    if (center) {
      const tx = Math.floor(center.x / 32);
      const ty = Math.floor((center.y + center.h / 2) / 32);
      const facing = spotForAction(built.spots, tx * 32 + 16, (ty + 1) * 32 + 16, "back");
      expect(facing?.kind).toBe("center");
    }

    const fallback = buildOverworld("town", null);
    expect(overworldIssues("town", fallback)).toEqual([]);
    expect(fallback.spots.map(spot => spot.kind).sort()).toEqual(["center", "house", "mart", "npc"]);
    expect(buildOverworld("grove", town).spots).toEqual([]);
  });

  it("reads shop objects and keeps talk lines to three", () => {
    const parsed = spotsFromTiled(
      {
        width: 4,
        height: 4,
        tilesets: [],
        layers: [
          {
            name: "Doors",
            type: "objectgroup",
            objects: [
              {
                id: 3,
                name: "Mart",
                type: "mart",
                x: 8,
                y: 16,
                width: 32,
                height: 32,
                properties: [
                  { name: "shop", type: "string", value: "mart" },
                  { name: "lines", type: "string", value: "a\nb\nc\nd" },
                ],
              },
            ],
          },
        ],
      },
      64,
      32,
    );
    expect(parsed).toEqual([
      {
        id: "mart-3",
        kind: "mart",
        name: "Mart",
        x: 72,
        y: 48,
        w: 32,
        h: 32,
        lines: ["a", "b", "c"],
      },
    ]);
    expect(martItems.map(item => item.id)).toEqual(["pokeball", "potion"]);
  });

  it("keeps shop copy free of off-brand wording", () => {
    const files = [
      "src/catch/town-shops.ts",
      "src/catch/town-scene.ts",
      "src/catch/town-characters.ts",
      "src/catch/town-maps.ts",
      "catchcrypt/public/town/town.json",
    ];
    const text = files.map(file => readFileSync(file, "utf8")).join("\n");
    expect(text.toLowerCase()).not.toContain("discord");
    expect(text.toLowerCase()).not.toContain("telegram");
    expect(text.toLowerCase()).not.toContain("roguelite");
  });
});
