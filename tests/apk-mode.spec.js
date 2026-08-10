/**
 * Two APK builds share this codebase — an Admin APK and a Customer APK — each
 * configured via ?mode=admin / ?mode=customer on the wrapper's start URL (see
 * APK_MODE in index.html). Plain web/PWA never sets this and is unaffected.
 *
 * There is no in-UI "Admin" link anywhere, in any mode — complete separation
 * from the customer-facing auth page. The only way into admin login is the
 * URL itself: ?Admin=<vendorSlug> (or lowercase ?admin=), which both scopes
 * VENDOR_ID to that vendor (same as ?v= does) and routes straight to admin
 * login, skipping customer UI entirely — see HAS_ADMIN_PARAM in index.html.
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
  test('there is no Admin link anywhere on the auth page', async ({ page }) => {
    await openApp(page, { mode: 'customer', vendor: 'nestandnosh', loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#authAdminLink')).toHaveCount(0);
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
  test('there is no Admin link anywhere on the auth page — complete separation', async ({ page }) => {
    await openApp(page, { vendor: 'nestandnosh', loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#authAdminLink')).toHaveCount(0);
  });
});

test.describe('Admin login via ?Admin=<vendorSlug> (sole entry point, no UI link)', () => {
  test('boots straight to admin login, never customer discovery/home', async ({ page }) => {
    await openApp(page, { admin: 'nestandnosh', loggedIn: false });
    await expect(page.locator('#adminLogin')).not.toHaveClass(/hidden/);
    await expect(page.locator('#dscView')).toHaveClass(/hidden/);
    await expect(page.locator('#homeView')).toHaveClass(/hidden/);
    await expect(page.locator('#authPage')).toHaveClass(/hidden/);
  });

  test('scopes VENDOR_ID to the slug given in ?Admin=, same as ?v= would', async ({ page }) => {
    // VENDOR_ID is a top-level `const` in a classic script, not exposed on
    // window — read it the same way apiPost() itself proves it, via the
    // vendorId every outgoing request gets stamped with.
    await openApp(page, { admin: 'nestandnosh', loggedIn: false });
    const reqPromise = page.waitForRequest(req =>
      req.url().includes('script.google.com') && (req.postData() || '').includes('"action":"stats"'));
    await page.fill('#adminUser', 'demo');
    await page.fill('#adminPass', 'demo123');
    await page.click('#loginBtn');
    const req = await reqPromise;
    const body = JSON.parse(req.postData());
    expect(body.vendorId).toBe('nestandnosh');
  });

  test('wins even when ?superadmin=1 is also present', async ({ page }) => {
    await openApp(page, { admin: 'nestandnosh', loggedIn: false });
    await page.goto(page.url().split('?')[0] + '?Admin=nestandnosh&superadmin=1');
    await page.waitForSelector('#bootLoader.gone', { timeout: 15000 }).catch(() => {});
    await expect(page.locator('#adminLogin')).not.toHaveClass(/hidden/);
    await expect(page.locator('#superLogin')).toHaveClass(/hidden/);
  });

  test('lowercase ?admin= is also honored', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await page.goto(page.url().split('?')[0] + '?admin=nestandnosh');
    await page.waitForSelector('#bootLoader.gone', { timeout: 15000 }).catch(() => {});
    await expect(page.locator('#adminLogin')).not.toHaveClass(/hidden/);
  });
});
