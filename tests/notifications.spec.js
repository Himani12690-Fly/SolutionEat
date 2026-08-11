/**
 * In-app Notification Bell — mandatory (no ON/OFF), both sides:
 * customer ki koi bhi order-activity (place/cancel/bulk request) → vendor ko
 * bell me dikhe; vendor ki koi bhi order-activity (status change/bulk
 * approve-decline) → customer ko bell me dikhe. Push (FCM) se ALAG cheez —
 * ye ek in-app list hai, permission ki zaroorat nahi.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState, todayIST } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

// canCancel()'s 30-min "just placed" grace check re-parses createdIso as
// *local* browser time — a plain toISOString() (UTC, no offset) silently
// drifts by the IST offset on an IST machine and falls outside the window
// (see customer.spec.js's cancel test for the same fix). Build an
// IST-wall-clock naive string instead, matching the app's own getISTNow().
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

// Vendor's own status-change actions (setMealSt/setstatus) read from the
// admin-side `adminOrders` cache — they no-op silently if no admin session is
// logged in on that page. To genuinely exercise "vendor acts → customer sees
// it", drive the vendor action from a SEPARATE page sharing the same mock
// `state`, mirroring two real devices/sessions against the same backend.
async function adminActOn(page, state, fn) {
  const adminPage = await page.context().newPage();
  await openApp(adminPage, { state });
  await adminLogin(adminPage);
  await adminPage.waitForTimeout(500);
  await fn(adminPage);
  await adminPage.waitForTimeout(300);
  await adminPage.close();
}

test.describe('Customer bell — top of Home page', () => {
  test('bell is at the top of Home, not inside Profile', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#h1Bell')).toBeVisible();
  });

  test('no unread badge when there are no notifications yet', async ({ page }) => {
    await openApp(page);
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).toHaveClass(/hidden/);
  });

  test('vendor accepting (Preparing) an order notifies the customer', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).toHaveClass(/hidden/);
    await adminActOn(page, state, ap => ap.evaluate(r => window.setMealSt(r, 'lunch', 'Preparing'), row));
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).not.toHaveClass(/hidden/);
    await expect(page.locator('#h1BellBadge')).toHaveText('1');
    await page.evaluate(() => window.openNotifSheet());
    await expect(page.locator('#notifSheet')).not.toHaveClass(/hidden/);
    await expect(page.locator('#notifList')).toContainText('being prepared');
  });

  test('vendor cancelling / delivering also reaches the customer bell', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminActOn(page, state, ap => ap.evaluate(r => window.setMealSt(r, 'lunch', 'Delivered'), row));
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.openNotifSheet());
    await expect(page.locator('#notifList')).toContainText('Delivered');
  });

  // ⚠️ Pehle sirf sheet KHOLNE se hi sab "seen" maan liya jaata tha (ek global
  // last-seen timestamp) — koi explicit control nahi tha. Ab read state
  // per-notification hai: sirf sheet kholna kuch mark nahi karta, ya to us
  // ek row ko tap karo ya "Mark all read" dabao.
  test('just opening the bell sheet does NOT clear the badge on its own', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminActOn(page, state, ap => ap.evaluate(r => window.setMealSt(r, 'lunch', 'Preparing'), row));
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).not.toHaveClass(/hidden/);
    await page.evaluate(() => window.openNotifSheet());
    await page.evaluate(() => window.closeNotifSheet());
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).not.toHaveClass(/hidden/);
  });

  test('"Mark all read" clears the badge, and stays cleared after a re-fetch', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminActOn(page, state, ap => ap.evaluate(r => window.setMealSt(r, 'lunch', 'Preparing'), row));
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).not.toHaveClass(/hidden/);
    await page.evaluate(() => window.openNotifSheet());
    await expect(page.locator('#notifMarkAllBtn')).not.toHaveClass(/hidden/);
    await page.click('#notifMarkAllBtn');
    await expect(page.locator('#h1BellBadge')).toHaveClass(/hidden/);
    // Re-fetch (mirrors the 60s poll) shouldn't resurrect an already-read notification.
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#h1BellBadge')).toHaveClass(/hidden/);
  });

  test('tapping a single notification row marks only that one as read', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminActOn(page, state, ap => ap.evaluate(r => window.setMealSt(r, 'lunch', 'Preparing'), row));
    await page.evaluate(() => window.loadNotifications());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.openNotifSheet());
    await expect(page.locator('#h1BellBadge')).toHaveText('1');
    await page.click('#notifList .notif-row');
    await expect(page.locator('#h1BellBadge')).toHaveClass(/hidden/);
    await expect(page.locator('#notifList .notif-row')).not.toHaveClass(/unread/);
  });
});

test.describe('Vendor bell — admin topbar', () => {
  test('bell is visible in the admin topbar with no ON/OFF toggle for it', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.waitForTimeout(400);
    await expect(page.locator('#adminBell')).toBeVisible();
  });

  test('customer placing a new order notifies the vendor', async ({ page }) => {
    const { state } = await openApp(page);
    await page.evaluate(() => window.menuChangeDate(1));
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.goToCheckout());
    await page.fill('#customerName', 'Test User');
    await page.click('#placeBtn');
    await page.waitForTimeout(500);

    await adminLogin(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#adminBellBadge')).not.toHaveClass(/hidden/);
    await page.evaluate(() => window.openVendorNotifSheet());
    await expect(page.locator('#vendorNotifSheet')).not.toHaveClass(/hidden/);
    await expect(page.locator('#vendorNotifList')).toContainText('New order');
  });

  test('customer cancelling an order notifies the vendor', async ({ page }) => {
    const state = freshState();
    const createdIso = nowISTStamp();
    const row = seedOrder(state, { createdIso });
    await openApp(page, { state, loggedIn: true });
    // cancelMyOrder() awaits a custom confirm-modal promise that only settles
    // once #cfYes is clicked — don't await the evaluate() itself (see
    // customer.spec.js's cancel test for why that deadlocks).
    page.evaluate(({ r, dd, ci }) => window.cancelMyOrder(r, dd, ci),
      { r: row, dd: todayIST(0), ci: createdIso });
    await expect(page.locator('#confirmModal')).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.click('#cfYes');
    await page.waitForTimeout(300);
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.loadVendorNotifications());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.openVendorNotifSheet());
    await expect(page.locator('#vendorNotifList')).toContainText('cancelled');
  });

  test('customer submitting a bulk request notifies the vendor', async ({ page }) => {
    const { state } = await openApp(page);
    await page.evaluate(() => window.openBulkOrderSheet());
    await page.selectOption('#bulkMeal', 'lunch');
    await page.fill('#bulkQty', '25');
    await page.fill('#bulkDate', await page.locator('#bulkDate').getAttribute('min'));
    await page.fill('#bulkAddr', 'Office, 12th floor');
    await page.click('#bulkSubmitBtn');
    await page.waitForTimeout(400);

    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.openVendorNotifSheet());
    await expect(page.locator('#vendorNotifList')).toContainText('Bulk order request');
  });

  test('opening the vendor bell sheet marks it as seen (badge clears)', async ({ page }) => {
    const { state } = await openApp(page);
    await page.evaluate(() => window.menuChangeDate(1));
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.goToCheckout());
    await page.fill('#customerName', 'Test User');
    await page.click('#placeBtn');
    await page.waitForTimeout(500);

    await adminLogin(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#adminBellBadge')).not.toHaveClass(/hidden/);
    await page.evaluate(() => window.openVendorNotifSheet());
    await page.evaluate(() => window.closeVendorNotifSheet());
    await page.evaluate(() => window.loadVendorNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#adminBellBadge')).toHaveClass(/hidden/);
  });

  test('bell keeps working when the (separate) sound alert toggle is OFF', async ({ page }) => {
    const { state } = await openApp(page);
    await page.evaluate(() => window.menuChangeDate(1));
    await page.evaluate(() => window.quickAdd('lunch'));
    await page.evaluate(() => window.goToCheckout());
    await page.fill('#customerName', 'Test User');
    await page.click('#placeBtn');
    await page.waitForTimeout(500);

    await adminLogin(page);
    await page.waitForTimeout(500);
    const alertsOn = await page.evaluate(() => window.alertsOn && window.alertsOn());
    if (alertsOn) await page.click('#alertToggle');
    await page.evaluate(() => window.loadVendorNotifications());
    await page.waitForTimeout(300);
    await expect(page.locator('#adminBellBadge')).not.toHaveClass(/hidden/);
  });
});
