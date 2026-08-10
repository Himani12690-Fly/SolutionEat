const { test, expect } = require('@playwright/test');

// Phase 3 split: admin UI now lives in its own dedicated file.
const APP = process.env.ADMIN_BRAND_APP_URL || 'http://127.0.0.1:8080/admin.html';

function json(route, obj) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
}

async function mockBackend(page, handlers = {}) {
  // Ye file apna alag/independent page-setup use karti hai (tests/helpers.js
  // ka openApp() nahi) — first-run onboarding overlay (position:fixed, poori
  // screen) ko yahan bhi seed karna zaroori hai, warna wo har click intercept
  // kar leta (admin login form ke elements "obscured" reh jaate).
  await page.addInitScript(() => { localStorage.setItem('fbt_onboarded', JSON.stringify(1)); });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('http://127.0.0.1:8080')) return route.continue();
    if (url.includes('script.google.com')) {
      if (req.method() === 'GET') {
        if (url.includes('action=discover')) return json(route, { status: 'success', vendors: [] });
        return json(route, { status: 'success' });
      }
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) { /* ignore */ }
      const h = handlers[body.action];
      if (typeof h === 'function') return h(route, body);
      if (h) return json(route, h);
      return json(route, { status: 'success', orders: [], subs: [], users: [], stats: {} });
    }
    return route.abort();
  });
}

async function openAdmin(page, brandName) {
  await mockBackend(page, { stats: { status: 'success', stats: {} } });
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.showAdminLogin === 'function');
  if (brandName !== undefined) {
    await page.evaluate((nm) => { VENDOR_BRAND = { name: nm, logo: '' }; applyVendorBrand(); }, brandName);
  }
  await page.evaluate(() => window.showAdminLogin());
  await page.fill('#adminUser', 'admin');
  await page.fill('#adminPass', 'adminpass');
  await page.click('#loginBtn');
  await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 15000 });
}

test('1. admin topbar me vendor naam dikhta hai', async ({ page }) => {
  await openAdmin(page, 'Shyam Rasoi');
  await expect(page.locator('.atb-branded .atb-vname')).toHaveText('Shyam Rasoi');
  await expect(page.locator('.atb-branded .atb-vname')).toBeVisible();
});

test('2. logo element bhara jaata hai (letter avatar fallback)', async ({ page }) => {
  await openAdmin(page, 'Shyam Rasoi');
  const logo = page.locator('.atb-branded .atb-logo');
  await expect(logo).toBeVisible();
  const src = await logo.getAttribute('src');
  expect(src).toContain('data:image/svg+xml');   // naam ka pehla akshar wala avatar
  expect(await logo.getAttribute('alt')).toBe('Shyam Rasoi');
});

test('3. section title ab bhi tab ke saath badalta hai', async ({ page }) => {
  await openAdmin(page, 'Shyam Rasoi');
  await expect(page.locator('#adminSectionTitle')).toContainText('Orders');
  await page.evaluate(() => window.adminBnGo('menu'));
  await expect(page.locator('#adminSectionTitle')).not.toContainText('Orders');
  await page.evaluate(() => window.adminBnGo('orders'));
  await expect(page.locator('#adminSectionTitle')).toContainText('Orders');
});

test('4. lamba naam → naam truncate, section title poora dikhta hai', async ({ page }) => {
  await openAdmin(page, 'Maa Annapurna Tiffin & Catering Service Ahmedabad');
  const title = page.locator('#adminSectionTitle');
  await expect(title).toBeVisible();

  // title kabhi clip na ho
  const t = await title.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(t.sw).toBeLessThanOrEqual(t.cw + 1);

  // naam clip HO (ellipsis lag raha hai)
  const n = await page.locator('.atb-vname').evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(n.sw).toBeGreaterThan(n.cw);
});

test('5. topbar ek hi line me rehta hai (height nahi badhi)', async ({ page }) => {
  await openAdmin(page, 'Shyam Rasoi');
  const h = await page.locator('.atb-branded').evaluate(el => el.getBoundingClientRect().height);
  expect(h).toBeLessThan(64);   // do-row layout hota to ~90px+ hota
});

test('6. brand load nahi hua → dot chhupa, sirf section title', async ({ page }) => {
  await openAdmin(page);   // brand set hi nahi kiya
  await page.evaluate(() => { VENDOR_BRAND = { name: '', logo: '' }; applyVendorBrand(); });
  await expect(page.locator('.atb-branded .atb-vname')).toBeHidden();
  await expect(page.locator('.atb-branded .atb-dot')).toBeHidden();
  await expect(page.locator('#adminSectionTitle')).toBeVisible();
});

test('7. alert toggle brand ke saath bhi visible aur clickable hai', async ({ page }) => {
  await openAdmin(page, 'Maa Annapurna Tiffin & Catering Service Ahmedabad');
  const at = page.locator('.atb-branded .alert-toggle');
  await expect(at).toBeVisible();
  const box = await at.boundingBox();
  expect(box.width).toBeGreaterThan(40);   // squeeze nahi hua
});

test('8. customer header ka brand nahi toota', async ({ page }) => {
  await mockBackend(page);
  await page.goto(APP);
  await page.waitForFunction(() => typeof window.applyVendorBrand === 'function');
  await page.evaluate(() => { VENDOR_BRAND = { name: 'Shyam Rasoi', logo: '' }; applyVendorBrand(); });
  const names = await page.locator('.vbrand-name').count();
  expect(names).toBeGreaterThan(1);   // customer + admin dono jagah
  const filled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.vbrand-name')).every(e => e.textContent === 'Shyam Rasoi'));
  expect(filled).toBe(true);
});
