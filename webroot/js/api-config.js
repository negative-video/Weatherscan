/**
 * API Configuration Loader
 * Loads API keys from environment variables or config
 *
 * @author Claude Code
 * @version 1.0.0
 */

// Auto-detect CORS proxy URL based on current host
function detectCorsProxyUrl() {
  if (typeof window !== 'undefined' && window.location) {
    var protocol = window.location.protocol;
    var hostname = window.location.hostname;
    // Default CORS proxy port
    var corsPort = 8081;
    return protocol + '//' + hostname + ':' + corsPort + '/';
  }
  // Fallback for non-browser environments
  return 'http://localhost:8081/';
}

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
    url: detectCorsProxyUrl()
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

// Validation helper functions
function validateConfiguration() {
  var errors = [];
  var warnings = [];

  // Check OpenWeatherMap API key
  if (!apiConfig.openWeatherMapKey || apiConfig.openWeatherMapKey.trim() === '') {
    errors.push('OpenWeatherMap API key is not configured.');
    errors.push('  → Set api_key in config.js');
    errors.push('  → Or set OPENWEATHER_API_KEY environment variable');
    errors.push('  → Get a free key at: https://openweathermap.org/api');
  } else if (apiConfig.openWeatherMapKey.length < 20) {
    warnings.push('OpenWeatherMap API key looks too short. Verify it is correct.');
  }

  // Check Mapbox API key (required for map tiles)
  if (!apiConfig.mapboxKey || apiConfig.mapboxKey.trim() === '') {
    warnings.push('Mapbox API key is not configured. Map tiles may not load.');
    warnings.push('  → Set map_key in config.js');
    warnings.push('  → Get a free key at: https://www.mapbox.com/');
  }

  // Check CORS proxy configuration
  if (apiConfig.corsProxy.enabled && !apiConfig.corsProxy.url) {
    warnings.push('CORS proxy URL is not configured. API calls may fail.');
  }

  return { errors: errors, warnings: warnings };
}

function displayConfigurationStatus(validation) {
  // Display errors
  if (validation.errors.length > 0) {
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║            CONFIGURATION ERRORS - ACTION REQUIRED             ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    validation.errors.forEach(function(err) {
      console.error('  ' + err);
    });
    console.error('');
  }

  // Display warnings
  if (validation.warnings.length > 0) {
    console.warn('╔══════════════════════════════════════════════════════════════╗');
    console.warn('║                    CONFIGURATION WARNINGS                     ║');
    console.warn('╚══════════════════════════════════════════════════════════════╝');
    validation.warnings.forEach(function(warn) {
      console.warn('  ' + warn);
    });
    console.warn('');
  }

  // Display success if no critical errors
  if (validation.errors.length === 0) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║          Weatherscan API Configuration Loaded                 ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('  Weather API: OpenWeatherMap (One Call 3.0)');
    console.log('  Radar/Satellite: RainViewer (free, no key required)');
    console.log('  CORS Proxy: ' + apiConfig.corsProxy.url);
    console.log('');
  }
}

function initializeAPIs() {
  // Validate configuration first
  var validation = validateConfiguration();
  displayConfigurationStatus(validation);

  if (validation.errors.length > 0) {
    console.error('Cannot initialize APIs due to configuration errors.');
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
