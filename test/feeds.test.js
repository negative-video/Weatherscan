'use strict';

const test = require('node:test');
const assert = require('node:assert');
const feeds = require('../server/services/feeds');

/**
 * Ticker content is fetched from whatever URLs the operator configures, so it
 * is untrusted by definition. These tests pin the sanitizer's behaviour and the
 * three feed formats RSS-Bridge and ordinary news sites emit.
 */

// --- sanitizer ------------------------------------------------------------

test('toPlainText unwraps CDATA and strips markup', () => {
  assert.strictEqual(
    feeds.toPlainText('<![CDATA[Storm & <b>flooding</b> ahead]]>'),
    'Storm & flooding ahead'
  );
});

test('toPlainText removes script and style content entirely', () => {
  assert.strictEqual(feeds.toPlainText('<script>alert(1)</script>Real headline'), 'Real headline');
  assert.strictEqual(feeds.toPlainText('<style>body{}</style>Headline'), 'Headline');
});

test('toPlainText neutralizes entity-encoded markup', () => {
  // Decoding before stripping would turn this back into a live tag.
  const out = feeds.toPlainText('&lt;script&gt;alert(1)&lt;/script&gt; encoded');
  assert.ok(!out.includes('<script'), `markup survived: ${out}`);
  assert.ok(!out.includes('</script'), `markup survived: ${out}`);
});

test('toPlainText decodes the entities feeds actually use', () => {
  assert.strictEqual(
    feeds.toPlainText('Tom &amp; Jerry &#8212; &quot;q&quot; &hellip;'),
    'Tom & Jerry — "q" …'
  );
  assert.strictEqual(feeds.toPlainText('72&deg;F &#x26; rising'), '72°F & rising');
});

test('toPlainText leaves unknown entities alone rather than mangling them', () => {
  assert.strictEqual(feeds.toPlainText('a &notarealentity; b'), 'a &notarealentity; b');
});

test('toPlainText collapses whitespace and control characters to one line', () => {
  assert.strictEqual(
    feeds.toPlainText('line one\nline two\t\ttabbed   spaces'),
    'line one line two tabbed spaces'
  );
  assert.ok(!/[\u0000-\u001F\u007F]/.test(feeds.toPlainText('a\u0007b\u0000c')));
});

test('toPlainText truncates on a word boundary with an ellipsis', () => {
  const out = feeds.toPlainText('word '.repeat(100), 40);
  assert.ok(out.length <= 40, `length ${out.length}`);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.endsWith(' …'), 'should trim the dangling space before the ellipsis');
});

test('toPlainText handles empty and nullish input', () => {
  assert.strictEqual(feeds.toPlainText(''), '');
  assert.strictEqual(feeds.toPlainText(null), '');
  assert.strictEqual(feeds.toPlainText(undefined), '');
});

// --- formats --------------------------------------------------------------

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example Wire</title>
  <item>
    <title>Council approves new park</title>
    <link>https://example.com/1</link>
    <description>Some &lt;b&gt;detail&lt;/b&gt;</description>
    <pubDate>Sun, 23 Aug 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[Route 29 work starts Monday]]></title>
    <link>https://example.com/2</link>
    <pubDate>Sun, 23 Aug 2026 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes</title>
  <entry>
    <title>v6.5.0</title>
    <link rel="alternate" href="https://example.com/v6.5.0"/>
    <updated>2026-08-20T10:00:00Z</updated>
    <summary>Bug fixes</summary>
  </entry>
</feed>`;

const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'My RSS-Bridge',
  items: [
    { title: 'Bridged headline', url: 'https://example.com/a', date_published: '2026-08-23T12:00:00Z' },
    { title: 'Second item', content_text: 'body', date_published: '2026-08-22T12:00:00Z' },
  ],
});

test('parseFeed reads RSS 2.0', () => {
  const feed = feeds.parseFeed(RSS);
  assert.strictEqual(feed.title, 'Example Wire');
  assert.strictEqual(feed.items.length, 2);
  assert.strictEqual(feed.items[0].title, 'Council approves new park');
  assert.strictEqual(feed.items[0].link, 'https://example.com/1');
  assert.strictEqual(feed.items[1].title, 'Route 29 work starts Monday', 'CDATA title');
  assert.ok(feed.items[0].published > 0);
});

test('parseFeed reads Atom and finds the alternate link', () => {
  const feed = feeds.parseFeed(ATOM);
  assert.strictEqual(feed.title, 'Release notes');
  assert.strictEqual(feed.items.length, 1);
  assert.strictEqual(feed.items[0].title, 'v6.5.0');
  assert.strictEqual(feed.items[0].link, 'https://example.com/v6.5.0');
});

test('parseFeed reads JSON Feed', () => {
  const feed = feeds.parseFeed(JSON_FEED);
  assert.strictEqual(feed.title, 'My RSS-Bridge');
  assert.strictEqual(feed.items.length, 2);
  assert.strictEqual(feed.items[0].title, 'Bridged headline');
});

test('the feed title is the channel title, not the first item', () => {
  // A naive first-<title> match would return the item's title on some feeds.
  assert.strictEqual(feeds.parseFeed(RSS).title, 'Example Wire');
  assert.strictEqual(feeds.parseFeed(ATOM).title, 'Release notes');
});

test('parseFeed survives malformed input without throwing', () => {
  for (const junk of ['', '   ', 'not xml at all', '{', '<rss><channel>', '<feed>']) {
    assert.doesNotThrow(() => feeds.parseFeed(junk), `threw on ${JSON.stringify(junk)}`);
    assert.ok(Array.isArray(feeds.parseFeed(junk).items));
  }
});

test('items without a title are dropped', () => {
  const feed = feeds.parseFeed(
    '<rss><channel><title>T</title><item><link>https://x/1</link></item></channel></rss>'
  );
  assert.strictEqual(feed.items.length, 0, 'a blank ticker entry is worse than none');
});

test('a script tag inside a feed title never reaches the output', () => {
  const feed = feeds.parseFeed(
    '<rss><channel><title>T</title><item><title>Hi<script>alert(1)</script></title></item></channel></rss>'
  );
  assert.strictEqual(feed.items.length, 1);
  assert.ok(!feed.items[0].title.toLowerCase().includes('script'), feed.items[0].title);
});

// --- feed-reported errors --------------------------------------------------

test('items that are the feed reporting its own failure are dropped', () => {
  // RSS-Bridge emits these as ordinary titled entries, so without filtering a
  // broken bridge scrolls across the display looking like a headline.
  for (const title of [
    'Bridge returned error 401! (20689)',
    'Bridge Not Found',
    'Error 503 upstream unavailable',
  ]) {
    assert.ok(feeds.looksLikeFeedError(title), `should drop: ${title}`);
  }
});

test('real headlines containing the word error are kept', () => {
  for (const title of [
    'Council approves error-correction funding',
    'Trial and error: inside the lab',
    'Storm warning issued for coastal counties',
  ]) {
    assert.ok(!feeds.looksLikeFeedError(title), `should keep: ${title}`);
  }
});

test('parseFeed strips error items but keeps the rest of the feed', () => {
  const xml = `<rss><channel><title>Wire</title>
    <item><title>Bridge returned error 401! (20689)</title></item>
    <item><title>Council approves new park</title></item>
  </channel></rss>`;
  const feed = feeds.parseFeed(xml);
  assert.strictEqual(feed.items.length, 1);
  assert.strictEqual(feed.items[0].title, 'Council approves new park');
});
