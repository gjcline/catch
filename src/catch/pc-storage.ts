/*
 * CatchCrypt PC storage. AGPL-3.0.
 * Extra Pokémon live here, outside the party of 6. The box is part of the run's
 * session save (`pcBox`), so it syncs to the server with the party. Saves without
 * the field load with an empty box.
 */

import { clearPcState, PC_CAPACITY, type PcEntryState, pcIsFull, pcState } from "#app/catch/pc-state";
import { PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
// biome-ignore lint/performance/noNamespaceImport: dynamic modifier class lookup, same as game-data
import * as Modifier from "#modifiers/modifier";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { ModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";

export interface PcSaveData {
  version: 1;
  entries: PcEntryState[];
}

export interface PcResult {
  ok: boolean;
  message: string;
}

/** Undefined while the box is empty, so saves from players who never use it stay unchanged. */
export function serializePc(): PcSaveData | undefined {
  if (pcState.entries.length === 0) {
    return undefined;
  }
  return {
    version: 1,
    entries: pcState.entries.map(e => ({ pokemon: e.pokemon, items: e.items })),
  };
}

/** Tolerates a missing, old, or damaged field. Anything that does not parse is dropped. */
export function restorePc(raw: unknown): void {
  clearPcState();
  const entries = (raw as PcSaveData | undefined)?.entries;
  if (!Array.isArray(entries)) {
    return;
  }
  for (const entry of entries.slice(0, PC_CAPACITY)) {
    if (!entry || typeof entry !== "object" || !entry.pokemon || typeof entry.pokemon !== "object") {
      continue;
    }
    pcState.entries.push({
      pokemon: JSON.parse(JSON.stringify(entry.pokemon)),
      items: Array.isArray(entry.items) ? entry.items : [],
    });
  }
}

export function pcEntryName(index: number): string {
  const data = pcState.entries[index]?.pokemon;
  if (!data) {
    return "?";
  }
  try {
    const mon = new PokemonData(data);
    const name = mon.nickname ? decodeNickname(mon.nickname) : speciesName(mon);
    return `${name}  Lv${mon.level}`;
  } catch {
    return "?";
  }
}

function speciesName(data: PokemonData): string {
  try {
    return speciesDataRegistry.getSpecies(data.species).name;
  } catch {
    return `#${data.species}`;
  }
}

function decodeNickname(nick: string): string {
  try {
    return decodeURIComponent(escape(atob(nick)));
  } catch {
    return nick;
  }
}

function serializeHeldItems(pokemonId: number, enemy = false): ModifierData[] {
  return globalScene
    .findModifiers(
      m => m instanceof PokemonHeldItemModifier && (m as PokemonHeldItemModifier).pokemonId === pokemonId,
      !enemy,
    )
    .map(m => JSON.parse(JSON.stringify(new ModifierData(m, true))));
}

function removeHeldItems(pokemonId: number): void {
  globalScene.modifiers = globalScene.modifiers.filter(
    m => !(m instanceof PokemonHeldItemModifier && (m as PokemonHeldItemModifier).pokemonId === pokemonId),
  );
}

/** A freshly caught Pokémon goes straight to the box. Keeps any held items it was carrying. */
export function sendCaughtToPc(caught: Pokemon, asPlayer: PlayerPokemon): PcResult {
  if (pcIsFull()) {
    return { ok: false, message: "The PC is full." };
  }
  const items = serializeHeldItems(caught.id, true).map(item => {
    item.args = [asPlayer.id, ...(item.args ?? []).slice(1)];
    return item;
  });
  pcState.entries.push({ pokemon: JSON.parse(JSON.stringify(new PokemonData(asPlayer))), items });
  return { ok: true, message: `${asPlayer.getNameToRender()} was sent to the PC.` };
}

function awakeOthers(party: readonly PlayerPokemon[], except: PlayerPokemon): number {
  return party.filter(p => p !== except && !p.isFainted()).length;
}

export function depositPokemon(partyIndex: number): PcResult {
  const party = globalScene.getPlayerParty();
  const mon = party[partyIndex];
  if (!mon) {
    return { ok: false, message: "Nobody is in that slot." };
  }
  if (pcIsFull()) {
    return { ok: false, message: "The PC is full." };
  }
  if (party.length <= 1 || awakeOthers(party, mon) === 0) {
    return { ok: false, message: "You need at least one Pokémon that can battle." };
  }
  const name = mon.getNameToRender();
  const items = serializeHeldItems(mon.id);
  const data = JSON.parse(JSON.stringify(new PokemonData(mon)));
  removeHeldItems(mon.id);
  globalScene.removePokemonFromPlayerParty(mon, true);
  pcState.entries.push({ pokemon: data, items });
  return { ok: true, message: `${name} was stored in the PC.` };
}

async function addFromEntry(entry: PcEntryState, slot?: number): Promise<PlayerPokemon> {
  const mon = new PokemonData(entry.pokemon).toPokemon() as PlayerPokemon;
  mon.setVisible(false);
  const party = globalScene.getPlayerParty();
  if (slot === undefined || slot >= party.length) {
    party.push(mon);
  } else {
    party.splice(slot, 0, mon);
  }
  for (const raw of entry.items) {
    try {
      const data = new ModifierData(raw, true);
      const modifier = data.toModifier((Modifier as any)[data.className]);
      if (modifier) {
        globalScene.addModifier(modifier, true, false, false, true);
      }
    } catch (err) {
      console.warn("CatchCrypt: PC item restore skipped", err);
    }
  }
  globalScene.updateModifiers(true, true);
  await mon.loadAssets(false);
  return mon;
}

export async function withdrawPokemon(boxIndex: number): Promise<PcResult> {
  const entry = pcState.entries[boxIndex];
  if (!entry) {
    return { ok: false, message: "That box slot is empty." };
  }
  if (globalScene.getPlayerParty().length >= PLAYER_PARTY_MAX_SIZE) {
    return { ok: false, message: "Your party is full." };
  }
  pcState.entries.splice(boxIndex, 1);
  try {
    const mon = await addFromEntry(entry);
    return { ok: true, message: `${mon.getNameToRender()} joined your party.` };
  } catch (err) {
    console.error("CatchCrypt: PC withdraw failed", err);
    pcState.entries.splice(boxIndex, 0, entry);
    return { ok: false, message: "The PC could not load that Pokémon." };
  }
}

/** Party member goes into the box slot, the boxed Pokémon takes their party slot. */
export async function swapPokemon(partyIndex: number, boxIndex: number): Promise<PcResult> {
  const party = globalScene.getPlayerParty();
  const mon = party[partyIndex];
  const entry = pcState.entries[boxIndex];
  if (!mon || !entry) {
    return { ok: false, message: "Nothing to swap." };
  }
  const name = mon.getNameToRender();
  const items = serializeHeldItems(mon.id);
  const data = JSON.parse(JSON.stringify(new PokemonData(mon)));
  let incoming: PlayerPokemon;
  try {
    incoming = await addFromEntry(entry, partyIndex);
  } catch (err) {
    console.error("CatchCrypt: PC swap failed", err);
    return { ok: false, message: "The PC could not load that Pokémon." };
  }
  if (party.filter(p => p !== mon && !p.isFainted()).length === 0) {
    globalScene.removePokemonFromPlayerParty(incoming, true);
    return { ok: false, message: "You need at least one Pokémon that can battle." };
  }
  removeHeldItems(mon.id);
  globalScene.removePokemonFromPlayerParty(mon, true);
  pcState.entries[boxIndex] = { pokemon: data, items };
  return { ok: true, message: `${name} and ${incoming.getNameToRender()} swapped places.` };
}

// Development-mode builds only: lets the screenshot harness fill the party and the box. Stripped from production.
if (import.meta.env.MODE === "development" && typeof window !== "undefined") {
  (window as any).__ccPcDebug = {
    scene: () => globalScene,
    state: () => pcState,
    fillParty: (speciesIds: number[], level = 5) => {
      for (const id of speciesIds) {
        if (globalScene.getPlayerParty().length >= PLAYER_PARTY_MAX_SIZE) {
          break;
        }
        const mon = globalScene.addPlayerPokemon(speciesDataRegistry.getSpecies(id), level);
        mon.setVisible(false);
        globalScene.getPlayerParty().push(mon);
        mon.loadAssets(false);
      }
    },
    fillBox: (speciesIds: number[], level = 5) => {
      for (const id of speciesIds) {
        const mon = globalScene.addPlayerPokemon(speciesDataRegistry.getSpecies(id), level);
        pcState.entries.push({ pokemon: JSON.parse(JSON.stringify(new PokemonData(mon))), items: [] });
        mon.destroy();
      }
    },
    serialize: () => serializePc(),
  };
}
