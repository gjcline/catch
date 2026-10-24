import { cardDropCss } from "#app/catch/card-drop";
import { presenceResumePlan, TownPresence } from "#app/catch/town-presence";
import { openTownMenu } from "#app/catch/town-shops";
import {
  dpadDirection,
  ROTATE_HINT_KEY,
  rotateHintWanted,
  setBattleTouchSuppressed,
  stepPixels,
  TOWN_TOUCH_LABELS,
  type TownTouchHandlers,
  TownTouchUi,
  walkAxis,
} from "#app/catch/town-touch";
import { walletOverlayCss } from "#app/catch/wallet-link";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const banned = /discord|telegram|roguelite/i;

function handlers(over: Partial<TownTouchHandlers> = {}): TownTouchHandlers {
  return {
    onMove: () => undefined,
    onAction: () => undefined,
    onBack: () => undefined,
    onBattle: () => undefined,
    onParty: () => undefined,
    onCharacter: () => undefined,
    onMenuPick: () => undefined,
    onCharacterPick: () => undefined,
    onVariantPick: () => undefined,
    ...over,
  };
}

function memoryStore(seed: Record<string, string> = {}) {
  const box = { ...seed };
  return {
    getItem: (key: string) => (key in box ? box[key] : null),
    setItem: (key: string, value: string) => {
      box[key] = value;
    },
  };
}

describe("CatchCrypt phone controls", () => {
  it("keeps a stalled frame from walking through a wall", () => {
    expect(stepPixels(0)).toBe(0);
    expect(stepPixels(-20)).toBe(0);
    expect(stepPixels(1000)).toBe(7.5);
    expect(stepPixels(40)).toBe(6);
  });

  it("walks on one axis and lets left beat up", () => {
    expect(walkAxis(false, false, false, false)).toBeNull();
    expect(walkAxis(true, false, true, false)).toBe("left");
    expect(walkAxis(false, true, false, true)).toBe("right");
    expect(walkAxis(false, false, true, false)).toBe("up");
    expect(walkAxis(false, false, false, true)).toBe("down");
  });

  it("turns a stick press into a cardinal direction", () => {
    expect(dpadDirection(90, 90, 180)).toBeNull();
    expect(dpadDirection(12, 90, 180)).toBe("left");
    expect(dpadDirection(168, 90, 180)).toBe("right");
    expect(dpadDirection(90, 12, 180)).toBe("up");
    expect(dpadDirection(90, 168, 180)).toBe("down");
    expect(dpadDirection(0, 0, 0)).toBeNull();
  });

  it("suggests landscape once, and only in portrait", () => {
    expect(rotateHintWanted({ portrait: true, dismissed: false })).toBe(true);
    expect(rotateHintWanted({ portrait: false, dismissed: false })).toBe(false);
    expect(rotateHintWanted({ portrait: true, dismissed: true })).toBe(false);
  });

  it("reconnects when the page is visible again and stays quiet otherwise", () => {
    expect(presenceResumePlan({ visible: true, closed: false, refused: false })).toBe("reconnect");
    expect(presenceResumePlan({ visible: false, closed: false, refused: false })).toBe("ignore");
    expect(presenceResumePlan({ visible: true, closed: true, refused: false })).toBe("ignore");
    expect(presenceResumePlan({ visible: true, closed: false, refused: true })).toBe("ignore");
  });

  it("does not reopen presence after the town has disconnected", () => {
    const presence = new TownPresence({
      spawn: () => undefined,
      move: () => undefined,
      leave: () => undefined,
    });
    presence.disconnect();
    presence.reconnect({ name: "Ada", x: 1, y: 2, facing: "front", sprite: "misa", area: "town" });
    expect(presence.isClosed()).toBe(true);
  });

  it("mounts a D-pad, A, B, and large town buttons", () => {
    const seen: string[] = [];
    const ui = new TownTouchUi(
      document,
      handlers({
        onBattle: () => seen.push("battle"),
        onMove: dir => seen.push(dir ?? "stop"),
        onAction: () => seen.push("a"),
      }),
      memoryStore(),
    );
    const root = document.getElementById("cc-town-touch");
    expect(root).not.toBeNull();
    expect(root?.textContent).not.toMatch(banned);
    for (const label of Object.values(TOWN_TOUCH_LABELS)) {
      expect(label).not.toMatch(banned);
    }
    const battle = root?.querySelector("[data-cc='battle']") as HTMLButtonElement;
    expect(battle.textContent).toBe("Battle");
    battle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(seen).toContain("battle");

    const pad = root?.querySelector(".cc-pad") as HTMLElement;
    pad.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 180,
        height: 180,
        right: 180,
        bottom: 180,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    pad.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 12, clientY: 90, pointerId: 3 }),
    );
    expect(seen).toContain("left");
    pad.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 3 }));
    expect(seen).toContain("stop");

    const action = root?.querySelector("[data-cc='action']") as HTMLButtonElement;
    action.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(seen).toContain("a");
    ui.destroy();
    expect(document.getElementById("cc-town-touch")).toBeNull();
  });

  it("opens a shop menu and a character picker by tap", () => {
    const picks: number[] = [];
    let action = 0;
    const ui = new TownTouchUi(
      document,
      handlers({
        onMenuPick: index => picks.push(index),
        onCharacterPick: index => picks.push(100 + index),
        onVariantPick: index => picks.push(200 + index),
        onAction: () => {
          action += 1;
        },
      }),
      memoryStore(),
    );
    ui.setOverlay({
      menu: openTownMenu({ id: "mart", kind: "mart", name: "Mart", x: 0, y: 0, w: 32, h: 32, lines: [] }, 500),
      picker: null,
    });
    const root = document.getElementById("cc-town-touch") as HTMLElement;
    expect(root.classList.contains("cc-blocking")).toBe(true);
    const potion = root.querySelector("[data-cc='menu-1']") as HTMLButtonElement;
    expect(potion.textContent).toContain("Potion");
    potion.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(picks).toEqual([1]);

    ui.setOverlay({ menu: null, picker: { index: 0, variant: 0 } });
    const lark = root.querySelector("[data-cc='person-1']") as HTMLButtonElement;
    expect(lark.textContent).toBe("Lark");
    lark.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    const rose = root.querySelector("[data-cc='variant-1']") as HTMLButtonElement;
    rose.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    const choose = root.querySelector("[data-cc='choose']") as HTMLButtonElement;
    choose.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(picks).toEqual([1, 101, 201]);
    expect(action).toBe(1);
    expect(root.textContent).not.toMatch(banned);
    ui.destroy();
  });

  it("hides the rotate hint after Got it, and while a menu is open", () => {
    const store = memoryStore();
    const ui = new TownTouchUi(document, handlers(), store);
    ui.setPortrait(true);
    const root = document.getElementById("cc-town-touch") as HTMLElement;
    const hint = root.querySelector(".cc-rotate") as HTMLElement;
    expect(hint.hidden).toBe(false);
    ui.setOverlay({
      menu: openTownMenu({ id: "center", kind: "center", name: "Center", x: 0, y: 0, w: 32, h: 32, lines: [] }, null),
      picker: null,
    });
    expect(hint.hidden).toBe(true);
    ui.setOverlay({ menu: null, picker: null });
    expect(hint.hidden).toBe(false);
    (root.querySelector("[data-cc='rotate-dismiss']") as HTMLButtonElement).dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    expect(hint.hidden).toBe(true);
    expect(store.getItem(ROTATE_HINT_KEY)).toBe("1");
    ui.setPortrait(false);
    ui.destroy();
  });

  it("suppresses the battle pad only while asked", () => {
    const controls = document.createElement("div");
    controls.id = "touchControls";
    document.body.append(controls);
    setBattleTouchSuppressed(true, document);
    expect(controls.classList.contains("cc-suppressed")).toBe(true);
    setBattleTouchSuppressed(false, document);
    expect(controls.classList.contains("cc-suppressed")).toBe(false);
    controls.remove();
  });

  it("locks the viewport and keeps copy free of banned words", () => {
    const html = readFileSync("index.html", "utf8");
    const css = readFileSync("index.css", "utf8");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain("maximum-scale=1");
    expect(html).toContain("user-scalable=no");
    expect(html).not.toMatch(banned);
    expect(css).toContain("safe-area-inset-bottom");
    expect(css).toContain("safe-area-inset-top");
    expect(css).toContain("overscroll-behavior: none");
    expect(css).toContain("100dvh");
    expect(css).toContain("#touchControls.cc-suppressed");
    expect(css).toContain("#cc-town-touch");
    expect(css).toContain("min-height: 48px");
    expect(css).not.toMatch(banned);
    expect(cardDropCss).toContain("safe-area-inset-bottom");
    expect(cardDropCss).toContain("min-height:48px");
    expect(cardDropCss).toContain("cc-revealed");
    expect(cardDropCss).not.toMatch(banned);
    expect(walletOverlayCss).toContain("safe-area-inset-bottom");
    expect(walletOverlayCss).not.toMatch(banned);
  });
});
