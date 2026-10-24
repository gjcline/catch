/*
 * CatchCrypt town presence wire format. AGPL-3.0.
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Numeric opcodes follow HUNT / BrowserQuest for the shared verbs.
 * REFUSE (30) is CatchCrypt-only. See presence/PROTOCOL.md.
 */

/** @typedef {"front" | "back" | "left" | "right"} Facing */

export const Op = {
  HELLO: 0,
  WELCOME: 1,
  SPAWN: 2,
  MOVE: 4,
  LIST: 16,
  LEAVE: 22,
  REFUSE: 30,
};

/** Tile counts from `src/catch/town-maps.ts` (32px tiles). */
export const AREA_TILES = {
  town: { w: 76, h: 72 },
  grove: { w: 44, h: 38 },
  route1: { w: 56, h: 80 },
  forest: { w: 64, h: 88 },
  beach: { w: 42, h: 32 },
  cave: { w: 38, h: 30 },
};

export const TILE = 32;

const FACING = new Set(["front", "back", "left", "right"]);
const NAME_CHARS = /[^\p{L}\p{N} _.'-]/gu;

/**
 * Keep this list identical to `allTownSprites()` in src/catch/town-characters.ts.
 * Unknown values fall back to the default so an old or mistaken client still joins.
 */
export const DEFAULT_SPRITE = "misa";
export const SPRITE_IDS = [
  "misa",
  "misa-rose",
  "misa-sea",
  "misa-moss",
  "misa-gold",
  "misa-dusk",
  "lark",
  "piper",
  "reed",
  "bram",
  "nico",
  "holt",
];
const SPRITE_ALLOWLIST = new Set(SPRITE_IDS);

export function sanitizeSprite(input) {
  if (typeof input === "string" && SPRITE_ALLOWLIST.has(input)) {
    return input;
  }
  return DEFAULT_SPRITE;
}

export const LIMITS = {
  /** Slightly above the client's 150px/s walk so a frame hitch still lands. */
  regenPxPerSec: 180,
  /** Largest single accepted step. Farther than this is rejected, not clamped. */
  capPx: 96,
  initialBudgetPx: 96,
  /** Flood guard. Area changes and one catch-up hello sit well under this. */
  maxHellosPerSec: 20,
};

export function areaSize(area) {
  const tiles = AREA_TILES[area];
  if (!tiles) {
    return null;
  }
  return { w: tiles.w * TILE, h: tiles.h * TILE };
}

export function inBounds(area, x, y) {
  const size = areaSize(area);
  if (!size || !Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }
  return x >= 0 && y >= 0 && x <= size.w && y <= size.h;
}

export function sanitizeName(input) {
  if (typeof input !== "string") {
    return "Guest";
  }
  const clean = input.normalize("NFKC").replace(NAME_CHARS, "").trim().slice(0, 16);
  return clean.length > 0 ? clean : "Guest";
}

/**
 * @param {unknown} raw
 * @returns {{ name: string, x: number, y: number, facing: Facing, sprite: string, area: string } | null}
 */
export function parseHello(raw) {
  if (!Array.isArray(raw) || raw.length < 7 || raw[0] !== Op.HELLO) {
    return null;
  }
  const facing = raw[4];
  const area = raw[6];
  if (
    typeof facing !== "string"
    || !FACING.has(facing)
    || typeof area !== "string"
    || !inBounds(area, raw[2], raw[3])
  ) {
    return null;
  }
  return {
    name: sanitizeName(raw[1]),
    x: raw[2],
    y: raw[3],
    facing,
    sprite: sanitizeSprite(raw[5]),
    area,
  };
}

/**
 * @param {unknown} raw
 * @returns {{ x: number, y: number, facing: Facing, area: string } | null}
 */
export function parseMove(raw) {
  if (!Array.isArray(raw) || raw.length < 5 || raw[0] !== Op.MOVE) {
    return null;
  }
  const facing = raw[3];
  const area = raw[4];
  if (
    typeof facing !== "string"
    || !FACING.has(facing)
    || typeof area !== "string"
    || !inBounds(area, raw[1], raw[2])
  ) {
    return null;
  }
  return { x: raw[1], y: raw[2], facing, area };
}

/**
 * Token bucket. Rejects a step that would exceed the budget and leaves the
 * player where they were. `state` is `{ x, y, budgetPx, budgetAt }`.
 * @returns {boolean} true when the step is stored on `state`
 */
export function attemptStep(state, x, y, now, limits = LIMITS) {
  const elapsed = Math.max(0, Math.min(now - state.budgetAt, 2000));
  const budget = Math.min(limits.capPx, state.budgetPx + (elapsed / 1000) * limits.regenPxPerSec);
  const dist = Math.hypot(x - state.x, y - state.y);
  if (dist > budget + 0.001) {
    state.budgetPx = budget;
    state.budgetAt = now;
    return false;
  }
  state.budgetPx = budget - dist;
  state.budgetAt = now;
  state.x = x;
  state.y = y;
  return true;
}
