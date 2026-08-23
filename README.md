# Weatherscan IntelliStar Simulator

A working recreation of the Weatherscan cable weather channel — the original
2000s frontend, driven by a small modern backend that needs no weather API key.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## Quick start

```bash
git clone https://github.com/negative-video/Weatherscan.git
cd Weatherscan
cp .env.example .env
```

Put a Mapbox token in `.env` (free, 50k loads/month, from
[account.mapbox.com](https://account.mapbox.com/) — copy the "Default public
token"). Nothing else is required:

```bash
MAPBOX_API_KEY=pk.your_token_here
```

Then:

```bash
docker compose up -d
```

Open <http://localhost:8080>. It geolocates from your IP; to pin a location,
use `http://localhost:8080/?Philadelphia` or `?90210`.

Running without Docker needs only Node 18+ and no `npm install`:

```bash
npm start
```

---

## What you need

| | Required? | Why |
|---|---|---|
| **Mapbox token** | Yes | Map tiles for the radar, satellite and mini-map surfaces. Free tier. |
| Weather API key | **No** | Open-Meteo is the default: no key, no signup, no card, no per-day quota. |
| Pollen key | Optional | The pollen slide self-skips without one. |

Verify everything before you start:

```bash
npm run check
```

It probes every configured source and prints what works, what is degraded, and
what is broken.

---

## Where the data comes from

| Slide | Source | Key |
|---|---|---|
| Current conditions, forecasts | Open-Meteo (or OpenWeatherMap, or Home Assistant) | none by default |
| Severe weather bulletins | National Weather Service | none |
| Radar | RainViewer | none |
| Satellite | NASA GIBS (GOES-East) | none |
| Airport conditions | aviationweather.gov METAR | none |
| Airport delays | FAA NAS status | none |
| Air quality | Open-Meteo / OpenWeatherMap | none |
| Almanac normals & records | 30 years of ERA5 reanalysis | none |
| Moon phases | Computed locally | none |
| Nearby cities, ticker | Bundled GeoNames index | none |
| Pollen | Google Pollen or Ambee | key needed |
| Map tiles | Mapbox | key needed |

---

## Choosing a weather source

Set `WEATHER_PROVIDER` in `.env`.

### `open-meteo` (default)

No key, no signup, no card, no per-day quota for non-commercial use. Hourly
resolution, 8-day forecast, air quality. This is the recommended setting.

### `openweathermap`

Set `OPENWEATHER_API_KEY`. Note that One Call 3.0 is a **separate subscription
that requires a credit card on file**, even for its free 1,000 calls/day. If
your key is a plain free-tier key, leave `OPENWEATHER_MODE=auto` and the server
detects the rejection and falls back to the 2.5 endpoints, which work without a
card.

### `home-assistant`

If you already have a weather integration or a personal weather station feeding
Home Assistant, the display can read it directly. See
[HOME_ASSISTANT.md](HOME_ASSISTANT.md).

```bash
WEATHER_PROVIDER=home-assistant
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token
```

---

## Setting the location

**By URL** — easiest, and what you want for a wall display:

```
http://localhost:8080/?Philadelphia
http://localhost:8080/?New York, NY
http://localhost:8080/?90210
```

**By config** — edit `locationSettings` in `webroot/js/config.js` to pin the
main location, the surrounding cities, the ticker cities, and the airports.

**Automatic** — with no URL parameter it geolocates from your IP and fills the
surrounding cities and ticker from the bundled index.

---

## Appearance

`webroot/js/config.js` also controls the look, unchanged from upstream:

```javascript
var apperanceSettings = {
  iconSet: "2010",              // "2007" or "2010"
  affilateName: "Midco",        // the cable affiliate name on screen
  logoURL: "",                  // 879x184px or similar
  corebackgroud: "buildings",   // forest, mountain, city, buildings,
                                // neighborhood, southwest, ocean
  marqueeAd: ["Your ticker text here"],
}
```

`slideLoopSettings` controls the slide rotation, `audioSettings` the music and
narration.

---

## The API

The backend serves the frontend and a JSON API on one port.

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Provider health, cache stats, HA connection and entity list |
| `GET /api/healthz` | Liveness probe |
| `GET /api/weather?lat=&lon=` | Normalized weather bundle |
| `GET /api/radar/series` | Radar and satellite frame lists with tile templates |
| `GET /api/almanac?lat=&lon=` | 30-year normals and records |
| `GET /api/moon` | Next four moon phases |
| `GET /api/cities?state=` | Largest cities in a state |
| `POST /api/cache/clear` | Drop all cached upstream responses |

`/api/wx/*` mirrors the legacy weather.com paths the original frontend calls.
It exists so `newweathermanager.js` and `slides-loop.js` did not have to be
rewritten; you probably want `/api/weather` instead.

---

## How it fits together

```
browser
  │
  ├── webroot/            original IntelliStar frontend, essentially untouched
  │     └── js/weatherscan-api.js   redirects legacy calls to the backend
  │
  └── server/             zero-dependency Node HTTP server
        ├── providers/    open-meteo · openweathermap · home-assistant
        ├── services/     alerts · airports · almanac · radar · geocode · places
        ├── legacy.js     rebuilds the weather.com response shapes
        └── lib/          units · icons · dayparts · astro · cache
```

Two decisions are worth knowing about:

**The API keys stay on the server.** The browser only ever receives the Mapbox
token, which is a public-scope token that has to reach the client for tiles to
load. There is no CORS proxy: Open-Meteo and RainViewer both send
`Access-Control-Allow-Origin: *`, and the one feed that genuinely needs a
server-side hop (the FAA's) gets one at `/api/faa/airport-events`.

**Responses are cached server-side and shared by every viewer.** One fetch
serves all screens, so a display left running for weeks stays well inside every
provider's free allowance regardless of how many browsers point at it.

---

## Configuration reference

Every setting lives in `.env`; see [.env.example](.env.example) for the full
annotated list. The ones you are most likely to touch:

| Variable | Default | Notes |
|---|---|---|
| `MAPBOX_API_KEY` | — | Required for map surfaces |
| `WEATHER_PROVIDER` | `open-meteo` | `open-meteo`, `openweathermap`, `home-assistant` |
| `HTTP_PORT` | `8080` | |
| `CACHE_TTL_MINUTES` | `10` | Weather cache lifetime |
| `ENABLE_*` | `true` | Per-feature switches for radar, satellite, alerts, airports, almanac, pollen, health indices |
| `MAPBOX_STYLE_*` | upstream | Override if you fork the map styles |

---

## Development

```bash
npm run dev      # auto-restart, request logging
npm test         # 51 tests, no dependencies
npm run check    # probe every configured data source
```

Tests hit live upstream APIs. Set `SKIP_NETWORK_TESTS=1` to run only the pure
logic tests offline.

---

## Known limitations

- **The Mapbox styles are not ours.** The defaults point at the upstream
  author's public styles. If that account goes away the maps go blank; fork them
  into your own account and set `MAPBOX_STYLE_*` to be safe.
- **Pollen needs a key in the US.** The free CAMS pollen data Open-Meteo carries
  is Europe-only. Without a Google or Ambee key the slide skips itself.
- **The aches and breathing indices are derived.** They were proprietary Weather
  Channel products with no free equivalent, so they are computed here from the
  meteorology that drives them (pressure swing, cold and damp for aches; air
  quality, pollen and humidity extremes for breathing). They are marked
  `derived: true` in the API.
- **Almanac records are reanalysis, not station data.** The 30-year normals and
  records come from ERA5, a ~30 km gridded reanalysis. Averages are good;
  record highs and lows are smoothed relative to a nearby weather station's
  official record, noticeably so on coastlines and in mountains.
- **Nearby cities and the ticker are US-only** at full quality; the bundled
  index covers the US, and international locations fall back to a slower
  reverse-geocoding probe.

---

## Credits

Built on [Jessecar96/Weatherscan](https://github.com/Jessecar96/Weatherscan) and
the buffbears fork. City data from [GeoNames](https://www.geonames.org/)
(CC BY 4.0). Weather from [Open-Meteo](https://open-meteo.com/),
[NWS](https://www.weather.gov/documentation/services-web-api),
[RainViewer](https://www.rainviewer.com/api.html),
[NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/), and
[aviationweather.gov](https://aviationweather.gov/data/api/).

Weatherscan and The Weather Channel are trademarks of their respective owners.
This is a non-commercial recreation for personal and educational use.
