'use strict';

const { config } = require('./config');
const { cache } = require('./lib/cache');
const { getJSON } = require('./lib/http');
const legacy = require('./legacy');
const providers = require('./providers');
const geocode = require('./services/geocode');
const places = require('./services/places');
const alertsService = require('./services/alerts');
const airports = require('./services/airports');
const almanacService = require('./services/almanac');
const radar = require('./services/radar');
const health = require('./services/health');

/**
 * Everything under /api. Two families live here:
 *
 *   /api/wx/...  the weather.com-compatible surface the untouched IntelliStar
 *                frontend talks to, path-for-path.
 *   /api/...     the modern endpoints (status, radar series, client config).
 */

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

/** "38.02,-78.47;39.1,-77.2;" -> [{lat,lon}, ...] */
function parseGeocodes(value) {
  if (!value) return [];
  return String(value)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [lat, lon] = pair.split(',').map((n) => parseFloat(n));
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    })
    .filter(Boolean);
}

function parseCodes(value) {
  if (!value) return [];
  return String(value).split(';').map((s) => s.trim()).filter(Boolean);
}

/** Weather + alerts + place for one point, everything the aggregator may need. */
async function contextFor(point, products) {
  const wants = new Set(products);
  const jobs = {};

  jobs.weather = providers.getWeather(point.lat, point.lon).catch((err) => {
    console.warn(`[api] weather ${point.lat},${point.lon}: ${err.message}`);
    return null;
  });

  if (wants.has('v3alertsHeadlines')) {
    jobs.weather.then(() => {}); // keep ordering simple; alerts fetch in parallel
    jobs.alerts = jobs.weather
      .then((w) => alertsService.forPoint(point.lat, point.lon, (w && w.alerts) || []))
      .catch(() => []);
  }
  if (wants.has('v3-location-point')) {
    jobs.place = geocode.reverse(point.lat, point.lon).catch(() => null);
  }
  if (wants.has('v3-wx-almanac-daily-1day')) {
    jobs.almanac = almanacService.forPoint(point.lat, point.lon).catch(() => null);
  }

  const [weather, alerts, place, almanac] = await Promise.all([
    jobs.weather, jobs.alerts || Promise.resolve([]),
    jobs.place || Promise.resolve(null), jobs.almanac || Promise.resolve(null),
  ]);

  return { weather, alerts, place, almanac };
}

async function handleAggcommon(res, productPath, query) {
  const products = productPath.split(';').filter(Boolean);

  // Airport variant: keyed by IATA code rather than coordinates.
  if (query.get('iataCodes')) {
    const codes = parseCodes(query.get('iataCodes'));
    const conditions = await airports.conditions(codes);

    const rows = codes.map((code) => {
      const obs = conditions.get(code);
      if (!obs) return null;
      const out = {};
      for (const product of products) {
        if (product === 'v3-wx-observations-current') {
          out[product] = {
            temperature: obs.temperature,
            temperatureDewPoint: obs.dewPoint,
            temperatureFeelsLike: obs.temperature,
            temperatureHeatIndex: obs.temperature,
            temperatureWindChill: obs.temperature,
            relativeHumidity: obs.humidity,
            pressureAltimeter: obs.pressure != null ? obs.pressure : 29.92,
            pressureTendencyCode: 0,
            windDirectionCardinal: obs.windSpeed === 0 ? 'CALM' : obs.windDir,
            windSpeed: obs.windSpeed,
            windGust: obs.windGust > obs.windSpeed ? obs.windGust : undefined,
            wxPhraseLong: obs.wxPhraseLong,
            iconCode: obs.iconCode,
            visibility: obs.visibility,
            cloudCeiling: obs.ceiling,
            uvIndex: 0,
            uvDescription: 'Low',
            validTimeUtc: obs.observedTime,
          };
        } else if (product === 'v3-location-point') {
          out[product] = {
            location: {
              latitude: obs.lat,
              longitude: obs.lon,
              displayName: obs.name,
              airportName: obs.name,
              iataCode: obs.iata,
              icaoCode: obs.icao,
            },
          };
        } else {
          out[product] = null;
        }
      }
      return out;
    });

    return json(res, 200, rows);
  }

  // Single-geocode variant (the almanac slide uses `geocode=`, not `geocodes=`).
  const single = query.get('geocode');
  if (single && !query.get('geocodes')) {
    const points = parseGeocodes(single);
    if (!points.length) return json(res, 400, { error: 'invalid geocode' });
    const ctx = await contextFor(points[0], products);
    if (!ctx.weather) return json(res, 200, null);
    return json(res, 200, legacy.aggregate(products, ctx));
  }

  const points = parseGeocodes(query.get('geocodes'));
  if (!points.length) return json(res, 400, { error: 'geocodes required' });

  const contexts = await Promise.all(points.map((p) => contextFor(p, products)));
  const rows = contexts.map((ctx) => (ctx.weather ? legacy.aggregate(products, ctx) : null));
  return json(res, 200, rows);
}

/** Legacy weather.com surface. `rest` is the path after /api/wx. */
async function handleLegacy(req, res, rest, query) {
  // --- location ---
  if (rest.startsWith('/v3/location/search')) {
    const q = query.get('query') || query.get('q') || '';
    const results = await geocode.search(q, 12);
    if (!results.length) return json(res, 404, { error: 'not found' });
    return json(res, 200, legacy.locationSearch(results));
  }

  if (rest.startsWith('/v3/location/point')) {
    const points = parseGeocodes(query.get('geocode'));
    if (!points.length) return json(res, 400, { error: 'geocode required' });
    const place = await geocode.reverse(points[0].lat, points[0].lon);
    return json(res, 200, legacy.locationPoint(place));
  }

  if (rest.startsWith('/v3/location/near')) {
    const points = parseGeocodes(query.get('geocode'));
    if (!points.length) return json(res, 400, { error: 'geocode required' });
    // The frontend discards candidates that collide with names already in its
    // lists, so hand it more than the eight the surrounding-cities slide needs.
    const near = await geocode.nearby(points[0].lat, points[0].lon, 24);
    return json(res, 200, legacy.locationNear(near));
  }

  // --- aggregated products ---
  if (rest.startsWith('/v3/aggcommon/')) {
    return handleAggcommon(res, rest.slice('/v3/aggcommon/'.length), query);
  }

  // --- alerts ---
  if (rest.startsWith('/v3/alerts/detail')) {
    const id = query.get('alertId');
    const detail = alertsService.getDetail(id);
    if (!detail) return json(res, 404, { error: 'unknown alert' });
    return json(res, 200, legacy.alertDetail(detail));
  }

  // --- standalone 5-day (health slide) ---
  if (rest.startsWith('/v3/wx/forecast/daily/5day')) {
    const points = parseGeocodes(query.get('geocode'));
    if (!points.length) return json(res, 400, { error: 'geocode required' });
    const weather = await providers.getWeather(points[0].lat, points[0].lon);
    return json(res, 200, legacy.forecastDaily(weather));
  }

  // --- air quality ---
  if (rest.startsWith('/v3/wx/globalAirQuality')) {
    const points = parseGeocodes(query.get('geocode'));
    if (!points.length) return json(res, 400, { error: 'geocode required' });
    const aq = await providers.getAirQuality(points[0].lat, points[0].lon);
    const payload = legacy.globalAirQuality(aq);
    if (!payload) return json(res, 404, { error: 'air quality unavailable' });
    return json(res, 200, payload);
  }

  // --- pollen ---
  const pollenMatch = rest.match(/^\/v1\/geocode\/([-\d.]+)\/([-\d.]+)\/observations\/pollen\.json/);
  if (pollenMatch) {
    const lat = parseFloat(pollenMatch[1]);
    const lon = parseFloat(pollenMatch[2]);
    const [weather, aq] = await Promise.all([
      providers.getWeather(lat, lon).catch(() => null),
      providers.getAirQuality(lat, lon).catch(() => null),
    ]);
    const p = await health.pollen(lat, lon, aq);
    return json(res, 200, legacy.pollenObservations(p, weather));
  }

  // --- derived health indices ---
  if (rest.startsWith('/v2/indices/achePain/')) {
    const points = parseGeocodes(query.get('geocode'));
    if (!points.length) return json(res, 400, { error: 'geocode required' });
    if (!config.features.healthIndices) return json(res, 404, { error: 'disabled' });
    const weather = await providers.getWeather(points[0].lat, points[0].lon);
    return json(res, 200, legacy.achePainIndex(health.achesIndex(weather), weather));
  }

  if (rest.startsWith('/v2/indices/breathing/')) {
    const points = parseGeocodes(query.get('geocode'));
    if (!points.length) return json(res, 400, { error: 'geocode required' });
    if (!config.features.healthIndices) return json(res, 404, { error: 'disabled' });
    const [weather, aq] = await Promise.all([
      providers.getWeather(points[0].lat, points[0].lon),
      providers.getAirQuality(points[0].lat, points[0].lon).catch(() => null),
    ]);
    const pollenData = await health.pollen(points[0].lat, points[0].lon, aq).catch(() => null);
    return json(res, 200, legacy.breathingIndexPayload(
      health.breathingIndex(weather, aq, pollenData), weather
    ));
  }

  // --- UV ---
  if (rest.startsWith('/v2/indices/uv/current')) {
    const points = parseGeocodes(query.get('geocode'));
    if (!points.length) return json(res, 400, { error: 'geocode required' });
    const weather = await providers.getWeather(points[0].lat, points[0].lon);
    return json(res, 200, legacy.uvCurrent(health.uvIndex(weather)));
  }

  if (rest.startsWith('/v2/indices/uv/hourly')) {
    const points = parseGeocodes(query.get('geocode'));
    if (!points.length) return json(res, 400, { error: 'geocode required' });
    const weather = await providers.getWeather(points[0].lat, points[0].lon);
    return json(res, 200, legacy.uvHourly(health.uvIndex(weather), weather));
  }

  return json(res, 404, { error: `unmapped legacy endpoint: ${rest}` });
}

/** Modern endpoints. `rest` is the path after /api. */
async function handleModern(req, res, rest, query) {
  if (rest === '/healthz') {
    return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }

  if (rest === '/status') {
    const status = {
      ok: true,
      provider: config.provider,
      fallbackProvider: config.fallbackProvider,
      features: config.features,
      cache: cache.stats(),
      places: places.stats(),
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
    };

    if (config.provider === 'home-assistant') {
      status.homeAssistant = await providers.homeAssistant
        .ping(config.homeAssistant)
        .then((r) => ({
          connected: true,
          version: r.instance.version,
          locationName: r.instance.locationName,
          timeZone: r.instance.timeZone,
          home: { lat: r.instance.lat, lon: r.instance.lon },
          entities: r.entities,
          configuredEntity: config.homeAssistant.weatherEntity || '(auto)',
          matchRadiusKm: config.homeAssistant.matchRadiusKm,
        }))
        .catch((err) => ({ connected: false, error: err.message }));
    }
    return json(res, 200, status);
  }

  /**
   * Runtime configuration for the browser. Deliberately excludes every secret
   * except the Mapbox token, which is a public-scope token that has to reach
   * the client for tiles to load at all.
   */
  if (rest === '/config') {
    return json(res, 200, {
      mapboxKey: config.mapboxKey,
      mapbox: config.mapbox,
      features: config.features,
      provider: config.provider,
      radarUpdateIntervalMs: config.cache.radarMs,
      weatherRefreshMs: config.cache.weatherMs,
    });
  }

  if (rest === '/radar/series') {
    return json(res, 200, await radar.series());
  }

  if (rest === '/airport-delays') {
    return json(res, 200, await airports.delays());
  }

  /**
   * Raw FAA NAS status passthrough. The frontend already knows how to read this
   * shape; all it ever needed was a path that is not blocked by CORS.
   */
  if (rest === '/faa/airport-events') {
    const events = await cache
      .wrap('faa:raw', config.cache.airportMs, () =>
        getJSON('https://nasstatus.faa.gov/api/airport-events', { timeoutMs: 15000 })
      )
      .catch(() => []);
    return json(res, 200, Array.isArray(events) ? events : []);
  }

  if (rest === '/moon') {
    return json(res, 200, { phases: almanacService.moonPhases() });
  }

  if (rest === '/almanac') {
    const lat = parseFloat(query.get('lat'));
    const lon = parseFloat(query.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json(res, 400, { error: 'lat and lon required' });
    }
    return json(res, 200, await almanacService.forPoint(lat, lon));
  }

  /**
   * Server-side IP geolocation. The page used to call ip-api.com over plain
   * HTTP from the browser, which is both a mixed-content failure under HTTPS
   * and a per-viewer rate-limit problem. Doing it here fixes both.
   */
  if (rest === '/ip-location') {
    const result = await cache.wrap('ip-location', 3600000, async () => {
      const d = await getJSON('http://ip-api.com/json/?fields=status,country,regionName,region,city,lat,lon,timezone');
      if (d.status !== 'success') throw new Error('ip lookup failed');
      // Field names mirror ip-api's so the frontend needs no change.
      return {
        status: 'success',
        city: d.city, region: d.region, regionName: d.regionName,
        state: d.region, stateName: d.regionName,
        country: d.country, lat: d.lat, lon: d.lon, timezone: d.timezone,
      };
    }).catch(() => null);

    if (!result) return json(res, 503, { error: 'ip geolocation unavailable' });
    return json(res, 200, result);
  }

  /** Largest cities in a state, for the conditions ticker. */
  if (rest === '/cities') {
    const state = query.get('state');
    const limit = Math.min(parseInt(query.get('limit'), 10) || 10, 25);
    if (!state) return json(res, 400, { error: 'state required' });
    return json(res, 200, { cities: await geocode.citiesInState(state, limit) });
  }

  /** Normalized weather, for anyone building on top of this rather than the shim. */
  if (rest === '/weather') {
    const lat = parseFloat(query.get('lat'));
    const lon = parseFloat(query.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json(res, 400, { error: 'lat and lon required' });
    }
    const [weather, aq] = await Promise.all([
      providers.getWeather(lat, lon),
      providers.getAirQuality(lat, lon).catch(() => null),
    ]);
    const alerts = await alertsService.forPoint(lat, lon, weather.alerts || []);
    return json(res, 200, { ...weather, airQuality: aq, alerts });
  }

  if (rest === '/cache/clear' && req.method === 'POST') {
    cache.clear();
    providers.resetHomeAssistantCache();
    return json(res, 200, { cleared: true });
  }

  return json(res, 404, { error: `unknown endpoint: ${rest}` });
}

async function route(req, res, pathname, query) {
  if (pathname.startsWith('/api/wx')) {
    return handleLegacy(req, res, pathname.slice('/api/wx'.length), query);
  }
  if (pathname.startsWith('/api')) {
    return handleModern(req, res, pathname.slice('/api'.length), query);
  }
  return false;
}

module.exports = { route, json, parseGeocodes };
