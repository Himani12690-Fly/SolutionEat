/**
 * Private-mode: a customer who lands via a vendor's own ?v=slug link should
 * never have a path to the shared Discovery/marketplace list — otherwise a
 * vendor's own promotion can leak their customers to competitors. A customer
 * who genuinely arrived via Discovery (picked this vendor from the list)
 * should still be able to go back to it. Vendors can also opt their own
 * kitchen out of appearing in Discovery altogether.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

// Browse Kitchens (the Profile Quick Link that opened Discovery) has been
// removed entirely — there's no longer a per-scenario show/hide to test,
// it's just gone regardless of how the customer arrived.
test('Browse Kitchens has been removed from Profile entirely', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.showProfilePage());
  await expect(page.locator('#pfBrowseKitchens')).toHaveCount(0);
});

test.describe('Private mode — direct vendor link', () => {
  test('auth page hides "All Kitchens" for a direct ?v= link', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#authBackKitchens')).toHaveClass(/hidden/);
  });
});

test.describe('Private mode — arrived via Discovery', () => {
  test('auth page still shows "All Kitchens" after picking a vendor from Discovery', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('fbt_from_discovery', '1'); } catch (e) {} });
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#authBackKitchens')).not.toHaveClass(/hidden/);
  });
});

test.describe('Private mode — hardware back button', () => {
  // The mobile back-button (popstate) handler used to check HAS_VENDOR_PARAM,
  // which is true for BOTH a vendor's own direct link and a Discovery-picked
  // vendor — so a vendor's own customer could reach Discovery with one back
  // press, bypassing the Browse Kitchens/All Kitchens hiding above entirely.
  // Fixed to use shouldShowDiscoveryEscape() (the same source of truth).
  test('direct ?v= link: back from Home shows the exit-confirm sheet, never Discovery', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#homeView')).not.toHaveClass(/hidden/);
    await page.goBack();
    await expect(page.locator('#dscView')).toHaveClass(/hidden/);
    await expect(page.locator('#exitConfirmSheet')).not.toHaveClass(/hidden/);
  });

  test('arrived via Discovery: back from Home still returns to Discovery', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('fbt_from_discovery', '1'); } catch (e) {} });
    await openApp(page);
    await expect(page.locator('#homeView')).not.toHaveClass(/hidden/);
    await page.goBack();
    await expect(page.locator('#dscView')).not.toHaveClass(/hidden/);
  });

  // confirmExitApp() itself ends in history.back() — in a real device that's
  // what actually leaves the app, but in a single-tab Playwright session it
  // navigates the test tab away and kills the JS context mid-call. So this
  // tests the piece that matters (logout('none') clears the session but does
  // NOT redirect to Discovery, unlike a normal logout) directly.
  test('logout("none") — used by the exit-confirm flow — clears the session without redirecting to Discovery', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#homeView')).not.toHaveClass(/hidden/);
    await page.evaluate(() => window.logout('none'));
    await page.waitForTimeout(200);
    const loggedIn = await page.evaluate(() => window.isLoggedIn());
    expect(loggedIn).toBe(false);
    await expect(page.locator('#homeView')).not.toHaveClass(/hidden/);
    await expect(page.locator('#dscView')).toHaveClass(/hidden/);
  });
});

test.describe('Discovery opt-out toggle', () => {
  test('vendor with listInDiscovery=false is excluded from nearby vendors', async ({ page }) => {
    // Location is now mandatory app-wide — Discovery's only path is GPS
    // "near you" (openApp() grants geolocation by default), so vendors need
    // lat/lng to be discoverable at all, matching the mock's nearbyvendors filter.
    const CUSTOMER_LAT = 23.0225, CUSTOMER_LNG = 72.5714;
    const state = freshState();
    state.discoveryVendors = [
      { vendorId: 'kitchenA', name: 'Kitchen A', areas: ['Gota'], cuisine: 'Gujarati', lat: CUSTOMER_LAT, lng: CUSTOMER_LNG, deliveryRadiusKm: 10 },
      { vendorId: 'kitchenB', name: 'Kitchen B', areas: ['Gota'], cuisine: 'Punjabi', lat: CUSTOMER_LAT, lng: CUSTOMER_LNG, deliveryRadiusKm: 10, listInDiscovery: false },
    ];
    await openAppRaw(page, { state, loggedIn: false });
    await page.evaluate(() => window.openDiscovery());
    await expect(page.locator('#dscNearWrap')).not.toHaveClass(/hidden/, { timeout: 15000 });
    const text = await page.locator('#dscNearList').innerText();
    expect(text).toContain('Kitchen A');
    expect(text).not.toContain('Kitchen B');
  });

  // "Setup toggle round-trips through saveConfig" — Discovery on/off ab vendor
  // Setup me nahi, Super Admin ke Delivery Setup group me hai (tests/super-
  // vendor-config.spec.js me cover hota hai).
});
