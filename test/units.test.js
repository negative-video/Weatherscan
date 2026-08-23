'use strict';

const test = require('node:test');
const assert = require('node:assert');
const U = require('../server/lib/units');

test('localISO renders the location offset, not UTC', () => {
  // 2026-08-23T04:00:00Z is 00:00 on the 23rd in EDT (-4).
  const epoch = Date.UTC(2026, 7, 23, 4, 0, 0) / 1000;
  assert.strictEqual(U.localISO(epoch, -4 * 3600), '2026-08-23T00:00:00-04:00');
  assert.strictEqual(U.localISO(epoch, 0), '2026-08-23T04:00:00+00:00');
  assert.strictEqual(U.localISO(epoch, 5.5 * 3600), '2026-08-23T09:30:00+05:30');
});

test('localISO parses back to the same instant', () => {
  const epoch = Math.floor(Date.now() / 1000);
  for (const offset of [-28800, -14400, 0, 3600, 19800, 46800]) {
    const iso = U.localISO(epoch, offset);
    assert.strictEqual(Math.floor(new Date(iso).getTime() / 1000), epoch,
      `round-trip failed for offset ${offset} (${iso})`);
  }
});

test('localISO handles negative sub-hour offsets', () => {
  const epoch = Date.UTC(2026, 0, 1, 12, 0, 0) / 1000;
  // Newfoundland, UTC-3:30
  assert.strictEqual(U.localISO(epoch, -12600), '2026-01-01T08:30:00-03:30');
});

test('localParts reports wall-clock time at the location', () => {
  const epoch = Date.UTC(2026, 7, 23, 4, 0, 0) / 1000;
  const p = U.localParts(epoch, -4 * 3600);
  assert.strictEqual(p.hour, 0);
  assert.strictEqual(p.day, 23);
  assert.strictEqual(p.month, 8);
});

test('degToCardinal covers the compass and treats null as calm', () => {
  assert.strictEqual(U.degToCardinal(0), 'N');
  assert.strictEqual(U.degToCardinal(90), 'E');
  assert.strictEqual(U.degToCardinal(180), 'S');
  assert.strictEqual(U.degToCardinal(270), 'W');
  assert.strictEqual(U.degToCardinal(350), 'N'); // wraps
  assert.strictEqual(U.degToCardinal(null), 'CALM');
});

test('unit conversions match reference values', () => {
  assert.strictEqual(U.cToF(0), 32);
  assert.strictEqual(U.cToF(100), 212);
  assert.strictEqual(U.mbToInHg(1013.25), 29.92);
  assert.strictEqual(U.kmhToMph(100), 62);
  assert.strictEqual(U.mToMiles(1609.34), 1.0);
});

test('heat index and wind chill only apply in their valid ranges', () => {
  assert.strictEqual(U.heatIndex(70, 50), null, 'no heat index below 80F');
  assert.ok(U.heatIndex(95, 70) > 95, 'heat index exceeds air temperature');
  assert.strictEqual(U.windChill(60, 20), null, 'no wind chill above 50F');
  assert.ok(U.windChill(20, 20) < 20, 'wind chill is below air temperature');
  assert.strictEqual(U.windChill(20, 2), null, 'no wind chill in light wind');
});

test('offsetForTimeZone resolves DST correctly', () => {
  const summer = new Date('2026-07-15T12:00:00Z');
  const winter = new Date('2026-01-15T12:00:00Z');
  assert.strictEqual(U.offsetForTimeZone('America/New_York', summer), -4 * 3600);
  assert.strictEqual(U.offsetForTimeZone('America/New_York', winter), -5 * 3600);
  assert.strictEqual(U.offsetForTimeZone('UTC', summer), 0);
  assert.strictEqual(U.offsetForTimeZone('Asia/Kolkata', summer), 19800);
});

test('offsetForTimeZone survives a bogus zone', () => {
  assert.strictEqual(U.offsetForTimeZone('Not/AZone'), 0);
  assert.strictEqual(U.offsetForTimeZone(''), 0);
});

test('distanceMi matches a known city pair', () => {
  // Charlottesville VA to Richmond VA: ~64.5 miles great-circle.
  // (Road distance is ~70; this function measures straight-line.)
  const d = U.distanceMi(38.0293, -78.4767, 37.5538, -77.4603);
  assert.ok(d > 62 && d < 67, `expected ~64.5mi, got ${d}`);
});

test('distanceMi is symmetric and zero for identical points', () => {
  const a = U.distanceMi(38.0293, -78.4767, 37.5538, -77.4603);
  const b = U.distanceMi(37.5538, -77.4603, 38.0293, -78.4767);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.strictEqual(U.distanceMi(38, -78, 38, -78), 0);
});

test('uvDescription bands', () => {
  assert.strictEqual(U.uvDescription(1), 'Low');
  assert.strictEqual(U.uvDescription(5), 'Moderate');
  assert.strictEqual(U.uvDescription(7), 'High');
  assert.strictEqual(U.uvDescription(9), 'Very High');
  assert.strictEqual(U.uvDescription(12), 'Extreme');
});
