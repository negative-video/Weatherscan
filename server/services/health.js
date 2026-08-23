'use strict';

const { getJSON } = require('../lib/http');
const { cache } = require('../lib/cache');
const { config } = require('../config');
const { localParts, uvDescription } = require('../lib/units');

/**
 * The Health package: UV, air quality, pollen, and the aches/breathing indices.
 *
 * UV and air quality come straight from the weather provider. Pollen needs a
 * dedicated source, and the two "index" slides have no free equivalent at all —
 * they were proprietary Weather Channel products. Rather than leave three
 * slides permanently blank, the indices are derived here from the meteorology
 * that actually drives them, and labelled as derived in the payload so nothing
 * downstream can mistake them for an official product.
 */

// --- UV -------------------------------------------------------------------

/**
 * Current UV plus the next few daylight readings.
 * The slide wants three forecast hours from {9, 12, 15} local.
 */
function uvIndex(weather) {
  const off = weather.utcOffsetSeconds;
  const now = Math.floor(Date.now() / 1000);
  const current = Math.round(weather.current.uvIndex || 0);

  const targets = [9, 12, 15];
  const forecast = weather.hourly
    .filter((h) => h.time > now && targets.includes(localParts(h.time, off).hour))
    .slice(0, 3)
    .map((h) => ({
      time: h.time,
      index: Math.round(h.uvIndex || 0),
      description: uvDescription(h.uvIndex || 0),
    }));

  return {
    current: { index: current, description: uvDescription(current) },
    forecast,
    available: weather.hourly.some((h) => h.uvIndex != null),
  };
}

// --- Pollen ---------------------------------------------------------------

const POLLEN_CATEGORIES = ['None', 'Low', 'Moderate', 'High', 'Very High'];

async function pollen(lat, lon, airQuality) {
  if (!config.features.pollen) return null;

  const key = `pollen:${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  return cache.wrap(key, config.cache.weatherMs * 6, async () => {
    const choice = config.pollen.provider;

    if ((choice === 'auto' || choice === 'google') && config.pollen.googleKey) {
      const g = await fromGoogle(lat, lon).catch((e) => {
        console.warn(`[pollen] Google Pollen failed: ${e.message}`);
        return null;
      });
      if (g) return g;
    }

    if ((choice === 'auto' || choice === 'ambee') && config.pollen.ambeeKey) {
      const a = await fromAmbee(lat, lon).catch((e) => {
        console.warn(`[pollen] Ambee failed: ${e.message}`);
        return null;
      });
      if (a) return a;
    }

    // Open-Meteo carries CAMS pollen, but only over Europe.
    if (choice === 'auto' || choice === 'open-meteo') {
      if (airQuality && airQuality.pollen && airQuality.pollen.available) {
        return fromOpenMeteo(airQuality.pollen);
      }
    }

    return null;
  });
}

async function fromGoogle(lat, lon) {
  const url =
    'https://pollen.googleapis.com/v1/forecast:lookup' +
    `?key=${config.pollen.googleKey}&location.latitude=${lat}` +
    `&location.longitude=${lon}&days=1&plantsDescription=false`;
  const d = await getJSON(url, { timeoutMs: 12000 });
  const day = d.dailyInfo && d.dailyInfo[0];
  if (!day) return null;

  const byCode = {};
  for (const t of day.pollenTypeInfo || []) {
    byCode[t.code] = t.indexInfo ? t.indexInfo.value : 0;
  }
  const topPlant = (day.plantInfo || [])
    .filter((p) => p.indexInfo && p.indexInfo.value > 0)
    .sort((a, b) => b.indexInfo.value - a.indexInfo.value)[0];

  // Google reports a 0-5 universal index; the slide's category thresholds are
  // written against raw grain counts, so scale into that space.
  const toCount = (idx) => [0, 5, 30, 120, 400, 900][Math.min(5, Math.round(idx || 0))];

  const tree = byCode.TREE || 0;
  const grass = byCode.GRASS || 0;
  const weed = byCode.WEED || 0;

  return {
    source: 'google',
    date: Math.floor(Date.now() / 1000),
    total: toCount(Math.max(tree, grass, weed)),
    types: {
      tree: toIndex5(tree),
      grass: toIndex5(grass),
      weed: toIndex5(weed),
      mold: null,
    },
    treeType: topPlant && topPlant.displayName ? topPlant.displayName : '',
    available: true,
  };
}

async function fromAmbee(lat, lon) {
  const d = await getJSON(
    `https://api.ambeedata.com/latest/pollen/by-lat-lng?lat=${lat}&lng=${lon}`,
    { headers: { 'x-api-key': config.pollen.ambeeKey }, timeoutMs: 12000 }
  );
  const row = d.data && d.data[0];
  if (!row) return null;

  const counts = row.Count || {};
  const risk = row.Risk || {};
  const total =
    (counts.tree_pollen || 0) + (counts.grass_pollen || 0) + (counts.weed_pollen || 0);

  const riskToIndex = (label) =>
    ({ Low: 1, Moderate: 2, High: 3, 'Very High': 4 }[label] != null
      ? { Low: 1, Moderate: 2, High: 3, 'Very High': 4 }[label]
      : 0);

  return {
    source: 'ambee',
    date: row.updatedAt ? Math.floor(new Date(row.updatedAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
    total,
    types: {
      tree: riskToIndex(risk.tree_pollen),
      grass: riskToIndex(risk.grass_pollen),
      weed: riskToIndex(risk.weed_pollen),
      mold: null,
    },
    treeType: '',
    available: true,
  };
}

function fromOpenMeteo(p) {
  // CAMS reports grains/m3 directly.
  const toIndex = (v) => {
    if (v == null) return null;
    if (v < 1) return 0;
    if (v < 10) return 1;
    if (v < 50) return 2;
    if (v < 200) return 3;
    return 4;
  };
  const total = (p.tree || 0) + (p.grass || 0) + (p.weed || 0);

  return {
    source: 'open-meteo',
    date: Math.floor(Date.now() / 1000),
    total: Math.round(total),
    types: {
      tree: toIndex(p.tree),
      grass: toIndex(p.grass),
      weed: toIndex(p.weed),
      mold: null,
    },
    treeType: p.treeType || '',
    available: true,
  };
}

const toIndex5 = (googleIndex) =>
  Math.max(0, Math.min(4, Math.round((googleIndex || 0) * 0.8)));

// --- Derived indices ------------------------------------------------------

/**
 * Aches & Pains. Joint pain tracks falling and rapidly-changing barometric
 * pressure, cold, and damp; those are the inputs used here.
 *
 * Returned on a 1-10 scale to match the slide's expectations. `derived: true`
 * marks it as a local approximation, not a licensed index.
 */
function achesIndex(weather) {
  const c = weather.current;
  const pressures = weather.hourly
    .slice(0, 24)
    .map((h) => h.pressure)
    .filter((p) => p != null);

  // Providers rarely give hourly pressure; fall back to the daily temperature
  // swing, which correlates with the frontal passages that drive the aches.
  let swing = 0;
  if (pressures.length >= 2) {
    swing = Math.abs(Math.max(...pressures) - Math.min(...pressures)) / 0.3;
  } else {
    const temps = weather.hourly.slice(0, 24).map((h) => h.temperature).filter((t) => t != null);
    if (temps.length >= 2) swing = (Math.max(...temps) - Math.min(...temps)) / 6;
  }

  let score = 2 + Math.min(4, swing);
  if (c.temperature != null && c.temperature < 45) score += 1.5;
  if (c.temperature != null && c.temperature < 32) score += 1;
  if (c.humidity != null && c.humidity > 70) score += 1;
  if (c.pressure != null && c.pressure < 29.8) score += 1;

  const index = clamp(Math.round(score), 1, 10);
  return { index, category: scaleCategory(index), derived: true };
}

/**
 * Breathing. Driven by air quality first, then pollen, then the temperature and
 * humidity extremes that trigger airway irritation.
 */
function breathingIndex(weather, airQuality, pollenData) {
  const c = weather.current;
  let score = 2;

  if (airQuality && airQuality.aqi != null) {
    score += Math.min(5, airQuality.aqi / 30);
  }
  if (pollenData && pollenData.available) {
    const worst = Math.max(
      pollenData.types.tree || 0,
      pollenData.types.grass || 0,
      pollenData.types.weed || 0
    );
    score += worst * 0.7;
  }
  if (c.humidity != null && c.humidity > 80) score += 0.8;
  if (c.humidity != null && c.humidity < 25) score += 0.8;
  if (c.temperature != null && c.temperature < 25) score += 1;
  if (c.temperature != null && c.temperature > 95) score += 1;

  const index = clamp(Math.round(score), 1, 10);
  return { index, category: scaleCategory(index), derived: true };
}

/** 1-10 to the four-band vocabulary the slides render. */
function scaleCategory(index) {
  if (index <= 3) return 'Low';
  if (index <= 5) return 'Moderate';
  if (index <= 7) return 'High';
  return 'Very High';
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

module.exports = {
  uvIndex, pollen, achesIndex, breathingIndex,
  POLLEN_CATEGORIES, scaleCategory,
};
