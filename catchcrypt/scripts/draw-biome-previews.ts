/**
 * Overview renders of the between-wave biome areas.
 *   WRITE_BIOME_PREVIEWS=1 pnpm exec vitest run test/catch/town-biomes.test.ts -t overview
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { biomeName, biomeSlug, buildBiomeArea, overworldBiomeIds } from "../../src/catch/town-biomes.ts";

const ROOT = join(process.cwd(), "catchcrypt");
const TILESET = join(ROOT, "public/town/tuxmon-sample-32px-extruded.png");
const OUT_DIR = join(ROOT, "previews/biomes");
const TILE = 32;
const MARGIN = 1;
const SPACING = 2;
const SCALE = 2;
const ENCOUNTER = 121;

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const kind = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([kind, data])), 0);
  return Buffer.concat([length, kind, data, crc]);
}

function encodePng(w: number, h: number, rgba: Buffer): Buffer {
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

function decodePng(path: string): { w: number; h: number; rgba: Buffer } {
  const buf = readFileSync(path);
  let offset = 8;
  const chunks: { type: string; data: Buffer }[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString();
    const data = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const ihdr = chunks.find(chunk => chunk.type === "IHDR")?.data;
  if (!ihdr) {
    throw new Error(`missing IHDR in ${path}`);
  }
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 6) {
    throw new Error(`unsupported png in ${path}`);
  }
  const idat = Buffer.concat(chunks.filter(chunk => chunk.type === "IDAT").map(chunk => chunk.data));
  const raw = inflateSync(idat);
  const stride = w * 4;
  const rgba = Buffer.alloc(h * stride);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) {
      return a;
    }
    return pb <= pc ? b : c;
  };
  let src = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[src++];
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : rgba.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = prev ? prev[x] : 0;
      const ul = prev && x >= 4 ? prev[x - 4] : 0;
      const value = raw[src++];
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
        throw new Error(`bad png filter ${filter}`);
      }
    }
  }
  return { w, h, rgba };
}

function tintChannel(value: number, tint: number | undefined, shift: number): number {
  if (tint === undefined) {
    return value;
  }
  return Math.round((value * ((tint >> shift) & 255)) / 255);
}

function blit(
  dst: Buffer,
  dstW: number,
  dx: number,
  dy: number,
  src: Buffer,
  srcW: number,
  sx: number,
  sy: number,
  tint: number | undefined,
): void {
  const step = SCALE;
  for (let y = 0; y < TILE; y += step) {
    for (let x = 0; x < TILE; x += step) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let oy = 0; oy < step; oy++) {
        for (let ox = 0; ox < step; ox++) {
          const si = ((sy + y + oy) * srcW + (sx + x + ox)) * 4;
          const alpha = src[si + 3];
          if (alpha === 0) {
            continue;
          }
          r += src[si];
          g += src[si + 1];
          b += src[si + 2];
          a += alpha;
          n++;
        }
      }
      if (n === 0) {
        continue;
      }
      const di = ((dy + y / step) * dstW + (dx + x / step)) * 4;
      const sr = tintChannel(r / n, tint, 16);
      const sg = tintChannel(g / n, tint, 8);
      const sb = tintChannel(b / n, tint, 0);
      const alpha = a / n / 255;
      dst[di] = Math.round(sr * alpha + dst[di] * (1 - alpha));
      dst[di + 1] = Math.round(sg * alpha + dst[di + 1] * (1 - alpha));
      dst[di + 2] = Math.round(sb * alpha + dst[di + 2] * (1 - alpha));
      dst[di + 3] = 255;
    }
  }
}

function tileOrigin(id: number, columns: number): { x: number; y: number } {
  const col = id % columns;
  const row = Math.floor(id / columns);
  return {
    x: MARGIN + col * (TILE + SPACING),
    y: MARGIN + row * (TILE + SPACING),
  };
}

export function drawBiomePreviews(): string[] {
  const sheet = decodePng(TILESET);
  const columns = Math.floor((sheet.w - MARGIN + SPACING) / (TILE + SPACING));
  mkdirSync(OUT_DIR, { recursive: true });
  const files: string[] = [];
  for (const biomeId of overworldBiomeIds()) {
    const built = buildBiomeArea(biomeId);
    const w = Math.floor(built.w * (TILE / SCALE));
    const h = Math.floor(built.h * (TILE / SCALE));
    const rgba = Buffer.alloc(w * h * 4);
    const paint = (id: number, x: number, y: number, tint: number | undefined) => {
      if (id < 0) {
        return;
      }
      const origin = tileOrigin(id, columns);
      blit(rgba, w, x * (TILE / SCALE), y * (TILE / SCALE), sheet.rgba, sheet.w, origin.x, origin.y, tint);
    };
    for (let y = 0; y < built.h; y++) {
      for (let x = 0; x < built.w; x++) {
        paint(built.ground[y][x], x, y, built.tint);
        if (built.grass[y][x]) {
          paint(ENCOUNTER, x, y, built.grassTint ?? built.tint);
        }
        paint(built.world[y][x], x, y, built.tint);
        paint(built.above[y][x], x, y, built.tint);
      }
    }
    const file = join(OUT_DIR, `${biomeSlug(biomeId)}.png`);
    writeFileSync(file, encodePng(w, h, rgba));
    files.push(file);
    console.log(`${biomeName(biomeId)} ${file}`);
  }
  return files;
}

const invoked = process.argv[1]?.includes("draw-biome-previews");
if (invoked) {
  drawBiomePreviews();
}
