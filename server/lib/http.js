'use strict';

const USER_AGENT =
  'Weatherscan-IntelliStar-Simulator/3.0 (+https://github.com/negative-video/Weatherscan)';

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * fetch with a timeout, one retry on transient failure, and a real User-Agent.
 * api.weather.gov rejects requests without one, so this is not optional.
 */
async function getJSON(url, opts = {}) {
  const { timeoutMs = 12000, retries = 2, headers = {} } = opts;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new HttpError(res.status, url, body.slice(0, 400));
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      // 4xx responses are deterministic and retrying just burns quota — except
      // 429, which is explicitly "try again later". Free weather APIs return it
      // when a burst of locations goes out at once, and giving up there leaves
      // the display blank over something that resolves in a second or two.
      const retryable = !(err instanceof HttpError) ||
        err.status === 429 || err.status >= 500;
      if (!retryable) break;
      if (attempt < retries) {
        const backoff = err instanceof HttpError && err.status === 429
          ? 1500 * (attempt + 1)
          : 400 * (attempt + 1);
        await sleep(backoff);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function headOK(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { getJSON, headOK, HttpError, USER_AGENT };
