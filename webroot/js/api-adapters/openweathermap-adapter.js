/**
 * OpenWeatherMap API Adapter
 * Provides a compatibility layer between OpenWeatherMap API and the weather.com API structure
 *
 * @author Claude Code
 * @version 1.0.0
 */

class OpenWeatherMapAdapter {
  constructor(apiKey, corsProxyUrl = 'http://localhost:8081/') {
    this.apiKey = apiKey;
    this.corsProxyUrl = corsProxyUrl;
    this.baseUrl = 'https://api.openweathermap.org';
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // 10 minutes cache
  }

  /**
   * Get cached data or fetch new data
   */
  async _fetchWithCache(url, cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      console.log('Using cached data for:', cacheKey);
      return cached.data;
    }

    try {
      const response = await fetch(this.corsProxyUrl + url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      this.cache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      console.error('API fetch error:', error);
      // Return cached data even if expired, if available
      if (cached) {
        console.warn('Using expired cache due to fetch error');
        return cached.data;
      }
      throw error;
    }
  }

  /**
   * Get One Call API data (current + forecast)
   */
  async getOneCallData(lat, lon) {
    const url = `${this.baseUrl}/data/3.0/onecall?` +
      `lat=${lat}&lon=${lon}&` +
      `units=imperial&` +
      `exclude=minutely&` +
      `appid=${this.apiKey}`;

    const cacheKey = `onecall_${lat}_${lon}`;
    return await this._fetchWithCache(url, cacheKey);
  }

  /**
   * Get Air Quality data
   */
  async getAirQuality(lat, lon) {
    const url = `${this.baseUrl}/data/2.5/air_pollution?` +
      `lat=${lat}&lon=${lon}&` +
      `appid=${this.apiKey}`;

    const cacheKey = `airquality_${lat}_${lon}`;
    return await this._fetchWithCache(url, cacheKey);
  }

  /**
   * Search for location by name
   */
  async searchLocation(query, limit = 5) {
    const url = `${this.baseUrl}/geo/1.0/direct?` +
      `q=${encodeURIComponent(query)}&` +
      `limit=${limit}&` +
      `appid=${this.apiKey}`;

    const cacheKey = `search_${query}`;
    return await this._fetchWithCache(url, cacheKey);
  }

  /**
   * Reverse geocoding - get location from coordinates
   */
  async reverseGeocode(lat, lon, limit = 1) {
    const url = `${this.baseUrl}/geo/1.0/reverse?` +
      `lat=${lat}&lon=${lon}&` +
      `limit=${limit}&` +
      `appid=${this.apiKey}`;

    const cacheKey = `reverse_${lat}_${lon}`;
    return await this._fetchWithCache(url, cacheKey);
  }

  /**
   * Transform current conditions to weather.com format
   */
  transformCurrentConditions(owmCurrent, timezone = null) {
    return {
      temperature: Math.round(owmCurrent.temp),
      wxPhraseLong: this._capitalizeWeatherPhrase(owmCurrent.weather[0].description),
      iconCode: this.mapOWMIconToWeathercom(owmCurrent.weather[0].id, owmCurrent.weather[0].icon),
      relativeHumidity: owmCurrent.humidity,
      temperatureDewPoint: Math.round(owmCurrent.dew_point),
      pressureAltimeter: (owmCurrent.pressure * 0.02953).toFixed(2), // mb to inHg
      pressureTendencyCode: 0, // Not provided by OWM
      windDirectionCardinal: this._degToCardinal(owmCurrent.wind_deg),
      windSpeed: Math.round(owmCurrent.wind_speed),
      windGust: owmCurrent.wind_gust ? Math.round(owmCurrent.wind_gust) : Math.round(owmCurrent.wind_speed),
      temperatureFeelsLike: Math.round(owmCurrent.feels_like),
      temperatureHeatIndex: Math.round(owmCurrent.feels_like),
      temperatureWindChill: Math.round(owmCurrent.feels_like),
      visibility: owmCurrent.visibility ? (owmCurrent.visibility / 1609.34).toFixed(1) : 10, // meters to miles
      uvDescription: this._getUVDescription(owmCurrent.uvi),
      uvIndex: owmCurrent.uvi,
      cloudCeiling: owmCurrent.clouds,
      sunriseTimeLocal: this._formatLocalTime(owmCurrent.sunrise, timezone),
      sunsetTimeLocal: this._formatLocalTime(owmCurrent.sunset, timezone),
      validTimeLocal: this._formatLocalTime(owmCurrent.dt, timezone)
    };
  }

  /**
   * Transform hourly forecast to weather.com format
   */
  transformHourlyForecast(owmHourly, timezone = null) {
    return owmHourly.map(hour => ({
      validTimeLocal: this._formatLocalTime(hour.dt, timezone),
      temperature: Math.round(hour.temp),
      temperatureFeelsLike: Math.round(hour.feels_like),
      wxPhraseLong: this._capitalizeWeatherPhrase(hour.weather[0].description),
      iconCode: this.mapOWMIconToWeathercom(hour.weather[0].id, hour.weather[0].icon),
      precipChance: Math.round(hour.pop * 100),
      relativeHumidity: hour.humidity,
      windDirectionCardinal: this._degToCardinal(hour.wind_deg),
      windSpeed: Math.round(hour.wind_speed),
      windGust: hour.wind_gust ? Math.round(hour.wind_gust) : Math.round(hour.wind_speed),
      uvIndex: hour.uvi,
      cloudCover: hour.clouds
    }));
  }

  /**
   * Transform daily forecast to weather.com format
   */
  transformDailyForecast(owmDaily, timezone = null) {
    return owmDaily.map((day, index) => {
      const date = new Date(day.dt * 1000);
      return {
        dayOfWeek: this._getDayOfWeek(day.dt),
        validTimeLocal: this._formatLocalTime(day.dt, timezone),
        temperatureMax: Math.round(day.temp.max),
        temperatureMin: Math.round(day.temp.min),
        narrative: day.summary || this._capitalizeWeatherPhrase(day.weather[0].description),
        daypart: [{
          daypartName: [
            index === 0 ? 'Today' : this._getDayOfWeek(day.dt),
            index === 0 ? 'Tonight' : this._getDayOfWeek(day.dt) + ' night'
          ],
          iconCode: [
            this.mapOWMIconToWeathercom(day.weather[0].id, '01d'),
            this.mapOWMIconToWeathercom(day.weather[0].id, '01n')
          ],
          precipChance: [Math.round(day.pop * 100), Math.round(day.pop * 100)],
          relativeHumidity: [day.humidity, day.humidity],
          windDirectionCardinal: [
            this._degToCardinal(day.wind_deg),
            this._degToCardinal(day.wind_deg)
          ],
          windSpeed: [Math.round(day.wind_speed), Math.round(day.wind_speed)],
          wxPhraseLong: [
            this._capitalizeWeatherPhrase(day.weather[0].description),
            this._capitalizeWeatherPhrase(day.weather[0].description)
          ]
        }]
      };
    });
  }

  /**
   * Transform alerts to weather.com format
   */
  transformAlerts(owmAlerts) {
    if (!owmAlerts || owmAlerts.length === 0) {
      return [];
    }

    return owmAlerts.map(alert => ({
      detailKey: `${alert.sender_name}_${alert.start}`,
      messageTypeCode: this._getAlertTypeCode(alert.event),
      phenomena: alert.event,
      significance: 'W', // Warning
      eventDescription: alert.event,
      headlineText: alert.event,
      source: alert.sender_name,
      disclaimer: null,
      issueTimeLocal: this._formatLocalTime(alert.start),
      expireTimeLocal: this._formatLocalTime(alert.end),
      severityCode: this._getAlertSeverity(alert.tags),
      categories: alert.tags || [],
      responseTypes: [],
      urgency: 'Unknown',
      certainty: 'Observed',
      eventOnsetTimeLocal: this._formatLocalTime(alert.start),
      eventEndTimeLocal: this._formatLocalTime(alert.end),
      description: alert.description
    }));
  }

  /**
   * Transform air quality to weather.com format
   */
  transformAirQuality(owmAirQuality) {
    if (!owmAirQuality || !owmAirQuality.list || owmAirQuality.list.length === 0) {
      return null;
    }

    const aqi = owmAirQuality.list[0];
    const components = aqi.components;

    // Determine primary pollutant
    let primaryPollutant = 'PM2.5';
    let maxValue = components.pm2_5;

    if (components.pm10 > maxValue) {
      primaryPollutant = 'PM10';
      maxValue = components.pm10;
    }
    if (components.o3 > maxValue) {
      primaryPollutant = 'Ozone';
    }
    if (components.no2 > maxValue) {
      primaryPollutant = 'NO2';
    }

    return {
      airQualityCategoryIndex: aqi.main.aqi,
      airQualityCategory: this._getAQICategory(aqi.main.aqi),
      airQualityIndex: aqi.main.aqi,
      primaryPollutant: primaryPollutant,
      pollutants: {
        pm25: components.pm2_5,
        pm10: components.pm10,
        o3: components.o3,
        no2: components.no2,
        so2: components.so2,
        co: components.co
      }
    };
  }

  /**
   * Map OpenWeatherMap icon/condition codes to weather.com icon codes
   */
  mapOWMIconToWeathercom(weatherId, iconCode) {
    // Determine if day or night
    const isNight = iconCode && iconCode.endsWith('n');

    // OpenWeatherMap condition ID ranges:
    // 2xx = Thunderstorm, 3xx = Drizzle, 5xx = Rain, 6xx = Snow
    // 7xx = Atmosphere, 800 = Clear, 80x = Clouds

    const iconMap = {
      // Thunderstorms (200-232)
      200: 38, 201: 38, 202: 38, // Thunderstorm with rain
      210: 37, 211: 37, 212: 37, // Thunderstorm
      221: 37, 230: 38, 231: 38, 232: 38,

      // Drizzle (300-321)
      300: 9, 301: 9, 302: 9, 310: 9, 311: 9,
      312: 9, 313: 9, 314: 9, 321: 9,

      // Rain (500-531)
      500: 11, 501: 12, 502: 12, 503: 12, 504: 12,
      511: 10, // Freezing rain
      520: 11, 521: 11, 522: 12, 531: 12,

      // Snow (600-622)
      600: 14, 601: 16, 602: 41, 611: 10, 612: 10, 613: 10,
      615: 5, 616: 5, 620: 14, 621: 14, 622: 16,

      // Atmosphere (701-781)
      701: 20, // Mist
      711: 22, // Smoke
      721: 19, // Haze
      731: 19, // Dust
      741: 20, // Fog
      751: 19, // Sand
      761: 19, // Dust
      762: 19, // Ash
      771: 23, // Squall
      781: 0,  // Tornado

      // Clear (800)
      800: isNight ? 31 : 32,

      // Clouds (801-804)
      801: isNight ? 33 : 30, // Few clouds
      802: isNight ? 27 : 28, // Scattered clouds
      803: isNight ? 27 : 28, // Broken clouds
      804: 26  // Overcast
    };

    return iconMap[weatherId] || 44; // Default to N/A
  }

  /**
   * Helper: Degrees to cardinal direction
   */
  _degToCardinal(deg) {
    if (deg === null || deg === undefined) return 'CALM';

    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                       'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(deg / 22.5) % 16;
    return directions[index];
  }

  /**
   * Helper: Get UV description from index
   */
  _getUVDescription(uvi) {
    if (uvi < 3) return 'Low';
    if (uvi < 6) return 'Moderate';
    if (uvi < 8) return 'High';
    if (uvi < 11) return 'Very High';
    return 'Extreme';
  }

  /**
   * Helper: Get AQI category from index
   */
  _getAQICategory(aqi) {
    // OpenWeatherMap AQI scale: 1-5
    const categories = ['Good', 'Fair', 'Moderate', 'Poor', 'Very Poor'];
    return categories[aqi - 1] || 'Unknown';
  }

  /**
   * Helper: Get day of week from timestamp
   */
  _getDayOfWeek(timestamp) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const date = new Date(timestamp * 1000);
    return days[date.getDay()];
  }

  /**
   * Helper: Format timestamp to local time string
   */
  _formatLocalTime(timestamp, timezone = null) {
    const date = new Date(timestamp * 1000);
    return date.toISOString();
  }

  /**
   * Helper: Capitalize weather phrase
   */
  _capitalizeWeatherPhrase(phrase) {
    return phrase.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Helper: Get alert type code
   */
  _getAlertTypeCode(event) {
    const lowerEvent = event.toLowerCase();
    if (lowerEvent.includes('tornado')) return 'TOR';
    if (lowerEvent.includes('severe thunderstorm')) return 'SVR';
    if (lowerEvent.includes('flood')) return 'FLO';
    if (lowerEvent.includes('winter')) return 'WIN';
    return 'WEA';
  }

  /**
   * Helper: Get alert severity
   */
  _getAlertSeverity(tags) {
    if (!tags) return 3;
    if (tags.some(t => t.toLowerCase().includes('extreme'))) return 4;
    if (tags.some(t => t.toLowerCase().includes('severe'))) return 3;
    return 2;
  }

  /**
   * Get complete weather data for a location (aggregated call)
   */
  async getCompleteWeatherData(lat, lon) {
    try {
      const [oneCallData, airQualityData] = await Promise.all([
        this.getOneCallData(lat, lon),
        this.getAirQuality(lat, lon).catch(e => {
          console.warn('Air quality data unavailable:', e);
          return null;
        })
      ]);

      return {
        current: this.transformCurrentConditions(oneCallData.current, oneCallData.timezone),
        hourly: this.transformHourlyForecast(oneCallData.hourly.slice(0, 48), oneCallData.timezone),
        daily: this.transformDailyForecast(oneCallData.daily.slice(0, 8), oneCallData.timezone),
        alerts: this.transformAlerts(oneCallData.alerts),
        airQuality: airQualityData ? this.transformAirQuality(airQualityData) : null,
        timezone: oneCallData.timezone,
        lat: oneCallData.lat,
        lon: oneCallData.lon
      };
    } catch (error) {
      console.error('Error fetching complete weather data:', error);
      throw error;
    }
  }

  /**
   * Get weather data for multiple locations
   */
  async getBatchWeatherData(locations) {
    const promises = locations.map(loc =>
      this.getCompleteWeatherData(loc.lat, loc.lon)
        .catch(error => {
          console.error(`Error fetching weather for ${loc.lat},${loc.lon}:`, error);
          return null;
        })
    );

    return await Promise.all(promises);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Set cache TTL
   */
  setCacheTTL(milliseconds) {
    this.cacheTTL = milliseconds;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OpenWeatherMapAdapter;
}
