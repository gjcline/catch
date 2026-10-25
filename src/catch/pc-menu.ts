/*
 * CatchCrypt PC terminal menu inside the Poké Center. AGPL-3.0.
 * Reuses the town menu (title, message, option list) so keyboard, controller and
 * the touch overlay all work without a new UI.
 */

import { PC_BOX_SIZE, PC_CAPACITY, pcCount, pcState } from "#app/catch/pc-state";
import { depositPokemon, pcEntryName, swapPokemon, withdrawPokemon } from "#app/catch/pc-storage";
import type { TownMenu, TownMenuOption } from "#app/catch/town-shops";
import { PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import { globalScene } from "#app/global-scene";

/** Box entries per page. Keeps the panel short enough for phones. */
export const PC_PAGE_SIZE = 5;

function partyLabel(index: number): string {
  const mon = globalScene.getPlayerParty()[index];
  if (!mon) {
    return "?";
  }
  const fainted = mon.isFainted() ? "  (fainted)" : "";
  return `${mon.getNameToRender()}  Lv${mon.level}${fainted}`;
}

function title(): string {
  return `PC  ${pcCount()}/${PC_CAPACITY}`;
}

function setOptions(menu: TownMenu, options: TownMenuOption[], message?: string) {
  menu.title = title();
  menu.options = options;
  menu.index = 0;
  if (message !== undefined) {
    menu.message = message;
  }
}

export function pcRoot(menu: TownMenu, message?: string) {
  const party = globalScene.getPlayerParty().length;
  setOptions(
    menu,
    [
      { id: "pc:withdraw:0", label: `Withdraw  (${pcCount()} stored)` },
      { id: "pc:deposit", label: `Deposit  (${party}/${PLAYER_PARTY_MAX_SIZE} in party)` },
      { id: "pc:exit", label: "Log off" },
    ],
    message ?? `Your party holds ${PLAYER_PARTY_MAX_SIZE}. Everyone else waits here.`,
  );
}

function depositList(menu: TownMenu, message?: string) {
  const party = globalScene.getPlayerParty();
  setOptions(
    menu,
    [...party.map((_, i) => ({ id: `pc:dep:${i}`, label: partyLabel(i) })), { id: "pc:root", label: "Back" }],
    message ?? "Store which Pokémon?",
  );
}

function withdrawList(menu: TownMenu, page: number, message?: string) {
  const total = pcCount();
  if (total === 0) {
    pcRoot(menu, "The PC is empty.");
    return;
  }
  const pages = Math.max(1, Math.ceil(total / PC_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = p * PC_PAGE_SIZE;
  const options: TownMenuOption[] = [];
  for (let i = start; i < Math.min(total, start + PC_PAGE_SIZE); i++) {
    options.push({
      id: `pc:take:${i}:${p}`,
      label: `${Math.floor(i / PC_BOX_SIZE) + 1}-${(i % PC_BOX_SIZE) + 1}  ${pcEntryName(i)}`,
    });
  }
  if (pages > 1) {
    options.push({ id: `pc:withdraw:${(p + 1) % pages}`, label: `Next page  (${p + 1}/${pages})` });
  }
  options.push({ id: "pc:root", label: "Back" });
  const full = globalScene.getPlayerParty().length >= PLAYER_PARTY_MAX_SIZE;
  setOptions(menu, options, message ?? (full ? "Party is full. Pick one to swap in." : "Take which Pokémon?"));
}

function swapList(menu: TownMenu, boxIndex: number, page: number) {
  const party = globalScene.getPlayerParty();
  setOptions(
    menu,
    [
      ...party.map((_, i) => ({ id: `pc:swap:${i}:${boxIndex}:${page}`, label: partyLabel(i) })),
      { id: `pc:withdraw:${page}`, label: "Back" },
    ],
    `Swap ${pcEntryName(boxIndex)} with who?`,
  );
}

/** Returns false when the player logs off (menu goes back to the nurse). */
export async function pcStep(menu: TownMenu, id: string): Promise<boolean> {
  const parts = id.split(":");
  const action = parts[1] ?? "root";
  const num = (i: number) => Number.parseInt(parts[i] ?? "0", 10) || 0;
  switch (action) {
    case "exit":
      return false;
    case "deposit":
      depositList(menu);
      return true;
    case "dep": {
      const result = depositPokemon(num(2));
      depositList(menu, result.message);
      return true;
    }
    case "withdraw":
      withdrawList(menu, num(2));
      return true;
    case "take": {
      const boxIndex = num(2);
      const page = num(3);
      if (globalScene.getPlayerParty().length >= PLAYER_PARTY_MAX_SIZE) {
        swapList(menu, boxIndex, page);
        return true;
      }
      const result = await withdrawPokemon(boxIndex);
      withdrawList(menu, page, result.message);
      return true;
    }
    case "swap": {
      const result = await swapPokemon(num(2), num(3));
      withdrawList(menu, num(4), result.message);
      return true;
    }
    default:
      pcRoot(menu);
      return true;
  }
}

/** Exposed for tests and the preview harness. */
export function pcSnapshot() {
  return { count: pcState.entries.length, party: globalScene.getPlayerParty().length };
}
