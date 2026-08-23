'use strict';

const test = require('node:test');
const assert = require('node:assert');
const legacy = require('../server/legacy');
const { buildDayparts } = require('../server/lib/dayparts');
const icons = require('../server/lib/icons');

/**
 * These assertions encode what newweathermanager.js and slides-loop.js actually
 * read. They are the contract that lets the original frontend stay untouched,
 * so a change that breaks one of them breaks a slide.
 */

const OFFSET = -4 * 3600;

function hour(epoch, temp, iconCode, isDay, extra = {}) {
  return {
    time: epoch,
    temperature: temp,
    feelsLike: temp,
    dewPoint: temp - 5,
    condition: { iconCode, phrase: 'Test Condition' },
    precipChance: 10,
    humidity: 60,
    windDeg: 270,
    windSpeed: 8,
    windGust: 12,
    uvIndex: isDay ? 5 : 0,
    cloudCover: 40,
    visibility: 10,
    isDay,
    ...extra,
  };
}

/** A full day of synthetic hourly data starting at local midnight. */
function makeWeather(nowLocalHour = 9) {
  const midnightUTC = Date.UTC(2026, 7, 23, 4, 0, 0) / 1000; // 00:00 EDT
  const hourly = [];
  for (let i = 0; i < 72; i++) {
    const t = midnightUTC + i * 3600;
    const h = i % 24;
    const isDay = h >= 7 && h < 19;
    hourly.push(hour(t, isDay ? 80 + (h % 5) : 62 + (h % 3), isDay ? 32 : 31, isDay));
  }

  const daily = [];
  for (let d = 0; d < 3; d++) {
    daily.push({
      time: midnightUTC + d * 86400,
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday'][d],
      tempMax: 84 + d,
      tempMin: 62 + d,
      condition: { iconCode: 32, phrase: 'Sunny' },
      conditionNight: { iconCode: 31, phrase: 'Clear' },
      precipChance: 10,
      humidity: 60,
      windSpeed: 8,
      windDeg: 270,
      sunrise: midnightUTC + d * 86400 + 6 * 3600,
      sunset: midnightUTC + d * 86400 + 20 * 3600,
    });
  }

  const now = midnightUTC + nowLocalHour * 3600;
  return {
    source: 'test',
    lat: 38.03, lon: -78.48,
    timezone: 'America/New_York',
    utcOffsetSeconds: OFFSET,
    current: {
      time: now, temperature: 67, feelsLike: 69,
      condition: { iconCode: 26, phrase: 'Cloudy' },
      humidity: 92, dewPoint: 64, pressure: 29.88, pressureTrend: null,
      windDeg: 135, windDir: 'SE', windSpeed: 6, windGust: 11,
      visibility: 7.8, uvIndex: 0, cloudCover: 83, ceiling: null,
      heatIndex: null, windChill: null, isDay: nowLocalHour >= 7 && nowLocalHour < 19,
      sunrise: midnightUTC + 6 * 3600, sunset: midnightUTC + 20 * 3600,
    },
    hourly,
    daily,
    dayparts: buildDayparts(hourly, daily, OFFSET, now),
  };
}

test('observationsCurrent keeps pressureAltimeter numeric', () => {
  const o = legacy.observationsCurrent(makeWeather());
  assert.strictEqual(typeof o.pressureAltimeter, 'number',
    'the frontend calls .toFixed(2) on this and would throw on a string');
  assert.doesNotThrow(() => o.pressureAltimeter.toFixed(2));
});

test('observationsCurrent leaves windGust undefined when there is no gust', () => {
  const w = makeWeather();
  w.current.windGust = w.current.windSpeed;
  const o = legacy.observationsCurrent(w);
  assert.strictEqual(o.windGust, undefined,
    'the slide tests `!= undefined` to decide whether to print a gust');
});

test('observationsCurrent equates feels-like fields when neither effect applies', () => {
  const o = legacy.observationsCurrent(makeWeather());
  assert.strictEqual(o.temperatureHeatIndex, o.temperature);
  assert.strictEqual(o.temperatureWindChill, o.temperature);
});

test('observationsCurrent emits offset-local timestamps', () => {
  const o = legacy.observationsCurrent(makeWeather());
  for (const field of ['sunriseTimeLocal', 'sunsetTimeLocal', 'validTimeLocal']) {
    assert.match(o[field], /[+-]\d{2}:\d{2}$/,
      `${field} must carry the location offset, not a UTC Z`);
  }
});

test('forecastHourly returns parallel arrays of equal length', () => {
  const h = legacy.forecastHourly(makeWeather());
  const len = h.validTimeLocal.length;
  assert.ok(len >= 24);
  for (const key of ['temperature', 'wxPhraseLong', 'iconCode', 'windDirectionCardinal', 'windSpeed']) {
    assert.strictEqual(h[key].length, len, `${key} length mismatch`);
  }
});

test('forecastHourly contains every hour the frontend scans for', () => {
  const { localParts } = require('../server/lib/units');
  const h = legacy.forecastHourly(makeWeather());
  const hours = new Set(
    h.validTimeUtc.map((t) => localParts(t, OFFSET).hour)
  );
  // calcHourlyReport() looks for these and runs off the array if any is absent.
  for (const target of [0, 6, 12, 15, 17, 20]) {
    assert.ok(hours.has(target), `hourly series is missing hour ${target}`);
  }
});

test('forecastDaily builds a flat 2N daypart array', () => {
  const d = legacy.forecastDaily(makeWeather(9));
  const dp = d.daypart[0];
  assert.strictEqual(dp.daypartName.length, d.dayOfWeek.length * 2);
  assert.strictEqual(dp.daypartName[0], 'Today');
  assert.strictEqual(dp.daypartName[1], 'Tonight');
  assert.strictEqual(dp.daypartName[2], 'Monday');
  assert.strictEqual(dp.daypartName[3], 'Monday Night');
});

test('forecastDaily nulls the whole first daypart after 3pm local', () => {
  const d = legacy.forecastDaily(makeWeather(16));
  const dp = d.daypart[0];
  assert.strictEqual(dp.daypartName[0], null,
    'weather.com dropped the day half once it had passed');
  // Every parallel array must null together; the frontend indexes them as one.
  for (const key of Object.keys(dp)) {
    assert.strictEqual(dp[key][0], null, `${key}[0] should be null alongside daypartName`);
  }
  assert.notStrictEqual(dp.daypartName[1], null, 'tonight must still be present');
});

test('forecastDaily keeps the first daypart in the morning', () => {
  const dp = legacy.forecastDaily(makeWeather(9)).daypart[0];
  assert.notStrictEqual(dp.daypartName[0], null);
});

test('forecastDaily exposes daypart temperature for the ticker', () => {
  const dp = legacy.forecastDaily(makeWeather(9)).daypart[0];
  assert.ok(Array.isArray(dp.temperature), 'ticker reads daypart[0].temperature');
  assert.strictEqual(typeof dp.temperature[0], 'number');
});

test('forecastDaily provides nullable qualifier and wind phrases', () => {
  const dp = legacy.forecastDaily(makeWeather(9)).daypart[0];
  assert.ok('qualifierPhrase' in dp && 'windPhrase' in dp,
    'the day-description slide dereferences both');
  assert.strictEqual(dp.qualifierPhrase.length, dp.daypartName.length);
});

test('day and night dayparts differ instead of repeating the daytime condition', () => {
  const dp = legacy.forecastDaily(makeWeather(9)).daypart[0];
  assert.notStrictEqual(dp.iconCode[0], dp.iconCode[1],
    'night should not reuse the day icon');
});

test('locationSearch includes the address column settings.js autocompletes on', () => {
  const out = legacy.locationSearch([
    { name: 'Charlottesville', lat: 38, lon: -78, state: 'VA', stateName: 'Virginia', country: 'US', countryName: 'United States' },
  ]);
  assert.deepStrictEqual(out.location.address, ['Charlottesville, VA']);
  assert.ok(Array.isArray(out.location.latitude));
});

test('locationNear reports real distances', () => {
  const out = legacy.locationNear([
    { name: 'Crozet', lat: 38.06, lon: -78.7, state: 'VA', distanceMi: 12.5 },
    { name: 'Staunton', lat: 38.14, lon: -79.07, state: 'VA', distanceMi: 33.5 },
  ]);
  assert.deepStrictEqual(out.location.distanceMi, [12.5, 33.5]);
});

test('locationPoint keeps locale fields free of state names', () => {
  const out = legacy.locationPoint({
    name: 'Charlottesville', lat: 38, lon: -78,
    state: 'VA', stateName: 'Virginia', admin2: '', city: 'Charlottesville',
  });
  assert.strictEqual(out.location.locale.locale4, null,
    'a state name here makes the surrounding-cities slide list the state itself');
});

test('alertsHeadlines wraps categories the way the bulletin filter expects', () => {
  const out = legacy.alertsHeadlines([
    {
      detailKey: 'x', messageType: 'Alert', messageTypeCode: 'W',
      phenomena: 'Tornado Warning', significance: 'W',
      eventDescription: 'Tornado Warning', headlineText: 'h', source: 'NWS',
      issueTimeLocal: '2026-08-23T00:00:00-04:00',
      expireTimeLocal: '2026-08-23T01:00:00-04:00',
      severityCode: 1, category: 'Met',
    },
  ]);
  assert.strictEqual(out.alerts[0].categories[0].category, 'Met');
  assert.strictEqual(out.alerts[0].eventDescription, 'Tornado Warning');
});

test('almanacDaily wraps every value in a one-element array', () => {
  const out = legacy.almanacDaily({
    date: { month: 8, day: 23 }, years: 30,
    averageHigh: 84, averageLow: 65,
    recordHigh: 97, recordHighYear: 2002,
    recordLow: 55, recordLowYear: 2024,
  });
  assert.deepStrictEqual(out.temperatureAverageMax, [84]);
  assert.deepStrictEqual(out.almanacRecordYearMax, [2002]);
});

test('globalAirQuality expiry is in seconds', () => {
  const out = legacy.globalAirQuality({
    aqi: 48, category: 'Good', categoryIndex: 1,
    primaryPollutant: 'Ozone', time: 1787457600,
  });
  const seconds = out.globalairquality.expireTimeGmt;
  // The slide multiplies by 1000; milliseconds here would land in the year 58000.
  assert.ok(seconds < 1e11, 'expireTimeGmt must be epoch seconds');
  assert.strictEqual(new Date(seconds * 1000).getUTCFullYear(), 2026);
});

test('pollenObservations reports no-report cleanly when unavailable', () => {
  const out = legacy.pollenObservations(null, makeWeather());
  assert.strictEqual(out.pollenobservations[0].stn_cmnt, 'No Report');
});

test('aggregate omits alerts entirely when there are none', () => {
  const w = makeWeather();
  const out = legacy.aggregate(
    ['v3-wx-observations-current', 'v3alertsHeadlines'],
    { weather: w, alerts: [] }
  );
  assert.strictEqual(out.v3alertsHeadlines, undefined,
    'the bulletin check is `!= undefined`, so an empty object would enable it');
  assert.ok(out['v3-wx-observations-current']);
});

test('icon codes stay inside the sprite range', () => {
  const w = makeWeather();
  const all = [
    legacy.observationsCurrent(w).iconCode,
    ...legacy.forecastHourly(w).iconCode,
    ...legacy.forecastDaily(w).daypart[0].iconCode.filter((c) => c !== null),
  ];
  for (const code of all) {
    assert.ok(Number.isInteger(code) && code >= 0 && code <= 47,
      `icon ${code} is outside the 0..47 sprite vocabulary`);
  }
});

test('tornado maps to icon 0 rather than falling through to not-available', () => {
  // A previous mapping used `table[id] || 44`, which turned code 0 into 44.
  assert.strictEqual(icons.fromOWM(781, '01d', 'tornado').iconCode, 0);
  assert.strictEqual(icons.fromWMO(0, true).iconCode, 32);
});
