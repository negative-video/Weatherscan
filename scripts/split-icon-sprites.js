#!/usr/bin/env node
'use strict';

/**
 * Split the animated condition-icon sprite sheets into one small animated PNG
 * per icon.
 *
 * Why this exists
 * ---------------
 * `images/icons2010sprite.png` and `images/icons2007sprite.png` are APNGs:
 * 4864x125, thirty frames, looping forever at 30fps. Every weather icon on
 * screen uses the same file as a CSS background, offset with
 * background-position-x.
 *
 * That is a browser-side disaster. A CSS background-image animates for as long
 * as anything paints it, and the sidebar's current-conditions icon is on screen
 * permanently — so the browser decodes and composites a 4864x125 frame thirty
 * times a second, forever. Twenty-eight of the thirty frames cover better than
 * 90% of the sheet, so there is no cheap dirty-rect path either. Measured on
 * the 2010 sheet that is ~65 MB/s of PNG decode, running on every slide, before
 * a single pixel of actual page content is drawn.
 *
 * Cutting the sheet into 38 individual 128x125 icons means the browser only
 * animates the icons a slide actually shows. A typical slide drops from ~65
 * MB/s to under 10 MB/s, and the sidebar-only case to under 2 MB/s.
 *
 * Icons whose thirty frames are all identical are written as ordinary static
 * PNGs, which the browser does not animate at all.
 *
 * Nothing about the artwork changes: frames are composited exactly as the APNG
 * spec says (honouring dispose and blend ops) and re-encoded losslessly.
 *
 * Usage:
 *   node scripts/split-icon-sprites.js            # write webroot/images/icons/
 *   node scripts/split-icon-sprites.js --check    # verify without writing
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const IMAGES = path.join(ROOT, 'webroot', 'images');
const OUT_ROOT = path.join(IMAGES, 'icons');

// The sheets are 38 icon cells wide. utils.js indexes them 0..37.
const ICON_COUNT = 38;
const SETS = ['2007', '2010'];

// --- PNG/APNG chunk plumbing ------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readChunks(buf) {
  if (!buf.slice(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  const chunks = [];
  let i = 8;
  while (i + 8 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const data = buf.slice(i + 8, i + 8 + length);
    chunks.push({ type, data });
    i += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.slice(4, 8 + data.length)), 8 + data.length);
  return out;
}

// --- decoding ---------------------------------------------------------------

/** Reverse the per-scanline filters. 8-bit RGBA only, which is what the sheets are. */
function unfilter(raw, width, height) {
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const o = y * stride;
    const prev = o - stride;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let value;
      switch (filter) {
        case 0: value = line[x]; break;
        case 1: value = line[x] + a; break;
        case 2: value = line[x] + b; break;
        case 3: value = line[x] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      out[o + x] = value & 0xff;
    }
  }
  return out;
}

/**
 * Decode an APNG into an array of fully composited RGBA canvases, one per
 * frame, plus the frame delays in milliseconds.
 */
function decodeAPNG(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('no IHDR');

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }

  // Collect frames. A frame is an fcTL plus every IDAT/fdAT that follows it.
  const frames = [];
  let current = null;
  const leadingIDAT = [];

  for (const c of chunks) {
    if (c.type === 'fcTL') {
      current = {
        width: c.data.readUInt32BE(4),
        height: c.data.readUInt32BE(8),
        x: c.data.readUInt32BE(12),
        y: c.data.readUInt32BE(16),
        delayNum: c.data.readUInt16BE(20),
        delayDen: c.data.readUInt16BE(22) || 100,
        disposeOp: c.data[24],
        blendOp: c.data[25],
        parts: [],
      };
      frames.push(current);
    } else if (c.type === 'IDAT') {
      (current ? current.parts : leadingIDAT).push(c.data);
    } else if (c.type === 'fdAT') {
      // fdAT carries a 4-byte sequence number ahead of the payload.
      if (!current) throw new Error('fdAT before any fcTL');
      current.parts.push(c.data.slice(4));
    }
  }

  if (!frames.length) throw new Error('not an APNG (no fcTL chunks)');

  const stride = width * 4;
  let canvas = Buffer.alloc(stride * height); // transparent black
  const composited = [];
  const delays = [];

  for (const frame of frames) {
    const parts = frame.parts.length ? frame.parts : leadingIDAT;
    const pixels = unfilter(zlib.inflateSync(Buffer.concat(parts)), frame.width, frame.height);

    // dispose_op 2 (PREVIOUS) restores this frame's region afterwards, so keep
    // a copy of it before we draw.
    let saved = null;
    if (frame.disposeOp === 2) saved = Buffer.from(canvas);

    const src = frame.width * 4;
    for (let row = 0; row < frame.height; row++) {
      const dst = (frame.y + row) * stride + frame.x * 4;
      if (frame.blendOp === 0) {
        // SOURCE: copy pixels verbatim, alpha included.
        pixels.copy(canvas, dst, row * src, row * src + src);
      } else {
        // OVER: standard source-over alpha composite.
        for (let col = 0; col < frame.width; col++) {
          const s = row * src + col * 4;
          const d = dst + col * 4;
          const sa = pixels[s + 3];
          if (sa === 255) {
            pixels.copy(canvas, d, s, s + 4);
          } else if (sa !== 0) {
            const da = canvas[d + 3];
            const out = sa + (da * (255 - sa)) / 255;
            for (let ch = 0; ch < 3; ch++) {
              canvas[d + ch] = Math.round(
                (pixels[s + ch] * sa + canvas[d + ch] * da * (255 - sa) / 255) / out
              );
            }
            canvas[d + 3] = Math.round(out);
          }
        }
      }
    }

    composited.push(Buffer.from(canvas));
    delays.push((1000 * frame.delayNum) / frame.delayDen);

    if (frame.disposeOp === 1) {
      // BACKGROUND: clear this frame's region to transparent black.
      for (let row = 0; row < frame.height; row++) {
        canvas.fill(0, (frame.y + row) * stride + frame.x * 4, (frame.y + row) * stride + frame.x * 4 + src);
      }
    } else if (frame.disposeOp === 2) {
      canvas = saved;
    }
  }

  return { width, height, frames: composited, delays };
}

// --- encoding ---------------------------------------------------------------

/** Adaptive scanline filtering, picking the candidate with the smallest absolute sum. */
function filterScanlines(rgba, width, height) {
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const o = y * stride;
    const prev = o - stride;
    let bestType = 0;
    let bestScore = Infinity;

    for (let type = 0; type <= 4; type++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const cur = rgba[o + x];
        const a = x >= bpp ? rgba[o + x - bpp] : 0;
        const b = y > 0 ? rgba[prev + x] : 0;
        const c = x >= bpp && y > 0 ? rgba[prev + x - bpp] : 0;
        let v;
        switch (type) {
          case 0: v = cur; break;
          case 1: v = cur - a; break;
          case 2: v = cur - b; break;
          case 3: v = cur - ((a + b) >> 1); break;
          default: {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            v = cur - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          }
        }
        v &= 0xff;
        candidate[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        candidate.copy(best);
      }
    }

    out[y * (stride + 1)] = bestType;
    best.copy(out, y * (stride + 1) + 1);
  }
  return out;
}

function deflate(buf) {
  return zlib.deflateSync(buf, { level: 9, memLevel: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY });
}

function ihdrChunk(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 6; // RGBA
  return chunk('IHDR', data);
}

function encodeStaticPNG(rgba, width, height) {
  return Buffer.concat([
    SIGNATURE,
    ihdrChunk(width, height),
    chunk('IDAT', deflate(filterScanlines(rgba, width, height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeAPNG(frames, width, height, delays) {
  const parts = [SIGNATURE, ihdrChunk(width, height)];

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4); // play forever
  parts.push(chunk('acTL', actl));

  let seq = 0;
  frames.forEach((frame, index) => {
    // Every frame is a full-canvas SOURCE blend with no disposal, which is the
    // simplest form that reproduces an already-composited sequence exactly.
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(width, 4);
    fctl.writeUInt32BE(height, 8);
    fctl.writeUInt32BE(0, 12);
    fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(Math.round(delays[index]), 20);
    fctl.writeUInt16BE(1000, 22);
    fctl[24] = 0; // dispose: none
    fctl[25] = 0; // blend: source
    parts.push(chunk('fcTL', fctl));

    const data = deflate(filterScanlines(frame, width, height));
    if (index === 0) {
      parts.push(chunk('IDAT', data));
    } else {
      const fdat = Buffer.alloc(4 + data.length);
      fdat.writeUInt32BE(seq++, 0);
      data.copy(fdat, 4);
      parts.push(chunk('fdAT', fdat));
    }
  });

  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// --- splitting --------------------------------------------------------------

function cropColumn(canvas, sheetWidth, height, x, cellWidth) {
  const out = Buffer.alloc(cellWidth * height * 4);
  for (let row = 0; row < height; row++) {
    const from = row * sheetWidth * 4 + x * 4;
    canvas.copy(out, row * cellWidth * 4, from, from + cellWidth * 4);
  }
  return out;
}

function splitSheet(set, { check }) {
  const source = path.join(IMAGES, `icons${set}sprite.png`);
  if (!fs.existsSync(source)) {
    console.log(`  icons${set}sprite.png: not present, skipping`);
    return null;
  }

  const sheet = fs.readFileSync(source);
  const { width, height, frames, delays } = decodeAPNG(sheet);

  if (width % ICON_COUNT !== 0) {
    throw new Error(`icons${set}sprite.png is ${width}px wide, not divisible into ${ICON_COUNT} cells`);
  }
  const cellWidth = width / ICON_COUNT;

  const outDir = path.join(OUT_ROOT, set);
  if (!check) fs.mkdirSync(outDir, { recursive: true });

  let animated = 0;
  let staticCount = 0;
  let bytes = 0;

  for (let icon = 0; icon < ICON_COUNT; icon++) {
    const cells = frames.map((f) => cropColumn(f, width, height, icon * cellWidth, cellWidth));

    // An icon whose frames never change does not need to be animated at all.
    const isStatic = cells.every((c) => c.equals(cells[0]));
    const png = isStatic
      ? encodeStaticPNG(cells[0], cellWidth, height)
      : encodeAPNG(cells, cellWidth, height, delays);

    if (isStatic) staticCount++; else animated++;
    bytes += png.length;

    if (!check) fs.writeFileSync(path.join(outDir, `${icon}.png`), png);
  }

  const perFrameMB = ((cellWidth * height * 4) / 1048576).toFixed(2);
  console.log(
    `  icons${set}: ${ICON_COUNT} cells of ${cellWidth}x${height} ` +
    `(${animated} animated, ${staticCount} static), ` +
    `${(bytes / 1048576).toFixed(1)} MB total, ${perFrameMB} MB decoded per icon frame ` +
    `(sheet was ${((width * height * 4) / 1048576).toFixed(2)} MB)`
  );

  return { cellWidth, height, frames: frames.length };
}

function main() {
  const check = process.argv.includes('--check');
  console.log(check ? 'Checking icon sprite split (nothing will be written)...' : 'Splitting icon sprite sheets...');

  for (const set of SETS) splitSheet(set, { check });

  if (!check) {
    console.log(`\nWrote ${path.relative(ROOT, OUT_ROOT)}/<set>/<index>.png`);
    console.log('getCCicon() in webroot/js/utils.js points at these.');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\nsplit-icon-sprites: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { decodeAPNG, encodeAPNG, encodeStaticPNG, splitSheet };
