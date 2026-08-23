'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createHash } = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.swf': 'application/x-shockwave-flash',
};

const COMPRESSIBLE = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.txt',
]);

// Fingerprinted or immutable assets can be cached hard; HTML never is.
const LONG_CACHE = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.ogg', '.wav', '.swf',
]);

/**
 * Minimal static file server.
 *
 * Written by hand rather than pulled in as a dependency: `http-server` and
 * `live-server` between them accounted for most of this project's npm advisory
 * surface, and neither offered anything this does not.
 */
function createStaticHandler(root) {
  const rootReal = fs.realpathSync(root);

  return function serve(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath.split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';

    const target = path.join(rootReal, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

    // Reject anything that escapes the web root, symlinks included.
    if (!target.startsWith(rootReal + path.sep) && target !== rootReal) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return true;
    }

    let stat;
    try {
      stat = fs.statSync(target);
      if (stat.isDirectory()) return serve(req, res, `${rel}/`);
    } catch {
      return false; // let the router produce the 404
    }

    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    // Weak ETag from size and mtime — cheap and good enough for static assets.
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return true;
    }

    const headers = {
      'Content-Type': type,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      // Media and fonts never change, so cache them hard. Code and markup are
      // revalidated every time: config.js is a file users are told to edit, and
      // a max-age on it means an edit appears to do nothing until it expires.
      // Revalidation is a 304 against the ETag, which costs almost nothing.
      'Cache-Control': LONG_CACHE.has(ext) ? 'public, max-age=604800' : 'no-cache',
    };

    if (req.method === 'HEAD') {
      headers['Content-Length'] = stat.size;
      res.writeHead(200, headers);
      res.end();
      return true;
    }

    // Range support keeps the music player able to seek within the mp3s.
    const range = req.headers.range;
    if (range && !COMPRESSIBLE.has(ext)) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return true;
        }
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        fs.createReadStream(target, { start, end }).pipe(res);
        return true;
      }
    }

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && COMPRESSIBLE.has(ext) && stat.size > 1024) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      fs.createReadStream(target).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return true;
    }

    headers['Content-Length'] = stat.size;
    headers['Accept-Ranges'] = 'bytes';
    res.writeHead(200, headers);
    fs.createReadStream(target).pipe(res);
    return true;
  };
}

module.exports = { createStaticHandler, MIME };
