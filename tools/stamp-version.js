#!/usr/bin/env node
/**
 * Har deploy pe shared.js/styles.css ko naya URL deta hai.
 *
 * Kyun zaroori hai: GitHub Pages har asset ko `cache-control: max-age=600`
 * ke saath bhejta hai aur ye setting badli nahi ja sakti. Iska matlab deploy
 * ke baad ~10 minute tak user ko purani shared.js/styles.css mil sakti hai,
 * jabki index.html service worker ki wajah se hamesha taazi aati hai — yani
 * NAYA HTML + PURANI JS, jo sirf late nahi, toot bhi sakta hai.
 *
 * Naya URL har jagah cache-miss hota hai, isliye `?v=<hash>` lagate hi update
 * turant pahunchta hai aur HTML/JS kabhi mismatch nahi hote.
 *
 *   node tools/stamp-version.js          -> stamp kar deta hai
 *   node tools/stamp-version.js --check  -> sirf batata hai (stale ho to exit 1)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'customer.html', 'admin.html', 'superadmin.html'];
const ASSETS = ['assets/shared.js', 'assets/styles.css'];

// Version = in files ke content ka hash. Content badla to hi version badlega,
// yani wahi commit dobara stamp karne se bekaar ka diff nahi banta.
function computeVersion() {
  const h = crypto.createHash('sha1');
  for (const f of ASSETS) h.update(fs.readFileSync(path.join(ROOT, f)));
  for (const p of PAGES) {
    // HTML ka apna hash bhi lo, par pehle purane ?v= nikaal do warna hash
    // khud apne aap ko chase karta rahega.
    const raw = fs.readFileSync(path.join(ROOT, p), 'utf8');
    h.update(stripStamps(raw));
  }
  return h.digest('hex').slice(0, 10);
}

function stripStamps(html) {
  return html
    .replace(/(src="assets\/shared\.js)(\?v=[A-Za-z0-9]+)?"/g, '$1"')
    .replace(/(href="assets\/styles\.css)(\?v=[A-Za-z0-9]+)?"/g, '$1"');
}

function applyStamp(html, version) {
  return stripStamps(html)
    .replace(/src="assets\/shared\.js"/g, `src="assets/shared.js?v=${version}"`)
    .replace(/href="assets\/styles\.css"/g, `href="assets/styles.css?v=${version}"`);
}

const check = process.argv.includes('--check');
const version = computeVersion();
let stale = [];

for (const p of PAGES) {
  const file = path.join(ROOT, p);
  const cur = fs.readFileSync(file, 'utf8');
  const next = applyStamp(cur, version);
  if (cur !== next) {
    stale.push(p);
    if (!check) fs.writeFileSync(file, next);
  }
}

// version.json ko app padhta hai (cache-busting query ke saath) taaki khuli hui
// tabs/PWA ko bhi pata chale ki naya build aa gaya hai.
const vjPath = path.join(ROOT, 'version.json');
const vjNext = JSON.stringify({ version }) + '\n';
const vjCur = fs.existsSync(vjPath) ? fs.readFileSync(vjPath, 'utf8') : '';
if (vjCur !== vjNext) {
  stale.push('version.json');
  if (!check) fs.writeFileSync(vjPath, vjNext);
}

if (check) {
  if (stale.length) {
    console.error(
      `\n  Build stamp stale (expected v=${version}).\n` +
      `  Ye files update honi chahiye: ${stale.join(', ')}\n` +
      `  Chalao:  npm run stamp\n`
    );
    process.exit(1);
  }
  console.log(`build stamp up to date (v=${version})`);
} else {
  console.log(stale.length ? `stamped v=${version} -> ${stale.join(', ')}` : `already stamped (v=${version})`);
}
