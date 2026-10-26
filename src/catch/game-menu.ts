/*
 * CatchCrypt in-town game menu: Save, Leaderboard, My Cards, Settings, Quit to Title. AGPL-3.0.
 * Uses the town's own menu panel (desktop Phaser panel, touch DOM sheet) so it looks like the rest of the town.
 */
import { loggedInUser } from "#app/account";
import type { TownSpot } from "#app/catch/town-maps";
import type { TownMenu } from "#app/catch/town-shops";
import { globalScene } from "#app/global-scene";
import { bypassLogin } from "#constants/app-constants";

export const GAME_MENU_ID = "cc-game-menu";

export const GAME_MENU_LABELS = {
  button: "Menu",
  title: "Menu",
  message: "Your progress saves to your account.",
  save: "Save",
  leaderboard: "Leaderboard",
  cards: "My Cards",
  settings: "Settings",
  quit: "Quit to Title",
  close: "Close",
  saved: "Game saved",
  savedLocal: "Game saved on this device",
  saveFailed: "Could not save. Check your connection and try again.",
  saving: "Saving...",
} as const;

const spot: TownSpot = {
  id: GAME_MENU_ID,
  kind: "house",
  name: GAME_MENU_LABELS.title,
  x: -1,
  y: -1,
  w: 0,
  h: 0,
  lines: [],
};

export function openGameMenu(): TownMenu {
  return {
    spot,
    title: GAME_MENU_LABELS.title,
    options: [
      { id: "gm:save", label: GAME_MENU_LABELS.save },
      { id: "gm:leaderboard", label: GAME_MENU_LABELS.leaderboard },
      { id: "gm:cards", label: GAME_MENU_LABELS.cards },
      { id: "gm:settings", label: GAME_MENU_LABELS.settings },
      { id: "gm:quit", label: GAME_MENU_LABELS.quit },
      { id: "gm:close", label: GAME_MENU_LABELS.close },
    ],
    index: 0,
    line: 0,
    message: GAME_MENU_LABELS.message,
  };
}

export function isGameMenu(menu: TownMenu | null | undefined): boolean {
  return menu?.spot.id === GAME_MENU_ID;
}

/** True while a CatchCrypt DOM overlay (leaderboard, cards, wallet) covers the town. */
export function domOverlayOpen(doc: Document = document): boolean {
  return !!(doc.getElementById("cc-leaderboard") || doc.getElementById("cc-claims") || doc.getElementById("cc-wallet"));
}

/** Signed-in players (not offline/local) sync to the server right away. */
export function shouldSyncNow(): boolean {
  return !bypassLogin && !!loggedInUser?.username;
}

/**
 * The game's own save path. `sync` forces the server write now instead of waiting for the
 * every-5-waves sync. Resolves true only when the save really landed.
 */
export async function saveGameNow(): Promise<{ ok: boolean; synced: boolean }> {
  const sync = shouldSyncNow();
  try {
    const ok = await globalScene.gameData.saveAll(true, sync);
    return { ok: ok === true, synced: sync };
  } catch (err) {
    console.error("CatchCrypt: save failed", err);
    return { ok: false, synced: sync };
  }
}

const TOAST_COLORS = {
  ok: { bg: "#2f6b4a", border: "#7dcea0" },
  error: { bg: "#b3261e", border: "#ff8f8f" },
  info: { bg: "#1b2440", border: "#6ec1ff" },
} as const;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Small centered toast above the canvas. Works with mouse and touch layouts. */
export function showToast(
  text: string,
  kind: "ok" | "error" | "info" = "ok",
  ms = 2600,
  doc: Document = document,
): void {
  let el = doc.getElementById("cc-toast");
  if (!el) {
    el = doc.createElement("div");
    el.id = "cc-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    doc.body.append(el);
  }
  el.textContent = text;
  el.dataset.kind = kind;
  el.style.cssText = [
    "position:fixed",
    "left:50%",
    "top:calc(env(safe-area-inset-top, 0px) + 64px)",
    "transform:translateX(-50%)",
    "z-index:10050",
    "max-width:min(90vw, 420px)",
    "padding:12px 20px",
    "border-radius:10px",
    "font-family:emerald, monospace",
    "font-size:22px",
    "line-height:1.2",
    "text-align:center",
    "color:#fff",
    "pointer-events:none",
    "box-shadow:0 4px 14px #0008",
    `background:${TOAST_COLORS[kind].bg}`,
    `border:3px solid ${TOAST_COLORS[kind].border}`,
  ].join(";");
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => doc.getElementById("cc-toast")?.remove(), ms);
}
