#!/usr/bin/env node

/**
 * Environment Variable Injection Script
 * Injects environment variables into JavaScript config files for Docker deployments
 *
 * Usage: node scripts/inject-env.js
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG_FILE = path.join(__dirname, '../webroot/js/config.js');
const ENV_FILE = path.join(__dirname, '../.env');

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) {
    console.warn('⚠️  .env file not found, using environment variables');
    return process.env;
  }

  const envContent = fs.readFileSync(ENV_FILE, 'utf-8');
  const envVars = {};

  envContent.split('\n').forEach(line => {
    line = line.trim();

    // Skip comments and empty lines
    if (line.startsWith('#') || line === '') {
      return;
    }

    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim();

    if (key && value) {
      envVars[key.trim()] = value;
    }
  });

  // Merge with process.env (process.env takes precedence)
  return { ...envVars, ...process.env };
}

function injectEnvVars() {
  const env = loadEnvFile();

  // Extract relevant API keys
  const openWeatherKey = env.OPENWEATHER_API_KEY || env.OPENWEATHERMAP_API_KEY || '';
  const mapboxKey = env.MAPBOX_API_KEY || '';
  const ambeeKey = env.AMBEE_API_KEY || '';

  // Feature flags
  const enablePollen = env.ENABLE_POLLEN === 'true';
  const enableHealth = env.ENABLE_HEALTH_INDICES === 'true';
  const enableSatellite = env.ENABLE_SATELLITE !== 'false'; // Default true
  const enableRadar = env.ENABLE_RADAR !== 'false'; // Default true

  // Cache configuration
  const cacheTTL = parseInt(env.CACHE_TTL_MINUTES) || 10;

  // Check if config.js exists
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('❌ config.js not found at:', CONFIG_FILE);
    process.exit(1);
  }

  // Read config.js
  let configContent = fs.readFileSync(CONFIG_FILE, 'utf-8');

  // Update api_key (OpenWeatherMap)
  if (openWeatherKey) {
    configContent = configContent.replace(
      /var api_key = ['"].*?['"];?/,
      `var api_key = '${openWeatherKey}';`
    );
    console.log('✓ Injected OPENWEATHER_API_KEY');
  } else {
    console.warn('⚠️  OPENWEATHER_API_KEY not set');
  }

  // Update map_key (Mapbox)
  if (mapboxKey) {
    configContent = configContent.replace(
      /var map_key = ['"].*?['"];?/,
      `var map_key = '${mapboxKey}';`
    );
    console.log('✓ Injected MAPBOX_API_KEY');
  } else {
    console.warn('⚠️  MAPBOX_API_KEY not set');
  }

  // Write updated config
  fs.writeFileSync(CONFIG_FILE, configContent);

  // Create runtime config file with additional settings
  const runtimeConfig = `
/**
 * Runtime Configuration
 * Auto-generated from environment variables
 * DO NOT EDIT MANUALLY - Changes will be overwritten
 */

// API Configuration
if (typeof apiConfig !== 'undefined') {
  apiConfig.openWeatherMapKey = '${openWeatherKey}';
  apiConfig.mapboxKey = '${mapboxKey}';
  apiConfig.ambeeKey = '${ambeeKey}';

  // Feature flags
  apiConfig.features.pollen = ${enablePollen};
  apiConfig.features.healthIndices = ${enableHealth};
  apiConfig.features.satellite = ${enableSatellite};
  apiConfig.features.radar = ${enableRadar};

  // Cache configuration
  apiConfig.cache.ttlMinutes = ${cacheTTL};
}

console.log('✓ Runtime configuration loaded');
`;

  const runtimeConfigFile = path.join(__dirname, '../webroot/js/runtime-config.js');
  fs.writeFileSync(runtimeConfigFile, runtimeConfig);
  console.log('✓ Created runtime-config.js');

  console.log('\n✅ Environment variables injected successfully');
}

// Run injection
try {
  injectEnvVars();
} catch (error) {
  console.error('❌ Error injecting environment variables:', error);
  process.exit(1);
}
