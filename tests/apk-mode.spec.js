/**
 * Two APK builds share this codebase — an Admin APK and a Customer APK — each
 * configured via ?mode=admin / ?mode=customer on the wrapper's start URL (see
 * APK_MODE in index.html). Plain web/PWA never sets this and is unaffected.
 */
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers');

test.describe('Admin APK (?mode=admin)', () => {
  test('boots straight to admin login, never customer discovery/home', async ({ page }) => {
    await openApp(page, { mode: 'admin', loggedIn: false });
    await expect(page.locator('#adminLogin')).not.toHaveClass(/hidden/);
    await expect(page.locator('#dscView')).toHaveClass(/hidden/);
    await expect(page.locator('#homeView')).toHaveClass(/hidden/);
  });

  test('mode wins even when a ?v= vendor param is also present', async ({ page }) => {
    await openApp(page, { mode: 'admin', vendor: 'nestandnosh', loggedIn: false });
    await expect(page.locator('#adminLogin')).not.toHaveClass(/hidden/);
  });

  test('mode wins even when ?superadmin=1 is also present', async ({ page }) => {
    await openApp(page, { mode: 'admin', loggedIn: false });
    // Re-navigate with superadmin=1 alongside mode=admin (defense in depth —
    // not a real wrapper scenario, but mode must still take priority).
    await page.goto(page.url().split('?')[0] + '?mode=admin&superadmin=1');
    await page.waitForSelector('#bootLoader.gone', { timeout: 15000 }).catch(() => {});
    await expect(page.locator('#adminLogin')).not.toHaveClass(/hidden/);
    await expect(page.locator('#superLogin')).toHaveClass(/hidden/);
  });
});

test.describe('Customer APK (?mode=customer)', () => {
  test('Admin link is hidden on the auth page', async ({ page }) => {
    await openApp(page, { mode: 'customer', vendor: 'nestandnosh', loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#authAdminLink')).toHaveClass(/hidden/);
  });

  test('?superadmin=1 is ignored — never reaches super admin', async ({ page }) => {
    await openApp(page, { mode: 'customer', loggedIn: false });
    await page.goto(page.url().split('?')[0] + '?mode=customer&superadmin=1');
    await page.waitForSelector('#bootLoader.gone', { timeout: 15000 }).catch(() => {});
    await expect(page.locator('#superLogin')).toHaveClass(/hidden/);
    await expect(page.locator('#superPanel')).toHaveClass(/hidden/);
  });
});

test.describe('Plain web (no mode param)', () => {
  test('Admin link still shows normally — mode split does not affect regular web/PWA', async ({ page }) => {
    await openApp(page, { vendor: 'nestandnosh', loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#authAdminLink')).not.toHaveClass(/hidden/);
  });
});
