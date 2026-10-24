/*
 * Leaderboard overlay. AGPL-3.0 like the rest of this repo.
 * Two tabs: Progress (best wave, gym badges, biomes) and Cards (real Collector Crypt cards sent to the player's wallet).
 * Shows usernames only.
 */
import { walletOverlayCss } from "#app/catch/wallet-link";

type Tab = "progress" | "cards";
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const box =
  "background:#1b2440;border:4px solid #e3342f;border-radius:8px;padding:14px;width:min(560px,100%);max-height:min(88dvh,calc(100dvh - 24px));display:flex;flex-direction:column;box-sizing:border-box;color:#fff;font-size:20px;line-height:1.3";
const tabCss = (on: boolean) =>
  `flex:1;min-height:48px;padding:10px 6px;font-size:20px;font-family:inherit;border:0;border-radius:6px;cursor:pointer;touch-action:manipulation;background:${on ? "#e3342f" : "#33405f"};color:#fff`;
const MEDALS: Record<number, string> = { 1: "#ffd84a", 2: "#d9e2ec", 3: "#e09a5b" };
const medal = (r: number) => MEDALS[r] ?? "#9fb0d0";

function row(tab: Tab, x: any, me: boolean): string {
  const stats =
    tab === "progress"
      ? `<span title="Best wave">Wave <b>${esc(x.bestWave)}</b></span><span title="Gym badges">${esc(x.badges)} badges</span><span title="Biomes visited">${esc(x.biomes)} biomes</span>`
      : `<span><b>${esc(x.cards)}</b> card${x.cards === 1 ? "" : "s"}</span><span>$${Number(x.usd ?? 0).toFixed(2)}</span>`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid #2c3a5e;${me ? "background:#3a2a3a;border-radius:6px" : ""}">
    <span style="min-width:2.6em;text-align:right;color:${medal(x.rank)};font-weight:bold">${x.rank ?? "-"}</span>
    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.username)}${me ? " (you)" : ""}</span>
    <span style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:2px 10px;font-size:17px;color:#d6def0">${stats}</span></div>`;
}

export async function showLeaderboard(initial: Tab = "progress"): Promise<void> {
  document.getElementById("cc-leaderboard")?.remove();
  const { catchLeaderboard } = await import("#app/catch/catch-client");
  const d = document.createElement("div");
  d.id = "cc-leaderboard";
  d.style.cssText = walletOverlayCss;
  d.innerHTML = `<div style="${box}">
    <h2 style="margin:0 0 10px;text-align:center">Leaderboard</h2>
    <div style="display:flex;gap:8px;margin-bottom:8px"><button data-tab="progress">Progress</button><button data-tab="cards">Cards</button></div>
    <p id="cc-lb-hint" style="margin:0 0 6px;font-size:16px;color:#b8c4dc;text-align:center"></p>
    <div id="cc-lb-list" style="flex:1;min-height:120px;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y"></div>
    <div id="cc-lb-me" style="margin-top:6px"></div>
    <button id="cc-lb-close" style="margin:10px auto 0;padding:12px 18px;min-height:48px;font-size:20px;border:0;border-radius:6px;cursor:pointer;font-family:inherit;background:#555;color:#fff;touch-action:manipulation">Close (ESC)</button></div>`;
  document.body.appendChild(d);
  const list = d.querySelector("#cc-lb-list") as HTMLElement;
  const meEl = d.querySelector("#cc-lb-me") as HTMLElement;
  const hint = d.querySelector("#cc-lb-hint") as HTMLElement;
  const tabs = [...d.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  let seq = 0;
  const load = async (tab: Tab) => {
    const n = ++seq;
    for (const b of tabs) {
      b.style.cssText = tabCss(b.dataset.tab === tab);
    }
    hint.textContent =
      tab === "progress"
        ? "Best wave reached. Ties go to gym badges, then biomes."
        : "Real Collector Crypt cards sent to players' wallets.";
    list.innerHTML = `<p style="text-align:center">Loading...</p>`;
    meEl.innerHTML = "";
    const data = await catchLeaderboard(tab);
    if (n !== seq) {
      return;
    }
    if (!data?.ok) {
      list.innerHTML = `<p style="text-align:center">Leaderboard is unavailable right now. Try again soon.</p>`;
      return;
    }
    const meName = data.me?.username;
    list.innerHTML =
      data.top.length > 0
        ? data.top.map(x => row(tab, x, x.username === meName)).join("")
        : `<p style="text-align:center">${tab === "cards" ? "No cards claimed yet. Be the first!" : "No progress yet. Win a battle to get on the board!"}</p>`;
    if (data.me && !data.top.some(x => x.username === meName)) {
      meEl.innerHTML = data.me.rank
        ? row(tab, data.me, true)
        : `<p style="margin:0;text-align:center;font-size:17px;color:#b8c4dc">${esc(meName)}: not ranked yet.</p>`;
    } else if (!data.me) {
      meEl.innerHTML = `<p style="margin:0;text-align:center;font-size:17px;color:#b8c4dc">Log in to see your rank.</p>`;
    }
  };
  for (const b of tabs) {
    b.onclick = () => void load(b.dataset.tab as Tab);
  }
  const close = () => {
    d.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.stopPropagation();
      void load(e.key === "ArrowLeft" ? "progress" : "cards");
    }
  };
  window.addEventListener("keydown", onKey, true);
  (d.querySelector("#cc-lb-close") as HTMLButtonElement).onclick = close;
  d.onclick = e => {
    if (e.target === d) {
      close();
    }
  };
  await load(initial);
}
