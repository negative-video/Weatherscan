'use strict';

const test = require('node:test');
const assert = require('node:assert');
const health = require('../server/services/health');

/**
 * The two derived indices point in opposite directions, and nothing downstream
 * says so out loud — the slide encodes it in a lookup table of pixel offsets.
 * These tests are here because getting it backwards is invisible on the server
 * and only shows up as an arrow sitting at the opposite end of the bar from the
 * word printed on it.
 */

// Enough of a weather object for both indices to run.
function weather({ temperature = 60, humidity = 50, pressure = 30.0 } = {}) {
  const hourly = [];
  for (let i = 0; i < 24; i++) {
    hourly.push({ time: 1700000000 + i * 3600, temperature, humidity, pressure });
  }
  return { current: { temperature, humidity, pressure, uvIndex: 3, isDay: true }, hourly };
}

const CLEAN_AIR = { aqi: 10 };
const FOUL_AIR = { aqi: 200 };
const NO_POLLEN = { available: true, types: { tree: 0, grass: 0, weed: 0 } };
const HEAVY_POLLEN = { available: true, types: { tree: 4, grass: 4, weed: 4 } };

test('breathing counts up towards comfort, not severity', () => {
  const good = health.breathingIndex(weather(), CLEAN_AIR, NO_POLLEN);
  const bad = health.breathingIndex(weather({ humidity: 90 }), FOUL_AIR, HEAVY_POLLEN);

  assert.ok(good.index > bad.index,
    `clean air should score higher than foul air, got ${good.index} vs ${bad.index}`);
  assert.ok(good.index >= 1 && good.index <= 10, `index ${good.index} out of range`);
  assert.ok(bad.index >= 1 && bad.index <= 10, `index ${bad.index} out of range`);
});

test('aches counts up towards severity', () => {
  const calm = health.achesIndex(weather());
  const rough = health.achesIndex(weather({ temperature: 28, humidity: 85, pressure: 29.5 }));

  assert.ok(rough.index > calm.index,
    `a cold damp falling-pressure day should score higher, got ${rough.index} vs ${calm.index}`);
});

test('the two indices do not share a vocabulary', () => {
  // "Low breathing" would be nonsense, and the slide ships "Good" as the
  // placeholder on the breathing arrow.
  const aches = ['Low', 'Moderate', 'High', 'Very High'];
  const breathing = ['Poor', 'Fair', 'Good', 'Excellent'];

  for (let i = 1; i <= 10; i++) {
    assert.ok(aches.includes(health.scaleCategory(i)), `aches band ${i}`);
    assert.ok(breathing.includes(health.breathingCategory(i)), `breathing band ${i}`);
  }
});

test('the breathing label agrees with the end of the bar the arrow lands on', () => {
  // slides-loop.js maps the index to a pixel offset along a 300px track, with
  // 10 at the left-hand "good" end. The label has to match that end.
  const blength = { 10:-10, 9:22, 8:55, 7:88, 6:121, 5:154, 4:187, 3:220, 2:253, 1:286, 0:300 };

  for (let i = 1; i <= 10; i++) {
    const leftHalf = blength[i] < 145;
    const positive = ['Good', 'Excellent'].includes(health.breathingCategory(i));
    assert.strictEqual(positive, leftHalf,
      `index ${i} sits at ${blength[i]}px but is labelled ${health.breathingCategory(i)}`);
  }
});
