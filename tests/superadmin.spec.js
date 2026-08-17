const { test, expect } = require('@playwright/test');
const { openApp, superLogin, freshState } = require('./helpers');

test.describe('Super admin', () => {
  test('sahi creds se vendor list', async ({ page }) => {
    await openApp(page);
    await superLogin(page);
    await expect(page.locator('#superPanel')).toBeVisible();
    await expect(page.locator('#superVendorList .pf-box')).toHaveCount(1);
  });

  test('galat creds reject', async ({ page }) => {
    await openApp(page);
    await superLogin(page, 'yuvraj_owner', 'nope');
    await expect(page.locator('#superPanel')).toHaveClass(/hidden/);
    await expect(page.locator('#toast')).toContainText('Invalid');
  });

  // Naya kitchen = 4 field. Sheet ID / admin username / password ab Technical
  // accordion me hain aur khaali chhodne ke liye hain — server teenon khud banata
  // hai. Ye teen tests unhe explicitly bharte the, isliye accordion pehle kholna
  // padta hai (naya-vendor form ab sirf pehla group khola rakhta hai).
  const openTech = (page) => page.evaluate(() => window.svFormToggle('technical'));

  test('4 field se kitchen ban jaata hai — koi sheet ID, koi password nahi', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await page.click('button:has-text("Naya Vendor Add Karo")');
    await page.fill('#svFssaiNew', '20724NEWKITCHEN');
    await page.fill('#svId', 'shyamrasoi');
    await page.fill('#svName', 'Shyam Rasoi');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(500);
    const v = state.vendors.find(x => x.vendorId === 'shyamrasoi');
    expect(v).toBeTruthy();
    expect(v.sheetId).toBeTruthy();          // server ne khud banayi
    expect(v.adminUser).toBe('shyamrasoi');  // slug hi username ban gaya
    // FSSAI registry me nahi, vendor ki config me jaata hai.
    expect(state.vendorConfigs.shyamrasoi.fssai).toBe('20724NEWKITCHEN');
  });

  test('auto-banaya login screen par dikhta hai — warna vendor ko dene ke liye kuch nahi', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await page.click('button:has-text("Naya Vendor Add Karo")');
    await page.fill('#svId', 'shyamrasoi');
    await page.fill('#svName', 'Shyam Rasoi');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(500);
    // Password sirf isi response me aata hai (sheet me hash jaata hai), isliye
    // list par kudna nahi chahiye — box dikhna chahiye.
    await expect(page.locator('#svNewCreds')).not.toHaveClass(/hidden/);
    await expect(page.locator('#svNewCredsBody')).toContainText('shyamrasoi');
    await expect(page.locator('#svNewCredsBody')).toContainText('Admin password');
  });

  test('naya-vendor form sirf pehla group khola rakhta hai', async ({ page }) => {
    await openApp(page);
    await superLogin(page);
    await page.click('button:has-text("Naya Vendor Add Karo")');
    await expect(page.locator('#svfp-identity')).not.toHaveClass(/hidden/);
    await expect(page.locator('#svfp-technical')).toHaveClass(/hidden/);
    await expect(page.locator('#svfp-notify')).toHaveClass(/hidden/);
  });

  test('apni bani hui sheet ka ID bhi de sakte ho', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await page.click('button:has-text("Naya Vendor Add Karo")');
    await page.fill('#svId', 'shyamrasoi');
    await page.fill('#svName', 'Shyam Rasoi');
    await openTech(page);
    await page.fill('#svSheetId', 'SHEET_NEW_123');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(500);
    expect(state.vendors.find(x => x.vendorId === 'shyamrasoi').sheetId).toBe('SHEET_NEW_123');
    // Sheet khud nahi bani, isliye creds box me sheet ka link bhi nahi hona chahiye
    // (password phir bhi auto bana — wo field khaali chhodi thi).
    await expect(page.locator('#svNewCreds')).not.toHaveClass(/hidden/);
    await expect(page.locator('#svNewCredsBody')).not.toContainText('khol kar dekho');
  });

  test('URL paste karne par slug clean hota hai', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await page.click('button:has-text("Naya Vendor Add Karo")');
    await page.fill('#svName', 'Test');
    await page.fill('#svId', 'https://app.com/?v=shyamrasoi');
    await openTech(page);
    await page.fill('#svSheetId', 'https://docs.google.com/spreadsheets/d/ABC123/edit');
    await page.fill('#svAdminUser', 'a');
    await page.fill('#svAdminPass', 'b');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(500);
    const v = state.vendors.find(x => x.vendorId === 'shyamrasoi');
    expect(v).toBeTruthy();
    expect(v.sheetId).toBe('ABC123');
  });

  test('duplicate sheet ID reject', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await superLogin(page);
    await page.click('button:has-text("Naya Vendor Add Karo")');
    await page.fill('#svName', 'Dupe');
    await page.fill('#svId', 'dupe');
    await openTech(page);
    await page.fill('#svSheetId', 'SHEET1');     // default vendor ka
    await page.fill('#svAdminUser', 'a');
    await page.fill('#svAdminPass', 'b');
    await page.click('#svSaveBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#toast')).toContainText('pehle se');
    expect(state.vendors.length).toBe(1);
  });

  test('zaroori fields bina save nahi', async ({ page }) => {
    await openApp(page);
    await superLogin(page);
    await page.click('button:has-text("Naya Vendor Add Karo")');
    await page.fill('#svName', 'Adhura');   // slug khaali — ab bas ye do zaroori hain
    await page.click('#svSaveBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('zaroori');
  });

  test('superadmin logout', async ({ page }) => {
    await openApp(page);
    await superLogin(page);
    await page.evaluate(() => window.superLogout());
    await page.waitForTimeout(300);
    await expect(page.locator('#superPanel')).toHaveClass(/hidden/);
  });
});
