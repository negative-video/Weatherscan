'use strict';

const path = require('path');
const fs = require('fs');
const { distanceMi } = require('../lib/units');

/**
 * A bundled index of US populated places (GeoNames cities5000, CC BY 4.0).
 *
 * Two of the IntelliStar's staples — the eight surrounding cities and the
 * statewide conditions ticker — are spatial and attribute queries, which no
 * free *name* geocoder answers. The upstream project used an OpenDataSoft demo
 * dataset for the ticker; that endpoint now 404s. Shipping the data removes the
 * dependency entirely, answers in microseconds, and works offline.
 */

let index = null;

function load() {
  if (index) return index;
  const file = path.join(__dirname, '..', 'data', 'us-cities.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

  const cities = raw.cities.map(([name, lat, lon, state, population]) => ({
    name, lat, lon, state, population,
  }));

  const byState = new Map();
  for (const c of cities) {
    if (!byState.has(c.state)) byState.set(c.state, []);
    byState.get(c.state).push(c);
  }

  index = { cities, byState, source: raw.source, count: raw.count };
  return index;
}

/**
 * Populated places near a point, ordered by a blend of distance and size so the
 * list favours towns a viewer would recognize over the nearest hamlet.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {object} [opts]
 * @param {number} [opts.limit=8]
 * @param {number} [opts.radiusMi=60]
 * @param {number} [opts.minPopulation=5000]
 * @param {string[]} [opts.exclude] names to leave out (usually the main city)
 */
function nearby(lat, lon, opts = {}) {
  const {
    limit = 8, radiusMi = 60, minPopulation = 5000, exclude = [],
  } = opts;
  const { cities } = load();
  const skip = new Set(exclude.map((n) => String(n).toLowerCase()));

  const found = [];
  for (const c of cities) {
    if (c.population < minPopulation) continue;
    // Cheap bounding-box reject before the trig; 1 degree of latitude is ~69mi.
    if (Math.abs(c.lat - lat) > radiusMi / 69) continue;
    if (Math.abs(c.lon - lon) > radiusMi / (69 * Math.max(0.15, Math.cos((lat * Math.PI) / 180)))) continue;

    const miles = distanceMi(lat, lon, c.lat, c.lon);
    if (miles > radiusMi || miles < 1) continue;
    if (skip.has(c.name.toLowerCase())) continue;

    found.push({ ...c, distanceMi: +miles.toFixed(1) });
  }

  found.sort((a, b) => score(a) - score(b));
  return dedupeByName(found).slice(0, limit);
}

// Lower is better. Population pulls a bigger city forward by a few "miles".
function score(city) {
  return city.distanceMi - Math.log10(city.population + 10) * 6;
}

function dedupeByName(list) {
  const seen = new Set();
  return list.filter((c) => {
    const key = c.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The single closest populated place, including one at distance zero.
 *
 * Distinct from nearby(), which deliberately excludes the point itself because
 * its job is listing *surrounding* towns. Reverse geocoding wants the opposite:
 * ask it for Charlottesville's own coordinates and it must answer
 * "Charlottesville", not the next town over.
 */
function nearest(lat, lon, radiusMi = 15) {
  const { cities } = load();
  let best = null;
  let bestScore = Infinity;

  for (const c of cities) {
    if (Math.abs(c.lat - lat) > radiusMi / 69) continue;
    const miles = distanceMi(lat, lon, c.lat, c.lon);
    if (miles > radiusMi) continue;
    // Break near-ties toward the larger place, so a coordinate inside a city
    // does not resolve to a tiny suburb that happens to be marginally closer.
    const score = miles - Math.log10(c.population + 10) * 1.2;
    if (score < bestScore) {
      bestScore = score;
      best = { ...c, distanceMi: +miles.toFixed(1) };
    }
  }
  return best;
}

/** Largest cities in a state, by USPS code or full name. */
function inState(state, limit = 10) {
  const { byState } = load();
  const code = normalizeState(state);
  const list = byState.get(code) || [];
  return list.slice(0, limit).map((c) => ({ ...c }));
}

/** Exact-ish name lookup, used to resolve configured city names to coordinates. */
function findByName(name, state) {
  const { cities } = load();
  const wanted = String(name).toLowerCase().trim();
  const code = state ? normalizeState(state) : null;

  const matches = cities.filter(
    (c) => c.name.toLowerCase() === wanted && (!code || c.state === code)
  );
  if (matches.length) return matches.sort((a, b) => b.population - a.population)[0];
  return null;
}

const FULL_TO_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'puerto rico': 'PR',
};

function normalizeState(state) {
  if (!state) return '';
  const s = String(state).trim();
  if (s.length === 2) return s.toUpperCase();
  return FULL_TO_CODE[s.toLowerCase()] || s.toUpperCase();
}

function stats() {
  const { count, source, byState } = load();
  return { count, source, states: byState.size };
}

module.exports = { nearby, nearest, inState, findByName, normalizeState, stats, load };
