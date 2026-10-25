/*
 * CatchCrypt PC storage state. AGPL-3.0.
 * Kept free of game imports so BattleScene can clear it without import cycles.
 */

export const PC_BOX_COUNT = 3;
export const PC_BOX_SIZE = 30;
export const PC_CAPACITY = PC_BOX_COUNT * PC_BOX_SIZE;

/** Serialized Pokémon (PokemonData shape) plus the held items it carried in. */
export interface PcEntryState {
  pokemon: any;
  items: any[];
}

export const pcState: { entries: PcEntryState[] } = { entries: [] };

export function clearPcState(): void {
  pcState.entries = [];
}

export function pcCount(): number {
  return pcState.entries.length;
}

export function pcIsFull(): boolean {
  return pcState.entries.length >= PC_CAPACITY;
}
