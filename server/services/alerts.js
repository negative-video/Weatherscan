'use strict';

const { getJSON } = require('../lib/http');
const { cache } = require('../lib/cache');
const { config } = require('../config');
const { localISO } = require('../lib/units');

const NWS_ALERTS = 'https://api.weather.gov/alerts/active';

/**
 * Severe weather from the National Weather Service.
 *
 * NWS is a better source than the one being replaced, not merely a free one:
 * its `event` strings are exactly the vocabulary the IntelliStar's warning
 * priority table was built from, and each alert already carries the full
 * bulletin text. The old code had to make a second /v3/alerts/detail call per
 * alert just to get that text; here it arrives in the first response.
 *
 * Full descriptions are kept in a side table so the legacy detail endpoint can
 * still be answered without another network round trip.
 */
const detailStore = new Map();
const DETAIL_TTL = 6 * 3600 * 1000;

function rememberDetail(id, payload) {
  detailStore.set(id, { payload, time: Date.now() });
  if (detailStore.size > 400) {
    for (const [key, value] of detailStore) {
      if (Date.now() - value.time > DETAIL_TTL) detailStore.delete(key);
    }
  }
}

function getDetail(id) {
  const entry = detailStore.get(id);
  return entry ? entry.payload : null;
}

/**
 * Active alerts for a point, normalized.
 * @returns {object[]} newest/most severe first
 */
async function forPoint(lat, lon, providerAlerts = []) {
  if (!config.features.alerts) return [];

  const key = `alerts:${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
  return cache.wrap(key, config.cache.alertsMs, async () => {
    try {
      const data = await getJSON(`${NWS_ALERTS}?point=${lat},${lon}`, { timeoutMs: 10000 });
      const features = data.features || [];
      if (features.length || isLikelyUS(lat, lon)) {
        return features.map((f) => fromNWS(f, lat, lon)).filter(Boolean);
      }
    } catch (err) {
      // NWS only covers the US and its territories; a 404 outside that area is
      // expected, not a failure worth logging on every refresh.
      if (isLikelyUS(lat, lon)) {
        console.warn(`[alerts] NWS lookup failed for ${lat},${lon}: ${err.message}`);
      }
    }
    return providerAlerts.map((a) => fromProvider(a)).filter(Boolean);
  });
}

function fromNWS(feature, lat, lon) {
  const p = feature.properties;
  if (!p || !p.event) return null;

  const id = p.id || feature.id;
  const significance = significanceOf(p.event);
  const expires = p.ends || p.expires;

  // The frontend renders local wall-clock times straight from these strings.
  const offset = offsetFromISO(p.expires) || offsetFromISO(p.sent) || 0;

  const alert = {
    detailKey: id,
    messageType: normalizeMessageType(p.messageType),
    messageTypeCode: significance,
    phenomena: p.event,
    significance,
    eventDescription: p.event,
    headlineText: p.headline || p.event,
    source: p.senderName || 'National Weather Service',
    areaDesc: p.areaDesc || '',
    severity: p.severity || 'Unknown',
    severityCode: severityCode(p.severity),
    certainty: p.certainty || 'Unknown',
    urgency: p.urgency || 'Unknown',
    category: p.category || 'Met',
    issueTime: p.sent,
    issueTimeLocal: reformat(p.sent, offset),
    onsetTimeLocal: reformat(p.onset || p.effective, offset),
    expireTime: expires,
    expireTimeLocal: reformat(expires, offset),
    description: p.description || '',
    instruction: p.instruction || '',
    lat, lon,
  };

  rememberDetail(id, {
    alertDetail: {
      detailKey: id,
      phenomena: p.event,
      significance,
      eventDescription: p.event,
      messageType: alert.messageType,
      issueTimeLocal: alert.issueTimeLocal,
      expireTimeLocal: alert.expireTimeLocal,
      source: alert.source,
      areaDesc: alert.areaDesc,
      texts: [
        {
          languageCode: 'en-US',
          description: buildDescription(p),
          instruction: p.instruction || '',
          overview: p.headline || '',
        },
      ],
    },
  });

  return alert;
}

/**
 * OpenWeatherMap One Call alerts, for locations outside NWS coverage.
 * Far less structured — the event name is free text from the national met
 * service, so the priority table often will not match it.
 */
function fromProvider(a) {
  if (!a || !a.event) return null;
  const id = `owm_${a.sender_name || 'src'}_${a.start}`;
  const significance = significanceOf(a.event);

  const alert = {
    detailKey: id,
    messageType: 'Alert',
    messageTypeCode: significance,
    phenomena: a.event,
    significance,
    eventDescription: a.event,
    headlineText: a.event,
    source: a.sender_name || 'Provider',
    areaDesc: '',
    severity: 'Unknown',
    severityCode: 3,
    certainty: 'Unknown',
    urgency: 'Unknown',
    category: 'Met',
    issueTime: new Date(a.start * 1000).toISOString(),
    issueTimeLocal: new Date(a.start * 1000).toISOString(),
    expireTime: new Date(a.end * 1000).toISOString(),
    expireTimeLocal: new Date(a.end * 1000).toISOString(),
    description: a.description || '',
    instruction: '',
  };

  rememberDetail(id, {
    alertDetail: {
      detailKey: id,
      eventDescription: a.event,
      texts: [{ languageCode: 'en-US', description: a.description || a.event, instruction: '' }],
    },
  });

  return alert;
}

/**
 * The bulletin slide wraps at 40 characters over 7-line pages, so the raw NWS
 * text — which arrives hard-wrapped for teletype — needs its line breaks
 * normalized or every page ends up half empty.
 */
function buildDescription(p) {
  // NWS descriptions arrive hard-wrapped for teletype. The bulletin slide does
  // its own wrapping at 40 characters over 7-line pages, so those breaks have
  // to come out or every page renders half empty. Real paragraph breaks are
  // stashed behind a sentinel first so they survive the unwrap.
  const PARA = '\u0001';
  let text = String(p.description || p.headline || p.event || '')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, PARA)
    .replace(/\n/g, ' ')
    .replace(/\*\s+/g, '')
    .replace(/[ \t]{2,}/g, ' ');

  text = text
    .split(PARA)
    .map((para) => para.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (p.instruction) {
    const instruction = String(p.instruction)
      .replace(/\r/g, '')
      .replace(/\n{2,}/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (instruction) text += `\n\n${instruction}`;
  }
  return text;
}

/** W=Warning, A=Watch, Y=Advisory, S=Statement — the VTEC significance letters. */
function significanceOf(event) {
  const e = String(event).toLowerCase();
  if (e.includes('warning')) return 'W';
  if (e.includes('watch')) return 'A';
  if (e.includes('advisory')) return 'Y';
  if (e.includes('statement')) return 'S';
  if (e.includes('emergency')) return 'W';
  return 'S';
}

function normalizeMessageType(type) {
  switch (String(type)) {
    case 'Update': return 'Update';
    case 'Cancel': return 'Cancel';
    case 'Ack': return 'Ack';
    case 'Error': return 'Error';
    default: return 'Alert';
  }
}

function severityCode(severity) {
  return { Extreme: 1, Severe: 2, Moderate: 3, Minor: 4, Unknown: 5 }[severity] || 5;
}

/** Extract the UTC offset (seconds) from an ISO 8601 string's suffix. */
function offsetFromISO(iso) {
  if (!iso) return null;
  const m = String(iso).match(/([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60);
}

/** Re-render an ISO timestamp with a known offset, in the app's expected form. */
function reformat(iso, offset) {
  if (!iso) return null;
  const epoch = Math.floor(new Date(iso).getTime() / 1000);
  if (Number.isNaN(epoch)) return null;
  return localISO(epoch, offset);
}

/** Rough CONUS + AK/HI/PR bounding check, to decide whether NWS should apply. */
function isLikelyUS(lat, lon) {
  const inBox = (a, b, c, d) => lat >= a && lat <= b && lon >= c && lon <= d;
  return (
    inBox(24, 50, -125, -66) ||   // CONUS
    inBox(51, 72, -170, -129) ||  // Alaska
    inBox(18, 23, -161, -154) ||  // Hawaii
    inBox(17, 19, -68, -65)       // Puerto Rico
  );
}

module.exports = { forPoint, getDetail, significanceOf, isLikelyUS, buildDescription };
