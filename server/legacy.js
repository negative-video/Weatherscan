'use strict';

/**
 * The weather.com v1/v2/v3 response shapes, rebuilt from normalized data.
 *
 * This lives on the server rather than in the browser on purpose. The previous
 * attempt monkey-patched jQuery in the page and lost a race against the app's
 * own startup requests; moving the translation behind an HTTP endpoint removes
 * the race entirely, and makes every shape inspectable with curl.
 *
 * Field names and array layouts here are dictated by newweathermanager.js and
 * slides-loop.js, which are deliberately left untouched.
 */

const U = require('./lib/units');
const icons = require('./lib/icons');

// --- current conditions ---------------------------------------------------

function observationsCurrent(weather) {
  const c = weather.current;
  const off = weather.utcOffsetSeconds;
  const iconCode = icons.applyWind(c.condition.iconCode, c.windSpeed);

  return {
    // The frontend calls .toFixed(2) on this, so it must stay a Number.
    pressureAltimeter: c.pressure != null ? c.pressure : 29.92,
    pressureTendencyCode: c.pressureTrend != null ? c.pressureTrend : 0,
    temperature: c.temperature,
    temperatureDewPoint: c.dewPoint,
    temperatureFeelsLike: c.feelsLike,
    // The sidebar picks a "feels like" label by comparing these to the actual
    // temperature, so they must equal it when neither effect is in play.
    temperatureHeatIndex: c.heatIndex != null ? c.heatIndex : c.temperature,
    temperatureWindChill: c.windChill != null ? c.windChill : c.temperature,
    relativeHumidity: c.humidity,
    windDirectionCardinal: c.windSpeed === 0 ? 'CALM' : c.windDir,
    windDirection: c.windDeg,
    windSpeed: c.windSpeed,
    // Left undefined (not null) when absent: the slide tests `!= undefined`.
    windGust: c.windGust && c.windGust > c.windSpeed ? c.windGust : undefined,
    wxPhraseLong: c.condition.phrase,
    wxPhraseMedium: c.condition.phrase,
    iconCode,
    visibility: c.visibility,
    uvIndex: Math.round(c.uvIndex || 0),
    uvDescription: U.uvDescription(c.uvIndex || 0),
    cloudCeiling: c.ceiling,
    cloudCoverPhrase: c.condition.phrase,
    sunriseTimeLocal: U.localISO(c.sunrise, off),
    sunsetTimeLocal: U.localISO(c.sunset, off),
    validTimeLocal: U.localISO(c.time, off),
    validTimeUtc: c.time,
  };
}

// --- hourly ---------------------------------------------------------------

function forecastHourly(weather, hours = 48) {
  const off = weather.utcOffsetSeconds;
  const list = weather.hourly.slice(0, hours);

  return {
    validTimeLocal: list.map((h) => U.localISO(h.time, off)),
    validTimeUtc: list.map((h) => h.time),
    temperature: list.map((h) => h.temperature),
    temperatureDewPoint: list.map((h) => h.dewPoint),
    temperatureFeelsLike: list.map((h) => h.feelsLike),
    temperatureHeatIndex: list.map((h) => h.feelsLike),
    temperatureWindChill: list.map((h) => h.feelsLike),
    relativeHumidity: list.map((h) => h.humidity),
    precipChance: list.map((h) => h.precipChance),
    wxPhraseLong: list.map((h) => h.condition.phrase),
    iconCode: list.map((h) => icons.applyWind(h.condition.iconCode, h.windSpeed)),
    windDirectionCardinal: list.map((h) => (h.windSpeed === 0 ? 'CALM' : U.degToCardinal(h.windDeg))),
    windSpeed: list.map((h) => h.windSpeed),
    windGust: list.map((h) => h.windGust),
    uvIndex: list.map((h) => Math.round(h.uvIndex || 0)),
    cloudCover: list.map((h) => h.cloudCover),
    visibility: list.map((h) => h.visibility),
  };
}

// --- daily ----------------------------------------------------------------

/**
 * The 5-day product. `daypart` is a single-element array holding parallel
 * arrays of 2N entries — day, night, day, night. When today's daytime half has
 * already passed, weather.com nulled index 0 and the frontend shifts its
 * indices to compensate; that behaviour is reproduced here.
 */
function forecastDaily(weather, days = 6) {
  const off = weather.utcOffsetSeconds;
  const list = weather.daily.slice(0, days);
  const parts = weather.dayparts.slice(0, days);

  const flat = {
    daypartName: [], iconCode: [], precipChance: [], relativeHumidity: [],
    windDirectionCardinal: [], windSpeed: [], wxPhraseLong: [], narrative: [],
    qualifierPhrase: [], windPhrase: [], temperature: [], cloudCover: [],
    precipType: [], thunderCategory: [], snowRange: [], qpf: [],
  };

  parts.forEach((dp) => {
    pushPart(flat, dp.day);
    pushPart(flat, dp.night);
  });

  return {
    dayOfWeek: list.map((d) => d.dayOfWeek),
    validTimeLocal: list.map((d) => U.localISO(d.time, off)),
    validTimeUtc: list.map((d) => d.time),
    temperatureMax: list.map((d) => d.tempMax),
    temperatureMin: list.map((d) => d.tempMin),
    sunriseTimeLocal: list.map((d) => U.localISO(d.sunrise, off)),
    sunsetTimeLocal: list.map((d) => U.localISO(d.sunset, off)),
    // The top-level narrative is the day's headline; dayparts carry their own.
    narrative: parts.map((dp, i) =>
      (dp.day && dp.day.narrative) || (dp.night && dp.night.narrative) ||
      (list[i] && list[i].summary) || ''
    ),
    qpf: list.map(() => 0),
    moonPhase: list.map(() => null),
    daypart: [flat],
  };
}

function pushPart(flat, part) {
  if (!part) {
    // A null daypart must be null across every parallel array, not just the
    // name — the frontend indexes them all with the same offset.
    for (const key of Object.keys(flat)) flat[key].push(null);
    return;
  }
  flat.daypartName.push(part.daypartName);
  flat.iconCode.push(icons.applyWind(part.iconCode, part.windSpeed));
  flat.precipChance.push(part.precipChance);
  flat.relativeHumidity.push(part.relativeHumidity);
  flat.windDirectionCardinal.push(part.windSpeed === 0 ? 'CALM' : part.windDirectionCardinal);
  flat.windSpeed.push(part.windSpeed);
  flat.wxPhraseLong.push(part.wxPhraseLong);
  flat.narrative.push(part.narrative || '');
  // Real responses often carry these as null; the frontend guards for it.
  flat.qualifierPhrase.push(null);
  flat.windPhrase.push(null);
  flat.temperature.push(part.temperature);
  flat.cloudCover.push(part.cloudCover);
  flat.precipType.push(null);
  flat.thunderCategory.push(null);
  flat.snowRange.push(null);
  flat.qpf.push(0);
}

// --- alerts ---------------------------------------------------------------

function alertsHeadlines(alerts) {
  if (!alerts || !alerts.length) return { alerts: [] };
  return {
    alerts: alerts.map((a) => ({
      detailKey: a.detailKey,
      messageType: a.messageType,
      messageTypeCode: a.messageTypeCode,
      phenomena: a.phenomena,
      significance: a.significance,
      eventDescription: a.eventDescription,
      headlineText: a.headlineText,
      source: a.source,
      areaName: a.areaDesc,
      issueTimeLocal: a.issueTimeLocal,
      expireTimeLocal: a.expireTimeLocal,
      onsetTimeLocal: a.onsetTimeLocal,
      severityCode: a.severityCode,
      severity: a.severity,
      certainty: a.certainty,
      urgency: a.urgency,
      disclaimer: null,
      // The bulletin filter reads categories[0].category and keeps only "Met".
      categories: [{ category: a.category || 'Met', categoryCode: 2 }],
      responseTypes: [],
    })),
  };
}

function alertDetail(detail) {
  return detail || {
    alertDetail: {
      texts: [{ languageCode: 'en-US', description: 'Details unavailable.', instruction: '' }],
    },
  };
}

// --- location -------------------------------------------------------------

function locationPoint(place) {
  return {
    location: {
      latitude: place.lat,
      longitude: place.lon,
      displayName: place.name,
      city: place.city || place.name,
      adminDistrict: place.stateName || place.state || '',
      adminDistrictCode: place.state || '',
      country: place.countryName || 'United States',
      countryCode: place.country || 'US',
      ianaTimeZone: place.timezone || null,
      // The nearby-city de-duplicator falls back to these when a name collides
      // with one already in the list. They must only ever hold *place* names —
      // filling locale4 with the state made the duplicate check resolve to
      // "VA" and put the state itself on the surrounding-cities slide.
      locale: {
        locale1: null,
        locale2: place.admin2 || null,
        locale3: place.locality || place.name || null,
        locale4: place.admin2 || null,
      },
      placeId: placeId(place),
      airportName: place.airportName || null,
    },
  };
}

/** The search endpoint returns column-wise arrays rather than a list of rows. */
function locationSearch(places) {
  return {
    location: {
      latitude: places.map((p) => p.lat),
      longitude: places.map((p) => p.lon),
      displayName: places.map((p) => p.name),
      city: places.map((p) => p.name),
      // settings.js autocompletes against this; it was missing before.
      address: places.map((p) => addressLine(p)),
      adminDistrict: places.map((p) => p.stateName || p.state || ''),
      adminDistrictCode: places.map((p) => p.state || ''),
      country: places.map((p) => p.countryName || ''),
      countryCode: places.map((p) => p.country || ''),
      postalCode: places.map((p) => p.postcode || ''),
      placeId: places.map((p) => placeId(p)),
      locationCategory: places.map(() => 'city'),
    },
  };
}

function locationNear(places) {
  return {
    location: {
      latitude: places.map((p) => p.lat),
      longitude: places.map((p) => p.lon),
      displayName: places.map((p) => p.name),
      stationId: places.map((p) => placeId(p)),
      stationName: places.map((p) => p.name),
      // Real distances, not the index-times-five placeholder used previously.
      distanceMi: places.map((p) => (p.distanceMi != null ? p.distanceMi : 0)),
      adminDistrict: places.map((p) => p.stateName || p.state || ''),
      adminDistrictCode: places.map((p) => p.state || ''),
      country: places.map((p) => p.countryName || ''),
      countryCode: places.map((p) => p.country || 'US'),
    },
  };
}

function addressLine(p) {
  const parts = [p.name];
  if (p.state) parts.push(p.state);
  if (p.country && p.country !== 'US') parts.push(p.countryName || p.country);
  return parts.filter(Boolean).join(', ');
}

function placeId(p) {
  return `ws_${Number(p.lat).toFixed(4)}_${Number(p.lon).toFixed(4)}`.replace(/[.-]/g, '');
}

// --- almanac --------------------------------------------------------------

function almanacDaily(almanac) {
  if (!almanac) return null;
  return {
    almanacRecordDate: [`${almanac.date.month}/${almanac.date.day}`],
    almanacRecordPeriod: [almanac.years],
    almanacRecordYearMax: [almanac.recordHighYear],
    almanacRecordYearMin: [almanac.recordLowYear],
    temperatureAverageMax: [almanac.averageHigh],
    temperatureAverageMin: [almanac.averageLow],
    temperatureRecordMax: [almanac.recordHigh],
    temperatureRecordMin: [almanac.recordLow],
    precipitationAverage: [null],
    snowAccumulationAverage: [null],
  };
}

// --- health ---------------------------------------------------------------

function globalAirQuality(airQuality) {
  if (!airQuality) return null;
  return {
    globalairquality: {
      airQualityCategory: airQuality.category,
      airQualityCategoryIndex: airQuality.categoryIndex,
      airQualityIndex: airQuality.aqi,
      primaryPollutant: airQuality.primaryPollutant,
      // The slide multiplies this by 1000, so it must be epoch *seconds*.
      expireTimeGmt: airQuality.time || Math.floor(Date.now() / 1000),
      pollutants: airQuality.pollutants || {},
      source: airQuality.source || 'derived',
    },
  };
}

function pollenObservations(pollen, weather) {
  if (!pollen || !pollen.available) {
    return { pollenobservations: [{ stn_cmnt: 'No Report' }] };
  }
  const off = weather ? weather.utcOffsetSeconds : 0;
  const order = ['tree', 'grass', 'weed', 'mold'];

  return {
    pollenobservations: [
      {
        stn_cmnt: '',
        rpt_dt: U.localISO(pollen.date, off),
        total_pollen_cnt: pollen.total,
        treenames: [{ tree_nm: pollen.treeType || 'No Report' }],
        pollenobservation: order.map((type) => ({
          pollen_type: type,
          pollen_idx: pollen.types[type],
        })),
      },
    ],
  };
}

function achePainIndex(aches, weather) {
  const off = weather.utcOffsetSeconds;
  const now = Math.floor(Date.now() / 1000);
  const isDaytime = weather.current.isDay;

  // The slide reads dayInd to skip a leading night period, so emit a
  // day/night sequence starting with whichever half is current.
  const periods = buildTwelveHourPeriods(now, off, isDaytime, 6);
  return {
    achesPainsIndex12hour: {
      dayInd: periods.map((p) => p.dayInd),
      fcstValidLocal: periods.map((p) => p.local),
      achesPainsIndex: periods.map(() => aches.index),
      achesPainsCategory: periods.map(() => aches.category),
      derived: aches.derived,
    },
  };
}

function breathingIndexPayload(breathing, weather) {
  const off = weather.utcOffsetSeconds;
  const now = Math.floor(Date.now() / 1000);
  const periods = buildTwelveHourPeriods(now, off, weather.current.isDay, 6);
  return {
    breathingIndex12hour: {
      dayInd: periods.map((p) => p.dayInd),
      fcstValidLocal: periods.map((p) => p.local),
      breathingIndex: periods.map(() => breathing.index),
      breathingCategory: periods.map(() => breathing.category),
      derived: breathing.derived,
    },
  };
}

function buildTwelveHourPeriods(startEpoch, off, startsDaytime, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const time = startEpoch + i * 12 * 3600;
    const isDay = i % 2 === 0 ? startsDaytime : !startsDaytime;
    out.push({ dayInd: isDay ? 'D' : 'N', local: U.localISO(time, off) });
  }
  return out;
}

function uvCurrent(uv) {
  return { uvIndexCurrent: { uvIndex: uv.current.index, uvDesc: uv.current.description } };
}

function uvHourly(uv, weather) {
  const off = weather.utcOffsetSeconds;
  const now = Math.floor(Date.now() / 1000);

  // The slide scans for the hours 9, 12 and 15 and will run past the end of a
  // short array, so emit the full 48-hour series rather than just the matches.
  const list = weather.hourly.filter((h) => h.time > now - 3600).slice(0, 48);
  return {
    uvIndex1hour: {
      fcstValidLocal: list.map((h) => U.localISO(h.time, off)),
      uvIndex: list.map((h) => Math.round(h.uvIndex || 0)),
      uvDesc: list.map((h) => U.uvDescription(h.uvIndex || 0)),
    },
  };
}

// --- aggregation ----------------------------------------------------------

/**
 * Assemble one aggcommon element for a location. `products` is the
 * semicolon-separated list from the request path.
 */
function aggregate(products, ctx) {
  const out = {};
  for (const product of products) {
    switch (product) {
      case 'v3-wx-observations-current':
        out[product] = ctx.weather ? observationsCurrent(ctx.weather) : null;
        break;
      case 'v3-wx-forecast-hourly-2day':
        out[product] = ctx.weather ? forecastHourly(ctx.weather) : null;
        break;
      case 'v3-wx-forecast-daily-5day':
        out[product] = ctx.weather ? forecastDaily(ctx.weather) : null;
        break;
      case 'v3alertsHeadlines':
        out[product] = ctx.alerts && ctx.alerts.length ? alertsHeadlines(ctx.alerts) : undefined;
        break;
      case 'v3-location-point':
        out[product] = ctx.place ? locationPoint(ctx.place) : null;
        break;
      case 'v3-wx-almanac-daily-1day':
        out[product] = almanacDaily(ctx.almanac);
        break;
      default:
        out[product] = null;
    }
  }
  return out;
}

module.exports = {
  observationsCurrent, forecastHourly, forecastDaily,
  alertsHeadlines, alertDetail,
  locationPoint, locationSearch, locationNear,
  almanacDaily, globalAirQuality, pollenObservations,
  achePainIndex, breathingIndexPayload, uvCurrent, uvHourly,
  aggregate, placeId,
};
