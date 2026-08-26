'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fe = require('./helpers/frontend');

/**
 * Checks over webroot/js — the two thirds of this project that had none.
 *
 * Two kinds of defect keep reaching the screen, and neither shows up in a
 * backend test:
 *
 *   Structural. The slide loop is wired together through string keys spread
 *   across config.js, slides-loop.js and index.html. A name that does not
 *   match on both sides fails silently — the slide runs at the wrong delay,
 *   renders a literal "*token*", or dies looking for a container that is not
 *   there. The `slidedelay`/`slideDelay` casing bug lived here for as long as
 *   the file has existed.
 *
 *   Runtime. A slide that throws stops the display until someone reloads the
 *   page, so "every handler survives the data it will actually be handed" is
 *   the single most valuable thing to assert about the frontend.
 */

const handlers = fe.displayNames();
const configured = fe.configuredSlides();
const slidesLoop = fe.source('slides-loop.js');

// --- structural ---------------------------------------------------------

/**
 * All of these come out of one validateSlideConfig() pass, which
 * scripts/check-config.js runs too. Splitting the report into a test per
 * category is only so a failure says which contract broke.
 */
const problems = fe.validateSlideConfig();

test('every configured slide has a handler', () => {
  assert.deepStrictEqual(problems.unknownSlides, []);
});

test('every handler has a container and both header entries', () => {
  assert.deepStrictEqual(problems.missingHandlers, []);
});

test('every slide container exists in index.html', () => {
  assert.deepStrictEqual(problems.missingContainers, []);
});

/**
 * A content class that is not in the markup matches nothing, so the slide
 * quietly keeps the placeholder values index.html shipped with — Madrid at
 * 50/38 — rather than failing in any visible way.
 */
test('every content pane a slide addresses exists in index.html', () => {
  assert.deepStrictEqual(problems.missingContentPanes, []);
});

test('every header placeholder is substituted', () => {
  assert.deepStrictEqual(problems.unhandledPlaceholders, [],
    'these would render literally on screen');
});

test('every testDisplay compiles and returns a boolean verdict', () => {
  assert.deepStrictEqual(problems.brokenTests, []);
});

/**
 * The bug this covers: the loop read `keys[idx].slidedelay` while config.js
 * writes `slideDelay`, so every per-slide override was undefined and silently
 * ignored. A key that differs only in case is never a coincidence.
 */
test('slide properties are read under the name config.js writes', () => {
  assert.deepStrictEqual(problems.miscasedKeys, []);
  assert.deepStrictEqual(problems.unknownKeys, []);
});

/**
 * The same trap one level down. HTML lowercases attribute names, so
 * `data-slideDelay` is readable only as `dataset.slidedelay`; spelling the
 * read in camelCase gets undefined and no error.
 */
test('dataset reads match the attribute names actually written', () => {
  assert.deepStrictEqual(problems.datasetTypos, []);
});

test('every webroot script parses', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(fe.WEBROOT, 'js');
  const failures = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    try {
      new (require('vm').Script)(fs.readFileSync(path.join(dir, name), 'utf8'), { filename: name });
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }
  assert.deepStrictEqual(failures, []);
});

// --- runtime ----------------------------------------------------------------

/**
 * `weatherInfo` used to be declared twice: config.js exported a
 * weatherInfoSettings nobody read, and newweathermanager.js built the live one
 * from its own copy. They drifted — a pressureTrend added to config.js to stop
 * the sidebar printing "pressure undefined" never reached the object that
 * runs, and travel/international went the other way. One declaration or the
 * fixture below is testing a shape that is not on screen.
 */
test('weatherInfo is declared once, in config.js', () => {
  const manager = fe.source('newweathermanager.js');
  assert.ok(/var weatherInfo = JSON\.parse\(JSON\.stringify\(weatherInfoSettings\)\)/.test(manager),
    'newweathermanager.js should build weatherInfo from config.js, not redeclare its shape');
  assert.ok(!/var weatherInfo = \{/.test(manager),
    'a second weatherInfo literal has come back; the two copies will drift');
});

const scenarios = [
  { label: 'populated', populated: true },
  // What the display holds before the first fetch lands, and after one fails.
  // Slides have to survive it: a throw here is what freezes the loop.
  { label: 'blank', populated: false },
];

for (const { label, populated } of scenarios) {
  for (const location of [0, 1, 2]) {
    test(`slides render against ${label} data at location ${location}`, () => {
      const weatherInfo = fe.makeWeatherInfo({ locations: 3, populated });
      const { globals, errors } = fe.makeGlobals({
        weatherInfo, appearance: fe.loadScript('config.js'), location,
      });
      const displays = fe.extractDisplays(globals);

      const failures = [];
      for (const name of handlers) {
        errors.length = 0;
        try {
          displays[name]();
        } catch (err) {
          failures.push(`${name}: ${err.message}`);
          continue;
        }
        // Throws inside fade callbacks and timers are collected rather than
        // propagated, exactly as the browser would swallow them.
        if (errors.length) failures.push(`${name} (deferred): ${errors[0].message}`);
      }
      assert.deepStrictEqual(failures, []);
    });
  }
}

/**
 * A slide that assigns to an undeclared name puts it on window. The pollen
 * slide did: `i = 0` above a forEach that never advanced it, so all four bars
 * animated to the tree reading and `i` leaked for the life of the page.
 */
test('no slide leaks an undeclared global', () => {
  const weatherInfo = fe.makeWeatherInfo({ locations: 3 });
  const { globals } = fe.makeGlobals({
    weatherInfo, appearance: fe.loadScript('config.js'), location: 0,
  });
  const displays = fe.extractDisplays(globals);
  const before = new Set([...Object.keys(globals), 'displays']);

  const leaks = [];
  for (const name of handlers) {
    try { displays[name](); } catch { /* covered by the render tests above */ }
    for (const key of Object.keys(globals)) {
      if (before.has(key)) continue;
      before.add(key);
      leaks.push(`${name} leaked \`${key}\``);
    }
  }
  assert.deepStrictEqual(leaks, []);
});

/**
 * The pollen slide reads healthPollen.types positionally against a fixed
 * tree/grass/weed/mold list. If those stop lining up the bars silently show
 * each other's readings, which is what happened.
 */
test('the pollen bars read their own index', () => {
  const config = fe.loadScript('config.js');
  // Spread out of the VM realm: an array from vm has a different Array
  // prototype and would fail deepStrictEqual against a local literal.
  const types = [...config.weatherInfoSettings.healthPollen.types].map((t) => t.type);
  assert.deepStrictEqual(types, ['tree', 'grass', 'weed', 'mold']);

  const block = /pollentypes\s*=\s*\[([^\]]*)\]/.exec(slidesLoop);
  assert.ok(block, 'the pollen slide no longer builds a pollentypes list');
  const listed = block[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  assert.deepStrictEqual(listed, types,
    'pollentypes must match healthPollen.types in order — the bars index into it');

  assert.ok(/pollentypes\.forEach\(function \(pollentype, i\)/.test(slidesLoop),
    'the bar index must come from forEach, not from a variable outside the loop');
});

// --- boot sequencing --------------------------------------------------------

/**
 * The boot order is load-bearing for how the display *feels*, and every part of
 * it is easy to undo by accident, so the shape is asserted here.
 *
 * Seven map surfaces used to be built in one call on a bare setTimeout(4000) —
 * one second before the intro card lifts. Measured, that put an 88ms task
 * immediately before the reveal and a 56ms one immediately after it, which is
 * exactly when the ticker becomes visible and has to be smooth.
 */
const radar = fe.source('radar.js');
const manager = fe.source('newweathermanager.js');

test('the sidebar and slide map surfaces are built separately', () => {
  assert.ok(/function initSidebarBasemaps\(\)/.test(radar));
  assert.ok(/function initSlideBasemaps\(\)/.test(radar));
  assert.ok(!/function initBasemaps\(\)/.test(radar),
    'the single seven-map constructor is back; boot pays for all of them again');

  // Three in the sidebar, four for the radar and satellite slides.
  const sidebar = radar.slice(radar.indexOf('function initSidebarBasemaps'),
    radar.indexOf('function initSlideBasemaps'));
  const slide = radar.slice(radar.indexOf('function initSlideBasemaps'));
  const maps = (s) => (s.match(/= new (?:mapboxgl|maplibregl)\.Map\(/g) || []).length;
  assert.strictEqual(maps(sidebar), 3);
  assert.strictEqual(maps(slide.slice(0, slide.indexOf('function recenterMap'))), 4);
});

test('both map families are idempotent', () => {
  assert.ok(/function initSidebarBasemaps\(\) \{\s*\n\s*if \(minimap\) return;/.test(radar));
  assert.ok(/function initSlideBasemaps\(\) \{\s*\n\s*if \(map\) return;/.test(radar));
});

/**
 * The deferred surfaces must exist by the time a radar slide asks for them.
 * The scheduled build is the normal path; these are the backstop for a display
 * that reaches one early, or that is parked in a background tab where idle
 * callbacks and timers are throttled.
 */
test('the radar entry points build the deferred surfaces on demand', () => {
  for (const fn of ['recenterMap', 'fadeMap']) {
    const body = radar.slice(radar.indexOf(`function ${fn}(`));
    assert.ok(/initSlideBasemaps\(\)/.test(body.slice(0, body.indexOf('\n}'))),
      `${fn} does not ensure the slide surfaces exist`);
  }
});

test('boot waits for the location rather than a stopwatch', () => {
  assert.ok(!/setTimeout\(function\(\) \{\s*\n\s*initBasemaps\(\)/.test(manager),
    'boot is back on a fixed timer; maps can be built before the location resolves');
  assert.ok(/bootDataReady\.then\(/.test(manager));
  assert.ok(/bootRevealed\.then\(/.test(manager));
  // Without the backstop, data that never lands means a display that never boots.
  assert.ok(/setTimeout\(bootDataReady\.reach, \d+\)/.test(manager));
  // The milestone has to be the data landing, not the location resolving:
  // Loops() paints the sidebar once and then not again for five minutes.
  const resolved = manager.slice(manager.indexOf('function onMainLocationResolved'));
  assert.ok(!/bootDataReady\.reach\(\)/.test(resolved.slice(0, resolved.indexOf('\n}'))),
    'boot is signalled when the location resolves, before any data has arrived');
  assert.ok(/function grabSideandLowerBarData[\s\S]*?bootDataReady\.reach\(\)/.test(manager));
});

test('the slide surfaces are not built alongside the reveal', () => {
  // requestIdleCallback on its own fires within a second of the reveal, because
  // the browser genuinely is idle then. The settle is what moves the work.
  assert.ok(/SLIDE_MAP_SETTLE_MS\s*=\s*(\d+)/.test(manager));
  const settle = Number(/SLIDE_MAP_SETTLE_MS\s*=\s*(\d+)/.exec(manager)[1]);
  assert.ok(settle >= 8000, `settle is ${settle}ms; too close to the reveal to help`);
  assert.ok(/setTimeout\(function \(\) \{ whenIdle\(initSlideBasemaps, \d+\); \}, SLIDE_MAP_SETTLE_MS\)/
    .test(manager));
});

test('whenIdle always sets a hard timer as well', () => {
  const body = manager.slice(manager.indexOf('function whenIdle('));
  const fn = body.slice(0, body.indexOf('\n}'));
  assert.ok(/requestIdleCallback\(fn/.test(fn));
  assert.ok(/(^|\n)\s*setTimeout\(fn, timeout\)/.test(fn),
    'a background tab may never be given an idle callback');
});

test('the first slide is not left waiting behind the reveal', () => {
  const body = slidesLoop.slice(slidesLoop.indexOf('function Slides()'));
  const start = /showSlides\(0\)\s*\n\s*\}, (\d+)\)/.exec(body);
  assert.ok(start, 'Slides() no longer schedules its first slide the expected way');
  assert.ok(Number(start[1]) <= 100,
    `first slide is ${start[1]}ms behind the reveal; the display sits empty that long`);
});

test('weatherInfo is built once the location is known, in one place', () => {
  // Four copies of the same four calls, one per branch of getMainLoc, is how
  // the geocode branch came to read adminDistrict with an index that only the
  // search branch ever set.
  assert.strictEqual((manager.match(/^\s*onMainLocationResolved\(\)/gm) || []).length, 4,
    'expected one call per branch of getMainLoc');
  assert.ok(/function onMainLocationResolved\(\)/.test(manager));
  assert.ok(!/data\.location\.adminDistrict\[cidx\]/.test(
    manager.slice(manager.indexOf('location/point?geocode='), manager.indexOf('locationType='))),
    'the point branch is subscripting a scalar again');
});
