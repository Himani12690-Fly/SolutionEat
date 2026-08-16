/**
 * Multi-vendor load & reliability test — N independent vendors, each with its
 * own distinct pricing/societies/variants, placing many varied meal-combination
 * orders concurrently against its own mocked backend.
 *
 * Unlike stability.spec.js (which drives many clients against ONE vendor), this
 * exercises many DIFFERENT vendor configs at once — the real multi-tenant shape
 * of this app (one Apps Script + one Sheet per vendor). Each Playwright browser
 * context gets its own freshState() + its own page.route() mock, so vendor A's
 * backend and vendor B's backend cannot physically share data — the value here
 * is catching (a) any hardcoded/global assumption that breaks under a non-default
 * vendor config, and (b) server-side price math errors, by independently
 * recomputing the expected total per order from THAT vendor's own prices and
 * asserting it against what the mock actually returned.
 *
 * Ad-hoc measurement run (not part of the regression suite) — reports real
 * numbers, not estimates.
 */
const { test, expect } = require('@playwright/test');
const { freshState, todayIST, SESSION, APP_URL, openApp, adminLogin } = require('./helpers');
const { CONFIG, MENU } = require('./fixtures');

const N_VENDORS = Number(process.env.LOAD_VENDORS) || 50;
const ORDERS_PER_VENDOR = Number(process.env.LOAD_ORDERS_PER_VENDOR) || 6;
const ADMIN_SPOTCHECKS = Math.min(N_VENDORS, Number(process.env.LOAD_ADMIN_SPOTCHECKS) || 8);

// ── Per-vendor config: same shape as fixtures.js CONFIG, but every price,
// society name and variant set is shifted by vendor index — so if any order's
// total was computed with the WRONG vendor's numbers, the assertion catches it. ──
function buildVendorConfig(i) {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  cfg.variants.lunch[0].price = 70 + (i % 6) * 10;   // full tiffin: 70..120
  cfg.variants.lunch[1].price = 50 + (i % 6) * 8;    // mini tiffin: 50..90
  cfg.variants.dinner[0].price = 65 + (i % 5) * 12;
  cfg.variants.dinner[1].price = 45 + (i % 5) * 9;
  cfg.variants.breakfast[0].price = 25 + (i % 4) * 5;
  cfg.prices.extraRotiPlain = 8 + (i % 3) * 2;
  cfg.prices.extraRotiButter = 12 + (i % 3) * 3;
  cfg.prices.dahi = 15 + (i % 4) * 5;
  cfg.prices.extraSabzi = 20 + (i % 4) * 5;
  cfg.deliveryNear = 5 + (i % 3) * 5;
  cfg.deliveryFar = 15 + (i % 3) * 10;
  cfg.societies = ['Near' + i, 'Far' + i];
  cfg.farSocieties = ['Far' + i];
  cfg.mealTypes[0].price = cfg.variants.breakfast[0].price;
  cfg.mealTypes[1].price = cfg.variants.lunch[0].price;
  cfg.mealTypes[2].price = cfg.variants.dinner[0].price;
  return cfg;
}

function buildVendorState(i) {
  const state = freshState();
  const vendorId = 'loadv' + i;
  state.config = buildVendorConfig(i);
  state.menu = JSON.parse(JSON.stringify(MENU));
  state.vendors = [{ vendorId, name: 'Load Kitchen ' + i, sheetId: 'SHEET_LOAD_' + i,
    notifyEmail: 'a@b.com', status: 'Active', isDefault: false,
    subStatus: 'exempt', subDueDate: '', subLastPaid: '', subAmount: 499 }];
  return { vendorId, state };
}

// ── Order-combination generator — cycles meal type, tiffin size, roti/dahi/
// extra-sabzi add-ons, home/office delivery and COD/UPI payment across orders,
// each on its own future date to sidestep same-day dup/fee-waiver rules
// (already covered by customer.spec.js) and keep the math predictable here. ──
function buildOrder(vendorState, orderIdx) {
  const meals = ['breakfast', 'lunch', 'dinner'];
  const meal = meals[orderIdx % meals.length];
  const variants = vendorState.config.variants[meal];
  const variant = variants[orderIdx % variants.length];
  const extraRoti = meal !== 'breakfast' ? (orderIdx % 3) : 0;
  const butterRoti = orderIdx % 2 === 0;
  const dahi = meal !== 'breakfast' && orderIdx % 2 === 1;
  const extraSabzi = meal !== 'breakfast' && orderIdx % 4 === 0;
  const deliveryType = orderIdx % 5 === 0 ? 'office' : 'home';
  const society = vendorState.config.societies[orderIdx % vendorState.config.societies.length];
  const payment = orderIdx % 2 === 0 ? 'COD' : 'UPI';
  const d = new Date(); d.setDate(d.getDate() + orderIdx + 1);
  const deliveryDate = d.toISOString().slice(0, 10);

  const payload = {
    action: 'order', token: SESSION.token, deliveryDate,
    deliveryLabel: 'x', day: 'Monday', society, flatNo: 'F-' + orderIdx,
    deliveryType, name: 'Client', note: '', payment,
    items: [{ meal, tiffinType: variant.id, qty: 1, extraRoti, butterRoti, dahi, extraSabzi }],
  };
  payload[meal + 'Qty'] = 1;

  let unit = variant.price;
  if (meal !== 'breakfast') {
    unit += extraRoti * (butterRoti ? vendorState.config.prices.extraRotiButter : vendorState.config.prices.extraRotiPlain);
    if (dahi) unit += vendorState.config.prices.dahi;
    if (extraSabzi) unit += vendorState.config.prices.extraSabzi;
  }
  const fee = vendorState.config.farSocieties.includes(society) ? vendorState.config.deliveryFar : vendorState.config.deliveryNear;
  const expectedTotal = unit + fee;
  return { payload, expectedTotal, meal, variant: variant.id, extraRoti, butterRoti, dahi, extraSabzi, deliveryType, payment, society };
}

// 50 contexts ek saath kholna CI ke 2-core runner par do tarah se toota:
// pehle server-side (har request par gzip — dekho tools/serve.js), aur wo theek
// karne ke baad Playwright ke apne protocol par — "Object with guid response@…
// was not bound in the connection", jab route handlers context teardown se race
// karte hain. Test ka maqsad simultaneous browsers nahi hai: ye 50 ALAG vendor
// configs ka isolation aur price math check karta hai. Batches me utne hi 50
// vendors chalte hain, bas runner par ek saath 50 Chromium nahi hote.
// (Isi file ka Admin spot-check 8 contexts par hamesha theek raha.)
const VENDOR_BATCH = 16;

test(`Multi-vendor load: ${N_VENDORS} vendors x ${ORDERS_PER_VENDOR} varied orders each`, async ({ browser }) => {
  // Batching se wall-time badhta hai (batches ab serial hain), isliye budget bhi
  // badhao — aur khul kar. Ye test do baar isliye toota kyunki budget tight tha,
  // jabki pass hone par bada timeout kuch kharch nahi karta. 8-core par 124s
  // lagta hai; CI ka 2-core runner isse kaafi dheema hai.
  test.setTimeout(Math.max(240000, N_VENDORS * 9000));
  const t0 = Date.now();

  const runVendor = async (i) => {
    const { vendorId, state } = buildVendorState(i);
    const ctx = await browser.newContext();
    const consoleErrors = [];
    try {
      const page = await ctx.newPage();
      // At very high concurrency (100s of simultaneous real browser contexts on
      // one machine — not a shape production traffic ever takes, where clients
      // aren't sharing one host's network stack) Chromium itself throws transient
      // net::ERR_NETWORK_CHANGED/ERR_INTERNET_DISCONNECTED noise unrelated to any
      // app bug — confirmed by orders still succeeding with correct totals even
      // on contexts that logged it. Recorded but not treated as a failure signal.
      const BENIGN_NETWORK_NOISE = /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET/;
      page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !BENIGN_NETWORK_NOISE.test(m.text())) consoleErrors.push('console: ' + m.text());
      });

      // Mock this vendor's own backend on this context only.
      await openApp(page, { state, vendor: vendorId });

      const orders = Array.from({ length: ORDERS_PER_VENDOR }, (_, j) => buildOrder({ config: state.config }, j));
      const vStart = Date.now();
      const outcomes = await page.evaluate(async (payloads) => {
        return Promise.all(payloads.map((pl) => {
          const start = performance.now();
          return window.apiPost(pl).then((r) => ({ status: r.status, total: r.total, ms: performance.now() - start }));
        }));
      }, orders.map((o) => o.payload));
      const vMs = Date.now() - vStart;

      let succeeded = 0, priceCorrect = 0;
      const mismatches = [];
      outcomes.forEach((o, idx) => {
        if (o.status === 'success') {
          succeeded++;
          if (o.total === orders[idx].expectedTotal) priceCorrect++;
          else mismatches.push({ vendorId, orderIdx: idx, expected: orders[idx].expectedTotal, got: o.total, combo: orders[idx] });
        }
      });

      return {
        vendorId, ok: succeeded === ORDERS_PER_VENDOR && priceCorrect === ORDERS_PER_VENDOR,
        succeeded, priceCorrect, total: ORDERS_PER_VENDOR, ms: vMs,
        bootErrors: consoleErrors, mismatches,
      };
    } finally {
      await ctx.close();
    }
  };

  const perVendor = [];
  for (let start = 0; start < N_VENDORS; start += VENDOR_BATCH) {
    const batch = Array.from(
      { length: Math.min(VENDOR_BATCH, N_VENDORS - start) },
      (_, k) => runVendor(start + k)
    );
    perVendor.push(...await Promise.all(batch));
  }

  const elapsed = Date.now() - t0;
  const vendorsOk = perVendor.filter((v) => v.ok).length;
  const totalOrders = perVendor.reduce((s, v) => s + v.total, 0);
  const totalSucceeded = perVendor.reduce((s, v) => s + v.succeeded, 0);
  const totalPriceCorrect = perVendor.reduce((s, v) => s + v.priceCorrect, 0);
  const bootErrorVendors = perVendor.filter((v) => v.bootErrors.length > 0);
  const avgVendorMs = Math.round(perVendor.reduce((s, v) => s + v.ms, 0) / perVendor.length);
  const allMismatches = perVendor.flatMap((v) => v.mismatches);

  console.log('MULTIVENDOR_LOAD_RESULTS_JSON=' + JSON.stringify({
    vendors: N_VENDORS, ordersPerVendor: ORDERS_PER_VENDOR,
    vendorsFullyOk: vendorsOk, totalMs: elapsed, avgPerVendorMs: avgVendorMs,
    totalOrders, totalSucceeded, totalPriceCorrect,
    bootErrorVendorCount: bootErrorVendors.length,
    bootErrorSample: bootErrorVendors.slice(0, 3).map((v) => ({ vendorId: v.vendorId, errors: v.bootErrors.slice(0, 2) })),
    priceMismatchSample: allMismatches.slice(0, 5),
  }));

  expect(bootErrorVendors, `${bootErrorVendors.length} vendor(s) had console/page errors on boot: ` +
    JSON.stringify(bootErrorVendors.slice(0, 3))).toHaveLength(0);
  expect(totalSucceeded, `${totalOrders - totalSucceeded} order(s) failed`).toBe(totalOrders);
  expect(totalPriceCorrect, `${totalSucceeded - totalPriceCorrect} order(s) computed the WRONG total — ` +
    'possible cross-vendor price bleed: ' + JSON.stringify(allMismatches.slice(0, 5))).toBe(totalSucceeded);
  expect(vendorsOk).toBe(N_VENDORS);
});

test(`Admin spot-check: ${ADMIN_SPOTCHECKS} vendors show only their own orders`, async ({ browser }) => {
  test.setTimeout(Math.max(60000, ADMIN_SPOTCHECKS * 5000));
  const t0 = Date.now();

  const results = await Promise.all(Array.from({ length: ADMIN_SPOTCHECKS }, async (_, k) => {
    const i = Math.floor((k * N_VENDORS) / ADMIN_SPOTCHECKS); // spread picks across the full vendor range
    const { vendorId, state } = buildVendorState(i);
    // Seed distinct-customer orders directly (bypassing API) — simulates many
    // different customers having ordered from this vendor, the way admin.spec.js
    // and stability.spec.js's test C already do for a single vendor.
    const NAMES = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Isha', 'Vihaan', 'Anaya'];
    for (let c = 0; c < 8; c++) {
      const row = state.nextRow++;
      state.orders.push({
        row, deliveryDate: todayIST(0), meal: ['breakfast', 'lunch', 'dinner'][c % 3],
        phone: '90000' + String(i).padStart(2, '0') + String(c).padStart(3, '0'),
        name: NAMES[c] + ' V' + i, society: state.config.societies[c % 2], flat: 'D-' + c,
        status: 'Pending', mealStatus: { [['breakfast', 'lunch', 'dinner'][c % 3]]: 'Pending' },
        total: '₹' + (80 + i), payment: 'COD', paymentStatus: 'Unpaid',
        breakfastQty: c % 3 === 0 ? 1 : 0, lunchQty: c % 3 === 1 ? 1 : 0, dinnerQty: c % 3 === 2 ? 1 : 0,
        lunchSabzi: 'Dal Tadka', lunchTiffin: '1 Full Tiffin', lunchRoti: 'Plain', lunchAddons: 'None',
        dinnerSabzi: '', dinnerTiffin: '', dinnerRoti: '', dinnerAddons: 'None',
        note: '', promo: '', deliveryType: 'home',
        time: '01/01 10:00 AM', day: 'Monday', createdIso: new Date().toISOString().slice(0, 16),
      });
    }
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await openApp(page, { state, vendor: vendorId });
      await adminLogin(page);
      await page.evaluate(() => { window.loadOrders(); window.loadUsers(); });
      await page.waitForFunction(
        () => { const el = document.getElementById('kitchenSummary'); return el && !el.textContent.includes('Loading'); },
        { timeout: 15000 },
      ).catch(() => {});
      await page.evaluate(() => window.setMealFilter && window.setMealFilter('All'));
      await page.waitForFunction((w) => document.querySelectorAll('#ordersList .oc').length >= w, 8, { timeout: 15000 }).catch(() => {});
      const renderedCount = await page.locator('#ordersList .oc').count();
      const renderedText = await page.locator('#ordersList').innerText().catch(() => '');
      // Cross-vendor leak check: another vendor's marker name should never appear.
      const otherVendorLeak = renderedText.includes('V' + ((i + 1) % N_VENDORS) + ' ');
      return { vendorId, expected: 8, renderedCount, ok: renderedCount === 8 && !otherVendorLeak, otherVendorLeak };
    } finally {
      await ctx.close();
    }
  }));

  const elapsed = Date.now() - t0;
  const okCount = results.filter((r) => r.ok).length;
  console.log('MULTIVENDOR_ADMIN_RESULTS_JSON=' + JSON.stringify({
    spotChecks: ADMIN_SPOTCHECKS, ok: okCount, totalMs: elapsed,
    failures: results.filter((r) => !r.ok),
  }));
  expect(okCount).toBe(ADMIN_SPOTCHECKS);
});
