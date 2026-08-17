/**
 * Vendor-side order ring.
 *
 * Pehle ye tha: naya order aaya -> ghanti baji -> vendor ne "Dismiss" dabaya ->
 * ghanti band, order waise ka waisa Pending pada rehta tha. Aur ghanti WebAudio +
 * setInterval se bajti thi, jise browser background/screen-off me throttle kar
 * deta hai — yani jis waqt ghanti ki sabse zyada zaroorat thi, wahi ruk jaati thi.
 *
 * Ab: ghanti sirf accept ya reject par rukti hai, row number storage me yaad
 * rehta hai (app band ho jaaye to bhi wapas khulte hi baj uthti hai), aur audio
 * loop se bajti hai jise browser rok nahi sakta.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState, todayIST } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

function seedOrder(state, over = {}) {
  const row = state.nextRow++;
  state.orders.push(Object.assign({
    row, deliveryDate: todayIST(0), meal: 'lunch', phone: '9876543210',
    name: 'Test User', society: 'Vrindavan', flat: 'D-706',
    status: 'Pending', mealStatus: { lunch: 'Pending' },
    total: '₹90', payment: 'COD', paymentStatus: 'Unpaid',
    breakfastQty: 0, lunchQty: 1, dinnerQty: 0,
    lunchSabzi: 'Dal Tadka', lunchTiffin: '1 Full Tiffin', lunchRoti: 'Plain',
    lunchAddons: 'None', lunchTimeSlot: '12–1 PM', dinnerSabzi: '', dinnerTiffin: '',
    dinnerRoti: '', dinnerAddons: 'None', note: '', promo: '', deliveryType: 'home',
    time: '01/01 10:00 AM', day: 'Monday', createdIso: new Date().toISOString().slice(0, 16)
  }, over));
  return row;
}

// checkNewOrders() lastRow ko pichhli baar ke saath compare karta hai. Order
// seed karke counter peeche kar dete hain — bilkul waisa hi jaisa asli naya
// order aane par hota hai.
async function fireNewOrder(page, row) {
  await page.evaluate((r) => window.storeSet('fbt_lastrow', r - 1), row);
  await page.evaluate(() => window.checkNewOrders());
  await page.waitForTimeout(500);
}

const ringRows = (page) => page.evaluate(() => window.ringRows());

test.describe('Naye order ki ghanti', () => {
  test('banner par ab do jawaab hain — dismiss nahi', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await fireNewOrder(page, row);
    await expect(page.locator('#newOrderBanner')).not.toHaveClass(/hidden/);
    await expect(page.locator('.nob-btn.ok')).toBeVisible();
    await expect(page.locator('.nob-btn.no')).toBeVisible();
    expect(await ringRows(page)).toContain(row);
  });

  test('"Abhi list dekho" banner hataata hai par ghanti bajti rehti hai', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await fireNewOrder(page, row);
    await page.click('.nob-later');
    await expect(page.locator('#newOrderBanner')).toHaveClass(/hidden/);
    // Yahi asli farq hai: banner gaya, ghanti nahi.
    await page.waitForTimeout(300);
    expect(await ringRows(page)).toContain(row);
    expect(await page.evaluate(() => window.ringActive())).toBe(true);
  });

  test('accept karne par order Preparing hota hai aur ghanti rukti hai', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await fireNewOrder(page, row);
    await page.click('.nob-btn.ok');
    await page.waitForTimeout(700);
    expect(state.orders.find(o => o.row === row).status).toBe('Preparing');
    expect(await ringRows(page)).toEqual([]);
  });

  test('reject karne par order Cancelled hota hai aur ghanti rukti hai', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await fireNewOrder(page, row);
    await page.click('.nob-btn.no');
    await page.waitForTimeout(700);
    expect(state.orders.find(o => o.row === row).status).toBe('Cancelled');
    expect(await ringRows(page)).toEqual([]);
  });

  test('order pehle se accept ho chuka ho to watcher ghanti band kar deta hai', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await fireNewOrder(page, row);
    expect(await ringRows(page)).toContain(row);
    // Vendor ne banner se nahi, list se accept kiya — ghanti phir bhi ruke.
    await page.evaluate((r) => window.updateStatus(r, 'Preparing'), row);
    await page.waitForTimeout(1500);   // watcher 1s ka hai
    expect(await ringRows(page)).toEqual([]);
  });

  test('app dobara khulne par unhandled order ki ghanti wapas baj uthti hai', async ({ page }) => {
    test.setTimeout(90_000);   // openApp + adminLogin + reload, ek test me — 60s tight hai
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await fireNewOrder(page, row);
    await page.click('.nob-later');
    // App band -> dobara khuli. Row storage me hai, order abhi bhi Pending hai.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.ringActive && window.ringActive(), { timeout: 15000 });
    expect(await ringRows(page)).toContain(row);
  });
});
