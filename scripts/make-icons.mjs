#!/usr/bin/env node
/**
 * Generates TeamHue's PNG icons with zero dependencies.
 *
 * Writes real, spec-compliant PNGs by hand: we rasterize the TeamHue logo
 * (blue tile + three overlapping colour orbs) into an RGBA buffer, then wrap it in the
 * minimal PNG chunk structure (IHDR / IDAT / IEND) using Node's zlib.
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'public/icons');
const SIZES = [16, 32, 48, 128];

/* ----------------------------------------------------------------- PNG core */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encodes an RGBA pixel buffer (width*height*4) as a PNG. */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- rendering */

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Signed distance to a rounded rectangle, used for crisp antialiased edges. */
function sdRoundRect(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - (halfW - r);
  const qy = Math.abs(py) - (halfH - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/* Logo geometry (64×64 canvas) — keep in sync with src/shared/logo.ts. */
const TILE_FROM = [0x25, 0x63, 0xeb];
const TILE_TO = [0x1e, 0x3a, 0x8a];
const ORB_R = 13;
const ORB_ALPHA = 0.92;
const ORBS = [
  { cx: 32, cy: 23.5, c: [0x22, 0xd3, 0xee] },
  { cx: 39.4, cy: 36.3, c: [0xa7, 0x8b, 0xfa] },
  { cx: 24.6, cy: 36.3, c: [0xfb, 0x71, 0x85] },
];

/** Screen blend: 1 - (1-a)(1-b), channels in 0..255. */
const screen = (base, top) => 255 - ((255 - base) * (255 - top)) / 255;

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4; // supersampling for smooth edges
  const k = 64 / size; // pixel → logo units

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const u = (x + (sx + 0.5) / ss) * k;
          const v = (y + (sy + 0.5) / ss) * k;

          const d = sdRoundRect(u - 32, v - 32, 32, 32, 16);
          const cover = clamp01(0.5 - d / k);
          if (cover <= 0) continue;

          const t = clamp01((u + v) / 128);
          let col = [0, 1, 2].map((i) => lerp(TILE_FROM[i], TILE_TO[i], t));

          // Orbs form an isolated group: they screen-blend with EACH OTHER
          // (overlaps glow toward white) but sit normally on the blue tile,
          // so each keeps its pure colour. Matches the SVG exactly.
          let gc = [0, 0, 0];
          let ga = 0;
          for (const o of ORBS) {
            const dist = Math.hypot(u - o.cx, v - o.cy) - ORB_R;
            const oc = clamp01(0.5 - dist / k) * ORB_ALPHA;
            if (oc <= 0) continue;
            const mixed = o.c.map((c, i) => (1 - ga) * c + ga * screen(gc[i], c));
            const na = oc + ga * (1 - oc);
            gc = mixed.map((m, i) => (oc * m + (1 - oc) * ga * gc[i]) / na);
            ga = na;
          }
          if (ga > 0) col = col.map((base, i) => base * (1 - ga) + gc[i] * ga);

          r += col[0] * cover;
          g += col[1] * cover;
          b += col[2] * cover;
          a += cover;
        }
      }

      const alpha = a / (ss * ss);
      const i = (y * size + x) * 4;
      if (alpha > 0.0001) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
        buf[i + 3] = Math.round(alpha * 255);
      }
    }
  }
  return encodePng(buf, size, size);
}

export async function generateIcons() {
  await mkdir(OUT, { recursive: true });
  await Promise.all(
    SIZES.map(async (size) => {
      const png = renderIcon(size);
      await writeFile(resolve(OUT, `icon-${size}.png`), png);
    }),
  );
  return SIZES;
}

// Allow running directly: `npm run icons`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateIcons().then((sizes) => {
    console.log(`✓ Generated ${sizes.length} icons in public/icons/`);
  });
}
