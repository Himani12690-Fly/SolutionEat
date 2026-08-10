/**
 * THROWAWAY Phase-2 verification spec — NOT part of the permanent suite.
 *
 * customer.html has no Admin UI (that's admin.html's job in a later phase), so
 * the 3 "Customer bell" tests in notifications.spec.js that simulate "the vendor
 * acts, does the customer bell pick it up?" via a second admin-logged-in page
 * (adminActOn() -> adminLogin()) cannot run unmodified here — there is no
 * window.showAdminLogin()/adminLogin() in customer.html to drive that second page.
 *
 * This file re-implements just those 3 assertions, swapping the "vendor acts"
 * step for a direct apiPost() call against the same mocked backend/state — i.e.
 * simulating the OTHER device (the future admin.html) making the exact same
 * backend request setMealSt() would have made, instead of driving admin UI that
 * intentionally does not exist in this file. Everything under actual test here
 * (the customer bell badge/list/seen-state on customer.html) is unchanged from
 * the original notifications.spec.js assertions.
 *
 * Delete this file once Phase 3 (admin.html) exists and the real
 * notifications.spec.js can be pointed at customer.html + admin.html together.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, freshState, todayIST } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', file: 'customer.html', ...opts });

function nowISTStamp() {
  const n = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const pad = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

function seedOrder(state, over = {}) {
  const row = state.nextRow++;
  state.orders.push(Object.assign({
    row, deliveryDate:todayIST(0), meal:'lunch', phone:'9876543210',
    name:'Test User', society:'Vrindavan', flat:'D-706',
    status:'Pending', mealStatus:{ lunch:'Pending' },
    total:'₹90', payment:'COD', paymentStatus:'Unpaid',
    breakfastQty:0, lunchQty:1, dinnerQty:0,
    lunchSabzi:'Dal Tadka', lunchTiffin:'1 Full Tiffin', lunchRoti:'Plain',
    lunchAddons:'None', lunchTimeSlot:'12–1 PM', dinnerSabzi:'', dinnerTiffin:'',
    dinnerRoti:'', dinnerAddons:'None', note:'', promo:'', deliveryType:'home',
    time:'01/01 10:00 AM', day:'Monday', createdIso:nowISTStamp()
  }, over));
  return row;
}

// Stand-in for notifications.spec.js's adminActOn() — hits the same mock
// backend action (setmealstatus) the real admin UI's setMealSt() posts,
// without needing admin.html's UI (which doesn't exist in this split yet).
async function vendorActOn(page, row, meal, status) {
  await page.evaluate(({ row, meal, status }) => {
    return window.apiPost({ action: 'setmealstatus', user: 'demo', pass: 'demo123', row, meal, status });
  }, { row, meal, status });
}

test.describe('Customer bell — top of Home page (Phase 2 customer.html check)', () => {
  test('[phase2] vendor accepting (Preparing) an order notifies the customer', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).toHaveClass(/hidden/);
    await vendorActOn(page, row, 'lunch', 'Preparing');
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).not.toHaveClass(/hidden/);
    await expect(page.locator('#h1BellBadge')).toHaveText('1');
    await page.evaluate(() => window.openNotifSheet());
    await expect(page.locator('#notifSheet')).not.toHaveClass(/hidden/);
    await expect(page.locator('#notifList')).toContainText('being prepared');
  });

  test('[phase2] vendor cancelling / delivering also reaches the customer bell', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await vendorActOn(page, row, 'lunch', 'Delivered');
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.openNotifSheet());
    await expect(page.locator('#notifList')).toContainText('Delivered');
  });

  test('[phase2] opening the bell sheet marks notifications as seen (badge clears)', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await vendorActOn(page, row, 'lunch', 'Preparing');
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).not.toHaveClass(/hidden/);
    await page.evaluate(() => window.openNotifSheet());
    await page.evaluate(() => window.closeNotifSheet());
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).toHaveClass(/hidden/);
  });
});
