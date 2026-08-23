'use strict';

const { getJSON } = require('../lib/http');
const { cache } = require('../lib/cache');
const { config } = require('../config');
const { distanceMi } = require('../lib/units');
const places = require('./places');

const SEARCH_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * Location services, all key-free.
 *
 * `nearby` deserves a note: the previous migration mapped weather.com's
 * /v3/location/near onto OpenWeatherMap reverse geocoding, which returns
 * alternate *names for the same point* rather than surrounding towns. The
 * nearby-cities and 8-city slides ended up listing the same place eight times.
 * Here it is a real radius search over a populated-places index.
 */

async function search(query, limit = 10) {
  if (!query || !String(query).trim()) return [];
  const q = String(query).trim();

  return cache.wrap(`geo:s:${q}:${limit}`, config.cache.geocodeMs, async () => {
    // A bare US ZIP resolves poorly by name; Zippopotam handles it exactly.
    if (/^\d{5}$/.test(q)) {
      const zip = await zipLookup(q);
      if (zip) return [zip];
    }

    const url =
      `${SEARCH_URL}?name=${encodeURIComponent(q)}&count=${Math.min(limit, 20)}` +
      '&language=en&format=json';
    const data = await getJSON(url);
    return (data.results || []).map(toPlace);
  });
}

async function zipLookup(zip) {
  try {
    const d = await getJSON(`https://api.zippopotam.us/us/${zip}`);
    const place = d.places && d.places[0];
    if (!place) return null;
    return {
      name: place['place name'],
      lat: parseFloat(place.latitude),
      lon: parseFloat(place.longitude),
      state: place['state abbreviation'] || place.state || '',
      stateName: place.state || '',
      country: d['country abbreviation'] || 'US',
      countryName: d.country || 'United States',
      admin2: '',
      population: null,
      postcode: zip,
    };
  } catch {
    return null;
  }
}

function toPlace(r) {
  return {
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    // admin1 is the state/province; the IntelliStar wants the abbreviation.
    state: stateAbbrev(r.admin1, r.country_code),
    stateName: r.admin1 || '',
    admin2: r.admin2 || '',
    country: r.country_code || '',
    countryName: r.country || '',
    population: r.population || null,
    timezone: r.timezone || null,
    elevation: r.elevation != null ? r.elevation : null,
  };
}

async function reverse(lat, lon) {
  return cache.wrap(`geo:r:${fix(lat)},${fix(lon)}`, config.cache.geocodeMs, async () => {
    // Prefer the bundled index for US points. Web reverse-geocoders answer
    // rural US coordinates with civil-township names — "Cunningham District"
    // rather than "Crozet" — which is not what belongs on a weather display.
    const c = places.nearest(lat, lon, 15);
    if (c) {
      return {
        name: c.name,
        lat: Number(lat),
        lon: Number(lon),
        state: c.state,
        stateName: STATE_NAMES[c.state] || c.state,
        admin2: '',
        country: 'US',
        countryName: 'United States',
        locality: c.name,
        city: c.name,
        population: c.population,
      };
    }

    // Open-Meteo has no reverse endpoint; BigDataCloud's is free and key-free.
    const url =
      'https://api.bigdatacloud.net/data/reverse-geocode-client' +
      `?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    try {
      const d = await getJSON(url);
      const name =
        d.city || d.locality || d.principalSubdivision || d.countryName || 'Unknown';
      return {
        name,
        lat: Number(lat),
        lon: Number(lon),
        state: d.principalSubdivisionCode
          ? String(d.principalSubdivisionCode).split('-').pop()
          : stateAbbrev(d.principalSubdivision, d.countryCode),
        stateName: d.principalSubdivision || '',
        admin2: (d.localityInfo && d.localityInfo.administrative &&
          d.localityInfo.administrative[3] && d.localityInfo.administrative[3].name) || '',
        country: d.countryCode || 'US',
        countryName: d.countryName || '',
        locality: d.locality || '',
        city: d.city || '',
      };
    } catch {
      // Last resort: the nearest populated place from the forward index.
      const near = await nearby(lat, lon, 1);
      if (near.length) return near[0];
      return {
        name: `${Number(lat).toFixed(2)}, ${Number(lon).toFixed(2)}`,
        lat: Number(lat), lon: Number(lon),
        state: '', stateName: '', admin2: '', country: 'US', countryName: '',
      };
    }
  });
}

/**
 * Populated places near a point, nearest-and-largest first.
 *
 * US coordinates are answered from the bundled GeoNames index — a radius query
 * that no free name-geocoder can serve. Outside the US the index has no data,
 * so fall back to a name search seeded from the reverse-geocoded admin area.
 */
async function nearby(lat, lon, limit = 10, radiusMi = 60) {
  return cache.wrap(`geo:n:${fix(lat)},${fix(lon)}:${limit}`, config.cache.geocodeMs, async () => {
    const origin = await reverse(lat, lon).catch(() => null);
    const exclude = origin ? [origin.name, origin.city].filter(Boolean) : [];

    if (!origin || origin.country === 'US') {
      const local = places.nearby(lat, lon, { limit, radiusMi, exclude });
      if (local.length) {
        return local.map((c) => ({
          name: c.name, lat: c.lat, lon: c.lon, state: c.state,
          stateName: STATE_NAMES[c.state] || c.state, admin2: '',
          country: 'US', countryName: 'United States',
          population: c.population, distanceMi: c.distanceMi,
        }));
      }
    }

    return nearbyByName(lat, lon, limit, radiusMi, origin);
  });
}

/**
 * Non-US fallback. Two passes: first probe a ring of points around the origin
 * and reverse-geocode each, which works anywhere on earth; then, if that comes
 * up short, search the surrounding admin area by name.
 */
async function nearbyByName(lat, lon, limit, radiusMi, origin) {
  const ring = await probeRing(lat, lon, radiusMi, origin);
  if (ring.length >= Math.min(limit, 4)) return ring.slice(0, limit);

  const seeds = [];
  if (origin) {
    if (origin.admin2) seeds.push(origin.admin2);
    if (origin.stateName) seeds.push(origin.stateName);
  }
  if (!seeds.length) return ring.slice(0, limit);

  const seen = new Set(ring.map((r) => `${r.name}|${r.state}`));
  const results = [...ring];
  for (const seed of seeds.slice(0, 2)) {
    const url = `${SEARCH_URL}?name=${encodeURIComponent(seed)}&count=100&language=en&format=json`;
    const data = await getJSON(url).catch(() => ({ results: [] }));
    for (const r of data.results || []) {
      const place = toPlace(r);
      const miles = distanceMi(lat, lon, place.lat, place.lon);
      if (miles > radiusMi || miles < 1) continue;
      const key = `${place.name}|${place.state}`;
      if (seen.has(key)) continue;
      if (origin && place.name === origin.name) continue;
      seen.add(key);
      results.push({ ...place, distanceMi: +miles.toFixed(1) });
    }
  }

  results.sort(
    (a, b) =>
      a.distanceMi - Math.log10((a.population || 100) + 10) * 4 -
      (b.distanceMi - Math.log10((b.population || 100) + 10) * 4)
  );
  return results.slice(0, limit);
}

/**
 * Sample points on two concentric rings and reverse-geocode each one. Slower
 * than an index lookup, but it needs no key and works outside the US.
 */
async function probeRing(lat, lon, radiusMi, origin) {
  const seen = new Set();
  if (origin && origin.name) seen.add(origin.name.toLowerCase());

  const targets = [];
  for (const [miles, count] of [[radiusMi * 0.4, 6], [radiusMi * 0.8, 6]]) {
    for (let i = 0; i < count; i++) {
      const bearing = (360 / count) * i + (miles > radiusMi * 0.5 ? 30 : 0);
      targets.push(offsetPoint(lat, lon, miles, bearing));
    }
  }

  const settled = await Promise.all(
    targets.map((t) => reverse(t.lat, t.lon).catch(() => null))
  );

  const out = [];
  for (const place of settled) {
    if (!place || !place.name) continue;
    const key = place.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...place, distanceMi: +distanceMi(lat, lon, place.lat, place.lon).toFixed(1) });
  }
  out.sort((a, b) => a.distanceMi - b.distanceMi);
  return out;
}

/** Destination point given a start, a distance in miles, and a bearing. */
function offsetPoint(lat, lon, miles, bearingDeg) {
  const R = 3958.7613;
  const d = miles / R;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: (lat2 * 180) / Math.PI, lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180 };
}

/** Largest cities in a state, for the conditions ticker. */
async function citiesInState(stateName, limit = 10) {
  if (!stateName) return [];
  const local = places.inState(stateName, limit);
  if (local.length) {
    return local.map((c) => ({
      name: c.name, lat: c.lat, lon: c.lon, state: c.state,
      stateName: STATE_NAMES[c.state] || c.state,
      country: 'US', countryName: 'United States',
      population: c.population,
    }));
  }
  return [];
}

const US_STATES = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY', 'Puerto Rico': 'PR',
};

function stateAbbrev(admin1, countryCode) {
  if (!admin1) return '';
  if (countryCode && countryCode !== 'US') return admin1;
  return US_STATES[admin1] || admin1;
}

const STATE_NAMES = Object.fromEntries(
  Object.entries(US_STATES).map(([name, code]) => [code, name])
);

const fix = (n) => Number(n).toFixed(3);

module.exports = { search, reverse, nearby, citiesInState, stateAbbrev, US_STATES };
