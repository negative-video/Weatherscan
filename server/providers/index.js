'use strict';

const { config } = require('../config');
const { cache } = require('../lib/cache');
const { distanceMi } = require('../lib/units');
const { buildDayparts } = require('../lib/dayparts');

const openMeteo = require('./open-meteo');
const openWeather = require('./openweathermap');
const homeAssistant = require('./home-assistant');

/**
 * Upstream concurrency cap.
 *
 * A page load asks for every location at once — main city, surrounding towns,
 * the eight-city panel, ticker cities, travel and international lists — which
 * is roughly two dozen simultaneous requests. Free weather APIs answer that
 * burst with 429s. Caching absorbs it on subsequent loads, but the first load
 * after a cold start still fires everything together, so hold the number of
 * in-flight upstream fetches down and let the rest queue.
 */
const MAX_UPSTREAM_CONCURRENCY = 6;
let active = 0;
const waiting = [];

function withLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      fn().then(resolve, reject).finally(() => {
        active--;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (active < MAX_UPSTREAM_CONCURRENCY) run();
    else waiting.push(run);
  });
}

// Cached across calls so we do not re-read /api/config on every request.
let haInstancePromise = null;
let haWarned = false;

function resetHomeAssistantCache() {
  haInstancePromise = null;
}

async function haInstance() {
  if (!haInstancePromise) {
    haInstancePromise = homeAssistant.getInstanceConfig(config.homeAssistant).catch((err) => {
      haInstancePromise = null; // let the next request retry
      throw err;
    });
  }
  return haInstancePromise;
}

/** Where Home Assistant thinks "home" is, honouring any manual override. */
async function haHomeCoords() {
  const cfg = config.homeAssistant;
  if (cfg.lat != null && cfg.lon != null) return { lat: cfg.lat, lon: cfg.lon };
  const instance = await haInstance();
  return { lat: instance.lat, lon: instance.lon };
}

/**
 * Home Assistant only models a single location. Anything outside the configured
 * radius (nearby cities, travel, international) has to come from somewhere else.
 */
async function shouldUseHomeAssistant(lat, lon) {
  if (config.provider !== 'home-assistant') return false;
  if (!config.homeAssistant.url || !config.homeAssistant.token) return false;
  try {
    const home = await haHomeCoords();
    if (home.lat == null || home.lon == null) return false;
    const miles = distanceMi(lat, lon, home.lat, home.lon);
    return miles <= config.homeAssistant.matchRadiusKm * 0.621371;
  } catch (err) {
    if (!haWarned) {
      console.warn(`[providers] Home Assistant unreachable, using ${config.fallbackProvider}: ${err.message}`);
      haWarned = true;
    }
    return false;
  }
}

function baseProvider(name) {
  switch (name) {
    case 'openweathermap':
      return (lat, lon) =>
        openWeather.fetchWeather(lat, lon, {
          apiKey: config.openWeatherKey,
          mode: process.env.OPENWEATHER_MODE || 'auto',
        });
    case 'open-meteo':
    default:
      return (lat, lon) => openMeteo.fetchWeather(lat, lon);
  }
}

/**
 * Weather for one point, from whichever provider is configured, cached and
 * de-duplicated. Every caller in the app funnels through here.
 */
async function getWeather(lat, lon) {
  const key = `wx:${round4(lat)},${round4(lon)}`;
  // cache.wrap already de-duplicates concurrent callers for the same point;
  // withLimit caps how many *distinct* points are in flight at once.
  return cache.wrap(key, config.cache.weatherMs, () => withLimit(async () => {
    const useHA = await shouldUseHomeAssistant(lat, lon);
    const fallbackName =
      config.provider === 'home-assistant' ? config.fallbackProvider : config.provider;
    const fallback = baseProvider(fallbackName);

    if (!useHA) return fallback(lat, lon);

    try {
      const instance = await haInstance();
      const ha = await homeAssistant.fetchWeather(lat, lon, {
        homeAssistant: config.homeAssistant,
        instance,
      });

      // Some HA weather integrations expose only a daily forecast, or none at
      // all. Keep HA's live observation — it is the best current data available
      // — and borrow the missing forecast sections from the fallback provider.
      if (ha.incomplete && (ha.incomplete.hourly || ha.incomplete.daily)) {
        try {
          const filler = await fallback(lat, lon);
          if (ha.incomplete.hourly) ha.hourly = filler.hourly;
          if (ha.incomplete.daily) ha.daily = filler.daily;
          ha.dayparts = buildDayparts(
            ha.hourly, ha.daily, ha.utcOffsetSeconds, Math.floor(Date.now() / 1000)
          );
          ha.source += `+${filler.source}`;
        } catch (fillErr) {
          console.warn(`[providers] forecast backfill failed: ${fillErr.message}`);
        }
      }
      return ha;
    } catch (err) {
      console.warn(`[providers] Home Assistant read failed, falling back: ${err.message}`);
      return fallback(lat, lon);
    }
  }));
}

/** Weather for several points at once, sharing the cache. */
async function getWeatherBatch(points) {
  return Promise.all(
    points.map((p) =>
      getWeather(p.lat, p.lon).catch((err) => {
        console.warn(`[providers] ${p.lat},${p.lon} failed: ${err.message}`);
        return null;
      })
    )
  );
}

/**
 * Air quality, and pollen where the source offers it. Prefers a Home Assistant
 * sensor when the operator nominated one, since that is their own data.
 */
async function getAirQuality(lat, lon) {
  const key = `aq:${round4(lat)},${round4(lon)}`;
  return cache.wrap(key, config.cache.weatherMs, async () => {
    if (config.provider === 'home-assistant' && config.homeAssistant.aqiEntity) {
      try {
        const sensors = await homeAssistant.fetchSensors(config.homeAssistant);
        if (sensors.aqi) {
          const aqi = Math.round(sensors.aqi.value);
          return {
            aqi,
            category: openMeteo.aqiCategory(aqi),
            categoryIndex: openMeteo.aqiCategoryIndex(aqi),
            primaryPollutant:
              sensors.aqi.attributes.primary_pollutant || 'Fine Particulate',
            pollutants: {},
            time: Math.floor(Date.now() / 1000),
            pollen: { available: false },
            source: 'home-assistant',
          };
        }
      } catch {
        /* fall through to a network provider */
      }
    }

    if (config.provider === 'openweathermap' && config.openWeatherKey) {
      const owm = await openWeather
        .fetchAirQuality(lat, lon, { apiKey: config.openWeatherKey })
        .catch(() => null);
      if (owm) return owm;
    }

    // Open-Meteo's air-quality endpoint needs no key, so it is always available
    // as a backstop regardless of the configured weather provider.
    return openMeteo.fetchAirQuality(lat, lon).catch(() => null);
  });
}

const round4 = (n) => Number(n).toFixed(4);

module.exports = {
  getWeather, getWeatherBatch, getAirQuality,
  shouldUseHomeAssistant, haHomeCoords, resetHomeAssistantCache,
  openMeteo, openWeather, homeAssistant,
};
