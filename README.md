# Weatherscan IntelliStar Simulator

A web-based recreation of the classic Weatherscan IntelliStar cable TV weather display, powered by **free, publicly accessible APIs**.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](https://nodejs.org/)

---

## About This Fork

The original Weatherscan project relied on the proprietary weather.com API, which requires special access arrangements. **This fork replaces all weather.com API calls with free alternatives**:

| Data Type | Original API | Replacement | Cost |
|-----------|-------------|-------------|------|
| Weather Data | weather.com | OpenWeatherMap | Free (1,000 calls/day) |
| Radar Tiles | weather.com | RainViewer | Free (unlimited) |
| Satellite | weather.com | RainViewer | Free (unlimited) |
| Map Tiles | Mapbox | Mapbox | Free (50,000 loads/month) |

**How it works**: A compatibility bridge (`weather-bridge.js`) intercepts all legacy weather.com API calls and transparently routes them through the new adapters. The original application code works without modification.

---

## Quick Start

### Prerequisites

You'll need **two free API keys** before starting:

1. **OpenWeatherMap API Key** (required)
   - Sign up at https://openweathermap.org/api
   - Free tier: 1,000 API calls/day
   - Note: Keys take ~10 minutes to activate after creation

2. **Mapbox API Key** (required)
   - Sign up at https://www.mapbox.com/
   - Free tier: 50,000 map loads/month
   - Copy your "Default public token" from the dashboard

---

### Option A: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/negative-video/Weatherscan.git
cd Weatherscan

# Create your environment file
cp .env.example .env

# Edit .env and add your API keys
nano .env
```

Add your keys to `.env`:
```bash
OPENWEATHER_API_KEY=your_openweathermap_key_here
MAPBOX_API_KEY=your_mapbox_key_here
```

Start the application:
```bash
docker compose up -d

# View logs to verify startup
docker compose logs -f
```

Open http://localhost:8080 in your browser.

---

### Option B: Local Development (Node.js)

```bash
# Clone and install
git clone https://github.com/negative-video/Weatherscan.git
cd Weatherscan
npm install

# Configure API keys in config.js
nano webroot/js/config.js
```

Set your keys at the top of `config.js`:
```javascript
var api_key = 'your_openweathermap_key_here';
var map_key = 'your_mapbox_key_here';
```

Start the application:
```bash
npm start
```

Open http://localhost:8080 in your browser.

---

## Setting Your Location

### Via URL (Easiest)
```
http://localhost:8080/?Philadelphia
http://localhost:8080/?New York, NY
http://localhost:8080/?90210
http://localhost:8080/?London, UK
```

### Via Configuration
Edit `webroot/js/config.js` and modify the `locationSettings` object:
```javascript
var locationSettings = {
  mainLocation: {
    displayName: "Philadelphia",
    searchQuery: {
      type: "city",
      val: "Philadelphia",
      country: "US",
      state: "PA"
    }
  }
};
```

---

## What You'll See

Once running, Weatherscan displays a continuous loop of weather information:

- **Current Conditions** - Temperature, humidity, wind, pressure, visibility
- **Local Radar** - Animated weather radar from RainViewer
- **Hourly Forecast** - Next 48 hours
- **5-Day Forecast** - Extended outlook
- **Weather Alerts** - Active watches and warnings for your area
- **Nearby Cities** - Conditions in surrounding areas

The display cycles automatically, just like the original Weatherscan channel.

---

## Verifying It Works

Check the browser console (F12) for startup messages:

```
╔══════════════════════════════════════════════════════════════╗
║          Weatherscan API Configuration Loaded                 ║
╚══════════════════════════════════════════════════════════════╝
  Weather API: OpenWeatherMap (One Call 3.0)
  Radar/Satellite: RainViewer (free, no key required)
  CORS Proxy: http://localhost:8081/
✓ OpenWeatherMap adapter initialized
✓ RainViewer adapter initialized
```

If you see configuration errors, double-check your API keys.

---

## Troubleshooting

### "API key not configured" error
- Verify your keys are set in `.env` (Docker) or `config.js` (local)
- OpenWeatherMap keys take ~10 minutes to activate after creation
- Check for typos or extra whitespace in your keys

### No weather data loading
- Open browser DevTools (F12) and check the Console and Network tabs
- Ensure the CORS proxy is running on port 8081
- Test your OpenWeatherMap key directly:
  ```bash
  curl "https://api.openweathermap.org/data/3.0/onecall?lat=40&lon=-75&appid=YOUR_KEY"
  ```

### Radar not displaying
- RainViewer doesn't require an API key - check browser Network tab for tile errors
- Verify your location has radar coverage (RainViewer primarily covers populated areas)

### Docker issues
```bash
# Check if ports are in use
lsof -i :8080
lsof -i :8081

# Rebuild from scratch
docker compose down
docker compose up --build
```

---

## Configuration Options

### Environment Variables (.env)

```bash
# Required
OPENWEATHER_API_KEY=your_key
MAPBOX_API_KEY=your_key

# Server ports (change if conflicts exist)
HTTP_PORT=8080
CORS_PORT=8081

# Caching (increase to reduce API calls)
CACHE_TTL_MINUTES=10

# Optional features
ENABLE_RADAR=true
ENABLE_SATELLITE=true
```

### Customization (config.js)

```javascript
var apperanceSettings = {
  iconSet: "2010",              // Weather icon style: "2007" or "2010"
  affilateName: "Your Cable",   // Cable provider name shown on screen
  corebackgroud: "buildings",   // Background: forest, mountain, city, etc.
  logoURL: "",                  // Custom logo URL (879x184px)
};

var audioSettings = {
  enableMusic: true,            // Background music
  enableNarrations: true,       // Voice announcements
  narrationType: 'female',      // 'female' or 'allen'
};
```

---

## Technical Details

### Architecture

```
Browser → CORS Proxy (8081) → Free APIs
              ↓
         weather-bridge.js (intercepts $.getJSON calls)
              ↓
         OpenWeatherMap / RainViewer adapters
              ↓
         Transform to weather.com format
              ↓
         Existing UI code (unchanged)
```

### API Compatibility

The bridge transforms OpenWeatherMap responses to match the weather.com format:

```javascript
// OpenWeatherMap response
{ temp: 72.5, humidity: 65, weather: [{id: 801}] }

// Transformed to weather.com format
{ temperature: 73, relativeHumidity: 65, iconCode: 30 }
```

This allows the original Weatherscan code to work without modification.

---

## Documentation

- **[SETUP_GUIDE.md](SETUP_GUIDE.md)** - Detailed setup instructions including Docker and Dockge deployment
- **[API_MIGRATION_ANALYSIS.md](API_MIGRATION_ANALYSIS.md)** - Technical details of the API replacement
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Overview of changes made

---

## Performance

With the default 10-minute cache:
- ~400-800 API calls/day (well within free tier limits)
- Weather refreshes every 10 minutes
- Radar refreshes every 5 minutes
- Sustainable for 24/7 operation

---

## Acknowledgments

- Original Weatherscan project by [Jessecar96](https://github.com/Jessecar96)
- Weather data: [OpenWeatherMap](https://openweathermap.org/)
- Radar/Satellite: [RainViewer](https://www.rainviewer.com/)
- Maps: [Mapbox](https://www.mapbox.com/)

---

## License

MIT License - See LICENSE file for details.

---

## Community

- Discord: https://discord.gg/WeatherRanch
- Issues: [GitHub Issues](https://github.com/negative-video/Weatherscan/issues)
