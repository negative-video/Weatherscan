'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * Reads .env if present, then lets real environment variables win. Docker
 * passes everything through env_file, so .env is a local-development nicety
 * rather than the primary path.
 */
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const file = loadDotEnv();
const env = (key, fallback = '') => {
  const v = process.env[key] !== undefined ? process.env[key] : file[key];
  return v === undefined || v === '' ? fallback : String(v).trim();
};
const bool = (key, fallback) => {
  const v = env(key, '').toLowerCase();
  if (v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
};
const num = (key, fallback) => {
  const v = parseFloat(env(key, ''));
  return Number.isFinite(v) ? v : fallback;
};

const provider = env('WEATHER_PROVIDER', 'open-meteo').toLowerCase();

const config = {
  root: ROOT,
  webroot: path.join(ROOT, 'webroot'),

  port: num('PORT', num('HTTP_PORT', 8080)),
  host: env('HOST', '0.0.0.0'),
  nodeEnv: env('NODE_ENV', 'production'),
  logRequests: bool('LOG_REQUESTS', false),

  /** open-meteo | openweathermap | home-assistant */
  provider,
  /** Used for any location home-assistant cannot answer for. */
  fallbackProvider: env('FALLBACK_PROVIDER', 'open-meteo').toLowerCase(),

  openWeatherKey: env('OPENWEATHER_API_KEY', env('OPENWEATHERMAP_API_KEY', '')),
  mapboxKey: env('MAPBOX_API_KEY', env('MAPBOX_TOKEN', '')),

  mapbox: {
    // Style IDs are overridable so a deployment is not hostage to the
    // upstream author's Mapbox account remaining public.
    radarStyle: env('MAPBOX_STYLE_RADAR', 'mapbox://styles/goldbblazez/cl10wz58y000q14ptdm3vkmxe'),
    satelliteStyle: env('MAPBOX_STYLE_SATELLITE', 'mapbox://styles/goldbblazez/cl188bbm3000f14rmh9mcqbp8'),
    miniStyle: env('MAPBOX_STYLE_MINIMAP', 'mapbox://styles/goldbblazez/cl11ctjbl000014s02fijkmyc'),
    baseStyleUser: env('MAPBOX_BASE_STYLE_USER', 'goldbblazez'),
    baseStyleId: env('MAPBOX_BASE_STYLE_ID', 'cl6jfozbb001h15sdx9ze69f7'),
  },

  homeAssistant: {
    url: env('HA_URL', '').replace(/\/+$/, ''),
    token: env('HA_TOKEN', ''),
    weatherEntity: env('HA_WEATHER_ENTITY', ''),
    // Optional overrides when a user has richer sensors than the weather entity.
    aqiEntity: env('HA_AQI_ENTITY', ''),
    uvEntity: env('HA_UV_ENTITY', ''),
    pollenEntity: env('HA_POLLEN_ENTITY', ''),
    // A request within this radius of the HA home coordinates is served by HA.
    matchRadiusKm: num('HA_MATCH_RADIUS_KM', 40),
    // Blank means "use the coordinates HA reports for itself".
    lat: env('HA_LATITUDE', '') === '' ? null : num('HA_LATITUDE', 0),
    lon: env('HA_LONGITUDE', '') === '' ? null : num('HA_LONGITUDE', 0),
    verifyTls: bool('HA_VERIFY_TLS', true),
  },

  pollen: {
    // ambee | google | open-meteo | none  (open-meteo is Europe-only upstream)
    provider: env('POLLEN_PROVIDER', 'auto').toLowerCase(),
    ambeeKey: env('AMBEE_API_KEY', ''),
    googleKey: env('GOOGLE_POLLEN_API_KEY', ''),
  },

  features: {
    radar: bool('ENABLE_RADAR', true),
    satellite: bool('ENABLE_SATELLITE', true),
    pollen: bool('ENABLE_POLLEN', true),
    healthIndices: bool('ENABLE_HEALTH_INDICES', true),
    airports: bool('ENABLE_AIRPORTS', true),
    alerts: bool('ENABLE_ALERTS', true),
    almanac: bool('ENABLE_ALMANAC', true),
  },

  cache: {
    weatherMs: num('CACHE_TTL_MINUTES', 10) * 60000,
    radarMs: num('RADAR_UPDATE_INTERVAL', 5) * 60000,
    alertsMs: num('ALERTS_TTL_MINUTES', 2) * 60000,
    geocodeMs: num('GEOCODE_TTL_HOURS', 168) * 3600000,
    almanacMs: num('ALMANAC_TTL_HOURS', 24) * 3600000,
    airportMs: num('AIRPORT_TTL_MINUTES', 10) * 60000,
  },

  units: env('UNITS', 'imperial').toLowerCase(),
};

/** Human-readable startup report; also drives /api/status. */
function describe() {
  const lines = [];
  const problems = [];

  lines.push(`provider        ${config.provider}`);
  if (config.provider === 'home-assistant') {
    lines.push(`  ha url        ${config.homeAssistant.url || '(not set)'}`);
    lines.push(`  ha entity     ${config.homeAssistant.weatherEntity || '(auto-detect)'}`);
    lines.push(`  fallback      ${config.fallbackProvider}`);
    if (!config.homeAssistant.url) problems.push('HA_URL is required when WEATHER_PROVIDER=home-assistant');
    if (!config.homeAssistant.token) problems.push('HA_TOKEN is required when WEATHER_PROVIDER=home-assistant');
  }
  if (config.provider === 'openweathermap' && !config.openWeatherKey) {
    problems.push('OPENWEATHER_API_KEY is required when WEATHER_PROVIDER=openweathermap');
  }
  lines.push(`map tiles       ${config.mapboxKey ? 'mapbox key set' : 'NO MAPBOX KEY — maps will not render'}`);
  if (!config.mapboxKey) problems.push('MAPBOX_API_KEY is not set; radar and minimap surfaces will be blank');
  lines.push(`radar           ${config.features.radar ? 'RainViewer' : 'disabled'}`);
  lines.push(`satellite       ${config.features.satellite ? 'NASA GIBS (GOES)' : 'disabled'}`);
  lines.push(`alerts          ${config.features.alerts ? 'NWS api.weather.gov' : 'disabled'}`);
  lines.push(`airports        ${config.features.airports ? 'aviationweather.gov + FAA NAS status' : 'disabled'}`);
  lines.push(`weather cache   ${config.cache.weatherMs / 60000} min`);

  return { lines, problems };
}

module.exports = { config, describe };
