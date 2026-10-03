#!/usr/bin/env node
/**
 * Generates TeamHue's PNG icons with zero dependencies.
 *
 * Writes real, spec-compliant PNGs by hand: we rasterize a rounded-square
 * gradient badge with a "T" glyph into an RGBA buffer, then wrap it in the
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

/** Is this point inside the letter "T"? Coordinates are 0..1 within the badge. */
function insideT(u, v) {
  const barTop = 0.26;
  const barBottom = 0.38;
  const barLeft = 0.22;
  const barRight = 0.78;
  const stemLeft = 0.425;
  const stemRight = 0.575;
  const stemBottom = 0.76;

  const inBar = v >= barTop && v <= barBottom && u >= barLeft && u <= barRight;
  const inStem = v >= barTop && v <= stemBottom && u >= stemLeft && u <= stemRight;
  return inBar || inStem;
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3; // 3x3 supersampling for smooth edges
  const half = size / 2;
  const radius = size * 0.22;
  const pad = size * 0.045;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;

          const d = sdRoundRect(px - half, py - half, half - pad, half - pad, radius);
          // Antialias across roughly one pixel.
          const cover = clamp01(0.5 - d);
          if (cover <= 0) continue;

          // Diagonal indigo → violet gradient.
          const t = clamp01((px / size + py / size) / 2);
          let cr = lerp(0x63, 0x8b, t);
          let cg = lerp(0x66, 0x5c, t);
          let cb = lerp(0xf1, 0xf6, t);

          // The "T" glyph, knocked out in white.
          const u = px / size;
          const v = py / size;
          if (insideT(u, v)) {
            cr = 255;
            cg = 255;
            cb = 255;
          }

          r += cr * cover;
          g += cg * cover;
          b += cb * cover;
          a += cover;
        }
      }

      const samples = ss * ss;
      const alpha = a / samples;
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
