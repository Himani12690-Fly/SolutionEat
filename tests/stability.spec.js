/**
 * Stability measurement — 25 vendors / 50+ clients, mocked backend.
 *
 * Ad-hoc measurement run (not part of the regression suite) — reports real
 * numbers from actually running the scenarios, not estimates.
 */
const { test, expect } = require('@playwright/test');
const { openApp, freshState, todayIST, SESSION } = require('./helpers');

const N_VENDORS = Number(process.env.STAB_VENDORS) || 25;
const N_CLIENTS = Number(process.env.STAB_CLIENTS) || 50;
const AREAS = ['Gota', 'Chandkheda', 'Vastrapur', 'Bopal', 'SG Highway'];
const MEALS = ['breakfast', 'lunch', 'dinner'];

function seedOrder(state, over = {}) {
  const row = state.nextRow++;
  state.orders.push(Object.assign({
    row, deliveryDate: todayIST(0), meal: 'lunch', phone: '9876500000',
    name: 'Client', society: 'Vrindavan', flat: 'D-1',
    status: 'Pending', mealStatus: { lunch: 'Pending' },
    total: '₹90', payment: 'COD', paymentStatus: 'Unpaid',
    breakfastQty: 0, lunchQty: 1, dinnerQty: 0,
    lunchSabzi: 'Dal Tadka', lunchTiffin: '1 Full Tiffin', lunchRoti: 'Plain',
    lunchAddons: 'None', lunchTimeSlot: '12–1 PM', dinnerSabzi: '', dinnerTiffin: '',
    dinnerRoti: '', dinnerAddons: 'None', note: '', promo: '', deliveryType: 'home',
    time: '01/01 10:00 AM', day: 'Monday', createdIso: new Date().toISOString().slice(0, 16),
  }, over));
  return row;
}

const results = {};

test('A: Discovery renders 25 vendors', async ({ page }) => {
  // Location is now mandatory app-wide — Discovery's ONLY path is the GPS
  // "near you" one (openApp() grants geolocation by default), the old
  // area-chip/full-browse fallback this test used to measure no longer
  // exists in the normal flow. Seed vendors with lat/lng near the default
  // granted position instead, so this still measures real render-at-scale
  // performance through the path that's actually reachable.
  const CUSTOMER_LAT = 23.0225, CUSTOMER_LNG = 72.5714;
  const state = freshState();
  state.discoveryVendors = Array.from({ length: N_VENDORS }, (_, i) => ({
    vendorId: 'kitchen' + i, name: 'Kitchen ' + i,
    cuisine: i % 2 ? 'Gujarati' : 'Punjabi', areas: [AREAS[i % AREAS.length]],
    lat: CUSTOMER_LAT + (i % 5) * 0.001, lng: CUSTOMER_LNG + (i % 5) * 0.001, deliveryRadiusKm: 50,
    logo: '', minOrder: 100, ratingCount: i % 4, rating: 4.2,
  }));
  await openApp(page, { state, loggedIn: false });
  const t0 = Date.now();
  await page.evaluate(() => window.openDiscovery());
  // Card class is `.zrc` (Zomato-style redesign) — NOT `.kit`, an older markup
  // this test was mistakenly still targeting from before that redesign landed.
  await expect(page.locator('#dscNearList .zrc')).toHaveCount(N_VENDORS, { timeout: 15000 });
  results.discovery = { vendors: N_VENDORS, renderMs: Date.now() - t0, ok: true };
});

test('B: 50 concurrent client order submissions', async ({ page }) => {
  const state = freshState();
  await openApp(page, { state });
  const t0 = Date.now();
  const outcomes = await page.evaluate(async ({ n, token }) => {
    const M = ['breakfast', 'lunch', 'dinner'];
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const meal = M[i % 3];
      const dateOffset = Math.floor(i / 3);
      const d = new Date(); d.setDate(d.getDate() + dateOffset);
      const payload = {
        action: 'order', token, deliveryDate: d.toISOString().slice(0, 10),
        deliveryLabel: 'x', day: 'Monday', society: 'Vrindavan', flatNo: 'D-' + i,
        deliveryType: 'home', name: 'Client ' + i, note: '', payment: 'COD',
        items: [{ meal, tiffinType: 'full', qty: 1 }],
      };
      payload[meal + 'Qty'] = 1;
      const start = performance.now();
      jobs.push(window.apiPost(payload).then((r) => ({ status: r.status, ms: performance.now() - start })));
    }
    return Promise.all(jobs);
  }, { n: N_CLIENTS, token: SESSION.token });
  const elapsed = Date.now() - t0;
  const succeeded = outcomes.filter((o) => o.status === 'success').length;
  const avgMs = Math.round(outcomes.reduce((s, o) => s + o.ms, 0) / outcomes.length);
  const maxMs = Math.round(Math.max(...outcomes.map((o) => o.ms)));
  results.orderThroughput = { clients: N_CLIENTS, succeeded, totalMs: elapsed, avgPerOrderMs: avgMs, maxPerOrderMs: maxMs, orderCountInState: state.orders.length };
  expect(succeeded).toBe(N_CLIENTS);
});

test('C: Admin panel renders orders from all 50 clients', async ({ page }) => {
  const state = freshState();
  for (let i = 0; i < N_CLIENTS; i++) {
    seedOrder(state, { phone: '98765' + String(i).padStart(5, '0'), name: 'Client ' + i, meal: MEALS[i % 3] });
  }
  await openApp(page, { state });
  const t0 = Date.now();
  await page.evaluate(() => { adminCreds = { user: 'demo', pass: 'demo123' }; });
  await page.evaluate(() => { showView('adminPanel'); loadOrders(); loadUsers(); });
  // loadOrders() auto-selects a meal (jiske orders hon) aur grouped/society
  // checklist view khol deta hai — .oc wale full order cards sirf 'All' view me
  // dikhte hain (same as volume.spec.js's admin-orders test). Seeded orders
  // breakfast/lunch/dinner sabme cycle karte hain, isliye auto-pick se pehle
  // Kitchen Summary load hone ka wait karo, phir 'All' pe force karo.
  await page.waitForFunction(
    () => { const el = document.getElementById('kitchenSummary'); return el && !el.textContent.includes('Loading'); },
    { timeout: 15000 },
  ).catch(() => {});
  await page.evaluate(() => window.setMealFilter('All'));
  await page.waitForFunction((w) => document.querySelectorAll('#ordersList .oc').length >= w, N_CLIENTS, { timeout: 15000 }).catch(() => {});
  const count = await page.locator('#ordersList .oc').count();
  results.adminRender = { seededOrders: N_CLIENTS, renderedCount: count, renderMs: Date.now() - t0, ok: count === N_CLIENTS };
  expect(count).toBe(N_CLIENTS);
});

// 50 browser contexts EK SAATH kholna GitHub ke 2-core runner ko thrash kar
// deta tha aur test 60s ki default limit cross kar jaata tha (locally 8-core
// par pass hota tha — classic "mere machine par to chalta hai"). Test ka
// maqsad concurrency nahi, session isolation hai: 50 alag sessions apas me
// leak na karein. Isliye ab batches me chalate hain — utne hi 50 sessions,
// bas runner ko ek saath 50 Chromium na uthane padein.
const SESSION_BATCH = 8;
test('D: 50 separate client sessions — login, order, refresh, verify state holds', async ({ browser }) => {
  test.setTimeout(180_000);
  const sharedState = freshState();
  const t0 = Date.now();
  const runClient = async (i) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const cStart = Date.now();
      await page.addInitScript((s) => {
        // ?v=demo is non-default -> storeGet/storeSet namespace keys as 'demo_'+key
        localStorage.setItem('demo_fbt_session', JSON.stringify(s));
      }, SESSION);
      await page.goto('http://localhost:8080/index.html?v=demo', { waitUntil: 'load' });
      const loggedIn = await page.evaluate(() => window.isLoggedIn && window.isLoggedIn());
      // Simulate refresh — the exact trigger from the real bug report.
      // Address bar ab masked clean path (/demo) dikhata hai, to refresh asli
      // Pages chain se guzarta hai: /demo -> 404.html -> location.replace
      // ('/?v=demo') -> app boot -> wapas /demo mask. Us beech me 404.html ki
      // redirect pehli navigation ko supersede kar deti hai, isliye
      // waitUntil:'load' apna load event kabhi dekh hi nahi paata aur hang ho
      // jaata hai. 'commit' par chhod kar app ke ready hone ka wait karo —
      // asli condition wahi hai, aur ye poori chain ko bhi cover karta hai.
      await page.reload({ waitUntil: 'commit' }).catch(() => {});
      await page.waitForFunction(
        () => typeof window.isLoggedIn === 'function',
        null,
        { timeout: 30000 }
      );
      const stillLoggedIn = await page.evaluate(() => window.isLoggedIn && window.isLoggedIn());
      const leakedOrdersView = await page.evaluate(() => {
        const el = document.getElementById('ordersView');
        return el && !el.classList.contains('hidden');
      });
      return { i, ok: loggedIn && stillLoggedIn && !leakedOrdersView, ms: Date.now() - cStart };
    } finally {
      await ctx.close();
    }
  };
  const perClient = [];
  for (let start = 0; start < N_CLIENTS; start += SESSION_BATCH) {
    const batch = Array.from(
      { length: Math.min(SESSION_BATCH, N_CLIENTS - start) },
      (_, k) => runClient(start + k)
    );
    perClient.push(...await Promise.all(batch));
  }
  const elapsed = Date.now() - t0;
  const okCount = perClient.filter((c) => c.ok).length;
  const avgMs = Math.round(perClient.reduce((s, c) => s + c.ms, 0) / perClient.length);
  results.sessionStability = { clients: N_CLIENTS, ok: okCount, totalMs: elapsed, avgPerClientMs: avgMs };
  expect(okCount).toBe(N_CLIENTS);
});

test.afterAll(() => {
  console.log('STABILITY_RESULTS_JSON=' + JSON.stringify(results));
});
