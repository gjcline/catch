/*
 * On-screen town controls for phones. AGPL-3.0.
 * Desktop keeps the keyboard and the Phaser buttons. This overlay is mounted only
 * when the device is touch-first, and it sits in the letterbox around the 16:9 canvas.
 */
import { type CharacterPickerState, misaVariants, previewCaption, townCharacters } from "#app/catch/town-characters";
import type { TownMenu } from "#app/catch/town-shops";

export type Cardinal = "up" | "down" | "left" | "right";

export const TOWN_TOUCH_LABELS = {
  battle: "Battle",
  party: "Pokémon",
  character: "Character",
  action: "A",
  back: "B",
  rotate: "Turn sideways for a wider view of the town.",
  rotateDismiss: "Got it",
  menuHint: "Tap a choice. A confirms. B closes.",
  pickerHint: "Tap a person. A confirms. B closes.",
  choose: "Choose",
} as const;

export const ROTATE_HINT_KEY = "cc_rotate_hint_off";

/** Cap a hitch so a stalled frame cannot shove the player through a wall. */
export function stepPixels(dtMs: number, pxPerSec = 150): number {
  const dt = Math.min(Math.max(dtMs, 0), 50);
  return (pxPerSec * dt) / 1000;
}

/** One axis at a time. Left and right win over up and down, matching the keyboard. */
export function walkAxis(left: boolean, right: boolean, up: boolean, down: boolean): Cardinal | null {
  if (left) {
    return "left";
  }
  if (right) {
    return "right";
  }
  if (up) {
    return "up";
  }
  if (down) {
    return "down";
  }
  return null;
}

/**
 * Four-way stick. The whole pad is the hit target; the stronger axis wins.
 * A press in the middle (inside the dead zone) does not move.
 */
export function dpadDirection(localX: number, localY: number, size: number): Cardinal | null {
  if (!(size > 0) || !Number.isFinite(localX) || !Number.isFinite(localY)) {
    return null;
  }
  const dx = localX - size / 2;
  const dy = localY - size / 2;
  const dead = size * 0.18;
  if (dx * dx + dy * dy < dead * dead) {
    return null;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? "left" : "right";
  }
  return dy < 0 ? "up" : "down";
}

/** Portrait touch gets one dismissible line. Landscape and a stored dismissal stay quiet. */
export function rotateHintWanted(input: { portrait: boolean; dismissed: boolean }): boolean {
  return input.portrait && !input.dismissed;
}

export interface TownTouchHandlers {
  onMove: (dir: Cardinal | null) => void;
  onAction: () => void;
  onBack: () => void;
  onBattle: () => void;
  onParty: () => void;
  onCharacter: () => void;
  onMenuPick: (index: number) => void;
  onCharacterPick: (index: number) => void;
  onVariantPick: (index: number) => void;
}

interface HintStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeSession(): HintStore | null {
  try {
    if (typeof sessionStorage === "undefined") {
      return null;
    }
    return sessionStorage;
  } catch {
    return null;
  }
}

function press(node: HTMLElement, run: () => void): void {
  node.addEventListener("pointerdown", event => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    node.classList.add("cc-hot");
    run();
  });
  const clear = () => node.classList.remove("cc-hot");
  node.addEventListener("pointerup", clear);
  node.addEventListener("pointercancel", clear);
  node.addEventListener("pointerleave", clear);
}

function button(doc: Document, label: string, cc: string, run: () => void): HTMLButtonElement {
  const el = doc.createElement("button");
  el.type = "button";
  el.dataset.cc = cc;
  el.textContent = label;
  press(el, run);
  return el;
}

/**
 * DOM controls for the town. Pointer events on the pad and the buttons never
 * reach the canvas, and empty space does, so mouse and tap-the-mat still work.
 */
export class TownTouchUi {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly pad: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly rotate: HTMLElement;
  private readonly handlers: TownTouchHandlers;
  private readonly storage: HintStore | null;
  private menu: TownMenu | null = null;
  private picker: CharacterPickerState | null = null;
  private padPointer: number | null = null;
  private portrait = false;
  private dismissed = false;
  private hidden = false;

  constructor(doc: Document, handlers: TownTouchHandlers, storage?: HintStore | null) {
    this.handlers = handlers;
    this.doc = doc;
    this.storage = storage === undefined ? safeSession() : storage;
    try {
      this.dismissed = this.storage?.getItem(ROTATE_HINT_KEY) === "1";
    } catch {
      this.dismissed = false;
    }

    doc.getElementById("cc-town-touch")?.remove();
    const root = doc.createElement("div");
    root.id = "cc-town-touch";
    this.root = root;

    const top = doc.createElement("div");
    top.className = "cc-top";
    top.append(
      button(doc, TOWN_TOUCH_LABELS.battle, "battle", () => handlers.onBattle()),
      button(doc, TOWN_TOUCH_LABELS.party, "party", () => handlers.onParty()),
      button(doc, TOWN_TOUCH_LABELS.character, "character", () => handlers.onCharacter()),
    );

    const rotate = doc.createElement("div");
    rotate.className = "cc-rotate";
    rotate.hidden = true;
    const note = doc.createElement("p");
    note.textContent = TOWN_TOUCH_LABELS.rotate;
    rotate.append(
      note,
      button(doc, TOWN_TOUCH_LABELS.rotateDismiss, "rotate-dismiss", () => this.dismissRotate()),
    );
    this.rotate = rotate;

    const sheet = doc.createElement("div");
    sheet.className = "cc-sheet";
    sheet.hidden = true;
    const panel = doc.createElement("div");
    panel.className = "cc-panel";
    sheet.append(panel);
    sheet.addEventListener("pointerdown", event => {
      if (event.target === sheet) {
        event.preventDefault();
        handlers.onBack();
      }
    });
    this.sheet = sheet;
    this.panel = panel;

    const pad = doc.createElement("div");
    pad.className = "cc-pad";
    pad.setAttribute("role", "group");
    pad.setAttribute("aria-label", "Move");
    for (const name of ["h", "v", "up", "down", "left", "right"]) {
      const mark = doc.createElement("span");
      mark.className = `cc-pad-${name}`;
      if (name === "up") {
        mark.textContent = "▲";
      } else if (name === "down") {
        mark.textContent = "▼";
      } else if (name === "left") {
        mark.textContent = "◀";
      } else if (name === "right") {
        mark.textContent = "▶";
      }
      pad.append(mark);
    }
    pad.addEventListener("pointerdown", event => this.onPadDown(event));
    pad.addEventListener("pointermove", event => this.onPadMove(event));
    pad.addEventListener("pointerup", event => this.onPadUp(event));
    pad.addEventListener("pointercancel", event => this.onPadUp(event));
    this.pad = pad;

    const actions = doc.createElement("div");
    actions.className = "cc-actions";
    const action = button(doc, TOWN_TOUCH_LABELS.action, "action", () => handlers.onAction());
    action.setAttribute("aria-label", "Confirm");
    action.classList.add("cc-a");
    const back = button(doc, TOWN_TOUCH_LABELS.back, "back", () => handlers.onBack());
    back.setAttribute("aria-label", "Back");
    back.classList.add("cc-b");
    actions.append(action, back);

    const bottom = doc.createElement("div");
    bottom.className = "cc-bottom";
    bottom.append(pad, actions);

    root.append(top, rotate, sheet, bottom);
    doc.body.append(root);
    this.portrait = window.matchMedia?.("(orientation: portrait)")?.matches === true;
    this.syncRotate();
  }

  setPortrait(portrait: boolean): void {
    this.portrait = portrait;
    this.syncRotate();
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.root.classList.toggle("cc-hidden", hidden);
    if (hidden) {
      this.release();
    }
    this.syncRotate();
  }

  setOverlay(state: { menu: TownMenu | null; picker: CharacterPickerState | null }): void {
    this.menu = state.menu;
    this.picker = state.picker;
    this.root.classList.toggle("cc-blocking", state.menu !== null || state.picker !== null);
    this.renderSheet();
    this.syncRotate();
  }

  /** Drop a held direction. Used when the page hides or the party screen covers the town. */
  release(): void {
    this.padPointer = null;
    this.pad.classList.remove("cc-hot");
    this.handlers.onMove(null);
  }

  destroy(): void {
    this.release();
    this.root.remove();
  }

  private dismissRotate(): void {
    this.dismissed = true;
    try {
      this.storage?.setItem(ROTATE_HINT_KEY, "1");
    } catch {
      // Private mode can reject the write. The hint still stays gone for this visit.
    }
    this.syncRotate();
  }

  private syncRotate(): void {
    const blocking = this.menu !== null || this.picker !== null;
    const wanted = rotateHintWanted({ portrait: this.portrait, dismissed: this.dismissed });
    this.rotate.hidden = this.hidden || blocking || !wanted;
  }

  private onPadDown(event: PointerEvent): void {
    if (event.button !== 0 || this.padPointer !== null) {
      return;
    }
    event.preventDefault();
    this.padPointer = event.pointerId;
    try {
      this.pad.setPointerCapture?.(event.pointerId);
    } catch {
      // A few test environments expose setPointerCapture and then refuse to run it.
    }
    this.pointPad(event);
  }

  private onPadMove(event: PointerEvent): void {
    if (event.pointerId !== this.padPointer) {
      return;
    }
    event.preventDefault();
    this.pointPad(event);
  }

  private onPadUp(event: PointerEvent): void {
    if (event.pointerId !== this.padPointer) {
      return;
    }
    event.preventDefault();
    this.release();
  }

  private pointPad(event: PointerEvent): void {
    const rect = this.pad.getBoundingClientRect();
    const dir = dpadDirection(event.clientX - rect.left, event.clientY - rect.top, rect.width);
    this.pad.classList.toggle("cc-hot", dir !== null);
    this.handlers.onMove(dir);
  }

  private renderSheet(): void {
    this.panel.replaceChildren();
    const menu = this.menu;
    const picker = this.picker;
    if (!menu && !picker) {
      this.sheet.hidden = true;
      return;
    }
    this.sheet.hidden = false;
    if (menu) {
      this.renderMenu(menu);
      return;
    }
    if (picker) {
      this.renderPicker(picker);
    }
  }

  private renderMenu(menu: TownMenu): void {
    this.panel.style.borderColor = menuBorder(menu.spot.kind);
    const title = this.doc.createElement("h2");
    title.textContent = menu.title;
    const message = this.doc.createElement("p");
    message.className = "cc-copy";
    message.textContent = menu.message;
    this.panel.append(title, message);
    for (let index = 0; index < menu.options.length; index++) {
      const option = menu.options[index];
      if (!option) {
        continue;
      }
      const choice = button(this.doc, option.label, `menu-${index}`, () => this.handlers.onMenuPick(index));
      choice.classList.add("cc-opt");
      if (index === menu.index) {
        choice.classList.add("cc-on");
      }
      this.panel.append(choice);
    }
    const hint = this.doc.createElement("p");
    hint.className = "cc-hint";
    hint.textContent = TOWN_TOUCH_LABELS.menuHint;
    this.panel.append(hint);
  }

  private renderPicker(picker: CharacterPickerState): void {
    this.panel.style.borderColor = "#7dcea0";
    const title = this.doc.createElement("h2");
    title.textContent = TOWN_TOUCH_LABELS.character;
    const caption = this.doc.createElement("p");
    caption.className = "cc-copy";
    caption.textContent = previewCaption(picker);
    this.panel.append(title, caption);
    if (townCharacters[picker.index]?.id === "misa") {
      const chips = this.doc.createElement("div");
      chips.className = "cc-chips";
      for (let index = 0; index < misaVariants.length; index++) {
        const variant = misaVariants[index];
        if (!variant) {
          continue;
        }
        const chip = button(this.doc, variant.name, `variant-${index}`, () => this.handlers.onVariantPick(index));
        chip.classList.add("cc-chip");
        if (index === picker.variant) {
          chip.classList.add("cc-on");
        }
        chips.append(chip);
      }
      this.panel.append(chips);
    }
    const grid = this.doc.createElement("div");
    grid.className = "cc-grid";
    for (let index = 0; index < townCharacters.length; index++) {
      const character = townCharacters[index];
      if (!character) {
        continue;
      }
      const choice = button(this.doc, character.name, `person-${index}`, () => this.handlers.onCharacterPick(index));
      choice.classList.add("cc-opt");
      if (index === picker.index) {
        choice.classList.add("cc-on");
      }
      grid.append(choice);
    }
    this.panel.append(grid);
    const choose = button(this.doc, TOWN_TOUCH_LABELS.choose, "choose", () => this.handlers.onAction());
    choose.classList.add("cc-choose");
    const hint = this.doc.createElement("p");
    hint.className = "cc-hint";
    hint.textContent = TOWN_TOUCH_LABELS.pickerHint;
    this.panel.append(choose, hint);
  }
}

function menuBorder(kind: TownMenu["spot"]["kind"]): string {
  if (kind === "mart") {
    return "#6ec1ff";
  }
  if (kind === "center") {
    return "#ff8fa3";
  }
  return "#f6d36b";
}

/** Hide the battle D-pad while the town overlay is up so the two pads do not stack. */
export function setBattleTouchSuppressed(suppressed: boolean, doc: Document = document): void {
  doc.getElementById("touchControls")?.classList.toggle("cc-suppressed", suppressed);
}
