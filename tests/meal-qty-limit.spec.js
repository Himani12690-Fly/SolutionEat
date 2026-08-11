/**
 * The old "1:1:1 rule" (hardcoded max 1 tiffin per meal per day, everywhere,
 * for every vendor) is now vendor-configurable per meal type
 * (mt.maxQtyPerOrder, Setup → Meal Types, default 1 — same as the old
 * hardcoded behavior when a vendor never touches it). Trying to go past the
 * configured max still shows the same limit popup — which now also offers
 * the Bulk Order flow — instead of silently capping.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

function stateWithLunchMax(max) {
  const state = freshState();
  state.config.mealTypes = state.config.mealTypes.map(mt => mt.key === 'lunch' ? { ...mt, maxQtyPerOrder: max } : mt);
  return state;
}

test.describe('Meal sheet stepper', () => {
  test('default (no maxQtyPerOrder set) still caps at 1, same as the old hardcoded rule', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.openMealSheet('lunch'));
    await page.click('.sh-qty button:has-text("+")');
    await expect(page.locator('#limitModal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#shQty')).toHaveText('1');
  });

  test('a vendor-configured higher limit lets the stepper go up to it, then shows the limit popup', async ({ page }) => {
    const state = stateWithLunchMax(3);
    await openAppRaw(page, { vendor: 'nestandnosh', state });
    await page.evaluate(() => window.openMealSheet('lunch'));
    await page.click('.sh-qty button:has-text("+")');
    await expect(page.locator('#shQty')).toHaveText('2');
    await page.click('.sh-qty button:has-text("+")');
    await expect(page.locator('#shQty')).toHaveText('3');
    await expect(page.locator('#limitModal')).toHaveClass(/hidden/); // not shown yet — still within limit
    await page.click('.sh-qty button:has-text("+")'); // 4th tap — over the limit
    await expect(page.locator('#limitModal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#shQty')).toHaveText('3'); // stayed at the cap, didn't go to 4
  });
});

test.describe('Home card stepper', () => {
  test('the "+" respects the configured max, and "−" decrements instead of removing the whole item', async ({ page }) => {
    const state = stateWithLunchMax(2);
    // Fixed time before lunch's 09:00 cutoff — the Home card only shows the
    // stepper (vs. a disabled "Closed" button) while the meal is orderable,
    // so this test must not depend on whatever the real wall-clock time is.
    await openAppRaw(page, { vendor: 'nestandnosh', state, istOverride: '2026-08-04T08:00:00' });
    await page.evaluate(() => window.quickAdd('lunch'));
    await expect(page.locator('#mc-lunch .c1-st-n')).toHaveText('1');
    await page.click('#mc-lunch .c1-st-btn[aria-label="Add more"]');
    await expect(page.locator('#mc-lunch .c1-st-n')).toHaveText('2');
    await page.click('#mc-lunch .c1-st-btn[aria-label="Add more"]'); // 3rd — over the limit of 2
    await expect(page.locator('#limitModal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#mc-lunch .c1-st-n')).toHaveText('2');
    await page.evaluate(() => window.closeLimitPopup());
    await page.click('#mc-lunch .c1-st-btn[aria-label="Remove"]');
    await expect(page.locator('#mc-lunch .c1-st-n')).toHaveText('1'); // decremented, not removed
    await page.click('#mc-lunch .c1-st-btn[aria-label="Remove"]');
    await expect(page.locator('#mc-lunch .c1-st-n')).toHaveCount(0); // now actually removed
  });
});

test.describe('Backend order validation', () => {
  test('rejects a quantity above the configured max', async ({ page }) => {
    const state = stateWithLunchMax(2);
    await openAppRaw(page, { vendor: 'nestandnosh', state });
    const result = await page.evaluate(() => window.apiPost({
      action: 'order', token: 'test-token-123', lunchQty: 3, lunchSabzi: 'Dal Tadka',
      deliveryDate: '2099-01-01', society: 'Vrindavan', flatNo: 'A-1', payment: 'COD',
    }));
    expect(result.status).toBe('error');
    expect(result.code).toBe('qty_limit');
  });

  test('accepts a quantity at the configured max', async ({ page }) => {
    const state = stateWithLunchMax(2);
    await openAppRaw(page, { vendor: 'nestandnosh', state });
    const result = await page.evaluate(() => window.apiPost({
      action: 'order', token: 'test-token-123', lunchQty: 2, lunchSabzi: 'Dal Tadka',
      deliveryDate: '2099-01-01', society: 'Vrindavan', flatNo: 'A-1', payment: 'COD',
    }));
    expect(result.status).toBe('success');
  });
});

test.describe('Home page — open meals sorted first', () => {
  test('a closed meal moves below an open one, regardless of the vendor\'s configured meal order', async ({ page }) => {
    // Lunch cutoff passed (istOverride after 09:00) but dinner still open (cutoff 15:00).
    await openApp(page, { istOverride: '2026-08-04T10:00:00' });
    const order = await page.evaluate(() => Array.from(document.querySelectorAll('#mealPanel .c1card')).map(el => el.id));
    const lunchIdx = order.indexOf('mc-lunch');
    const dinnerIdx = order.indexOf('mc-dinner');
    expect(dinnerIdx).toBeLessThan(lunchIdx); // dinner (open) sorted above lunch (closed)
  });

  test('a closed meal card jumps Home straight to the next available date for that meal', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T10:00:00' }); // lunch closed for today
    await page.click('#mc-lunch .c1-cust');
    await page.waitForTimeout(300);
    await expect(page.locator('#menuDateTime .dt-chip').nth(1)).toHaveClass(/sel/); // switched to Tomorrow
    await expect(page.locator('#mc-lunch')).toHaveClass(/c1-open/); // lunch now orderable on the new date
  });
});
