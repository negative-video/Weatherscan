/**
 * API Configuration Loader
 * Loads API keys from environment variables or config
 *
 * @author Claude Code
 * @version 1.0.0
 */

// Initialize API configuration
var apiConfig = {
  // OpenWeatherMap API Key
  openWeatherMapKey: '',

  // Mapbox API Key (for map tiles)
  mapboxKey: '',

  // Optional: Ambee Pollen API Key
  ambeeKey: '',

  // Feature flags
  features: {
    pollen: false,
    healthIndices: false,
    satellite: true,
    radar: true
  },

  // Cache configuration
  cache: {
    ttlMinutes: 10,
    radarUpdateInterval: 5,
    weatherRefreshInterval: 10
  },

  // CORS proxy configuration
  corsProxy: {
    enabled: true,
    url: 'http://localhost:8081/'
  }
};

// Legacy compatibility: map old variable names to new config
// This allows existing code to continue working
if (typeof api_key !== 'undefined' && api_key) {
  apiConfig.openWeatherMapKey = api_key;
}
if (typeof map_key !== 'undefined' && map_key) {
  apiConfig.mapboxKey = map_key;
}

// Initialize API adapters
var weatherAPI = null;
var radarAPI = null;

function initializeAPIs() {
  if (!apiConfig.openWeatherMapKey) {
    console.warn('OpenWeatherMap API key not configured. Weather data will not be available.');
    console.warn('Please set api_key in config.js or OPENWEATHER_API_KEY environment variable.');
    return false;
  }

  try {
    // Initialize OpenWeatherMap adapter
    weatherAPI = new OpenWeatherMapAdapter(
      apiConfig.openWeatherMapKey,
      apiConfig.corsProxy.url
    );

    // Set cache TTL
    weatherAPI.setCacheTTL(apiConfig.cache.ttlMinutes * 60 * 1000);

    console.log('✓ OpenWeatherMap adapter initialized');

    // Initialize RainViewer adapter (no API key needed)
    if (apiConfig.features.radar || apiConfig.features.satellite) {
      radarAPI = new RainViewerAdapter(apiConfig.corsProxy.url);
      console.log('✓ RainViewer adapter initialized');
    }

    return true;
  } catch (error) {
    console.error('Error initializing API adapters:', error);
    return false;
  }
}

// Helper function to check if APIs are ready
function areAPIsReady() {
  return weatherAPI !== null && (!apiConfig.features.radar || radarAPI !== null);
}

// Auto-initialize on load if API key is present
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    // Give config.js time to load
    setTimeout(function() {
      // Update apiConfig from config.js if present
      if (typeof api_key !== 'undefined' && api_key) {
        apiConfig.openWeatherMapKey = api_key;
      }
      if (typeof map_key !== 'undefined' && map_key) {
        apiConfig.mapboxKey = map_key;
      }

      if (initializeAPIs()) {
        console.log('✓ All API adapters ready');
        // Dispatch custom event to notify other scripts
        window.dispatchEvent(new CustomEvent('apisReady'));
      } else {
        console.error('✗ Failed to initialize API adapters');
      }
    }, 100);
  });
}

// Export for Node.js environment (if applicable)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    apiConfig,
    initializeAPIs,
    areAPIsReady
  };
}
