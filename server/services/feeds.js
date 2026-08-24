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

/**
 * Feed generators report their own failures as ordinary items. RSS-Bridge in
 * particular emits "Bridge returned error 401! (20689)" as a titled entry, so a
 * broken bridge scrolls across the display looking like a headline. Drop those
 * rather than broadcasting someone's stack trace.
 */
const FEED_ERROR_PATTERNS = [
  /bridge returned error/i,
  /^bridge (not found|error)/i,
  /^error\s*\d{3}\b/i,
  /^\s*(fatal|uncaught)\s+(error|exception)/i,
  /^could not request/i,
];

function looksLikeFeedError(title) {
  return FEED_ERROR_PATTERNS.some((re) => re.test(title));
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

/**
 * Boilerplate that publishers append to a feed's own title. None of it says
 * anything about who wrote the headline, which is the only job the ticker's
 * source prefix has.
 */
const FEED_TITLE_NOISE = new Set([
  'all content', 'all posts', 'all stories', 'all articles', 'everything',
  'full feed', 'full text', 'main feed', 'news feed', 'the feed', 'feed',
  'rss feed', 'rss', 'atom feed', 'atom', 'xml feed',
  'latest', 'latest headlines', 'latest news', 'latest stories',
  'latest articles', 'latest posts', 'recent posts', 'recent articles',
  'headlines', 'top stories', 'top news', 'front page', 'home page', 'home',
  'articles', 'posts', 'stories', 'blog', 'news', 'updates',
]);

// Dashes and slashes only separate when there is space on the left, or the
// title comes apart on hyphenated names and URLs. A colon is the other way
// round — it binds to the word before it ("Hacker News: Front Page") but needs
// a space after, so clock times stay intact.
// Longer than this and it is prose, not a publication's name.
const MAX_SOURCE_LABEL = 32;

const TITLE_TAIL = /^(.*\S)(?:\s+[-–—|»>/]+\s*|\s*:\s+)([^-–—|:»>/]+?)\s*$/;

/**
 * Trim a feed title down to something worth putting in front of a headline.
 *
 * Feed titles are rarely just the publication's name — Ars Technica's is
 * literally "Ars Technica - All Content", so every item in the ticker read
 * "Ars Technica - All Content: <headline>".
 *
 * A trailing segment is dropped only when it is boilerplate, so a section that
 * actually means something survives: "Ars Technica - All Content" becomes
 * "Ars Technica", while "BBC News - World" is left exactly as it is.
 */
function sourceLabel(title) {
  const original = String(title || '').replace(/\s+/g, ' ').trim();
  let out = original;

  // Some titles carry more than one tail: "... - All Content - RSS Feed".
  for (let i = 0; i < 3; i++) {
    const m = TITLE_TAIL.exec(out);
    if (!m || !FEED_TITLE_NOISE.has(m[2].toLowerCase())) break;
    out = m[1];
  }

  // A title that was nothing but boilerplate is better left as it was than
  // dropped to an empty prefix.
  out = out.replace(/[\s\-–—|:»>/]+$/, '').trim() || original;

  // A masthead is short. Anything longer is a sentence rather than a name —
  // the NWS alert feeds title themselves "Current watches, warnings, and
  // advisories for Virginia" — and repeating that in front of every headline
  // is worse than having no label at all.
  return out.length <= MAX_SOURCE_LABEL ? out : '';
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

  const usable = [];
  let errors = 0;
  for (const item of items) {
    if (!item.title) continue;
    if (looksLikeFeedError(item.title)) { errors++; continue; }
    usable.push(item);
  }
  if (errors) {
    console.warn(`[marquee] dropped ${errors} error item(s) reported by the feed itself`);
  }
  return { title: sourceLabel(feedTitle(trimmed, isJSON)), items: usable };
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
  marqueeItems, parseFeed, toPlainText, decodeEntities,
  parseRSS, parseAtom, parseJSONFeed, looksLikeFeedError, sourceLabel,
};
