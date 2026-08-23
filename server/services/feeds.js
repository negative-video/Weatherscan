'use strict';

const { cache } = require('../lib/cache');
const { config } = require('../config');
const { USER_AGENT } = require('../lib/http');

/**
 * Headline ticker, fed from RSS/Atom/JSON Feed.
 *
 * The upstream project hardcoded its own Discord invite and a paragraph about
 * Weatherscan into the lower marquee. Those belong to that project, not to a
 * fork, and they never change. Pointing the ticker at real feeds — a local
 * RSS-Bridge instance, a news feed, NWS statements, whatever the operator
 * wants — makes the bottom of the screen carry current information the way the
 * real channel's ad crawl did.
 *
 * Everything here is parsed without a dependency. Feed content is untrusted, so
 * markup is stripped and lengths are capped before it reaches the browser.
 */

const MAX_FEED_BYTES = 2 * 1024 * 1024;

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, */*',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Guard against a misconfigured URL pointing at something enormous.
    const declared = parseInt(res.headers.get('content-length') || '0', 10);
    if (declared && declared > MAX_FEED_BYTES) {
      throw new Error(`feed too large (${declared} bytes)`);
    }
    const text = await res.text();
    if (text.length > MAX_FEED_BYTES) throw new Error('feed too large');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// --- parsing --------------------------------------------------------------

/** Pull the first match of a tag's text content out of an XML fragment. */
function tagText(xml, ...names) {
  for (const name of names) {
    // Tolerate namespace prefixes and attributes on the opening tag.
    const re = new RegExp(
      `<(?:[a-zA-Z0-9_-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?${name}>`,
      'i'
    );
    const m = re.exec(xml);
    if (m && m[1] != null) {
      const value = stripCdata(m[1]).trim();
      if (value) return value;
    }
  }
  return '';
}

/** Atom links carry the URL in an attribute rather than as text. */
function atomLink(xml) {
  const alt = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(xml);
  if (alt) return alt[1];
  const any = /<link[^>]*href=["']([^"']+)["']/i.exec(xml);
  return any ? any[1] : '';
}

function stripCdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·',
  eacute: 'é', deg: '°', trade: '™', reg: '®', copy: '©',
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
      const key = name.toLowerCase();
      return NAMED_ENTITIES[key] !== undefined ? NAMED_ENTITIES[key] : m;
    });
}

function safeCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/**
 * Reduce arbitrary feed content to a single line of plain text.
 * Entities are decoded only after tags are removed, so an encoded "&lt;script&gt;"
 * cannot become live markup on the way through.
 */
function toPlainText(raw, maxLength = 300) {
  if (!raw) return '';
  let text = stripCdata(raw);

  // Drop whole elements whose content should never be read out.
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  // A second tag strip catches markup that was entity-encoded in the source.
  text = text.replace(/<[^>]*>/g, ' ');
  // Control characters would corrupt the marquee's layout.
  text = text.replace(/[\u0000-\u001F\u007F]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, '')}…`;
  }
  return text;
}

function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** RSS 2.0 / RDF. */
function parseRSS(xml) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: toPlainText(tagText(block, 'title'), 220),
      summary: toPlainText(tagText(block, 'description', 'encoded'), 300),
      link: toPlainText(tagText(block, 'link'), 400),
      published: parseDate(tagText(block, 'pubDate', 'date', 'published')),
    });
  }
  return items;
}

/** Atom. */
function parseAtom(xml) {
  const items = [];
  const re = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: toPlainText(tagText(block, 'title'), 220),
      summary: toPlainText(tagText(block, 'summary', 'content'), 300),
      link: atomLink(block),
      published: parseDate(tagText(block, 'published', 'updated')),
    });
  }
  return items;
}

/** JSON Feed — what RSS-Bridge emits with format=Json, and the least fragile. */
function parseJSONFeed(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data.items) ? data.items : [];
  return list.map((it) => ({
    title: toPlainText(it.title || '', 220),
    summary: toPlainText(it.summary || it.content_text || it.content_html || '', 300),
    link: typeof it.url === 'string' ? it.url : '',
    published: parseDate(it.date_published || it.date_modified),
  }));
}

/** Feed title, used to label items by source. */
function feedTitle(text, isJSON) {
  if (isJSON) {
    try {
      return toPlainText(JSON.parse(text).title || '', 60);
    } catch {
      return '';
    }
  }
  // The channel/feed title precedes the first item, so cut there first.
  const head = text.split(/<(?:item|entry)[\s>]/i)[0];
  return toPlainText(tagText(head, 'title'), 60);
}

function parseFeed(text) {
  const trimmed = text.trim();
  const isJSON = trimmed.startsWith('{');

  let items;
  if (isJSON) items = parseJSONFeed(trimmed);
  else if (/<entry[\s>]/i.test(trimmed) && !/<item[\s>]/i.test(trimmed)) items = parseAtom(trimmed);
  else if (/<item[\s>]/i.test(trimmed)) items = parseRSS(trimmed);
  else items = parseAtom(trimmed);

  return { title: feedTitle(trimmed, isJSON), items: items.filter((i) => i.title) };
}

// --- public ---------------------------------------------------------------

/**
 * Ticker items from every configured feed, newest first.
 * Falls back to MARQUEE_MESSAGES, then to a neutral default, so the marquee is
 * never blank and never shows another project's advertising.
 */
async function marqueeItems() {
  const urls = config.marquee.feeds;
  if (!urls.length) return { items: staticItems(), source: 'static' };

  return cache.wrap('marquee:items', config.marquee.ttlMs, async () => {
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const text = await fetchText(url);
          const feed = parseFeed(text);
          if (!feed.items.length) console.warn(`[marquee] ${url}: no items parsed`);
          return feed.items.map((item) => ({ ...item, source: feed.title }));
        } catch (err) {
          console.warn(`[marquee] ${url}: ${err.message}`);
          return [];
        }
      })
    );

    const seen = new Set();
    const merged = [];
    for (const item of results.flat()) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }

    // Undated items sort last rather than to 1970.
    merged.sort((a, b) => (b.published || 0) - (a.published || 0));

    const items = merged.slice(0, config.marquee.maxItems).map((item) => ({
      text: config.marquee.showSource && item.source
        ? `${item.source}: ${item.title}`
        : item.title,
      title: item.title,
      source: item.source || '',
      published: item.published,
    }));

    if (!items.length) return { items: staticItems(), source: 'static' };
    return { items, source: 'feeds', feedCount: urls.length };
  }).catch(() => ({ items: staticItems(), source: 'static' }));
}

function staticItems() {
  return config.marquee.messages.map((text) => ({
    text, title: text, source: '', published: null,
  }));
}

module.exports = {
  marqueeItems, parseFeed, toPlainText, decodeEntities, parseRSS, parseAtom, parseJSONFeed,
};
