# Home Assistant integration

If you already have a weather integration in Home Assistant — OpenWeatherMap,
AccuWeather, Met.no, Pirate Weather, a Tempest, an Ecowitt or Davis station,
anything that produces a `weather.*` entity — the display can read it directly.

That data is better than anything this app would fetch on its own: it is your
actual local observation, already configured, already rate-limited correctly,
and it costs you no second API key.

---

## Setup

### 1. Create a long-lived access token

In Home Assistant: click your user name in the sidebar → **Security** tab →
scroll to **Long-lived access tokens** → **Create token**. Copy it; Home
Assistant will not show it again.

### 2. Point Weatherscan at your instance

In `.env`:

```bash
WEATHER_PROVIDER=home-assistant
HA_URL=http://homeassistant.local:8123
HA_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

`HA_URL` should have no trailing slash. A LAN IP works fine
(`http://192.168.1.50:8123`).

### 3. Check the connection

```bash
npm run check
```

You should see something like:

```
  ok   Home Assistant   HA 2026.8.1 at Home — using weather.forecast_home
       available: weather.forecast_home, weather.openweathermap, weather.met_no
  ok   HA home coordinates   38.0293, -78.4767 (radius 40km)
  ok   Fallback (open-meteo) open-meteo — Honolulu 84F
```

The `available:` line lists every weather entity your instance exposes. If the
auto-detected one is not the one you want, name it explicitly:

```bash
HA_WEATHER_ENTITY=weather.tempest_station
```

You can also see this at any time from a running server at
<http://localhost:8080/api/status>.

---

## How it decides what to serve

Home Assistant models exactly one location: your home. The IntelliStar shows
many — surrounding towns, a statewide ticker, travel cities, international
cities.

So the backend routes by distance:

```
request for lat,lon
      │
      ├─ within HA_MATCH_RADIUS_KM of your HA home?  ──▶  Home Assistant
      │
      └─ anywhere else                               ──▶  FALLBACK_PROVIDER
```

The default radius is 40 km, which covers a metro area. Widen it if your nearby
cities should also read from HA, or narrow it if you want HA used only for the
main location:

```bash
HA_MATCH_RADIUS_KM=40
FALLBACK_PROVIDER=open-meteo
```

If Home Assistant is unreachable, every location quietly falls back rather than
blanking the screen.

---

## Partial forecasts

Some integrations expose current conditions but little or no forecast — most
personal weather stations, for instance, report what the sensors see and
nothing more.

When that happens the backend keeps Home Assistant's live observation (which is
the part your station is uniquely good at) and fills the hourly and daily
forecast from `FALLBACK_PROVIDER`. `/api/status` shows the merge in the source
string:

```
home-assistant:weather.tempest_station+open-meteo
```

No configuration is needed; the merge happens automatically when HA returns
fewer than 12 hourly or 4 daily entries.

---

## Units

Home Assistant reports values in whatever the instance is configured for and
declares the unit alongside each one. The backend reads those declarations and
converts — Celsius or Fahrenheit, km/h or m/s or mph or knots, hPa or inHg or
mmHg, km or miles. A metric Home Assistant driving an imperial display works
correctly with no extra setup.

---

## Optional sensor overrides

If you have better air quality, UV or pollen data than the derived values, point
the backend at those entities:

```bash
HA_AQI_ENTITY=sensor.airthings_air_quality
HA_UV_ENTITY=sensor.uv_index
HA_POLLEN_ENTITY=sensor.pollen_count
```

Each is optional; anything left blank uses the normal source.

---

## Self-signed certificates

If your Home Assistant uses HTTPS with a self-signed certificate:

```bash
HA_VERIFY_TLS=false
```

This disables TLS verification **for the whole process**, not just the HA
connection, and the server prints a warning at startup when it is set. Prefer a
valid certificate, or plain HTTP over a trusted LAN, where possible.

---

## Forecast API versions

Home Assistant moved forecasts out of entity attributes into the
`weather.get_forecasts` service in release 2024.4. The backend calls that
service and falls back to the older inline `forecast` attribute if the service
is unavailable, so both old and new cores work.

---

## Troubleshooting

**`HA_TOKEN is required`** — the token is missing or empty in `.env`. In Docker,
confirm the container is actually reading your `.env` (`docker compose config`).

**`No weather.* entity found`** — the instance has no weather integration. Add
one in Settings → Devices & Services, or switch to
`WEATHER_PROVIDER=open-meteo`.

**`Home Assistant entity ... is unavailable`** — the entity exists but is not
reporting. Check it in Developer Tools → States.

**Everything falls back to Open-Meteo** — the requested coordinates are outside
`HA_MATCH_RADIUS_KM`. Check that HA reports the coordinates you expect
(`/api/status` shows them under `homeAssistant.home`), or set `HA_LATITUDE` and
`HA_LONGITUDE` explicitly.

**Connection refused from Docker** — `homeassistant.local` may not resolve
inside the container. Use the LAN IP, or add `extra_hosts` to
`docker-compose.yml`.
