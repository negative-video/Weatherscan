'use strict';

const { getJSON } = require('../lib/http');
const icons = require('../lib/icons');
const U = require('../lib/units');
const { buildDayparts } = require('../lib/dayparts');

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIRQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const HOURLY_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
  'precipitation_probability', 'weather_code', 'cloud_cover', 'visibility',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'uv_index', 'is_day',
].join(',');

const CURRENT_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
  'is_day', 'weather_code', 'cloud_cover', 'pressure_msl', 'surface_pressure',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
].join(',');

const DAILY_VARS = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset',
  'uv_index_max', 'precipitation_probability_max', 'wind_speed_10m_max',
  'wind_direction_10m_dominant',
].join(',');

/**
 * Open-Meteo is the default source: no key, no card, no per-call quota for
 * non-commercial use, and it covers everything the IntelliStar slides need
 * except alerts (NWS) and airports (aviationweather.gov).
 */
async function fetchWeather(lat, lon) {
  const url =
    `${FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
    `&current=${CURRENT_VARS}&hourly=${HOURLY_VARS}&daily=${DAILY_VARS}` +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
    '&timezone=auto&timeformat=unixtime&forecast_days=8&past_days=1';

  const data = await getJSON(url);
  return normalize(data, lat, lon);
}

function normalize(data, lat, lon) {
  const off = data.utc_offset_seconds || 0;
  const now = Math.floor(Date.now() / 1000);
  const c = data.current || {};

  // Hourly: keep from the start of the current local hour onward. The frontend
  // scans forward looking for specific wall-clock hours, so leading past hours
  // are just wasted bytes.
  const h = data.hourly || {};
  const hourly = [];
  for (let i = 0; i < (h.time || []).length; i++) {
    if (h.time[i] < now - 3600) continue;
    const isDay = h.is_day ? h.is_day[i] === 1 : true;
    hourly.push({
      time: h.time[i],
      temperature: U.round(h.temperature_2m[i]),
      feelsLike: U.round(h.apparent_temperature[i]),
      dewPoint: U.round(h.dew_point_2m ? h.dew_point_2m[i] : null),
      condition: icons.fromWMO(h.weather_code[i], isDay),
      precipChance: U.round(h.precipitation_probability ? h.precipitation_probability[i] : 0),
      humidity: U.round(h.relative_humidity_2m[i]),
      windDeg: h.wind_direction_10m[i],
      windSpeed: U.round(h.wind_speed_10m[i]),
      windGust: U.round(h.wind_gusts_10m ? h.wind_gusts_10m[i] : null),
      uvIndex: h.uv_index ? +h.uv_index[i] : null,
      cloudCover: U.round(h.cloud_cover ? h.cloud_cover[i] : null),
      // Open-Meteo reports visibility in feet under the imperial unit set.
      visibility: h.visibility && h.visibility[i] != null
        ? +(h.visibility[i] / 5280).toFixed(1)
        : null,
      isDay,
    });
    if (hourly.length >= 96) break;
  }

  const d = data.daily || {};
  const daily = [];
  for (let i = 0; i < (d.time || []).length; i++) {
    // past_days=1 pulls in yesterday; drop anything already finished.
    if (d.sunset && d.sunset[i] && d.sunset[i] < now - 3600) continue;
    daily.push({
      time: d.time[i],
      dayOfWeek: U.dayOfWeek(d.time[i], off),
      tempMax: U.round(d.temperature_2m_max[i]),
      tempMin: U.round(d.temperature_2m_min[i]),
      condition: icons.fromWMO(d.weather_code[i], true),
      conditionNight: icons.fromWMO(d.weather_code[i], false),
      precipChance: U.round(d.precipitation_probability_max ? d.precipitation_probability_max[i] : 0),
      humidity: null,
      windSpeed: U.round(d.wind_speed_10m_max ? d.wind_speed_10m_max[i] : null),
      windDeg: d.wind_direction_10m_dominant ? d.wind_direction_10m_dominant[i] : null,
      uvIndexMax: d.uv_index_max ? d.uv_index_max[i] : null,
      sunrise: d.sunrise ? d.sunrise[i] : null,
      sunset: d.sunset ? d.sunset[i] : null,
    });
    if (daily.length >= 8) break;
  }

  const today = daily[0] || {};
  const isDay = c.is_day === 1;
  const temperature = U.round(c.temperature_2m);
  const humidity = U.round(c.relative_humidity_2m);
  const windSpeed = U.round(c.wind_speed_10m);

  // Current-hour UV and visibility are not in the `current` block; take them
  // from the matching hourly entry.
  const nearest = hourly.find((x) => x.time >= now - 3600) || hourly[0] || {};

  const current = {
    time: c.time || now,
    temperature,
    feelsLike: U.round(c.apparent_temperature),
    condition: icons.fromWMO(c.weather_code, isDay),
    humidity,
    dewPoint: U.round(c.dew_point_2m),
    pressure: U.mbToInHg(c.pressure_msl != null ? c.pressure_msl : c.surface_pressure),
    windDeg: c.wind_direction_10m,
    windDir: U.degToCardinal(c.wind_direction_10m),
    windSpeed,
    windGust: U.round(c.wind_gusts_10m),
    visibility: nearest.visibility,
    uvIndex: nearest.uvIndex != null ? nearest.uvIndex : 0,
    cloudCover: U.round(c.cloud_cover),
    ceiling: null,
    heatIndex: U.heatIndex(temperature, humidity),
    windChill: U.windChill(temperature, windSpeed),
    isDay,
    sunrise: today.sunrise || null,
    sunset: today.sunset || null,
  };

  return {
    source: 'open-meteo',
    lat: data.latitude != null ? data.latitude : lat,
    lon: data.longitude != null ? data.longitude : lon,
    timezone: data.timezone || 'UTC',
    utcOffsetSeconds: off,
    current,
    hourly,
    daily,
    dayparts: buildDayparts(hourly, daily, off, now),
  };
}

/**
 * Air quality, plus pollen where CAMS provides it. Pollen coverage is European;
 * elsewhere the values come back null and the caller marks the slide no-report.
 */
async function fetchAirQuality(lat, lon) {
  const url =
    `${AIRQ_URL}?latitude=${lat}&longitude=${lon}` +
    '&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone' +
    ',alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen' +
    '&timezone=auto&timeformat=unixtime';

  const data = await getJSON(url);
  const c = data.current || {};
  if (c.us_aqi == null) return null;

  const pollutants = {
    'Fine Particulate': c.pm2_5,
    PM10: c.pm10,
    Ozone: c.ozone,
    NO2: c.nitrogen_dioxide,
    SO2: c.sulphur_dioxide,
    CO: c.carbon_monoxide,
  };

  // The EPA reports the pollutant driving the index; approximate it by
  // comparing each concentration against its own 24h standard.
  const scaled = {
    'Fine Particulate': c.pm2_5 != null ? c.pm2_5 / 35 : 0,
    PM10: c.pm10 != null ? c.pm10 / 150 : 0,
    Ozone: c.ozone != null ? c.ozone / 140 : 0,
    NO2: c.nitrogen_dioxide != null ? c.nitrogen_dioxide / 100 : 0,
    SO2: c.sulphur_dioxide != null ? c.sulphur_dioxide / 75 : 0,
  };
  const primary = Object.entries(scaled).sort((a, b) => b[1] - a[1])[0][0];

  return {
    aqi: Math.round(c.us_aqi),
    category: aqiCategory(c.us_aqi),
    categoryIndex: aqiCategoryIndex(c.us_aqi),
    primaryPollutant: primary,
    pollutants,
    time: c.time,
    pollen: {
      tree: maxOf([c.alder_pollen, c.birch_pollen, c.olive_pollen]),
      grass: c.grass_pollen,
      weed: maxOf([c.mugwort_pollen, c.ragweed_pollen]),
      mold: null,
      treeType: dominantTree(c),
      available: [c.alder_pollen, c.birch_pollen, c.grass_pollen, c.ragweed_pollen]
        .some((v) => v != null),
    },
  };
}

function maxOf(values) {
  const valid = values.filter((v) => v != null);
  return valid.length ? Math.max(...valid) : null;
}

function dominantTree(c) {
  const trees = { Alder: c.alder_pollen, Birch: c.birch_pollen, Olive: c.olive_pollen };
  const best = Object.entries(trees)
    .filter(([, v]) => v != null)
    .sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : '';
}

function aqiCategory(aqi) {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

/** The IntelliStar air-quality slide expects the 1..6 EPA band, not the raw AQI. */
function aqiCategoryIndex(aqi) {
  if (aqi <= 50) return 1;
  if (aqi <= 100) return 2;
  if (aqi <= 150) return 3;
  if (aqi <= 200) return 4;
  if (aqi <= 300) return 5;
  return 6;
}

module.exports = { fetchWeather, fetchAirQuality, normalize, aqiCategory, aqiCategoryIndex };
