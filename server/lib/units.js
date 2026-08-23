'use strict';

const CARDINALS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

function degToCardinal(deg) {
  if (deg === null || deg === undefined || Number.isNaN(deg)) return 'CALM';
  return CARDINALS[Math.round(deg / 22.5) % 16];
}

/**
 * Render an instant as an ISO string carrying the *location's* UTC offset,
 * e.g. 2026-08-23T14:00:00-04:00.
 *
 * This is the single most important function in the backend. The legacy
 * frontend calls dateFns.getHours() on these strings to decide which forecast
 * hours to display, and compares them against `new Date()`. weather.com always
 * returned local-with-offset; emitting a bare UTC "Z" shifts every hourly
 * column, sunrise, and sunset by the viewer's UTC offset.
 *
 * @param {number} epochSeconds
 * @param {number} utcOffsetSeconds offset at the location, from the provider
 */
function localISO(epochSeconds, utcOffsetSeconds = 0) {
  if (epochSeconds === null || epochSeconds === undefined) return null;
  const shifted = new Date((epochSeconds + utcOffsetSeconds) * 1000);
  const pad = (n) => String(n).padStart(2, '0');

  const y = shifted.getUTCFullYear();
  const mo = pad(shifted.getUTCMonth() + 1);
  const d = pad(shifted.getUTCDate());
  const h = pad(shifted.getUTCHours());
  const mi = pad(shifted.getUTCMinutes());
  const s = pad(shifted.getUTCSeconds());

  const sign = utcOffsetSeconds < 0 ? '-' : '+';
  const abs = Math.abs(utcOffsetSeconds);
  const oh = pad(Math.floor(abs / 3600));
  const om = pad(Math.floor((abs % 3600) / 60));

  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}:${om}`;
}

/** Wall-clock parts at the location, for "is it past 3pm there?" decisions. */
function localParts(epochSeconds, utcOffsetSeconds = 0) {
  const shifted = new Date((epochSeconds + utcOffsetSeconds) * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * UTC offset in seconds for an IANA zone at a given instant, DST included.
 * Home Assistant reports a zone name rather than an offset, so this is how the
 * HA provider gets the number every timestamp is rendered against.
 */
function offsetForTimeZone(timeZone, date = new Date()) {
  if (!timeZone) return 0;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = {};
    for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
    // Intl renders hour 24 for midnight under hour12:false in some engines.
    const hour = parts.hour === '24' ? '00' : parts.hour;
    const asUTC = Date.UTC(
      +parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second
    );
    return Math.round((asUTC - date.getTime()) / 1000);
  } catch {
    return 0;
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOfWeek = (epochSeconds, utcOffsetSeconds = 0) =>
  DAY_NAMES[localParts(epochSeconds, utcOffsetSeconds).weekday];

const cToF = (c) => (c === null || c === undefined ? null : Math.round((c * 9) / 5 + 32));
const kmhToMph = (k) => (k === null || k === undefined ? null : Math.round(k * 0.621371));
const msToMph = (m) => (m === null || m === undefined ? null : Math.round(m * 2.236936));
const mbToInHg = (mb) => (mb === null || mb === undefined ? null : +(mb * 0.0295299830714).toFixed(2));
const mToMiles = (m) => (m === null || m === undefined ? null : +(m / 1609.344).toFixed(1));
const mToFeet = (m) => (m === null || m === undefined ? null : Math.round(m * 3.28084));
const round = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n));

/** Title Case, but leave short connecting words alone. "light rain" -> "Light Rain" */
function titleCase(phrase) {
  if (!phrase) return '';
  const small = new Set(['and', 'with', 'the', 'in', 'of', 'to', 'a', 'an', 'or']);
  return String(phrase)
    .split(' ')
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function uvDescription(uvi) {
  if (uvi === null || uvi === undefined) return '';
  if (uvi < 3) return 'Low';
  if (uvi < 6) return 'Moderate';
  if (uvi < 8) return 'High';
  if (uvi < 11) return 'Very High';
  return 'Extreme';
}

/** Great-circle distance in miles. */
function distanceMi(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** NWS heat index (F). Only meaningful at/above 80F. */
function heatIndex(T, R) {
  if (T === null || R === null || T < 80) return null;
  const T2 = T * T;
  const R2 = R * R;
  return Math.round(
    -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R -
      6.83783e-3 * T2 - 5.481717e-2 * R2 + 1.22874e-3 * T2 * R +
      8.5282e-4 * T * R2 - 1.99e-6 * T2 * R2
  );
}

/** NWS wind chill (F). Only meaningful at/below 50F with wind above 3mph. */
function windChill(T, mph) {
  if (T === null || mph === null || T > 50 || mph <= 3) return null;
  const v = Math.pow(mph, 0.16);
  return Math.round(35.74 + 0.6215 * T - 35.75 * v + 0.4275 * T * v);
}

function dewPointF(tempF, rh) {
  if (tempF === null || rh === null || rh <= 0) return null;
  const tc = ((tempF - 32) * 5) / 9;
  const a = 17.625;
  const b = 243.04;
  const alpha = Math.log(rh / 100) + (a * tc) / (b + tc);
  const dc = (b * alpha) / (a - alpha);
  return Math.round((dc * 9) / 5 + 32);
}

module.exports = {
  degToCardinal, localISO, localParts, dayOfWeek, DAY_NAMES, offsetForTimeZone,
  cToF, kmhToMph, msToMph, mbToInHg, mToMiles, mToFeet, round,
  titleCase, uvDescription, distanceMi, heatIndex, windChill, dewPointF,
};
