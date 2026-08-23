# Weatherscan

A faithful, working recreation of the Weatherscan cable weather channel — the
original 2000s IntelliStar frontend, driven by a modern backend that needs no
weather API key.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-blue.svg)
![Tests](https://img.shields.io/badge/tests-66-brightgreen.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## Standing on someone else's work

The thing that makes this project worth running is not the backend in this
repository. It is the frontend, and that is not ours.

[**Jessecar96**](https://github.com/Jessecar96/Weatherscan) built the original
simulator: the slide engine, the Frutiger and Interstate typography, the sprite
icon sets, the gradients and wipes and curved dividers, the 4:3 scaling, the
music and narration playback. The **buffbears** fork carried it further with
additional slide packages and refinements. Between them they reverse-engineered
the look and cadence of a channel that went off the air in 2022, down to details
like the pressure-trend arrow and the way "Today" disappears from the forecast
after 3pm.

Getting that right is the hard, unglamorous, deeply researched part. This fork
did none of it. **Every pixel you see is theirs.** `webroot/` is substantially
their code, and the changes made to it here were kept deliberately surgical.

What this fork does is make it run again.

---

## What happened to the original

The upstream project depended on the weather.com API. That API stopped issuing
keys, which left the simulator unable to fetch data at all — a working frontend
with nothing behind it. A previous attempt in this repository wrote adapters for
OpenWeatherMap but never connected them: the compatibility bridge patched jQuery
inside a `DOMContentLoaded` handler, while the app fired its first requests
during script evaluation. Measured in a browser, the patch installed at t=330ms
and the last request had already left at t=321ms. Every call raced past it and
went to the dead host.

This fork replaces the data layer entirely.

---

## What changed

**A real backend.** `server/` is a zero-dependency Node HTTP server that serves
the frontend and answers its data calls. API keys stay server-side. Responses
are cached and shared across every viewer, so one fetch serves all screens and a
display left running for weeks stays inside every provider's free allowance.

**No weather API key required.** Open-Meteo is the default source — no signup,
no card, no per-day quota. OpenWeatherMap and Home Assistant are supported as
alternatives.

**Home Assistant as a first-class source.** If you already have a weather
integration or a personal weather station feeding HA, the display reads your own
observations. It routes by distance — your home from HA, everywhere else from a
fallback — and converts from whatever units your instance declares. See
[HOME_ASSISTANT.md](HOME_ASSISTANT.md).

**The dead slides came back.** Nine weather.com endpoints had no replacement at
all. Almanac, the whole Health package, both Airport slides, alert detail text,
and the conditions ticker were blank or throwing. All of them work now, several
from better sources than before:

| Slide | Now sourced from |
|---|---|
| Severe weather bulletins | National Weather Service — its event names are exactly the vocabulary the IntelliStar's warning-priority table was built from, and full bulletin text arrives inline |
| Airport conditions | Live METAR observations, not a gridded forecast interpolated to the runway |
| Almanac normals & records | 30 years of ERA5 reanalysis, computed per location |
| Moon phases | Computed locally (Meeus ch. 49) instead of a third-party API |
| Satellite | NASA GIBS GOES-East — RainViewer's free infrared feed returns zero frames |
| Nearby cities & ticker | A bundled 7,556-city GeoNames index; these are spatial and attribute queries no free name-geocoder can answer |
| Lower ticker | Your own RSS/Atom/JSON feeds (see below) |

**Correctness fixes.** Timestamps now carry the location's UTC offset — the
previous adapter accepted a timezone and returned `toISOString()`, shifting every
hourly column, sunrise and sunset by the viewer's offset. Day and night dayparts
are derived separately from hourly data instead of repeating the daytime
condition after dark. Today's daypart nulls after 3pm the way weather.com did, so
the frontend's index-shifting still works. Tornado maps to its own icon instead
of falling through to "N/A". Radar tiles use the path RainViewer returns rather
than a reconstructed timestamp URL, which serves degraded tiles.

**Frontend bugs fixed in place.** Three unbounded scan loops that ran past the
end of the forecast array and hung the browser tab. An off-by-one plus an
inverted failure guard in the nearby-cities scan. Null-row guards in six slide
parsers. San Francisco's longitude was missing its minus sign.

**Nothing is fetched from a CDN at boot.** jQuery, the marquee plugin,
mapbox-gl and maplibre-gl were pulled from googleapis, jsdelivr and unpkg on
every page load, so a display that could not reach those hosts did not start.
They are vendored under `webroot/js/vendor/`. Only Mapbox *tiles* are remote at
runtime, which is unavoidable — that is the tile service.

**Security and packaging.** Removed `cors-anywhere`, which was an
unauthenticated open forward proxy published to the host — and unnecessary,
since Open-Meteo and RainViewer both send CORS headers. Dropped every npm
dependency, clearing 25 advisories including 4 critical. Single port, non-root,
read-only container.

---

## Quick start

```bash
git clone https://github.com/negative-video/Weatherscan.git
cd Weatherscan
cp .env.example .env
```

Add a Mapbox token to `.env` — free, 50k loads/month, from
[account.mapbox.com](https://account.mapbox.com/). Copy the "Default public
token" (`pk.…`):

```bash
MAPBOX_API_KEY=pk.your_token_here
```

Then:

```bash
docker compose up -d
```

Open <http://localhost:8080>. It geolocates from your IP; to pin a location, use
`http://localhost:8080/?Philadelphia` or `?90210`.

Without Docker — Node 18+, and no `npm install`, because there is nothing to
install:

```bash
npm start
```

Verify every data source before you start:

```bash
npm run check
```

---

## What you need

| | Required? | Why |
|---|---|---|
| **Mapbox token** | Yes | Map tiles for radar, satellite and mini-map. Free tier. |
| Weather API key | **No** | Open-Meteo needs none. |
| Pollen key | Optional | The pollen slide self-skips without one. |
| RSS feed | Optional | The lower ticker falls back to static text. |

The Mapbox token needs only three scopes: `STYLES:TILES`, `STYLES:READ`,
`FONTS:READ`. Leave every secret scope unchecked — ticking one produces an `sk.`
token, which must never be served to a browser.

---

## The lower ticker

The original hardcoded its own Discord invite and a paragraph about Weatherscan
into the scrolling line at the bottom. Those belong to that project, and they
never change. Here the ticker reads real feeds:

```bash
MARQUEE_FEEDS=https://feeds.bbci.co.uk/news/rss.xml,http://rssbridge.lan/?action=display&bridge=...&format=Json
MARQUEE_MAX_ITEMS=12
MARQUEE_TTL_MINUTES=15
MARQUEE_SHOW_SOURCE=true
```

RSS 2.0, Atom and JSON Feed are all parsed, without a dependency. Headlines are
merged across feeds, de-duplicated, sorted newest-first, and stripped of markup
before they reach the page. A self-hosted [RSS-Bridge](https://rss-bridge.org/)
works well — its `format=Json` output is the least fragile to parse.

Only feeds named in `MARQUEE_FEEDS` are ever fetched; there is deliberately no
`?url=` parameter, so this cannot be used to proxy arbitrary hosts.

Set `MARQUEE_MESSAGES` (pipe-separated) for static text instead, used when no
feed is configured or every feed is unreachable.

---

## Setting the location

**By URL** — what you want for a wall display:

```
http://localhost:8080/?Philadelphia
http://localhost:8080/?New York, NY
http://localhost:8080/?90210
```

**By config** — edit `locationSettings` in `webroot/js/config.js` to pin the main
location, surrounding cities, ticker cities and airports.

**Automatic** — with no URL parameter it geolocates from your IP and fills the
surrounding cities and ticker from the bundled index.

---

## Appearance

`webroot/js/config.js` controls the look, unchanged from upstream:

```javascript
var apperanceSettings = {
  iconSet: "2010",              // "2007" or "2010"
  affilateName: "Midco",        // affiliate name shown on screen
  logoURL: "",                  // 879x184px or similar
  corebackgroud: "buildings",   // forest, mountain, city, buildings,
                                // neighborhood, southwest, ocean
}
```

`slideLoopSettings` controls the rotation; `audioSettings` the music and
narration.

---

## Choosing a weather source

Set `WEATHER_PROVIDER` in `.env`.

- **`open-meteo`** (default) — no key, no card, no quota. Hourly resolution,
  8-day forecast, air quality.
- **`openweathermap`** — set `OPENWEATHER_API_KEY`. Note One Call 3.0 is a
  separate subscription requiring a card on file even for its free 1,000
  calls/day; with `OPENWEATHER_MODE=auto` the server detects the rejection and
  falls back to the 2.5 endpoints, which work without one.
- **`home-assistant`** — see [HOME_ASSISTANT.md](HOME_ASSISTANT.md).

---

## The API

The backend serves the frontend and a JSON API on one port.

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Provider health, cache stats, HA connection and entity list |
| `GET /api/healthz` | Liveness probe |
| `GET /api/weather?lat=&lon=` | Normalized weather bundle |
| `GET /api/radar/series` | Radar and satellite frames with tile templates |
| `GET /api/almanac?lat=&lon=` | 30-year normals and records |
| `GET /api/marquee` | Ticker headlines |
| `GET /api/moon` | Next four moon phases |
| `GET /api/cities?state=` | Largest cities in a state |
| `POST /api/cache/clear` | Drop cached upstream responses |

`/api/wx/*` mirrors the legacy weather.com paths the original frontend calls. It
exists so that `newweathermanager.js` and `slides-loop.js` did not have to be
rewritten. Build against `/api/weather` instead.

---

## Architecture

```
browser
  │
  ├── webroot/            the original IntelliStar frontend (Jessecar96 / buffbears)
  │     ├── js/weatherscan-api.js   redirects legacy calls to the backend
  │     └── js/vendor/              jquery, marquee, mapbox-gl, maplibre-gl
  │
  └── server/             zero-dependency Node HTTP server
        ├── providers/    open-meteo · openweathermap · home-assistant
        ├── services/     alerts · airports · almanac · radar · geocode · places · feeds
        ├── legacy.js     rebuilds the weather.com response shapes
        └── lib/          units · icons · dayparts · astro · cache
```

The translation to weather.com's response shapes lives on the server rather than
in the browser. That removes the race that broke the previous attempt, and makes
every shape inspectable with `curl`.

---

## Development

```bash
npm run dev      # auto-restart, request logging
npm test         # 66 tests, no dependencies
npm run check    # probe every configured data source
```

Tests hit live upstream APIs. `SKIP_NETWORK_TESTS=1` runs only the offline logic
tests.

---

## Known limitations

- **The Mapbox styles are not ours.** The defaults point at the upstream
  author's public styles, and those styles reference private tilesets that a
  third-party token cannot read — so roads, city labels and county lines will be
  missing. Fork the styles into your own Mapbox account and set
  `MAPBOX_STYLE_*`.
- **Pollen needs a key in the US.** The free CAMS pollen data is Europe-only.
- **The aches and breathing indices are derived.** They were proprietary Weather
  Channel products with no free equivalent, so they are computed from the
  meteorology that drives them and marked `derived: true` in the API.
- **Almanac records are reanalysis, not station data.** ERA5 is a ~30 km grid;
  averages are good, but record extremes are smoothed relative to an official
  station record, noticeably so on coastlines and in mountains.
- **Nearby cities and the ticker are US-only** at full quality.

---

## Credits

- [**Jessecar96/Weatherscan**](https://github.com/Jessecar96/Weatherscan) — the
  original simulator. The frontend, the design work, and the research behind it.
- **buffbears/Weatherscan** — the fork this one is based on.
- Map styles by **goldbblazez**.
- City data from [GeoNames](https://www.geonames.org/) (CC BY 4.0).
- Weather from [Open-Meteo](https://open-meteo.com/),
  [NWS](https://www.weather.gov/documentation/services-web-api),
  [RainViewer](https://www.rainviewer.com/api.html),
  [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) and
  [aviationweather.gov](https://aviationweather.gov/data/api/).

Weatherscan and The Weather Channel are trademarks of their respective owners.
This is a non-commercial recreation for personal and educational use, not
affiliated with or endorsed by them.
