/*
 * Centered startup wait indicator. AGPL-3.0.
 * After the asset bar is destroyed, the plains arena (sky and grass bands) stays
 * on screen while fallback animations, the account, the system save, and the
 * last session load. Phones also letterbox that 16:9 canvas with the page's
 * dark bars. The in-game loading window is a small box on the bottom edge,
 * under the touch controls, so the middle of the screen looks stuck.
 * The same overlay covers the frozen arena while the town tiles and character
 * sheets load. It is DOM, in CSS pixels, so camera scale and FIT letterboxing
 * cannot push it off a phone.
 */

const ROOT_ID = "cc-boot-loading";
const STYLE_ID = "cc-boot-loading-style";
const SLOW_AFTER_MS = 15_000;
const LABEL = "Loading";
const SLOW_LABEL = "Still loading, hang tight…";

export const bootLoadingCss = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  box-sizing: border-box;
  padding:
    calc(16px + env(safe-area-inset-top))
    calc(16px + env(safe-area-inset-right))
    calc(16px + env(safe-area-inset-bottom))
    calc(16px + env(safe-area-inset-left));
}
#${ROOT_ID} .cc-boot-panel {
  font-family: emerald, monospace;
  font-size: clamp(22px, 5.2vw, 48px);
  line-height: 1.35;
  color: #ffffff;
  background: #1b2440ee;
  border: 4px solid #f6d36b;
  border-radius: 8px;
  padding: 14px 18px;
  text-align: center;
  max-width: min(92vw, 640px);
  -webkit-font-smoothing: none;
  text-shadow:
    2px 0 0 #1b2440,
    -2px 0 0 #1b2440,
    0 2px 0 #1b2440,
    0 -2px 0 #1b2440;
}
#${ROOT_ID} .cc-boot-dots {
  display: inline-block;
  width: 1.6em;
  text-align: left;
}
#${ROOT_ID} .cc-boot-dots i {
  font-style: normal;
  opacity: 0;
  animation: cc-boot-dot 1.2s infinite;
}
#${ROOT_ID} .cc-boot-dots i:nth-child(2) { animation-delay: 0.2s; }
#${ROOT_ID} .cc-boot-dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes cc-boot-dot {
  0%, 25% { opacity: 0; }
  40%, 100% { opacity: 1; }
}
#${ROOT_ID}.is-slow .cc-boot-dots { display: none; }
#${ROOT_ID}.is-slow .cc-boot-panel {
  animation: cc-boot-pulse 1.6s ease-in-out infinite;
}
@keyframes cc-boot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.72; }
}
`;

let slowTimer = 0;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = bootLoadingCss;
  document.head.appendChild(style);
}

/** Show the centered indicator. A second call while it is up keeps the 15s clock. */
export function showBootLoading(): void {
  ensureStyle();
  if (document.getElementById(ROOT_ID)) {
    return;
  }
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-label", LABEL);
  root.innerHTML =
    `<div class="cc-boot-panel"><span class="cc-boot-label">${LABEL}</span>`
    + `<span class="cc-boot-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></div>`;
  document.body.appendChild(root);
  slowTimer = window.setTimeout(() => {
    slowTimer = 0;
    const live = document.getElementById(ROOT_ID);
    const label = live?.querySelector(".cc-boot-label");
    if (!live || !label) {
      return;
    }
    live.classList.add("is-slow");
    label.textContent = SLOW_LABEL;
    live.setAttribute("aria-label", SLOW_LABEL);
  }, SLOW_AFTER_MS);
}

/** Remove the indicator once a menu, form, or the town itself is on screen. */
export function hideBootLoading(): void {
  window.clearTimeout(slowTimer);
  slowTimer = 0;
  document.getElementById(ROOT_ID)?.remove();
}
