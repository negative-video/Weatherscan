'use strict';

const { getJSON, USER_AGENT } = require('../lib/http');
const icons = require('../lib/icons');
const U = require('../lib/units');
const { buildDayparts } = require('../lib/dayparts');
const { sunTimes } = require('../lib/astro');

/**
 * Reads weather straight out of a running Home Assistant instance.
 *
 * The point is that if someone already has OpenWeatherMap, AccuWeather, Met.no,
 * a Tempest, or an Ecowitt station feeding HA, that data is better than
 * anything this app would fetch independently: it is their actual local
 * observation, already paid for, already rate-limited correctly.
 *
 * HA only knows about one location, so the dispatcher uses this provider for
 * coordinates near the HA home and falls back elsewhere.
 */

async function haFetch(cfg, path, init = {}) {
  const url = `${cfg.url}/api${path}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  };

  if (init.method === 'POST') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: init.body,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Home Assistant ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  return getJSON(url, { headers, retries: 1 });
}

/** Instance coordinates, timezone and unit system. */
async function getInstanceConfig(cfg) {
  const c = await haFetch(cfg, '/config');
  return {
    lat: c.latitude,
    lon: c.longitude,
    timeZone: c.time_zone || 'UTC',
    unitSystem: (c.unit_system && c.unit_system.temperature) === '°F' ? 'imperial' : 'metric',
    version: c.version,
    locationName: c.location_name,
  };
}

/** Pick a weather entity when the operator has not named one. */
async function discoverWeatherEntity(cfg) {
  const states = await haFetch(cfg, '/states');
  const weather = states.filter((s) => s.entity_id.startsWith('weather.'));
  if (!weather.length) {
    throw new Error('No weather.* entity found in Home Assistant');
  }
  // Prefer an entity that looks like the primary home forecast.
  const preferred =
    weather.find((s) => /home|forecast_home/.test(s.entity_id)) ||
    weather.find((s) => s.state !== 'unavailable' && s.state !== 'unknown') ||
    weather[0];
  return preferred.entity_id;
}

async function listWeatherEntities(cfg) {
  const states = await haFetch(cfg, '/states');
  return states
    .filter((s) => s.entity_id.startsWith('weather.'))
    .map((s) => ({
      entityId: s.entity_id,
      name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
      state: s.state,
      supportsForecast: !!(s.attributes && s.attributes.supported_features),
    }));
}

/**
 * Forecasts moved out of entity attributes into a service call in HA 2024.4.
 * Older cores still expose an inline `forecast` attribute, so try both.
 */
async function getForecast(cfg, entityId, type) {
  try {
    const res = await haFetch(cfg, '/services/weather/get_forecasts?return_response=true', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, type }),
    });
    const payload = res && (res.service_response || res);
    const bucket = payload && payload[entityId];
    if (bucket && Array.isArray(bucket.forecast)) return bucket.forecast;
  } catch (err) {
    console.warn(`[home-assistant] ${type} forecast unavailable: ${err.message}`);
  }
  return [];
}

// --- unit coercion -------------------------------------------------------
// HA reports values in whatever the instance is configured for and tells us
// which unit it used. Never assume.

function toF(value, unit) {
  if (value == null) return null;
  if (!unit || unit.includes('F')) return Math.round(value);
  return U.cToF(value);
}

function toMph(value, unit) {
  if (value == null) return null;
  const u = (unit || 'km/h').toLowerCase();
  if (u.includes('mph') || u.includes('mi/h')) return Math.round(value);
  if (u.includes('m/s')) return U.msToMph(value);
  if (u.includes('kn')) return Math.round(value * 1.15078);
  return U.kmhToMph(value);
}

function toInHg(value, unit) {
  if (value == null) return null;
  const u = (unit || 'hPa').toLowerCase();
  if (u.includes('inhg')) return +value.toFixed(2);
  if (u.includes('mmhg')) return +(value * 0.0393701).toFixed(2);
  return U.mbToInHg(value); // hPa / mbar
}

function toMiles(value, unit) {
  if (value == null) return null;
  const u = (unit || 'km').toLowerCase();
  if (u.includes('mi')) return +value.toFixed(1);
  if (u === 'm') return U.mToMiles(value);
  return +(value * 0.621371).toFixed(1); // km
}

/** Wind bearing may be degrees or a cardinal string depending on integration. */
function bearingToDegrees(bearing) {
  if (bearing == null) return null;
  if (typeof bearing === 'number') return bearing;
  const table = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  const key = String(bearing).toUpperCase().trim();
  return table[key] != null ? table[key] : null;
}

async function fetchWeather(lat, lon, opts = {}) {
  const cfg = opts.homeAssistant;
  if (!cfg || !cfg.url || !cfg.token) {
    throw new Error('Home Assistant URL and token are required');
  }

  const instance = opts.instance || (await getInstanceConfig(cfg));
  const entityId = cfg.weatherEntity || opts.entityId || (await discoverWeatherEntity(cfg));

  const [state, hourlyRaw, dailyRaw] = await Promise.all([
    haFetch(cfg, `/states/${entityId}`),
    getForecast(cfg, entityId, 'hourly'),
    getForecast(cfg, entityId, 'daily'),
  ]);

  if (!state || state.state === 'unavailable' || state.state === 'unknown') {
    throw new Error(`Home Assistant entity ${entityId} is ${state ? state.state : 'missing'}`);
  }

  const a = state.attributes || {};
  const off = U.offsetForTimeZone(instance.timeZone);
  const now = Math.floor(Date.now() / 1000);

  const tempUnit = a.temperature_unit;
  const windUnit = a.wind_speed_unit;
  const pressUnit = a.pressure_unit;
  const visUnit = a.visibility_unit;

  const temperature = toF(a.temperature, tempUnit);
  const humidity = U.round(a.humidity);
  const windSpeed = toMph(a.wind_speed, windUnit);
  const windDeg = bearingToDegrees(a.wind_bearing);

  const sun = sunTimes(new Date(), instance.lat != null ? instance.lat : lat,
    instance.lon != null ? instance.lon : lon);

  const isDay = state.state !== 'clear-night' && now >= (sun.sunrise || 0) && now <= (sun.sunset || Infinity);

  const hourly = hourlyRaw.map((f) => {
    const time = Math.floor(new Date(f.datetime).getTime() / 1000);
    const hourIsDay =
      f.is_daytime != null ? f.is_daytime : isDaylightAt(time, sun, off);
    const t = toF(f.temperature, tempUnit);
    return {
      time,
      temperature: t,
      feelsLike: toF(f.apparent_temperature, tempUnit) ?? t,
      dewPoint: toF(f.dew_point, tempUnit) ?? U.dewPointF(t, f.humidity),
      condition: icons.fromHomeAssistant(f.condition, hourIsDay),
      precipChance: U.round(f.precipitation_probability) ?? 0,
      humidity: U.round(f.humidity),
      windDeg: bearingToDegrees(f.wind_bearing),
      windSpeed: toMph(f.wind_speed, windUnit),
      windGust: toMph(f.wind_gust_speed != null ? f.wind_gust_speed : f.wind_speed, windUnit),
      uvIndex: f.uv_index != null ? f.uv_index : null,
      cloudCover: U.round(f.cloud_coverage),
      visibility: null,
      isDay: hourIsDay,
    };
  });

  const daily = dailyRaw.map((f) => {
    const time = Math.floor(new Date(f.datetime).getTime() / 1000);
    return {
      time,
      dayOfWeek: U.dayOfWeek(time, off),
      tempMax: toF(f.temperature, tempUnit),
      tempMin: toF(f.templow, tempUnit),
      condition: icons.fromHomeAssistant(f.condition, true),
      conditionNight: icons.fromHomeAssistant(f.condition, false),
      precipChance: U.round(f.precipitation_probability) ?? 0,
      humidity: U.round(f.humidity),
      windSpeed: toMph(f.wind_speed, windUnit),
      windDeg: bearingToDegrees(f.wind_bearing),
      uvIndex: f.uv_index != null ? f.uv_index : null,
      sunrise: null,
      sunset: null,
    };
  });

  // Fill sunrise/sunset locally; HA's weather entities do not carry them.
  for (const d of daily) {
    const s = sunTimes(new Date(d.time * 1000), instance.lat != null ? instance.lat : lat,
      instance.lon != null ? instance.lon : lon);
    d.sunrise = s.sunrise;
    d.sunset = s.sunset;
  }

  return {
    source: `home-assistant:${entityId}`,
    entityId,
    lat: instance.lat != null ? instance.lat : lat,
    lon: instance.lon != null ? instance.lon : lon,
    timezone: instance.timeZone,
    utcOffsetSeconds: off,
    current: {
      time: now,
      temperature,
      feelsLike: toF(a.apparent_temperature, tempUnit) ?? temperature,
      condition: icons.fromHomeAssistant(state.state, isDay),
      humidity,
      dewPoint: toF(a.dew_point, tempUnit) ?? U.dewPointF(temperature, humidity),
      pressure: toInHg(a.pressure, pressUnit),
      windDeg,
      windDir: U.degToCardinal(windDeg),
      windSpeed,
      windGust: toMph(a.wind_gust_speed, windUnit) ?? windSpeed,
      visibility: toMiles(a.visibility, visUnit),
      uvIndex: a.uv_index != null ? a.uv_index : 0,
      cloudCover: U.round(a.cloud_coverage),
      ceiling: null,
      heatIndex: U.heatIndex(temperature, humidity),
      windChill: U.windChill(temperature, windSpeed),
      isDay,
      sunrise: sun.sunrise,
      sunset: sun.sunset,
    },
    hourly,
    daily,
    dayparts: buildDayparts(hourly, daily, off, now),
    // Signals to the dispatcher that a fallback should supply these sections.
    incomplete: {
      hourly: hourly.length < 12,
      daily: daily.length < 4,
    },
  };
}

function isDaylightAt(epoch, sun, off) {
  if (!sun.sunrise || !sun.sunset) return true;
  const dayOffset = Math.floor((epoch - sun.sunrise) / 86400) * 86400;
  return epoch >= sun.sunrise + dayOffset && epoch <= sun.sunset + dayOffset;
}

/** Optional: pull AQI / UV / pollen from user-nominated sensor entities. */
async function fetchSensors(cfg) {
  const out = { aqi: null, uv: null, pollen: null };
  const read = async (entityId) => {
    if (!entityId) return null;
    try {
      const s = await haFetch(cfg, `/states/${entityId}`);
      const value = parseFloat(s.state);
      return Number.isFinite(value) ? { value, attributes: s.attributes || {} } : null;
    } catch {
      return null;
    }
  };
  const [aqi, uv, pollen] = await Promise.all([
    read(cfg.aqiEntity), read(cfg.uvEntity), read(cfg.pollenEntity),
  ]);
  out.aqi = aqi;
  out.uv = uv;
  out.pollen = pollen;
  return out;
}

/** Connectivity probe used by /api/status and at startup. */
async function ping(cfg) {
  const instance = await getInstanceConfig(cfg);
  const entities = await listWeatherEntities(cfg);
  return { ok: true, instance, entities };
}

module.exports = {
  fetchWeather, fetchSensors, ping, getInstanceConfig,
  discoverWeatherEntity, listWeatherEntities,
};
