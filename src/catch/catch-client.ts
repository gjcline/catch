/*
 * Catch reward bridge. AGPL-3.0 like the rest of this repo.
 * This client only REPORTS game events. It never decides rewards: the private
 * catch-backend validates each event and makes every roll server-side.
 */
import { loggedInUser } from "#app/account";
import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { globalScene } from "#app/global-scene";
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
  card: { name: string; value: number; image?: string | null };
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

const OFFER_WAIT_MS = 12_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Reports that would move the run to a later wave are held while a card offer is being
 * looked up or shown, so the server never lapses an offer the player has not answered.
 */
let gate: Promise<void> | null = null;
export function catchHoldReports(): () => void {
  let release!: () => void;
  const g = new Promise<void>(r => (release = r));
  gate = g;
  return () => {
    release();
    if (gate === g) {
      gate = null;
    }
  };
}

/**
 * The server-made offer for this wave, if any. The server decides eligibility from the
 * account's linked wallet, so this does not gate on the client copy of the wallet.
 * Waits for the in-flight win/catch report, then asks the server directly if it was late.
 */
export async function catchOfferFor(wave: number): Promise<CardOffer | null> {
  if (!runId) {
    return null;
  }
  const p = pending.get(wave);
  if (p) {
    await Promise.race([p, sleep(OFFER_WAIT_MS)]);
  }
  let o = offers.get(wave);
  if (!o) {
    for (let i = 0; i < 3 && !o; i++) {
      const res = await get(`/api/runs/${runId}/offer?wave=${wave}`);
      if (res?.offer) {
        o = { ...res.offer, wave } as CardOffer;
        offers.set(wave, o);
      } else if (res?.ok && !p) {
        break; // server answered: no offer, and nothing in flight
      } else if (i < 2) {
        await sleep(1500);
      }
    }
  }
  return o && o.status === "offered" ? o : null;
}

/** Tell the server the player skipped this card. Fire-and-forget. */
export function catchDeclineOffer(offer: CardOffer): void {
  offer.status = "skipped";
  void post(`/api/offers/${offer.id}/decline`, {});
}

/** Accept the offer. Returns the server's message, or an error text. */
export async function catchAcceptOffer(offer: CardOffer): Promise<string> {
  const res = await post(`/api/offers/${offer.id}/accept`, {});
  if (res?.claim) {
    offer.status = "awaiting_claim";
    return "Your Collector Crypt card is being sent to your connected wallet now! Any older reserved cards send when you open Menu, then Community, then My Cards.";
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

/** Called after Continue / loading a save: the run id lives only in memory, so re-attach to the server run. */
export async function catchResumeRun(mode: string, wave: number): Promise<void> {
  const res = await post("/api/runs/resume", { mode, wave: Math.max(1, wave || 1) });
  if (res?.ok) {
    runId = res.runId;
  }
}

export function catchReport(
  type: "catch" | "battle_won" | "wave_reached" | "run_won",
  data: Record<string, unknown> = {},
): void {
  if (!runId) {
    return;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  const held = gate;
  const p = (held ? held.then(() => post(`/api/runs/${runId}/events`, { type, wave, data })) : post(`/api/runs/${runId}/events`, { type, wave, data })).then(res => {
    if (res?.offer) {
      offers.set(wave, res.offer);
    }
    return res;
  });
  if (type === "battle_won" || type === "catch") {
    pending.set(wave, p);
  }
}

const TIP = "Catches and wins have a chance to drop real Collector Crypt cards when you play with a connected wallet.";
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

// ---------- Leaderboard progress. Local record of the best this account has reached; the server validates and clamps it.
interface CatchProgress {
  wave: number;
  gyms: number[];
  biomes: number[];
}
function progressKey(): string | null {
  return loggedInUser?.username ? `cc-progress:${loggedInUser.username}` : null;
}
function loadProgress(k: string): CatchProgress {
  try {
    const p = JSON.parse(localStorage.getItem(k) ?? "");
    return {
      wave: Number(p.wave) || 0,
      gyms: Array.isArray(p.gyms) ? p.gyms : [],
      biomes: Array.isArray(p.biomes) ? p.biomes : [],
    };
  } catch {
    return { wave: 0, gyms: [], biomes: [] };
  }
}
/** Call after a won battle: best wave, distinct gym leaders beaten, distinct biomes visited. Reports only when something went up. */
export function catchReportProgress(): void {
  const k = progressKey();
  if (!k) {
    return;
  }
  try {
    const p = loadProgress(k);
    const before = JSON.stringify(p);
    const battle = globalScene.currentBattle;
    p.wave = Math.max(p.wave, battle.waveIndex);
    const t = battle.trainer?.config;
    if (t && t.title?.startsWith("gymLeader") && !p.gyms.includes(t.trainerType)) {
      p.gyms.push(t.trainerType);
    }
    const biome = globalScene.arena?.biomeId;
    if (biome != null && !p.biomes.includes(biome)) {
      p.biomes.push(biome);
    }
    if (JSON.stringify(p) === before) {
      return;
    }
    localStorage.setItem(k, JSON.stringify(p));
    void post("/api/progress", { wave: p.wave, badges: p.gyms.length, biomes: p.biomes.length });
  } catch {
    // never block the game on a report
  }
}

export interface LeaderboardData {
  ok: boolean;
  sort: "progress" | "cards";
  total: number;
  top: any[];
  me: any | null;
}
/** Public board; sends the session token when logged in so the server can include your rank. */
export async function catchLeaderboard(sort: "progress" | "cards"): Promise<LeaderboardData | null> {
  const t = getCookie(SESSION_ID_COOKIE_NAME);
  try {
    const r = await fetch(`${API}/api/leaderboard/players?sort=${sort}`, {
      headers: t ? { authorization: `Bearer ${t}` } : {},
    });
    return await r.json();
  } catch {
    return null;
  }
}
