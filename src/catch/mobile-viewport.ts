/*
 * Keep the page from scrolling, zooming, or jumping when a phone rotates. AGPL-3.0.
 * The canvas is sized by Phaser FIT inside #app. Safe-area padding lives on body.
 */

interface Refreshable {
  scale: { refresh(): void };
}

/** Pin the visual viewport and ask Phaser to refit after rotate, resize, or the iOS keyboard. */
export function installMobileViewport(game: Refreshable): void {
  const root = document.documentElement;
  root.classList.add("cc-locked");
  let frame = 0;
  const refresh = () => {
    if (frame) {
      return;
    }
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      try {
        game.scale.refresh();
      } catch (err) {
        console.error("CatchCrypt: viewport refresh failed", err);
      }
      const portrait = window.matchMedia?.("(orientation: portrait)")?.matches === true;
      root.dataset.ccOrient = portrait ? "portrait" : "landscape";
      window.scrollTo(0, 0);
      window.dispatchEvent(new CustomEvent("cc-viewport"));
    });
  };
  window.addEventListener("resize", refresh);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(refresh, 60);
    window.setTimeout(refresh, 320);
  });
  window.visualViewport?.addEventListener("resize", refresh);
  window.visualViewport?.addEventListener("scroll", refresh);
  const blockGesture = (event: Event) => {
    event.preventDefault();
  };
  document.addEventListener("gesturestart", blockGesture, { passive: false });
  document.addEventListener("gesturechange", blockGesture, { passive: false });
  refresh();
}
