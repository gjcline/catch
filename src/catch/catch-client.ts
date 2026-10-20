/*
 * Catch reward bridge. AGPL-3.0 like the rest of this repo.
 * This client only REPORTS game events. It never decides rewards: the private
 * catch-backend validates each event and makes every roll server-side.
 */
import { globalScene } from "#app/global-scene";

import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { getCookie } from "#utils/cookies";

const API: string = import.meta.env.VITE_SERVER_URL ?? "";
let token: string | null = null;
let runId: string | null = null;

async function post(path: string, body: unknown): Promise<any> {
  token = getCookie(SESSION_ID_COOKIE_NAME) || null;
  if (!token) {
    return null;
  }
  try {
    const r = await fetch(API + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch {
    return null;
  }
}

/** Called when a new run starts. The server issues the RNG seed so runs are reproducible for audit / replay. */
export async function catchStartRun(mode: string): Promise<void> {
  const res = await post("/api/runs", { mode });
  if (res?.ok) {
    runId = res.runId;
    if (mode === "daily") {
      return; // daily runs keep PokeRogue's shared daily seed
    }
    globalScene.setSeed(res.seed);
    globalScene.resetSeed();
  }
}

export function catchReport(type: "catch" | "battle_won" | "wave_reached" | "run_won", data: Record<string, unknown> = {}): void {
  if (!runId) {
    return;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  void post(`/api/runs/${runId}/events`, { type, wave, data }).then(res => {
    if (res?.reward) {
      window.dispatchEvent(new CustomEvent("catch:reward", { detail: res.reward }));
    }
  });
}
