/*
 * CatchCrypt town character choices. AGPL-3.0.
 * Misa is the original sheet. Rose, Sea, Moss, Gold, and Dusk are recolors of her.
 * Lark, Piper, Reed, Bram, Nico, and Holt are original pixel art in the same frame layout.
 */
import type { Facing } from "#app/catch/town-presence";

export const DEFAULT_TOWN_SPRITE = "misa";

export interface TownCharacter {
  id: string;
  name: string;
  /** Image file under `catchcrypt/public/town/`, packed with atlas.json. */
  file: string;
  gender: "female" | "male";
}

/** Color variants of Misa. They share her silhouette. */
export const misaVariants = [
  { id: "misa", name: "Misa", file: "atlas.png" },
  { id: "misa-rose", name: "Rose", file: "atlas-rose.png" },
  { id: "misa-sea", name: "Sea", file: "atlas-sea.png" },
  { id: "misa-moss", name: "Moss", file: "atlas-moss.png" },
  { id: "misa-gold", name: "Gold", file: "atlas-gold.png" },
  { id: "misa-dusk", name: "Dusk", file: "atlas-dusk.png" },
] as const;

/** People in the picker. Recolors of Misa are not separate people. */
export const townCharacters = [
  { id: "misa", name: "Misa", file: "atlas.png", gender: "female" },
  { id: "lark", name: "Lark", file: "atlas-lark.png", gender: "female" },
  { id: "piper", name: "Piper", file: "atlas-piper.png", gender: "female" },
  { id: "reed", name: "Reed", file: "atlas-reed.png", gender: "male" },
  { id: "bram", name: "Bram", file: "atlas-bram.png", gender: "male" },
  { id: "nico", name: "Nico", file: "atlas-nico.png", gender: "male" },
  { id: "holt", name: "Holt", file: "atlas-holt.png", gender: "male" },
] as const satisfies readonly TownCharacter[];

export type TownSpriteId = (typeof misaVariants)[number]["id"] | (typeof townCharacters)[number]["id"];

/** Every id the client may send. Misa's colors first, then the other people. */
export function allTownSprites(): readonly { id: TownSpriteId; name: string; file: string }[] {
  const sprites: { id: TownSpriteId; name: string; file: string }[] = [];
  for (const variant of misaVariants) {
    sprites.push(variant);
  }
  for (const character of townCharacters) {
    if (character.id === "misa") {
      continue;
    }
    sprites.push(character);
  }
  return sprites;
}

const FACINGS = ["front", "back", "left", "right"] as const satisfies readonly Facing[];

export function townFacings(): readonly Facing[] {
  return FACINGS;
}

/** Unknown ids, including anything an older server might echo, draw as Misa. */
export function resolveTownSprite(id: unknown): TownSpriteId {
  if (typeof id === "string" && allTownSprites().some(sprite => sprite.id === id)) {
    return id as TownSpriteId;
  }
  return DEFAULT_TOWN_SPRITE;
}

export function townCharacter(id: unknown): TownCharacter {
  const resolved = resolveTownSprite(id);
  const variant = misaVariants.find(sprite => sprite.id === resolved);
  if (variant) {
    return townCharacters[0];
  }
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
  variant: number;
}

export function openCharacterPicker(currentId: unknown): CharacterPickerState {
  const id = resolveTownSprite(currentId);
  const variant = misaVariants.findIndex(sprite => sprite.id === id);
  if (variant >= 0) {
    return { index: 0, variant };
  }
  const index = townCharacters.findIndex(character => character.id === id);
  return { index: index < 0 ? 0 : index, variant: 0 };
}

export function moveCharacterPicker(picker: CharacterPickerState, dir: -1 | 1): void {
  const count = townCharacters.length;
  picker.index = (picker.index + dir + count) % count;
  picker.variant = 0;
}

/** Up and down cycle Misa's colors. Other people have no recolors. */
export function moveMisaVariant(picker: CharacterPickerState, dir: -1 | 1): void {
  if (townCharacters[picker.index]?.id !== "misa") {
    return;
  }
  const count = misaVariants.length;
  picker.variant = (picker.variant + dir + count) % count;
}

export function selectedTownCharacter(picker: CharacterPickerState): { id: TownSpriteId; name: string; file: string } {
  const body = townCharacters[picker.index] ?? townCharacters[0];
  if (body.id === "misa") {
    return misaVariants[picker.variant] ?? misaVariants[0];
  }
  return body;
}

export function previewCaption(picker: CharacterPickerState): string {
  const body = townCharacters[picker.index] ?? townCharacters[0];
  const selected = selectedTownCharacter(picker);
  if (body.id === "misa" && selected.id !== "misa") {
    return `Misa · ${selected.name}`;
  }
  return body.name;
}

export type CharacterPickerAction = "close" | "confirm" | "prev" | "next" | "variant-prev" | "variant-next" | "ignore";

/** B and Esc close the picker. Left and right change person. Up and down recolor Misa. */
export function characterPickerKey(key: string): CharacterPickerAction {
  const name = key.toLowerCase();
  if (name === "b" || name === "esc" || name === "escape") {
    return "close";
  }
  if (name === " " || name === "space" || name === "spacebar" || name === "z" || name === "enter") {
    return "confirm";
  }
  if (name === "arrowleft" || name === "left" || name === "a") {
    return "prev";
  }
  if (name === "arrowright" || name === "right" || name === "d") {
    return "next";
  }
  if (name === "arrowup" || name === "up" || name === "w") {
    return "variant-prev";
  }
  if (name === "arrowdown" || name === "down" || name === "s") {
    return "variant-next";
  }
  return "ignore";
}
