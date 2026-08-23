'use strict';

const { getJSON } = require('../lib/http');
const { cache } = require('../lib/cache');
const { config } = require('../config');
const icons = require('../lib/icons');
const U = require('../lib/units');

const METAR_URL = 'https://aviationweather.gov/api/data/metar';
const FAA_URL = 'https://nasstatus.faa.gov/api/airport-events';

/**
 * Airport conditions and delays.
 *
 * Conditions come from live METAR observations via aviationweather.gov, which
 * is what the airport slides always wanted — an actual field observation rather
 * than a gridded forecast interpolated to the runway.
 *
 * Delays come from the FAA's National Airspace System status feed. That feed
 * has no CORS headers, which is the one genuine reason this project needed a
 * proxy at all; now it is a normal server-side fetch.
 */

// Most US airports are ICAO "K" + IATA. These are the ones that are not.
const IATA_TO_ICAO = {
  ANC: 'PANC', FAI: 'PAFA', JNU: 'PAJN', HNL: 'PHNL', OGG: 'PHOG',
  KOA: 'PHKO', LIH: 'PHLI', ITO: 'PHTO', SJU: 'TJSJ', STT: 'TIST',
  STX: 'TISX', GUM: 'PGUM', PPG: 'NSTU', BQN: 'TJBQ', PSE: 'TJPS',
  YYZ: 'CYYZ', YVR: 'CYVR', YUL: 'CYUL', YYC: 'CYYC', YEG: 'CYEG',
  YOW: 'CYOW', YWG: 'CYWG', YHZ: 'CYHZ',
};

function toICAO(code) {
  const iata = String(code || '').toUpperCase().trim();
  if (!iata) return null;
  if (iata.length === 4) return iata; // already ICAO
  return IATA_TO_ICAO[iata] || `K${iata}`;
}

/** "Orlando Intl, FL, US" -> "Orlando Intl" */
function cleanName(name, fallback) {
  if (!name) return fallback || '';
  return String(name).split(',')[0].trim();
}

/**
 * Current conditions for a list of IATA codes.
 * @returns {Map<string, object>} keyed by the IATA code given
 */
async function conditions(iataCodes) {
  const codes = [...new Set(iataCodes.map((c) => String(c).toUpperCase().trim()).filter(Boolean))];
  if (!codes.length) return new Map();

  const key = `metar:${codes.slice().sort().join(',')}`;
  const rows = await cache.wrap(key, config.cache.airportMs, async () => {
    const icaoList = codes.map(toICAO).filter(Boolean);
    const url = `${METAR_URL}?ids=${icaoList.join(',')}&format=json`;
    const data = await getJSON(url, { timeoutMs: 15000 });
    return Array.isArray(data) ? data : [];
  });

  const byIcao = new Map(rows.map((r) => [String(r.icaoId).toUpperCase(), r]));
  const out = new Map();

  for (const iata of codes) {
    const row = byIcao.get(toICAO(iata));
    if (!row) {
      out.set(iata, null);
      continue;
    }

    // METAR is metric on the wire regardless of the station's country.
    const temperature = U.cToF(row.temp);
    const dewPoint = U.cToF(row.dewp);
    const windSpeed = row.wspd != null ? Math.round(row.wspd * 1.15078) : 0; // knots -> mph
    const windGust = row.wgst != null ? Math.round(row.wgst * 1.15078) : windSpeed;
    const humidity =
      row.temp != null && row.dewp != null ? relativeHumidity(row.temp, row.dewp) : null;

    const observed = row.obsTime || Math.floor(Date.now() / 1000);
    const isDay = isDaylight(observed, row.lat, row.lon);
    const condition = icons.fromMetar(row.cover, row.rawOb, isDay);

    // Lowest broken/overcast layer is the ceiling; scattered layers are not.
    const ceilingLayer = (row.clouds || []).find(
      (c) => (c.cover === 'BKN' || c.cover === 'OVC') && c.base != null
    );

    out.set(iata, {
      iata,
      icao: toICAO(iata),
      name: cleanName(row.name),
      temperature,
      dewPoint,
      humidity,
      condition,
      iconCode: icons.applyWind(condition.iconCode, windSpeed),
      wxPhraseLong: condition.phrase,
      windSpeed,
      windGust,
      windDeg: row.wdir === 'VRB' ? null : row.wdir,
      windDir: U.degToCardinal(row.wdir === 'VRB' ? null : row.wdir),
      visibility: parseVisibility(row.visib),
      pressure: row.altim != null ? U.mbToInHg(row.altim) : null,
      ceiling: ceilingLayer ? ceilingLayer.base : null,
      flightCategory: row.fltCat || null,
      observedTime: observed,
      lat: row.lat,
      lon: row.lon,
      raw: row.rawOb,
    });
  }
  return out;
}

/** METAR reports visibility as a number or a string like "10+" or "1 1/2". */
function parseVisibility(visib) {
  if (visib == null) return null;
  if (typeof visib === 'number') return visib;
  const s = String(visib).trim();
  if (s.endsWith('+')) return parseFloat(s);
  const fraction = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (fraction) return +(+fraction[1] + +fraction[2] / +fraction[3]).toFixed(1);
  const simple = s.match(/^(\d+)\/(\d+)$/);
  if (simple) return +(+simple[1] / +simple[2]).toFixed(2);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function relativeHumidity(tempC, dewC) {
  const e = 6.11 * Math.pow(10, (7.5 * dewC) / (237.7 + dewC));
  const es = 6.11 * Math.pow(10, (7.5 * tempC) / (237.7 + tempC));
  return Math.round((e / es) * 100);
}

function isDaylight(epoch, lat, lon) {
  if (lat == null || lon == null) return true;
  const { sunTimes } = require('../lib/astro');
  const s = sunTimes(new Date(epoch * 1000), lat, lon);
  if (!s.sunrise || !s.sunset) return true;
  return epoch >= s.sunrise && epoch <= s.sunset;
}

/**
 * Ground stops, ground delays, arrival/departure delays and closures.
 * @returns {object[]} one entry per delay, in the shape the ticker expects
 */
async function delays() {
  if (!config.features.airports) return [];

  return cache.wrap('faa:delays', config.cache.airportMs, async () => {
    const events = await getJSON(FAA_URL, { timeoutMs: 15000 });
    if (!Array.isArray(events)) return [];

    const out = [];
    for (const e of events) {
      const iata = String(e.airportId || '').toUpperCase();
      if (!iata) continue;

      if (e.airportClosure) {
        out.push(mk(iata, 'Closure', 'Closed', Number.MAX_SAFE_INTEGER, e.airportClosure.reason || ''));
      }
      if (e.arrivalDelay) {
        out.push(mk(iata, 'Arrival', formatMinutes(e.arrivalDelay.averageDelay),
          e.arrivalDelay.averageDelay || 0, e.arrivalDelay.reason || ''));
      }
      if (e.departureDelay) {
        out.push(mk(iata, 'Departure', formatMinutes(e.departureDelay.averageDelay),
          e.departureDelay.averageDelay || 0, e.departureDelay.reason || ''));
      }
      if (e.groundDelay) {
        out.push(mk(iata, 'Arrival', formatMinutes(e.groundDelay.avgDelay),
          e.groundDelay.avgDelay || 0, e.groundDelay.impactingCondition || ''));
      }
      if (e.groundStop) {
        out.push(mk(iata, 'Arrival', 'until...', 0, e.groundStop.impactingCondition || ''));
      }
    }
    return out;
  });
}

function mk(iata, type, amount, amountmin, reason) {
  return { iata, type, amount, amountmin, reason };
}

/** The slide renders this as HTML, with the numbers emphasized. */
function formatMinutes(m) {
  const minutes = Number(m) || 0;
  const hours = Math.trunc(minutes / 60);
  const rem = minutes % 60;
  return hours ? `<em>${hours}</em> hr <em>${rem}</em> min` : `<em>${rem}</em> min`;
}

module.exports = { conditions, delays, toICAO, formatMinutes, parseVisibility };
