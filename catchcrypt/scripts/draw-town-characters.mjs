/*
 * Town characters edited from Misa's pixels (WTFPL atlas.png).
 * Same frame rectangles, chibi proportions, black outline, shade steps, and walk poses.
 * Each person changes hair, clothes, headwear, and skin.
 *
 *   node catchcrypt/scripts/draw-town-characters.mjs
 *   node catchcrypt/scripts/draw-town-characters.mjs --check
 */
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ATLAS = JSON.parse(readFileSync(new URL("../public/town/atlas.json", import.meta.url), "utf8"));
const OUT_DIR = fileURLToPath(new URL("../public/town/", import.meta.url));
const CAST_PREVIEW = fileURLToPath(new URL("../previews/cast-v2.png", import.meta.url));

const EMPTY = 0;
const OUTLINE = 1;
const HAIR_L = 2;
const HAIR_M = 3;
const HAIR_D = 4;
const HAIR_X = 5;
const SKIN_L = 6;
const SKIN_M = 7;
const SKIN_S = 8;
const SKIN_H = 9;
const EYE = 10;
const HP = 11;
const CLOTH_L = 12;
const CLOTH_M = 13;
const PANTS = 14;
const SHOE = 15;
const SOCK = 16;
const CAP_L = 17;
const CAP_M = 18;
const CAP_D = 19;

const SKIN_LABELS = new Set([SKIN_L, SKIN_M, SKIN_S]);
const HAIR_LABELS = new Set([HAIR_L, HAIR_M, HAIR_D, HAIR_X, CAP_L, CAP_M, CAP_D]);

function rgb(r, g, b) {
  return [r, g, b, 255];
}

/** Shade steps follow Misa: light, mid, dark, and the deep mass. */
const CAST = [
  {
    id: "reed",
    name: "Reed",
    haircut: "short",
    hair: { l: rgb(186, 150, 114), m: rgb(132, 92, 60), d: rgb(84, 54, 36), x: rgb(42, 28, 20) },
    skin: { l: rgb(255, 214, 184), m: rgb(244, 180, 142), s: rgb(210, 136, 102), h: rgb(255, 236, 220) },
    cloth: { l: rgb(214, 226, 240), m: rgb(48, 78, 140) },
    pants: rgb(58, 64, 80),
    shoe: rgb(40, 32, 30),
    sock: rgb(28, 24, 24),
    eye: rgb(24, 28, 40),
  },
  {
    id: "bram",
    name: "Bram",
    haircut: "short",
    hat: "cap",
    beard: true,
    cap: { l: rgb(176, 214, 112), m: rgb(64, 146, 58), d: rgb(32, 88, 36) },
    hair: { l: rgb(168, 122, 78), m: rgb(120, 78, 46), d: rgb(78, 48, 30), x: rgb(42, 26, 16) },
    skin: { l: rgb(236, 190, 142), m: rgb(204, 146, 98), s: rgb(164, 106, 68), h: rgb(248, 220, 184) },
    cloth: { l: rgb(236, 214, 176), m: rgb(148, 100, 52) },
    pants: rgb(62, 58, 74),
    shoe: rgb(48, 34, 26),
    sock: rgb(32, 24, 20),
    eye: rgb(28, 24, 22),
  },
  {
    id: "nico",
    name: "Nico",
    haircut: "short",
    spikes: true,
    hair: { l: rgb(255, 186, 96), m: rgb(230, 112, 36), d: rgb(168, 64, 20), x: rgb(96, 36, 12) },
    skin: { l: rgb(255, 216, 190), m: rgb(246, 184, 148), s: rgb(214, 140, 108), h: rgb(255, 238, 224) },
    cloth: { l: rgb(186, 236, 226), m: rgb(32, 148, 142) },
    pants: rgb(44, 56, 88),
    shoe: rgb(232, 234, 238),
    sock: rgb(180, 186, 196),
    eye: rgb(28, 32, 36),
  },
  {
    id: "holt",
    name: "Holt",
    haircut: "short",
    hat: "wide",
    mustache: true,
    cap: { l: rgb(196, 132, 78), m: rgb(142, 74, 42), d: rgb(84, 40, 26) },
    hair: { l: rgb(96, 68, 48), m: rgb(64, 42, 30), d: rgb(42, 28, 20), x: rgb(28, 18, 14) },
    skin: { l: rgb(228, 170, 124), m: rgb(190, 126, 88), s: rgb(150, 90, 62), h: rgb(244, 206, 170) },
    cloth: { l: rgb(232, 112, 104), m: rgb(168, 40, 46) },
    pants: rgb(46, 40, 48),
    shoe: rgb(36, 26, 26),
    sock: rgb(24, 18, 18),
    eye: rgb(28, 22, 22),
  },
  {
    id: "lark",
    name: "Lark",
    haircut: "long",
    bow: true,
    hair: { l: rgb(236, 164, 142), m: rgb(196, 96, 88), d: rgb(132, 52, 56), x: rgb(72, 28, 36) },
    skin: { l: rgb(255, 220, 210), m: rgb(244, 186, 172), s: rgb(214, 142, 132), h: rgb(255, 240, 234) },
    cloth: { l: rgb(250, 206, 210), m: rgb(196, 92, 112) },
    pants: rgb(156, 68, 92),
    shoe: rgb(48, 30, 36),
    sock: rgb(32, 22, 26),
    eye: rgb(40, 28, 36),
    bowColor: { l: rgb(255, 186, 206), m: rgb(214, 72, 124) },
  },
  {
    id: "piper",
    name: "Piper",
    haircut: "pony",
    hair: { l: rgb(120, 78, 56), m: rgb(78, 48, 34), d: rgb(48, 30, 22), x: rgb(26, 16, 12) },
    skin: { l: rgb(214, 156, 112), m: rgb(176, 112, 76), s: rgb(136, 80, 54), h: rgb(236, 196, 160) },
    cloth: { l: rgb(248, 220, 112), m: rgb(204, 156, 36) },
    pants: rgb(44, 72, 148),
    shoe: rgb(236, 232, 220),
    sock: rgb(186, 178, 160),
    eye: rgb(24, 20, 18),
  },
];

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
  const stride = w * channels;
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
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev ? prev[x] : 0;
      const ul = prev && x >= channels ? prev[x - channels] : 0;
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

function keyOf(r, g, b) {
  return (r << 16) | (g << 8) | b;
}

const MISA = new Map([
  [keyOf(0, 0, 0), OUTLINE],
  [keyOf(243, 235, 141), HAIR_L],
  [keyOf(195, 179, 41), HAIR_M],
  [keyOf(126, 109, 17), HAIR_D],
  [keyOf(48, 40, 64), HAIR_X],
  [keyOf(255, 209, 173), SKIN_L],
  [keyOf(246, 182, 138), SKIN_M],
  [keyOf(218, 138, 104), SKIN_S],
  [keyOf(255, 247, 255), SKIN_H],
  [keyOf(255, 255, 255), HP],
  [keyOf(168, 168, 192), HP],
  [keyOf(88, 112, 181), HP],
  [keyOf(78, 108, 169), HP],
  [keyOf(177, 177, 177), CLOTH_M],
  [keyOf(243, 243, 243), CLOTH_L],
  [keyOf(215, 215, 215), PANTS],
  [keyOf(112, 56, 56), SHOE],
  [keyOf(123, 123, 123), SOCK],
]);

function classify(src, w, h) {
  const labels = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const di = i * 4;
    if (src.data[di + 3] < 16) {
      continue;
    }
    const label = MISA.get(keyOf(src.data[di], src.data[di + 1], src.data[di + 2]));
    labels[i] = label ?? OUTLINE;
  }
  const face = faceMask(labels, w, h);
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let i = 0; i < face.length; i++) {
    if (!face[i]) {
      if (labels[i] === SKIN_H) {
        labels[i] = CLOTH_L;
      }
      continue;
    }
    const x = i % w;
    const y = (i - x) / w;
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  const box = maxX >= 0 ? { minX, maxX, minY, maxY } : null;
  if (box) {
    for (let y = box.minY - 1; y <= box.maxY + 1; y++) {
      for (let x = box.minX - 1; x <= box.maxX + 1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) {
          continue;
        }
        const i = y * w + x;
        if (labels[i] === HP && x >= box.minX && x <= box.maxX) {
          labels[i] = EYE;
        }
      }
    }
  }
  absorbHeadphones(labels, w, h);
  return { labels, face: box };
}

function faceMask(labels, w, h) {
  const seen = new Uint8Array(labels.length);
  let start = -1;
  for (let i = 0; i < labels.length; i++) {
    if (SKIN_LABELS.has(labels[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return seen;
  }
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    const next = [i - 1, i + 1, i - w, i + w];
    if (x === 0) {
      next[0] = -1;
    }
    if (x === w - 1) {
      next[1] = -1;
    }
    if (y === 0) {
      next[2] = -1;
    }
    if (y === h - 1) {
      next[3] = -1;
    }
    for (const j of next) {
      if (j < 0 || j >= labels.length || seen[j] || !SKIN_LABELS.has(labels[j])) {
        continue;
      }
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

function absorbHeadphones(labels, w, h) {
  const keep = new Uint8Array(labels.length);
  keep.set(labels);
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (keep[i] !== OUTLINE) {
          continue;
        }
        let headphone = false;
        let blocked = false;
        for (const [nx, ny] of neighbors(x, y, w, h)) {
          const lab = keep[ny * w + nx];
          if (lab === HP || HAIR_LABELS.has(lab)) {
            headphone = headphone || lab === HP;
          } else if (lab !== EMPTY && lab !== OUTLINE) {
            blocked = true;
          }
        }
        if (headphone && !blocked) {
          keep[i] = HAIR_X;
          changed = true;
        }
      }
    }
  }
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === HP) {
      labels[i] = HAIR_X;
    } else if (keep[i] === HAIR_X && labels[i] === OUTLINE) {
      labels[i] = HAIR_X;
    }
  }
}

function neighbors(x, y, w, h) {
  const found = [];
  if (x > 0) {
    found.push([x - 1, y]);
  }
  if (x + 1 < w) {
    found.push([x + 1, y]);
  }
  if (y > 0) {
    found.push([x, y - 1]);
  }
  if (y + 1 < h) {
    found.push([x, y + 1]);
  }
  return found;
}

function chestSpan(labels, w, h, neck) {
  let minX = w;
  let maxX = -1;
  const y1 = Math.min(h - 1, neck + 9);
  for (let y = Math.max(0, neck); y <= y1; y++) {
    for (let x = 0; x < w; x++) {
      const lab = labels[y * w + x];
      if (lab === CLOTH_M || lab === CLOTH_L || lab === PANTS) {
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
      }
    }
  }
  if (maxX - minX >= 4) {
    return { minX, maxX };
  }
  return null;
}

function hairBox(labels, w, h, yMax) {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    if (yMax !== undefined && y > yMax) {
      continue;
    }
    for (let x = 0; x < w; x++) {
      if (!HAIR_LABELS.has(labels[y * w + x])) {
        continue;
      }
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }
  return maxX >= 0 ? { minX, maxX, minY, maxY } : null;
}

/** A pixel under the head stays if it sits on the neck or the torso. Side locks do not. */
function coversBody(x, y, neck, skinTop, head, chest) {
  if (skinTop && Math.abs(x - (skinTop.minX + skinTop.maxX) / 2) <= (skinTop.maxX - skinTop.minX) / 2 + 2) {
    return true;
  }
  if (chest && Math.abs(x - (chest.minX + chest.maxX) / 2) <= (chest.maxX - chest.minX) / 2 + 2) {
    return true;
  }
  if (head && y < neck + 4) {
    const mid = (head.minX + head.maxX) / 2;
    const half = Math.max(4, (head.maxX - head.minX) * 0.22);
    if (Math.abs(x - mid) <= half) {
      return true;
    }
  }
  return false;
}

/** Drop long locks. Pixels over the torso become the jacket so the body stays solid. */
function trimHair(labels, w, h, neck, skinTop, head, character) {
  if (character.haircut === "long") {
    return;
  }
  const chest = chestSpan(labels, w, h, neck);
  for (let y = neck; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!HAIR_LABELS.has(labels[i]) && labels[i] !== OUTLINE) {
        continue;
      }
      const keep = coversBody(x, y, neck, skinTop, head, chest);
      if (HAIR_LABELS.has(labels[i])) {
        labels[i] = keep ? CLOTH_M : EMPTY;
        continue;
      }
      if (!keep) {
        labels[i] = EMPTY;
      }
    }
  }
  peelOutlines(labels, w, h);
}

function peelOutlines(labels, w, h) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (labels[i] !== OUTLINE) {
          continue;
        }
        let supports = false;
        for (const [nx, ny] of neighbors(x, y, w, h)) {
          const lab = labels[ny * w + nx];
          if (lab !== EMPTY && lab !== OUTLINE) {
            supports = true;
          }
        }
        if (!supports) {
          labels[i] = EMPTY;
          changed = true;
        }
      }
    }
  }
}

function applyCutAndWear(labels, w, h, facing, character) {
  const skinTop = topSkin(labels, w, h);
  const neck = skinTop ? skinTop.maxY + 1 : Math.floor(h * 0.5);
  const head = hairBox(labels, w, h, neck);
  trimHair(labels, w, h, neck, skinTop, head, character);
  if (character.hat && head) {
    const brimY = skinTop ? skinTop.minY - 1 : head.minY + 6;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (y >= brimY || !HAIR_LABELS.has(labels[i])) {
          continue;
        }
        if (labels[i] === HAIR_L) {
          labels[i] = CAP_L;
        } else if (labels[i] === HAIR_M) {
          labels[i] = CAP_M;
        } else {
          labels[i] = CAP_D;
        }
      }
    }
  }
  if (character.beard && skinTop && facing !== "back") {
    for (let y = skinTop.maxY - 2; y <= skinTop.maxY; y++) {
      for (let x = skinTop.minX + 1; x <= skinTop.maxX - 1; x++) {
        if (y < 0 || x < 0 || x >= w) {
          continue;
        }
        const i = y * w + x;
        if (SKIN_LABELS.has(labels[i]) || labels[i] === SKIN_H) {
          labels[i] = HAIR_D;
        }
      }
    }
  }
  if (character.mustache && skinTop && facing !== "back") {
    const y = skinTop.minY + Math.max(2, Math.floor((skinTop.maxY - skinTop.minY) * 0.58));
    const mid = Math.floor((skinTop.minX + skinTop.maxX) / 2);
    for (let x = mid - 2; x <= mid + 1; x++) {
      const i = y * w + x;
      if (x >= 0 && x < w && (SKIN_LABELS.has(labels[i]) || labels[i] === SKIN_H)) {
        labels[i] = HAIR_X;
      }
    }
  }
  return { neck, head, skinTop };
}

function topSkin(labels, w, h) {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  const seen = faceMask(labels, w, h);
  for (let i = 0; i < seen.length; i++) {
    if (!seen[i]) {
      continue;
    }
    const x = i % w;
    const y = (i - x) / w;
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return maxX >= 0 ? { minX, maxX, minY, maxY } : null;
}

function paintColor(labels, colors, i) {
  const lab = labels[i];
  if (lab === EMPTY) {
    return null;
  }
  if (lab === OUTLINE) {
    return rgb(0, 0, 0);
  }
  if (lab === HAIR_L) {
    return colors.hair.l;
  }
  if (lab === HAIR_M) {
    return colors.hair.m;
  }
  if (lab === HAIR_D) {
    return colors.hair.d;
  }
  if (lab === HAIR_X) {
    return colors.hair.x;
  }
  if (lab === SKIN_L) {
    return colors.skin.l;
  }
  if (lab === SKIN_M) {
    return colors.skin.m;
  }
  if (lab === SKIN_S) {
    return colors.skin.s;
  }
  if (lab === SKIN_H) {
    return colors.skin.h;
  }
  if (lab === EYE) {
    return colors.eye;
  }
  if (lab === CLOTH_L) {
    return colors.cloth.l;
  }
  if (lab === CLOTH_M) {
    return colors.cloth.m;
  }
  if (lab === PANTS) {
    return colors.pants;
  }
  if (lab === SHOE) {
    return colors.shoe;
  }
  if (lab === SOCK) {
    return colors.sock;
  }
  if (lab === CAP_L) {
    return colors.cap.l;
  }
  if (lab === CAP_M) {
    return colors.cap.m;
  }
  if (lab === CAP_D) {
    return colors.cap.d;
  }
  return rgb(0, 0, 0);
}

function setPix(pix, labels, i, color, label) {
  pix.data[i * 4] = color[0];
  pix.data[i * 4 + 1] = color[1];
  pix.data[i * 4 + 2] = color[2];
  pix.data[i * 4 + 3] = 255;
  if (label !== undefined) {
    labels[i] = label;
  }
}

function clearPix(pix, labels, i) {
  pix.data[i * 4 + 3] = 0;
  labels[i] = EMPTY;
}

function fillIf(pix, labels, w, h, x, y, color, label) {
  if (x < 0 || y < 0 || x >= w || y >= h) {
    return;
  }
  const i = y * w + x;
  const lab = labels[i];
  if (lab === EYE || SKIN_LABELS.has(lab) || lab === SKIN_H) {
    return;
  }
  setPix(pix, labels, i, color, label);
}

function paintBrim(pix, labels, w, h, facing, skinTop, head, character) {
  if (!character.hat || !head) {
    return;
  }
  const wide = character.hat === "wide";
  const extra = wide ? 4 : 2;
  // A wide brim sits up where the skull is narrow. A cap visor sits at the brow.
  const y = wide ? head.minY + 3 : skinTop ? Math.max(1, skinTop.minY - 1) : head.minY + 6;
  let left = w;
  let right = -1;
  for (let yy = y - 1; yy <= y + 1; yy++) {
    if (yy < 0 || yy >= h) {
      continue;
    }
    for (let x = 0; x < w; x++) {
      if (labels[yy * w + x] === EMPTY) {
        continue;
      }
      if (x < left) {
        left = x;
      }
      if (x > right) {
        right = x;
      }
    }
  }
  if (right < 0) {
    return;
  }
  const dirs = facing === "left" ? [-1] : facing === "right" ? [1] : [-1, 1];
  for (const dir of dirs) {
    const start = dir < 0 ? left : right;
    for (let step = 1; step <= extra; step++) {
      const x = start + dir * step;
      if (x < 0 || x >= w) {
        break;
      }
      for (let row = -1; row <= 1; row++) {
        const yy = y + row;
        if (yy < 0 || yy >= h || labels[yy * w + x] !== EMPTY) {
          continue;
        }
        setPix(pix, labels, yy * w + x, row === 0 ? character.cap.l : character.cap.m, CAP_M);
      }
    }
  }
}

function paintSpikes(pix, labels, w, h, character) {
  if (!character.spikes) {
    return;
  }
  const tops = [];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (HAIR_LABELS.has(labels[y * w + x])) {
        tops.push(x);
        break;
      }
    }
  }
  if (tops.length < 5) {
    return;
  }
  const peaks = new Set([tops[1], tops[Math.floor(tops.length / 2)], tops[tops.length - 2]]);
  for (const x of tops) {
    let top = -1;
    for (let y = 0; y < h; y++) {
      if (labels[y * w + x] !== EMPTY) {
        top = y;
        break;
      }
    }
    if (top < 0) {
      continue;
    }
    if (peaks.has(x)) {
      continue;
    }
    for (let step = 0; step < 2; step++) {
      const yy = top + step;
      if (yy < h && HAIR_LABELS.has(labels[yy * w + x])) {
        clearPix(pix, labels, yy * w + x);
      }
    }
  }
}

function paintBow(pix, labels, w, h, facing, character, skinTop, head) {
  if (!character.bow || !head) {
    return;
  }
  const mid = character.bowColor.m;
  const light = character.bowColor.l;
  let x = head.maxX - 3;
  let y = skinTop ? skinTop.minY + 1 : head.minY + 4;
  if (facing === "left") {
    x = Math.min(w - 8, head.maxX - 1);
    y = skinTop ? skinTop.minY : head.minY + 3;
  } else if (facing === "right") {
    x = Math.max(0, head.minX - 6);
    y = skinTop ? skinTop.minY : head.minY + 3;
  } else if (facing === "back") {
    x = Math.floor((head.minX + head.maxX) / 2) - 3;
    y = head.minY + 2;
  }
  const lobes = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [5, 0],
    [6, 0],
    [7, 0],
    [5, 1],
    [6, 1],
    [7, 1],
    [5, 2],
    [6, 2],
    [7, 2],
  ];
  for (const [dx, dy] of lobes) {
    const color = dx === 1 || dx === 6 ? light : mid;
    fillIf(pix, labels, w, h, x + dx, y + dy, color, HAIR_L);
  }
  fillIf(pix, labels, w, h, x + 3, y + 1, light, HAIR_L);
  fillIf(pix, labels, w, h, x + 4, y + 1, light, HAIR_L);
}

function paintPonytail(pix, labels, w, h, facing, character, neck, head) {
  if (character.haircut !== "pony" || !head) {
    return;
  }
  let x = Math.min(w - 4, head.maxX - 2);
  let y = Math.max(0, neck - 6);
  let tall = 8;
  if (facing === "right") {
    x = Math.max(0, head.minX - 1);
  } else if (facing === "back") {
    x = Math.floor(w / 2) - 1;
    y = Math.max(0, neck - 1);
    tall = 8;
  } else if (facing === "front") {
    x = Math.min(w - 4, head.maxX - 3);
    y = Math.max(0, neck - 5);
    tall = 5;
  }
  for (let dy = 0; dy < tall; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      const color = dx === 1 && dy < 5 ? character.hair.l : character.hair.m;
      fillIf(pix, labels, w, h, x + dx, y + dy, color, HAIR_M);
    }
  }
}

/** Close 1px gaps left when a lock is removed, without joining the feet. */
function fillHoles(pix, w, h) {
  const copy = Buffer.from(pix.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (copy[i + 3] >= 16) {
        continue;
      }
      const around = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      let count = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [nx, ny] of around) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          continue;
        }
        const ni = (ny * w + nx) * 4;
        if (copy[ni + 3] < 16) {
          continue;
        }
        count += 1;
        r += copy[ni];
        g += copy[ni + 1];
        b += copy[ni + 2];
      }
      if (count >= 3) {
        pix.data[i] = Math.round(r / count);
        pix.data[i + 1] = Math.round(g / count);
        pix.data[i + 2] = Math.round(b / count);
        pix.data[i + 3] = 255;
      }
    }
  }
}

function outlinePass(pix, w, h) {
  const next = Buffer.from(pix.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (next[i + 3] < 16) {
        continue;
      }
      let edge = false;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || pix.data[(ny * w + nx) * 4 + 3] < 16) {
          edge = true;
        }
      }
      if (edge) {
        next[i] = 0;
        next[i + 1] = 0;
        next[i + 2] = 0;
        next[i + 3] = 255;
      }
    }
  }
  pix.data.set(next);
}

function editFrame(src, w, h, facing, character) {
  const pix = { w, h, data: Buffer.from(src.data) };
  const { labels } = classify(pix, w, h);
  const marks = applyCutAndWear(labels, w, h, facing, character);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === EMPTY) {
      pix.data[i * 4 + 3] = 0;
      continue;
    }
    const color = paintColor(labels, character, i);
    setPix(pix, labels, i, color);
  }
  paintBrim(pix, labels, w, h, facing, marks.skinTop, marks.head, character);
  paintBow(pix, labels, w, h, facing, character, marks.skinTop, marks.head);
  paintPonytail(pix, labels, w, h, facing, character, marks.neck, marks.head);
  paintSpikes(pix, labels, w, h, character);
  fillHoles(pix, w, h);
  outlinePass(pix, w, h);
  return pix;
}

function facingOf(name) {
  if (name.includes("-front")) {
    return "front";
  }
  if (name.includes("-back")) {
    return "back";
  }
  if (name.includes("-left")) {
    return "left";
  }
  return "right";
}

function crop(sheet, frame) {
  const data = Buffer.alloc(frame.w * frame.h * 4);
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const si = ((frame.y + y) * sheet.w + (frame.x + x)) * 4;
      const di = (y * frame.w + x) * 4;
      data[di] = sheet.data[si];
      data[di + 1] = sheet.data[si + 1];
      data[di + 2] = sheet.data[si + 2];
      data[di + 3] = sheet.data[si + 3];
    }
  }
  return { w: frame.w, h: frame.h, data };
}

function blit(sheet, frame, src) {
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const di = ((frame.y + y) * sheet.w + (frame.x + x)) * 4;
      const si = (y * frame.w + x) * 4;
      sheet.data[di] = src.data[si];
      sheet.data[di + 1] = src.data[si + 1];
      sheet.data[di + 2] = src.data[si + 2];
      sheet.data[di + 3] = src.data[si + 3];
    }
  }
}

function sheetFrom(misa, character) {
  const sheet = { w: misa.w, h: misa.h, data: Buffer.from(misa.data) };
  const seen = new Set();
  for (const [name, info] of Object.entries(ATLAS.frames)) {
    const frame = info.frame;
    const key = `${frame.x},${frame.y},${frame.w},${frame.h}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const edited = editFrame(crop(sheet, frame), frame.w, frame.h, facingOf(name), character);
    blit(sheet, frame, edited);
  }
  return sheet;
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
  return join(OUT_DIR, sheetFile(id));
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

const FONT = {
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  W: ["101", "101", "111", "111", "101"],
  Y: ["101", "101", "010", "010", "010"],
};

function drawLabel(dest, destW, text, x, y) {
  let cursor = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (!glyph) {
      cursor += 4;
      continue;
    }
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== "1") {
          continue;
        }
        const di = ((y + gy) * destW + (cursor + gx)) * 4;
        dest[di] = 255;
        dest[di + 1] = 244;
        dest[di + 2] = 220;
        dest[di + 3] = 255;
      }
    }
    cursor += 4;
  }
}

function buildCast(rows, scale, frameNames) {
  const placed = [];
  let minY = 64;
  let maxY = 0;
  for (const row of rows) {
    for (const frameName of frameNames) {
      const info = ATLAS.frames[frameName];
      const rect = info.frame;
      const ss = info.spriteSourceSize;
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const si = ((rect.y + y) * row.sheet.w + (rect.x + x)) * 4;
          if (row.sheet.data[si + 3] < 16) {
            continue;
          }
          const py = ss.y + y;
          if (py < minY) {
            minY = py;
          }
          if (py > maxY) {
            maxY = py;
          }
        }
      }
      placed.push({ row, frameName, info });
    }
  }
  const bandH = maxY - minY + 1;
  const cellW = 32 * scale;
  const cellH = bandH * scale;
  const labelH = 10;
  const gap = 6;
  const width = gap + rows.length * (cellW + gap);
  const height = gap + frameNames.length * (cellH + labelH + gap);
  const dest = Buffer.alloc(width * height * 4);
  for (let i = 0; i < dest.length; i += 4) {
    dest[i] = 92;
    dest[i + 1] = 108;
    dest[i + 2] = 128;
    dest[i + 3] = 255;
  }
  rows.forEach((row, col) => {
    drawLabel(dest, width, row.name, gap + col * (cellW + gap) + 4, 2);
  });
  frameNames.forEach((frameName, rowIndex) => {
    const top = labelH + rowIndex * (cellH + labelH + gap);
    rows.forEach((row, col) => {
      const info = ATLAS.frames[frameName];
      const rect = info.frame;
      const ss = info.spriteSourceSize;
      const ox = gap + col * (cellW + gap);
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const si = ((rect.y + y) * row.sheet.w + (rect.x + x)) * 4;
          if (row.sheet.data[si + 3] < 16) {
            continue;
          }
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = ox + (ss.x + x) * scale + sx;
              const py = top + (ss.y + y - minY) * scale + sy;
              const di = (py * width + px) * 4;
              dest[di] = row.sheet.data[si];
              dest[di + 1] = row.sheet.data[si + 1];
              dest[di + 2] = row.sheet.data[si + 2];
              dest[di + 3] = 255;
            }
          }
        }
      }
    });
  });
  return { w: width, h: height, data: dest };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const reviewAt = process.argv.indexOf("--review");
  const misa = decodePng(sheetPath("misa"));
  const sheets = checkOnly
    ? []
    : CAST.map(character => {
        const sheet = sheetFrom(misa, character);
        const file = sheetPath(character.id);
        writeFileSync(file, encodePng(sheet.w, sheet.h, sheet.data));
        console.log(`wrote ${file}`);
        return { name: character.name, id: character.id, sheet };
      });
  assertDistinctSheets();
  console.log("sheets are distinct");
  if (!checkOnly) {
    mkdirSync(dirname(CAST_PREVIEW), { recursive: true });
    const rows = [{ name: "Misa", sheet: misa }, ...sheets];
    const preview = buildCast(rows, 4, ["misa-front", "misa-left"]);
    writeFileSync(CAST_PREVIEW, encodePng(preview.w, preview.h, preview.data));
    console.log(`preview ${CAST_PREVIEW}`);
    if (reviewAt >= 0 && process.argv[reviewAt + 1]) {
      const review = buildCast(rows, 8, [
        "misa-front",
        "misa-front-walk.000",
        "misa-left",
        "misa-left-walk.000",
        "misa-back",
      ]);
      const dest = process.argv[reviewAt + 1];
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, encodePng(review.w, review.h, review.data));
      console.log(`review ${dest}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
