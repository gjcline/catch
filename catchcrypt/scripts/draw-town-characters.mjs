/*
 * Original CatchCrypt town sprites. No third-party or Nintendo art.
 * Packs each character into the misa atlas frame rectangles so the
 * existing walk animation can play the sheets unchanged.
 *
 *   node catchcrypt/scripts/draw-town-characters.mjs
 *   node catchcrypt/scripts/draw-town-characters.mjs --preview out/sheet.png
 */
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const ATLAS = JSON.parse(readFileSync(new URL("../public/town/atlas.json", import.meta.url), "utf8"));
const OUT_DIR = new URL("../public/town/", import.meta.url);

const K = [18, 14, 28, 255];

const SKIN = {
  reed: [236, 204, 176, 255],
  bram: [196, 132, 88, 255],
  nico: [255, 214, 186, 255],
  holt: [168, 108, 72, 255],
  lark: [255, 206, 196, 255],
  piper: [122, 72, 52, 255],
};

function rgba(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

class Pix {
  constructor(w = 32, h = 64) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
  }

  set(x, y, c) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h || !c) {
      return;
    }
    const i = (yi * this.w + xi) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3] ?? 255;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
      return 0;
    }
    return this.data[(y * this.w + x) * 4 + 3];
  }

  /** Filled row with a 1px outline on the ends. */
  row(x, y, w, fill) {
    const xi = Math.round(x);
    const wi = Math.round(w);
    if (wi <= 0) {
      return;
    }
    this.set(xi, y, K);
    if (wi === 1) {
      return;
    }
    this.set(xi + wi - 1, y, K);
    for (let i = 1; i < wi - 1; i++) {
      this.set(xi + i, y, fill);
    }
  }

  rect(x, y, w, h, fill) {
    for (let yy = 0; yy < h; yy++) {
      this.row(x, y + yy, w, fill);
    }
  }

  /** Solid fill, no outline. Used for eyes and soles. */
  solid(x, y, w, h, fill) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        this.set(x + xx, y + yy, fill);
      }
    }
  }

  flipH() {
    const next = new Pix(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const si = (y * this.w + x) * 4;
        const di = (y * this.w + (this.w - 1 - x)) * 4;
        next.data[di] = this.data[si];
        next.data[di + 1] = this.data[si + 1];
        next.data[di + 2] = this.data[si + 2];
        next.data[di + 3] = this.data[si + 3];
      }
    }
    return next;
  }
}

function shift(pose) {
  return pose === "stand" ? 0 : -1;
}

/** Put the lowest pixel on the frame's foot line. Walk poses sit one pixel higher. */
function plant(pix, pose) {
  const target = pose === "stand" ? 63 : 62;
  let bottom = -1;
  for (let y = pix.h - 1; y >= 0; y--) {
    for (let x = 0; x < pix.w; x++) {
      if (pix.get(x, y) > 0) {
        bottom = y;
        break;
      }
    }
    if (bottom >= 0) {
      break;
    }
  }
  if (bottom < 0 || bottom === target) {
    return;
  }
  const dy = target - bottom;
  const copy = Buffer.from(pix.data);
  pix.data.fill(0);
  for (let y = 0; y < pix.h; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= pix.h) {
      continue;
    }
    copy.copy(pix.data, ny * pix.w * 4, y * pix.w * 4, (y + 1) * pix.w * 4);
  }
}

function legs(pose, apart) {
  if (pose === "a") {
    return [
      { x: -apart - 4, y: 0 },
      { x: 3, y: 0 },
    ];
  }
  if (pose === "b") {
    return [
      { x: -apart + 1, y: 0 },
      { x: apart + 2, y: 0 },
    ];
  }
  return [
    { x: -apart, y: 0 },
    { x: 1, y: 0 },
  ];
}

function drawReed(pix, facing, pose) {
  const y0 = 28 + shift(pose);
  const skin = SKIN.reed;
  const hair = rgba("#2a2624");
  const coat = rgba("#243866");
  const coatLite = rgba("#3c5890");
  const pants = rgba("#2c3144");
  const boot = rgba("#6a4630");
  if (facing === "front") {
    pix.rect(13, y0, 6, 4, hair);
    pix.rect(12, y0 + 4, 8, 6, skin);
    pix.solid(14, y0 + 6, 1, 1, K);
    pix.solid(17, y0 + 6, 1, 1, K);
    pix.rect(11, y0 + 10, 10, 20, coat);
    pix.solid(15, y0 + 12, 2, 10, coatLite);
    const pair = legs(pose, 3);
    for (const leg of pair) {
      pix.rect(15 + leg.x, y0 + 30 + leg.y, 3, 4, pants);
      pix.rect(14 + leg.x, y0 + 33 + leg.y, 4, 3, boot);
    }
    return;
  }
  if (facing === "back") {
    pix.rect(13, y0, 6, 4, hair);
    pix.rect(12, y0 + 4, 8, 3, skin);
    pix.rect(11, y0 + 7, 10, 23, coat);
    pix.solid(15, y0 + 10, 2, 16, K);
    const pair = legs(pose, 3);
    for (const leg of pair) {
      pix.rect(15 + leg.x, y0 + 30 + leg.y, 3, 4, pants);
      pix.rect(14 + leg.x, y0 + 33 + leg.y, 4, 3, boot);
    }
    return;
  }
  const step = pose === "a" ? -5 : pose === "b" ? 4 : 0;
  pix.rect(13, y0, 6, 4, hair);
  pix.rect(12, y0 + 4, 7, 6, skin);
  pix.solid(13, y0 + 6, 1, 1, K);
  pix.rect(12, y0 + 10, 8, 20, coat);
  pix.rect(10 + step, y0 + 30, 4, 5, pants);
  pix.rect(9 + step, y0 + 34, 5, 3, boot);
  if (pose !== "stand") {
    pix.rect(16 - step, y0 + 31, 3, 4, pants);
    pix.rect(16 - step, y0 + 34, 4, 3, boot);
  }
}

function drawBram(pix, facing, pose) {
  const y0 = 27 + shift(pose);
  const skin = SKIN.bram;
  const cap = rgba("#2f7a3a");
  const brim = rgba("#1e5228");
  const beard = rgba("#6b4423");
  const vest = rgba("#c9843a");
  const shirt = rgba("#f2e2c4");
  const pants = rgba("#4a3424");
  const shoe = rgba("#2a2420");
  if (facing === "front") {
    pix.rect(10, y0, 12, 4, cap);
    pix.rect(7, y0 + 3, 18, 2, brim);
    pix.rect(11, y0 + 5, 10, 6, skin);
    pix.rect(10, y0 + 9, 12, 5, beard);
    pix.solid(14, y0 + 7, 1, 1, K);
    pix.solid(18, y0 + 7, 1, 1, K);
    pix.rect(6, y0 + 13, 20, 12, vest);
    pix.rect(13, y0 + 15, 6, 8, shirt);
    const pair = legs(pose, 6);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 25 + leg.y, 5, 6, pants);
      pix.rect(13 + leg.x, y0 + 30 + leg.y, 6, 3, shoe);
    }
    return;
  }
  if (facing === "back") {
    pix.rect(10, y0, 12, 4, cap);
    pix.rect(7, y0 + 3, 18, 2, brim);
    pix.rect(11, y0 + 5, 10, 3, skin);
    pix.rect(6, y0 + 8, 20, 16, vest);
    const pair = legs(pose, 6);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 24 + leg.y, 5, 7, pants);
      pix.rect(13 + leg.x, y0 + 30 + leg.y, 6, 3, shoe);
    }
    return;
  }
  const step = pose === "a" ? -5 : pose === "b" ? 4 : 0;
  pix.rect(12, y0, 8, 4, cap);
  pix.rect(6, y0 + 3, 12, 2, brim);
  pix.rect(12, y0 + 5, 8, 6, skin);
  pix.rect(12, y0 + 9, 8, 4, beard);
  pix.solid(13, y0 + 7, 1, 1, K);
  pix.rect(10, y0 + 12, 12, 12, vest);
  pix.rect(8 + step, y0 + 24, 5, 7, pants);
  pix.rect(7 + step, y0 + 30, 6, 3, shoe);
  if (pose !== "stand") {
    pix.rect(16 - Math.sign(step), y0 + 26, 4, 5, pants);
    pix.rect(16 - Math.sign(step), y0 + 30, 5, 3, shoe);
  }
}

function drawNico(pix, facing, pose) {
  const y0 = 26 + shift(pose);
  const skin = SKIN.nico;
  const hair = rgba("#ff7a18");
  const hood = rgba("#1aa3a8");
  const hoodDark = rgba("#0e6e74");
  const jean = rgba("#2a3c78");
  const shoe = rgba("#f4f4f4");
  const sole = rgba("#22262e");
  const spikes = [
    [11, 0, 3, 6],
    [15, -1, 3, 7],
    [19, 0, 3, 6],
  ];
  if (facing === "front") {
    for (const [x, dy, w, h] of spikes) {
      pix.rect(x, y0 + dy, w, h, hair);
    }
    pix.rect(12, y0 + 6, 8, 6, skin);
    pix.solid(14, y0 + 8, 1, 1, K);
    pix.solid(17, y0 + 8, 1, 1, K);
    pix.rect(10, y0 + 12, 12, 13, hood);
    pix.rect(9, y0 + 12, 3, 5, hoodDark);
    pix.rect(20, y0 + 12, 3, 5, hoodDark);
    pix.rect(13, y0 + 18, 6, 4, hoodDark);
    const pair = legs(pose, 3);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 25 + leg.y, 3, 6, jean);
      pix.rect(13 + leg.x, y0 + 31 + leg.y, 5, 2, shoe);
      pix.solid(13 + leg.x, y0 + 33 + leg.y, 5, 1, sole);
    }
    return;
  }
  if (facing === "back") {
    for (const [x, dy, w, h] of spikes) {
      pix.rect(x, y0 + dy, w, h, hair);
    }
    pix.rect(12, y0 + 6, 8, 3, skin);
    pix.rect(9, y0 + 9, 14, 15, hood);
    pix.rect(13, y0 + 12, 6, 8, hoodDark);
    const pair = legs(pose, 3);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 24 + leg.y, 3, 7, jean);
      pix.rect(13 + leg.x, y0 + 31 + leg.y, 5, 2, shoe);
      pix.solid(13 + leg.x, y0 + 33 + leg.y, 5, 1, sole);
    }
    return;
  }
  const step = pose === "a" ? -5 : pose === "b" ? 4 : 0;
  pix.rect(14, y0, 3, 6, hair);
  pix.rect(12, y0 + 2, 3, 5, hair);
  pix.rect(17, y0 + 1, 3, 6, hair);
  pix.rect(13, y0 + 6, 7, 6, skin);
  pix.solid(14, y0 + 8, 1, 1, K);
  pix.rect(12, y0 + 12, 9, 12, hood);
  pix.rect(18, y0 + 12, 4, 6, hoodDark);
  pix.rect(11 + step, y0 + 24, 4, 7, jean);
  pix.rect(10 + step, y0 + 31, 5, 2, shoe);
  pix.solid(10 + step, y0 + 33, 5, 1, sole);
  if (pose !== "stand") {
    pix.rect(17, y0 + 26, 3, 5, jean);
    pix.rect(17, y0 + 31, 4, 2, shoe);
    pix.solid(17, y0 + 33, 4, 1, sole);
  }
}

function drawHolt(pix, facing, pose) {
  const y0 = 26 + shift(pose);
  const skin = SKIN.holt;
  const hat = rgba("#241c18");
  const brim = rgba("#3a3028");
  const stash = rgba("#3a2418");
  const poncho = rgba("#c43838");
  const ponchoDark = rgba("#8e2428");
  const boot = rgba("#3a2c24");
  const brimRow = (y, x, w) => pix.rect(x, y, w, 2, brim);
  if (facing === "front") {
    pix.rect(13, y0, 6, 4, hat);
    brimRow(y0 + 3, 5, 22);
    pix.rect(12, y0 + 5, 8, 6, skin);
    pix.rect(11, y0 + 9, 10, 2, stash);
    pix.solid(14, y0 + 7, 1, 1, K);
    pix.solid(17, y0 + 7, 1, 1, K);
    for (let i = 0; i < 16; i++) {
      const inset = Math.max(0, 8 - Math.floor(i * 0.55));
      pix.row(8 + inset / 2, y0 + 12 + i, 16 - inset, i % 4 === 0 ? ponchoDark : poncho);
    }
    const pair = legs(pose, 3);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 28 + leg.y, 4, 4, boot);
    }
    return;
  }
  if (facing === "back") {
    pix.rect(13, y0, 6, 4, hat);
    brimRow(y0 + 3, 5, 22);
    pix.rect(13, y0 + 5, 6, 2, skin);
    for (let i = 0; i < 18; i++) {
      const inset = Math.max(0, 8 - Math.floor(i * 0.5));
      pix.row(8 + inset / 2, y0 + 8 + i, 16 - inset, poncho);
    }
    pix.solid(15, y0 + 12, 2, 8, ponchoDark);
    const pair = legs(pose, 3);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 26 + leg.y, 4, 5, boot);
    }
    return;
  }
  const step = pose === "a" ? -5 : pose === "b" ? 4 : 0;
  pix.rect(14, y0, 5, 4, hat);
  pix.rect(4, y0 + 3, 16, 2, brim);
  pix.rect(13, y0 + 5, 7, 6, skin);
  pix.rect(12, y0 + 9, 6, 2, stash);
  pix.solid(14, y0 + 7, 1, 1, K);
  for (let i = 0; i < 16; i++) {
    const grow = Math.floor(i * 0.35);
    pix.row(12 - grow, y0 + 12 + i, 8 + grow, poncho);
  }
  pix.rect(11 + step, y0 + 28, 5, 4, boot);
  if (pose !== "stand") {
    pix.rect(17, y0 + 30, 4, 3, boot);
  }
}

function drawLark(pix, facing, pose) {
  const y0 = 26 + shift(pose);
  const skin = SKIN.lark;
  const hair = rgba("#5a3428");
  const hairLite = rgba("#8a5844");
  const dress = rgba("#3e62b4");
  const dressLite = rgba("#6a88d4");
  const shoe = rgba("#f4efe6");
  if (facing === "front") {
    pix.rect(12, y0, 8, 5, hair);
    pix.rect(8, y0 + 4, 4, 18, hair);
    pix.rect(20, y0 + 4, 4, 18, hair);
    pix.solid(9, y0 + 8, 2, 8, hairLite);
    pix.rect(12, y0 + 5, 8, 6, skin);
    pix.solid(14, y0 + 7, 1, 1, K);
    pix.solid(17, y0 + 7, 1, 1, K);
    pix.rect(12, y0 + 11, 8, 8, dress);
    pix.solid(14, y0 + 12, 4, 2, dressLite);
    for (let i = 0; i < 12; i++) {
      const grow = Math.floor(i * 0.45);
      pix.row(11 - grow, y0 + 19 + i, 10 + grow * 2, dress);
    }
    const pair = legs(pose, 3);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 31 + leg.y, 3, 3, shoe);
    }
    return;
  }
  if (facing === "back") {
    pix.rect(10, y0, 12, 22, hair);
    pix.solid(12, y0 + 4, 3, 12, hairLite);
    for (let i = 0; i < 12; i++) {
      const grow = Math.floor(i * 0.4);
      pix.row(11 - grow, y0 + 20 + i, 10 + grow * 2, dress);
    }
    const pair = legs(pose, 3);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 32 + leg.y, 3, 2, shoe);
    }
    return;
  }
  const step = pose === "a" ? -4 : pose === "b" ? 3 : 0;
  pix.rect(14, y0, 6, 5, hair);
  pix.rect(16, y0 + 4, 7, 18, hair);
  pix.rect(12, y0 + 5, 7, 6, skin);
  pix.solid(13, y0 + 7, 1, 1, K);
  pix.rect(13, y0 + 11, 7, 8, dress);
  for (let i = 0; i < 12; i++) {
    const grow = Math.floor(i * 0.4);
    pix.row(12, y0 + 19 + i, 7 + grow, dress);
  }
  pix.rect(12 + step, y0 + 31, 4, 3, shoe);
}

function drawPiper(pix, facing, pose) {
  const y0 = 28 + shift(pose);
  const skin = SKIN.piper;
  const hair = rgba("#1c1418");
  const tail = rgba("#3a242c");
  const jacket = rgba("#f0b429");
  const jacketDark = rgba("#c48a16");
  const shorts = rgba("#24386a");
  const shoe = rgba("#e23b4a");
  if (facing === "front") {
    pix.rect(12, y0 + 2, 8, 5, hair);
    pix.rect(20, y0, 4, 3, tail);
    pix.rect(23, y0 + 2, 3, 8, tail);
    pix.rect(12, y0 + 6, 8, 6, skin);
    pix.solid(14, y0 + 8, 1, 1, K);
    pix.solid(17, y0 + 8, 1, 1, K);
    pix.rect(10, y0 + 12, 12, 9, jacket);
    pix.rect(10, y0 + 12, 3, 6, jacketDark);
    pix.rect(19, y0 + 12, 3, 6, jacketDark);
    pix.rect(11, y0 + 21, 10, 5, shorts);
    const pair = legs(pose, 4);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 26 + leg.y, 3, 5, skin);
      pix.rect(13 + leg.x, y0 + 31 + leg.y, 4, 3, shoe);
    }
    return;
  }
  if (facing === "back") {
    pix.rect(12, y0 + 2, 8, 4, hair);
    pix.rect(14, y0, 4, 4, tail);
    pix.rect(14, y0 + 4, 4, 14, tail);
    pix.rect(11, y0 + 12, 10, 9, jacket);
    pix.rect(12, y0 + 21, 8, 5, shorts);
    const pair = legs(pose, 4);
    for (const leg of pair) {
      pix.rect(14 + leg.x, y0 + 26 + leg.y, 3, 5, skin);
      pix.rect(13 + leg.x, y0 + 31 + leg.y, 4, 3, shoe);
    }
    return;
  }
  const step = pose === "a" ? -5 : pose === "b" ? 4 : 0;
  pix.rect(13, y0 + 2, 6, 5, hair);
  pix.rect(18, y0 + 1, 3, 4, tail);
  pix.rect(20, y0 + 4, 6, 3, tail);
  pix.rect(12, y0 + 6, 7, 6, skin);
  pix.solid(13, y0 + 8, 1, 1, K);
  pix.rect(11, y0 + 12, 9, 9, jacket);
  pix.rect(11, y0 + 21, 8, 5, shorts);
  pix.rect(10 + step, y0 + 26, 3, 5, skin);
  pix.rect(9 + step, y0 + 31, 4, 3, shoe);
  if (pose !== "stand") {
    pix.rect(16, y0 + 27, 3, 4, skin);
    pix.rect(16, y0 + 31, 4, 3, shoe);
  }
}

const DRAW = {
  reed: drawReed,
  bram: drawBram,
  nico: drawNico,
  holt: drawHolt,
  lark: drawLark,
  piper: drawPiper,
};

export const CAST = [
  { id: "reed", name: "Reed", gender: "male" },
  { id: "bram", name: "Bram", gender: "male" },
  { id: "nico", name: "Nico", gender: "male" },
  { id: "holt", name: "Holt", gender: "male" },
  { id: "lark", name: "Lark", gender: "female" },
  { id: "piper", name: "Piper", gender: "female" },
];

function drawSheet(id) {
  const draw = DRAW[id];
  const w = ATLAS.meta.size.w;
  const h = ATLAS.meta.size.h;
  const atlas = Buffer.alloc(w * h * 4);
  const seen = new Set();
  for (const [name, frame] of Object.entries(ATLAS.frames)) {
    const rect = frame.frame;
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    let facing = "front";
    if (name.includes("back")) {
      facing = "back";
    } else if (name.includes("left")) {
      facing = "left";
    } else if (name.includes("right")) {
      facing = "right";
    }
    let pose = "stand";
    if (name.includes("walk.000")) {
      pose = "a";
    } else if (name.includes("walk.002")) {
      pose = "b";
    }
    let pix = new Pix();
    draw(pix, facing === "right" ? "left" : facing, pose);
    plant(pix, pose);
    if (facing === "right") {
      pix = pix.flipH();
    }
    const src = frame.spriteSourceSize;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const sx = src.x + x;
        const sy = src.y + y;
        if (sx < 0 || sy < 0 || sx >= 32 || sy >= 64) {
          continue;
        }
        const si = (sy * 32 + sx) * 4;
        if (pix.data[si + 3] === 0) {
          continue;
        }
        const di = ((rect.y + y) * w + (rect.x + x)) * 4;
        atlas[di] = pix.data[si];
        atlas[di + 1] = pix.data[si + 1];
        atlas[di + 2] = pix.data[si + 2];
        atlas[di + 3] = pix.data[si + 3];
      }
    }
  }
  return { w, h, data: atlas };
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const kind = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([kind, data])), 0);
  return Buffer.concat([length, kind, data, crc]);
}

export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(path) {
  const buf = readFileSync(path);
  let offset = 8;
  const chunks = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString();
    const data = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const ihdr = chunks.find(chunk => chunk.type === "IHDR").data;
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const bit = ihdr[8];
  const color = ihdr[9];
  if (bit !== 8 || (color !== 6 && color !== 2 && color !== 3)) {
    throw new Error(`unsupported png ${bit}/${color} in ${path}`);
  }
  const channels = color === 6 ? 4 : color === 2 ? 3 : 1;
  const idat = Buffer.concat(chunks.filter(chunk => chunk.type === "IDAT").map(chunk => chunk.data));
  const raw = inflateSync(idat);
  const bpp = channels;
  const stride = w * bpp;
  const samples = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) {
      return a;
    }
    return pb <= pc ? b : c;
  };
  let s = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[s++];
    const row = samples.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : samples.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev ? prev[x] : 0;
      const ul = prev && x >= bpp ? prev[x - bpp] : 0;
      const value = raw[s++];
      if (filter === 0) {
        row[x] = value;
      } else if (filter === 1) {
        row[x] = (value + left) & 255;
      } else if (filter === 2) {
        row[x] = (value + up) & 255;
      } else if (filter === 3) {
        row[x] = (value + ((left + up) >> 1)) & 255;
      } else if (filter === 4) {
        row[x] = (value + paeth(left, up, ul)) & 255;
      } else {
        throw new Error(`unsupported png filter ${filter} in ${path}`);
      }
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  const plte = chunks.find(chunk => chunk.type === "PLTE")?.data;
  const trns = chunks.find(chunk => chunk.type === "tRNS")?.data;
  for (let i = 0; i < w * h; i++) {
    const di = i * 4;
    if (color === 3) {
      const index = samples[i];
      rgba[di] = plte[index * 3];
      rgba[di + 1] = plte[index * 3 + 1];
      rgba[di + 2] = plte[index * 3 + 2];
      rgba[di + 3] = trns && index < trns.length ? trns[index] : 255;
    } else if (color === 2) {
      rgba[di] = samples[i * 3];
      rgba[di + 1] = samples[i * 3 + 1];
      rgba[di + 2] = samples[i * 3 + 2];
      rgba[di + 3] = 255;
    } else {
      rgba[di] = samples[i * 4];
      rgba[di + 1] = samples[i * 4 + 1];
      rgba[di + 2] = samples[i * 4 + 2];
      rgba[di + 3] = samples[i * 4 + 3];
    }
  }
  return { w, h, data: rgba };
}

function alphaMask(image) {
  let mask = "";
  for (let i = 3; i < image.data.length; i += 4) {
    mask += image.data[i] > 16 ? "1" : "0";
  }
  return mask;
}

function sheetFile(id) {
  if (id === "misa") {
    return "atlas.png";
  }
  if (id.startsWith("misa-")) {
    return `atlas-${id.slice("misa-".length)}.png`;
  }
  return `atlas-${id}.png`;
}

function sheetPath(id) {
  return join(fileURLToPath(OUT_DIR), sheetFile(id));
}

function frameMask(image, frameName) {
  const rect = ATLAS.frames[frameName].frame;
  let mask = "";
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const alpha = image.data[((rect.y + y) * image.w + (rect.x + x)) * 4 + 3];
      mask += alpha > 16 ? "1" : "0";
    }
  }
  return mask;
}

const ORIGINAL_IDS = ["lark", "piper", "reed", "bram", "nico", "holt"];
const RECOLOR_IDS = ["misa-rose", "misa-sea", "misa-moss", "misa-gold", "misa-dusk"];

/** Reads the committed sheets and rejects a cast that still shares Misa's outline. */
export function assertDistinctSheets() {
  const misa = decodePng(sheetPath("misa"));
  const misaMask = alphaMask(misa);
  for (const id of RECOLOR_IDS) {
    const image = decodePng(sheetPath(id));
    if (image.w !== misa.w || image.h !== misa.h) {
      throw new Error(`${id} is ${image.w}x${image.h}, expected ${misa.w}x${misa.h}`);
    }
    if (alphaMask(image) !== misaMask) {
      throw new Error(`${id} changed Misa's silhouette`);
    }
  }
  const masks = new Set();
  for (const id of ORIGINAL_IDS) {
    const image = decodePng(sheetPath(id));
    if (image.w !== misa.w || image.h !== misa.h) {
      throw new Error(`${id} is ${image.w}x${image.h}, expected ${misa.w}x${misa.h}`);
    }
    const mask = alphaMask(image);
    if (mask === misaMask) {
      throw new Error(`${id} silhouette matches Misa`);
    }
    if (masks.has(mask)) {
      throw new Error(`${id} shares a silhouette with another character`);
    }
    masks.add(mask);
    for (const facing of ["front", "back", "left", "right"]) {
      const stand = frameMask(image, `misa-${facing}`);
      const step = frameMask(image, `misa-${facing}-walk.000`);
      if (!stand.includes("1") || !step.includes("1")) {
        throw new Error(`${id} ${facing} frame is empty`);
      }
      if (stand === step) {
        throw new Error(`${id} ${facing} walk matches the idle pose`);
      }
    }
  }
}

function blitPreview(dest, destW, image, dx, dy, scale) {
  for (let y = 0; y < image.h; y++) {
    for (let x = 0; x < image.w; x++) {
      const si = (y * image.w + x) * 4;
      const a = image.data[si + 3];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = dx + x * scale + sx;
          const py = dy + y * scale + sy;
          const di = (py * destW + px) * 4;
          if (a < 16) {
            const checker = ((px >> 2) ^ (py >> 2)) & 1;
            dest[di] = checker ? 48 : 32;
            dest[di + 1] = checker ? 52 : 36;
            dest[di + 2] = checker ? 64 : 44;
            dest[di + 3] = 255;
            continue;
          }
          dest[di] = image.data[si];
          dest[di + 1] = image.data[si + 1];
          dest[di + 2] = image.data[si + 2];
          dest[di + 3] = 255;
        }
      }
    }
  }
}

function frameImage(sheet, frameName) {
  const frame = ATLAS.frames[frameName];
  const rect = frame.frame;
  const image = { w: rect.w, h: rect.h, data: Buffer.alloc(rect.w * rect.h * 4) };
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const si = ((rect.y + y) * sheet.w + (rect.x + x)) * 4;
      const di = (y * rect.w + x) * 4;
      image.data[di] = sheet.data[si];
      image.data[di + 1] = sheet.data[si + 1];
      image.data[di + 2] = sheet.data[si + 2];
      image.data[di + 3] = sheet.data[si + 3];
    }
  }
  return image;
}

const FONT = {
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  Y: ["101", "101", "010", "010", "010"],
};

function drawLabel(dest, destW, text, x, y) {
  let cursor = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (!glyph) {
      cursor += 8;
      continue;
    }
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== "1") {
          continue;
        }
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const di = ((y + gy * 2 + sy) * destW + (cursor + gx * 2 + sx)) * 4;
            dest[di] = 255;
            dest[di + 1] = 244;
            dest[di + 2] = 220;
            dest[di + 3] = 255;
          }
        }
      }
    }
    cursor += 8;
  }
}

function buildPreview(sheets, misa) {
  const scale = 4;
  const cellW = 46 * scale;
  const cellH = 52 * scale;
  const labelH = 18;
  const cols = ["front", "front walk", "left", "left walk", "back"];
  const keys = ["misa-front", "misa-front-walk.000", "misa-left", "misa-left-walk.000", "misa-back"];
  const rows = [{ name: "Misa", sheet: misa }, ...sheets];
  const width = 16 + cols.length * cellW;
  const height = 28 + rows.length * (cellH + labelH);
  const dest = Buffer.alloc(width * height * 4);
  dest.fill(18);
  for (let i = 3; i < dest.length; i += 4) {
    dest[i] = 255;
  }
  drawLabel(dest, width, "FRONT  STEP   LEFT   STEP   BACK", 16, 6);
  rows.forEach((row, index) => {
    const top = 28 + index * (cellH + labelH);
    drawLabel(dest, width, row.name, 4, top + 4);
    keys.forEach((key, col) => {
      const image = frameImage(row.sheet, key);
      blitPreview(dest, width, image, 70 + col * cellW, top, scale);
    });
  });
  return { w: width, h: height, data: dest };
}

function main() {
  const previewFlag = process.argv.indexOf("--preview");
  const checkOnly = process.argv.includes("--check");
  const sheets = checkOnly
    ? []
    : CAST.map(character => {
        const sheet = drawSheet(character.id);
        const file = sheetPath(character.id);
        writeFileSync(file, encodePng(sheet.w, sheet.h, sheet.data));
        console.log(`wrote ${file}`);
        return { ...character, sheet, file };
      });
  assertDistinctSheets();
  console.log("sheets are distinct");
  if (previewFlag >= 0) {
    const dest = process.argv[previewFlag + 1];
    mkdirSync(dirname(dest), { recursive: true });
    const misa = decodePng(sheetPath("misa"));
    const rows =
      sheets.length > 0
        ? sheets.map(sheet => ({ name: sheet.name, sheet: sheet.sheet }))
        : CAST.map(character => ({ name: character.name, sheet: decodePng(sheetPath(character.id)) }));
    const preview = buildPreview(rows, misa);
    writeFileSync(dest, encodePng(preview.w, preview.h, preview.data));
    console.log(`preview ${dest}`);
  }
}

function fileURLToPath(url) {
  return decodeURIComponent(url.pathname);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
