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

  test('Order Now usi kitchen ke app par bhejta hai', async ({ page }) => {
    await openMenu(page, { vendor: 'hungrybirds' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(await page.getAttribute('#orderBtn', 'href')).toBe('/?v=hungrybirds');
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

  test('page mobile par sideways scroll nahi karta', async ({ page }) => {
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});

test.describe('Login page se public menu tak', () => {
  const { openApp: openAppRaw, freshState } = require('./helpers');

  test('login page par "bina login menu dekho" link hai, usi kitchen ka', async ({ page }) => {
    await openAppRaw(page, { vendor: 'hungrybirds', loggedIn: false, state: freshState() });
    await page.waitForSelector('#peekMenuBtn', { timeout: 15000 });
    // Link me kitchen ka slug hona zaroori hai — warna default vendor ka menu khulta.
    expect(await page.getAttribute('#peekMenuBtn', 'href')).toBe('/menu.html?v=hungrybirds');
  });
});
