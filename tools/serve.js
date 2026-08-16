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

const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

function send(res, status, body, ext, acceptEncoding) {
  const headers = {
    'content-type': TYPES[ext] || 'application/octet-stream',
    // Pages jaisa hi — isse cache-related bugs local par bhi reproduce hote hain
    'cache-control': 'max-age=600',
  };
  if (COMPRESSIBLE.has(ext) && /gzip/.test(acceptEncoding || '')) {
    const gz = zlib.gzipSync(body, { level: 6 });
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = gz.length;
    res.writeHead(status, headers);
    return res.end(gz);
  }
  headers['content-length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (_) { pathname = '/'; }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, pathname);
  const accept = req.headers['accept-encoding'];

  // Path traversal se bacho — ROOT ke bahar kuch bhi serve nahi
  if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return send(res, 200, fs.readFileSync(filePath), path.extname(filePath), accept);
  }

  // Yahi wo Pages wala behaviour hai: unknown path -> 404.html, 404 status ke
  // saath. App ka clean-URL routing (/<vendor>) isi se chalta hai.
  const notFound = path.join(ROOT, '404.html');
  if (fs.existsSync(notFound)) {
    return send(res, 404, fs.readFileSync(notFound), '.html', accept);
  }
  send(res, 404, Buffer.from('Not found'), '.txt', accept);
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT} (GitHub Pages-style 404.html fallback + gzip)`);
});
