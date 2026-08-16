#!/usr/bin/env node
/**
 * Customer-side performance benchmark — "eye blink" check.
 *
 *   npm run perf                       # default: 100 vendors, 50 customers/vendor
 *   N_VENDORS=200 N_CUSTOMERS=100 npm run perf
 *
 * Do cheezein naapta hai:
 *   1. INTERACTION — har customer operation kitne ms leta hai (p50/p95/max)
 *   2. FIRST LOAD  — alag-alag mobile networks par app kab usable hota hai
 *
 * Sab kuch mocked backend ke against chalta hai. REAL Apps Script deployment ko
 * jaan-boojh kar touch nahi karta: wo production hai, use load karna users ko
 * todega aur Google ka quota bhi jala dega. Iska matlab ye FRONTEND ka number
 * hai — backend ka throughput ceiling alag sawaal hai (docs/performance.md).
 *
 * Server khud start karta hai, gzip + max-age ke saath, taaki numbers GitHub
 * Pages jaise hi hon (plain `npm run serve` compress nahi karta — uske against
 * naapoge to payload ~2.3x bada dikhega aur numbers jhoothe honge).
 */
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT        = path.join(__dirname, '..');
const PORT        = Number(process.env.PERF_PORT) || 8091;
const N_VENDORS   = Number(process.env.N_VENDORS) || 100;
const N_CUSTOMERS = Number(process.env.N_CUSTOMERS) || 50;
const REPEATS     = Number(process.env.REPEATS) || 30;
const KLAT = 23.0225, KLNG = 72.5714;
const ORIGIN = 'http://localhost:' + PORT;

// Budgets (human perception): 16ms = 1 frame, 100ms = "turant", 300ms = dikhta hai
const verdict = ms => ms < 16 ? 'INSTANT' : ms < 100 ? 'eye-blink'
                    : ms < 300 ? 'noticeable' : ms < 1000 ? 'SLOW' : 'BROKEN';
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const ms  = n => (n < 10 ? n.toFixed(2) : n.toFixed(1)).padStart(9);

// ── GitHub Pages jaisa static server: gzip + max-age=600 ──
const TYPES = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.json':'application/json',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp' };
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      const ext = path.extname(f), body = fs.readFileSync(f);
      const h = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'max-age=600' };
      if (['.html','.js','.css','.json','.svg'].includes(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        const gz = zlib.gzipSync(body, { level: 9 });
        h['content-encoding'] = 'gzip'; h['content-length'] = gz.length;
        res.writeHead(200, h); return res.end(gz);
      }
      h['content-length'] = body.length; res.writeHead(200, h); res.end(body);
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

const MENU = {};
for (const d of ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
  MENU[d] = { breakfast:'Poha', lunch:'Dal Tadka, Rice, Roti', dinner:'Paneer, Rice, Roti' };

const CONFIG = {
  prices: { extraSabzi:10, dahi:10, extraRotiPlain:5, extraRotiButter:8 },
  kitchenLat: KLAT, kitchenLng: KLNG, deliveryRadiusKm: 5, deliveryEnabled: true,
  township: 'Godrej Garden City', societies: ['Vrindavan', 'Eden'],
  mealTypes: [
    { key:'breakfast', title:'Breakfast', enabled:true, cutoff:'21:00', cutoffAheadDay:true,  price:50 },
    { key:'lunch',     title:'Lunch',     enabled:true, cutoff:'23:59', cutoffAheadDay:false, price:80 },
    { key:'dinner',    title:'Dinner',    enabled:true, cutoff:'23:59', cutoffAheadDay:false, price:80 },
  ],
};

const VENDORS = Array.from({ length: N_VENDORS }, (_, i) => ({
  vendorId: 'kitchen' + i, name: 'Kitchen ' + i,
  cuisine: i % 2 ? 'Gujarati' : 'Punjabi',
  areas: ['Gota','Chandkheda','Vastrapur','Bopal','SG Highway'][i % 5],
  township: 'Godrej Garden City',
  lat: KLAT + (i % 20) * 0.0009, lng: KLNG + (i % 20) * 0.0009,
  deliveryRadiusKm: 5, logo: '', minOrder: 100, rating: 4.2,
  ratingCount: i % 40, listInDiscovery: true,
}));

const ORDERS = [];
for (let c = 0, row = 2; c < N_CUSTOMERS; c++) for (let k = 0; k < 3; k++)
  ORDERS.push({ row: row++, deliveryDate:'2026-08-17', meal:'lunch',
    phone:'98765' + String(10000 + c), name:'Customer ' + c, society:'Vrindavan',
    flat:'D-' + c, status:'Pending', mealStatus:{ lunch:'Pending' }, total:'₹90',
    payment:'COD', paymentStatus:'Unpaid', breakfastQty:0, lunchQty:1, dinnerQty:0,
    lunchSabzi:'Dal Tadka', lunchTiffin:'1 Full Tiffin', lunchRoti:'Plain',
    lunchAddons:'None', lunchTimeSlot:'12–1 PM', time:'16/08 10:00 AM', day:'Monday',
    createdIso: new Date().toISOString().slice(0, 16) });

async function newPage(browser, { cpu = 1, net = null } = {}) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.grantPermissions(['geolocation'], { origin: ORIGIN });
  await ctx.setGeolocation({ latitude: KLAT, longitude: KLNG });
  const page = await ctx.newPage();
  if (cpu > 1 || net) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    if (net) await cdp.send('Network.emulateNetworkConditions',
      { offline:false, downloadThroughput:net.down, uploadThroughput:net.up, latency:net.rtt });
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  }
  await page.route('**/macros/s/**', route => {
    const a = (new URL(route.request().url()).searchParams.get('action') || '').toLowerCase();
    const body = (a === 'vendors' || a === 'discovery') ? { status:'success', vendors: VENDORS }
               : a === 'myorders' ? { status:'success', orders: ORDERS.slice(0, 60) }
               : { status:'success', vendor:{ vendorId:'kitchen0', name:'Kitchen 0', logo:'' },
                   menu: MENU, config: CONFIG, promos: [] };
    route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(body) });
  });
  // External CDNs (Google Sign-In, Razorpay, Firebase, QR) fast-fail karo — ye
  // sab `defer` hain, app inka intezaar nahi karta. Inhe network par chhodne se
  // number app ka nahi, CDN ka ban jaata hai.
  for (const pat of ['**://accounts.google.com/**', '**://checkout.razorpay.com/**',
                     '**://www.gstatic.com/**', '**://api.qrserver.com/**'])
    await page.route(pat, r => r.abort('connectionrefused'));
  await page.addInitScript(() => {
    localStorage.setItem('fbt_onboarded', JSON.stringify(1));
    localStorage.setItem('fbt_infostrip_x', JSON.stringify(1));
    localStorage.setItem('fbt_session', JSON.stringify({ token:'t', name:'Perf User', phone:'9876543210', vid:'kitchen0' }));
    localStorage.setItem('fbt_addr', JSON.stringify({ deliveryType:'home', society:'Vrindavan', flatNo:'D-706', lat:23.044983, lng:72.5714 }));
  });
  return { ctx, page };
}

// app kab USABLE hua — DOMContentLoaded ka wait mat karo, wo `defer` CDN
// scripts par atka rehta hai aur asliyat se bahut bada number deta hai.
async function timeToUsable(page) {
  const t0 = Date.now();
  await page.goto(ORIGIN + '/?v=kitchen0', { waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const el = document.querySelector('#mealPanel, #authPage, #dscList');
    return el && el.offsetHeight > 0 && typeof window.renderCart === 'function';
  }, null, { timeout: 120000 });
  return Date.now() - t0;
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let failures = 0;

  console.log(`\n  ${N_VENDORS} vendors × ${N_CUSTOMERS} customers `
            + `(${ORDERS.length} orders seeded) · ${REPEATS} samples/op · gzip on\n`);

  // ─────────── 1. Interaction latency ───────────
  const { ctx, page } = await newPage(browser);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

  await timeToUsable(page);
  await page.waitForTimeout(1200);

  const results = await page.evaluate(({ vendors, REPEATS }) => {
    const out = {};
    const bench = (name, fn, setup) => {
      const s = [];
      for (let i = 0; i < REPEATS; i++) { if (setup) setup(i); const a = performance.now(); fn(i); s.push(performance.now() - a); }
      out[name] = s;
    };
    dscVendorsAll = vendors;
    bench('discovery list (all vendors)', () => renderDscList(dscVendorsAll));
    bench('discovery nearby (sort+filter)', () => renderDscNearby(dscVendorsAll));
    bench('menu panel render',            () => renderMealPanelNow());
    bench('date switch today<->tomorrow', i => menuChangeDate(i % 2));
    bench('add to cart',                  () => addMealDirect('lunch'), () => { cart = []; });
    cart = [];
    for (let i = 0; i < 20; i++) cart.push({ id:'x'+i, deliveryDate:'2026-08-17', deliveryLabel:'MON',
      day:'Monday', meal:'lunch', qty:1, timeSlot:'12-1 PM', tiffinType:'full',
      variantName:'Full Tiffin', sabzi:'Dal Tadka', price:80 });
    bench('cart render (20 items)',       () => renderCart());
    bench('cart total recompute',         () => cartTotalDisplay());
    bench('delivery fee (haversine)',     () => deliveryFee());
    bench('view switch',                 i => showView(i % 2 ? 'cartView' : 'homeView'));
    return out;
  }, { vendors: VENDORS, REPEATS });

  console.log('  INTERACTION' + ' '.repeat(23) + 'p50      p95      max   verdict');
  console.log('  ' + '-'.repeat(70));
  for (const [name, s] of Object.entries(results)) {
    const p95 = pct(s, 0.95);
    if (p95 >= 100) failures++;
    console.log('  ' + name.padEnd(32) + ms(pct(s, 0.5)) + ms(p95) + ms(Math.max(...s)) + '   ' + verdict(p95));
  }
  await ctx.close();

  // ─────────── 2. First load on real mobile networks ───────────
  console.log('\n  FIRST LOAD (cold cache, 4x CPU throttle)');
  console.log('  ' + '-'.repeat(70));
  console.log('  ' + 'network'.padEnd(12) + 'FCP'.padStart(10) + 'usable'.padStart(11) + 'transfer'.padStart(12) + '   verdict');
  const PROFILES = [
    { name:'Fast 4G', down: 9   * 1024 * 1024 / 8, up: 1.5 * 1024 * 1024 / 8, rtt: 60  },
    { name:'Slow 4G', down: 4   * 1024 * 1024 / 8, up: 1   * 1024 * 1024 / 8, rtt: 150 },
    { name:'Good 3G', down: 1.6 * 1024 * 1024 / 8, up: 750 * 1024 / 8,        rtt: 300 },
    { name:'Slow 3G', down: 400 * 1024 / 8,        up: 400 * 1024 / 8,        rtt: 400 },
  ];
  for (const prof of PROFILES) {
    const { ctx: c2, page: p2 } = await newPage(browser, { cpu: 4, net: prof });
    const usable = await timeToUsable(p2);
    const m = await p2.evaluate(() => {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const n = performance.getEntriesByType('navigation')[0] || {};
      return { fcp: fcp ? Math.round(fcp.startTime) : 0,
               kb: Math.round((performance.getEntriesByType('resource')
                 .reduce((s, r) => s + (r.transferSize || 0), 0) + (n.transferSize || 0)) / 1024) };
    });
    const v = usable < 1000 ? 'instant' : usable < 2500 ? 'acceptable' : usable < 5000 ? 'slow' : 'TOO SLOW';
    console.log('  ' + prof.name.padEnd(12) + (m.fcp + ' ms').padStart(10)
      + (usable + ' ms').padStart(11) + (m.kb + ' KB').padStart(12) + '   ' + v);
    await c2.close();
  }

  console.log('\n  JS errors during run: ' + (errors.length || 'none'));
  errors.slice(0, 5).forEach(e => console.log('    - ' + e));
  if (errors.length) failures++;

  await browser.close();
  server.close();
  console.log('');
  process.exit(failures ? 1 : 0);
})();
