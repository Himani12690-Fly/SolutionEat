/**
 * Super Admin acting on behalf of a specific vendor — the flip side of the
 * vendor-Setup simplification. Rare/risky/setup-once settings (legal info,
 * UPI, societies, delivery-mode structure, companies, discovery toggle,
 * WhatsApp toggle, new meal types, user block/reset) were removed from the
 * vendor's own Setup/Users tabs (see admin.spec.js, private-mode.spec.js,
 * share-kitchen.spec.js for the vendor-side half of that change) and now
 * live here, on the Super Admin per-vendor detail page — Super Admin edits
 * them on the vendor's behalf when the vendor requests a change.
 */
const { test, expect } = require('@playwright/test');
const { openApp, superLogin, freshState } = require('./helpers');
const { CONFIG } = require('./fixtures');

async function openVendor(page, id = 'nestandnosh') {
  await page.evaluate((vid) => window.openVendorDetail(vid), id);
}
// Har group ka apna accordion hai (cfg-acc-bd hidden by default) — fields
// tabhi interactable hain jab unka accordion khula ho, "Kitchen" accordion
// wale bug se seekha sabak (nearby-kitchens.spec.js).
async function openGroup(page, group) {
  await page.evaluate((g) => window.svCfgToggle(g), group);
}

test.describe('Super Admin — vendor config (Legal & Payments)', () => {
  test('loads the vendor\'s current values when the detail page opens', async ({ page }) => {
    const state = freshState();
    state.vendorConfigs.nestandnosh = { ...CONFIG, fssai: '20724OLDVALUE', upiId: 'old@ybl' };
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'legal');
    await expect(page.locator('#svcFssai')).toHaveValue('20724OLDVALUE');
    await expect(page.locator('#svcUpiId')).toHaveValue('old@ybl');
  });

  test('saves FSSAI/Legal/GST/UPI without touching other config', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'legal');
    await page.fill('#svcFssai', '20724NEWVALUE');
    await page.fill('#svcLegalName', 'Test Kitchen Pvt Ltd');
    await page.fill('#svcGst', '24abcde1234f1zy');
    await page.fill('#svcUpiId', 'newvendor@okhdfcbank');
    await page.fill('#svcUpiName', 'New Vendor');
    await page.click('button:has-text("Save Legal & Payments")');
    await page.waitForTimeout(300);
    const cfg = state.vendorConfigs.nestandnosh;
    expect(cfg.fssai).toBe('20724NEWVALUE');
    expect(cfg.legalName).toBe('Test Kitchen Pvt Ltd');
    expect(cfg.gstNumber).toBe('24abcde1234f1zy');
    expect(cfg.upiId).toBe('newvendor@okhdfcbank');
    expect(cfg.upiName).toBe('New Vendor');
  });
});

test.describe('Super Admin — vendor config (Delivery Setup)', () => {
  test('at least one delivery mode must stay ON', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'delivery');
    await page.uncheck('#svcHomeEnabled');
    await page.uncheck('#svcOfficeEnabled');
    // Takeaway bhi band — warna ye ab ek valid pickup-only vendor hai aur save
    // sahi me chalna chahiye (neeche wala test). Guard tabhi lagta hai jab
    // teeno OFF hon.
    await page.uncheck('#svcTakeawayEnabled');
    await page.click('button:has-text("Save Delivery Setup")');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('delivery mode');
    // openVendorDetail() already auto-loaded the config (creating the mock's
    // lazy vendorConfigs entry) — the assertion that matters is that the
    // blocked save never flipped homeEnabled, not that the entry is absent.
    expect(state.vendorConfigs.nestandnosh.homeEnabled).not.toBe(false);
  });

  test('sirf takeaway wala vendor save ho jaata hai (pickup-only shop)', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'delivery');
    await page.uncheck('#svcHomeEnabled');
    await page.uncheck('#svcOfficeEnabled');
    await page.check('#svcTakeawayEnabled');
    await page.click('button:has-text("Save Delivery Setup")');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).not.toContainText('delivery mode');
    const cfg = state.vendorConfigs.nestandnosh;
    expect(cfg.homeEnabled).toBe(false);
    expect(cfg.officeEnabled).toBe(false);
    expect(cfg.takeawayEnabled).toBe(true);
  });

  test('office mode ON requires at least one company', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'delivery');
    await page.check('#svcOfficeEnabled');
    await page.fill('#svcCompanies', '');
    await page.click('button:has-text("Save Delivery Setup")');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('company');
  });

  test('saves societies, companies and discovery toggle', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'delivery');
    await page.fill('#svcTownship', 'Test Township');
    await page.fill('#svcSocieties', 'Alpha\nBeta');
    await page.check('#svcOfficeEnabled');
    await page.fill('#svcCompanies', 'Acme Corp | Tower A | 25');
    await page.uncheck('#svcListInDiscovery');
    await page.click('button:has-text("Save Delivery Setup")');
    await page.waitForTimeout(300);
    const cfg = state.vendorConfigs.nestandnosh;
    expect(cfg.township).toBe('Test Township');
    expect(cfg.societies).toEqual(['Alpha', 'Beta']);
    expect(cfg.companies).toEqual([{ name: 'Acme Corp', building: 'Tower A', fee: 25 }]);
    expect(cfg.listInDiscovery).toBe(false);
  });
});

test.describe('Super Admin — Add Meal Type', () => {
  test('adds a new meal type for the target vendor', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'meals');
    await page.fill('#svmKey', 'eveningsnacks');
    await page.fill('#svmTitle', 'Evening Snacks');
    await page.fill('#svmPrice', '45');
    await page.click('button:has-text("Add Meal Type")');
    await page.waitForTimeout(300);
    const mt = state.vendorConfigs.nestandnosh.mealTypes.find(m => m.key === 'eveningsnacks');
    expect(mt).toBeTruthy();
    expect(mt.title).toBe('Evening Snacks');
    expect(mt.price).toBe(45);
    await expect(page.locator('#svCurrentMealTypes')).toContainText('Evening Snacks');
  });

  test('rejects a duplicate meal key', async ({ page }) => {
    const state = freshState();
    state.vendorConfigs.nestandnosh = { ...CONFIG,
      mealTypes: [{ key: 'lunch', title: 'Lunch', emoji: '🍽️', price: 80, capacity: 0,
                    windowStart: '12:00', windowEnd: '14:00', cutoff: '09:00', enabled: true, hasVariants: true }] };
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'meals');
    await page.fill('#svmKey', 'lunch');
    await page.fill('#svmTitle', 'Duplicate Lunch');
    await page.click('button:has-text("Add Meal Type")');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('maujood');
  });
});

test.describe('Super Admin — Users (block/unblock, reset)', () => {
  function seedUsers(state) {
    state.vendorUsers.nestandnosh = [
      { phone: '9876543210', name: 'Test User', email: 't@test.com', created: '01 Jan 25', lastLogin: '01 Jan 25', status: 'Active', orders: 2 },
    ];
    return state;
  }

  test('loads the vendor\'s user list', async ({ page }) => {
    const state = seedUsers(freshState());
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'users');
    await page.evaluate(() => window.svLoadUsers());
    await page.waitForTimeout(300);
    await expect(page.locator('#svUsersList')).toContainText('Test User');
  });

  test('blocks a user', async ({ page }) => {
    const state = seedUsers(freshState());
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'users');
    await page.evaluate(() => window.svLoadUsers());
    await page.waitForTimeout(300);
    await page.click('button:has-text("🚫 Block")');
    await page.waitForTimeout(300);
    expect(state.vendorUsers.nestandnosh[0].status).toBe('Blocked');
  });

  test('resets a user after confirmation', async ({ page }) => {
    const state = seedUsers(freshState());
    await openApp(page, { state });
    await superLogin(page);
    await openVendor(page);
    await openGroup(page, 'users');
    await page.evaluate(() => window.svLoadUsers());
    await page.waitForTimeout(300);
    page.on('dialog', d => d.accept());
    await page.click('button:has-text("🗑️ Reset")');
    await page.waitForTimeout(300);
    expect(state.vendorUsers.nestandnosh.length).toBe(0);
  });
});

test.describe('Super Admin — new vendor creation', () => {
  test('config/users section is hidden until the vendor actually exists', async ({ page }) => {
    await openApp(page);
    await superLogin(page);
    await page.click('button:has-text("Naya Vendor Add Karo")');
    await expect(page.locator('#svConfigSection')).toHaveClass(/hidden/);
  });
});
