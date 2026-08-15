/**
 * Delivery fee was only ever editable by hand-editing the Config sheet's JSON
 * cell directly (near/far/farSocieties had no Setup UI at all, despite the
 * fee-calc logic already supporting a per-society split) — this adds a Setup
 * section for it plus a deliveryEnabled toggle ("free delivery for everyone").
 * When off, deliveryFee()/deliveryFeeForOrder() short-circuit to 0 regardless
 * of home/office mode or near/far society.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

test('near/far delivery fee + far-societies list save correctly', async ({ page }) => {
  const { state } = await openApp(page);
  await adminLogin(page);
  await page.evaluate(() => window.adminBnGo('config'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.cfgOpen('delivery'));
  await page.fill('#cfg-deliveryNear', '15');
  await page.fill('#cfg-deliveryFar', '35');
  await page.fill('#cfg-farSocieties', 'Eden\nHarihar');
  await page.click('#saveConfigBtn');
  await page.waitForTimeout(400);
  expect(state.config.deliveryNear).toBe(15);
  expect(state.config.deliveryFar).toBe(35);
  expect(state.config.farSocieties).toEqual(['Eden', 'Harihar']);
});

test('turning delivery charges OFF hides the fee fields and saves deliveryEnabled=false', async ({ page }) => {
  const { state } = await openApp(page);
  await adminLogin(page);
  await page.evaluate(() => window.adminBnGo('config'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.cfgOpen('delivery'));
  await expect(page.locator('#deliveryFeeWrap')).not.toHaveClass(/hidden/);
  await page.uncheck('#cfg-deliveryEnabled');
  await expect(page.locator('#deliveryFeeWrap')).toHaveClass(/hidden/);
  await page.click('#saveConfigBtn');
  await page.waitForTimeout(400);
  expect(state.config.deliveryEnabled).toBe(false);
});

test('order total excludes delivery fee entirely when delivery charges are OFF', async ({ page }) => {
  const state = freshState();
  state.config.deliveryEnabled = false;
  const { state: s } = await openApp(page, { state });
  await page.evaluate(() => window.menuChangeDate(1));
  await page.evaluate(() => { window.addMealDirect('lunch'); window.cart[0].qty = 1; });
  await page.evaluate(() => window.goToCheckout());
  await page.fill('#customerName', 'Test User');
  const barTotal = await page.evaluate(() => document.getElementById('barTotal2').textContent);
  expect(barTotal).toBe('₹80');   // lunch ₹80, no +10/+20 delivery
  await page.click('#placeBtn');
  await page.waitForTimeout(600);
  expect(s.orders[0].total).toBe('₹80');
});
