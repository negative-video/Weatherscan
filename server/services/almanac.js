'use strict';

const { getJSON } = require('../lib/http');
const { cache } = require('../lib/cache');
const { config } = require('../config');
const { localParts } = require('../lib/units');
const { upcomingPhases } = require('../lib/astro');

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const YEARS = 30;

/**
 * Climate normals and records for today's calendar date.
 *
 * weather.com served this from a proprietary almanac product with no free
 * equivalent, so it is computed here instead: pull 30 years of ERA5 reanalysis
 * for the point, keep the rows matching today's month and day, and reduce.
 * One request per location per day, and the answer is a genuine 30-year normal
 * with real record years rather than a placeholder.
 */
async function forPoint(lat, lon, when = new Date()) {
  if (!config.features.almanac) return null;

  const key = `almanac:${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  const history = await cache.wrap(key, config.cache.almanacMs, () => fetchHistory(lat, lon));
  if (!history) return null;

  const target = localParts(Math.floor(when.getTime() / 1000), history.utcOffsetSeconds);
  const highs = [];
  const lows = [];

  for (let i = 0; i < history.time.length; i++) {
    const p = localParts(history.time[i], history.utcOffsetSeconds);
    if (p.month !== target.month || p.day !== target.day) continue;
    if (history.max[i] != null) highs.push({ value: history.max[i], year: p.year });
    if (history.min[i] != null) lows.push({ value: history.min[i], year: p.year });
  }

  if (!highs.length || !lows.length) return null;

  const recordHigh = highs.reduce((a, b) => (b.value > a.value ? b : a));
  const recordLow = lows.reduce((a, b) => (b.value < a.value ? b : a));

  return {
    date: { month: target.month, day: target.day },
    years: highs.length,
    averageHigh: Math.round(mean(highs.map((h) => h.value))),
    averageLow: Math.round(mean(lows.map((l) => l.value))),
    recordHigh: Math.round(recordHigh.value),
    recordHighYear: recordHigh.year,
    recordLow: Math.round(recordLow.value),
    recordLowYear: recordLow.year,
    source: 'ERA5 reanalysis via Open-Meteo',
  };
}

async function fetchHistory(lat, lon) {
  // ERA5 lags real time by about five days, so end the window last year to
  // guarantee a complete series for every calendar date.
  const endYear = new Date().getUTCFullYear() - 1;
  const startYear = endYear - (YEARS - 1);

  const url =
    `${ARCHIVE_URL}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startYear}-01-01&end_date=${endYear}-12-31` +
    '&daily=temperature_2m_max,temperature_2m_min' +
    '&temperature_unit=fahrenheit&timezone=auto&timeformat=unixtime';

  const d = await getJSON(url, { timeoutMs: 45000, retries: 1 });
  if (!d.daily || !d.daily.time) return null;

  return {
    utcOffsetSeconds: d.utc_offset_seconds || 0,
    time: d.daily.time,
    max: d.daily.temperature_2m_max,
    min: d.daily.temperature_2m_min,
  };
}

/** The next four principal moon phases, computed locally. */
function moonPhases(when = new Date()) {
  return upcomingPhases(when, 4).map((p) => ({
    name: p.name,
    date: p.date,
    month: p.date.getUTCMonth() + 1,
    day: p.date.getUTCDate(),
  }));
}

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

module.exports = { forPoint, moonPhases };
