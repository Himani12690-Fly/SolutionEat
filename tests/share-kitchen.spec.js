/**
 * Two "share my kitchen" entry points, both built on the same vendorOwnLink()
 * (?v=<VENDOR_ID>) + api.qrserver.com QR image already used for UPI payments:
 * - Admin Setup -> Kitchen section: a QR the vendor can download/print, plus
 *   a copy-link button (works even with Discovery opted out — direct link
 *   never depends on it).
 * - Customer Profile -> "Share this Kitchen": a sheet with the same QR, for
 *   word-of-mouth referral.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

test.describe('Admin — kitchen QR', () => {
  test('Setup shows a QR + link for the vendor\'s own ?v= link', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminTab('config'));
    const [imgSrc, dlHref, linkText] = await page.evaluate(() => [
      document.getElementById('vendorQrImg').src,
      document.getElementById('vendorQrDownload').href,
      document.getElementById('vendorLinkText').textContent,
    ]);
    expect(imgSrc).toContain('api.qrserver.com');
    expect(imgSrc).toContain(encodeURIComponent('?v=nestandnosh'));
    expect(dlHref).toBe(imgSrc);
    expect(linkText).toContain('?v=nestandnosh');
  });

  test('link stays correct even with Discovery opted out', async ({ page }) => {
    // Discovery toggle ab Super Admin ke paas hai (vendor Setup se nahi) —
    // seedha state seed karke us halat ko simulate karte hain.
    const state = freshState();
    state.config.listInDiscovery = false;
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminTab('config'));
    const linkText = await page.evaluate(() => document.getElementById('vendorLinkText').textContent);
    expect(linkText).toContain('?v=nestandnosh');
  });
});

test.describe('Customer — share this kitchen', () => {
  test('Profile has a Share row that opens the share sheet with the same link/QR', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.showProfilePage());
    await page.click('text=Share this Kitchen');
    await expect(page.locator('#shareKitchenSheet')).not.toHaveClass(/hidden/);
    const [imgSrc, linkText] = await page.evaluate(() => [
      document.getElementById('shareKitchenQr').src,
      document.getElementById('shareKitchenLinkText').textContent,
    ]);
    expect(imgSrc).toContain('api.qrserver.com');
    expect(linkText).toContain('?v=nestandnosh');
  });

  test('closeShareKitchenSheet() hides it again', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.openShareKitchenSheet());
    await expect(page.locator('#shareKitchenSheet')).not.toHaveClass(/hidden/);
    await page.evaluate(() => window.closeShareKitchenSheet());
    await expect(page.locator('#shareKitchenSheet')).toHaveClass(/hidden/);
  });

  test('shareKitchenNow() does not throw (falls back to clipboard when navigator.share is unavailable)', async ({ page }) => {
    await openApp(page);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => window.shareKitchenNow());
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});
