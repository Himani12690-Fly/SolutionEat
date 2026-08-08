/**
 * Bulk / Party Order — vendor approval queue. Kitchen ki daily capacity
 * limited hoti hai, isliye ye normal instant order nahi — customer se
 * (meal, qty, date, address, notes) leta hai aur admin ke naye "Bulk
 * Requests" tab me pending request ban jaati hai. Vendor approve (qty/price
 * adjust karke) ya decline karta hai; customer "My Bulk Requests" (Profile)
 * me status dekh sakta hai.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

test.describe('Customer — Bulk Order sheet', () => {
  test('Profile has a Bulk / Party Order row that opens the sheet', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.showProfilePage());
    await page.click('text=Bulk / Party Order');
    await expect(page.locator('#bulkOrderSheet')).not.toHaveClass(/hidden/);
  });

  test('meal dropdown is populated from the vendor\'s enabled meals', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.openBulkOrderSheet());
    const opts = await page.locator('#bulkMeal option').allTextContents();
    expect(opts.join(' ')).toContain('Lunch');
    expect(opts.join(' ')).toContain('Dinner');
  });

  test('rejects a quantity under 5', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.openBulkOrderSheet());
    await page.fill('#bulkQty', '3');
    await page.fill('#bulkDate', await page.locator('#bulkDate').getAttribute('min'));
    await page.click('#bulkSubmitBtn');
    await expect(page.locator('#bulkOrderSheet')).not.toHaveClass(/hidden/); // sheet stays open, request rejected client-side
  });

  test('submitting a valid request closes the sheet and shows it in My Bulk Requests', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.openBulkOrderSheet());
    await page.selectOption('#bulkMeal', 'lunch');
    await page.fill('#bulkQty', '25');
    await page.fill('#bulkDate', await page.locator('#bulkDate').getAttribute('min'));
    await page.fill('#bulkAddr', 'Office, 12th floor');
    await page.click('#bulkSubmitBtn');
    await expect(page.locator('#bulkOrderSheet')).toHaveClass(/hidden/);
    await page.evaluate(() => window.showProfilePage());
    await expect(page.locator('#pfBulkRequestsWrap')).not.toHaveClass(/hidden/);
    await expect(page.locator('#pfBulkRequestsList')).toContainText('25');
    await expect(page.locator('#pfBulkRequestsList')).toContainText('Pending');
  });

  test('the 1-tiffin-limit popup offers a Bulk Order CTA', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.showLimitPopup());
    await page.click('text=Place a Bulk Order');
    await expect(page.locator('#limitModal')).toHaveClass(/hidden/);
    await expect(page.locator('#bulkOrderSheet')).not.toHaveClass(/hidden/);
  });
});

test.describe('Admin — Bulk Requests tab', () => {
  async function submitOneRequest(page) {
    await page.evaluate(() => window.openBulkOrderSheet());
    await page.selectOption('#bulkMeal', 'lunch');
    await page.fill('#bulkQty', '30');
    await page.fill('#bulkDate', await page.locator('#bulkDate').getAttribute('min'));
    await page.click('#bulkSubmitBtn');
    await expect(page.locator('#bulkOrderSheet')).toHaveClass(/hidden/);
  }

  test('a submitted request appears in the admin Bulk Requests tab with a pending badge', async ({ page }) => {
    await openApp(page);
    await submitOneRequest(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('bulk'));
    await expect(page.locator('#bulkReqList')).toContainText('30');
    await expect(page.locator('#bulkReqList')).toContainText('Pending');
    await expect(page.locator('#bulkReqBadge')).not.toHaveClass(/hidden/);
    await expect(page.locator('#bulkReqBadge')).toHaveText('1');
  });

  test('approving a request updates its status and clears the badge', async ({ page }) => {
    await openApp(page);
    await submitOneRequest(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('bulk'));
    await page.click('text=✓ Approve');
    await page.waitForTimeout(300);
    await expect(page.locator('#bulkReqList')).toContainText('Approved');
    await expect(page.locator('#bulkReqBadge')).toHaveClass(/hidden/);
  });

  test('declining a request updates its status', async ({ page }) => {
    await openApp(page);
    await submitOneRequest(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('bulk'));
    await page.click('text=✕ Decline');
    await page.click('#cfYes'); // confirm dialog
    await page.waitForTimeout(300);
    await expect(page.locator('#bulkReqList')).toContainText('Declined');
  });
});
