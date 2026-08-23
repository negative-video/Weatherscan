'use strict';

const test = require('node:test');
const assert = require('node:assert');

/**
 * End-to-end checks against a real server on an ephemeral port.
 *
 * These hit live upstream APIs, so they need network access. Set
 * SKIP_NETWORK_TESTS=1 to skip them in an offline environment.
 */

const SKIP = process.env.SKIP_NETWORK_TESTS === '1';
const LAT = 38.0293;
const LON = -78.4767;

let server;
let base;

test.before(async () => {
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  server = require('../server/index.js');
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
});

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('healthz responds', async () => {
  const { status, body } = await get('/api/healthz');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
});

test('config exposes the mapbox key but no secrets', async () => {
  const { status, body } = await get('/api/config');
  assert.strictEqual(status, 200);
  assert.ok('mapboxKey' in body);
  const serialized = JSON.stringify(body);
  for (const secret of ['HA_TOKEN', 'openWeatherKey', 'ambeeKey', 'token']) {
    assert.ok(!serialized.includes(secret), `config leaked ${secret}`);
  }
});

test('static index is served', async () => {
  const res = await fetch(base + '/');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /weatherscan-api\.js/);
});

test('directory traversal is rejected', async () => {
  for (const path of ['/../package.json', '/js/../../package.json', '/%2e%2e/package.json']) {
    const res = await fetch(base + path);
    assert.ok(res.status === 403 || res.status === 404,
      `${path} returned ${res.status}, expected 403/404`);
  }
});

test('unknown api endpoint 404s as JSON', async () => {
  const { status, body } = await get('/api/nope');
  assert.strictEqual(status, 404);
  assert.ok(body.error);
});

test('aggcommon rejects a missing geocode', async () => {
  const { status } = await get('/api/wx/v3/aggcommon/v3-wx-observations-current');
  assert.strictEqual(status, 400);
});

test('places index answers spatial queries offline', async () => {
  const places = require('../server/services/places');
  const near = places.nearby(LAT, LON, { limit: 8 });
  assert.ok(near.length >= 5, `expected surrounding towns, got ${near.length}`);
  assert.ok(near.every((c) => c.distanceMi <= 60));
  // Sorted by the distance/population blend, so the first is the best pick.
  assert.ok(near[0].name.length > 0);

  const va = places.inState('Virginia', 5);
  assert.strictEqual(va[0].name, 'Virginia Beach', 'state list should be population-ordered');

  assert.strictEqual(places.nearest(LAT, LON).name, 'Charlottesville',
    'reverse lookup must include the city at distance zero');
});

test('moon phases are computed locally', { skip: false }, async () => {
  const { status, body } = await get('/api/moon');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.phases.length, 4);
  const names = body.phases.map((p) => p.name);
  assert.ok(names.every((n) => ['NEW', 'FIRST', 'FULL', 'LAST'].includes(n)));
  // Phases must be in the future and chronological.
  const times = body.phases.map((p) => new Date(p.date).getTime());
  assert.ok(times[0] > Date.now());
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
});

test('weather endpoint returns a full normalized bundle', { skip: SKIP }, async () => {
  const { status, body } = await get(`/api/weather?lat=${LAT}&lon=${LON}`);
  assert.strictEqual(status, 200);
  assert.ok(body.current.temperature != null);
  assert.ok(body.hourly.length > 24);
  assert.ok(body.daily.length >= 5);
  assert.ok(body.dayparts.length >= 5);
  assert.strictEqual(typeof body.utcOffsetSeconds, 'number');
});

test('legacy aggcommon returns one row per geocode', { skip: SKIP }, async () => {
  const { status, body } = await get(
    '/api/wx/v3/aggcommon/v3-wx-observations-current;v3-wx-forecast-daily-5day' +
    `?geocodes=${LAT},${LON};39.1,-77.2;`
  );
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
  assert.strictEqual(body.length, 2);
  for (const row of body) {
    assert.ok(row['v3-wx-observations-current'].temperature != null);
    assert.ok(row['v3-wx-forecast-daily-5day'].daypart[0].daypartName.length >= 10);
  }
});

test('location search resolves a city and a ZIP', { skip: SKIP }, async () => {
  const city = await get('/api/wx/v3/location/search?query=Charlottesville');
  assert.strictEqual(city.status, 200);
  assert.strictEqual(city.body.location.displayName[0], 'Charlottesville');

  const zip = await get('/api/wx/v3/location/search?query=90210');
  assert.strictEqual(zip.status, 200);
  assert.strictEqual(zip.body.location.displayName[0], 'Beverly Hills');
});

test('nearby returns distinct towns, not repeats of one point', { skip: SKIP }, async () => {
  const { body } = await get(`/api/wx/v3/location/near?geocode=${LAT},${LON}`);
  const names = body.location.displayName;
  assert.ok(names.length >= 8);
  assert.strictEqual(new Set(names).size, names.length, 'nearby list contains duplicates');
  // Distances must be real, not an index-derived placeholder.
  assert.ok(body.location.distanceMi.some((d) => d % 5 !== 0));
});

test('radar series hands back usable tile templates', { skip: SKIP }, async () => {
  const { status, body } = await get('/api/radar/series');
  assert.strictEqual(status, 200);
  assert.strictEqual(typeof body.radar.available, 'boolean');
  assert.ok(Array.isArray(body.radar.frames));

  // An empty frame list is a legitimate upstream state, not a bug — RainViewer
  // returns one during ingest gaps, and its satellite feed does so routinely.
  // Assert the contract of a frame when there is one rather than that the
  // network happened to be healthy during the test run.
  if (!body.radar.frames.length) {
    assert.strictEqual(body.radar.available, false,
      'available must be false when there are no frames');
    return;
  }

  assert.strictEqual(body.radar.available, true);
  for (const frame of body.radar.frames) {
    assert.ok(Number.isFinite(frame.ts), 'frame timestamp');
    // Frames must use the API's own path, not a reconstructed timestamp URL.
    assert.match(frame.url, /\/v2\/radar\/[0-9a-f]+\//);
    assert.ok(
      frame.url.includes('{z}') && frame.url.includes('{x}') && frame.url.includes('{y}'),
      `frame url is not a tile template: ${frame.url}`
    );
  }
});

test('airport conditions come back for real IATA codes', { skip: SKIP }, async () => {
  const { status, body } = await get(
    '/api/wx/v3/aggcommon/v3-location-point;v3-wx-observations-current?iataCodes=MIA;ORD;'
  );
  assert.strictEqual(status, 200);
  assert.strictEqual(body.length, 2);
  for (const row of body) {
    assert.ok(row, 'airport row was null');
    assert.ok(row['v3-location-point'].location.airportName);
    assert.ok(Number.isFinite(row['v3-wx-observations-current'].temperature));
  }
});

test('almanac produces 30-year normals with record years', { skip: SKIP }, async () => {
  const { status, body } = await get(`/api/almanac?lat=${LAT}&lon=${LON}`);
  assert.strictEqual(status, 200);
  assert.ok(body.averageHigh > body.averageLow);
  assert.ok(body.recordHigh >= body.averageHigh);
  assert.ok(body.recordLow <= body.averageLow);
  assert.ok(body.recordHighYear >= 1990 && body.recordHighYear <= new Date().getFullYear());
  assert.ok(body.years >= 25);
});

test('the whole legacy surface answers without a 404', { skip: SKIP }, async () => {
  const geocode = `${LAT},${LON}`;
  const paths = [
    `/api/wx/v3/location/point?geocode=${geocode}`,
    `/api/wx/v3/wx/forecast/daily/5day?geocode=${geocode}`,
    `/api/wx/v3/wx/globalAirQuality?geocode=${geocode}`,
    `/api/wx/v1/geocode/${LAT}/${LON}/observations/pollen.json`,
    `/api/wx/v2/indices/achePain/daypart/3day?geocode=${geocode}`,
    `/api/wx/v2/indices/breathing/daypart/3day?geocode=${geocode}`,
    `/api/wx/v2/indices/uv/current?geocode=${geocode}`,
    `/api/wx/v2/indices/uv/hourly/48hour?geocode=${geocode}`,
    `/api/wx/v3/aggcommon/v3-wx-almanac-daily-1day;v3-wx-observations-current?geocode=${geocode}`,
  ];
  for (const path of paths) {
    const { status } = await get(path);
    assert.strictEqual(status, 200, `${path} returned ${status}`);
  }
});

test('uv hourly is long enough for the slide to scan', { skip: SKIP }, async () => {
  const { body } = await get(`/api/wx/v2/indices/uv/hourly/48hour?geocode=${LAT},${LON}`);
  const uv = body.uvIndex1hour;
  assert.ok(uv.fcstValidLocal.length >= 24,
    'a short series makes the frontend scan run past the end of the array');
  assert.strictEqual(uv.uvIndex.length, uv.fcstValidLocal.length);
});
