#!/usr/bin/env node
'use strict';

/**
 * Pre-flight check. Run `npm run check` before starting, or after changing
 * .env, to confirm every configured source actually answers.
 *
 * Reports what works, what is degraded, and what is broken — without starting
 * the server or touching the browser.
 */

const { config, describe } = require('../server/config');
const providers = require('../server/providers');
const geocode = require('../server/services/geocode');
const places = require('../server/services/places');
const radar = require('../server/services/radar');
const airports = require('../server/services/airports');
const alerts = require('../server/services/alerts');
const almanac = require('../server/services/almanac');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let failures = 0;
let warnings = 0;

function line(state, label, detail) {
  const mark = { ok: `${GREEN}  ok  ${RESET}`, warn: `${YELLOW} warn ${RESET}`, fail: `${RED} FAIL ${RESET}` }[state];
  console.log(`${mark} ${label.padEnd(26)} ${detail ? DIM + detail + RESET : ''}`);
  if (state === 'fail') failures++;
  if (state === 'warn') warnings++;
}

async function check(label, fn, { optional = false } = {}) {
  const started = Date.now();
  try {
    const detail = await fn();
    line('ok', label, `${detail || ''} ${DIM}(${Date.now() - started}ms)${RESET}`);
  } catch (err) {
    line(optional ? 'warn' : 'fail', label, err.message);
  }
}

// A point that exists in every dataset, used when nothing else is configured.
const TEST_LAT = 38.0293;
const TEST_LON = -78.4767;

(async () => {
  console.log('');
  console.log('Weatherscan configuration check');
  console.log('='.repeat(64));

  const { lines, problems } = describe();
  for (const l of lines) console.log(`  ${DIM}${l}${RESET}`);
  console.log('='.repeat(64));
  console.log('');

  // --- required ---
  if (!config.mapboxKey) {
    line('warn', 'Mapbox token', 'not set — radar, satellite and mini-map will be blank');
  } else {
    await check('Mapbox token', async () => {
      const res = await fetch(
        `https://api.mapbox.com/styles/v1/mapbox/streets-v11?access_token=${config.mapboxKey}`
      );
      if (res.status === 401) throw new Error('rejected by Mapbox (401) — check the token');
      if (!res.ok) throw new Error(`Mapbox returned ${res.status}`);
      return 'accepted';
    });

    // Not a style preference: the upstream styles' vector data is private, so
    // on the defaults the maps genuinely cannot draw roads, borders or labels.
    // That is a broken configuration, not a warning.
    if (config.usingUpstreamStyles) {
      line('fail', 'Mapbox styles',
        'MAPBOX_STYLE_* unset — falling back to the upstream author\'s styles, whose\n' +
        '       vector data is private. Maps will show terrain and water only.\n' +
        '       Fix: MAPBOX_WRITE_TOKEN=sk.… npm run fork-styles -- --create');
    } else {
      line('ok', 'Mapbox styles', 'custom (forked into your account)');
    }
  }

  // --- weather provider ---
  await check(`Weather (${config.provider})`, async () => {
    const w = await providers.getWeather(TEST_LAT, TEST_LON);
    if (w.current.temperature == null) throw new Error('provider returned no temperature');
    if (!w.hourly.length) throw new Error('provider returned no hourly forecast');
    if (!w.daily.length) throw new Error('provider returned no daily forecast');
    return `${w.source} — ${w.current.temperature}F, ${w.hourly.length}h / ${w.daily.length}d`;
  });

  if (config.provider === 'home-assistant') {
    await check('Home Assistant', async () => {
      const r = await providers.homeAssistant.ping(config.homeAssistant);
      const entity = config.homeAssistant.weatherEntity ||
        (await providers.homeAssistant.discoverWeatherEntity(config.homeAssistant));
      const names = r.entities.map((e) => e.entityId).join(', ');
      return `HA ${r.instance.version} at ${r.instance.locationName} — using ${entity}` +
        `\n       ${DIM}available: ${names}${RESET}`;
    });

    await check('HA home coordinates', async () => {
      const home = await providers.haHomeCoords();
      if (home.lat == null) throw new Error('HA did not report coordinates; set HA_LATITUDE/HA_LONGITUDE');
      return `${home.lat.toFixed(4)}, ${home.lon.toFixed(4)} (radius ${config.homeAssistant.matchRadiusKm}km)`;
    });

    await check(`Fallback (${config.fallbackProvider})`, async () => {
      // Somewhere guaranteed to be outside the HA match radius.
      const w = await providers.getWeather(21.3156, -157.8581);
      return `${w.source} — Honolulu ${w.current.temperature}F`;
    });
  }

  // --- supporting services ---
  await check('Geocoding', async () => {
    const r = await geocode.search('Charlottesville', 3);
    if (!r.length) throw new Error('no results');
    return `${r[0].name}, ${r[0].state}`;
  });

  line('ok', 'Bundled city index',
    `${places.stats().count} US cities across ${places.stats().states} states`);

  await check('Air quality', async () => {
    const aq = await providers.getAirQuality(TEST_LAT, TEST_LON);
    if (!aq) throw new Error('unavailable');
    return `AQI ${aq.aqi} (${aq.category}), primary ${aq.primaryPollutant}`;
  }, { optional: true });

  if (config.features.alerts) {
    await check('NWS alerts', async () => {
      const a = await alerts.forPoint(TEST_LAT, TEST_LON);
      return `${a.length} active for the test point`;
    });
  }

  if (config.features.radar) {
    await check('Radar (RainViewer)', async () => {
      const s = await radar.radarFrames();
      if (!s.frames.length) throw new Error('no frames returned');
      return `${s.frames.length} frames`;
    });
  }

  if (config.features.satellite) {
    await check('Satellite (NASA GIBS)', async () => {
      const s = await radar.satelliteFrames('geocolor');
      if (!s.frames.length) throw new Error('no frames available right now');
      return `${s.frames.length} frames of ${s.layer}`;
    }, { optional: true });
  }

  if (config.features.airports) {
    await check('Airport METAR', async () => {
      const m = await airports.conditions(['MIA', 'ORD']);
      const ok = [...m.values()].filter(Boolean).length;
      if (!ok) throw new Error('no observations returned');
      return `${ok}/2 stations reporting`;
    });
    await check('FAA delay feed', async () => {
      const d = await airports.delays();
      return `${d.length} delays nationwide`;
    }, { optional: true });
  }

  if (config.features.almanac) {
    await check('Almanac normals', async () => {
      const a = await almanac.forPoint(TEST_LAT, TEST_LON);
      if (!a) throw new Error('no climate data returned');
      return `${a.years}-year normals: avg ${a.averageHigh}/${a.averageLow}, ` +
        `record ${a.recordHigh} (${a.recordHighYear})`;
    }, { optional: true });
  }

  if (config.features.pollen) {
    const hasKey = config.pollen.googleKey || config.pollen.ambeeKey;
    if (!hasKey) {
      line('warn', 'Pollen', 'no key set (US needs Google or Ambee); the slide will self-skip');
    } else {
      const health = require('../server/services/health');
      await check('Pollen', async () => {
        const aq = await providers.getAirQuality(TEST_LAT, TEST_LON).catch(() => null);
        const p = await health.pollen(TEST_LAT, TEST_LON, aq);
        if (!p) throw new Error('provider returned nothing');
        return `${p.source}: total ${p.total}`;
      }, { optional: true });
    }
  }

  console.log('');
  console.log('='.repeat(64));
  if (problems.length) {
    for (const p of problems) line('warn', 'Config', p);
  }
  if (failures) {
    console.log(`${RED}${failures} check(s) failed${RESET}` +
      (warnings ? `, ${warnings} warning(s)` : ''));
    console.log('The display will start, but the failing sources will show "no report".');
    process.exit(1);
  }
  console.log(
    `${GREEN}All required checks passed${RESET}` +
    (warnings ? ` ${YELLOW}(${warnings} warning(s))${RESET}` : '')
  );
  console.log('');
  process.exit(0);
})().catch((err) => {
  console.error(`${RED}check failed:${RESET}`, err);
  process.exit(1);
});
