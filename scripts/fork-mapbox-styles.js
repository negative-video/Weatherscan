#!/usr/bin/env node
'use strict';

/**
 * Fork the upstream Mapbox styles into your own account.
 *
 * Why this exists: the four styles the display uses belong to the upstream
 * author (goldbblazez). They are public, so any token can *read* them, but they
 * pull their vector data from a `composite` source that lists six of that
 * account's own private tilesets. A third-party token gets a 404 for the whole
 * composite — Mapbox fails the entire source if any member is inaccessible — so
 * roads, borders and labels never draw. Forking the style alone does not fix
 * that; the private tilesets have to be swapped for public equivalents too.
 *
 * Fortunately those custom tilesets are thinned copies of Mapbox's own data:
 * their layer filters already reference standard Mapbox Streets attributes
 * (`admin_level`, `iso_3166_1`, `class`). So each affected layer can be
 * repointed at `mapbox-streets-v8` with its paint, layout and stacking order
 * preserved.
 *
 * Usage:
 *   MAPBOX_WRITE_TOKEN=sk.xxx node scripts/fork-mapbox-styles.js            # dry run
 *   MAPBOX_WRITE_TOKEN=sk.xxx node scripts/fork-mapbox-styles.js --create   # actually create
 *
 * The write token needs scopes styles:read, styles:list and styles:write. It is
 * a SECRET token — use it here and nowhere else. Never put it in .env, which is
 * served to the browser.
 */

const fs = require('fs');
const path = require('path');

const UPSTREAM_OWNER = 'goldbblazez';

const STYLES = [
  { key: 'radar',     id: 'cl10wz58y000q14ptdm3vkmxe', name: 'Weatherscan Radar',     env: 'MAPBOX_STYLE_RADAR' },
  { key: 'satellite', id: 'cl188bbm3000f14rmh9mcqbp8', name: 'Weatherscan Satellite', env: 'MAPBOX_STYLE_SATELLITE' },
  { key: 'minimap',   id: 'cl11ctjbl000014s02fijkmyc', name: 'Weatherscan Minimap',   env: 'MAPBOX_STYLE_MINIMAP' },
  { key: 'basemap',   id: 'cl6jfozbb001h15sdx9ze69f7', name: 'Weatherscan Basemap',   env: 'MAPBOX_BASE_STYLE_ID' },
];

/**
 * Each private source-layer, and the public Mapbox Streets equivalent to use
 * instead. `filter` replaces the layer's filter only when the original one
 * referenced attributes the substitute does not have.
 */
const SUBSTITUTIONS = {
  // US state outlines. The original filter already targets admin_level 1.
  'RasterT_Thin_state2-96srql': { sourceLayer: 'admin' },

  // County outlines.
  'RasterT_Thin_county2-2r4r30': {
    sourceLayer: 'admin',
    filter: ['all',
      ['==', ['get', 'admin_level'], 2],
      ['==', ['get', 'maritime'], 'false'],
      ['match', ['get', 'iso_3166_1'], ['US'], true, false]],
  },

  // Country outline and coast.
  'RasterT_Thin_coastnew2-6fcbtp': {
    sourceLayer: 'admin',
    filter: ['==', ['get', 'admin_level'], 0],
  },

  // Interstates. The original filter already keys off `class`.
  'RasterT_Thin_highway2-7hobrm': {
    sourceLayer: 'road',
    filter: ['match', ['get', 'class'], ['motorway', 'trunk'], true, false],
  },

  // Country/land borders on the satellite and mini styles.
  'Landborders-7awliz': {
    sourceLayer: 'admin',
    filter: ['==', ['get', 'admin_level'], 0],
  },

  // Airports. The custom tileset tagged them large_airport/medium_airport;
  // Mapbox Streets ranks them with `sizerank` (lower is bigger) instead.
  'us-airports-688cou': {
    sourceLayer: 'airport_label',
    filterFor: (layerId) =>
      /large/i.test(layerId)
        ? ['all', ['==', ['get', 'class'], 'airport'], ['<=', ['get', 'sizerank'], 8]]
        : ['all', ['==', ['get', 'class'], 'airport'],
           ['>', ['get', 'sizerank'], 8], ['<=', ['get', 'sizerank'], 14]],
  },
};

const PUBLIC_TILESETS = new Set([
  'mapbox.mapbox-streets-v8',
  'mapbox.country-boundaries-v1',
  'mapbox.mapbox-terrain-v2',
  'mapbox.terrain-rgb',
  'mapbox.mapbox-bathymetry-v2',
]);

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300);
    throw new Error(`HTTP ${res.status} ${url.split('?')[0]} — ${detail}`);
  }
  return body;
}

/** Strip private tilesets from every composite source. */
function pruneSources(style) {
  const dropped = [];
  for (const src of Object.values(style.sources || {})) {
    if (!src.url || !src.url.startsWith('mapbox://')) continue;

    // Only vector sources are composites. A raster-dem source names exactly one
    // tileset, and appending a vector one to it produces a combination Mapbox
    // rejects with a 400 — which silently kills the hillshade layer.
    if (src.type !== 'vector') continue;

    const members = src.url.replace('mapbox://', '').split(',');
    const kept = members.filter((m) => {
      const isPublic = PUBLIC_TILESETS.has(m) || m.startsWith('mapbox.');
      if (!isPublic) dropped.push(m);
      return isPublic;
    });
    // Guarantee the layers we repoint have somewhere to read from.
    if (!kept.includes('mapbox.mapbox-streets-v8')) kept.push('mapbox.mapbox-streets-v8');
    src.url = `mapbox://${[...new Set(kept)].join(',')}`;
  }
  return [...new Set(dropped)];
}

/**
 * Drop sources that no visible layer reads from.
 *
 * The upstream styles carry a raster-dem terrain source feeding a single
 * hillshade layer that is set to visibility:none — so it never draws, but the
 * client still fetches its TileJSON on every map init. Mapbox also rewrites
 * that source on save in a way that makes the request 400. Removing the dead
 * source and its hidden layer avoids both.
 */
function dropUnusedSources(style) {
  const removed = { sources: [], layers: [] };
  const visibleUsers = new Set();

  for (const layer of style.layers || []) {
    const hidden = layer.layout && layer.layout.visibility === 'none';
    if (!hidden && layer.source) visibleUsers.add(layer.source);
  }

  for (const [sid, src] of Object.entries(style.sources || {})) {
    if (visibleUsers.has(sid)) continue;
    // Keep anything a visible layer might still need at runtime.
    delete style.sources[sid];
    removed.sources.push(sid);
    const before = style.layers.length;
    style.layers = style.layers.filter((l) => l.source !== sid);
    removed.layers.push(...Array(before - style.layers.length).fill(sid));
  }
  return removed;
}

/** Repoint layers that read from a private source-layer. */
function rewriteLayers(style) {
  const changes = [];
  for (const layer of style.layers || []) {
    const sl = layer['source-layer'];
    const sub = SUBSTITUTIONS[sl];
    if (!sub) continue;

    layer['source-layer'] = sub.sourceLayer;
    if (sub.filterFor) layer.filter = sub.filterFor(layer.id);
    else if (sub.filter) layer.filter = sub.filter;

    changes.push(`${layer.id}: ${sl} -> ${sub.sourceLayer}`);
  }
  return changes;
}

/** Mapbox rejects a create payload that carries server-managed fields. */
function stripServerFields(style) {
  for (const k of ['id', 'owner', 'created', 'modified', 'draft', 'visibility', 'protected']) {
    delete style[k];
  }
  // The sprite and glyphs must point at the new owner, not the old one.
  if (typeof style.sprite === 'string') delete style.sprite;
  return style;
}

/** Read the style ids already configured in .env, so --update can target them. */
function readStyleIdsFromEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^(MAPBOX_STYLE_[A-Z]+|MAPBOX_BASE_STYLE_ID)=(.+)$/.exec(line.trim());
    if (!m) continue;
    // Accept either a bare id or a full mapbox://styles/user/id value.
    out[m[1]] = m[2].trim().split('/').pop();
  }
  return out;
}

async function main() {
  const token = process.env.MAPBOX_WRITE_TOKEN;
  const create = process.argv.includes('--create');
  const update = process.argv.includes('--update');
  const outDir = path.join(__dirname, '..', 'mapbox-styles');

  // --update rewrites the styles already referenced by .env, so their ids —
  // and therefore the .env you have already configured — stay valid.
  const existing = update ? readStyleIdsFromEnv() : {};

  if (!token) {
    console.error('MAPBOX_WRITE_TOKEN is not set.');
    console.error('Create a token with styles:read, styles:list and styles:write at');
    console.error('https://account.mapbox.com/access-tokens/ and pass it in the environment.');
    console.error('It is a secret token — do not put it in .env.');
    process.exit(1);
  }
  if (!token.startsWith('sk.')) {
    console.warn('! The token does not start with "sk.". Creating styles needs a secret token.');
  }

  // The username is encoded in the token payload.
  let username;
  try {
    const payload = token.split('.')[1];
    username = JSON.parse(Buffer.from(payload, 'base64url').toString()).u;
  } catch {
    console.error('Could not read the account name from the token.');
    process.exit(1);
  }
  console.log(`account: ${username}`);
  console.log(update ? 'mode:    UPDATE existing styles in place\n'
    : create ? 'mode:    CREATE\n'
    : 'mode:    dry run (pass --create to publish, --update to rewrite)\n');

  fs.mkdirSync(outDir, { recursive: true });
  const results = [];

  for (const spec of STYLES) {
    process.stdout.write(`${spec.key.padEnd(10)} `);
    const style = await api(
      `https://api.mapbox.com/styles/v1/${UPSTREAM_OWNER}/${spec.id}?access_token=${token}`
    );

    const dropped = pruneSources(style);
    const changes = rewriteLayers(style);
    const unused = dropUnusedSources(style);
    style.name = spec.name;
    stripServerFields(style);

    const file = path.join(outDir, `${spec.key}.json`);
    fs.writeFileSync(file, JSON.stringify(style, null, 2));

    console.log(`${style.layers.length} layers, ${dropped.length} private tileset(s) dropped, ${changes.length} layer(s) repointed`);
    for (const sid of unused.sources) {
      console.log(`           removed unused source ${sid} (only hidden layers used it)`);
    }
    for (const c of changes) console.log(`           ${c}`);

    if (update) {
      const styleId = existing[spec.env];
      if (!styleId) {
        console.log(`           no id for ${spec.env} in .env — skipped`);
      } else {
        await api(
          `https://api.mapbox.com/styles/v1/${username}/${styleId}?access_token=${token}`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(style) }
        );
        console.log(`           updated -> mapbox://styles/${username}/${styleId}`);
      }
    } else if (create) {
      const made = await api(
        `https://api.mapbox.com/styles/v1/${username}?access_token=${token}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(style) }
      );
      console.log(`           created -> mapbox://styles/${username}/${made.id}`);
      results.push({ ...spec, newId: made.id });
    }
  }

  console.log(`\nstyle JSON written to ${path.relative(process.cwd(), outDir)}/`);

  if (results.length) {
    console.log('\nAdd these to .env:\n');
    for (const r of results) {
      const value = r.env === 'MAPBOX_BASE_STYLE_ID'
        ? r.newId
        : `mapbox://styles/${username}/${r.newId}`;
      console.log(`${r.env}=${value}`);
    }
    console.log(`MAPBOX_BASE_STYLE_USER=${username}`);
    console.log('\nThen: npm run check');
  }
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
