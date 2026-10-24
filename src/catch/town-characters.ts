/*
 * CatchCrypt town character choices. AGPL-3.0.
 * The only overworld walk sheet in the repo is the misa atlas. Rose, Sea, Moss,
 * Gold, and Dusk are recolors of that sheet (skin and outlines stay). Each one
 * uses the same four-direction walk frames.
 */
import type { Facing } from "#app/catch/town-presence";

export const DEFAULT_TOWN_SPRITE = "misa";

export interface TownCharacter {
  id: string;
  name: string;
  /** Image file under `catchcrypt/public/town/`, packed with atlas.json. */
  file: string;
}

export const townCharacters = [
  { id: "misa", name: "Misa", file: "atlas.png" },
  { id: "misa-rose", name: "Rose", file: "atlas-rose.png" },
  { id: "misa-sea", name: "Sea", file: "atlas-sea.png" },
  { id: "misa-moss", name: "Moss", file: "atlas-moss.png" },
  { id: "misa-gold", name: "Gold", file: "atlas-gold.png" },
  { id: "misa-dusk", name: "Dusk", file: "atlas-dusk.png" },
] as const satisfies readonly TownCharacter[];

export type TownSpriteId = (typeof townCharacters)[number]["id"];

const FACINGS = ["front", "back", "left", "right"] as const satisfies readonly Facing[];

export function townFacings(): readonly Facing[] {
  return FACINGS;
}

/** Unknown ids, including anything an older server might echo, draw as Misa. */
export function resolveTownSprite(id: unknown): TownSpriteId {
  if (typeof id === "string") {
    const found = townCharacters.find(character => character.id === id);
    if (found) {
      return found.id;
    }
  }
  return DEFAULT_TOWN_SPRITE;
}

export function townCharacter(id: unknown): TownCharacter {
  const resolved = resolveTownSprite(id);
  return townCharacters.find(character => character.id === resolved) ?? townCharacters[0];
}

/** Phaser texture key. The original sheet keeps the key the town already used. */
export function playerAtlasKey(id: unknown): string {
  const resolved = resolveTownSprite(id);
  return resolved === DEFAULT_TOWN_SPRITE ? "cc_player" : `cc_player_${resolved}`;
}

export function idleFrame(facing: Facing): string {
  return `misa-${facing}`;
}

export function walkFramePrefix(facing: Facing): string {
  return `misa-${facing}-walk.`;
}

export function walkAnimKey(id: unknown, facing: Facing): string {
  return `cc-${resolveTownSprite(id)}-${facing}`;
}

export interface SpriteStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Per-account key. A missing username shares the guest slot. */
export function spriteStorageKey(account: string | null | undefined): string {
  const name = typeof account === "string" ? account.trim() : "";
  return `cc_town_sprite_${name.length > 0 ? name : "guest"}`;
}

function browserStore(): SpriteStore | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

export function loadTownSprite(account: string | null | undefined, store?: SpriteStore | null): TownSpriteId {
  const box = store === undefined ? browserStore() : store;
  if (!box) {
    return DEFAULT_TOWN_SPRITE;
  }
  try {
    return resolveTownSprite(box.getItem(spriteStorageKey(account)));
  } catch {
    return DEFAULT_TOWN_SPRITE;
  }
}

/** Writes the allowlisted id. An unknown choice is saved as the default. */
export function saveTownSprite(
  account: string | null | undefined,
  sprite: unknown,
  store?: SpriteStore | null,
): TownSpriteId {
  const id = resolveTownSprite(sprite);
  const box = store === undefined ? browserStore() : store;
  if (!box) {
    return id;
  }
  try {
    box.setItem(spriteStorageKey(account), id);
  } catch {
    // Private browsing can reject writes. The in-memory choice still applies.
  }
  return id;
}

export interface CharacterPickerState {
  index: number;
}

export function openCharacterPicker(currentId: unknown): CharacterPickerState {
  const id = resolveTownSprite(currentId);
  const index = townCharacters.findIndex(character => character.id === id);
  return { index: index < 0 ? 0 : index };
}

export function moveCharacterPicker(picker: CharacterPickerState, dir: -1 | 1): void {
  const count = townCharacters.length;
  picker.index = (picker.index + dir + count) % count;
}

export function selectedTownCharacter(picker: CharacterPickerState): TownCharacter {
  return townCharacters[picker.index] ?? townCharacters[0];
}

export type CharacterPickerAction = "close" | "confirm" | "prev" | "next" | "ignore";

/** B and Esc close the picker. Arrows and WASD move the highlight. Space, Z, and Enter confirm. */
export function characterPickerKey(key: string): CharacterPickerAction {
  const name = key.toLowerCase();
  if (name === "b" || name === "esc" || name === "escape") {
    return "close";
  }
  if (name === " " || name === "space" || name === "spacebar" || name === "z" || name === "enter") {
    return "confirm";
  }
  if (name === "arrowleft" || name === "left" || name === "a" || name === "arrowup" || name === "up" || name === "w") {
    return "prev";
  }
  if (
    name === "arrowright"
    || name === "right"
    || name === "d"
    || name === "arrowdown"
    || name === "down"
    || name === "s"
  ) {
    return "next";
  }
  return "ignore";
}
