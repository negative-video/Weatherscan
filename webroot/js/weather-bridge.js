/**
 * Weather API Bridge
 * Provides compatibility layer between legacy weather.com API calls and new OpenWeatherMap/RainViewer APIs
 *
 * This bridge intercepts calls and transforms data to maintain compatibility with existing code.
 *
 * @author Claude Code
 * @version 1.0.0
 */

// Weather Bridge singleton
var WeatherBridge = (function() {
  var instance = null;
  var owmAdapter = null;
  var rainViewerAdapter = null;
  var initialized = false;

  /**
   * Initialize the bridge with API adapters
   */
  function init() {
    if (initialized) return true;

    // Wait for apiConfig to be available
    if (typeof apiConfig === 'undefined') {
      console.error('WeatherBridge: apiConfig not found. Make sure api-config.js is loaded first.');
      return false;
    }

    // Get API key from config.js (legacy) or apiConfig
    var apiKey = '';
    if (typeof api_key !== 'undefined' && api_key) {
      apiKey = api_key;
    } else if (apiConfig.openWeatherMapKey) {
      apiKey = apiConfig.openWeatherMapKey;
    }

    if (!apiKey) {
      console.error('WeatherBridge: No OpenWeatherMap API key found. Weather data will not be available.');
      console.error('Please set api_key in config.js or configure OPENWEATHER_API_KEY environment variable.');
      return false;
    }

    try {
      owmAdapter = new OpenWeatherMapAdapter(apiKey, apiConfig.corsProxy.url);
      rainViewerAdapter = new RainViewerAdapter(apiConfig.corsProxy.url);
      initialized = true;
      console.log('WeatherBridge initialized successfully');
      return true;
    } catch (error) {
      console.error('WeatherBridge initialization failed:', error);
      return false;
    }
  }

  /**
   * Search for locations by query string
   * Replaces: api.weather.com/v3/location/search
   */
  async function searchLocation(query) {
    if (!init()) throw new Error('Bridge not initialized');

    const results = await owmAdapter.searchLocation(query, 10);

    // Transform to weather.com format
    return {
      location: {
        latitude: results.map(r => r.lat),
        longitude: results.map(r => r.lon),
        displayName: results.map(r => r.name),
        adminDistrict: results.map(r => r.state || ''),
        country: results.map(r => r.country || 'US'),
        placeId: results.map((r, i) => `owm_${i}_${r.lat}_${r.lon}`)
      }
    };
  }

  /**
   * Get location details by coordinates
   * Replaces: api.weather.com/v3/location/point
   */
  async function getLocationPoint(lat, lon) {
    if (!init()) throw new Error('Bridge not initialized');

    const results = await owmAdapter.reverseGeocode(lat, lon, 1);
    if (!results || results.length === 0) {
      throw new Error('Location not found');
    }

    const loc = results[0];
    return {
      location: {
        latitude: loc.lat,
        longitude: loc.lon,
        displayName: loc.name,
        adminDistrict: loc.state || '',
        country: loc.country || 'US',
        locale: {
          locale3: loc.name,
          locale4: loc.state || ''
        }
      }
    };
  }

  /**
   * Get current weather observations
   * Replaces: api.weather.com/v3/wx/observations/current
   */
  async function getCurrentObservations(lat, lon) {
    if (!init()) throw new Error('Bridge not initialized');

    const data = await owmAdapter.getCompleteWeatherData(lat, lon);
    return data.current;
  }

  /**
   * Get aggregated weather data for multiple locations
   * Replaces: api.weather.com/v3/aggcommon/...
   */
  async function getAggregatedData(geocodes, products) {
    if (!init()) throw new Error('Bridge not initialized');

    // Parse geocodes string into array of {lat, lon}
    const locations = geocodes.split(';').filter(g => g.trim()).map(g => {
      const [lat, lon] = g.split(',').map(parseFloat);
      return { lat, lon };
    });

    // Fetch data for all locations in parallel
    const results = await Promise.all(
      locations.map(async (loc) => {
        try {
          const data = await owmAdapter.getCompleteWeatherData(loc.lat, loc.lon);
          return transformToAggregatedFormat(data, products);
        } catch (error) {
          console.error(`Error fetching data for ${loc.lat},${loc.lon}:`, error);
          return null;
        }
      })
    );

    return results;
  }

  /**
   * Transform OpenWeatherMap data to weather.com aggregated format
   */
  function transformToAggregatedFormat(data, products) {
    const result = {};

    // Current observations
    if (products.includes('v3-wx-observations-current')) {
      result['v3-wx-observations-current'] = {
        temperature: data.current.temperature,
        wxPhraseLong: data.current.wxPhraseLong,
        iconCode: data.current.iconCode,
        relativeHumidity: data.current.relativeHumidity,
        temperatureDewPoint: data.current.temperatureDewPoint,
        pressureAltimeter: parseFloat(data.current.pressureAltimeter),
        pressureTendencyCode: data.current.pressureTendencyCode || 0,
        windDirectionCardinal: data.current.windDirectionCardinal,
        windSpeed: data.current.windSpeed,
        windGust: data.current.windGust,
        temperatureFeelsLike: data.current.temperatureFeelsLike,
        temperatureHeatIndex: data.current.temperatureHeatIndex,
        temperatureWindChill: data.current.temperatureWindChill,
        visibility: parseFloat(data.current.visibility),
        uvDescription: data.current.uvDescription,
        uvIndex: data.current.uvIndex,
        cloudCeiling: data.current.cloudCeiling,
        sunriseTimeLocal: data.current.sunriseTimeLocal,
        sunsetTimeLocal: data.current.sunsetTimeLocal
      };
    }

    // Hourly forecast (2 day)
    if (products.includes('v3-wx-forecast-hourly-2day')) {
      result['v3-wx-forecast-hourly-2day'] = {
        validTimeLocal: data.hourly.map(h => h.validTimeLocal),
        temperature: data.hourly.map(h => h.temperature),
        temperatureFeelsLike: data.hourly.map(h => h.temperatureFeelsLike),
        wxPhraseLong: data.hourly.map(h => h.wxPhraseLong),
        iconCode: data.hourly.map(h => h.iconCode),
        precipChance: data.hourly.map(h => h.precipChance),
        relativeHumidity: data.hourly.map(h => h.relativeHumidity),
        windDirectionCardinal: data.hourly.map(h => h.windDirectionCardinal),
        windSpeed: data.hourly.map(h => h.windSpeed),
        windGust: data.hourly.map(h => h.windGust),
        uvIndex: data.hourly.map(h => h.uvIndex),
        cloudCover: data.hourly.map(h => h.cloudCover)
      };
    }

    // Daily forecast (5 day)
    if (products.includes('v3-wx-forecast-daily-5day')) {
      const dailyData = data.daily.slice(0, 5);
      const dayparts = [];

      // Build daypart arrays (each day has day and night parts)
      dailyData.forEach((day, idx) => {
        const dp = day.daypart[0];
        if (dp) {
          dayparts.push({
            daypartName: dp.daypartName,
            iconCode: dp.iconCode,
            precipChance: dp.precipChance,
            relativeHumidity: dp.relativeHumidity,
            windDirectionCardinal: dp.windDirectionCardinal,
            windSpeed: dp.windSpeed,
            wxPhraseLong: dp.wxPhraseLong,
            narrative: [day.narrative, day.narrative],
            qualifierPhrase: [null, null],
            windPhrase: [null, null]
          });
        }
      });

      result['v3-wx-forecast-daily-5day'] = {
        dayOfWeek: dailyData.map(d => d.dayOfWeek),
        validTimeLocal: dailyData.map(d => d.validTimeLocal),
        temperatureMax: dailyData.map(d => d.temperatureMax),
        temperatureMin: dailyData.map(d => d.temperatureMin),
        narrative: dailyData.map(d => d.narrative),
        daypart: [{
          daypartName: dailyData.flatMap(d => d.daypart[0] ? d.daypart[0].daypartName : [null, null]),
          iconCode: dailyData.flatMap(d => d.daypart[0] ? d.daypart[0].iconCode : [null, null]),
          precipChance: dailyData.flatMap(d => d.daypart[0] ? d.daypart[0].precipChance : [0, 0]),
          relativeHumidity: dailyData.flatMap(d => d.daypart[0] ? d.daypart[0].relativeHumidity : [0, 0]),
          windDirectionCardinal: dailyData.flatMap(d => d.daypart[0] ? d.daypart[0].windDirectionCardinal : ['', '']),
          windSpeed: dailyData.flatMap(d => d.daypart[0] ? d.daypart[0].windSpeed : [0, 0]),
          wxPhraseLong: dailyData.flatMap(d => d.daypart[0] ? d.daypart[0].wxPhraseLong : ['', '']),
          narrative: dailyData.flatMap(d => [d.narrative, d.narrative]),
          qualifierPhrase: dailyData.flatMap(() => [null, null]),
          windPhrase: dailyData.flatMap(() => [null, null])
        }]
      };
    }

    // Alerts
    if (products.includes('v3alertsHeadlines')) {
      if (data.alerts && data.alerts.length > 0) {
        result['v3alertsHeadlines'] = {
          alerts: data.alerts.map(alert => ({
            detailKey: alert.detailKey,
            messageTypeCode: alert.messageTypeCode,
            messageType: 'Alert',
            phenomena: alert.phenomena,
            significance: alert.significance,
            eventDescription: alert.eventDescription,
            headlineText: alert.headlineText,
            source: alert.source,
            issueTimeLocal: alert.issueTimeLocal,
            expireTimeLocal: alert.expireTimeLocal,
            severityCode: alert.severityCode,
            categories: alert.categories.map(c => ({ category: c }))
          }))
        };
      }
    }

    return result;
  }

  /**
   * Get air quality data
   * Replaces: api.weather.com/v3/wx/globalAirQuality
   */
  async function getAirQuality(lat, lon) {
    if (!init()) throw new Error('Bridge not initialized');

    const data = await owmAdapter.getCompleteWeatherData(lat, lon);
    if (!data.airQuality) {
      return null;
    }

    return {
      globalairquality: {
        airQualityIndex: data.airQuality.airQualityIndex,
        airQualityCategory: data.airQuality.airQualityCategory,
        primaryPollutant: data.airQuality.primaryPollutant
      }
    };
  }

  /**
   * Get UV index data
   * Note: OpenWeatherMap provides UV in the OneCall API
   */
  async function getUVIndex(lat, lon) {
    if (!init()) throw new Error('Bridge not initialized');

    const data = await owmAdapter.getCompleteWeatherData(lat, lon);

    return {
      uvIndex: data.current.uvIndex,
      uvDescription: data.current.uvDescription
    };
  }

  /**
   * Get radar tile timestamps
   * Replaces weather.com tile server
   */
  async function getRadarTimestamps() {
    if (!init()) throw new Error('Bridge not initialized');
    return await rainViewerAdapter.getRadarTimestamps();
  }

  /**
   * Get radar tile URL
   */
  function getRadarTileUrl(timestamp, z, x, y, options) {
    if (!rainViewerAdapter) {
      rainViewerAdapter = new RainViewerAdapter(apiConfig.corsProxy.url);
    }
    return rainViewerAdapter.getRadarTileUrl(timestamp, z, x, y, options);
  }

  /**
   * Get satellite tile URL
   */
  function getSatelliteTileUrl(timestamp, z, x, y, options) {
    if (!rainViewerAdapter) {
      rainViewerAdapter = new RainViewerAdapter(apiConfig.corsProxy.url);
    }
    return rainViewerAdapter.getSatelliteTileUrl(timestamp, z, x, y, options);
  }

  /**
   * jQuery-compatible wrapper for getAggregatedData
   * This intercepts $.getJSON calls for weather.com URLs
   */
  function createJQueryProxy() {
    if (typeof $ === 'undefined' || typeof $.getJSON === 'undefined') {
      console.warn('WeatherBridge: jQuery not found, proxy not created');
      return;
    }

    const originalGetJSON = $.getJSON;

    $.getJSON = function(url, dataOrCallback, callback) {
      // Check if this is a weather.com API call
      if (typeof url === 'string' && url.includes('api.weather.com')) {
        // Parse the URL to determine the API call type
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;

        // Handle aggregated API calls
        if (pathname.includes('/v3/aggcommon/')) {
          const geocodesMatch = url.match(/geocodes=([^&]+)/);
          if (geocodesMatch) {
            const geocodes = decodeURIComponent(geocodesMatch[1]);
            const products = pathname.split('/v3/aggcommon/')[1].split('?')[0];

            // Return a jQuery-compatible deferred
            const deferred = $.Deferred();

            getAggregatedData(geocodes, products)
              .then(data => {
                if (typeof dataOrCallback === 'function') {
                  dataOrCallback(data);
                } else if (typeof callback === 'function') {
                  callback(data);
                }
                deferred.resolve(data);
              })
              .catch(error => {
                console.error('WeatherBridge: API call failed', error);
                deferred.reject(error);
              });

            return deferred.promise();
          }
        }

        // Handle location search
        if (pathname.includes('/v3/location/search')) {
          const queryMatch = url.match(/query=([^&]+)/);
          if (queryMatch) {
            const query = decodeURIComponent(queryMatch[1]);
            const deferred = $.Deferred();

            searchLocation(query)
              .then(data => {
                if (typeof dataOrCallback === 'function') {
                  dataOrCallback(data);
                } else if (typeof callback === 'function') {
                  callback(data);
                }
                deferred.resolve(data);
              })
              .catch(error => {
                console.error('WeatherBridge: Location search failed', error);
                deferred.reject(error);
              });

            return deferred.promise();
          }
        }

        // Handle location point (reverse geocoding)
        if (pathname.includes('/v3/location/point')) {
          const geocodeMatch = url.match(/geocode=([^&]+)/);
          if (geocodeMatch) {
            const [lat, lon] = decodeURIComponent(geocodeMatch[1]).split(',').map(parseFloat);
            const deferred = $.Deferred();

            getLocationPoint(lat, lon)
              .then(data => {
                if (typeof dataOrCallback === 'function') {
                  dataOrCallback(data);
                } else if (typeof callback === 'function') {
                  callback(data);
                }
                deferred.resolve(data);
              })
              .catch(error => {
                console.error('WeatherBridge: Location point failed', error);
                deferred.reject(error);
              });

            return deferred.promise();
          }
        }

        // Handle location near (nearby locations)
        if (pathname.includes('/v3/location/near')) {
          const geocodeMatch = url.match(/geocode=([^&]+)/);
          if (geocodeMatch) {
            const [lat, lon] = decodeURIComponent(geocodeMatch[1]).split(',').map(parseFloat);
            const deferred = $.Deferred();

            // Return nearby locations using OpenWeatherMap's reverse geocoding
            owmAdapter.reverseGeocode(lat, lon, 10)
              .then(results => {
                // Transform to weather.com format
                const data = {
                  location: {
                    latitude: results.map(r => r.lat),
                    longitude: results.map(r => r.lon),
                    displayName: results.map(r => r.name),
                    stationId: results.map((r, i) => `owm_station_${i}`),
                    stationName: results.map(r => r.name),
                    distanceMi: results.map((r, i) => i * 5) // Approximate distances
                  }
                };
                if (typeof dataOrCallback === 'function') {
                  dataOrCallback(data);
                } else if (typeof callback === 'function') {
                  callback(data);
                }
                deferred.resolve(data);
              })
              .catch(error => {
                console.error('WeatherBridge: Location near failed', error);
                deferred.reject(error);
              });

            return deferred.promise();
          }
        }

        // Handle air quality
        if (pathname.includes('/v3/wx/globalAirQuality')) {
          const geocodeMatch = url.match(/geocode=([^&]+)/);
          if (geocodeMatch) {
            const [lat, lon] = decodeURIComponent(geocodeMatch[1]).split(',').map(parseFloat);
            const deferred = $.Deferred();

            getAirQuality(lat, lon)
              .then(data => {
                if (typeof dataOrCallback === 'function') {
                  dataOrCallback(data);
                } else if (typeof callback === 'function') {
                  callback(data);
                }
                deferred.resolve(data);
              })
              .catch(error => {
                console.error('WeatherBridge: Air quality failed', error);
                deferred.reject(error);
              });

            return deferred.promise();
          }
        }

        // For unsupported weather.com endpoints, log warning and let it fail gracefully
        console.warn('WeatherBridge: Unsupported weather.com endpoint:', pathname);
        console.warn('This endpoint may need to be implemented or the feature may be unavailable.');

        // Return a rejected deferred to trigger fail handlers
        const deferred = $.Deferred();
        deferred.reject(new Error('Unsupported endpoint: ' + pathname));
        return deferred.promise();
      }

      // For non-weather.com URLs, use original getJSON
      return originalGetJSON.apply($, arguments);
    };

    console.log('WeatherBridge: jQuery $.getJSON proxy installed');
  }

  // Public API
  return {
    init: init,
    searchLocation: searchLocation,
    getLocationPoint: getLocationPoint,
    getCurrentObservations: getCurrentObservations,
    getAggregatedData: getAggregatedData,
    getAirQuality: getAirQuality,
    getUVIndex: getUVIndex,
    getRadarTimestamps: getRadarTimestamps,
    getRadarTileUrl: getRadarTileUrl,
    getSatelliteTileUrl: getSatelliteTileUrl,
    createJQueryProxy: createJQueryProxy,

    // Expose adapters for direct access if needed
    get owmAdapter() { return owmAdapter; },
    get rainViewerAdapter() { return rainViewerAdapter; },
    get isInitialized() { return initialized; }
  };
})();

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    // Give config.js time to load
    setTimeout(function() {
      if (WeatherBridge.init()) {
        WeatherBridge.createJQueryProxy();
        console.log('WeatherBridge: Ready');
        // Dispatch event to notify other scripts
        window.dispatchEvent(new CustomEvent('weatherBridgeReady'));
      }
    }, 150);
  });
}

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WeatherBridge;
}
