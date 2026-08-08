/**
 * GPS-radius kitchen discovery — coexists with the existing society-list/
 * area-chip system, doesn't replace it. Vendor sets their kitchen's GPS
 * location (Setup → "Use my current location", free browser geolocation,
 * no Maps/Geocoding API) + a delivery radius (km). Customers on the
 * Discovery page can tap "Find kitchens near me" (their own free browser
 * geolocation) to see vendors within THEIR OWN configured radius, with a
 * distance label — this is awareness only, not an order guarantee; actual
 * ordering still requires the customer's exact society to be in the
 * vendor's own societies list (unchanged, existing gate).
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

const CUSTOMER_LAT = 23.0225, CUSTOMER_LNG = 72.5714;

test.describe('Admin Setup — Kitchen Location', () => {
  test('"Use my current location" captures GPS coords and shows them', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:8080' });
    await context.setGeolocation({ latitude: CUSTOMER_LAT, longitude: CUSTOMER_LNG });
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.evaluate(() => window.cfgToggle('kitchen')); // "Kitchen" accordion section starts collapsed
    await expect(page.locator('#kitchenLocStatus')).toContainText('Abhi set nahi hai');
    await page.click('#captureLocBtn');
    await expect(page.locator('#kitchenLocStatus')).toContainText('23.0225');
    await expect(page.locator('#kitchenLocStatus')).toContainText('72.5714');
  });

  test('saving Setup sends the captured location and radius to the backend', async ({ page, context }) => {
    const { state } = await openApp(page);
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:8080' });
    await context.setGeolocation({ latitude: CUSTOMER_LAT, longitude: CUSTOMER_LNG });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.evaluate(() => window.cfgToggle('kitchen')); // "Kitchen" accordion section starts collapsed
    await page.click('#captureLocBtn');
    await expect(page.locator('#kitchenLocStatus')).toContainText('23.0225');
    await page.fill('#cfg-deliveryRadiusKm', '6');
    await page.evaluate(() => window.saveConfig());
    await page.waitForTimeout(400);
    expect(state.config.kitchenLat).toBeCloseTo(CUSTOMER_LAT, 3);
    expect(state.config.kitchenLng).toBeCloseTo(CUSTOMER_LNG, 3);
    expect(state.config.deliveryRadiusKm).toBe(6);
  });
});

test.describe('Discovery — Near You (GPS radius)', () => {
  function seedVendors() {
    const state = freshState();
    state.discoveryVendors = [
      { vendorId: 'annapurna', name: 'Annapurna', cuisine: 'Gujarati', areas: ['Godrej Garden City'], lat: 23.0335, lng: 72.5714, deliveryRadiusKm: 4 }, // ~1.2km away
      { vendorId: 'farkitchen', name: 'Far Kitchen', cuisine: 'Punjabi', lat: 23.2000, lng: 72.5714, deliveryRadiusKm: 4 }, // ~19.7km away — outside its own radius
      { vendorId: 'nolocation', name: 'No Location Kitchen', cuisine: 'Chinese' }, // never set kitchen location
    ];
    return state;
  }

  test('auto-requests location on open and shows only vendors within their own radius, with a distance label, nearest first', async ({ page, context }) => {
    const state = seedVendors();
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:8080' });
    await context.setGeolocation({ latitude: CUSTOMER_LAT, longitude: CUSTOMER_LNG });
    await openAppRaw(page, { state, loggedIn: false });
    await page.evaluate(() => window.openDiscovery());
    // No manual tap needed — the flow auto-triggers on open.
    await expect(page.locator('#dscNearWrap')).not.toHaveClass(/hidden/, { timeout: 10000 });
    const text = await page.locator('#dscNearList').innerText();
    expect(text).toContain('Annapurna');
    expect(text).toContain('km away');
    expect(text).not.toContain('Far Kitchen');       // outside its own radius
    expect(text).not.toContain('No Location Kitchen'); // never configured a location
    // Fallback browsing (area chips/list) stays hidden once a near-you result renders.
    await expect(page.locator('#dscAreas')).toHaveClass(/hidden/);
    await expect(page.locator('#dscBrowseWrap')).toHaveClass(/hidden/);
    // Top header shows the customer's own resolved locality, not a hardcoded city —
    // and there's no second "Near You" label duplicating it above the list.
    await expect(page.locator('#dscCity')).toHaveText('Bopal', { timeout: 10000 });
    expect(text).not.toContain('Near You');
    // "Own a kitchen?" CTA + footer removed from the Discovery page entirely.
    await expect(page.locator('.dsc-vendor-cta')).toHaveCount(0);
    await expect(page.locator('.dsc-foot')).toHaveCount(0);
  });

  test('zero nearby kitchens shows a clean empty state, not the fallback browse list', async ({ page, context }) => {
    const state = freshState();
    state.discoveryVendors = [
      { vendorId: 'farkitchen', name: 'Far Kitchen', cuisine: 'Punjabi', lat: 23.2000, lng: 72.5714, deliveryRadiusKm: 4 }, // outside its own radius
    ];
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:8080' });
    await context.setGeolocation({ latitude: CUSTOMER_LAT, longitude: CUSTOMER_LNG });
    await openAppRaw(page, { state, loggedIn: false });
    await page.evaluate(() => window.openDiscovery());
    await expect(page.locator('#dscEmptyNear')).not.toHaveClass(/hidden/, { timeout: 10000 });
    await expect(page.locator('#dscAreas')).toHaveClass(/hidden/);
    await expect(page.locator('#dscBrowseWrap')).toHaveClass(/hidden/);
  });

  test('poor GPS accuracy skips the resolved locality label — no confidently-wrong far-away place name', async ({ page, context }) => {
    const state = seedVendors();
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:8080' });
    // 5km accuracy radius — device only knows it's SOMEWHERE in a 5km circle, so
    // naming a specific locality (which may be km away from where the customer
    // actually is) would be confidently wrong, not just imprecise.
    await context.setGeolocation({ latitude: CUSTOMER_LAT, longitude: CUSTOMER_LNG, accuracy: 5000 });
    await openAppRaw(page, { state, loggedIn: false });
    await page.evaluate(() => window.openDiscovery());
    // The actual nearby-vendor match still runs fine — only the cosmetic label is gated.
    await expect(page.locator('#dscNearWrap')).not.toHaveClass(/hidden/, { timeout: 10000 });
    await expect(page.locator('#dscCity')).toHaveText('Ahmedabad'); // untouched default, not a reverse-geocoded guess
  });

  test('location denied falls back to the existing area-chip/full-list browsing', async ({ page, context }) => {
    const state = seedVendors();
    // No grantPermissions() call — geolocation stays denied, matching Chromium's default.
    await openAppRaw(page, { state, loggedIn: false });
    await page.evaluate(() => window.openDiscovery());
    await page.waitForFunction(() => document.querySelectorAll('#dscList .zrc').length > 0, { timeout: 15000 }).catch(() => {});
    await expect(page.locator('#dscAreas')).toBeVisible();
    await expect(page.locator('#dscBrowseWrap')).toBeVisible();
    await expect(page.locator('#dscNearWrap')).toHaveClass(/hidden/);
  });
});
