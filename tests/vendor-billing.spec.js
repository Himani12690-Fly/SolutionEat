/**
 * Vendor Admin's own subscription tab — gradient status card (plan/amount/
 * due date) + a "Last 12 Months" payment history list underneath. History
 * comes from apps-script-v6.txt's getVendorBillingHistory(), which derives it
 * from the Audit sheet's VENDOR_MARKED_PAID rows (Vendors sheet itself only
 * ever keeps the single latest SubDueDate/SubLastPaid snapshot).
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

test('status card shows amount, status chip and due date', async ({ page }) => {
  const { state } = await openApp(page);
  state.vendors[0].subStatus = 'active';
  state.vendors[0].subDueDate = '2026-09-01';
  state.vendors[0].subLastPaid = '2026-08-01';
  await adminLogin(page);
  await page.evaluate(() => window.adminTab('billing'));
  const [amount, chip, due] = await page.evaluate(() => [
    document.getElementById('vbAmount').textContent,
    document.getElementById('vbChip').textContent,
    document.getElementById('vbDue').textContent,
  ]);
  expect(amount).toBe('499');
  expect(chip).toContain('Paid');
  expect(due).toContain('2026-09-01');
  expect(due).toContain('2026-08-01');
});

test('12-month history list renders one row per past payment, most recent first', async ({ page }) => {
  const { state } = await openApp(page);
  state.vendors[0].subHistory = [
    { paidOn: '2026-07-01', nextDue: '2026-08-01', amount: 499 },
    { paidOn: '2026-06-01', nextDue: '2026-07-01', amount: 499 },
    { paidOn: '2026-05-01', nextDue: '2026-06-01', amount: 499 },
  ];
  await adminLogin(page);
  await page.evaluate(() => window.adminTab('billing'));
  const text = await page.evaluate(() => document.getElementById('vbHistoryList').textContent);
  expect(text).toContain('2026-07-01');
  expect(text).toContain('2026-06-01');
  expect(text).toContain('2026-05-01');
  expect(text).toContain('₹499');
  // most-recent-first order
  expect(text.indexOf('2026-07-01')).toBeLessThan(text.indexOf('2026-06-01'));
  expect(text.indexOf('2026-06-01')).toBeLessThan(text.indexOf('2026-05-01'));
});

test('no payment history yet shows an empty-state message, not a blank list', async ({ page }) => {
  await openApp(page);
  await adminLogin(page);
  await page.evaluate(() => window.adminTab('billing'));
  const text = await page.evaluate(() => document.getElementById('vbHistoryList').textContent);
  expect(text.trim().length).toBeGreaterThan(0);
});
