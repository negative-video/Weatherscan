'use strict';

const { getJSON, headOK } = require('../lib/http');
const { cache } = require('../lib/cache');
const { config } = require('../config');

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/**
 * Highest zoom RainViewer's tilecache actually renders.
 *
 * Past this it answers 200 with a "Zoom Level Not Supported" placeholder rather
 * than a 404, so an over-zoomed request paints grey boxes over the map instead
 * of failing quietly. The client declares this on the tile *source* so
 * mapbox-gl over-zooms the last real level instead of requesting one that does
 * not exist. RainViewer does not publish the value, so it is measured: z7 tiles
 * vary by area, z8 and above are byte-identical placeholders.
 */
const RAINVIEWER_MAX_ZOOM = 7;

/**
 * Radar frames from RainViewer.
 *
 * The important detail is that each frame carries its own `path`. Older
 * integrations reconstructed tile URLs as /v2/radar/{timestamp}/... — that form
 * still answers 200, but with different (degraded) payloads than the path the
 * API actually hands out. Always use the returned path.
 */
async function radarFrames() {
  if (!config.features.radar) return { host: '', frames: [], generated: 0 };

  return cache.wrap('radar:frames', config.cache.radarMs, async () => {
    const data = await getJSON(RAINVIEWER_API, { timeoutMs: 12000 });
    const host = data.host || 'https://tilecache.rainviewer.com';
    const past = (data.radar && data.radar.past) || [];
    const nowcast = (data.radar && data.radar.nowcast) || [];

    const frames = [...past, ...nowcast]
      .filter((f) => f && f.path)
      .map((f) => ({ time: f.time, path: f.path, forecast: nowcast.includes(f) }))
      .sort((a, b) => a.time - b.time);

    return { host, frames, generated: data.generated || 0, source: 'rainviewer' };
  });
}

/**
 * Build a RainViewer tile template for a frame.
 * Path form: {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
 */
function radarTileTemplate(host, path, opts = {}) {
  const size = opts.size || 256;
  const color = opts.color != null ? opts.color : 3; // 3 = The Weather Channel
  const smooth = opts.smooth != null ? opts.smooth : 1;
  const snow = opts.snow != null ? opts.snow : 1;
  return `${host}${path}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`;
}

/**
 * Satellite frames from NASA GIBS (GOES-East ABI).
 *
 * RainViewer's free satellite feed has been returning an empty `infrared` array,
 * which left the regional-satellite slide blank with no way to tell. GIBS is
 * key-free, updates every 10 minutes, and offers both GeoColor and clean IR.
 */
const GIBS_LAYERS = {
  geocolor: { layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7', ext: 'jpg', maxZoom: 7 },
  infrared: { layer: 'GOES-East_ABI_Band13_Clean_Infrared', matrix: 'GoogleMapsCompatible_Level6', ext: 'png', maxZoom: 6 },
};

async function satelliteFrames(kind = 'geocolor') {
  if (!config.features.satellite) return { frames: [], layer: null };

  const spec = GIBS_LAYERS[kind] || GIBS_LAYERS.geocolor;
  return cache.wrap(`sat:frames:${kind}`, config.cache.radarMs, async () => {
    // GIBS has no "list available times" endpoint for near-real-time layers, so
    // probe backwards from now on the layer's 10-minute cadence and keep what
    // actually exists. Ten minutes of latency is normal for GOES ingest.
    const stamps = candidateTimes(12, 10);
    const checks = await Promise.all(
      stamps.map(async (iso) => ((await headOK(probeUrl(spec, iso))) ? iso : null))
    );

    const frames = checks
      .filter(Boolean)
      .sort()
      .map((iso) => ({ time: Math.floor(new Date(iso).getTime() / 1000), iso }));

    if (!frames.length) {
      console.warn(`[radar] no GIBS ${kind} frames available right now`);
    }

    return {
      frames,
      layer: spec.layer,
      matrix: spec.matrix,
      ext: spec.ext,
      maxZoom: spec.maxZoom,
      source: 'nasa-gibs',
    };
  });
}

function satelliteTileTemplate(spec, iso) {
  return `${GIBS_BASE}/${spec.layer}/default/${iso}/${spec.matrix}/{z}/{y}/{x}.${spec.ext}`;
}

function probeUrl(spec, iso) {
  // Zoom 3 tile 4/3 covers North America and always has data when the frame does.
  return `${GIBS_BASE}/${spec.layer}/default/${iso}/${spec.matrix}/3/3/2.${spec.ext}`;
}

/** The last `count` timestamps on a `stepMinutes` grid, newest last. */
function candidateTimes(count, stepMinutes) {
  const out = [];
  const now = Date.now();
  // Skip the most recent slot; GOES imagery lands a few minutes late.
  const base = now - 15 * 60000;
  for (let i = count - 1; i >= 0; i--) {
    const t = new Date(base - i * stepMinutes * 60000);
    t.setUTCSeconds(0, 0);
    t.setUTCMinutes(Math.floor(t.getUTCMinutes() / stepMinutes) * stepMinutes);
    out.push(t.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  }
  return [...new Set(out)];
}

/** Everything the browser needs to build both animations, in one payload. */
async function series() {
  const [radar, satellite] = await Promise.all([
    radarFrames().catch((err) => {
      console.warn(`[radar] RainViewer unavailable: ${err.message}`);
      return { host: '', frames: [], generated: 0 };
    }),
    satelliteFrames('geocolor').catch((err) => {
      console.warn(`[radar] GIBS unavailable: ${err.message}`);
      return { frames: [], layer: null };
    }),
  ]);

  const spec = GIBS_LAYERS.geocolor;

  return {
    radar: {
      available: radar.frames.length > 0,
      host: radar.host,
      generated: radar.generated,
      maxZoom: RAINVIEWER_MAX_ZOOM,
      frames: radar.frames.map((f) => ({
        ts: f.time,
        forecast: !!f.forecast,
        url: radar.host ? radarTileTemplate(radar.host, f.path) : null,
      })),
    },
    satellite: {
      available: satellite.frames.length > 0,
      layer: satellite.layer,
      // Report the ceiling of the layer actually fetched rather than a
      // second lookup that can drift from it.
      maxZoom: satellite.maxZoom != null ? satellite.maxZoom : spec.maxZoom,
      frames: satellite.frames.map((f) => ({
        ts: f.time,
        url: satelliteTileTemplate(spec, f.iso),
      })),
    },
  };
}

module.exports = {
  series, radarFrames, satelliteFrames,
  radarTileTemplate, satelliteTileTemplate, candidateTimes, GIBS_LAYERS,
};
