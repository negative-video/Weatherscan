'use strict';

/**
 * TTL cache with in-flight de-duplication and stale-on-error fallback.
 *
 * Three behaviours matter for a display that runs unattended for weeks:
 *   - Concurrent callers for the same key share one upstream request.
 *   - A fresh entry is served without touching the network.
 *   - If a refresh fails, the last good value keeps the screen populated
 *     rather than blanking the slide.
 */
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

    const pending = this.inflight.get(key);
    if (pending) return pending;

    this.misses++;
    const staleMs = opts.staleMs != null ? opts.staleMs : ttlMs * 6;

    const promise = (async () => {
      try {
        const value = await producer();
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
