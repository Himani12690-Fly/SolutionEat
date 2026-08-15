/**
 * Vendor menu bootstrap resilience — a slow/cold backend (Google Apps Script
 * cold starts routinely take 5-45s+) should never make the customer see a
 * broken/empty "kitchen home page, but no real menu" state. Instead they
 * should see an honest "please wait" skeleton for as long as it takes, and
 * a clear retry affordance if the fetch genuinely fails.
 */
const { test, expect } = require('@playwright/test');
const { openApp, resolveAppUrl } = require('./helpers');

const SCRIPT_HOST = 'script.google.com';

test.describe('Boot resilience — slow/failing vendor bootstrap', () => {
  test('meal panel keeps showing the loading skeleton past 8s instead of a broken/empty menu', async ({ page }) => {
    await openApp(page, { vendor: 'nestandnosh' });
    await expect(page.locator('#mealPanel .c1card')).toHaveCount(3, { timeout: 10000 });

    // Clear the cached menu (nestandnosh is the default vendor, so the key is
    // unnamespaced) so the reload below genuinely re-gates on __vendorReady —
    // a cached menu would otherwise render instantly and skip the skeleton
    // path entirely, defeating the point of this test.
    await page.evaluate(() => localStorage.removeItem('fbt_menu'));

    // Now intercept just the bootstrap GET and delay it well past the old
    // 8s boot-loader failsafe, then reload to re-trigger init()'s boot flow.
    let released;
    const releaseGate = new Promise(res => { released = res; });
    await page.route(url => url.hostname === SCRIPT_HOST, async route => {
      const req = route.request();
      const u = new URL(req.url());
      if (req.method() === 'GET' && u.searchParams.get('action') === 'bootstrap') {
        await releaseGate;
      }
      await route.fallback();
    });

    await page.reload();
    await page.waitForTimeout(9000);   // past the old 8s failsafe

    // Skeleton (spinner) should still be showing — not an empty/broken menu.
    await expect(page.locator('#mealPanel .al-spin')).toBeVisible();
    await expect(page.locator('#mealPanel .c1card.c1-open, #mealPanel .menu-closed')).toHaveCount(0);

    // Now let the delayed bootstrap resolve — real menu should appear.
    released();
    await expect(page.locator('#mealPanel .c1card')).toHaveCount(3, { timeout: 10000 });
  });

  test('a genuinely failed bootstrap (both attempts) shows a retry card, and tapping Retry recovers', async ({ page }) => {
    await openApp(page, { vendor: 'nestandnosh' });
    await expect(page.locator('#mealPanel .c1card')).toHaveCount(3, { timeout: 10000 });
    // No cache → real gate on __vendorReady/__bootstrapFailed (see comment above).
    await page.evaluate(() => localStorage.removeItem('fbt_menu'));

    let bootstrapCalls = 0;
    await page.route(url => url.hostname === SCRIPT_HOST, async route => {
      const req = route.request();
      const u = new URL(req.url());
      if (req.method() === 'GET' && u.searchParams.get('action') === 'bootstrap') {
        bootstrapCalls++;
        if (bootstrapCalls <= 2) { await route.abort('failed'); return; }
        await route.fallback();   // 3rd call (the manual Retry) succeeds normally
        return;
      }
      await route.fallback();
    });

    await page.reload();
    // Both attempts (immediate + ~1.2s retry) fail — retry card should appear.
    await expect(page.locator('#mealPanel button:has-text("Retry")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#mealPanel .c1card.c1-open')).toHaveCount(0);

    await page.click('#mealPanel button:has-text("Retry")');
    await expect(page.locator('#mealPanel .c1card')).toHaveCount(3, { timeout: 10000 });
  });
});
