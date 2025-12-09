/**
 * Weather Integration Example
 * Demonstrates how to use the OpenWeatherMap and RainViewer adapters
 *
 * @author Claude Code
 * @version 1.0.0
 */

/**
 * Example 1: Get weather data for a single location
 */
async function getWeatherForLocation(lat, lon) {
  if (!weatherAPI) {
    console.error('Weather API not initialized');
    return null;
  }

  try {
    const data = await weatherAPI.getCompleteWeatherData(lat, lon);

    console.log('Current Weather:', {
      temperature: data.current.temperature + '°F',
      conditions: data.current.wxPhraseLong,
      humidity: data.current.relativeHumidity + '%',
      windSpeed: data.current.windSpeed + ' mph',
      windDirection: data.current.windDirectionCardinal
    });

    console.log('Today\'s Forecast:', {
      high: data.daily[0].temperatureMax + '°F',
      low: data.daily[0].temperatureMin + '°F',
      conditions: data.daily[0].narrative
    });

    return data;
  } catch (error) {
    console.error('Error fetching weather:', error);
    return null;
  }
}

/**
 * Example 2: Get weather for multiple locations (batch request)
 */
async function getBatchWeather() {
  if (!weatherAPI) {
    console.error('Weather API not initialized');
    return [];
  }

  const locations = [
    { lat: 40.7128, lon: -74.0060, name: 'New York' },
    { lat: 34.0522, lon: -118.2437, name: 'Los Angeles' },
    { lat: 41.8781, lon: -87.6298, name: 'Chicago' }
  ];

  try {
    const weatherData = await weatherAPI.getBatchWeatherData(locations);

    weatherData.forEach((data, index) => {
      if (data) {
        console.log(`${locations[index].name}:`, {
          temp: data.current.temperature + '°F',
          conditions: data.current.wxPhraseLong
        });
      }
    });

    return weatherData;
  } catch (error) {
    console.error('Error fetching batch weather:', error);
    return [];
  }
}

/**
 * Example 3: Search for locations
 */
async function searchForLocation(query) {
  if (!weatherAPI) {
    console.error('Weather API not initialized');
    return [];
  }

  try {
    const results = await weatherAPI.searchLocation(query, 5);

    console.log(`Search results for "${query}":`);
    results.forEach((loc, index) => {
      console.log(`${index + 1}. ${loc.name}, ${loc.state || ''} ${loc.country}`);
      console.log(`   Coordinates: ${loc.lat}, ${loc.lon}`);
    });

    return results;
  } catch (error) {
    console.error('Error searching location:', error);
    return [];
  }
}

/**
 * Example 4: Get radar animation frames
 */
async function setupRadarAnimation() {
  if (!radarAPI) {
    console.error('Radar API not initialized');
    return null;
  }

  try {
    // Get available timestamps
    const timestamps = await radarAPI.getRadarTimestamps();

    console.log('Radar data available:');
    console.log('- Past frames:', timestamps.past.length);
    console.log('- Forecast frames:', timestamps.nowcast.length);
    console.log('- Current timestamp:', new Date(timestamps.current * 1000));

    // Get animation frames
    const frames = await radarAPI.getRadarAnimationFrames({
      opacity: 0.6,
      color: 3, // The Weather Channel color scheme
      zIndex: 200
    });

    console.log(`Created ${frames.length} radar animation frames`);

    return {
      timestamps: timestamps,
      frames: frames
    };
  } catch (error) {
    console.error('Error setting up radar:', error);
    return null;
  }
}

/**
 * Example 5: Update weatherInfo object (compatible with existing code)
 */
async function updateWeatherInfo(lat, lon, displayName) {
  if (!weatherAPI) {
    console.error('Weather API not initialized');
    return;
  }

  try {
    const data = await weatherAPI.getCompleteWeatherData(lat, lon);

    // Update current conditions sidebar
    if (weatherInfo && weatherInfo.currentCond && weatherInfo.currentCond.sidebar) {
      weatherInfo.currentCond.sidebar = {
        temp: data.current.temperature,
        cond: data.current.wxPhraseLong,
        icon: data.current.iconCode,
        humid: data.current.relativeHumidity,
        dewpt: data.current.temperatureDewPoint,
        pressure: data.current.pressureAltimeter,
        pressureTrend: data.current.pressureTendencyCode,
        wind: data.current.windDirectionCardinal + ' ' + data.current.windSpeed,
        windspeed: data.current.windSpeed,
        gust: data.current.windGust,
        feelslike: data.current.temperatureFeelsLike,
        visibility: data.current.visibility,
        uvindex: data.current.uvIndex,
        ceiling: data.current.cloudCeiling
      };
    }

    // Update 5-day forecast
    if (weatherInfo && weatherInfo.fiveDay && weatherInfo.fiveDay.lowerbar) {
      weatherInfo.fiveDay.lowerbar.day = data.daily.slice(0, 5).map(day => ({
        name: day.dayOfWeek.substring(0, 3),
        cond: day.daypart[0].wxPhraseLong[0],
        icon: day.daypart[0].iconCode[0],
        high: day.temperatureMax,
        low: day.temperatureMin,
        windspeed: day.daypart[0].windSpeed[0]
      }));
    }

    // Update hourly forecast (day-part)
    if (weatherInfo && weatherInfo.dayPart && weatherInfo.dayPart.lowerbar) {
      const hours = [6, 12, 15, 17, 20]; // 6am, 12pm, 3pm, 5pm, 8pm
      weatherInfo.dayPart.lowerbar.hour = hours.map(hour => {
        const hourData = data.hourly.find(h => {
          const dt = new Date(h.validTimeLocal);
          return dt.getHours() === hour;
        });

        if (hourData) {
          return {
            time: hour,
            cond: hourData.wxPhraseLong,
            icon: hourData.iconCode,
            temp: hourData.temperature,
            wind: hourData.windDirectionCardinal + ' ' + hourData.windSpeed
          };
        }
        return null;
      }).filter(h => h !== null);
    }

    // Update alerts/bulletin
    if (weatherInfo && weatherInfo.bulletin) {
      if (data.alerts && data.alerts.length > 0) {
        weatherInfo.bulletin.severeweathermode = true;
        weatherInfo.bulletin.severewarnings = data.alerts.map(alert => ({
          title: alert.eventDescription,
          headline: alert.headlineText,
          description: alert.description,
          severity: alert.severityCode
        }));
      } else {
        weatherInfo.bulletin.severeweathermode = false;
        weatherInfo.bulletin.severewarnings = [];
      }
    }

    // Update air quality
    if (weatherInfo && weatherInfo.airquality && data.airQuality) {
      weatherInfo.airquality = {
        airqualityindex: data.airQuality.airQualityIndex,
        airqualitycat: data.airQuality.airQualityCategory,
        primarypolute: data.airQuality.primaryPollutant
      };
    }

    // Update UV index
    if (weatherInfo && weatherInfo.uvindex) {
      weatherInfo.uvindex.currentuv = data.current.uvIndex;
      weatherInfo.uvindex.currentuvdesc = data.current.uvDescription;

      // Forecast UV from hourly data
      weatherInfo.uvindex.forecast = data.hourly.slice(0, 24).map(hour => ({
        time: new Date(hour.validTimeLocal).getHours(),
        uv: hour.uvIndex
      }));
    }

    console.log('✓ weatherInfo object updated successfully');
  } catch (error) {
    console.error('Error updating weatherInfo:', error);
  }
}

/**
 * Example 6: Initialize weather display on page load
 */
async function initializeWeatherDisplay() {
  // Wait for APIs to be ready
  if (!areAPIsReady()) {
    console.log('Waiting for APIs to initialize...');

    window.addEventListener('apisReady', async function() {
      console.log('APIs ready, initializing weather display...');
      await startWeatherDisplay();
    });
  } else {
    await startWeatherDisplay();
  }
}

async function startWeatherDisplay() {
  // Example: Get weather for a default location
  const defaultLat = 40.7128; // New York
  const defaultLon = -74.0060;

  console.log('Fetching weather data...');

  // Get weather data
  const weather = await getWeatherForLocation(defaultLat, defaultLon);

  if (weather) {
    console.log('Weather data loaded successfully');

    // Setup radar
    const radar = await setupRadarAnimation();

    if (radar) {
      console.log('Radar initialized successfully');
    }

    // Update existing weatherInfo object if it exists
    if (typeof weatherInfo !== 'undefined') {
      await updateWeatherInfo(defaultLat, defaultLon, 'New York');
    }
  }
}

/**
 * Example 7: Periodic weather refresh
 */
function startPeriodicWeatherRefresh(lat, lon, intervalMinutes = 10) {
  // Initial fetch
  updateWeatherInfo(lat, lon);

  // Set up periodic refresh
  const intervalMs = intervalMinutes * 60 * 1000;

  setInterval(() => {
    console.log('Refreshing weather data...');
    updateWeatherInfo(lat, lon);
  }, intervalMs);

  console.log(`Weather refresh scheduled every ${intervalMinutes} minutes`);
}

/**
 * Example 8: Error handling and fallback
 */
async function getWeatherWithFallback(lat, lon) {
  try {
    const data = await weatherAPI.getCompleteWeatherData(lat, lon);
    return data;
  } catch (error) {
    console.error('Primary weather fetch failed:', error);

    // Try to use cached data
    if (weatherAPI.cache && weatherAPI.cache.has(`onecall_${lat}_${lon}`)) {
      console.warn('Using cached weather data');
      const cached = weatherAPI.cache.get(`onecall_${lat}_${lon}`);
      return cached.data;
    }

    // Return placeholder data if all else fails
    console.warn('Returning placeholder data');
    return {
      current: {
        temperature: '--',
        wxPhraseLong: 'Data Unavailable',
        iconCode: 44
      },
      daily: [],
      hourly: [],
      alerts: []
    };
  }
}

// Export functions for use in other scripts
if (typeof window !== 'undefined') {
  window.weatherIntegration = {
    getWeatherForLocation,
    getBatchWeather,
    searchForLocation,
    setupRadarAnimation,
    updateWeatherInfo,
    initializeWeatherDisplay,
    startPeriodicWeatherRefresh,
    getWeatherWithFallback
  };
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWeatherDisplay);
  } else {
    // DOM already loaded
    initializeWeatherDisplay();
  }
}
