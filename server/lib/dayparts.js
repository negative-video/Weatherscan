'use strict';

const { localParts, degToCardinal, titleCase } = require('./units');
const { nightVariant, dayVariant } = require('./icons');

// Fallback window, used only when a provider does not flag daylight per hour.
// When it does, that flag wins — a fixed 19:00 boundary puts dark December
// evenings in the "day" half.
const DAY_START = 7;
const NIGHT_START = 19;

/**
 * weather.com served each day as two dayparts (day and night) with genuinely
 * different conditions, and the IntelliStar's Day Description and 5-Day slides
 * read them as a flat interleaved array. Building them by bucketing the hourly
 * forecast gives real day/night differences instead of repeating the daytime
 * condition after dark.
 *
 * @param {object[]} hourly   normalized hourly entries (epoch `time`)
 * @param {object[]} daily    normalized daily entries (epoch `time` at local midnight)
 * @param {number} utcOffset  seconds
 * @param {number} nowEpoch   seconds
 * @returns {{day:object|null, night:object|null}[]} one entry per daily day
 */
function buildDayparts(hourly, daily, utcOffset, nowEpoch) {
  const nowLocal = localParts(nowEpoch, utcOffset);

  // Bucket hourly entries by local calendar day and by day/night half.
  const buckets = new Map();
  for (const h of hourly) {
    const p = localParts(h.time, utcOffset);
    const isNight =
      h.isDay === undefined || h.isDay === null
        ? p.hour < DAY_START || p.hour >= NIGHT_START
        : !h.isDay;

    // A dark hour before midday belongs to the *previous* day's night.
    let key = `${p.year}-${p.month}-${p.day}`;
    if (isNight && p.hour < 12) {
      const prev = localParts(h.time - 86400, utcOffset);
      key = `${prev.year}-${prev.month}-${prev.day}`;
    }
    if (!buckets.has(key)) buckets.set(key, { day: [], night: [] });
    buckets.get(key)[isNight ? 'night' : 'day'].push(h);
  }

  return daily.map((d, index) => {
    const p = localParts(d.time, utcOffset);
    const key = `${p.year}-${p.month}-${p.day}`;
    const bucket = buckets.get(key) || { day: [], night: [] };

    const isToday =
      p.year === nowLocal.year && p.month === nowLocal.month && p.day === nowLocal.day;

    // weather.com dropped today's day-part once the afternoon was over. The
    // legacy frontend detects that null and shifts its indices; reproducing it
    // is what keeps "Tonight" from showing this morning's forecast.
    const dayExpired = isToday && nowLocal.hour >= 15;

    const day = dayExpired
      ? null
      : summarize(bucket.day, {
          fallbackIcon: d.condition,
          temperature: d.tempMax,
          precipChance: d.precipChance,
          windSpeed: d.windSpeed,
          windDeg: d.windDeg,
          humidity: d.humidity,
          isDay: true,
        });

    const night = summarize(bucket.night, {
      fallbackIcon: d.conditionNight || d.condition,
      temperature: d.tempMin,
      precipChance: d.precipChance,
      windSpeed: d.windSpeed,
      windDeg: d.windDeg,
      humidity: d.humidity,
      isDay: false,
    });

    const label = daypartLabels(index, isToday, d.dayOfWeek);
    if (day) {
      day.daypartName = label.day;
      day.narrative = narrate(day, false, day.temperature);
    }
    if (night) {
      night.daypartName = label.night;
      night.narrative = narrate(night, true, night.temperature);
    }
    return { day, night };
  });
}

/** Collapse a bucket of hourly entries into a single daypart summary. */
function summarize(hours, fallback) {
  if (!hours || hours.length === 0) {
    const base = fallback.isDay
      ? dayVariant(fallback.fallbackIcon)
      : nightVariant(fallback.fallbackIcon);
    return {
      iconCode: base ? base.iconCode : 44,
      wxPhraseLong: base ? base.phrase : 'Not Available',
      temperature: fallback.temperature,
      precipChance: fallback.precipChance == null ? 0 : fallback.precipChance,
      relativeHumidity: fallback.humidity == null ? 0 : fallback.humidity,
      windSpeed: fallback.windSpeed == null ? 0 : fallback.windSpeed,
      windDirectionCardinal: degToCardinal(fallback.windDeg),
      cloudCover: null,
      synthesized: true,
    };
  }

  // The representative condition is the most "significant" hour, not the
  // average — a thunderstorm in a 12-hour window is what the slide should show.
  const dominant = hours.reduce((worst, h) =>
    severity(h.condition.iconCode) > severity(worst.condition.iconCode) ? h : worst
  );
  // Twilight hours straddle the boundary and can carry the wrong half's icon.
  const condition = fallback.isDay
    ? dayVariant(dominant.condition)
    : nightVariant(dominant.condition);

  const temps = hours.map((h) => h.temperature).filter((t) => t != null);
  const pops = hours.map((h) => h.precipChance).filter((p) => p != null);
  const hums = hours.map((h) => h.humidity).filter((p) => p != null);
  const winds = hours.map((h) => h.windSpeed).filter((w) => w != null);
  const clouds = hours.map((h) => h.cloudCover).filter((c) => c != null);

  return {
    iconCode: condition.iconCode,
    wxPhraseLong: condition.phrase,
    temperature: fallback.isDay
      ? (temps.length ? Math.max(...temps) : fallback.temperature)
      : (temps.length ? Math.min(...temps) : fallback.temperature),
    precipChance: pops.length ? Math.max(...pops) : 0,
    relativeHumidity: hums.length ? Math.round(avg(hums)) : 0,
    windSpeed: winds.length ? Math.round(avg(winds)) : 0,
    windDirectionCardinal: degToCardinal(circularMeanDeg(hours.map((h) => h.windDeg))),
    cloudCover: clouds.length ? Math.round(avg(clouds)) : null,
    synthesized: false,
  };
}

/**
 * How "newsworthy" a condition is. Drives which hour represents the daypart.
 * Ordered so severe weather always wins over routine cloud cover.
 */
function severity(icon) {
  const table = {
    0: 100, 1: 96, 2: 98, 3: 95, 4: 90, 37: 88, 38: 88, 47: 88, 17: 85, 35: 85,
    43: 84, 42: 80, 40: 78, 16: 70, 12: 68, 14: 62, 41: 60, 46: 60, 13: 58,
    11: 55, 39: 52, 45: 52, 10: 66, 8: 50, 18: 64, 6: 64, 5: 64, 7: 64,
    9: 45, 15: 60, 25: 40, 20: 38, 21: 34, 22: 34, 19: 34, 23: 30, 24: 32,
    26: 25, 27: 22, 28: 22, 29: 18, 30: 18, 33: 12, 34: 12, 31: 8, 32: 8,
    36: 20, 44: 0,
  };
  return table[icon] === undefined ? 10 : table[icon];
}

/**
 * A weather.com-style forecast sentence, which is what the Day Description
 * slide renders. Matching the cadence matters more than matching the wording.
 */
function narrate(part, isNight, temp) {
  const bits = [];
  const phrase = titleCase(part.wxPhraseLong);

  const skyOnly = [26, 27, 28, 29, 30, 31, 32, 33, 34].includes(part.iconCode);
  bits.push(skyOnly ? `${phrase} skies.` : `${phrase}.`);

  if (temp != null) bits.push(isNight ? `Low ${temp}F.` : `High ${temp}F.`);

  if (part.windSpeed != null && part.windSpeed >= 1) {
    const dir = part.windDirectionCardinal && part.windDirectionCardinal !== 'CALM'
      ? `${part.windDirectionCardinal} `
      : '';
    if (part.windSpeed < 5) {
      bits.push('Winds light and variable.');
    } else {
      const high = Math.round(part.windSpeed * 1.4);
      bits.push(`Winds ${dir}at ${part.windSpeed} to ${high} mph.`);
    }
  }

  if (part.precipChance != null && part.precipChance >= 20) {
    const snowy = [13, 14, 16, 41, 42, 43, 46].includes(part.iconCode);
    bits.push(`Chance of ${snowy ? 'snow' : 'rain'} ${part.precipChance}%.`);
  }

  return bits.join(' ');
}

function daypartLabels(index, isToday, dayOfWeek) {
  if (isToday) return { day: 'Today', night: 'Tonight' };
  return { day: dayOfWeek, night: `${dayOfWeek} Night` };
}

const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

/** Wind directions are angles; a naive mean of 350 and 10 gives 180. */
function circularMeanDeg(degrees) {
  const valid = degrees.filter((d) => d != null && !Number.isNaN(d));
  if (!valid.length) return null;
  let x = 0;
  let y = 0;
  for (const d of valid) {
    x += Math.cos((d * Math.PI) / 180);
    y += Math.sin((d * Math.PI) / 180);
  }
  const deg = (Math.atan2(y / valid.length, x / valid.length) * 180) / Math.PI;
  return (deg + 360) % 360;
}

module.exports = { buildDayparts, narrate, severity, circularMeanDeg };
