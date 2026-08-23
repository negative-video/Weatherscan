#!/usr/bin/env node
'use strict';

const http = require('http');
const { config, describe } = require('./config');
const { createStaticHandler } = require('./static');
const { route, json } = require('./router');

// Self-signed Home Assistant certificates are common on a LAN. Opt-in only,
// and announced loudly, because it disables verification process-wide.
if (config.homeAssistant.url && !config.homeAssistant.verifyTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[startup] HA_VERIFY_TLS=false — TLS certificate verification is DISABLED');
}

const serveStatic = createStaticHandler(config.webroot);

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const pathname = url.pathname;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // The frontend and API share an origin, so no CORS is needed for normal use.
  // A permissive GET-only header keeps the door open for someone driving the
  // JSON API from a dashboard on another host.
  if (pathname.startsWith('/api')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  try {
    if (pathname.startsWith('/api')) {
      await route(req, res, pathname, url.searchParams);
      if (config.logRequests) {
        console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

    if (serveStatic(req, res, pathname)) {
      if (config.logRequests) {
        console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    console.error(`[error] ${req.method} ${pathname}:`, err.message);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (pathname.startsWith('/api')) {
      json(res, 500, { error: 'internal error', detail: err.message });
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

// Long-lived kiosk displays hold connections open; keep the timeouts generous.
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 120000;

function banner() {
  const { lines, problems } = describe();
  const width = 64;
  const rule = '='.repeat(width);

  console.log(rule);
  console.log('  Weatherscan IntelliStar Simulator');
  console.log(rule);
  for (const line of lines) console.log(`  ${line}`);
  console.log(rule);

  if (problems.length) {
    console.log('  Configuration needs attention:');
    for (const p of problems) console.log(`    ! ${p}`);
    console.log(rule);
  }
}

server.listen(config.port, config.host, () => {
  banner();
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`  Ready on http://${shown}:${config.port}`);
  console.log(`  Status  http://${shown}:${config.port}/api/status`);
  console.log('');
});

function shutdown(signal) {
  console.log(`\n[shutdown] ${signal} received, closing`);
  server.close(() => process.exit(0));
  // Do not let a stuck upstream request hold the container open.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err && err.message ? err.message : err);
});

module.exports = server;
