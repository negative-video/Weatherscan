'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Cache } = require('../server/lib/cache');

const TTL = 60000;

test('concurrent callers for one key share a single producer', async () => {
  const cache = new Cache();
  let runs = 0;
  const producer = async () => { runs++; await new Promise((r) => setTimeout(r, 10)); return 'v'; };

  const all = await Promise.all([1, 2, 3].map(() => cache.wrap('k', TTL, producer)));
  assert.deepStrictEqual(all, ['v', 'v', 'v']);
  assert.strictEqual(runs, 1, 'in-flight de-duplication should collapse these to one call');
});

test('a fresh entry is served without running the producer again', async () => {
  const cache = new Cache();
  let runs = 0;
  const producer = async () => { runs++; return runs; };
  assert.strictEqual(await cache.wrap('k', TTL, producer), 1);
  assert.strictEqual(await cache.wrap('k', TTL, producer), 1);
  assert.strictEqual(runs, 1);
});

test('a failed refresh serves the last good value', async () => {
  const cache = new Cache();
  await cache.wrap('k', 1, async () => 'good');
  await new Promise((r) => setTimeout(r, 5));
  // staleMs explicitly, so the window does not depend on how long the sleep
  // above actually took.
  const value = await cache.wrap('k', 1, async () => { throw new Error('upstream down'); },
    { staleMs: 60000 });
  assert.strictEqual(value, 'good');
  assert.strictEqual(cache.stats().staleServes, 1);
});

test('a failure with nothing to fall back on propagates', async () => {
  const cache = new Cache();
  await assert.rejects(
    () => cache.wrap('k', TTL, async () => { throw new Error('upstream down'); }),
    /upstream down/
  );
  assert.strictEqual(cache.stats().inflight, 0, 'a failed producer must not stay in flight');
});

/**
 * The defect this exists for: a producer that reaches its own key is handed
 * the promise it is itself producing and awaits it. That never settles, and
 * the finally clearing the in-flight entry never runs — so the key is dead for
 * the life of the process and every later caller hangs too.
 *
 * The timeouts are the assertion. A regression here hangs rather than throwing,
 * so without them the suite would stall instead of reporting.
 */
test('a producer that re-enters its own key throws instead of hanging',
  { timeout: 5000 }, async () => {
    const cache = new Cache();
    let depth = 0;
    const recursive = async () => {
      depth++;
      // The shape of geocode.reverse()'s old fallback: recover by calling
      // something that starts by asking for this very key again.
      return cache.wrap('k', TTL, recursive);
    };

    await assert.rejects(() => cache.wrap('k', TTL, recursive), /re-entered its own key/);
    assert.strictEqual(depth, 1, 'the cycle should be refused on the first re-entry');
  });

test('re-entrancy is refused through an intermediate key', { timeout: 5000 }, async () => {
  const cache = new Cache();
  const outer = async () => cache.wrap('inner', TTL, inner);
  const inner = async () => cache.wrap('outer', TTL, outer);
  await assert.rejects(() => cache.wrap('outer', TTL, outer),
    /re-entered its own key.*outer -> inner -> outer/s);
});

test('a re-entrant failure does not poison the key', { timeout: 5000 }, async () => {
  const cache = new Cache();
  const recursive = async () => cache.wrap('k', TTL, recursive);
  await assert.rejects(() => cache.wrap('k', TTL, recursive));

  assert.strictEqual(cache.stats().inflight, 0);
  // The whole point: the key still works afterwards.
  assert.strictEqual(await cache.wrap('k', TTL, async () => 'recovered'), 'recovered');
});

/**
 * Two independent callers arriving at the same key is the case
 * de-duplication exists for and must not be mistaken for a cycle.
 */
test('nested lookups of different keys are not treated as a cycle', async () => {
  const cache = new Cache();
  const value = await cache.wrap('outer', TTL, async () => {
    const a = await cache.wrap('inner-a', TTL, async () => 'a');
    const b = await cache.wrap('inner-b', TTL, async () => 'b');
    return a + b;
  });
  assert.strictEqual(value, 'ab');
});

test('a caller outside the producing chain still shares the in-flight promise', async () => {
  const cache = new Cache();
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });

  const slow = async () => { runs++; await gate; return 'v'; };
  const first = cache.wrap('k', TTL, slow);
  const second = cache.wrap('k', TTL, slow);   // a real second caller, not recursion
  release();

  assert.deepStrictEqual(await Promise.all([first, second]), ['v', 'v']);
  assert.strictEqual(runs, 1);
});
