var map, basemap, radarmain, sortedtimestamps, sortedtimestampsmini, satradsortedtimestamps, satellitemap, minimap, minibasemap, miniradar, interval, miniinterval;

// The `customMap` branches that used to gate this file carried ~700 lines of
// hardcoded map labels for one specific Jacksonville, FL headend — the previous
// maintainer's own station. They were disabled by default and wrong for any
// other location. Only the generic path, which labels whatever city the sim is
// tuned to, remains. See git history for the original data.

// Radar and satellite frame source.
//
// Frames come from this project's backend (/api/radar/series) rather than being
// assembled in the browser. Two reasons: RainViewer identifies each frame by an
// opaque path that must be read from its API — reconstructing a URL from a bare
// timestamp returns degraded tiles — and the satellite layer now comes from
// NASA GIBS, because RainViewer's free infrared feed has been returning zero
// frames. Keeping both behind one endpoint means this file does not care which
// upstream is in play.
var rainViewerConfig = {
  cachedSeries: null,
  cacheTime: 0,
  cacheTTL: 5 * 60 * 1000,

  // Highest zoom each upstream actually serves. Past these they return a
  // "Zoom Level Not Supported" placeholder image rather than a 404, so the
  // failure shows up as black boxes painted over the map instead of a missing
  // tile. Declaring them on the *source* makes mapbox-gl over-zoom the last
  // real level instead of asking for one that does not exist.
  // These are fallbacks; fetchSeries() replaces them with the values the
  // backend reports for the layers actually in use.
  radarMaxZoom: 7,      // RainViewer tilecache
  satelliteMaxZoom: 7,  // NASA GIBS GoogleMapsCompatible_Level7

  radarUrlByTs: {},
  satelliteUrlByTs: {},
  // Used before any series has loaded, so the map never requests a bad tile.
  blankTile: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',

  fetchSeries: async function () {
    if (this.cachedSeries && Date.now() - this.cacheTime < this.cacheTTL) {
      return this.cachedSeries;
    }
    const res = await fetch('/api/radar/series', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('radar series HTTP ' + res.status);
    const data = await res.json();

    this.radarUrlByTs = {};
    (data.radar.frames || []).forEach((f) => { this.radarUrlByTs[f.ts] = f.url; });
    this.satelliteUrlByTs = {};
    (data.satellite.frames || []).forEach((f) => { this.satelliteUrlByTs[f.ts] = f.url; });

    // The backend knows each upstream's real ceiling — GIBS GeoColor tops out
    // at zoom 7, its clean-IR layer at 6 — so prefer what it reports over the
    // constants above. Switching satellite layers then cannot silently
    // reintroduce the placeholder tiles.
    if (data.radar && typeof data.radar.maxZoom === 'number') {
      this.radarMaxZoom = data.radar.maxZoom;
    }
    if (data.satellite && typeof data.satellite.maxZoom === 'number') {
      this.satelliteMaxZoom = data.satellite.maxZoom;
    }

    this.cachedSeries = data;
    this.cacheTime = Date.now();
    return data;
  },

  getRadarTileUrl: function (timestamp) {
    return this.radarUrlByTs[timestamp] || this.blankTile;
  },

  getSatelliteTileUrl: function (timestamp) {
    return this.satelliteUrlByTs[timestamp] || this.blankTile;
  },

  // Shapes below match what the rest of this file already expects.
  getRadarSeries: async function () {
    const data = await this.fetchSeries();
    const series = (data.radar.frames || []).map((f) => ({ ts: f.ts }));
    return { seriesInfo: { twcRadarMosaic: { series: series }, radar: { series: series } } };
  },

  getSatelliteSeries: async function () {
    const data = await this.fetchSeries();
    const series = (data.satellite.frames || []).map((f) => ({ ts: f.ts }));
    if (!series.length) {
      console.warn('[radar] no satellite frames available; the slide will stay empty');
    }
    return { seriesInfo: { satrad: { series: series } } };
  },

  hasSatellite: function () {
    return !!(this.cachedSeries && this.cachedSeries.satellite.available);
  }
};

// Mapbox style IDs are configurable. The defaults point at the upstream
// author's public styles, which is a dependency on someone else's account
// staying open; MAPBOX_STYLE_* in .env lets a deployment use its own forks.
function mapboxStyle(name, fallback) {
  var cfg = (window.weatherscanConfig && window.weatherscanConfig.mapbox) || {};
  return cfg[name] || fallback;
}

function mapboxBaseTiles() {
  var cfg = (window.weatherscanConfig && window.weatherscanConfig.mapbox) || {};
  var user = cfg.baseStyleUser || 'goldbblazez';
  var style = cfg.baseStyleId || 'cl6jfozbb001h15sdx9ze69f7';
  return 'https://api.mapbox.com/styles/v1/' + user + '/' + style +
    '/tiles/{z}/{x}/{y}?access_token=' + map_key;
}

function initBasemaps() {
	//main map
	mapboxgl.accessToken = map_key
	map = new mapboxgl.Map({
		container: 'radar-3', // container ID
		style: mapboxStyle('radarStyle', 'mapbox://styles/goldbblazez/cl10wz58y000q14ptdm3vkmxe'), // style URL
		center: [maincitycoords.lon, maincitycoords.lat], // starting position [lng, lat]
		zoom: 7.7, // starting zoom
		sprite: "mapbox://sprites/goldbblazez/cl10wz58y000q14ptdm3vkmxe/f2jmfbiv3wccsb4w7xb1prfmc"
	});
	//render a whole separate map just to do dropshadow
	basemap = new maplibregl.Map({
		container: 'radar-1', // container ID // style URL
		style: {
				'version': 8,
				'sources': {
				'raster-tiles': {
				'type': 'raster',
					'tiles': [
						mapboxBaseTiles()
					],
					'tileSize': 512
					},
				},
				'layers': [
					{
					'id': 'basemap',
					'type': 'raster',
					'source': 'raster-tiles',
					'layout': { 'visibility': 'visible'},
					'minzoom': 0,
					'maxzoom': 22
					}
				]
		},
		center: [maincitycoords.lon, maincitycoords.lat], // starting position [lng, lat]
		zoom: 7.7, // starting zoom
	});
	radarmain = new maplibregl.Map({
		container: 'radar-2', // container ID // style URL
		style: {
				'version': 8,
				'sources': {
				'raster-tiles': {
				'type': 'raster',
				'tiles': [
				// RainViewer radar tiles - timestamp will be updated dynamically
				rainViewerConfig.getRadarTileUrl(Math.floor(Date.now() / 1000))
				],
				'tileSize': 256,
				}
			},
			'layers': [
				{
				'id': 'simple-tiles',
				'type': 'raster',
				'source': 'raster-tiles',
				'layout': { 'visibility': 'visible'},
				'minzoom': 0,
				'maxzoom': 22
				}
			]
		},
		center: [maincitycoords.lon, maincitycoords.lat], // starting position [lng, lat]
		zoom: 7.7 // starting zoom
	});
	//mainmap
	map.on('load', () => {
		//a bunch of code just to add the sim's city onto the map.

			//load in sim's city
			map.addSource('maincitypoint', {
				'type': 'geojson',
				'data': {
					'type': 'FeatureCollection',
					'features': [
						{
							'type': 'Feature',
							'geometry': {
								'type': 'Point',
								'coordinates': [maincitycoords.lon, maincitycoords.lat]
							},
						}
					]
				}
			});
			map.addLayer({
					'id': 'maincityshadow',
					'type': 'symbol',
					'source': 'maincitypoint', // reference the data source
					'layout': {
						'text-field': maincitycoords.displayname,
						// Same stack the styles use. Mapbox serves a comma-separated
						// stack by skipping fonts the account does not have, but a bare
						// "Frutiger Bold" 404s outright and the label never draws.
						'text-font': ["Frutiger Bold", "Arial Unicode MS Regular"],
						'text-size': 28,
						'text-line-height': 1.2,
						'text-max-width': 10,
						'text-variable-anchor': ['top', 'top-left', 'top-right', 'bottom', 'bottom-left', 'bottom-right', 'left', 'right'],
						'text-radial-offset': 0.45,
						'text-justify': 'auto',
						'icon-image': 'locatordot2', // reference the image
						'icon-size': 1.45
				},
				'paint': {
					'text-translate': [0,11],
					'text-color': "#171717",
					'icon-opacity': 0,
				}
			});
			map.addLayer({
					'id': 'maincity',
					'type': 'symbol',
					'source': 'maincitypoint', // reference the data source
					'layout': {
						'text-field': maincitycoords.displayname,
						// Same stack the styles use. Mapbox serves a comma-separated
						// stack by skipping fonts the account does not have, but a bare
						// "Frutiger Bold" 404s outright and the label never draws.
						'text-font': ["Frutiger Bold", "Arial Unicode MS Regular"],
						'text-size': 28,
						'text-line-height': 1.2,
						'text-max-width': 10,
						'text-variable-anchor': ['top', 'top-left', 'top-right', 'bottom', 'bottom-left', 'bottom-right', 'left', 'right'],
						'text-radial-offset': 0.45,
						'text-justify': 'auto',
						'icon-image': 'locatordot2', // reference the image
						'icon-size': 1.45
				},
				'paint': {
					'text-translate': [0,8],
					'text-color': "#d4d4d4"
				}
			});
		//default the map to fadeout
		fadeMap('radar-1', false, 7.7)
	});

	//satellitemap
	satellitemap = new mapboxgl.Map({
		container: 'satrad-1', // container ID // style URL
		style: mapboxStyle('satelliteStyle', 'mapbox://styles/goldbblazez/cl188bbm3000f14rmh9mcqbp8'),
		center: [maincitycoords.lon, maincitycoords.lat], // starting position [lng, lat]
		zoom: 4.7, // starting zoom
		projection: {
			name: 'lambertConformalConic',
			center: [-98.8833, 30],
			parallels: [30, 30]
		}
	});
	satellitemap.on('load', () => {
		satellitemap.addSource('basemaptiles', {
			'type': 'raster',
				'tiles': [
					mapboxBaseTiles()
				],
				'tileSize': 512
			});
		satellitemap.addLayer({
				'id': 'basemp',
				'type': 'raster',
				'source': 'basemaptiles', // reference the data source
			}, 'counties blur');
			fadeMap('satrad-1', false)
		});

	//minimap
	minimap = new mapboxgl.Map({
		container: 'minimap-3', // container ID
		style: mapboxStyle('miniStyle', 'mapbox://styles/goldbblazez/cl11ctjbl000014s02fijkmyc'), // style URL
		center: [maincitycoords.lon, maincitycoords.lat], // starting position [lng, lat]
		zoom: 6, // starting zoom
		sprite: "mapbox://styles/goldbblazez/cl11ctjbl000014s02fijkmyc/f2jmfbiv3wccsb4w7xb1prfmc"
	});
	minibasemap = new maplibregl.Map({
		container: 'minimap-1', // container ID // style URL
		style: {
				'version': 8,
				'sources': {
				'raster-tiles': {
				'type': 'raster',
					'tiles': [
						mapboxBaseTiles()
					],
					'tileSize': 512,
					'minzoom': 6,
					'maxzoom': 8,
					},
				},
				'layers': [
					{
					'id': 'basemap',
					'type': 'raster',
					'source': 'raster-tiles',
					'layout': { 'visibility': 'visible'},
					'minzoom': 0,
					'maxzoom': 22
					}
				]
		},
		center: [maincitycoords.lon, maincitycoords.lat], // starting position [lng, lat]
		zoom: 6, // starting zoom
	});
	//render a whole separate map just to do dropshadow
	miniradar = new maplibregl.Map({
		container: 'minimap-2', // container ID // style URL
		style: {
				'version': 8,
				'sources': {
				'raster-tiles': {
				'type': 'raster',
				'tiles': [
				// RainViewer radar tiles - timestamp will be updated dynamically
				rainViewerConfig.getRadarTileUrl(Math.floor(Date.now() / 1000))
				],
				'tileSize': 256,
				}
			},
			'layers': [
				{
				'id': 'simple-tiles',
				'type': 'raster',
				'source': 'raster-tiles',
				'layout': { 'visibility': 'visible'},
				'minzoom': 0,
				'maxzoom': 22
				}
			]
		},
		center: [maincitycoords.lon, maincitycoords.lat], // starting position [lng, lat]
		zoom: 6, // starting zoom
	});
	minimap.on('load', () => {
		//a bunch of code just to add the sim's city onto the map.
			minimap.addSource('maincitypoint', {
				'type': 'geojson',
				'data': {
					'type': 'FeatureCollection',
					'features': [
						{
							'type': 'Feature',
							'geometry': {
								'type': 'Point',
								'coordinates': [maincitycoords.lon, maincitycoords.lat]
							},
						}
					]
				}
			});
			minimap.addLayer({
					'id': 'maincityshadow',
					'type': 'symbol',
					'source': 'maincitypoint', // reference the data source
					'layout': {
						'text-field': maincitycoords.displayname,
						// Same stack the styles use. Mapbox serves a comma-separated
						// stack by skipping fonts the account does not have, but a bare
						// "Frutiger Bold" 404s outright and the label never draws.
						'text-font': ["Frutiger Bold", "Arial Unicode MS Regular"],
						'text-size': 28,
						'text-line-height': 1.2,
						'text-max-width': 10,
						'text-variable-anchor': ['top', 'top-left', 'top-right', 'bottom', 'bottom-left', 'bottom-right', 'left', 'right'],
						'text-radial-offset': 0.45,
						'text-justify': 'auto',
						'icon-image': 'locatordot2', // reference the image
						'icon-size': 1.45
				},
				'paint': {
					'text-translate': [0,11],
					'text-color': "#171717",
					'icon-opacity': 0,
				}
			});
			minimap.addLayer({
					'id': 'maincity',
					'type': 'symbol',
					'source': 'maincitypoint', // reference the data source
					'layout': {
						'text-field': maincitycoords.displayname,
						// Same stack the styles use. Mapbox serves a comma-separated
						// stack by skipping fonts the account does not have, but a bare
						// "Frutiger Bold" 404s outright and the label never draws.
						'text-font': ["Frutiger Bold", "Arial Unicode MS Regular"],
						'text-size': 28,
						'text-line-height': 1.2,
						'text-max-width': 10,
						'text-variable-anchor': ['top', 'top-left', 'top-right', 'bottom', 'bottom-left', 'bottom-right', 'left', 'right'],
						'text-radial-offset': 0.45,
						'text-justify': 'auto',
						'icon-image': 'locatordot2', // reference the image
						'icon-size': 1.45
				},
				'paint': {
					'text-translate': [0,8],
					'text-color': "#d4d4d4"
				}
			});
	});

}
// How long a map surface takes to fade in or out. Matches the 500ms the slides
// already use for their legends, and the delay they already waited before
// advancing, so the map and the furniture around it move together.
var MAP_FADE_MS = 500;

function recenterMap(divID, lat, lon, zoom) {
	if (divID == 'radar-1') {
		radarmain.jumpTo({
			center: [lon, lat],
			zoom: zoom,
		});
		basemap.jumpTo({
			center: [lon, lat],
			zoom: zoom,
		});
		map.jumpTo({
			center: [lon, lat],
			zoom: zoom,
		});
	}
}
/**
 * Crossfade one of the map surfaces in or out.
 *
 * This used to fade a map by naming its layers: a hardcoded run of
 * setPaintProperty calls took every border, highway, road sign and city label
 * to opacity 0, and the containers were hidden 500ms later. Two things were
 * wrong with that. The list could only ever name the layers the upstream style
 * happened to have — MAPBOX_STYLE_* exists so a deployment can fork those
 * styles, and a fork that adds or renames a layer is simply not in the list;
 * the radar style's own `minor cities copy` and coastline were already missing
 * from it, and the satellite branch never named its land background, water,
 * hillshade, counties, highways or labels at all. And the base rasters
 * underneath have no opacity for the list to set in the first place.
 *
 * Everything the list missed therefore stayed at full strength after the fade
 * finished, so the last fifth of a second of every radar and satellite slide
 * was a stripped-down map — terrain and a few stray labels, no weather, no
 * borders — sitting there until the container was pulled out from under it. On
 * the way in the same map appeared at full strength before anything faded up.
 *
 * Fading the container takes the whole stacked surface down as one image: base
 * tiles, vector overlay and radar frames together, on any style, with no list
 * to keep in sync. It also leaves each layer's own paint alone, so data-driven
 * values like the Highways zoom ramp survive instead of being flattened to 1.
 *
 * The frame layers still differ per map — full strength on the raster-only
 * surface, half on the labelled one so the labels read through — but that is a
 * fixed level rather than a fade, so loadRadarImages() sets it once when it
 * adds them.
 */
function fadeMap(divID, fadein, zoom) {
	if (divID == 'radar-1') {
		// stop() rather than letting the fades queue: a slide that is cut short
		// would otherwise fade in only after the previous fade-out had finished
		// playing out. false, so an interrupted fade resumes from where it is
		// instead of snapping to its end first.
		var doppler = $('#radar-1, #radar-2, #radar-3').stop(true, false)
		if (fadein === true) {
			// fadeIn sets display before it starts tweening, so the containers are
			// back in flow by the time resize() measures them. That order matters:
			// both libraries fall back to 400x300 for a display:none element and
			// then hold that size until something resizes them again.
			doppler.fadeIn(MAP_FADE_MS)
			map.resize()
			basemap.resize()
			radarmain.resize()
		} else {
			// fadeOut hides the containers when the fade lands, which is the same
			// 500ms mark a setTimeout used to hide them at.
			doppler.fadeOut(MAP_FADE_MS)
		}
	} else if (divID == 'satrad-1') {
		var satellite = $('#satrad-1').stop(true, false)
		if (fadein === true) {
			satellite.fadeIn(MAP_FADE_MS)
			satellitemap.resize()
		} else {
			satellite.fadeOut(MAP_FADE_MS)
		}
	}
	// The mini radar has no branch here. It is never hidden — it sits in the
	// sidebar for the life of the page — and now that frames are added dark and
	// the loop raises one at a time, there is nothing for a fade to do. The old
	// branch set every frame lit at once, which with an opacity-driven loop
	// would stack all thirteen on top of each other.
}
/**
 * Rebuild one surface's frame layers from the current series.
 *
 * Returns a promise that settles once the layers are actually on the map. The
 * fetch behind them is asynchronous, so a caller that wants to raise their
 * opacity or start animating has to wait for this rather than for the map to
 * next go idle — an idle map fires that event immediately and the caller would
 * act on layers that do not exist yet.
 */
function loadRadarImages(divID) {
	var mapdiv;
	var radardiv;
	var pending = Promise.resolve();

	if (divID == 'radar-1') {
		if (interval) {clearInterval(interval)};
		mapdiv = map;
		radardiv = radarmain;
		if (sortedtimestamps) {
			sortedtimestamps.forEach((timestamp, index) => {
		    radardiv.removeLayer(`radarlayer_${timestamp.ts}`)
				radardiv.removeSource(`radarlayer_${timestamp.ts}`)
			});
			sortedtimestamps.forEach((timestamp, index) => {
		    mapdiv.removeLayer(`radarlayer_${timestamp.ts}`)
				mapdiv.removeSource(`radarlayer_${timestamp.ts}`)
			});
		}
	} else if (divID == 'minimap') {
		if (miniinterval) {clearInterval(miniinterval)};
		mapdiv = minimap;
		radardiv = miniradar;
		if (sortedtimestampsmini) {
			sortedtimestampsmini.forEach((timestamp, index) => {
		    radardiv.removeLayer(`radarlayer_${timestamp.ts}`)
				radardiv.removeSource(`radarlayer_${timestamp.ts}`)
			});
			sortedtimestampsmini.forEach((timestamp, index) => {
		    mapdiv.removeLayer(`radarlayer_${timestamp.ts}`)
				mapdiv.removeSource(`radarlayer_${timestamp.ts}`)
			});
		}
	} else if (divID == 'satrad-1') {
		if (interval) {clearInterval(interval)};
		if (satradsortedtimestamps) {
			satradsortedtimestamps.forEach((timestamp, index) => {
		    satellitemap.removeLayer(`satradlayer_${timestamp.ts}`)
			});
		}
		// Use RainViewer for satellite data
		pending = rainViewerConfig.getSatelliteSeries()
	    .then(data => {
				sortedtimestampsforfetch = data.seriesInfo.satrad.series.sort(function(a,b) {
					return a.ts - b.ts;
				})
				satradsortedtimestamps = sortedtimestampsforfetch
				sortedtimestampsforfetch.forEach(timestamp =>{
					satellitemap.addLayer({
	          id: `satradlayer_${timestamp.ts}`,
	          type: "raster",
	          source: {
	            type: "raster",
	            tiles: [
								rainViewerConfig.getSatelliteTileUrl(timestamp.ts)
	            ],
	            tileSize: 256,
	            maxzoom: rainViewerConfig.satelliteMaxZoom
	          },
	          layout: { visibility: "visible" },
						paint: {'raster-fade-duration': .5, 'raster-opacity':0,'raster-opacity-transition':{duration:0},'raster-brightness-max':1},
	          minzoom: 0,
	          maxzoom: 8,
	        });
	    })
			})
			.catch(console.error);
		}
	if (divID != 'satrad-1') {
	// Use RainViewer for radar data
	pending = rainViewerConfig.getRadarSeries()
    .then(data => {
			sortedtimestampsforfetch = data.seriesInfo.twcRadarMosaic.series.sort(function(a,b) {
				return a.ts - b.ts;
			})
			if (divID == 'radar-1') {sortedtimestamps = sortedtimestampsforfetch} else if (divID == 'minimap') {sortedtimestampsmini = sortedtimestampsforfetch};
			sortedtimestampsforfetch.forEach(timestamp =>{
				radardiv.addLayer({
          id: `radarlayer_${timestamp.ts}`,
          type: "raster",
          source: {
            type: "raster",
            tiles: [
							rainViewerConfig.getRadarTileUrl(timestamp.ts)
            ],
            tileSize: 256,
            maxzoom: rainViewerConfig.radarMaxZoom
          },
          layout: { visibility: "visible" },
					paint: {'raster-fade-duration': .5, 'raster-opacity':0,'raster-opacity-transition':{duration:0},'raster-brightness-max':0.9},
          minzoom: 5,
          maxzoom: 8
        });
				mapdiv.addLayer({
          id: `radarlayer_${timestamp.ts}`,
          type: "raster",
          source: {
            type: "raster",
            tiles: [
							rainViewerConfig.getRadarTileUrl(timestamp.ts)
            ],
            tileSize: 256,
            maxzoom: rainViewerConfig.radarMaxZoom
          },
          layout: { visibility: "visible" },
					paint: {'raster-fade-duration': .5,'raster-opacity':0,'raster-opacity-transition':{duration:0},'raster-brightness-max':0.9},
          minzoom: 5,
          maxzoom: 12
        });
			});
    })
    .catch(console.error);
		}
	return pending;
}
// How strongly a frame paints when the loop is resting on it. The labelled map
// carries them at half so its roads and city names read through; the
// raster-only surface underneath carries them at full.
var FRAME_OPACITY = 1;
var LABELLED_FRAME_OPACITY = 0.5;

// One loop is a frame every RADAR_FRAME_MS, then a pause on the last frame
// before the next pass starts. Both loops below tick on these, and
// radarLoopCount() budgets against them, so the three cannot drift apart.
var RADAR_FRAME_MS = 100;
var RADAR_LOOP_PAUSE_MS = 500;

/**
 * How many passes of the loop fit inside a slide.
 *
 * The slides used to work this out as `slideDelay * 11/60000`, which assumes a
 * pass takes 60000/11 — about 5.5 seconds. A pass actually takes one frame
 * interval per frame plus the pause, so 1.8s for RainViewer's thirteen radar
 * frames and 1.4s for GIBS's nine. A ten-second slide therefore asked for two
 * passes, animated for under four seconds and then sat frozen on the newest
 * frame for the remaining six; the sixty-second LOCAL RADAR tab asked for
 * eleven and froze for forty. Neither frame count is fixed either — RainViewer
 * adds and drops nowcast frames — so the number has to be measured, not
 * assumed.
 *
 * Floor rather than round: the last pass should finish inside the slide, not
 * get cut off partway by the transition.
 */
function radarLoopCount(divID, slideDuration) {
	var frames = (divID == 'satrad-1') ? satradsortedtimestamps : sortedtimestamps;
	var count = (frames && frames.length) ? frames.length : 13;
	var loopMs = count * RADAR_FRAME_MS + RADAR_LOOP_PAUSE_MS;
	return Math.max(1, Math.floor(slideDuration / loopMs));
}

/**
 * Show one frame of a radar loop.
 *
 * Stepping the loop moves `raster-opacity`, not `visibility`, and the
 * difference is the whole reason the loop renders at all.
 *
 * A layer's source is only kept alive while some layer using it is *not*
 * hidden, and both libraries decide that from `visibility` and the zoom range —
 * never from opacity. Hiding a frame therefore dropped its source, and dropping
 * a source evicts its tiles: measured mid-loop, the one visible frame held its
 * two tiles and all twelve others held zero. Every frame was re-fetching its
 * tiles from nothing during the 100ms it was on screen, so whichever tile
 * arrived first drew and the rest of the map stayed empty. Only the frame the
 * loop happened to rest on had time to finish, which is why the newest frame
 * looked complete and the others were missing their left and right edges.
 *
 * Opacity has neither problem. Both libraries return early from the raster draw
 * when it is 0, so a frame that is not showing still costs nothing to render,
 * but its source stays used and its tiles stay resident — every frame is fully
 * loaded before the loop ever reaches it.
 *
 * Each surface carries its own lit value: the raster-only map draws frames at
 * full strength, the labelled map at half so its roads and city names read
 * through.
 *
 * `prev < 0` means the caller wants the whole list reset, which is what the
 * first tick of a loop needs: layers are added dark, so frame zero has to be
 * raised once before stepping.
 */
function showRadarFrame(surfaces, timestamps, prefix, index, prev) {
	surfaces.forEach(function (surface) {
		var m = surface.map;
		if (!m) return;
		if (prev < 0) {
			timestamps.forEach(function (timestamp, i) {
				m.setPaintProperty(`${prefix}${timestamp.ts}`, 'raster-opacity', i === index ? surface.opacity : 0);
			});
		} else {
			if (prev !== index && timestamps[prev]) {
				m.setPaintProperty(`${prefix}${timestamps[prev].ts}`, 'raster-opacity', 0);
			}
			m.setPaintProperty(`${prefix}${timestamps[index].ts}`, 'raster-opacity', surface.opacity);
		}
	});
}

function animateRadar(divID, loopnum, maxloop) {
	var mapdiv;
	var radardiv;
	var sortedmaptimestamps;
	if (divID == 'radar-1') {
		mapdiv = map;
		radardiv = radarmain;
		sortedmaptimestamps = sortedtimestamps;
	} else if (divID == 'satrad-1') {
		mapdiv = null;
		radardiv = satellitemap;
		sortedmaptimestamps = satradsortedtimestamps;
	}
	let i = 0;
	// No series yet means the radar fetch has not landed or it failed. Without
	// this the interval below throws on its very first tick — before reaching
	// its own clearInterval — so it never stops and spins at 10Hz for the life
	// of the page.
	if (!sortedmaptimestamps || !sortedmaptimestamps.length) {
		console.warn(`[radar] no frames for ${divID} yet; skipping animation`);
		return;
	}
	// Both of these guards matter on a display that stays up for weeks. Starting
	// a loop while one is already running used to leave the old interval ticking
	// forever, because the tick cleared the shared `interval` global — by then
	// the newer handle — instead of its own. Every stacked loop is another 10Hz
	// timer driving two WebGL maps that nobody ever stops.
	if (interval) clearInterval(interval);
	const handle = interval = setInterval(() => {
    if (i > sortedmaptimestamps.length - 1) {
      clearInterval(handle);
			setTimeout(function() {
				if (divID == 'minimap') {
					animateRadar('minimap')
				} else if (divID == 'satrad-1' && loopnum < maxloop) {
					animateRadar('satrad-1', loopnum + 1, maxloop)
				} else if (divID == 'radar-1' && loopnum < maxloop) {
					animateRadar('radar-1', loopnum + 1, maxloop)
				}
				return;
			},RADAR_LOOP_PAUSE_MS)
    } else {
			var prefix = (divID == 'satrad-1') ? 'satradlayer_' : 'radarlayer_';
			var surfaces = (divID == 'satrad-1')
				? [{ map: radardiv, opacity: FRAME_OPACITY }]
				: [{ map: radardiv, opacity: FRAME_OPACITY }, { map: mapdiv, opacity: LABELLED_FRAME_OPACITY }];
			showRadarFrame(surfaces, sortedmaptimestamps, prefix, i, i - 1);
      i += 1;
    }
  }, RADAR_FRAME_MS);
}
function animateMiniRadar() {
	let i = 0;
	// Same guard as animateRadar: an unset series would throw every tick.
	if (!sortedtimestampsmini || !sortedtimestampsmini.length) {
		console.warn('[radar] no minimap frames yet; skipping animation');
		return;
	}
	// See animateRadar: the minimap loop restarts itself forever, so a stacked
	// interval here never goes away on its own.
	if (miniinterval) clearInterval(miniinterval);
	const handle = miniinterval = setInterval(() => {
    if (i > sortedtimestampsmini.length - 1) {
      clearInterval(handle);
			setTimeout(function() {
				animateMiniRadar()
				return;
			},RADAR_LOOP_PAUSE_MS)
    } else {
			showRadarFrame(
				[{ map: miniradar, opacity: FRAME_OPACITY }, { map: minimap, opacity: LABELLED_FRAME_OPACITY }],
				sortedtimestampsmini, 'radarlayer_', i, i - 1);
      i += 1;
    }
  }, RADAR_FRAME_MS);
}

// The Leaflet-based Radar() implementation that used to sit here was already
// commented out upstream and never called. It is removed along with the
// bundled Leaflet libraries; the radar and satellite surfaces run on
// mapbox-gl / maplibre-gl. See git history if it is ever wanted back.
