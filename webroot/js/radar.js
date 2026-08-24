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
						'text-font': ["Frutiger Bold"],
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
						'text-font': ["Frutiger Bold"],
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
						'text-font': ["Frutiger Bold"],
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
						'text-font': ["Frutiger Bold"],
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
function fadeMap(divID, fadein, zoom) {
	if (divID == 'radar-1') {
		if (fadein === true) {
			$('#radar-1').fadeIn(0)
			$('#radar-2').fadeIn(0)
			$('#radar-3').fadeIn(0)
			map.resize()
			basemap.resize()
			radarmain.resize()
		} else {
			setTimeout(function() {
				$('#radar-1').fadeOut(0)
				$('#radar-2').fadeOut(0)
				$('#radar-3').fadeOut(0)
			}, 500)
		}
		map.setPaintProperty('counties blur','line-opacity', (fadein == true) ? 1 : 0)
		map.setPaintProperty('counties','line-opacity', (fadein == true) ? 1 : 0)
		map.setPaintProperty('country-boundaries blur','line-opacity', (fadein == true) ? 1 : 0)
		map.setPaintProperty('country-boundaries','line-opacity', (fadein== true) ? 1 : 0)
		map.setPaintProperty('state blur','line-opacity', (fadein== true) ? 1 : 0)
		map.setPaintProperty('state','line-opacity', (fadein== true) ? 1 : 0)
		map.setPaintProperty('state blur copy','line-opacity', (fadein== true) ? 1 : 0)
		map.setPaintProperty('state copy','line-opacity', (fadein== true) ? 1 : 0)
		map.setPaintProperty('Highways Outline','line-opacity', (fadein== true) ? 1 : 0)
		map.setPaintProperty('Highways','line-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('roadsigns','text-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('roadsigns','icon-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('minor city shadows','text-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('minor cities','text-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('minor cities','icon-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('major city shadow','text-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('major cities','text-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('major cities','icon-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('airport-label medium','icon-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('airport-label large','icon-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('maincityshadow','text-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('maincity','text-opacity', (fadein== true) ? 1 : 0)
			map.setPaintProperty('maincity','icon-opacity', (fadein== true) ? 1 : 0)
		if (sortedtimestamps) {
		sortedtimestamps.forEach((timestamp, index) => {
			radarmain.setPaintProperty(
					`radarlayer_${timestamp.ts}`,
					"raster-opacity",
						(fadein == true) ? 1 : 0
			);
			map.setPaintProperty(
					`radarlayer_${timestamp.ts}`,
					"raster-opacity",
						(fadein == true) ? .5 : 0
			);
		});
		}
	} else if (divID == 'satrad-1') {
		if (fadein === true) {
			$('#satrad-1').fadeIn(0)
			satellitemap.resize()
		} else {
			setTimeout(function() {
				$('#satrad-1').fadeOut(0)
			},500)
		}
		satellitemap.setPaintProperty('state blur','line-opacity', (fadein== true) ? 1 : 0)
		satellitemap.setPaintProperty('state','line-opacity', (fadein== true) ? 1 : 0)
		satellitemap.setPaintProperty('state blur copy','line-opacity', (fadein== true) ? 1 : 0)
		satellitemap.setPaintProperty('state copy','line-opacity', (fadein== true) ? 1 : 0)
		satellitemap.setPaintProperty('country-boundaries blur','line-opacity', (fadein == true) ? 1 : 0)
		satellitemap.setPaintProperty('country-boundaries','line-opacity', (fadein== true) ? 1 : 0)
		if (satradsortedtimestamps) {
		satradsortedtimestamps.forEach((timestamp, index) => {
			satellitemap.setPaintProperty(
				`satradlayer_${timestamp.ts}`,
				"raster-opacity",
					(fadein == true) ? 1 : 0
				);
		});
		}
	} else if (divID == 'minimap') {
		if (sortedtimestampsmini) {
		sortedtimestampsmini.forEach((timestamp, index) => {
			miniradar.setPaintProperty(
				`radarlayer_${timestamp.ts}`,
				"raster-opacity",
					(fadein == true) ? 1 : 0
				);
			minimap.setPaintProperty(
				`radarlayer_${timestamp.ts}`,
				"raster-opacity",
					(fadein == true) ? .5 : 0
			);
		});
		}
	}
}
function loadRadarImages(divID) {
	var mapdiv;
	var radardiv;

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
		rainViewerConfig.getSatelliteSeries()
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
						paint: {'raster-fade-duration': .5, 'raster-opacity':0,'raster-brightness-max':1},
	          minzoom: 0,
	          maxzoom: 8,
	        });
	    })
			})
		}
	if (divID != 'satrad-1') {
	// Use RainViewer for radar data
	rainViewerConfig.getRadarSeries()
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
					paint: {'raster-fade-duration': .5, 'raster-opacity':0,'raster-brightness-max':0.9},
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
					paint: {'raster-fade-duration': .5,'raster-opacity':0,'raster-brightness-max':0.9},
          minzoom: 5,
          maxzoom: 12
        });
			});
    })
    .catch(console.error);
		}
}
/**
 * Show one frame of a radar loop.
 *
 * Both loops used to walk the whole timestamp list on every 100ms tick and set
 * `visibility` on all thirteen frames of both maps — twenty-six calls to change
 * two layers. mapbox-gl and maplibre-gl short-circuit a write that matches the
 * current value, so the redundant twenty-four were not repaints, but they were
 * still twenty-four layer lookups and deep-equals per tick per loop, ten times a
 * second, for as long as the page is open.
 *
 * `prev < 0` means the caller wants the whole list reset, which is what the
 * first tick of a loop needs: layers are added visible, so everything except
 * frame zero has to be hidden once before stepping.
 */
function showRadarFrame(maps, timestamps, prefix, index, prev) {
	maps.forEach(function (m) {
		if (!m) return;
		if (prev < 0) {
			timestamps.forEach(function (timestamp, i) {
				m.setLayoutProperty(`${prefix}${timestamp.ts}`, 'visibility', i === index ? 'visible' : 'none');
			});
		} else {
			if (prev !== index && timestamps[prev]) {
				m.setLayoutProperty(`${prefix}${timestamps[prev].ts}`, 'visibility', 'none');
			}
			m.setLayoutProperty(`${prefix}${timestamps[index].ts}`, 'visibility', 'visible');
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
			},500)
    } else {
			var prefix = (divID == 'satrad-1') ? 'satradlayer_' : 'radarlayer_';
			showRadarFrame([radardiv], sortedmaptimestamps, prefix, i, i - 1);
			if (divID != 'satrad-1') {
				showRadarFrame([mapdiv], sortedmaptimestamps, 'radarlayer_', i, i - 1);
			}
      i += 1;
    }
  }, 100);
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
			},500)
    } else {
			showRadarFrame([miniradar, minimap], sortedtimestampsmini, 'radarlayer_', i, i - 1);
      i += 1;
    }
  }, 100);
}

// The Leaflet-based Radar() implementation that used to sit here was already
// commented out upstream and never called. It is removed along with the
// bundled Leaflet libraries; the radar and satellite surfaces run on
// mapbox-gl / maplibre-gl. See git history if it is ever wanted back.
