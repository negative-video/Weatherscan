'use strict';

/**
 * Condition-code translation into the 0..47 icon vocabulary the IntelliStar
 * sprite sheets were built around. utils.js#getCCicon maps these onto sprite
 * columns, so anything outside 0..47 renders as a blank tile.
 *
 * 0  Tornado            12 Rain               24 Windy              36 Hot
 * 1  Tropical Storm     13 Flurries           25 Frigid             37 Isolated T-Storms
 * 2  Hurricane          14 Snow Showers       26 Cloudy             38 Scattered T-Storms
 * 3  Strong Storms      15 Blowing Snow       27 Mostly Cloudy (n)  39 Scattered Showers (d)
 * 4  Thunderstorms      16 Snow               28 Mostly Cloudy (d)  40 Heavy Rain
 * 5  Rain / Snow        17 Hail               29 Partly Cloudy (n)  41 Scattered Snow (d)
 * 6  Rain / Sleet       18 Sleet              30 Partly Cloudy (d)  42 Heavy Snow
 * 7  Wintry Mix         19 Dust               31 Clear (n)          43 Blizzard
 * 8  Freezing Drizzle   20 Fog                32 Sunny (d)          44 Not Available
 * 9  Drizzle            21 Haze               33 Fair (n)           45 Scattered Showers (n)
 * 10 Freezing Rain      22 Smoke              34 Fair (d)           46 Scattered Snow (n)
 * 11 Showers            23 Breezy             35 Rain & Hail        47 Scattered T-Storms (n)
 */

// WMO 4677 present-weather codes, used by Open-Meteo and (via translation)
// Home Assistant. [dayIcon, nightIcon, phrase]
const WMO = {
  0:  [32, 31, 'Sunny',                'Clear'],
  1:  [34, 33, 'Mostly Sunny',         'Mostly Clear'],
  2:  [30, 29, 'Partly Cloudy',        'Partly Cloudy'],
  3:  [26, 26, 'Cloudy',               'Cloudy'],
  45: [20, 20, 'Fog',                  'Fog'],
  48: [20, 20, 'Freezing Fog',         'Freezing Fog'],
  51: [9,  9,  'Light Drizzle',        'Light Drizzle'],
  53: [9,  9,  'Drizzle',              'Drizzle'],
  55: [9,  9,  'Heavy Drizzle',        'Heavy Drizzle'],
  56: [8,  8,  'Freezing Drizzle',     'Freezing Drizzle'],
  57: [8,  8,  'Freezing Drizzle',     'Freezing Drizzle'],
  61: [11, 11, 'Light Rain',           'Light Rain'],
  63: [12, 12, 'Rain',                 'Rain'],
  65: [40, 40, 'Heavy Rain',           'Heavy Rain'],
  66: [10, 10, 'Freezing Rain',        'Freezing Rain'],
  67: [10, 10, 'Freezing Rain',        'Freezing Rain'],
  71: [13, 13, 'Light Snow',           'Light Snow'],
  73: [16, 16, 'Snow',                 'Snow'],
  75: [42, 42, 'Heavy Snow',           'Heavy Snow'],
  77: [13, 13, 'Snow Grains',          'Snow Grains'],
  80: [39, 45, 'Scattered Showers',    'Scattered Showers'],
  81: [11, 11, 'Showers',              'Showers'],
  82: [40, 40, 'Heavy Showers',        'Heavy Showers'],
  85: [41, 46, 'Snow Showers',         'Snow Showers'],
  86: [42, 42, 'Heavy Snow Showers',   'Heavy Snow Showers'],
  95: [4,  4,  'Thunderstorms',        'Thunderstorms'],
  96: [17, 17, 'T-Storms with Hail',   'T-Storms with Hail'],
  99: [17, 17, 'Severe T-Storms',      'Severe T-Storms'],
};

function fromWMO(code, isDay = true) {
  const row = WMO[code];
  if (!row) return { iconCode: 44, phrase: 'Not Available' };
  return { iconCode: isDay ? row[0] : row[1], phrase: isDay ? row[2] : row[3] };
}

// OpenWeatherMap condition IDs -> [day, night, phrase]. OWM's own `description`
// is used when present; the phrase here is the fallback.
const OWM = {
  200: [38, 47, 'T-Storms with Light Rain'], 201: [4, 4, 'T-Storms with Rain'],
  202: [3, 3, 'T-Storms with Heavy Rain'],   210: [37, 47, 'Isolated T-Storms'],
  211: [4, 4, 'Thunderstorms'],              212: [3, 3, 'Heavy Thunderstorms'],
  221: [3, 3, 'Strong Storms'],              230: [38, 47, 'T-Storms with Drizzle'],
  231: [38, 47, 'T-Storms with Drizzle'],    232: [4, 4, 'T-Storms with Drizzle'],

  300: [9, 9, 'Light Drizzle'],   301: [9, 9, 'Drizzle'],       302: [9, 9, 'Heavy Drizzle'],
  310: [9, 9, 'Light Drizzle'],   311: [9, 9, 'Drizzle'],       312: [9, 9, 'Heavy Drizzle'],
  313: [11, 11, 'Showers'],       314: [40, 40, 'Heavy Showers'], 321: [11, 11, 'Showers'],

  500: [11, 11, 'Light Rain'],    501: [12, 12, 'Rain'],        502: [40, 40, 'Heavy Rain'],
  503: [40, 40, 'Very Heavy Rain'], 504: [40, 40, 'Extreme Rain'],
  511: [10, 10, 'Freezing Rain'], 520: [39, 45, 'Light Showers'],
  521: [11, 11, 'Showers'],       522: [40, 40, 'Heavy Showers'], 531: [11, 11, 'Ragged Showers'],

  600: [13, 13, 'Light Snow'],    601: [16, 16, 'Snow'],        602: [42, 42, 'Heavy Snow'],
  611: [18, 18, 'Sleet'],         612: [18, 18, 'Light Sleet'], 613: [18, 18, 'Sleet Showers'],
  615: [5, 5, 'Rain and Snow'],   616: [5, 5, 'Rain and Snow'],
  620: [41, 46, 'Light Snow Showers'], 621: [14, 14, 'Snow Showers'], 622: [42, 42, 'Heavy Snow Showers'],

  701: [20, 20, 'Mist'],   711: [22, 22, 'Smoke'],  721: [21, 21, 'Haze'],
  731: [19, 19, 'Blowing Dust'], 741: [20, 20, 'Fog'], 751: [19, 19, 'Sand'],
  761: [19, 19, 'Dust'],   762: [19, 19, 'Volcanic Ash'], 771: [23, 23, 'Squalls'],
  781: [0, 0, 'Tornado'],

  800: [32, 31, 'Sunny'],
  801: [34, 33, 'Mostly Sunny'], 802: [30, 29, 'Partly Cloudy'],
  803: [28, 27, 'Mostly Cloudy'], 804: [26, 26, 'Cloudy'],
};

function fromOWM(conditionId, owmIcon, description) {
  const isDay = owmIcon ? !String(owmIcon).endsWith('n') : true;
  const row = OWM[conditionId];
  if (!row) return { iconCode: 44, phrase: description ? titled(description) : 'Not Available' };
  return {
    iconCode: isDay ? row[0] : row[1],
    // OWM 800 reads "clear sky" at night, which the sprite calls "Clear".
    phrase: description && conditionId !== 800 ? titled(description) : row[2],
  };
}

// Home Assistant weather entity states are a small fixed vocabulary.
const HA_STATES = {
  'clear-night':   [31, 31, 'Clear'],
  cloudy:          [26, 26, 'Cloudy'],
  exceptional:     [44, 44, 'Not Available'],
  fog:             [20, 20, 'Fog'],
  hail:            [17, 17, 'Hail'],
  lightning:       [4, 4, 'Thunderstorms'],
  'lightning-rainy': [4, 4, 'T-Storms with Rain'],
  partlycloudy:    [30, 29, 'Partly Cloudy'],
  pouring:         [40, 40, 'Heavy Rain'],
  rainy:           [12, 12, 'Rain'],
  snowy:           [16, 16, 'Snow'],
  'snowy-rainy':   [5, 5, 'Rain and Snow'],
  sunny:           [32, 31, 'Sunny'],
  windy:           [24, 24, 'Windy'],
  'windy-variant': [24, 24, 'Windy'],
};

function fromHomeAssistant(state, isDay = true) {
  const row = HA_STATES[state];
  if (!row) return { iconCode: 44, phrase: 'Not Available' };
  // clear-night is inherently nocturnal; don't let a daytime flag override it.
  if (state === 'clear-night') return { iconCode: 31, phrase: 'Clear' };
  return { iconCode: isDay ? row[0] : row[1], phrase: row[2] };
}

/** METAR sky-cover + weather string -> icon, for the airport slides. */
function fromMetar(cover, rawOb = '', isDay = true) {
  const raw = String(rawOb).toUpperCase();
  if (/\bTS/.test(raw)) return { iconCode: 4, phrase: 'Thunderstorms' };
  if (/\bFZRA/.test(raw)) return { iconCode: 10, phrase: 'Freezing Rain' };
  if (/\bSN/.test(raw)) return { iconCode: 16, phrase: 'Snow' };
  if (/\bRA/.test(raw)) return { iconCode: 12, phrase: 'Rain' };
  if (/\bDZ/.test(raw)) return { iconCode: 9, phrase: 'Drizzle' };
  if (/\bFG|\bBR/.test(raw)) return { iconCode: 20, phrase: 'Fog' };
  if (/\bHZ/.test(raw)) return { iconCode: 21, phrase: 'Haze' };

  switch (cover) {
    case 'CLR': case 'SKC': case 'CAVOK':
      return isDay ? { iconCode: 32, phrase: 'Sunny' } : { iconCode: 31, phrase: 'Clear' };
    case 'FEW':
      return isDay ? { iconCode: 34, phrase: 'Mostly Sunny' } : { iconCode: 33, phrase: 'Mostly Clear' };
    case 'SCT':
      return isDay ? { iconCode: 30, phrase: 'Partly Cloudy' } : { iconCode: 29, phrase: 'Partly Cloudy' };
    case 'BKN':
      return isDay ? { iconCode: 28, phrase: 'Mostly Cloudy' } : { iconCode: 27, phrase: 'Mostly Cloudy' };
    case 'OVC': case 'OVX':
      return { iconCode: 26, phrase: 'Cloudy' };
    default:
      return { iconCode: 44, phrase: 'Not Available' };
  }
}

// Sky conditions come in day/night pairs. Providers flag daylight per hour, and
// their boundary is civil sunset, so an hour placed in the "night" daypart can
// still carry a daytime icon. These tables re-key an icon to the right half.
const DAY_TO_NIGHT = { 32: 31, 34: 33, 30: 29, 28: 27, 39: 45, 41: 46, 37: 47, 38: 47 };
const NIGHT_TO_DAY = { 31: 32, 33: 34, 29: 30, 27: 28, 45: 39, 46: 41, 47: 38 };

const PHRASE_TO_NIGHT = { Sunny: 'Clear', 'Mostly Sunny': 'Mostly Clear' };
const PHRASE_TO_DAY = { Clear: 'Sunny', 'Mostly Clear': 'Mostly Sunny' };

/** Force a condition into its night form. Non-sky conditions pass through. */
function nightVariant(condition) {
  if (!condition) return condition;
  const iconCode = DAY_TO_NIGHT[condition.iconCode];
  if (iconCode === undefined) return condition;
  return { iconCode, phrase: PHRASE_TO_NIGHT[condition.phrase] || condition.phrase };
}

/** Force a condition into its day form. */
function dayVariant(condition) {
  if (!condition) return condition;
  const iconCode = NIGHT_TO_DAY[condition.iconCode];
  if (iconCode === undefined) return condition;
  return { iconCode, phrase: PHRASE_TO_DAY[condition.phrase] || condition.phrase };
}

/**
 * Windy/breezy override. The real IntelliStar swapped in the windy sprites when
 * a fair-weather condition was paired with a strong wind.
 */
function applyWind(iconCode, windMph) {
  if (windMph == null || windMph < 22) return iconCode;
  if ([32, 34, 30, 28, 26].includes(iconCode)) return 24;
  if ([31, 33, 29, 27].includes(iconCode)) return 23;
  return iconCode;
}

function titled(phrase) {
  return String(phrase)
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

module.exports = {
  fromWMO, fromOWM, fromHomeAssistant, fromMetar, applyWind,
  nightVariant, dayVariant, WMO, HA_STATES,
};
