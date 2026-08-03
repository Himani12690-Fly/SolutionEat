/**
 * Private-mode: a customer who lands via a vendor's own ?v=slug link should
 * never have a path to the shared Discovery/marketplace list — otherwise a
 * vendor's own promotion can leak their customers to competitors. A customer
 * who genuinely arrived via Discovery (picked this vendor from the list)
 * should still be able to go back to it. Vendors can also opt their own
 * kitchen out of appearing in Discovery altogether.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

test.describe('Private mode — direct vendor link', () => {
  test('profile page hides Browse Kitchens for a direct ?v= link', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.showProfilePage());
    await expect(page.locator('#pfBrowseKitchens')).toHaveClass(/hidden/);
  });

  test('auth page hides "All Kitchens" for a direct ?v= link', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#authBackKitchens')).toHaveClass(/hidden/);
  });
});

test.describe('Private mode — arrived via Discovery', () => {
  test('profile page still shows Browse Kitchens after picking a vendor from Discovery', async ({ page }) => {
    // goToVendor() sets this in sessionStorage right before its full-page
    // reload to ?v=<id> — simulate that reload having already happened.
    await page.addInitScript(() => { try { sessionStorage.setItem('fbt_from_discovery', '1'); } catch (e) {} });
    await openApp(page);
    await page.evaluate(() => window.showProfilePage());
    await expect(page.locator('#pfBrowseKitchens')).not.toHaveClass(/hidden/);
  });

  test('auth page still shows "All Kitchens" after picking a vendor from Discovery', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('fbt_from_discovery', '1'); } catch (e) {} });
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#authBackKitchens')).not.toHaveClass(/hidden/);
  });
});

test.describe('Private mode — no vendor param (bare platform link)', () => {
  test('Discovery escape hatches are never hidden without a ?v= at all', async ({ page }) => {
    const state = freshState();
    await openAppRaw(page, { state }); // no vendor -> no ?v= param
    await page.evaluate(() => window.showProfilePage());
    await expect(page.locator('#pfBrowseKitchens')).not.toHaveClass(/hidden/);
  });
});

test.describe('Discovery opt-out toggle', () => {
  test('vendor with listInDiscovery=false is excluded from discover/areas', async ({ page }) => {
    const state = freshState();
    state.discoveryVendors = [
      { vendorId: 'kitchenA', name: 'Kitchen A', areas: ['Gota'], cuisine: 'Gujarati' },
      { vendorId: 'kitchenB', name: 'Kitchen B', areas: ['Gota'], cuisine: 'Punjabi', listInDiscovery: false },
    ];
    await openAppRaw(page, { state, loggedIn: false });
    await page.evaluate(() => window.openDiscovery());
    await page.waitForFunction(() => document.querySelectorAll('#dscList .zrc').length > 0, { timeout: 15000 }).catch(() => {});
    const text = await page.locator('#dscList').innerText();
    expect(text).toContain('Kitchen A');
    expect(text).not.toContain('Kitchen B');
  });

  test('Setup toggle round-trips through saveConfig', async ({ page }) => {
    const { state } = await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminTab && window.adminTab('config'));
    const before = await page.evaluate(() => document.getElementById('cfg-listInDiscovery') ? document.getElementById('cfg-listInDiscovery').checked : null);
    expect(before).toBe(true); // default ON
    await page.evaluate(() => { document.getElementById('cfg-listInDiscovery').checked = false; });
    await page.evaluate(() => window.saveConfig());
    await page.waitForTimeout(400);
    expect(state.config.listInDiscovery).toBe(false);
  });
});
