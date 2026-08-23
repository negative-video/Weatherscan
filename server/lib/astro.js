'use strict';

/**
 * Local astronomical calculations, so the almanac slide does not depend on a
 * third-party service. The upstream project called icalendar37.net for moon
 * phases; that is a single point of failure for a slide that is pure maths.
 *
 * Moon phases follow Meeus, "Astronomical Algorithms", ch. 49, with the
 * principal periodic corrections. Accurate to a few minutes, which is far more
 * than a slide showing "FULL — Feb 21" needs.
 */

const RAD = Math.PI / 180;
const SYNODIC = 29.530588861;

function toJulian(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function fromJulian(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

/** Julian Ephemeris Day of the phase for lunation index k. */
function phaseJDE(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  let jde =
    2451550.09766 +
    SYNODIC * k +
    0.00015437 * T2 -
    0.00000015 * T3 +
    0.00000000073 * T4;

  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  // Sun's mean anomaly
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3) * RAD;
  // Moon's mean anomaly
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3) * RAD;
  // Moon's argument of latitude
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3) * RAD;
  // Longitude of the ascending node
  const O = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * RAD;

  const frac = ((k % 1) + 1) % 1;
  const isQuarter = Math.abs(frac - 0.25) < 1e-6 || Math.abs(frac - 0.75) < 1e-6;

  if (!isQuarter) {
    // New moon (frac 0) and full moon (frac 0.5) share a correction series,
    // differing only in the leading coefficient's sign convention.
    const isNew = frac < 0.25;
    const c = isNew
      ? [-0.4072, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208]
      : [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209];
    jde +=
      c[0] * Math.sin(Mp) +
      c[1] * E * Math.sin(M) +
      c[2] * Math.sin(2 * Mp) +
      c[3] * Math.sin(2 * F) +
      c[4] * E * Math.sin(Mp - M) +
      c[5] * E * Math.sin(Mp + M) +
      c[6] * E * E * Math.sin(2 * M) -
      0.00111 * Math.sin(Mp - 2 * F) -
      0.00057 * Math.sin(Mp + 2 * F) +
      0.00056 * E * Math.sin(2 * Mp + M) -
      0.00042 * Math.sin(3 * Mp) +
      0.00042 * E * Math.sin(M + 2 * F) +
      0.00038 * E * Math.sin(M - 2 * F) -
      0.00024 * E * Math.sin(2 * Mp - M) -
      0.00017 * Math.sin(O);
  } else {
    jde +=
      -0.62801 * Math.sin(Mp) +
      0.17172 * E * Math.sin(M) -
      0.01183 * E * Math.sin(Mp + M) +
      0.00862 * Math.sin(2 * Mp) +
      0.00804 * Math.sin(2 * F) +
      0.00454 * E * Math.sin(Mp - M) +
      0.00204 * E * E * Math.sin(2 * M) -
      0.0018 * Math.sin(Mp - 2 * F) -
      0.0007 * Math.sin(Mp + 2 * F) -
      0.0004 * Math.sin(3 * Mp) -
      0.00034 * E * Math.sin(2 * Mp - M) +
      0.00032 * E * Math.sin(M + 2 * F) +
      0.00032 * E * Math.sin(M - 2 * F);

    const W =
      0.00306 -
      0.00038 * E * Math.cos(M) +
      0.00026 * Math.cos(Mp) -
      0.00002 * Math.cos(Mp - M) +
      0.00002 * Math.cos(Mp + M) +
      0.00002 * Math.cos(2 * F);
    // First quarter adds W, last quarter subtracts it.
    jde += Math.abs(frac - 0.25) < 1e-6 ? W : -W;
  }

  return jde;
}

const PHASE_NAMES = ['NEW', 'FIRST', 'FULL', 'LAST'];

/**
 * The next `count` principal moon phases strictly after `from`.
 * @returns {{name:string, date:Date}[]}
 */
function upcomingPhases(from = new Date(), count = 4) {
  const jdNow = toJulian(from);
  const year =
    from.getUTCFullYear() +
    (from.getUTCMonth() * 30.4 + from.getUTCDate()) / 365.25;

  // Step back a full lunation so nothing near the boundary is missed.
  let k = Math.floor((year - 2000) * 12.3685) - 1;
  const out = [];

  while (out.length < count && k < 100000) {
    for (let q = 0; q < 4; q++) {
      const jde = phaseJDE(k + q * 0.25);
      if (jde > jdNow && out.length < count) {
        out.push({ name: PHASE_NAMES[q], date: fromJulian(jde) });
      }
    }
    k++;
  }
  return out;
}

/** Illuminated fraction, 0..1, and a coarse phase name for the current instant. */
function moonIllumination(date = new Date()) {
  const jd = toJulian(date);
  const daysSinceNew = (jd - 2451550.1) % SYNODIC;
  const age = daysSinceNew < 0 ? daysSinceNew + SYNODIC : daysSinceNew;
  const phase = age / SYNODIC;
  return { age, phase, fraction: (1 - Math.cos(2 * Math.PI * phase)) / 2 };
}

/**
 * Sunrise / sunset as epoch seconds (UTC), via the NOAA low-precision method.
 * Only used when the weather provider does not supply them.
 * @returns {{sunrise:number|null, sunset:number|null}}
 */
function sunTimes(date, lat, lon) {
  // n must be a whole number of days since J2000; the classic mistake here is
  // feeding in a fractional JD, which slides every result by half a day.
  const n = Math.round(toJulian(date) - 2451545.0 + 0.0008);
  const Jstar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C =
    1.9148 * Math.sin(M * RAD) +
    0.02 * Math.sin(2 * M * RAD) +
    0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const Jtransit =
    2451545.0 + Jstar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.44 * RAD));

  const cosOmega =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) /
    (Math.cos(lat * RAD) * Math.cos(decl));

  // Polar day or polar night: the sun never crosses the horizon.
  if (cosOmega > 1 || cosOmega < -1) return { sunrise: null, sunset: null };

  const omega = Math.acos(cosOmega) / RAD;
  const jset = Jtransit + omega / 360;
  const jrise = Jtransit - omega / 360;

  return {
    sunrise: Math.round((jrise - 2440587.5) * 86400),
    sunset: Math.round((jset - 2440587.5) * 86400),
  };
}

module.exports = { upcomingPhases, moonIllumination, sunTimes, toJulian, fromJulian };
