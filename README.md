# Weatherscan

A faithful, working recreation of the Weatherscan cable weather channel — the
original 2000s IntelliStar frontend, driven by a modern backend that needs no
weather API key.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-blue.svg)
![Tests](https://img.shields.io/badge/tests-112-brightgreen.svg)
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
parsers. San Francisco's longitude was missing its minus sign. Per-slide delay
overrides read `slidedelay` from a JSON blob that spells it `slideDelay`, so
every slide silently ran at its tab's delay and the feature had never worked.

**The radar slides.** These are the centrepiece of the loop and every one of
them was visibly wrong in a different way.

*The loop froze partway through.* How many passes to play was worked out as
`slideDelay * 11/60000` — a constant that assumes a pass takes about five and a
half seconds. A pass actually takes one frame interval per frame plus the pause
between passes: 1.8s for RainViewer's thirteen frames. So a ten-second slide
asked for two passes, animated for under four seconds and then sat frozen on the
newest frame for the remaining six; the sixty-second LOCAL RADAR tab asked for
eleven and froze for forty. It is measured from the actual frame count now,
which also means it adapts on its own as that count changes.

*Every slide ended on a stripped-down map.* Fading a map out was a hardcoded run
of `setPaintProperty` calls naming each border, highway, road sign and city
label, with the containers hidden 500 ms later. The list could only ever name
the layers the upstream style happened to have — the radar style's own
`minor cities copy` and coastline were already missing from it, and the
satellite branch never named its land background, water, hillshade, counties,
highways or labels at all. The base rasters underneath have no opacity for such
a list to set in the first place. Everything it missed stayed at full strength
after the fade finished, so the last fifth of a second of every radar and
satellite slide was bare terrain with a few stray labels and no weather on it.
The containers are faded as one surface now, which works on any style, has no
list to keep in sync, and stops flattening the style's own data-driven values
like the Highways zoom ramp.

*Only one frame of the loop ever drew across the whole map.* Stepping the loop
toggled each frame layer's `visibility`, and a source is kept alive only while
some layer using it is not hidden — both libraries decide that from
`visibility` and the zoom range, never from opacity. Hiding a frame therefore
dropped its source, and dropping a source evicts its tiles. Measured mid-loop,
the one visible frame held its two tiles and all twelve others held zero: every
frame was re-fetching from nothing during the 100 ms it was on screen, so
whichever tile arrived first drew and the rest of the map stayed empty. Only the
frame the loop rested on had time to finish, which is why the newest frame
looked complete and the others were missing their left and right edges. The loop
moves `raster-opacity` now. Both libraries return early from the raster draw at
opacity 0, so a frame that is not showing still costs nothing to render, but its
source stays used and its tiles stay resident — every frame is fully loaded
before the loop reaches it.

*The first slide of a session showed the wrong map.* The four map surfaces stack
in one container and have no `display` in the stylesheet, so until each map's
load handler fired they were all visible at once — and the satellite surface,
last in the DOM and a far wider view, painted over the doppler stack.

*The mini radar never refreshed.* The five-minute observation refresh hangs its
rebuild on `minimap.on('load')`, and `load` fires once per map. The first call
worked and every later one registered a handler that could not run, so the mini
radar looped whatever frames were fetched at startup for as long as the display
stayed up, accumulating a dead closure every five minutes. Behind that sat a
second bug the first one was hiding: the rebuild was sequenced on the map's next
`idle`, but the layers are added after an asynchronous fetch, and a map that has
been sitting on screen is already idle. It only held together at startup because
a freshly loaded map stays busy with tiles for a second or two.

*The sim's own city label was missing.* Four layers added from JavaScript asked
for a bare `["Frutiger Bold"]` where the styles ask for
`["Frutiger Bold", "Arial Unicode MS Regular"]`. Mapbox 404s a lone font its
account does not have, but serves a comma-separated stack by skipping the
members it lacks — so the styles rendered and the locator dot and city name did
not.

**The radar legends tell the truth now.** The local Doppler slide claims "Past 3
Hours" and the regional satellite claims "Past 5 Hours"; they were showing two
hours and one and a half. Satellite was only a matter of asking NASA GIBS for
more of its archive — sixteen slots on a twenty-minute step rather than twelve
on a ten-minute one, which spans five hours without making the loop twice as
long. Radar is harder: RainViewer's free listing is capped at two hours with no
parameter for more. Its tilecache keeps serving a frame long after it drops off
that listing, though — a path captured three and a half hours earlier still
returns real imagery at every zoom — so the backend keeps a rolling three-hour
buffer of frames it has seen and serves the union. Frames older than the current
listing are checked before being served, so an expiry shortens the loop instead
of blanking frames.

**The display stays up now.** One failure used to take the whole screen down
until someone reloaded the page. It took two defects and a missing guard.

*A cache that could deadlock on itself.* Reverse geocoding falls back to the
bundled city index when the web geocoder fails, and it used to reach that index
through `nearby()` — which opens by awaiting `reverse()` for the same point.
Every lookup goes through a TTL cache that hands a second caller the promise the
first is still producing, so the producer was handed its own promise and awaited
itself. That never settles, and the entry is only cleared in a `finally` that
therefore never runs: the key stayed poisoned for the life of the process, so
every later lookup for that point hung too, which hung `/v3/location/point` and
`/v3/location/near`, which left the frontend with no city list at all. A single
throttled response from a free key-free endpoint was enough to trigger it, and
rural points reach that endpoint on every lookup. The fallback reads the index
directly now — synchronously, with no cache to re-enter.

*Nothing noticed.* The cache now tracks which keys the current async context is
producing and refuses a producer that re-enters its own key, with the cycle in
the message. Losing one lookup is a bad minute; losing the key is a bad week.
That guard alone is enough — run the old geocoder against it and the cycle
throws where `nearby()` already catches, so the lookup simply succeeds.

*And a slide that threw was the last slide ever shown.* Nothing drives the
rotation but the `setTimeout` each slide schedules at its own end, so a throw
before that line leaves nothing pending. With the city list empty, the first
header substitution read through `weatherInfo.*.weatherLocs[location]` and died.
The loop now skips a slide it cannot draw and carries on, backing off from one
second to fifteen once several fail in a row, so a display running unattended
comes back on its own when a feed recovers. Slides also claim a generation
counter, so a timer left behind by the slide that failed cannot start a second
rotation running alongside the first.

**config.js is the configuration now.** `weatherInfo` was declared twice — once
in `config.js` as `weatherInfoSettings`, which nothing read, and once again in
`newweathermanager.js`, which is the copy that ran. The two had already drifted
in both directions. A `pressureTrend` was added to `config.js` to stop the
sidebar printing "pressure undefined", carrying a comment explaining exactly
that, and it never reached the object on screen. The Travel and International
city lists went the other way: they existed only in `newweathermanager.js`, so
editing them where you were told to edit them did nothing. `config.js` is the
single declaration now and the manager clones it, which is 93 lines shorter and
removes the whole class of bug. Unifying them immediately caught a third
instance: the dead copy spelled LaGuardia "LaGaurdia".

**Two more frontend bugs, found by the new checks.** The pollen slide set `i = 0`
above a `forEach` that never advanced it, so all four bars animated to the *tree*
reading and grass, weed and mold were wrong whenever they differed from it. Four
variables were assigned without being declared — `i` in the pollen slide, `i` in
`resizeText`, `valueii` in the daypart slides, and `pages` in the bulletin slide,
the only one of seven paginating slides that did not declare it — each of which
put a name on `window` for the life of the page.

**Checks that reach the frontend.** `webroot/js` is two thirds of this project
and nothing checked any of it, which is why every defect above was found on
screen rather than in a test. It has its own harness now: the frontend loads
into a VM against a stubbed jQuery, so all 33 slide handlers can be run
headlessly against a `weatherInfo` built from the declared shape — populated,
and blank the way it is before the first fetch lands and after one fails. A
throw there is precisely what freezes the loop, so it is the single most useful
thing to assert. The same pass diffs the globals before and after each slide,
which is how the four leaked names surfaced.

Alongside it, the wiring itself is checked, because it is all string keys spread
across `config.js`, `slides-loop.js` and `index.html` and every mismatch fails
silently on screen. Every configured slide must have a handler; every handler a
container and both header entries; every container and content pane must exist
in `index.html`; every `*placeholder*` must be substituted; every skip test must
compile and return a boolean. No slide property or `dataset` key may be read
under a name nothing writes — a key differing only in case is reported
separately, since that is never a coincidence. That last check is the
`slidedelay` bug's exact signature.

`npm run check` runs the same validator, so the file you are told to edit is
checked before you start rather than minutes later when the loop reaches the
broken slide, and it names the entry rather than just the symptom:

```
 FAIL  config.js    1 problem(s):
       slideLoopSettings.order[1](health).slideOrder[0][0]: no slide named "healthIntroo"
```

**No CDN scripts at boot.** jQuery, the marquee plugin, mapbox-gl and
maplibre-gl were pulled from googleapis, jsdelivr and unpkg on every page load,
so a display that could not reach those hosts did not start. They are vendored
under `webroot/js/vendor/`. What is still remote: Mapbox *tiles*, which is
unavoidable since that is the tile service, and one small font from
`fonts.gstatic.com` used for the pressure-trend arrows.

**It runs smoothly now.** The single largest cost in the whole app turned out to
be the weather icons: both sprite sheets are *animated* PNGs, 4864x125 and
thirty frames, looping forever. A CSS background-image animates for as long as
anything paints it, and the sidebar icon is never off screen — so every page was
costing the browser about **65 MB/s of continuous PNG decode** before drawing a
single pixel of its own. Splitting the sheets into one small file per icon took
that to under 10 MB/s. Details and the rest of the numbers are
[below](#performance).

**Security and packaging.** Removed `cors-anywhere`, which was an
unauthenticated open forward proxy published to the host — and unnecessary,
since Open-Meteo and RainViewer both send CORS headers. Dropped every npm
dependency, clearing 25 advisories including 4 critical. Single port, non-root,
read-only container.

---

## Performance

The upstream simulator was built to look right, and it does. Nobody profiled it,
though, and a display meant to run unattended for weeks is exactly where that
shows up — as slides that feel heavy and transitions that judder.

| | Before | After |
|---|---|---|
| Condition-icon decode, continuous | **65 MB/s** | **1.8 MB/s** per distinct icon on screen; ~9 MB/s on a busy slide |
| Icon bytes fetched at boot | 19.7 MB | 2.6 MB |
| Radar loop, style writes per tick | 26 | 4 |
| Vendor JS, repeat request | 34 ms of CPU, every time | 48 ms once, then 1.5 ms |
| Vendor JS caching | revalidated on every page load | cached for a week |
| Slide-header transition | jQuery tween of `left` — full relayout per frame | compositor-only transform |
| Temperature-bar growth | jQuery tween of `height` — full relayout per frame, 4 bars at once | compositor-only transform |

**The icon sprite sheets are animated PNGs.** `images/icons2010sprite.png` and
its 2007 counterpart are 4864x125 APNGs: thirty frames, 33 ms apart, looping
forever. Every icon on screen is one CSS background pointing at that one file,
so the browser decodes and composites a 2.32 MB frame thirty times a second for
as long as the page is open — and twenty-eight of the thirty frames redraw more
than 90% of the sheet, so there is no cheap dirty-rect path either.

`scripts/split-icon-sprites.js` cuts each sheet into 38 individual 128x125 files
(icons whose frames never change come out as ordinary static PNGs, which the
browser does not animate at all). Only the icons a slide actually shows are
animated: per-frame decode drops from 2.32 MB to 0.061 MB, and a page that used
to pull 19.7 MB of sprite at boot pulls about 2.6 MB. The splitter is
zero-dependency Node that honours the APNG dispose and blend ops, and its output
is pixel-identical to the sheet across all thirty frames — the artwork is
untouched.

The files are generated during `docker build` and are not checked in. For a
local run, `npm run split-icons`. The server detects whether they exist and the
frontend falls back to the sheets if they do not.

**The radar loops did twenty-six style writes to change two layers.** Both loops
walked the whole timestamp list — thirteen frames at the time — on every 100 ms
tick and set `visibility` on every frame of both maps. They now touch only the
frame going out and the frame coming in, and move `raster-opacity` rather than
`visibility` — see [above](#what-changed) for why that second part matters more
than the first. A related bug: each tick called `clearInterval` on
a shared global rather than on its own handle, so two overlapping loops would
orphan a 10 Hz timer driving two WebGL maps for the life of the page — which is
the sort of thing you only notice on day three.

**The slide-name header animated a layout property.** `$scroller.animate({left})`
made jQuery relayout the entire header strip on every frame of a 900 ms tween,
which is why that transition was the choppiest thing in the loop. It is now a
`transform` animation the compositor handles on its own, composited onto the
stylesheet's existing scale so it lands on exactly the same pixel as before.

**The temperature bars relaid out the page sixty times a second.** Every bar
that grows — the daypart slides, the lower bar's hourly tiles — was a jQuery
tween of `height`, four at a time for a second and a half. That is enough
main-thread work to visibly chop the lower ticker, which is a compositor-driven
CSS animation and should be immune to whatever else the page is doing. They now
get their final height up front and scale up from zero, which the compositor
handles on its own. The labels inside are `opacity: 0` until the growth
finishes, so there is nothing visible to distort on the way up.

**Static assets are compressed once.** Every request used to re-run gzip over
the file — 34 ms of CPU for `mapbox-gl.js` alone, on a container capped at a
single core, repeated for every viewer and every reload. Compressed responses
are now held in memory, keyed by path, size and mtime, so an edited file is
never served stale. The pinned vendor bundles under `js/vendor/` and
`js/jplayer/` are cached for a week rather than revalidated on every load;
`js/config.js` still revalidates every time, because it is a file you are told
to edit.

**Two things worth checking on your own display.** The radar and minimap
surfaces stack three WebGL maps each — two of them exist only to draw a drop
shadow, which is the upstream design. If the browser showing this runs *without*
GPU acceleration, common in a VM, that will dominate everything above; check
`chrome://gpu`. And `weatherscan.css` still pulls one small font from
`fonts.gstatic.com` for the pressure-trend arrows, which is the last thing the
frontend fetches off-origin at boot.

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
| **Forked map styles** | Yes | Without them the maps draw terrain and water but no roads, borders or labels — see below. |
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

`MARQUEE_SHOW_SOURCE` prefixes each headline with its feed's name, and that
name is tidied first. Publishers rarely title a feed with just their masthead —
Ars Technica's is literally "Ars Technica - All Content" — so a trailing segment
is dropped when it is boilerplate ("All Content", "Top Stories", "RSS Feed" and
friends) and kept when it means something: "BBC News - World" survives intact.
A title too long to be a name at all, like the NWS alert feeds' "Current
watches, warnings, and advisories for Virginia", is dropped rather than repeated
in front of every item. Set `MARQUEE_SHOW_SOURCE=false` for no prefix at all.

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
narration. `weatherInfoSettings` declares the shape of the weather record the
display fills in, which is where the Travel and International city lists live.

Everything in here is wired to the rest of the frontend by string keys, and a
mismatch fails silently on screen rather than raising anything. `npm run check`
validates the file — slide names, containers, headers, placeholders and skip
tests — and names the exact entry when one does not resolve.

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
| `GET /api/radar/series` | Radar and satellite frames with tile templates — three hours of radar, five of satellite |
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
npm test         # 112 tests, no dependencies
npm run check    # probe every data source, and validate config.js
npm run split-icons  # cut the animated icon sheets into per-icon files
```

The suite covers both halves. `test/legacy.test.js` and `test/api.test.js` check
the response shapes the frontend parses and every path it opens at startup —
against a city the bundled index resolves locally *and* a rural point that has
to fall through to the web geocoder, since testing only the first is how a
deadlock in the second survived to production. Requests carry a time budget, so
an endpoint that hangs fails by name instead of stalling the run.

`test/slides.test.js` runs the frontend. `test/helpers/frontend.js` loads
`webroot/js` into a VM against a stubbed jQuery, which is enough to execute all
33 slide handlers and every structural check described
[above](#what-changed) — no browser, no fixtures to keep in step, and the
`weatherInfo` it runs against is built from the shape `config.js` declares, so
adding a field there reaches the tests without anyone remembering to.

`docker build` runs `split-icons` for you. Run it by hand for a local `npm
start`, or the frontend falls back to the 20 MB animated sprite sheets and the
browser pays for it — see [Performance](#performance).

Tests hit live upstream APIs. `SKIP_NETWORK_TESTS=1` runs only the offline logic
tests.

---

## Known limitations

- **The default Mapbox styles will not render fully.** They point at the
  upstream author's styles, which are public to *read* but pull their vector
  data from that account's private tilesets. Mapbox fails a composite source if
  any member is inaccessible, so with a third-party token you get roads, city
  labels and county lines missing entirely. Fix it once with:

  ```bash
  MAPBOX_WRITE_TOKEN=sk.your_token npm run fork-styles -- --create
  ```

  That copies the four styles into your account, substitutes the private
  tilesets for their public Mapbox Streets equivalents, and prints the
  `MAPBOX_STYLE_*` lines to paste into `.env`. The write token is separate from
  `MAPBOX_API_KEY` and must never go in `.env` — see
  [scripts/fork-mapbox-styles.js](scripts/fork-mapbox-styles.js).
- **Forked styles fall back to Arial until you upload the fonts.** The styles
  ask for `Frutiger Bold` and `Interstate Regular`, which live in the original
  author's Mapbox account, not yours. Every label still renders, because each
  font is paired with `Arial Unicode MS Regular` and Mapbox serves a
  comma-separated stack by skipping members it lacks — it just renders in the
  wrong typeface, silently. Upload `webroot/fonts/FrutigerBold.ttf` through the
  Fonts item inside the Studio style editor (it is not a top-level page) and
  every style picks it up with no code change. Mapbox names an upload from the
  font's internal name table rather than its filename, so of the several
  Frutiger files in that folder only `FrutigerBold.ttf` resolves to the name the
  styles ask for. There is no Interstate Regular in an uploadable `.ttf`/`.otf`
  in this repo — only `.woff`, which Mapbox does not accept.
- **Three hours of radar takes an hour to build up.** RainViewer's free listing
  covers two hours, and its frame paths are opaque hashes rather than anything
  derivable from a timestamp, so the backend's rolling buffer can only hold
  frames it has actually observed. A cold start serves the two hours RainViewer
  lists and reaches the full window after about an hour of polling. Frames
  outliving the listing is observed behaviour, not a documented guarantee, which
  is why they are checked before being served.
- **Pollen needs a key in the US.** The free CAMS pollen data is Europe-only.
- **The aches and breathing indices are derived.** They were proprietary Weather
  Channel products with no free equivalent, so they are computed from the
  meteorology that drives them and marked `derived: true` in the API.
- **Almanac records are reanalysis, not station data.** ERA5 is a ~30 km grid;
  averages are good, but record extremes are smoothed relative to an official
  station record, noticeably so on coastlines and in mountains.
- **Nearby cities and the ticker are US-only** at full quality.
- **The frontend checks stub the DOM rather than emulating one.** That is enough
  to run every slide handler and catch what actually freezes the loop — a read
  landing on undefined — and it keeps the suite dependency-free. It does mean
  nothing there covers layout, styling, or anything that depends on a real
  measurement. The map surfaces are not covered at all.
- **`otherairports` lists LAX twice.** One of the sixteen ticker slots is
  therefore wasted. It is that way in the upstream code; which airport should
  replace it is a matter of taste, so it has been left alone.

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
