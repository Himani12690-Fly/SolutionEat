#!/usr/bin/env node
/**
 * Local static server jo GitHub Pages ki tarah behave karta hai.
 *
 *   npm run serve            # port 8080
 *   PORT=9000 npm run serve
 *
 * Pehle yahan plain `http-server` chalta tha. Farq ye tha ki Pages unknown
 * path par 404.html serve karta hai (404 status ke saath) — aur app ka poora
 * clean-URL system (/<vendor>, /admin/<vendor>) usi trick par khada hai.
 * http-server khaali 404 deta hai, koi body nahi, koi app nahi.
 *
 * Iska matlab tha: masked URL ko reload karna local par kabhi kaam hi nahi
 * karta tha, chahe production par bilkul theek ho. stability.spec.js ka
 * "50 sessions" test isi par atak gaya tha — page.reload() /demo par jaata
 * hai aur wahan kuch milta hi nahi.
 *
 * gzip bhi karta hai, kyunki Pages karta hai — bina uske payload ~2.3x bada
 * dikhta hai aur koi bhi size/timing measurement jhootha ho jaata hai.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

// Har request par file padhna + gzipSync karna theek lagta hai jab tak load
// test na chale. index.html 427 KB ka hai; use har hit par dobara compress
// karna single-threaded Node ka event loop block kar deta hai, aur
// multivendor-load (50 vendors) ke andar app ke apne fetch AbortController
// timeout par chale jaate the. Ek baar padho, ek baar gzip karo, mtime badle
// tabhi dobara — dev me file save karne par bhi fresh milta rahe.
const cache = new Map();
function load(file) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return null; }
  if (!stat.isFile()) return null;
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs) return hit;
  const raw = fs.readFileSync(file);
  const ext = path.extname(file);
  const entry = {
    mtime: stat.mtimeMs, raw, ext,
    gz: COMPRESSIBLE.has(ext) ? zlib.gzipSync(raw, { level: 6 }) : null,
  };
  cache.set(file, entry);
  return entry;
}

const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

function send(res, status, entry, acceptEncoding) {
  const headers = {
    'content-type': TYPES[entry.ext] || 'application/octet-stream',
    // Pages jaisa hi — isse cache-related bugs local par bhi reproduce hote hain
    'cache-control': 'max-age=600',
  };
  if (entry.gz && /gzip/.test(acceptEncoding || '')) {
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = entry.gz.length;
    res.writeHead(status, headers);
    return res.end(entry.gz);
  }
  headers['content-length'] = entry.raw.length;
  res.writeHead(status, headers);
  res.end(entry.raw);
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (_) { pathname = '/'; }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, pathname);
  const accept = req.headers['accept-encoding'];

  // Path traversal se bacho — ROOT ke bahar kuch bhi serve nahi
  const hit = filePath.startsWith(ROOT) ? load(filePath) : null;
  if (hit) return send(res, 200, hit, accept);

  // Yahi wo Pages wala behaviour hai: unknown path -> 404.html, 404 status ke
  // saath. App ka clean-URL routing (/<vendor>) isi se chalta hai.
  const notFound = load(path.join(ROOT, '404.html'));
  if (notFound) return send(res, 404, notFound, accept);
  send(res, 404, { raw: Buffer.from('Not found'), ext: '.txt', gz: null }, accept);
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT} (GitHub Pages-style 404.html fallback + gzip)`);
});
