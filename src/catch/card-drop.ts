/*
 * CatchCrypt: dedicated card drop scene shown instead of the reward screen when the server
 * offers a real Collector Crypt card. DOM overlay, AGPL-3.0. The card is the only option.
 */
import { loggedInUser } from "#app/account";
import type { CardOffer } from "#app/catch/catch-client";
import { catchAcceptOffer, catchDeclineOffer } from "#app/catch/catch-client";

export const cardDropCss = `
#cc-drop{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left));background:radial-gradient(circle,#1b2440 0%,#05060c 80%);font-family:emerald,monospace;color:#fff;overflow:auto;text-align:center;touch-action:manipulation;-webkit-overflow-scrolling:touch}
#cc-drop .flash{position:absolute;inset:0;background:#fff;animation:ccFlash .6s ease-out forwards;pointer-events:none}
@keyframes ccFlash{0%{opacity:1}100%{opacity:0}}
#cc-drop .ball{position:absolute;width:120px;height:120px;border-radius:50%;background:linear-gradient(#e3342f 0 48%,#222 48% 52%,#fff 52%);box-shadow:0 0 40px 12px #ffd700,0 0 90px 30px #ff6ad5;animation:ccShake .35s ease-in-out 0s 5 alternate,ccBurst .45s ease-in 1.75s forwards}
#cc-drop .ball:after{content:"";position:absolute;left:44px;top:44px;width:32px;height:32px;border-radius:50%;background:#fff;border:5px solid #222;box-sizing:border-box}
@keyframes ccShake{0%{transform:rotate(-18deg)}100%{transform:rotate(18deg)}}
@keyframes ccBurst{0%{transform:scale(1);opacity:1}100%{transform:scale(3.2);opacity:0;filter:brightness(4)}}
#cc-drop .stage{position:relative;display:flex;flex-direction:column;align-items:center;opacity:0;animation:ccIn .01s linear 2.1s forwards}
@keyframes ccIn{to{opacity:1}}
#cc-drop .card{position:relative;width:min(250px,72vw,32vh);aspect-ratio:5/7;height:auto;perspective:900px}
@media (max-height:700px){#cc-drop h1{font-size:24px}#cc-drop .nm,#cc-drop .val{font-size:18px}}
#cc-drop .inner{position:absolute;inset:0;transform-style:preserve-3d;animation:ccFlip 1.1s cubic-bezier(.2,.8,.2,1) 2.1s both}
@keyframes ccFlip{0%{transform:scale(.1) rotateY(540deg)}70%{transform:scale(1.08) rotateY(-10deg)}100%{transform:scale(1) rotateY(0)}}
#cc-drop .face{position:absolute;inset:0;border-radius:14px;overflow:hidden;backface-visibility:hidden;background:#111 center/contain no-repeat;border:4px solid transparent;
 background-clip:padding-box;box-shadow:0 0 30px 8px rgba(255,215,0,.8)}
#cc-drop .face:before{content:"";position:absolute;inset:-4px;border-radius:16px;padding:4px;background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);background-size:300% 100%;animation:ccRain 2s linear infinite;
 -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
#cc-drop .face img{width:100%;height:100%;object-fit:contain}
#cc-drop .shine{position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.55) 45%,rgba(255,120,255,.35) 50%,transparent 62%);background-size:250% 100%;animation:ccShine 2.4s linear 3.2s infinite;mix-blend-mode:screen}
@keyframes ccShine{0%{background-position:150% 0}100%{background-position:-100% 0}}
@keyframes ccRain{to{background-position:300% 0}}
#cc-drop .glow{position:absolute;left:50%;top:50%;width:520px;height:520px;margin:-260px;border-radius:50%;background:conic-gradient(from 0deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);filter:blur(40px);opacity:.45;animation:ccSpin 6s linear infinite}
@keyframes ccSpin{to{transform:rotate(360deg)}}
#cc-drop .p{position:absolute;left:50%;top:50%;width:10px;height:10px;border-radius:50%;opacity:0;animation:ccP 1.6s ease-out var(--d) infinite}
@keyframes ccP{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--x),var(--y)) scale(.2);opacity:0}}
#cc-drop h1{margin:18px 0 4px;font-size:34px;color:#ffd700;text-shadow:0 0 12px #ff6ad5}
#cc-drop .nm{font-size:26px}#cc-drop .val{font-size:24px;color:#7dffb0;margin-bottom:10px}
#cc-drop .glow,#cc-drop .p,#cc-drop .ball{pointer-events:none}
#cc-drop .card{pointer-events:auto;touch-action:manipulation}
#cc-drop button{position:relative;z-index:2;font-family:inherit;border:0;border-radius:8px;cursor:pointer;touch-action:manipulation;min-height:48px}
#cc-drop .claim{font-size:22px;padding:14px 28px;min-width:160px;background:linear-gradient(90deg,#ffb000,#ff3d7f);color:#fff;box-shadow:0 0 20px #ffd700;animation:ccPulse 1s ease-in-out infinite alternate}
@keyframes ccPulse{to{transform:scale(1.06);box-shadow:0 0 34px #ffd700}}
#cc-drop .skip{display:block;margin:12px auto 0;font-size:18px;padding:12px 18px;min-width:120px;background:transparent;color:#bbb;text-decoration:underline}
#cc-drop.cc-revealed .stage{opacity:1;animation:none}
#cc-drop.cc-revealed .inner{transform:none;animation:none}
#cc-drop.cc-revealed .ball,#cc-drop.cc-revealed .flash{display:none}
#cc-drop .msg{min-height:1.3em;font-size:20px;color:#ffd7a8;max-width:520px;margin-top:8px}
#cc-drop .confirm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);z-index:3}
#cc-drop .confirm>div{background:#1b2440;border:4px solid #e3342f;border-radius:8px;padding:24px;max-width:440px;font-size:22px}
#cc-drop .confirm button{margin:8px;padding:12px 18px;min-height:48px;font-size:20px;color:#fff}
`;

const esc = (t: string) => t.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

/** Shows the drop scene. Resolves with the message to show in game after the player claims or skips. */
export function showCardDrop(offer: CardOffer): Promise<string | null> {
  return new Promise(resolve => {
    document.getElementById("cc-drop")?.remove();
    if (!document.getElementById("cc-drop-css")) {
      const s = document.createElement("style");
      s.id = "cc-drop-css";
      s.textContent = cardDropCss;
      document.head.appendChild(s);
    }
    const img = (offer.card as any).image as string | null | undefined;
    const parts = Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      const r = 180 + (i % 5) * 30;
      const col = ["#ffd700", "#ff6ad5", "#6af0ff", "#7dff8a", "#fff"][i % 5];
      return `<i class="p" style="background:${col};--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px;--d:${2.2 + (i % 7) * 0.2}s"></i>`;
    }).join("");
    const d = document.createElement("div");
    d.id = "cc-drop";
    d.innerHTML = `<div class="ball"></div>
      <div class="stage"><div class="glow"></div>${parts}
        <div class="card"><div class="inner"><div class="face"><img alt="" src="${esc(img || "./images/cc_card.png")}"><div class="shine"></div></div></div></div>
        <h1>A real Collector Crypt card dropped!</h1>
        <div class="nm">${esc(String(offer.card?.name ?? "Collector Crypt card"))}</div>
        <div class="val">Value $${Number(offer.card?.value ?? 0).toFixed(2)}</div>
        <button class="claim" id="cc-drop-claim">Claim card</button>
        <button class="skip" id="cc-drop-skip">Skip</button>
        <div class="msg" id="cc-drop-msg"></div>
      </div><div class="flash"></div>`;
    document.body.appendChild(d);
    const imgEl = d.querySelector(".face img") as HTMLImageElement;
    imgEl.onerror = () => {
      imgEl.onerror = null;
      imgEl.src = "./images/cc_card.png";
    };
    const msg = d.querySelector("#cc-drop-msg") as HTMLElement;
    const claimBtn = d.querySelector("#cc-drop-claim") as HTMLButtonElement;
    let busy = false;
    let confirmEl: HTMLElement | null = null;
    const finish = (m: string | null) => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", swallow, true);
      d.remove();
      resolve(m);
    };
    const claim = async () => {
      if (busy || confirmEl) {
        return;
      }
      busy = true;
      if (!loggedInUser?.wallet) {
        msg.textContent = "Connect a wallet to claim this card.";
        const { showWalletPrompt } = await import("#app/catch/wallet-link");
        await showWalletPrompt(true);
        if (!loggedInUser?.wallet) {
          msg.textContent = "No wallet connected yet. Connect one, then press Claim card.";
          busy = false;
          return;
        }
      }
      claimBtn.textContent = "Claiming...";
      const m = await catchAcceptOffer(offer);
      finish(m);
    };
    const skip = () => {
      if (busy || confirmEl) {
        return;
      }
      confirmEl = document.createElement("div");
      confirmEl.className = "confirm";
      confirmEl.innerHTML = `<div><p>Skip this card? This real card will be lost.</p>
        <button id="cc-drop-yes" style="background:#555;min-height:48px">Skip card</button>
        <button id="cc-drop-no" style="background:#e3342f;min-height:48px">Keep card</button></div>`;
      d.appendChild(confirmEl);
      (confirmEl.querySelector("#cc-drop-yes") as HTMLButtonElement).onclick = () => {
        catchDeclineOffer(offer);
        finish(null);
      };
      (confirmEl.querySelector("#cc-drop-no") as HTMLButtonElement).onclick = () => {
        confirmEl?.remove();
        confirmEl = null;
      };
    };
    claimBtn.onclick = claim;
    (d.querySelector("#cc-drop-skip") as HTMLButtonElement).onclick = skip;
    // The first tap reveals the card. The next tap is Claim or Skip.
    d.addEventListener(
      "pointerdown",
      event => {
        if (d.classList.contains("cc-revealed")) {
          return;
        }
        d.classList.add("cc-revealed");
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    // Keys stay inside this screen so the paused game underneath never reacts.
    const swallow = (e: KeyboardEvent) => {
      if (!document.getElementById("cc-wallet") && !document.getElementById("cc-wallet-warn")) {
        e.stopPropagation();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (document.getElementById("cc-wallet") || document.getElementById("cc-wallet-warn")) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      if (e.repeat) {
        return;
      }
      if (e.key === "Escape") {
        confirmEl ? (confirmEl.querySelector("#cc-drop-no") as HTMLButtonElement).click() : skip();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    (window as any).__ccDropShown = ((window as any).__ccDropShown ?? 0) + 1;
  });
}
