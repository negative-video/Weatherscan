/**
 * RainViewer API Adapter
 * Provides radar and satellite tile imagery from RainViewer
 *
 * @author Claude Code
 * @version 1.0.0
 */

class RainViewerAdapter {
  constructor(corsProxyUrl = 'http://localhost:8081/') {
    this.corsProxyUrl = corsProxyUrl;
    this.apiUrl = 'https://api.rainviewer.com/public/weather-maps.json';
    this.tileBaseUrl = 'https://tilecache.rainviewer.com';
    this.cache = {
      maps: null,
      timestamp: 0
    };
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes cache for radar timestamps
  }

  /**
   * Get available weather maps (radar & satellite timestamps)
   */
  async getAvailableMaps() {
    // Check cache
    if (this.cache.maps && (Date.now() - this.cache.timestamp < this.cacheTTL)) {
      return this.cache.maps;
    }

    try {
      const response = await fetch(this.corsProxyUrl + this.apiUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      this.cache.maps = data;
      this.cache.timestamp = Date.now();

      return data;
    } catch (error) {
      console.error('Error fetching RainViewer maps:', error);
      // Return cached data if available
      if (this.cache.maps) {
        console.warn('Using cached RainViewer data due to fetch error');
        return this.cache.maps;
      }
      throw error;
    }
  }

  /**
   * Get radar timestamps
   * Returns array of timestamps for radar animation
   */
  async getRadarTimestamps() {
    const maps = await this.getAvailableMaps();

    // Combine past and nowcast frames
    const past = maps.radar?.past || [];
    const nowcast = maps.radar?.nowcast || [];

    // Extract timestamps
    const pastTimestamps = past.map(frame => frame.time);
    const nowcastTimestamps = nowcast.map(frame => frame.time);

    return {
      past: pastTimestamps,
      nowcast: nowcastTimestamps,
      all: [...pastTimestamps, ...nowcastTimestamps],
      current: pastTimestamps.length > 0 ? pastTimestamps[pastTimestamps.length - 1] : null
    };
  }

  /**
   * Get satellite timestamps
   */
  async getSatelliteTimestamps() {
    const maps = await this.getAvailableMaps();

    const infrared = maps.satellite?.infrared || [];

    return {
      infrared: infrared.map(frame => frame.time),
      current: infrared.length > 0 ? infrared[infrared.length - 1].time : null
    };
  }

  /**
   * Get radar tile URL for a specific timestamp and tile coordinates
   * @param {number} timestamp - Unix timestamp
   * @param {number} z - Zoom level
   * @param {number} x - Tile X coordinate
   * @param {number} y - Tile Y coordinate
   * @param {Object} options - Additional options
   * @returns {string} Tile URL
   */
  getRadarTileUrl(timestamp, z, x, y, options = {}) {
    const size = options.size || 256;
    const color = options.color || 1; // Color scheme: 0-8
    const smooth = options.smooth || 1; // Smooth: 0 or 1
    const snow = options.snow || 1; // Snow detection: 0 or 1

    return `${this.tileBaseUrl}/v2/radar/${timestamp}/${z}/${x}/${y}/${size}/${color}_${smooth}.png`;
  }

  /**
   * Get satellite tile URL
   */
  getSatelliteTileUrl(timestamp, z, x, y, options = {}) {
    const size = options.size || 256;
    const infrared = options.infrared !== false; // Default to infrared

    if (infrared) {
      return `${this.tileBaseUrl}/v2/satellite/${timestamp}/${z}/${x}/${y}/${size}/0_0.png`;
    }

    return null; // Only infrared available in free tier
  }

  /**
   * Get coverage (radar) tile URL for composite view
   */
  getCoverageTileUrl(timestamp, z, x, y, options = {}) {
    const size = options.size || 256;
    return `${this.tileBaseUrl}/v2/coverage/${timestamp}/${z}/${x}/${y}/${size}/0_0.png`;
  }

  /**
   * Transform to weather.com tile server format
   * Provides compatibility with existing radar.js implementation
   */
  async getRadarSeries() {
    const timestamps = await this.getRadarTimestamps();

    // Format similar to weather.com tile series response
    return {
      series: timestamps.all.map(ts => ({
        ts: ts,
        isPast: timestamps.past.includes(ts)
      })),
      current: timestamps.current,
      metadata: {
        source: 'RainViewer',
        updateInterval: 300000 // 5 minutes
      }
    };
  }

  /**
   * Get satellite series
   */
  async getSatelliteSeries() {
    const timestamps = await getSatelliteTimestamps();

    return {
      series: timestamps.infrared.map(ts => ({
        ts: ts
      })),
      current: timestamps.current,
      metadata: {
        source: 'RainViewer',
        type: 'infrared',
        updateInterval: 600000 // 10 minutes
      }
    };
  }

  /**
   * Create Leaflet tile layer for radar
   * Compatible with Leaflet mapping library used in the app
   */
  createRadarTileLayer(timestamp, options = {}) {
    const size = options.size || 256;
    const color = options.color || 1;
    const smooth = options.smooth || 1;

    const tileUrl = `${this.tileBaseUrl}/v2/radar/${timestamp}/{z}/{x}/{y}/${size}/${color}_${smooth}.png`;

    return {
      url: tileUrl,
      options: {
        tileSize: size,
        opacity: options.opacity || 0.6,
        zIndex: options.zIndex || 200,
        maxZoom: 12
      }
    };
  }

  /**
   * Create Leaflet tile layer for satellite
   */
  createSatelliteTileLayer(timestamp, options = {}) {
    const size = options.size || 256;
    const tileUrl = `${this.tileBaseUrl}/v2/satellite/${timestamp}/{z}/{x}/{y}/${size}/0_0.png`;

    return {
      url: tileUrl,
      options: {
        tileSize: size,
        opacity: options.opacity || 0.5,
        zIndex: options.zIndex || 100,
        maxZoom: 5
      }
    };
  }

  /**
   * Get animation frames for radar
   * Returns array of tile layer configs for animation
   */
  async getRadarAnimationFrames(options = {}) {
    const timestamps = await this.getRadarTimestamps();
    const frames = timestamps.all;

    return frames.map(ts => this.createRadarTileLayer(ts, options));
  }

  /**
   * Check if radar data is available for location
   * RainViewer has global coverage but varies by region
   */
  async isRadarAvailable(lat, lon) {
    // RainViewer provides global radar coverage
    // Coverage is better in US, Europe, and parts of Asia
    try {
      const maps = await this.getAvailableMaps();
      return maps.radar && (maps.radar.past.length > 0 || maps.radar.nowcast.length > 0);
    } catch (error) {
      console.error('Error checking radar availability:', error);
      return false;
    }
  }

  /**
   * Get radar color schemes
   */
  getColorSchemes() {
    return {
      0: 'Original',
      1: 'Universal Blue',
      2: 'TITAN',
      3: 'The Weather Channel',
      4: 'Meteored',
      5: 'NEXRAD Level III',
      6: 'RAINBOW @ SELEX-SI',
      7: 'Dark Sky',
      8: 'Black & White'
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.maps = null;
    this.cache.timestamp = 0;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RainViewerAdapter;
}
