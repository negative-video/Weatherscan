# Weatherscan Setup Guide
## Using OpenWeatherMap & RainViewer APIs

This guide will help you set up the Weatherscan IntelliStar Simulator with the new, freely accessible weather APIs.

---

## Quick Start with Docker (Recommended)

### Prerequisites
- Docker and Docker Compose installed
- OpenWeatherMap API key (free tier available)
- Mapbox API key (free tier available)

### Step 1: Get Your API Keys

#### OpenWeatherMap API Key (Required)
1. Go to [OpenWeatherMap](https://openweathermap.org/api)
2. Click "Sign Up" and create a free account
3. Navigate to "API keys" in your account
4. Copy your API key (it may take a few minutes to activate)
5. **Free tier**: 1,000 calls/day, 60 calls/minute

#### Mapbox API Key (Required)
1. Go to [Mapbox](https://www.mapbox.com/)
2. Sign up for a free account
3. Navigate to "Access tokens"
4. Copy your default public token or create a new one
5. **Free tier**: 50,000 map loads/month

### Step 2: Configure Environment

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your API keys:
   ```bash
   OPENWEATHER_API_KEY=your_actual_openweathermap_api_key
   MAPBOX_API_KEY=your_actual_mapbox_api_key
   ```

3. (Optional) Configure other settings in `.env`:
   - `HTTP_PORT` - Web server port (default: 8080)
   - `CORS_PORT` - CORS proxy port (default: 8081)
   - `CACHE_TTL_MINUTES` - Cache duration (default: 10)

### Step 3: Start the Application

```bash
# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

### Step 4: Access the Simulator

Open your browser and navigate to:
```
http://localhost:8080
```

---

## Manual Setup (Without Docker)

### Prerequisites
- Node.js 16+ and npm installed
- OpenWeatherMap API key
- Mapbox API key

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Configure API Keys

Edit `webroot/js/config.js` and set your API keys:

```javascript
var api_key = 'your_openweathermap_api_key';
var map_key = 'your_mapbox_api_key';
```

### Step 3: Start the Application

```bash
# Start both the CORS proxy and web server
npm start

# Or run them separately:
# Terminal 1:
npm run cors

# Terminal 2:
npm run http-server
```

### Step 4: Access the Simulator

Open your browser and navigate to:
```
http://localhost:8080
```

---

## Integration with Existing Code

The new API adapters are designed to work alongside your existing code. Here's how to integrate them:

### Option 1: Use the New Adapters (Recommended)

Include the adapter scripts in your HTML before your other scripts:

```html
<!-- Add these before newweathermanager.js -->
<script src="js/api-adapters/openweathermap-adapter.js"></script>
<script src="js/api-adapters/rainviewer-adapter.js"></script>
<script src="js/api-config.js"></script>
```

Then use the adapters in your code:

```javascript
// Wait for APIs to be ready
window.addEventListener('apisReady', async function() {
  // Get complete weather data
  const weatherData = await weatherAPI.getCompleteWeatherData(lat, lon);

  // Use the data
  console.log('Current temp:', weatherData.current.temperature);
  console.log('Forecast:', weatherData.daily);
  console.log('Alerts:', weatherData.alerts);
});
```

### Option 2: Replace Existing API Calls

Find and replace weather.com API calls with OpenWeatherMap adapter calls:

**Before:**
```javascript
$.getJSON("https://api.weather.com/v3/aggcommon/v3-wx-observations-current?geocodes=" +
  lat + "," + lon + "&apiKey=" + api_key, function(data) {
    // Process data
});
```

**After:**
```javascript
weatherAPI.getCompleteWeatherData(lat, lon).then(data => {
  const current = data.current;
  // Use current.temperature, current.wxPhraseLong, etc.
});
```

---

## API Adapter Reference

### OpenWeatherMapAdapter

#### Initialize
```javascript
const weatherAPI = new OpenWeatherMapAdapter(apiKey, corsProxyUrl);
```

#### Get Complete Weather Data
```javascript
const data = await weatherAPI.getCompleteWeatherData(lat, lon);
// Returns: {current, hourly, daily, alerts, airQuality, timezone, lat, lon}
```

#### Get Batch Weather Data
```javascript
const locations = [
  {lat: 40.7128, lon: -74.0060},
  {lat: 34.0522, lon: -118.2437}
];
const dataArray = await weatherAPI.getBatchWeatherData(locations);
```

#### Search Location
```javascript
const results = await weatherAPI.searchLocation("New York", 5);
// Returns array of locations with {name, lat, lon, country, state}
```

#### Reverse Geocode
```javascript
const location = await weatherAPI.reverseGeocode(40.7128, -74.0060);
```

### RainViewerAdapter

#### Initialize
```javascript
const radarAPI = new RainViewerAdapter(corsProxyUrl);
```

#### Get Radar Timestamps
```javascript
const timestamps = await radarAPI.getRadarTimestamps();
// Returns: {past, nowcast, all, current}
```

#### Get Radar Tile URL
```javascript
const tileUrl = radarAPI.getRadarTileUrl(timestamp, z, x, y);
```

#### Create Leaflet Radar Layer
```javascript
const radarLayer = radarAPI.createRadarTileLayer(timestamp, {
  opacity: 0.6,
  zIndex: 200
});
// Use with Leaflet: L.tileLayer(radarLayer.url, radarLayer.options)
```

#### Get Animation Frames
```javascript
const frames = await radarAPI.getRadarAnimationFrames({
  opacity: 0.6,
  color: 3 // 3 = The Weather Channel color scheme
});
```

---

## Data Format Reference

### Current Conditions
```javascript
{
  temperature: 72,                    // °F
  wxPhraseLong: "Partly Cloudy",     // Description
  iconCode: 30,                       // Weather.com icon code
  relativeHumidity: 65,               // %
  temperatureDewPoint: 58,            // °F
  pressureAltimeter: 29.92,           // inHg
  windDirectionCardinal: "NW",        // Direction
  windSpeed: 10,                      // mph
  windGust: 15,                       // mph
  temperatureFeelsLike: 70,           // °F
  visibility: 10.0,                   // miles
  uvIndex: 5.2,                       // UV index
  uvDescription: "Moderate"           // UV category
}
```

### Hourly Forecast
```javascript
[{
  validTimeLocal: "2025-12-09T15:00:00",
  temperature: 75,
  wxPhraseLong: "Partly Cloudy",
  iconCode: 30,
  precipChance: 20,                   // %
  relativeHumidity: 60,
  windDirectionCardinal: "NW",
  windSpeed: 12
}, ...]
```

### Daily Forecast
```javascript
[{
  dayOfWeek: "Monday",
  temperatureMax: 78,
  temperatureMin: 58,
  narrative: "Partly cloudy with a chance of showers",
  daypart: [{
    daypartName: ["Monday", "Monday night"],
    iconCode: [30, 33],
    precipChance: [30, 20],
    windSpeed: [12, 8]
  }]
}, ...]
```

### Weather Alerts
```javascript
[{
  eventDescription: "Severe Thunderstorm Warning",
  headlineText: "Severe Thunderstorm Warning",
  description: "Full alert text...",
  severityCode: 3,
  issueTimeLocal: "2025-12-09T14:30:00",
  expireTimeLocal: "2025-12-09T18:00:00"
}, ...]
```

---

## Feature Comparison

| Feature | Weather.com | OpenWeatherMap | Coverage |
|---------|-------------|----------------|----------|
| Current conditions | ✅ | ✅ | 100% |
| Hourly forecast (48h) | ✅ | ✅ | 100% |
| Daily forecast | ✅ (5-day) | ✅ (8-day) | 100%+ |
| Weather alerts | ✅ | ✅ | 100% |
| Radar tiles | ✅ | ✅ (RainViewer) | 100% |
| Satellite tiles | ✅ | ✅ (RainViewer) | 100% |
| Air quality | ✅ | ✅ | 100% |
| UV index | ✅ | ✅ | 100% |
| Pollen data | ✅ | ❌ | 0% ⚠️ |
| Health indices | ✅ | ❌ | 0% ⚠️ |

**Note**: Pollen and health indices can be added via:
- [Ambee Pollen API](https://www.getambee.com/) (100 free calls/day)
- [Tomorrow.io](https://www.tomorrow.io/) (1,000 calls/month free)

---

## Troubleshooting

### "API key not configured" warning
- Check that your API key is set in `.env` or `config.js`
- Ensure the API key is active (OpenWeatherMap keys take 10 minutes to activate)

### CORS errors
- Ensure the CORS proxy is running on port 8081
- Check Docker logs: `docker-compose logs -f`
- Verify firewall settings

### No radar data displayed
- Check browser console for errors
- Verify RainViewer service status
- Check that radar tiles are loading (Network tab in DevTools)

### Rate limit exceeded
- Increase `CACHE_TTL_MINUTES` in `.env`
- Reduce number of locations being fetched
- Consider upgrading OpenWeatherMap plan

### Docker won't start
```bash
# Check if ports are already in use
sudo lsof -i :8080
sudo lsof -i :8081

# View Docker logs
docker-compose logs

# Rebuild containers
docker-compose down
docker-compose up --build
```

---

## Performance Optimization

### Caching Strategy

The adapters include built-in caching:

```javascript
// Adjust cache TTL (default: 10 minutes)
weatherAPI.setCacheTTL(15 * 60 * 1000); // 15 minutes

// Clear cache manually
weatherAPI.clearCache();
radarAPI.clearCache();
```

### Batch Requests

Always use batch requests for multiple locations:

```javascript
// ❌ Bad: Multiple individual requests
for (let loc of locations) {
  const data = await weatherAPI.getCompleteWeatherData(loc.lat, loc.lon);
}

// ✅ Good: Single batch request
const allData = await weatherAPI.getBatchWeatherData(locations);
```

### Rate Limit Management

With proper caching (10-minute TTL), you'll use approximately:
- **400-800 API calls/day** (well within free tier of 1,000)
- Refresh interval: 10 minutes
- Continuous 24/7 operation: Safe

---

## Migration Checklist

- [ ] Obtain OpenWeatherMap API key
- [ ] Obtain Mapbox API key
- [ ] Copy `.env.example` to `.env` and configure
- [ ] Build Docker container: `docker-compose up --build`
- [ ] Verify application starts without errors
- [ ] Test location search functionality
- [ ] Verify current conditions display
- [ ] Verify forecast data displays
- [ ] Verify radar displays and animates
- [ ] Verify weather alerts appear (if any active)
- [ ] Check browser console for errors
- [ ] Verify API rate limits not exceeded (check cache logs)

---

## Additional Resources

- [OpenWeatherMap API Documentation](https://openweathermap.org/api/one-call-3)
- [RainViewer API Documentation](https://www.rainviewer.com/api.html)
- [Mapbox Documentation](https://docs.mapbox.com/)
- [Complete Migration Analysis](API_MIGRATION_ANALYSIS.md)

---

## Support

For issues and questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [API Migration Analysis](API_MIGRATION_ANALYSIS.md)
3. Check browser console for detailed error messages
4. Verify API key configuration in `.env`

---

## License

This project uses free-tier APIs from:
- **OpenWeatherMap**: [Pricing](https://openweathermap.org/price)
- **RainViewer**: [Free for personal/educational use](https://www.rainviewer.com/api.html)
- **Mapbox**: [Pricing](https://www.mapbox.com/pricing)

Ensure compliance with each service's terms of use.
