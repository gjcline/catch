/*
 * CatchCrypt: link a Solana wallet to the game account (DOM overlay, AGPL-3.0).
 * The wallet signs a server-issued message; the backend verifies and links it.
 */
import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { getCookie } from "#utils/cookies";

const API: string = import.meta.env.VITE_SERVER_URL ?? "";
const SKIP_KEY = "catchcrypt_wallet_skipped";
const WARN =
  "You will not be able to collect real Collector Crypt cards in game without connecting a wallet. Are you sure you want to continue?";

type SolProvider = {
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(msg: Uint8Array, enc?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
};
function provider(): SolProvider | null {
  const w = window as any;
  return w.phantom?.solana ?? w.solflare ?? w.backpack?.solana ?? w.solana ?? null;
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58(bytes: Uint8Array): string {
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const b of bytes) {
    if (b !== 0) {
      break;
    }
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    out += B58[digits[i]];
  }
  return out;
}
async function api(path: string, body: unknown): Promise<any> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: getCookie(SESSION_ID_COOKIE_NAME) },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function connectWallet(): Promise<string> {
  const p = provider();
  if (!p) {
    window.open("https://phantom.app/", "_blank");
    throw new Error("No Solana wallet found. Install Phantom, then try again.");
  }
  const { publicKey } = await p.connect();
  const wallet = publicKey.toString();
  const n = await api("/account/wallet/nonce", { wallet });
  if (!n.ok) {
    throw new Error(n.error ?? "Could not start wallet link");
  }
  const signed = await p.signMessage(new TextEncoder().encode(n.message), "utf8");
  const sig = signed instanceof Uint8Array ? signed : signed.signature;
  const l = await api("/account/wallet/link", { signature: bs58(sig) });
  if (!l.ok) {
    throw new Error(l.error === "wallet_linked_to_other_account" ? "That wallet is linked to another account." : "Wallet link failed.");
  }
  return wallet;
}

function el(html: string): HTMLDivElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  d.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);font-family:emerald,monospace;";
  document.body.appendChild(d);
  return d;
}
const box =
  "background:#1b2440;border:4px solid #e3342f;border-radius:8px;padding:24px;max-width:440px;color:#fff;text-align:center;font-size:22px;line-height:1.3";
const btn = "margin:8px;padding:10px 18px;font-size:20px;border:0;border-radius:6px;cursor:pointer;font-family:inherit";

/** Show the connect step. Resolves when the player connects or confirms skipping. */
export function showWalletPrompt(force = false): Promise<void> {
  if (!force && localStorage.getItem(SKIP_KEY)) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const d = el(`<div id="cc-wallet" style="${box}">
      <h2 style="margin:0 0 8px">Connect Solana wallet</h2>
      <p>Link Phantom or another Solana wallet to collect real Collector Crypt cards you earn in game.</p>
      <p id="cc-wallet-status" style="color:#ffb3b3;min-height:1.2em"></p>
      <button id="cc-connect" style="${btn};background:#e3342f;color:#fff">Connect wallet</button>
      <button id="cc-skip" style="${btn};background:#555;color:#fff">Skip</button></div>`);
    const status = d.querySelector("#cc-wallet-status") as HTMLElement;
    const done = () => {
      d.remove();
      resolve();
    };
    (d.querySelector("#cc-connect") as HTMLButtonElement).onclick = async () => {
      status.textContent = "Check your wallet...";
      try {
        const w = await connectWallet();
        localStorage.removeItem(SKIP_KEY);
        status.style.color = "#b3ffb3";
        status.textContent = `Linked ${w.slice(0, 4)}...${w.slice(-4)}`;
        setTimeout(done, 900);
      } catch (e: any) {
        status.textContent = e?.message ?? String(e);
      }
    };
    (d.querySelector("#cc-skip") as HTMLButtonElement).onclick = () => {
      const c = el(`<div id="cc-wallet-warn" style="${box}"><p>${WARN}</p>
        <button id="cc-continue" style="${btn};background:#555;color:#fff">Continue without wallet</button>
        <button id="cc-back" style="${btn};background:#e3342f;color:#fff">Connect wallet</button></div>`);
      (c.querySelector("#cc-continue") as HTMLButtonElement).onclick = () => {
        localStorage.setItem(SKIP_KEY, "1");
        c.remove();
        done();
      };
      (c.querySelector("#cc-back") as HTMLButtonElement).onclick = () => c.remove();
    };
  });
}

/** "My Cards": the account's reserved and claimed Collector Crypt cards. */
export async function showClaimsList(): Promise<void> {
  document.getElementById("cc-claims")?.remove();
  const { catchClaims } = await import("#app/catch/catch-client");
  const claims = await catchClaims();
  const esc = (t: string) => t.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
  const label: Record<string, string> = {
    awaiting_claim: "Reserved, sending to your wallet",
    sending: "Sending",
    sent: "Sent",
    sent_dry: "Sent (test)",
    void: "Unavailable",
  };
  const rows =
    claims == null
      ? "<p>Log in to see your cards.</p>"
      : claims.length === 0
        ? "<p>No cards yet. Wins and catches can drop one when your wallet is connected.</p>"
        : `<table style="width:100%;border-collapse:collapse;text-align:left;font-size:20px" cellpadding="6"><tr><th>Card</th><th>Value</th><th>Status</th></tr>${claims
            .map(
              (c: any) =>
                `<tr><td>${esc(String(c.card?.name ?? "?"))}</td><td>$${Number(c.card?.value ?? 0).toFixed(2)}</td><td>${esc(label[c.status] ?? c.status)}</td></tr>`,
            )
            .join("")}</table>`;
  const d = el(`<div id="cc-claims" style="${box}"><h2 style="margin:0 0 8px">My Collector Crypt Cards</h2>${rows}
    <button id="cc-claims-close" style="${btn};background:#555;color:#fff">Close (ESC)</button></div>`);
  const close = () => {
    d.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  (d.querySelector("#cc-claims-close") as HTMLButtonElement).onclick = close;
}
