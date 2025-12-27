# Weatherscan Setup Guide

A comprehensive guide to setting up the Weatherscan IntelliStar Simulator with free weather APIs.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Getting Your API Keys](#getting-your-api-keys)
3. [Deployment Options](#deployment-options)
   - [Docker Compose](#option-1-docker-compose)
   - [Dockge](#option-2-dockge-docker-stack-manager)
   - [Local Development](#option-3-local-development-nodejs)
4. [Configuration](#configuration)
5. [Setting Your Location](#setting-your-location)
6. [Customization](#customization)
7. [Troubleshooting](#troubleshooting)
8. [Technical Reference](#technical-reference)

---

## Prerequisites

Before starting, ensure you have:

- **Docker & Docker Compose** (for containerized deployment), OR
- **Node.js 16+** (for local development)
- **Git** (to clone the repository)

---

## Getting Your API Keys

You need two free API keys. Get these before proceeding.

### 1. OpenWeatherMap API Key (Required)

OpenWeatherMap provides weather data including current conditions, forecasts, and alerts.

1. Go to https://openweathermap.org/api
2. Click **"Sign Up"** and create a free account
3. Verify your email address
4. Log in and go to **"API keys"** in your account dashboard
5. Copy your default API key, or click **"Generate"** to create a new one
6. **Important**: New API keys take approximately **10 minutes to activate**

**Free tier limits:**
- 1,000 API calls per day
- 60 calls per minute
- One Call API 3.0 included

### 2. Mapbox API Key (Required)

Mapbox provides the map tiles for the radar display.

1. Go to https://www.mapbox.com/
2. Click **"Sign Up"** and create a free account
3. After logging in, you'll see your **"Default public token"** on the dashboard
4. Copy this token - it starts with `pk.`

**Free tier limits:**
- 50,000 map loads per month
- 200,000 tile requests per month

---

## Deployment Options

Choose the deployment method that best fits your environment.

---

### Option 1: Docker Compose

The simplest method for most users.

#### Step 1: Clone the Repository

```bash
git clone https://github.com/negative-video/Weatherscan.git
cd Weatherscan
```

#### Step 2: Create Environment File

```bash
cp .env.example .env
```

#### Step 3: Configure API Keys

Edit the `.env` file with your preferred editor:

```bash
nano .env
```

Set your API keys:

```bash
# Required - Your OpenWeatherMap API key
OPENWEATHER_API_KEY=abc123your_actual_key_here

# Required - Your Mapbox public token
MAPBOX_API_KEY=pk.your_actual_token_here

# Optional - Change ports if needed
HTTP_PORT=8080
CORS_PORT=8081
```

Save and exit (Ctrl+X, then Y, then Enter in nano).

#### Step 4: Start the Application

```bash
# Build and start in detached mode
docker compose up -d

# View the logs
docker compose logs -f
```

You should see output indicating successful initialization:

```
weatherscan  | ╔══════════════════════════════════════════════════════════════╗
weatherscan  | ║          Weatherscan API Configuration Loaded                 ║
weatherscan  | ╚══════════════════════════════════════════════════════════════╝
weatherscan  |   Weather API: OpenWeatherMap (One Call 3.0)
weatherscan  |   Radar/Satellite: RainViewer (free, no key required)
weatherscan  | ✓ OpenWeatherMap adapter initialized
weatherscan  | ✓ RainViewer adapter initialized
```

#### Step 5: Access Weatherscan

Open your browser to:

```
http://localhost:8080
```

Or with a specific location:

```
http://localhost:8080/?New York
```

#### Managing the Container

```bash
# Stop the application
docker compose down

# Restart
docker compose restart

# Rebuild after code changes
docker compose up -d --build

# View logs
docker compose logs -f

# Check container status
docker compose ps
```

---

### Option 2: Dockge (Docker Stack Manager)

[Dockge](https://github.com/louislam/dockge) is a web-based Docker Compose stack manager. If you're using Dockge, follow these steps.

#### Step 1: SSH into Your Server

```bash
ssh user@your-server-ip
```

#### Step 2: Create the Stack Directory

Dockge stores stacks in `/opt/stacks/` by default:

```bash
# Create the weatherscan stack folder
sudo mkdir -p /opt/stacks/weatherscan
cd /opt/stacks/weatherscan

# Clone the repository into this folder
sudo git clone https://github.com/negative-video/Weatherscan.git .

# Set ownership to your user
sudo chown -R $USER:$USER /opt/stacks/weatherscan
```

#### Step 3: Create Environment File

```bash
cp .env.example .env
nano .env
```

Add your API keys:

```bash
OPENWEATHER_API_KEY=your_openweathermap_key_here
MAPBOX_API_KEY=your_mapbox_key_here
HTTP_PORT=8080
CORS_PORT=8081
```

#### Step 4: Create the Compose File

Create `compose.yaml` (Dockge prefers this filename):

```bash
nano compose.yaml
```

Paste this configuration:

```yaml
version: "3.8"

services:
  weatherscan:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: weatherscan
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "8081:8081"
    environment:
      - OPENWEATHER_API_KEY=${OPENWEATHER_API_KEY}
      - MAPBOX_API_KEY=${MAPBOX_API_KEY}
      - NODE_ENV=production
      - CACHE_TTL_MINUTES=10
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/"]
      interval: 30s
      timeout: 10s
      retries: 3
    volumes:
      - weatherscan-cache:/app/.cache
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  weatherscan-cache:
```

Save and exit.

#### Step 5: Deploy via Dockge

**Option A: Using Dockge Web UI**

1. Open your Dockge interface (usually `http://your-server-ip:5001`)
2. The `weatherscan` stack should appear automatically, or click **"+ Compose"**
3. If adding manually, paste the compose.yaml content
4. Add environment variables in the Dockge UI:
   - `OPENWEATHER_API_KEY` = your key
   - `MAPBOX_API_KEY` = your key
5. Click **"Deploy"**

**Option B: Using Command Line**

```bash
cd /opt/stacks/weatherscan
docker compose up -d --build
docker compose logs -f
```

#### Step 6: Access Weatherscan

Open your browser to:

```
http://your-server-ip:8080
```

---

### Option 3: Local Development (Node.js)

For development or running without Docker.

#### Step 1: Clone and Install

```bash
git clone https://github.com/negative-video/Weatherscan.git
cd Weatherscan
npm install
```

#### Step 2: Configure API Keys

Edit the config file:

```bash
nano webroot/js/config.js
```

Set your API keys at the top of the file:

```javascript
var api_key = 'your_openweathermap_key_here';
var map_key = 'your_mapbox_key_here';
```

#### Step 3: Start the Application

```bash
npm start
```

This starts:
- Web server on port 8080
- CORS proxy on port 8081

#### Step 4: Access Weatherscan

Open http://localhost:8080 in your browser.

#### Development Mode

For live reload during development:

```bash
npm run dev
```

---

## Configuration

### Environment Variables

All environment variables can be set in the `.env` file:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENWEATHER_API_KEY` | Yes | - | Your OpenWeatherMap API key |
| `MAPBOX_API_KEY` | Yes | - | Your Mapbox public token |
| `HTTP_PORT` | No | 8080 | Web server port |
| `CORS_PORT` | No | 8081 | CORS proxy port |
| `CACHE_TTL_MINUTES` | No | 10 | How long to cache API responses |
| `ENABLE_RADAR` | No | true | Enable radar display |
| `ENABLE_SATELLITE` | No | true | Enable satellite imagery |
| `NODE_ENV` | No | production | Environment mode |

### Complete .env Example

```bash
# Required API Keys
OPENWEATHER_API_KEY=abcd1234567890abcd1234567890abcd
MAPBOX_API_KEY=pk.eyJ1IjoieW91cnVzZXIiLCJhIjoiY2xhYmNkZWZnIn0.abcdef

# Server Configuration
HTTP_PORT=8080
CORS_PORT=8081
NODE_ENV=production

# Cache Settings
CACHE_TTL_MINUTES=10

# Feature Flags
ENABLE_RADAR=true
ENABLE_SATELLITE=true
```

---

## Setting Your Location

### Method 1: URL Parameter (Easiest)

Add your location as a URL parameter:

```
http://localhost:8080/?Philadelphia
http://localhost:8080/?New York, NY
http://localhost:8080/?90210
http://localhost:8080/?Chicago, IL
http://localhost:8080/?London, UK
http://localhost:8080/?Tokyo, Japan
```

The location search supports:
- City names
- City, State format
- ZIP/postal codes
- City, Country format

### Method 2: Configuration File

Edit `webroot/js/config.js` and modify the `locationSettings` object:

```javascript
var locationSettings = {
  mainLocation: {
    displayName: "Philadelphia",  // Name shown on screen
    searchQuery: {
      type: "city",               // Options: city, postal, geocode
      val: "Philadelphia",        // Search term or coordinates
      country: "US",              // Country code (optional)
      state: "PA",                // State code (optional)
      fuzzy: true                 // Fuzzy matching (optional)
    }
  },
  extraLocations: [
    // Additional cities to show in "Nearby Cities"
    {
      displayName: "New York",
      searchQuery: { type: "city", val: "New York", country: "US", state: "NY" }
    },
    {
      displayName: "Boston",
      searchQuery: { type: "city", val: "Boston", country: "US", state: "MA" }
    }
  ]
};
```

### Method 3: Coordinates

For precise locations, use geocode type:

```javascript
var locationSettings = {
  mainLocation: {
    displayName: "My Home",
    searchQuery: {
      type: "geocode",
      val: "39.9526,-75.1652"  // lat,lon
    }
  }
};
```

---

## Customization

### Appearance Settings

Edit `webroot/js/config.js`:

```javascript
var apperanceSettings = {
  // Weather icon set
  iconSet: "2010",  // Options: "2007" (classic) or "2010" (modern)

  // Cable provider name shown on intro screen
  affilateName: "Your Cable Company",

  // Background theme
  corebackgroud: "buildings",  // Options: forest, mountain, city,
                               // buildings, neighborhood, southwest, ocean

  // Custom logo (optional, 879x184 pixels)
  logoURL: "",

  // Scrolling message at bottom
  marqueeAd: [
    "Welcome to Weatherscan!",
    "Your local weather, 24/7"
  ],

  // Serial number shown on intro (for authenticity)
  serialNum: "1234567890"
};
```

### Audio Settings

```javascript
var audioSettings = {
  enableMusic: true,       // Background music on/off
  shuffle: false,          // Shuffle track order
  randomStart: true,       // Start from random track
  enableNarrations: true,  // Voice announcements on/off
  narrationType: 'female', // Options: 'female' or 'allen'
};
```

### Display Settings

```javascript
var infoSettings = {
  temphigh: 90,        // Temperature considered "hot"
  templow: 32,         // Temperature considered "cold"
  dateFormat: 0,       // 0 = US (MM/DD), 1 = International (DD/MM)
};
```

---

## Troubleshooting

### Common Issues

#### "API key not configured" Error

**Symptoms**: Console shows configuration errors on startup.

**Solutions**:
1. Verify your API key is set in `.env` (Docker) or `config.js` (local)
2. Check for typos or extra whitespace in your key
3. If using OpenWeatherMap, wait 10 minutes for new keys to activate
4. Test your key directly:
   ```bash
   curl "https://api.openweathermap.org/data/3.0/onecall?lat=40&lon=-75&appid=YOUR_KEY&units=imperial"
   ```

#### CORS Errors in Browser Console

**Symptoms**: Network requests fail with CORS errors.

**Solutions**:
1. Ensure the CORS proxy is running (port 8081)
2. Check Docker logs: `docker compose logs -f`
3. Verify port 8081 isn't blocked by a firewall
4. Try restarting: `docker compose restart`

#### No Weather Data Loading

**Symptoms**: Page loads but shows no weather information.

**Solutions**:
1. Open browser DevTools (F12) → Console tab
2. Look for specific error messages
3. Check Network tab for failed requests
4. Verify API key is active and has available calls
5. Check OpenWeatherMap dashboard for usage/errors

#### Radar Not Displaying

**Symptoms**: Weather data loads but radar map is blank.

**Solutions**:
1. RainViewer doesn't need an API key - check for tile loading errors in Network tab
2. Verify your Mapbox key is set correctly (for base map)
3. Check if your location has radar coverage
4. Try clearing browser cache and reloading

#### Docker Won't Start

**Symptoms**: Container fails to start or crashes.

**Solutions**:
```bash
# Check if ports are already in use
sudo lsof -i :8080
sudo lsof -i :8081

# View detailed container logs
docker compose logs

# Rebuild from scratch
docker compose down
docker compose build --no-cache
docker compose up -d
```

#### Container Shows "Unhealthy"

**Symptoms**: `docker compose ps` shows unhealthy status.

**Solutions**:
1. Check logs: `docker compose logs weatherscan`
2. Verify the web server is responding: `curl http://localhost:8080`
3. Ensure no startup errors occurred

### Checking Logs

**Docker**:
```bash
docker compose logs -f          # Follow all logs
docker compose logs weatherscan # Just the main container
docker logs weatherscan         # Alternative syntax
```

**Browser**:
1. Press F12 to open DevTools
2. Go to Console tab for JavaScript errors
3. Go to Network tab for failed API requests

---

## Technical Reference

### How the API Bridge Works

This fork uses a transparent bridge to intercept weather.com API calls and route them to free alternatives:

```
Original Code                    Bridge Layer                    Free APIs
     |                               |                               |
$.getJSON(weather.com/...)  →  weather-bridge.js  →  OpenWeatherMap API
     |                               |                               |
radar.js (weather.com tiles) →  rainViewerConfig  →  RainViewer Tiles
```

The bridge:
1. Intercepts jQuery `$.getJSON` calls to weather.com URLs
2. Parses the request to determine what data is needed
3. Calls the appropriate OpenWeatherMap or RainViewer API
4. Transforms the response to match weather.com's format
5. Returns data to the original code seamlessly

### File Structure

```
Weatherscan/
├── webroot/
│   ├── js/
│   │   ├── api-adapters/
│   │   │   ├── openweathermap-adapter.js  # Weather data adapter
│   │   │   └── rainviewer-adapter.js      # Radar/satellite adapter
│   │   ├── api-config.js      # API configuration & validation
│   │   ├── weather-bridge.js  # jQuery proxy for compatibility
│   │   ├── radar.js           # Radar display (uses RainViewer)
│   │   ├── config.js          # User configuration
│   │   └── newweathermanager.js # Main weather logic
│   └── index.html
├── .env.example               # Environment template
├── docker-compose.yml         # Docker configuration
├── Dockerfile                 # Container build instructions
└── package.json               # Node.js dependencies
```

### API Rate Limits

With the default 10-minute cache:

| API | Free Tier | Estimated Daily Usage | Status |
|-----|-----------|----------------------|--------|
| OpenWeatherMap | 1,000 calls/day | ~400-800 calls | Safe |
| RainViewer | Unlimited | N/A | Safe |
| Mapbox | 50,000 loads/month | ~1,500/month | Safe |

To reduce API usage, increase `CACHE_TTL_MINUTES` in your `.env` file.

### Data Flow

```
1. User loads page
2. api-config.js validates API keys
3. weather-bridge.js installs jQuery proxy
4. newweathermanager.js makes weather.com API calls
5. weather-bridge.js intercepts and routes to OpenWeatherMap
6. OpenWeatherMapAdapter fetches and transforms data
7. radar.js uses RainViewerConfig for radar tiles
8. UI receives data in expected format and renders
```

---

## Getting Help

1. **Check this guide's troubleshooting section**
2. **Review browser console for errors** (F12 → Console)
3. **Check Docker logs** (`docker compose logs -f`)
4. **Search existing issues** on GitHub
5. **Open a new issue** with:
   - Your deployment method (Docker/local)
   - Error messages from console/logs
   - Steps to reproduce

---

## Quick Reference

```bash
# Clone
git clone https://github.com/negative-video/Weatherscan.git
cd Weatherscan

# Configure
cp .env.example .env
nano .env  # Add your API keys

# Start (Docker)
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Access
# http://localhost:8080/?YourCity
```
