/*
 * CatchCrypt town counters. AGPL-3.0.
 * A center, a mart, and a few doors to talk at. Not a full shop.
 */
import type { ShopKind, TownSpot } from "#app/catch/town-maps";

export interface TownHealMove {
  ppUsed: number;
}

export interface TownHealPokemon {
  hp: number;
  getMaxHp(): number;
  isFainted(): boolean;
  moveset: readonly (TownHealMove | null | undefined)[];
  resetStatus?(revive?: boolean, confusion?: boolean, reloadAssets?: boolean, asPhase?: boolean): void;
  updateInfo?(instant?: boolean): void;
}

/** Restore HP and PP. Fainted Pokémon stay fainted when `allowRevive` returns false. */
export function healTownParty(
  party: readonly TownHealPokemon[],
  allowRevive: (pokemon: TownHealPokemon) => boolean = () => true,
): number {
  let healed = 0;
  for (const pokemon of party) {
    if (pokemon.isFainted() && !allowRevive(pokemon)) {
      continue;
    }
    pokemon.hp = pokemon.getMaxHp();
    for (const move of pokemon.moveset) {
      if (move) {
        move.ppUsed = 0;
      }
    }
    pokemon.resetStatus?.(true, false, false, false);
    pokemon.updateInfo?.(true);
    healed++;
  }
  return healed;
}

export const martItems = [
  { id: "pokeball", name: "Poké Ball", price: 200 },
  { id: "potion", name: "Potion", price: 300 },
] as const;

export type MartItemId = (typeof martItems)[number]["id"];

/** Free samples handed out when the run has no money field. One of each item per town visit. */
export const freePerVisit = 1;

export interface TownWallet {
  /** Finite run money, or null when the run is not tracking money. */
  money: number | null;
  freeTaken: Partial<Record<MartItemId, number>>;
}

export function readMoney(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

export function martTitle(money: number | null): string {
  if (money === null) {
    return "Mart";
  }
  return `Mart  ${money}`;
}

export interface BuyQuote {
  ok: boolean;
  price: number;
  message: string;
}

export function quoteBuy(wallet: TownWallet, itemId: MartItemId): BuyQuote {
  const item = martItems.find(entry => entry.id === itemId);
  if (!item) {
    return { ok: false, price: 0, message: "The mart does not stock that." };
  }
  if (wallet.money === null) {
    const taken = wallet.freeTaken[itemId] ?? 0;
    if (taken >= freePerVisit) {
      return { ok: false, price: 0, message: `You already took a ${item.name} this visit.` };
    }
    return { ok: true, price: 0, message: `You received a ${item.name}.` };
  }
  if (wallet.money < item.price) {
    return { ok: false, price: item.price, message: `Not enough money for a ${item.name}.` };
  }
  return { ok: true, price: item.price, message: `You bought a ${item.name}.` };
}

export function commitBuy(wallet: TownWallet, itemId: MartItemId, price: number): TownWallet {
  if (wallet.money === null) {
    return {
      money: null,
      freeTaken: { ...wallet.freeTaken, [itemId]: (wallet.freeTaken[itemId] ?? 0) + 1 },
    };
  }
  return { money: wallet.money - price, freeTaken: { ...wallet.freeTaken } };
}

/**
 * Charge (or mark a free sample) only after `grant` succeeds.
 * A failed grant leaves the wallet alone.
 */
export function resolveBuy(
  wallet: TownWallet,
  itemId: MartItemId,
  grant: () => boolean,
  unavailable: string,
): { wallet: TownWallet; message: string } {
  const quote = quoteBuy(wallet, itemId);
  if (!quote.ok) {
    return { wallet, message: quote.message };
  }
  if (!grant()) {
    return { wallet, message: unavailable };
  }
  return { wallet: commitBuy(wallet, itemId, quote.price), message: quote.message };
}

/** The conscious party member missing the most HP. Potions do not revive. */
export function potionTarget<T extends TownHealPokemon>(party: readonly T[]): T | null {
  let best: T | null = null;
  let missing = 0;
  for (const mon of party) {
    if (mon.isFainted()) {
      continue;
    }
    const gap = mon.getMaxHp() - mon.hp;
    if (gap > missing) {
      missing = gap;
      best = mon;
    }
  }
  return best;
}

export interface TownMenuOption {
  id: string;
  label: string;
}

export interface TownMenu {
  spot: TownSpot;
  title: string;
  options: TownMenuOption[];
  index: number;
  line: number;
  message: string;
}

export function openTownMenu(spot: TownSpot, money: number | null): TownMenu {
  if (spot.kind === "center") {
    return {
      spot,
      title: spot.name,
      options: [
        { id: "heal", label: "Heal" },
        { id: "close", label: "Goodbye" },
      ],
      index: 0,
      line: 0,
      message: "We can restore your party's HP and PP.",
    };
  }
  if (spot.kind === "mart") {
    return {
      spot,
      title: martTitle(money),
      options: [
        ...martItems.map(item => ({
          id: item.id,
          label: money === null ? `${item.name}  free` : `${item.name}  ${item.price}`,
        })),
        { id: "close", label: "Goodbye" },
      ],
      index: 0,
      line: 0,
      message: money === null ? "One of each, on the house." : "What can I get you?",
    };
  }
  const lines = spot.lines.length > 0 ? spot.lines.slice(0, 3) : ["..."];
  return {
    spot: { ...spot, lines },
    title: spot.name,
    options: [{ id: lines.length > 1 ? "next" : "close", label: lines.length > 1 ? "Next" : "Goodbye" }],
    index: 0,
    line: 0,
    message: lines[0],
  };
}

export type TownMenuResult =
  | { type: "stay" }
  | { type: "close" }
  | { type: "heal" }
  | { type: "buy"; itemId: MartItemId };

export function moveTownMenu(menu: TownMenu, dir: -1 | 1): void {
  if (menu.options.length === 0) {
    return;
  }
  const count = menu.options.length;
  menu.index = (menu.index + dir + count) % count;
}

export function confirmTownMenu(menu: TownMenu): TownMenuResult {
  const id = menu.options[menu.index]?.id ?? "close";
  if (id === "close") {
    return { type: "close" };
  }
  if (id === "next") {
    const lines = menu.spot.lines;
    const line = Math.min(menu.line + 1, Math.max(0, lines.length - 1));
    menu.line = line;
    menu.message = lines[line] ?? "...";
    const last = line >= lines.length - 1;
    menu.options = [{ id: last ? "close" : "next", label: last ? "Goodbye" : "Next" }];
    menu.index = 0;
    return { type: "stay" };
  }
  if (id === "heal") {
    return { type: "heal" };
  }
  if (id === "pokeball" || id === "potion") {
    return { type: "buy", itemId: id };
  }
  return { type: "close" };
}

export type TownKeyAction = "close" | "leave" | "confirm" | "open" | "ignore";

/** B and Esc leave town, unless a menu is open. Space, Z, and Enter are the action key. */
export function townKeyAction(key: string, menuOpen: boolean): TownKeyAction {
  const name = key.toLowerCase();
  if (name === "b" || name === "esc" || name === "escape") {
    return menuOpen ? "close" : "leave";
  }
  if (name === " " || name === "space" || name === "spacebar" || name === "z" || name === "enter") {
    return menuOpen ? "confirm" : "open";
  }
  return "ignore";
}

/** Menus block walking and presence the same way the party screen does. */
export function townShouldMove(flags: {
  leaving: boolean;
  switching: boolean;
  partyOpen: boolean;
  menuOpen: boolean;
}): boolean {
  return !flags.leaving && !flags.switching && !flags.partyOpen && !flags.menuOpen;
}

export function pointInSpot(spot: TownSpot, x: number, y: number): boolean {
  return x >= spot.x && y >= spot.y && x < spot.x + spot.w && y < spot.y + spot.h;
}

export function spotAt(spots: readonly TownSpot[], x: number, y: number, kinds?: readonly ShopKind[]): TownSpot | null {
  for (const spot of spots) {
    if (kinds && !kinds.includes(spot.kind)) {
      continue;
    }
    if (pointInSpot(spot, x, y)) {
      return spot;
    }
  }
  return null;
}

export type WalkFacing = "front" | "back" | "left" | "right";

/** Center of the tile in front of the player's feet. */
export function tileAhead(x: number, y: number, facing: WalkFacing): { x: number; y: number } {
  const tx = Math.floor(x / 32);
  const ty = Math.floor((y + 14) / 32);
  let dx = 0;
  let dy = 1;
  if (facing === "back") {
    dy = -1;
  } else if (facing === "left") {
    dx = -1;
    dy = 0;
  } else if (facing === "right") {
    dx = 1;
    dy = 0;
  }
  return { x: (tx + dx) * 32 + 16, y: (ty + dy) * 32 + 16 };
}

const doorKinds = ["center", "mart", "house"] as const satisfies readonly ShopKind[];

export function doorUnderFeet(spots: readonly TownSpot[], x: number, y: number): TownSpot | null {
  return spotAt(spots, x, y + 14, doorKinds);
}

export function spotForAction(spots: readonly TownSpot[], x: number, y: number, facing: WalkFacing): TownSpot | null {
  const under = spotAt(spots, x, y + 14);
  if (under) {
    return under;
  }
  const ahead = tileAhead(x, y, facing);
  return spotAt(spots, ahead.x, ahead.y);
}
