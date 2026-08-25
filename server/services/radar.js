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
 * How much radar history the loop shows.
 *
 * The slide's legend claims "Past 3 Hours", but RainViewer's free listing only
 * ever covers two — thirteen frames on a ten-minute step — so the loop was
 * quietly a third shorter than it said. Its tilecache keeps serving a frame
 * well past the point it drops out of the listing, though: a path captured
 * three and a half hours earlier still returns real imagery at every zoom the
 * client asks for. Buffering what we have seen is what lets the legend be true.
 */
const RADAR_HISTORY_MS = 3 * 60 * 60 * 1000;

/**
 * Frames seen in past listings, keyed by frame time.
 *
 * Deliberately outside the cache, which expires every few minutes and would
 * take the history with it. Frame paths are opaque hashes rather than anything
 * derivable from a timestamp, so this can only accumulate frames it has
 * actually observed: a cold start serves the two hours RainViewer lists and
 * reaches the full window after an hour of polling.
 */
const radarHistory = new Map();

/** A cheap, location-independent tile for asking whether a frame still exists. */
function radarProbeUrl(host, path) {
  return `${host}${path}/256/2/1/1/3/1_1.png`;
}

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

    // Remember the host each frame was listed under. It has been stable, but a
    // buffered path is only meaningful against the host that issued it.
    past.filter((f) => f && f.path).forEach((f) => radarHistory.set(f.time, { path: f.path, host }));

    const cutoff = Math.floor((Date.now() - RADAR_HISTORY_MS) / 1000);
    for (const time of [...radarHistory.keys()]) {
      if (time < cutoff) radarHistory.delete(time);
    }

    // Anything older than the current listing is being served on the strength of
    // the tilecache outliving it, which is observed behaviour rather than a
    // documented guarantee. Check those few before handing them to the client,
    // so an expiry shows up as a shorter loop instead of blank frames.
    const listedOldest = past.length ? past[0].time : Infinity;
    const unverified = [...radarHistory.keys()].filter((t) => t < listedOldest);
    const checks = await Promise.all(
      unverified.map(async (t) => {
        const f = radarHistory.get(t);
        return { time: t, ok: await headOK(radarProbeUrl(f.host, f.path)) };
      })
    );
    const expired = checks.filter((c) => !c.ok);
    expired.forEach((c) => radarHistory.delete(c.time));
    if (expired.length) {
      console.warn(`[radar] ${expired.length} buffered frame(s) no longer served; loop shortened`);
    }

    const frames = [
      ...[...radarHistory.entries()].map(([time, f]) => ({ time, path: f.path, host: f.host, forecast: false })),
      ...nowcast.filter((f) => f && f.path).map((f) => ({ time: f.time, path: f.path, host, forecast: true })),
    ].sort((a, b) => a.time - b.time);

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
// Five hours of history, which is what the regional-satellite slide's legend says.
const SATELLITE_STEP_MINUTES = 20;
const SATELLITE_SLOTS = 16;

const GIBS_LAYERS = {
  geocolor: { layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7', ext: 'jpg', maxZoom: 7 },
  infrared: { layer: 'GOES-East_ABI_Band13_Clean_Infrared', matrix: 'GoogleMapsCompatible_Level6', ext: 'png', maxZoom: 6 },
};

async function satelliteFrames(kind = 'geocolor') {
  if (!config.features.satellite) return { frames: [], layer: null };

  const spec = GIBS_LAYERS[kind] || GIBS_LAYERS.geocolor;
  return cache.wrap(`sat:frames:${kind}`, config.cache.radarMs, async () => {
    // GIBS has no "list available times" endpoint for near-real-time layers, so
    // probe backwards from now and keep what actually exists. Ten minutes of
    // latency is normal for GOES ingest, and the newest slot or two often 404
    // for longer than that.
    //
    // Sixteen slots on a twenty-minute step spans the five hours the slide's
    // legend claims. GeoColor publishes every ten minutes, so :00/:20/:40 all
    // exist; stepping rather than taking every frame keeps the loop about as
    // long as it is now instead of doubling it.
    const stamps = candidateTimes(SATELLITE_SLOTS, SATELLITE_STEP_MINUTES);
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
        url: (f.host || radar.host) ? radarTileTemplate(f.host || radar.host, f.path) : null,
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
