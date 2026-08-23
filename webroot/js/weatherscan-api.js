/**
 * Weatherscan API shim
 *
 * Redirects the IntelliStar's legacy data calls to this project's own backend.
 * The backend answers the weather.com paths verbatim, so almost every call is a
 * URL rewrite rather than a reimplementation.
 *
 * Two rules matter here:
 *
 *  1. The patch is installed SYNCHRONOUSLY, at parse time. The previous version
 *     of this file waited for DOMContentLoaded plus a 150ms timer, which lost a
 *     race against newweathermanager.js — that file issues its first requests
 *     during script evaluation, long before either event. Every startup request
 *     went to the dead weather.com host.
 *
 *  2. No API keys live here. They stay on the server.
 *
 * Load order requirement: after jQuery, before newweathermanager.js.
 */
(function () {
  'use strict';

  if (typeof window.jQuery === 'undefined') {
    console.error('[weatherscan-api] jQuery must load before this file; data calls will fail.');
    return;
  }

  var $ = window.jQuery;
  var API = '/api';
  var LEGACY = API + '/wx';

  var runtimeConfig = {
    mapboxKey: '',
    mapbox: {},
    features: { radar: true, satellite: true, pollen: true, healthIndices: true, airports: true, alerts: true, almanac: true },
    provider: 'unknown'
  };

  /**
   * Runtime config is fetched synchronously on purpose. radar.js reads
   * map_key at the top of initBasemaps(), and an async fetch would not have
   * resolved in time. It is one small same-origin request during startup.
   */
  function loadRuntimeConfig() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', API + '/config', false);
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        var parsed = JSON.parse(xhr.responseText);
        runtimeConfig = Object.assign(runtimeConfig, parsed);
        if (parsed.mapboxKey) {
          window.map_key = parsed.mapboxKey;
        }
      }
    } catch (err) {
      console.warn('[weatherscan-api] could not load /api/config:', err.message);
    }
    window.weatherscanConfig = runtimeConfig;
    return runtimeConfig;
  }

  loadRuntimeConfig();

  // --- URL rewriting -------------------------------------------------------

  /** Strip the now-meaningless apiKey parameter and repoint at the backend. */
  function rewriteWeatherCom(url) {
    var parsed;
    try {
      parsed = new URL(url, window.location.origin);
    } catch (err) {
      return null;
    }
    parsed.searchParams.delete('apiKey');
    return LEGACY + parsed.pathname + (parsed.search || '');
  }

  var REWRITES = [
    {
      // Any weather.com version or product; the backend mirrors the paths.
      test: function (url) { return url.indexOf('api.weather.com') !== -1; },
      to: rewriteWeatherCom
    },
    {
      // Was a plain-HTTP call from the page: mixed content under HTTPS, and
      // rate-limited per viewer rather than per deployment.
      test: function (url) { return url.indexOf('ip-api.com') !== -1; },
      to: function () { return API + '/ip-location'; }
    },
    {
      // The FAA feed sends no CORS headers; this is the one call that genuinely
      // needed a proxy. Same JSON, served from our own origin.
      test: function (url) { return url.indexOf('nasstatus.faa.gov') !== -1; },
      to: function () { return API + '/faa/airport-events'; }
    }
  ];

  // --- response adapters ---------------------------------------------------
  // A couple of third-party services the app used are gone or unreliable. These
  // fetch a modern endpoint and reshape the answer to what the caller expects.

  var ADAPTERS = [
    {
      // examples.opendatasoft.com's "largest-us-cities" dataset now 404s, which
      // is why the conditions ticker always fell back to its hardcoded list.
      test: function (url) { return url.indexOf('opendatasoft.com') !== -1; },
      handle: function (url) {
        var match = url.match(/refine\.state=([^&]*)/);
        var state = match ? decodeURIComponent(match[1]) : '';
        return fetchJSON(API + '/cities?state=' + encodeURIComponent(state) + '&limit=10')
          .then(function (data) {
            return {
              records: (data.cities || []).map(function (c) {
                return { fields: { city: c.name, state: c.state, coordinates: c.lat + ';' + c.lon } };
              })
            };
          });
      }
    },
    {
      // Moon phases are pure astronomy; the backend computes them locally
      // instead of depending on icalendar37.net staying online.
      test: function (url) { return url.indexOf('icalendar37.net') !== -1; },
      handle: function (url) {
        var monthMatch = url.match(/month=(\d+)/);
        var yearMatch = url.match(/year=(\d+)/);
        var wantMonth = monthMatch ? parseInt(monthMatch[1], 10) : null;
        var wantYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

        return fetchJSON(API + '/moon').then(function (data) {
          // The caller walks an object keyed by day-of-month and looks for
          // entries flagged isPhaseLimit.
          var phase = {};
          var monthName = '';
          (data.phases || []).forEach(function (p) {
            var d = new Date(p.date);
            var month = d.getUTCMonth() + 1;
            var year = d.getUTCFullYear();
            if (wantMonth && (month !== wantMonth || year !== wantYear)) return;
            monthName = MONTHS[month - 1];
            phase[String(d.getUTCDate())] = {
              isPhaseLimit: true,
              phaseName: PHASE_NAMES[p.name] || p.name
            };
          });
          return { monthName: monthName || MONTHS[(wantMonth || 1) - 1], phase: phase };
        });
      }
    }
  ];

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  var PHASE_NAMES = {
    NEW: 'New Moon', FIRST: 'First Quarter', FULL: 'Full Moon', LAST: 'Last Quarter'
  };

  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
      return res.json();
    });
  }

  // --- the patch -----------------------------------------------------------

  var originalGetJSON = $.getJSON;
  var originalAjax = $.ajax;

  /** Reproduce jQuery's (url, data|callback, callback) argument shuffle. */
  function resolveCallback(dataOrCallback, callback) {
    if (typeof dataOrCallback === 'function') return dataOrCallback;
    if (typeof callback === 'function') return callback;
    return null;
  }

  function adapt(url) {
    for (var i = 0; i < ADAPTERS.length; i++) {
      if (ADAPTERS[i].test(url)) return ADAPTERS[i];
    }
    return null;
  }

  function rewrite(url) {
    for (var i = 0; i < REWRITES.length; i++) {
      if (REWRITES[i].test(url)) return REWRITES[i].to(url);
    }
    return null;
  }

  $.getJSON = function (url, dataOrCallback, callback) {
    if (typeof url !== 'string') {
      return originalGetJSON.apply($, arguments);
    }

    var adapter = adapt(url);
    if (adapter) {
      var deferred = $.Deferred();
      var done = resolveCallback(dataOrCallback, callback);
      adapter.handle(url).then(
        function (data) {
          if (done) done(data);
          deferred.resolve(data);
        },
        function (err) {
          console.warn('[weatherscan-api] adapter failed for', url, err.message);
          deferred.reject(err);
        }
      );
      return deferred.promise();
    }

    var target = rewrite(url);
    if (target) {
      // jQuery's JSONP mode is triggered by "callback=?" in the URL. Our own
      // endpoints are same-origin JSON, so that must not carry over.
      var args = [target];
      if (dataOrCallback !== undefined) args.push(dataOrCallback);
      if (callback !== undefined) args.push(callback);
      return originalGetJSON.apply($, args);
    }

    return originalGetJSON.apply($, arguments);
  };

  // Some code paths use $.ajax directly; rewrite those too.
  $.ajax = function (options) {
    if (options && typeof options.url === 'string') {
      var target = rewrite(options.url);
      if (target) {
        options = Object.assign({}, options, { url: target, dataType: 'json', jsonp: false });
      }
    }
    return originalAjax.apply($, arguments);
  };

  // --- public surface ------------------------------------------------------

  window.WeatherscanAPI = {
    config: runtimeConfig,
    base: API,
    legacyBase: LEGACY,
    fetchJSON: fetchJSON,
    radarSeries: function () { return fetchJSON(API + '/radar/series'); },
    status: function () { return fetchJSON(API + '/status'); },
    weather: function (lat, lon) { return fetchJSON(API + '/weather?lat=' + lat + '&lon=' + lon); }
  };

  console.log(
    '[weatherscan-api] ready — backend provider: ' + runtimeConfig.provider +
    ', mapbox key: ' + (runtimeConfig.mapboxKey ? 'set' : 'MISSING')
  );
})();
