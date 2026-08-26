'use strict';

/**
 * A harness for exercising the frontend without a browser.
 *
 * webroot/js is two thirds of this project and nothing checked any of it. The
 * defects that reach the screen live there — a slide that throws stops the
 * display until someone reloads the page — and they are all the same shape: a
 * property read that lands on undefined because the data for a location never
 * arrived, or because a key was spelled differently on the two sides.
 *
 * Nothing here needs a real DOM. Every slide handler reads from weatherInfo and
 * writes what it computed into jQuery, so a no-op jQuery still runs every read
 * and every branch that decides what to read. Stubbing the DOM rather than
 * emulating it also keeps this honest about what it does not cover: layout,
 * styling and anything that depends on a real measurement.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const WEBROOT = path.join(__dirname, '..', '..', 'webroot');

function source(file) {
  return fs.readFileSync(path.join(WEBROOT, 'js', file), 'utf8');
}

function indexHtml() {
  return fs.readFileSync(path.join(WEBROOT, 'index.html'), 'utf8');
}

/** Evaluate one webroot script and hand back everything it declared. */
function loadScript(file, seed = {}) {
  const context = vm.createContext(seed);
  vm.runInContext(source(file), context, { filename: file });
  return context;
}

/**
 * A chainable stand-in for jQuery.
 *
 * Methods that jQuery uses as getters have to answer with the right *type*,
 * not with the chain: resizeText loops `while ($test.outerHeight(true) >= 400)`
 * and would never leave that loop against a chainable object.
 */
function makeJQuery(record) {
  const GETTERS = {
    text: () => '', html: () => '', val: () => '', css: () => '',
    attr: () => undefined, prop: () => undefined, data: () => undefined,
    width: () => 400, height: () => 100,
    innerWidth: () => 400, innerHeight: () => 100,
    outerWidth: () => 400, outerHeight: () => 100,
    is: () => false, hasClass: () => false, index: () => 0, get: () => [],
  };

  function node(selector) {
    const el = {
      // Slide bookkeeping round-trips through data attributes, so the stub has
      // to carry one. Empty JSON keeps callers that parse it from throwing.
      dataset: { slideorder: '[]', locidx: '0', slidedelay: '10000',
        loopcomplete: 'false', repeat: '0' },
      classList: { contains: () => false, add() {}, remove() {} },
      selector,
    };

    const chain = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'length') return 1;
        if (prop === '0') return el;
        if (prop === 'selector') return selector;
        if (prop === Symbol.toPrimitive || prop === 'toString') return () => selector;
        if (prop in GETTERS) {
          return (...args) => (args.length ? chain : GETTERS[prop](...args));
        }
        // .promise().done(fn) runs fn: the fade-completion callbacks carry real
        // work, and skipping them would leave half of each slide unexercised.
        if (prop === 'done' || prop === 'always' || prop === 'then') {
          return (fn) => { if (typeof fn === 'function') record.run(fn); return chain; };
        }
        if (prop === 'each') {
          return (fn) => { if (typeof fn === 'function') record.run(() => fn.call(el, 0, el)); return chain; };
        }
        if (prop === 'map') return () => chain;
        return () => chain;
      },
      apply: () => chain,
    });
    return chain;
  }

  const $ = (arg) => node(typeof arg === 'string' ? arg : '<element>');
  $.each = (list, fn) => { (list || []).forEach((v, i) => fn(i, v)); return list; };
  $.trim = (s) => String(s == null ? '' : s).trim();
  $.isFunction = (f) => typeof f === 'function';
  $.extend = Object.assign;
  $.fn = {};
  return $;
}

/**
 * Every global a slide handler reaches for, stubbed.
 *
 * Deliberately explicit rather than a catch-all proxy: an identifier that is
 * not listed here throws ReferenceError, which is exactly the report wanted
 * when a handler reaches for something that does not exist.
 */
function makeGlobals({ weatherInfo, appearance, location = 0, slideDelay = 10000 }) {
  const errors = [];
  const timers = [];
  let depth = 0;

  // Callbacks run synchronously but under a budget. Paginating slides recurse
  // through setTimeout to reach their next page, so this has to allow real
  // recursion while still refusing to run forever if one fails to terminate.
  const record = {
    errors,
    run(fn) {
      if (depth > 400) return;
      depth++;
      try { fn(); } catch (err) { errors.push(err); }
      finally { depth--; }
    },
  };

  const $ = makeJQuery(record);

  const globals = {
    $, jQuery: $,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout: (fn) => { timers.push(fn); record.run(fn); return timers.length; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => { record.run(fn); return 0; },
    document: { getElementById: () => null, querySelector: () => null,
      querySelectorAll: () => [], createElement: () => ({ style: {} }) },
    navigator: { userAgent: 'node' },

    weatherInfo,
    slideApperanceSettings: appearance.slideApperanceSettings,
    apperanceSettings: appearance.apperanceSettings,
    locationSettings: appearance.locationSettings,
    slideLoopSettings: appearance.slideLoopSettings,
    severeLoopSettings: appearance.severeLoopSettings,

    // Closure variables the displays literal reads from its enclosing scope.
    location, slideDelay,
    wait: () => {},
    resizeText: () => {},
    tipidx: 0,
    severemode: false,
    severepreload: false,

    // Collaborators the handlers call but whose behaviour is not under test.
    weatherAudio: new Proxy({}, { get: () => () => {} }),
    getCCicon: () => {},
    fadeMap: () => {}, animateRadar: () => {}, recenterMap: () => {},
    showRadar: () => {}, radarLoopCount: () => 1,
    buildHeader: () => {}, advanceHeader: () => {},
    growBar: (target, height, duration, done) => { if (typeof done === 'function') record.run(done); },
    citySlideList: [], ccTickerCitiesList: [], state: 'VA',
    dateFns: new Proxy({}, { get: () => () => new Date(0) }),
    // Paginating slides recurse through the enclosing renderSlide's
    // currentDisplay. Left unstubbed every one of them dies on its second page.
    currentDisplay: () => {},
    fillThreeDayPanes: () => {}, blankThreeDayPane: () => {},
    makeDelayPages: () => {},
    maincitycoords: { displayname: 'Testville', lat: 38, lon: -78 },
    locList: [
      { displayname: 'Nexttown', lat: 38.1, lon: -78.1 },
      { displayname: 'Farville', lat: 38.2, lon: -78.2 },
    ],
  };
  globals.window = globals;
  globals.globalThis = globals;
  return { globals, errors, timers };
}

/**
 * The `displays` object out of slides-loop.js.
 *
 * It is built inside renderSlide, which cannot run without a header in the
 * DOM, so the literal is lifted out by source position and evaluated against
 * the stub globals instead. Brace matching is done with strings and comments
 * removed, because both contain unbalanced braces.
 */
function extractDisplays(globals) {
  const text = source('slides-loop.js');
  const bare = stripStringsAndComments(text);
  const marker = bare.indexOf('displays = {');
  if (marker < 0) throw new Error('slides-loop.js no longer assigns `displays`');

  const open = bare.indexOf('{', marker);
  let depth = 0, close = -1;
  for (let i = open; i < bare.length; i++) {
    if (bare[i] === '{') depth++;
    else if (bare[i] === '}' && --depth === 0) { close = i; break; }
  }
  if (close < 0) throw new Error('unbalanced braces in the displays literal');

  const context = vm.createContext(globals);
  return vm.runInContext(
    `(${text.slice(open, close + 1)})`, context,
    { filename: 'slides-loop.js:displays' }
  );
}

/** Handler names in source order, read the same way extractDisplays reads them. */
function displayNames() {
  const bare = stripStringsAndComments(source('slides-loop.js'));
  const marker = bare.indexOf('displays = {');
  const open = bare.indexOf('{', marker);
  let depth = 0, close = -1;
  for (let i = open; i < bare.length; i++) {
    if (bare[i] === '{') depth++;
    else if (bare[i] === '}' && --depth === 0) { close = i; break; }
  }
  const block = bare.slice(open + 1, close);

  const names = [];
  let level = 0;
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '{' || ch === '(' || ch === '[') { level++; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { level--; continue; }
    if (level !== 0) continue;
    if (/[\w$.]/.test(block[i - 1] || '')) continue;
    const m = /^([A-Za-z_$][\w$]*)\s*\([A-Za-z0-9_$,\s]*\)\s*\{/.exec(block.slice(i));
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * Blank out string, template and comment contents, keeping length and line
 * structure. Brace matching over raw source counts the braces inside `${}`
 * and inside comments, which lands the scan in the wrong place.
 */
function stripStringsAndComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '; i++;
      }
      out += '  '; i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += quote; i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        out += text[i] === '\n' ? '\n' : ' '; i++;
      }
      out += quote; i++;
      continue;
    }
    out += ch; i++;
  }
  return out;
}


/**
 * A weatherInfo the slides can be run against.
 *
 * Built from config.js's own weatherInfoSettings rather than hand-written, so
 * a field added to the declared shape reaches the fixture without anyone
 * remembering to update it. The per-location records are clones of the
 * single-location record beside them — currentCond.sidebar is the shape of a
 * currentCond.weatherLocs entry, dayPart.lowerbar the shape of a dayPart one —
 * which is the relationship config.js documents in its commented-out `loc:`
 * lines.
 *
 * `populated: false` leaves every leaf at the empty value config.js declares,
 * which is what the display holds before the first fetch lands and after one
 * fails. Slides have to survive it: throwing there is what freezes the loop.
 */
function makeWeatherInfo({ locations = 3, populated = true } = {}) {
  const config = loadScript('config.js');
  const info = structuredClone(config.weatherInfoSettings);

  const fill = (value, key) => {
    if (!populated) return value;
    if (typeof value !== 'string') return value;
    if (/displayname/i.test(key)) return 'Testville';
    if (key === 'name') return 'Wednesday';
    if (/^(temp|high|low|avghigh|avglow|rechigh|reclow)$/i.test(key)) return '72';
    if (/year$/i.test(key)) return '1998';
    if (/^(humid|precipchance)$/i.test(key)) return '50';
    if (/^(icon|index|.*idx|total|achesindex|breathindex|airqualityindex|currentuv)$/i.test(key)) return '4';
    if (/^windspeed$/i.test(key)) return '8';
    if (/^wind$/i.test(key)) return 'SSE 8 mph';
    return 'value';
  };

  const deepFill = (node) => {
    if (Array.isArray(node)) return node.map(deepFill);
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        node[key] = typeof node[key] === 'object' && node[key] !== null
          ? deepFill(node[key]) : fill(node[key], key);
      }
      return node;
    }
    return node;
  };

  const clone = (shape, displayname) => {
    const record = deepFill(structuredClone(shape));
    record.displayname = displayname;
    record.noReport = false;
    return record;
  };

  deepFill(info);

  const names = ['Testville', 'Nexttown', 'Farville', 'Lastburg'];
  const perLocation = [
    ['currentCond', 'sidebar'],
    ['dayPart', 'lowerbar'],
    ['dayDesc', 'lowerbar'],
    ['fiveDay', 'lowerbar'],
  ];
  for (const [product, shapeKey] of perLocation) {
    info[product].weatherLocs = [];
    for (let i = 0; i < locations; i++) {
      info[product].weatherLocs.push(clone(info[product][shapeKey], names[i % names.length]));
    }
  }

  // The bulletin record has no single-location twin to copy; config.js
  // documents it in a comment as displayname plus a list of rendered pages.
  info.bulletin.weatherLocs = [];
  for (let i = 0; i < locations; i++) {
    info.bulletin.weatherLocs.push({
      displayname: names[i % names.length],
      enabled: populated,
      pages: populated ? ['<b>Warning</b> one', 'page two'] : [],
    });
  }

  // Lists the slides paginate over. Left empty these exercise the empty-list
  // branch, which is worth its own run rather than being the only run.
  info.currentCond.city8slides.cities = populated
    ? names.map((n) => ({ noReport: false, displayname: n, temp: '72', icon: '4', wind: 'SSE 8 mph', windspeed: '8' }))
    : [];
  const airport = (iata, name) => ({
    iata, displayname: name, temp: '72', cond: 'Clear', icon: '4',
    wind: 'E 6 mph', windspeed: '6',
    arrivals: { delay: 'ON TIME', reason: '' },
    departures: { delay: 'ON TIME', reason: '' },
  });
  // The airport lists are shipped config, not fetched, so they are never empty
  // — only their observation fields are blank before the fetch lands.
  info.airport.mainairports = info.airport.mainairports.length
    ? info.airport.mainairports : [airport('MIA', 'Miami'), airport('MCO', 'Orlando')];
  info.airport.otherairports = info.airport.otherairports.length
    ? info.airport.otherairports : [airport('ORD', 'Chicago')];
  info.airport.delays = populated
    ? [{ iato: 'LGA', type: 'Ground Stop', amount: '45', amountmin: '45', reason: 'weather' }]
    : [];
  info.almanac.moonphases = [0, 1, 2, 3].map((i) => ({ name: 'Full', date: 'Aug ' + (i + 1) }));
  info.uvindex.forecast = [0, 1, 2].map(() => ({ day: 'Wed', time: '12pm', index: '6', desc: 'High' }));
  // healthPollen.types is a fixed tree/grass/weed/mold array in the declared
  // shape, so it is filled in place rather than replaced.
  info.healthPollen.types.forEach((t) => { t.pollenidx = populated ? '3' : '0'; });
  info.ccticker.ccLocs = populated
    ? names.map((n) => ({ displayname: n, temp: '72', cond: 'Clear' }))
    : [];
  info.ccticker.ccairportdelays = [];

  return info;
}


/**
 * Every slide entry configured anywhere in config.js, flattened, with a label
 * saying where it came from so a failure names the entry to go and edit.
 * Alternates count: the loop swaps one in and runs it like any other slide.
 */
function configuredSlides() {
  const config = loadScript('config.js');
  const out = [];

  const walk = (packages, label) => {
    (packages || []).forEach((pkg, pi) => {
      const orders = pkg.slideOrders || (pkg.slideOrder ? [pkg.slideOrder] : []);
      orders.forEach((order, oi) => {
        order.forEach((slide, si) => {
          const where = `${label}.order[${pi}](${pkg.type}).slideOrder[${oi}][${si}]`;
          out.push({ slide, where, pkg });
          if (slide.alternate) out.push({ slide: slide.alternate, where: where + '.alternate', pkg });
        });
      });
    });
  };

  walk(config.slideLoopSettings.order, 'slideLoopSettings');
  walk(config.severeLoopSettings.order, 'severeLoopSettings');
  return out;
}

/** The `data-*` attribute names the header markup writes, lowercased as HTML stores them. */
function dataAttributesWritten() {
  const names = new Set();
  for (const file of ['slides-loop.js', 'loops.js', 'utils.js', 'main.js']) {
    for (const m of source(file).matchAll(/data-([A-Za-z][\w-]*)=/g)) names.add(m[1].toLowerCase());
  }
  for (const m of indexHtml().matchAll(/data-([A-Za-z][\w-]*)=/g)) names.add(m[1].toLowerCase());
  return names;
}


/**
 * Everything about config.js that can be checked without a browser.
 *
 * Returns a list of problems, grouped by kind. config.js is the file the
 * README tells people to edit, and every one of these mistakes fails silently
 * on screen rather than saying anything: a mistyped slide name renders
 * nothing, a testDisplay that throws used to stop the loop, a placeholder with
 * no substitution prints itself literally.
 *
 * Shared with scripts/check-config.js so `npm run check` and `npm test` cannot
 * disagree about what a valid config is.
 */
function validateSlideConfig() {
  const config = loadScript('config.js');
  const loop = loadScript('slides-loop.js');
  const text = source('slides-loop.js');
  const html = indexHtml();
  const handlers = new Set(displayNames());

  const problems = {
    unknownSlides: [], missingHandlers: [], missingContainers: [],
    missingContentPanes: [],
    unhandledPlaceholders: [], brokenTests: [], miscasedKeys: [], unknownKeys: [],
    datasetTypos: [],
  };

  for (const { slide, where } of configuredSlides()) {
    if (!handlers.has(slide.name)) {
      problems.unknownSlides.push(`${where}: no slide named "${slide.name}"`);
    }
  }

  for (const name of handlers) {
    for (const [label, map] of [['maindiv', loop.maindiv],
      ['mainDivHeaders', loop.mainDivHeaders], ['mainDivCityHeaders', loop.mainDivCityHeaders]]) {
      if (!(name in map)) problems.missingHandlers.push(`${name} missing from ${label}`);
    }
  }

  for (const [name, selector] of Object.entries(loop.maindiv)) {
    if (!selector) continue;
    const cls = selector.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`class=["'][^"']*\\b${cls}\\b`).test(html)) {
      problems.missingContainers.push(`${name} -> ${selector} is not in index.html`);
    }
  }

  // Slides address their own markup by content class, both as a selector and
  // as the first argument to fillThreeDayPanes. A class that is not in
  // index.html matches nothing: the writes go nowhere and the slide shows the
  // static placeholder values the markup shipped with, silently and forever.
  const contentClasses = new Set();
  for (const m of text.matchAll(/\.info-slide-content\.([A-Za-z0-9_-]+)/g)) contentClasses.add(m[1]);
  for (const m of text.matchAll(/fillThreeDayPanes\(\s*'([^']+)'/g)) contentClasses.add(m[1]);
  for (const name of contentClasses) {
    const cls = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`class=["'][^"']*\\binfo-slide-content\\b[^"']*\\b${cls}\\b`).test(html)) {
      problems.missingContentPanes.push(
        `.info-slide-content.${name} is addressed by slides-loop.js but not in index.html`);
    }
  }

  const placeholders = new Set();
  for (const map of [loop.mainDivHeaders, loop.mainDivCityHeaders]) {
    for (const value of Object.values(map)) {
      for (const m of String(value).matchAll(/\*([A-Za-z]+)\*/g)) placeholders.add(m[1]);
    }
  }
  const substituted = new Set();
  for (const m of text.matchAll(/\.replace\('\*([A-Za-z]+)\*'/g)) substituted.add(m[1]);
  for (const name of placeholders) {
    if (!substituted.has(name)) {
      problems.unhandledPlaceholders.push(`*${name}* would render literally`);
    }
  }

  const weatherInfo = makeWeatherInfo({ locations: 3 });
  for (const { slide, where } of configuredSlides()) {
    if (!slide.testDisplay) continue;
    const body = String(slide.testDisplay).replace(/replaceLocIdx/g, '0');
    try {
      const verdict = new Function('weatherInfo', body)(weatherInfo);
      if (verdict !== undefined && typeof verdict !== 'boolean') {
        problems.brokenTests.push(`${where}: returned ${typeof verdict}, want a boolean`);
      }
    } catch (err) {
      problems.brokenTests.push(`${where}: ${err.message}`);
    }
  }

  // A slide property read under a name config.js never writes. Differing only
  // in case is the giveaway — that was `keys[idx].slidedelay` against a
  // configured `slideDelay`, so every per-slide override was ignored.
  const written = new Set(['skipped', 'originalSlide']);
  for (const { slide } of configuredSlides()) for (const k of Object.keys(slide)) written.add(k);
  const byLower = new Map([...written].map((k) => [k.toLowerCase(), k]));
  for (const m of text.matchAll(/\bkeys(?:Next)?\[[^\]]+\]\.([A-Za-z_$][\w$]*)/g)) {
    const key = m[1];
    if (written.has(key)) continue;
    if (byLower.has(key.toLowerCase())) {
      problems.miscasedKeys.push(`reads .${key}, config.js writes .${byLower.get(key.toLowerCase())}`);
    } else {
      problems.unknownKeys.push(`reads .${key}, which config.js never writes`);
    }
  }

  // The same trap through the DOM: HTML lowercases attribute names, so
  // data-slideDelay is only readable as dataset.slidedelay.
  const attributes = dataAttributesWritten();
  for (const m of text.matchAll(/\.dataset\.([A-Za-z_$][\w$]*)/g)) {
    const key = m[1];
    const dashed = key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    if (/[A-Z]/.test(key) && !attributes.has(dashed)) {
      problems.datasetTypos.push(`dataset.${key} is always undefined (no dashed data-${dashed})`);
    } else if (!/[A-Z]/.test(key) && !attributes.has(key)) {
      problems.datasetTypos.push(`dataset.${key} has no matching data-* attribute`);
    }
  }

  problems.all = Object.values(problems).flat();
  return problems;
}

module.exports = {
  WEBROOT, source, indexHtml, loadScript, makeWeatherInfo, validateSlideConfig,
  configuredSlides, dataAttributesWritten,
  makeGlobals, extractDisplays, displayNames, stripStringsAndComments,
};
