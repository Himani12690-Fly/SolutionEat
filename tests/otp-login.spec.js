/**
 * Mobile OTP login — Google Sign-In ka doosra option (fast2sms.com se SMS).
 * Poora round-trip Google login jaisa hi khatam hota hai: SESSION={token,
 * name,phone}, storeSet('fbt_session',...), enterApp() — sirf verification
 * ka tareeka alag hai (OTP vs Google JWT). Naya phone number "need_name"
 * round-trip se guzarta hai (googleLogin() ke need_phone jaisa hi pattern),
 * taaki koi "Guest" account na bane.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

// ⚠️ TEMPORARY: OTP login abhi band hai (shared.js ka OTP_LOGIN_ENABLED=false) —
// login page pe uska entry point chhupa hua hai, isliye ye tests UI tak pahunch
// hi nahi paate. Flow ka code (UI, JS, i18n, backend actions) delete NAHI kiya
// gaya, sirf hide kiya hai — isliye tests bhi delete nahi kar rahe, skip kar
// rahe hain. Feature wapas ON karte hi ye beforeEach hata dena.
test.beforeEach(async ({}, testInfo) => {
  testInfo.skip(true, 'OTP login temporarily disabled — see OTP_LOGIN_ENABLED in shared.js');
});

test.describe('Mobile OTP login — UI', () => {
  test('toggle button reveals the OTP box and hides itself', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#otpLoginBox')).toHaveClass(/hidden/);
    await page.click('#otpToggleBtn');
    await expect(page.locator('#otpLoginBox')).not.toHaveClass(/hidden/);
    await expect(page.locator('#otpToggleBtn')).toHaveClass(/hidden/);
    await expect(page.locator('#otpPhoneStep')).not.toHaveClass(/hidden/);
  });

  test('invalid phone number shows a client-side error, no network call', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '12345');
    await page.click('#otpSendBtn');
    await expect(page.locator('#err-otpPhone')).toHaveClass(/show/);
    await expect(page.locator('#otpCodeStep')).toHaveClass(/hidden/);
  });

  test('sending a valid phone moves to the code step with a sent-to hint', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9998887771');
    await page.click('#otpSendBtn');
    await expect(page.locator('#otpPhoneStep')).toHaveClass(/hidden/);
    await expect(page.locator('#otpCodeStep')).not.toHaveClass(/hidden/);
    await expect(page.locator('#otpSentHint')).toContainText('9998887771');
    // Resend cooldown starts immediately (60s window).
    await expect(page.locator('#otpResendLink')).toContainText('60s');
  });

  test('"Change number" goes back to the phone step and clears the code', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9998887771');
    await page.click('#otpSendBtn');
    await page.fill('#otpCode', '999999');
    await page.click('#otpChangeNumberLink');
    await expect(page.locator('#otpCodeStep')).toHaveClass(/hidden/);
    await expect(page.locator('#otpPhoneStep')).not.toHaveClass(/hidden/);
    expect(await page.locator('#otpCode').inputValue()).toBe('');
  });

  test('showAuth() resets the OTP box to a fresh phone-entry state', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9998887771');
    await page.click('#otpSendBtn');
    await expect(page.locator('#otpCodeStep')).not.toHaveClass(/hidden/);
    await page.evaluate(() => window.showAuth());
    await expect(page.locator('#otpLoginBox')).toHaveClass(/hidden/);
    await expect(page.locator('#otpToggleBtn')).not.toHaveClass(/hidden/);
    await expect(page.locator('#otpPhoneStep')).not.toHaveClass(/hidden/);
    await expect(page.locator('#otpCodeStep')).toHaveClass(/hidden/);
    expect(await page.locator('#otpPhone').inputValue()).toBe('');
  });
});

test.describe('Mobile OTP login — existing user', () => {
  test('correct OTP for an already-registered phone logs straight in', async ({ page }) => {
    const state = freshState();   // seeds phone 9876543210 as an existing user
    await openApp(page, { state, loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9876543210');
    await page.click('#otpSendBtn');
    await expect(page.locator('#otpCodeStep')).not.toHaveClass(/hidden/);
    await page.fill('#otpCode', '123456');   // fixed test OTP, see tests/helpers.js
    await page.click('#otpVerifyBtn');
    await expect(page.locator('#authPage')).toHaveClass(/hidden/);
    // SESSION is a top-level `let`, not exposed on window — read the stored
    // session back from localStorage instead (same JS-scoping gotcha this
    // whole test suite already works around elsewhere).
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('fbt_session')));
    expect(session.phone).toBe('9876543210');
    expect(session.name).toBe('Test User');   // existing name from the seeded Users row, not overwritten
  });

  test('wrong OTP shows an error and stays on the code step', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state, loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9876543210');
    await page.click('#otpSendBtn');
    await page.fill('#otpCode', '000000');
    await page.click('#otpVerifyBtn');
    await expect(page.locator('#toast')).toContainText('Incorrect OTP');
    await expect(page.locator('#otpCodeStep')).not.toHaveClass(/hidden/);
    await expect(page.locator('#authPage')).not.toHaveClass(/hidden/);
  });

  test('5 wrong attempts invalidates the OTP — must request a new one', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state, loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9876543210');
    await page.click('#otpSendBtn');
    // Backend allows 5 wrong guesses (each individually rejected as "incorrect"),
    // and only locks out starting from the 6th request — matches apps-script-v6.txt's
    // `if (attempts >= 5) { ...lock out... }` check running BEFORE the increment.
    for (let i = 0; i < 5; i++) {
      await page.fill('#otpCode', '000000');
      await page.click('#otpVerifyBtn');
      await page.waitForTimeout(150);
    }
    await page.fill('#otpCode', '000000');
    await page.click('#otpVerifyBtn');
    await expect(page.locator('#toast')).toContainText('Too many wrong attempts');
    // Even the CORRECT code no longer works — the OTP itself is gone server-side.
    await page.fill('#otpCode', '123456');
    await page.click('#otpVerifyBtn');
    await expect(page.locator('#toast')).toContainText('expired');
  });

  test('4 OTP sends in a row hits the send-throttle on the 5th', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state, loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9876543210');
    for (let i = 0; i < 5; i++) {
      // Bypass the UI cooldown lock (resend link) and call the function directly —
      // this test is about the SERVER-side send-throttle, not the client cooldown UI.
      await page.evaluate(() => window.sendOtpCode());
      await page.waitForTimeout(150);
    }
    await expect(page.locator('#toast')).toContainText('Too many OTP requests');
  });
});

test.describe('Mobile OTP login — new user (need_name)', () => {
  test('correct OTP for a brand-new phone asks for a name, then completes signup', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state, loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9998887771');   // not in freshState()'s seeded users
    await page.click('#otpSendBtn');
    await page.fill('#otpCode', '123456');
    await page.click('#otpVerifyBtn');
    await expect(page.locator('#otpCodeStep')).toHaveClass(/hidden/);
    await expect(page.locator('#otpNameStep')).not.toHaveClass(/hidden/);
    await page.fill('#otpName', 'Naya Customer');
    await page.click('#otpNameBtn');
    await expect(page.locator('#authPage')).toHaveClass(/hidden/);
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('fbt_session')));
    expect(session.phone).toBe('9998887771');
    expect(session.name).toBe('Naya Customer');
    expect(state.users.some(u => u.phone === '9998887771' && u.name === 'Naya Customer')).toBe(true);
  });

  test('a too-short name is rejected client-side', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state, loggedIn: false });
    await page.evaluate(() => window.showAuth());
    await page.click('#otpToggleBtn');
    await page.fill('#otpPhone', '9998887771');
    await page.click('#otpSendBtn');
    await page.fill('#otpCode', '123456');
    await page.click('#otpVerifyBtn');
    await expect(page.locator('#otpNameStep')).not.toHaveClass(/hidden/);
    await page.fill('#otpName', 'A');
    await page.click('#otpNameBtn');
    await expect(page.locator('#err-otpName')).toHaveClass(/show/);
    await expect(page.locator('#otpNameStep')).not.toHaveClass(/hidden/);   // still stuck here, not moved on
  });
});
