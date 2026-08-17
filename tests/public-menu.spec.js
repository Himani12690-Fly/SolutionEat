/**
 * Public menu page (menu.html) — login ke bina aaj ka menu.
 *
 * Pehla-baar wala customer vendor ka link kholta tha aur seedha LOGIN par
 * pahunchta tha. Ye page wahi gate hata deta hai: menu bina login dikhta hai,
 * aur login sirf order karte waqt maanga jaata hai.
 *
 * Ye spec openApp() helper use NAHI karta. Wajah: openApp poore app ko boot
 * karta hai (session, geolocation gate, service worker, shared.js) — is page ke
 * paas unme se kuch bhi nahi hai. Yahan sirf ek cheez chahiye: backend ka
 * bootstrap response. Wahi stub karte hain.
 */
const { test, expect } = require('@playwright/test');
const { CONFIG, MENU } = require('./fixtures');

const PAGE = (process.env.APP_URL || 'http://localhost:8080/index.html').replace(/[^/]+$/, 'menu.html');

function bootstrap(over = {}) {
  return {
    status: 'success',
    menu: JSON.parse(JSON.stringify(MENU)),
    config: Object.assign(JSON.parse(JSON.stringify(CONFIG)), over.config || {}),
    promos: [],
    vendor: Object.assign({ name: 'Nest & Nosh', logo: '', whatsapp: '', scriptUrl: '' }, over.vendor || {}),
  };
}

async function openMenu(page, { vendor = 'nestandnosh', body = null } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/script.google.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(body || bootstrap()),
  }));
  await page.goto(PAGE + '?v=' + vendor, { waitUntil: 'domcontentloaded' });
  return errors;
}

test.describe('Public menu page', () => {
  test('aaj ka menu bina login dikhta hai', async ({ page }) => {
    const errors = await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Login ka koi nishaan nahi hona chahiye — na form, na Google button.
    await expect(page.locator('#gBtn')).toHaveCount(0);
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);
    await expect(page.locator('#vname')).toHaveText('Nest & Nosh');
    // Har ON meal ka apna card.
    const on = CONFIG.mealTypes.filter(m => m.enabled !== false).length;
    await expect(page.locator('.mc')).toHaveCount(on);
    expect(errors).toEqual([]);
  });

  test('aaj ki sabzi aur variants dono dikhte hain', async ({ page }) => {
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    const chips = await page.locator('.chip').allTextContents();
    // fixtures ke DAY se — har din ka menu same hai, isliye weekday matter nahi karta.
    expect(chips).toContain('Paneer Butter Masala');
    expect(chips).toContain('Aloo Gobi');
    // Variants (Mini/Full Tiffin) bhi list hote hain, apne daam ke saath.
    expect(await page.locator('.vr').count()).toBeGreaterThan(0);
  });

  test('app ka link usi kitchen par bhejta hai', async ({ page }) => {
    await openMenu(page, { vendor: 'hungrybirds' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(await page.getAttribute('#orderBtn', 'href')).toBe('/?v=hungrybirds');
  });

  test('WhatsApp na ho to app/login hi poora button rehta hai', async ({ page }) => {
    // Ye hi ek matra raasta bachta hai — ise chhota karna dead end bana dega.
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('#orderBtn')).not.toHaveClass(/sub/);
    await expect(page.locator('#orderBtn')).toContainText('Order Now');
  });

  test('kitchen band ho to menu phir bhi dikhta hai, par saaf likha hota hai', async ({ page }) => {
    await openMenu(page, { body: bootstrap({ config: { tempClosed: true, tempClosedMsg: 'Kal se shuru.' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Menu chhupana galat hoga — customer ko pata hona chahiye kya milta hai.
    expect(await page.locator('.mc').count()).toBeGreaterThan(0);
    await expect(page.locator('#note')).toBeVisible();
    await expect(page.locator('#note')).toContainText('Kal se shuru');
  });

  test('galat kitchen link par saaf message, khaali page nahi', async ({ page }) => {
    await openMenu(page, { vendor: 'nosuchkitchen', body: { status: 'error', message: 'vendor_not_found' } });
    await page.waitForSelector('.ld', { timeout: 15000 });
    await expect(page.locator('.ld')).toContainText('mili nahi');
  });

  test('backend down ho to bhi kuch samajh me aata hai', async ({ page }) => {
    page.on('pageerror', () => {});
    await page.route('**/script.google.com/**', r => r.abort());
    await page.goto(PAGE + '?v=nestandnosh', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ld', { timeout: 15000 });
    await expect(page.locator('.ld')).toContainText('load nahi hua');
  });

  test('cutoff meal ke naam ke peeche hai — alag lines nahi', async ({ page }) => {
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Pehle do alag lines thi: serving window aur "aaj ka time nikal gaya" chip.
    // Customer ko ek hi cheez chahiye — kab tak order kar sakta hai.
    await expect(page.locator('.mc-tm')).toHaveCount(0);
    await expect(page.locator('.mc-late')).toHaveCount(0);
    const lunch = CONFIG.mealTypes.find(m => m.key === 'lunch');
    await expect(page.locator('.mc-ti').filter({ hasText: 'Lunch' })).toContainText('order by');
    expect(lunch.cutoff).toBeTruthy();   // fixture cutoff ke bina test bekaar hai
  });

  test('phone dark mode me ho to bhi menu light rehta hai', async ({ page }) => {
    // Ye link ajnabiyon ko jaata hai — printed menu card ki tarah har phone par
    // ek hi tarah dikhna chahiye. App ke andar dark mode chalta hai, yahan nahi.
    await page.emulateMedia({ colorScheme: 'dark' });
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    await page.evaluate(() => localStorage.setItem('fbt_theme', '"dark"'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(245, 238, 224)');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.mc')).backgroundColor)).toBe('rgb(255, 255, 255)');
  });

  test('kitchen ka WhatsApp number ho to bina login order kar sakte hain', async ({ page }) => {
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '9876543210' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('#waBtn')).toBeVisible();
    const href = await page.getAttribute('#waBtn', 'href');
    // 10-digit number 91 ke saath jaana chahiye, warna wa.me link kaam nahi karta.
    expect(href).toContain('https://wa.me/919876543210?text=');
    const msg = decodeURIComponent(href.split('?text=')[1]);
    expect(msg).toContain('Nest & Nosh');
    // Message aise hi bhejne layak hona chahiye. Pehle ye "Mujhe ye chahiye:"
    // par khatam hota tha — customer ko samajh nahi aaya ki usse kya likhna hai.
    expect(msg.trim()).toMatch(/order karna hai\.$/);
    expect(msg).not.toContain('chahiye:');
    await expect(page.locator('#foot')).toContainText('WhatsApp par login ki zaroorat nahi');
    // Do barabar ke button ek dusre se ladte hain — WhatsApp mile to app/login
    // us ke neeche chhoti line ban jaata hai.
    await expect(page.locator('#orderBtn')).toHaveClass(/sub/);
  });

  test('WhatsApp number na ho to button dikhta hi nahi', async ({ page }) => {
    // App me number na milne par platform owner ke number par fallback hota hai.
    // Yahan wo KABHI nahi — ye page ajnabiyon ka hai, aur kisi ka order galat
    // number par chala jaana sabse bura outcome hai.
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('#waBtn')).toBeHidden();
    await expect(page.locator('#foot')).toContainText('login zaroori hai');
  });

  test('adhoora WhatsApp number bhi button nahi dikhata', async ({ page }) => {
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '98765' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('#waBtn')).toBeHidden();
  });

  test('menu aane se pehle "Loading Today\'s Menu" dikhta hai', async ({ page }) => {
    // Pehle do khaali grey dabbe the — ajnabi ko "page toot gaya" jaisa lagta hai.
    let release;
    const held = new Promise(r => { release = r; });
    await page.route('**/script.google.com/**', async r => {
      await held;
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap()) });
    });
    await page.goto(PAGE + '?v=nestandnosh', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#meals')).toContainText("Loading Today's Menu");
    release();
    await page.waitForSelector('.mc', { timeout: 15000 });
  });

  test('page mobile par sideways scroll nahi karta', async ({ page }) => {
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});

test.describe('Vendor side — menu link', () => {
  const { openApp: openAppRaw, adminLogin, freshState } = require('./helpers');

  test('Setup me menu ka clean link milta hai', async ({ page }) => {
    await openAppRaw(page, { vendor: 'hungrybirds', state: freshState() });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.waitForTimeout(300);
    // ⚠️ vendorOwnLink() admin.html me '?v=' wala hai; menu link us par nahi bana
    // hai warna '?v=hb/menu' ban jaata. Clean path hona zaroori hai — 404.html
    // sirf usi shape ko menu.html par bhejta hai.
    const link = await page.evaluate(() => window.vendorMenuLink());
    expect(link).toBe('http://localhost:8080/hungrybirds/menu');
  });
});
