'use strict';

const test = require('node:test');
const assert = require('node:assert');

/**
 * Offline regression checks for reverse geocoding.
 *
 * http must be patched before geocode is required: geocode destructures
 * getJSON at module load, so a later swap on the http module is not seen.
 */
const http = require('../server/lib/http');
const realGetJSON = http.getJSON;
let failReverse = false;

http.getJSON = async (url, opts) => {
  if (failReverse && url.includes('bigdatacloud')) {
    throw new Error('simulated reverse-geocoder outage');
  }
  return realGetJSON(url, opts);
};

const geocode = require('../server/services/geocode');
const places = require('../server/services/places');

// Rural enough that the bundled index has nothing within reverse()'s preferred
// fifteen-mile radius, which is what sends it out to the web geocoder.
const LAT = 38.0251;
const LON = -78.0042;

test('the bundled index cannot answer this point at the preferred radius', () => {
  assert.strictEqual(places.nearest(LAT, LON, 15), null,
    'pick a more rural fixture: this test only exercises the fallback if the index misses');
});

// The timeout is the point of the test. reverse() used to fall back through
// nearby(), which opens by awaiting reverse() for the same coordinates — and
// the cache hands a second caller for an in-flight key the very promise the
// first call is still producing. It awaited itself and never settled, so a
// regression here hangs rather than throwing.
test('reverse survives a failing web geocoder', { timeout: 10000 }, async () => {
  failReverse = true;
  try {
    const place = await geocode.reverse(LAT, LON);
    assert.ok(place && place.name, 'expected a named place');
    assert.strictEqual(place.country, 'US');
    // Falls back to the index at a wider radius rather than to bare coordinates.
    assert.ok(!/^-?\d+\.\d+, /.test(place.name),
      `expected a city name, got the raw coordinates: ${place.name}`);
  } finally {
    failReverse = false;
  }
});

// The deadlock poisoned its cache key for the life of the process: the
// in-flight entry is cleared in a finally that a self-await never reaches, so
// every later caller for the point got the same dead promise.
test('a failed reverse does not wedge later lookups', { timeout: 10000 }, async () => {
  const near = await geocode.nearby(LAT, LON, 8);
  assert.ok(near.length >= 5, `expected surrounding towns, got ${near.length}`);
});
