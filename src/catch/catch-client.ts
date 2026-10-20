/*
 * Catch reward bridge. AGPL-3.0 like the rest of this repo.
 * This client only REPORTS game events. It never decides rewards: the private
 * catch-backend validates each event and makes every roll server-side.
 */
import { loggedInUser } from "#app/account";
import { globalScene } from "#app/global-scene";

import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { getCookie } from "#utils/cookies";

const API: string = import.meta.env.VITE_SERVER_URL ?? "";
let token: string | null = null;
let runId: string | null = null;

/** Extra headers for every API call. Test builds only; never set in production. */
function extraHeaders(): Record<string, string> {
  const f = (globalThis as any).__catchForceOffer;
  return typeof f === "string" && f ? { "x-catch-force-offer": f } : {};
}

export interface CardOffer {
  id: string;
  wave: number;
  card: { name: string; value: number };
  status: string;
}
const offers = new Map<number, CardOffer>();
const pending = new Map<number, Promise<unknown>>();

async function get(path: string): Promise<any> {
  token = getCookie(SESSION_ID_COOKIE_NAME) || null;
  if (!token) {
    return null;
  }
  try {
    const r = await fetch(API + path, { headers: { authorization: `Bearer ${token}`, ...extraHeaders() } });
    return await r.json();
  } catch {
    return null;
  }
}

/** The server-made offer for this wave, if any. Waits briefly for the in-flight win/catch report. */
export async function catchOfferFor(wave: number): Promise<CardOffer | null> {
  if (!runId || !loggedInUser?.wallet) {
    return null;
  }
  const p = pending.get(wave);
  if (p) {
    await Promise.race([p, new Promise(r => setTimeout(r, 2500))]);
  }
  const o = offers.get(wave);
  return o && o.status === "offered" ? o : null;
}

/** Accept the offer. Returns the server's message, or an error text. */
export async function catchAcceptOffer(offer: CardOffer): Promise<string> {
  const res = await post(`/api/offers/${offer.id}/accept`, {});
  if (res?.claim) {
    offer.status = "awaiting_claim";
    return res.message ?? "Card reserved! Claim it at catchcrypt.com";
  }
  offer.status = "expired";
  return "That card offer is no longer available.";
}

export async function catchClaims(): Promise<any[] | null> {
  const res = await get("/api/claims/mine");
  return res?.claims ?? null;
}

async function post(path: string, body: unknown): Promise<any> {
  token = getCookie(SESSION_ID_COOKIE_NAME) || null;
  if (!token) {
    return null;
  }
  try {
    const r = await fetch(API + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...extraHeaders() },
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
  const p = post(`/api/runs/${runId}/events`, { type, wave, data }).then(res => {
    if (res?.offer) {
      offers.set(wave, res.offer);
    }
    return res;
  });
  if (type === "battle_won" || type === "catch") {
    pending.set(wave, p);
  }
}

const TIP =
  "Catches and wins have a chance to drop real Collector Crypt cards when you play with a connected wallet.";
let tipShown = false;
/** Once per session, after a win or catch, remind players without a linked wallet. */
export function catchWalletTip(): void {
  if (tipShown || loggedInUser?.wallet) {
    return;
  }
  tipShown = true;
  globalScene.phaseManager.queueMessage(TIP, null, true);
}

/** Adds the card icon as a frame of the "items" atlas so reward slots can draw it. */
export function catchEnsureCardIcon(): void {
  const scene: any = globalScene;
  const tex = scene.textures.get("items");
  if (!tex || tex.has("cc_card")) {
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (tex.has("cc_card")) {
      return;
    }
    tex.source.push(new Phaser.Textures.TextureSource(tex, img));
    tex.add("cc_card", tex.source.length - 1, 0, 0, img.width, img.height);
  };
  img.src = "./images/cc_card.png";
}
