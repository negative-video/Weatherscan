'use strict';

const { getJSON, HttpError } = require('../lib/http');
const icons = require('../lib/icons');
const U = require('../lib/units');
const { buildDayparts } = require('../lib/dayparts');
const { sunTimes } = require('../lib/astro');

const BASE = 'https://api.openweathermap.org';

/**
 * Two OpenWeatherMap paths are supported, because they have very different
 * signup requirements:
 *
 *   onecall — One Call API 3.0. Richer (UV, alerts, 8-day), but it is a separate
 *             subscription that requires a card on file even for the free
 *             1,000 calls/day.
 *   free    — /data/2.5/weather + /data/2.5/forecast. Available on any free key
 *             with no card, at the cost of 3-hourly resolution and no UV/alerts.
 *
 * `auto` tries One Call and quietly drops to the free pair on 401/403.
 */
async function fetchWeather(lat, lon, opts = {}) {
  const key = opts.apiKey;
  const mode = (opts.mode || 'auto').toLowerCase();
  if (!key) throw new Error('OpenWeatherMap API key is not configured');

  if (mode === 'free') return fetchFreeTier(lat, lon, key);

  try {
    return await fetchOneCall(lat, lon, key);
  } catch (err) {
    const denied = err instanceof HttpError && (err.status === 401 || err.status === 403);
    if (mode === 'auto' && denied) {
      console.warn(
        '[openweathermap] One Call 3.0 rejected the key ' +
          '(it needs its own subscription); falling back to the free 2.5 endpoints'
      );
      return fetchFreeTier(lat, lon, key);
    }
    throw err;
  }
}

async function fetchOneCall(lat, lon, key) {
  const url =
    `${BASE}/data/3.0/onecall?lat=${lat}&lon=${lon}` +
    `&units=imperial&exclude=minutely&appid=${key}`;
  const d = await getJSON(url);
  const off = d.timezone_offset || 0;
  const now = Math.floor(Date.now() / 1000);

  const hourly = (d.hourly || []).map((h) => {
    const w = h.weather[0] || {};
    const isDay = w.icon ? !String(w.icon).endsWith('n') : true;
    return {
      time: h.dt,
      temperature: U.round(h.temp),
      feelsLike: U.round(h.feels_like),
      dewPoint: U.round(h.dew_point),
      condition: icons.fromOWM(w.id, w.icon, w.description),
      precipChance: Math.round((h.pop || 0) * 100),
      humidity: U.round(h.humidity),
      windDeg: h.wind_deg,
      windSpeed: U.round(h.wind_speed),
      windGust: U.round(h.wind_gust != null ? h.wind_gust : h.wind_speed),
      uvIndex: h.uvi,
      cloudCover: U.round(h.clouds),
      visibility: h.visibility != null ? U.mToMiles(h.visibility) : null,
      isDay,
    };
  });

  const daily = (d.daily || []).map((day) => {
    const w = day.weather[0] || {};
    return {
      time: day.dt,
      dayOfWeek: U.dayOfWeek(day.dt, off),
      tempMax: U.round(day.temp && day.temp.max),
      tempMin: U.round(day.temp && day.temp.min),
      condition: icons.fromOWM(w.id, '01d', w.description),
      conditionNight: icons.fromOWM(w.id, '01n', w.description),
      precipChance: Math.round((day.pop || 0) * 100),
      humidity: U.round(day.humidity),
      windSpeed: U.round(day.wind_speed),
      windDeg: day.wind_deg,
      uvIndexMax: day.uvi,
      sunrise: day.sunrise,
      sunset: day.sunset,
      summary: day.summary || null,
    };
  });

  const c = d.current || {};
  const cw = c.weather && c.weather[0] ? c.weather[0] : {};
  const temperature = U.round(c.temp);
  const humidity = U.round(c.humidity);
  const windSpeed = U.round(c.wind_speed);

  return {
    source: 'openweathermap:onecall',
    lat: d.lat != null ? d.lat : lat,
    lon: d.lon != null ? d.lon : lon,
    timezone: d.timezone || 'UTC',
    utcOffsetSeconds: off,
    current: {
      time: c.dt || now,
      temperature,
      feelsLike: U.round(c.feels_like),
      condition: icons.fromOWM(cw.id, cw.icon, cw.description),
      humidity,
      dewPoint: U.round(c.dew_point),
      pressure: U.mbToInHg(c.pressure),
      windDeg: c.wind_deg,
      windDir: U.degToCardinal(c.wind_deg),
      windSpeed,
      windGust: U.round(c.wind_gust != null ? c.wind_gust : c.wind_speed),
      visibility: U.mToMiles(c.visibility),
      uvIndex: c.uvi != null ? c.uvi : 0,
      cloudCover: U.round(c.clouds),
      ceiling: null,
      heatIndex: U.heatIndex(temperature, humidity),
      windChill: U.windChill(temperature, windSpeed),
      isDay: cw.icon ? !String(cw.icon).endsWith('n') : true,
      sunrise: c.sunrise || null,
      sunset: c.sunset || null,
    },
    hourly,
    daily,
    dayparts: buildDayparts(hourly, daily, off, now),
    alerts: d.alerts || [],
  };
}

async function fetchFreeTier(lat, lon, key) {
  const [cur, fc] = await Promise.all([
    getJSON(`${BASE}/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${key}`),
    getJSON(`${BASE}/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${key}`),
  ]);

  const off = (fc.city && fc.city.timezone) || cur.timezone || 0;
  const now = Math.floor(Date.now() / 1000);

  const coarse = (fc.list || []).map((e) => {
    const w = e.weather[0] || {};
    const isDay = e.sys && e.sys.pod ? e.sys.pod === 'd' : true;
    const temperature = U.round(e.main.temp);
    return {
      time: e.dt,
      temperature,
      feelsLike: U.round(e.main.feels_like),
      dewPoint: U.dewPointF(temperature, e.main.humidity),
      condition: icons.fromOWM(w.id, isDay ? '01d' : '01n', w.description),
      precipChance: Math.round((e.pop || 0) * 100),
      humidity: U.round(e.main.humidity),
      windDeg: e.wind && e.wind.deg,
      windSpeed: U.round(e.wind && e.wind.speed),
      windGust: U.round(e.wind && (e.wind.gust != null ? e.wind.gust : e.wind.speed)),
      uvIndex: null,
      cloudCover: U.round(e.clouds && e.clouds.all),
      visibility: e.visibility != null ? U.mToMiles(e.visibility) : null,
      isDay,
    };
  });

  // The 2.5 forecast is 3-hourly. The legacy frontend hunts for specific
  // wall-clock hours (17:00 and 20:00 among them) and will run off the end of
  // the array if they are absent, so fill in the gaps.
  const hourly = densify(coarse);

  const daily = groupIntoDays(hourly, off);
  const cw = cur.weather && cur.weather[0] ? cur.weather[0] : {};
  const temperature = U.round(cur.main && cur.main.temp);
  const humidity = U.round(cur.main && cur.main.humidity);
  const windSpeed = U.round(cur.wind && cur.wind.speed);

  return {
    source: 'openweathermap:free',
    lat,
    lon,
    timezone: (fc.city && fc.city.name) || 'UTC',
    utcOffsetSeconds: off,
    current: {
      time: cur.dt || now,
      temperature,
      feelsLike: U.round(cur.main && cur.main.feels_like),
      condition: icons.fromOWM(cw.id, cw.icon, cw.description),
      humidity,
      dewPoint: U.dewPointF(temperature, humidity),
      pressure: U.mbToInHg(cur.main && cur.main.pressure),
      windDeg: cur.wind && cur.wind.deg,
      windDir: U.degToCardinal(cur.wind && cur.wind.deg),
      windSpeed,
      windGust: U.round(cur.wind && (cur.wind.gust != null ? cur.wind.gust : cur.wind.speed)),
      visibility: U.mToMiles(cur.visibility),
      uvIndex: 0, // not offered on the free tier
      cloudCover: U.round(cur.clouds && cur.clouds.all),
      ceiling: null,
      heatIndex: U.heatIndex(temperature, humidity),
      windChill: U.windChill(temperature, windSpeed),
      isDay: cw.icon ? !String(cw.icon).endsWith('n') : true,
      sunrise: cur.sys && cur.sys.sunrise,
      sunset: cur.sys && cur.sys.sunset,
    },
    hourly,
    daily,
    dayparts: buildDayparts(hourly, daily, off, now),
    alerts: [],
  };
}

/** Linear interpolation of a coarse series onto a strict 1-hour grid. */
function densify(entries) {
  if (entries.length < 2) return entries;
  const out = [];

  for (let i = 0; i < entries.length - 1; i++) {
    const a = entries[i];
    const b = entries[i + 1];
    const gapHours = Math.round((b.time - a.time) / 3600);
    out.push(a);
    for (let step = 1; step < gapHours; step++) {
      const t = step / gapHours;
      out.push({
        ...a,
        time: a.time + step * 3600,
        temperature: lerpRound(a.temperature, b.temperature, t),
        feelsLike: lerpRound(a.feelsLike, b.feelsLike, t),
        dewPoint: lerpRound(a.dewPoint, b.dewPoint, t),
        humidity: lerpRound(a.humidity, b.humidity, t),
        windSpeed: lerpRound(a.windSpeed, b.windSpeed, t),
        windGust: lerpRound(a.windGust, b.windGust, t),
        cloudCover: lerpRound(a.cloudCover, b.cloudCover, t),
        // Conditions and probabilities are categorical; snap to the nearer end.
        condition: t < 0.5 ? a.condition : b.condition,
        precipChance: t < 0.5 ? a.precipChance : b.precipChance,
        isDay: t < 0.5 ? a.isDay : b.isDay,
        interpolated: true,
      });
    }
  }
  out.push(entries[entries.length - 1]);
  return out;
}

function lerpRound(a, b, t) {
  if (a == null || b == null) return a != null ? a : b;
  return Math.round(a + (b - a) * t);
}

/** Derive daily highs/lows from an hourly series when the API has no daily block. */
function groupIntoDays(hourly, off) {
  const byDay = new Map();
  for (const h of hourly) {
    const p = U.localParts(h.time, off);
    const key = `${p.year}-${p.month}-${p.day}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(h);
  }

  return [...byDay.values()].map((hours) => {
    const temps = hours.map((h) => h.temperature).filter((t) => t != null);
    const midday =
      hours.find((h) => U.localParts(h.time, off).hour === 15) ||
      hours[Math.floor(hours.length / 2)];
    const start = hours[0];
    const local = U.localParts(start.time, off);
    const midnight =
      start.time - (local.hour * 3600 + local.minute * 60);
    const sun = sunTimes(new Date(start.time * 1000), 0, 0);

    return {
      time: midnight,
      dayOfWeek: U.dayOfWeek(midnight, off),
      tempMax: temps.length ? Math.max(...temps) : null,
      tempMin: temps.length ? Math.min(...temps) : null,
      condition: midday.condition,
      conditionNight: midday.condition,
      precipChance: Math.max(...hours.map((h) => h.precipChance || 0)),
      humidity: U.round(hours.reduce((s, h) => s + (h.humidity || 0), 0) / hours.length),
      windSpeed: Math.max(...hours.map((h) => h.windSpeed || 0)),
      windDeg: midday.windDeg,
      uvIndexMax: null,
      sunrise: sun.sunrise,
      sunset: sun.sunset,
    };
  });
}

/** OpenWeatherMap air pollution, normalized to the same shape as Open-Meteo's. */
async function fetchAirQuality(lat, lon, opts = {}) {
  const key = opts.apiKey;
  if (!key) return null;
  const d = await getJSON(
    `${BASE}/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${key}`
  );
  if (!d.list || !d.list.length) return null;

  const entry = d.list[0];
  const comp = entry.components || {};
  const scaled = {
    'Fine Particulate': comp.pm2_5 != null ? comp.pm2_5 / 35 : 0,
    PM10: comp.pm10 != null ? comp.pm10 / 150 : 0,
    Ozone: comp.o3 != null ? comp.o3 / 140 : 0,
    NO2: comp.no2 != null ? comp.no2 / 100 : 0,
    SO2: comp.so2 != null ? comp.so2 / 75 : 0,
  };
  const primary = Object.entries(scaled).sort((a, b) => b[1] - a[1])[0][0];

  // OWM reports a 1..5 band, not a US AQI value. Map it onto the EPA 1..6 scale
  // the slide expects, and derive a representative AQI number for display.
  const bandToIndex = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
  const bandToAqi = { 1: 25, 2: 75, 3: 125, 4: 175, 5: 250 };
  const band = entry.main && entry.main.aqi ? entry.main.aqi : 1;

  return {
    aqi: bandToAqi[band],
    category: ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy'][band - 1],
    categoryIndex: bandToIndex[band],
    primaryPollutant: primary,
    pollutants: {
      'Fine Particulate': comp.pm2_5, PM10: comp.pm10, Ozone: comp.o3,
      NO2: comp.no2, SO2: comp.so2, CO: comp.co,
    },
    time: entry.dt,
    pollen: { available: false },
  };
}

module.exports = { fetchWeather, fetchAirQuality, densify };
