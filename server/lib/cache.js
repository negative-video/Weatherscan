'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * TTL cache with in-flight de-duplication and stale-on-error fallback.
 *
 * Three behaviours matter for a display that runs unattended for weeks:
 *   - Concurrent callers for the same key share one upstream request.
 *   - A fresh entry is served without touching the network.
 *   - If a refresh fails, the last good value keeps the screen populated
 *     rather than blanking the slide.
 */

/**
 * The chain of keys whose producers the current async context is inside.
 *
 * In-flight de-duplication is the whole point of this cache and also its one
 * sharp edge: handing a second caller the promise a first is still producing
 * is right, unless that second caller *is* the first, reached by recursion.
 * Then the producer awaits itself, and it does not merely fail — it never
 * settles, the finally that clears the in-flight entry never runs, and every
 * later caller for that key is handed the same dead promise for the life of
 * the process.
 *
 * That is not hypothetical: geocode.reverse() fell back through nearby(),
 * which opens by awaiting reverse() for the same point, and one failed web
 * lookup wedged /v3/location/near until the server was restarted.
 *
 * AsyncLocalStorage tracks the keys this particular chain is producing, which
 * distinguishes a real second caller from a re-entrant one.
 */
const producing = new AsyncLocalStorage();
class Cache {
  constructor({ maxEntries = 500 } = {}) {
    this.store = new Map();
    this.inflight = new Map();
    this.maxEntries = maxEntries;
    this.hits = 0;
    this.misses = 0;
    this.staleServes = 0;
  }

  /**
   * @param {string} key
   * @param {number} ttlMs      how long a value counts as fresh
   * @param {function} producer async () => value
   * @param {object}  [opts]
   * @param {number}  [opts.staleMs] how long an expired value may still be
   *                  served if the producer throws. Defaults to 6x the TTL.
   */
  async wrap(key, ttlMs, producer, opts = {}) {
    const now = Date.now();
    const entry = this.store.get(key);

    if (entry && now - entry.time < ttlMs) {
      this.hits++;
      return entry.value;
    }

    // A cycle, not a second caller. Throwing loses this one lookup; awaiting
    // would lose the key permanently.
    const chain = producing.getStore();
    if (chain && chain.includes(key)) {
      throw new Error(
        `cache: producer for "${key}" re-entered its own key ` +
        `(${chain.join(' -> ')} -> ${key}). Awaiting it would deadlock the key ` +
        'for the life of the process; break the cycle instead.'
      );
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    this.misses++;
    const staleMs = opts.staleMs != null ? opts.staleMs : ttlMs * 6;

    const nested = chain ? [...chain, key] : [key];
    const promise = (async () => {
      try {
        const value = await producing.run(nested, producer);
        this.set(key, value);
        return value;
      } catch (err) {
        if (entry && now - entry.time < ttlMs + staleMs) {
          this.staleServes++;
          console.warn(`[cache] ${key}: refresh failed, serving stale (${err.message})`);
          return entry.value;
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  set(key, value) {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      // Map preserves insertion order, so the first key is the oldest write.
      this.store.delete(this.store.keys().next().value);
    }
    this.store.set(key, { value, time: Date.now() });
  }

  peek(key) {
    const entry = this.store.get(key);
    return entry ? entry.value : undefined;
  }

  clear() {
    this.store.clear();
    this.inflight.clear();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      inflight: this.inflight.size,
      hits: this.hits,
      misses: this.misses,
      staleServes: this.staleServes,
      hitRate: total ? +(this.hits / total).toFixed(3) : 0,
    };
  }
}

module.exports = { Cache, cache: new Cache() };
