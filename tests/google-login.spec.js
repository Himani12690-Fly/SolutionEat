/**
 * Google Sign-In on a normal (non-wrapped) browser: googleRedirectLogin() does
 * a full-page location.href redirect to accounts.google.com, which redirects
 * back to the bare GOOGLE_REDIRECT_URI (Google requires an exact, query-free
 * redirect_uri, so the ?v=<vendor> the customer started on gets stripped and
 * stashed in sessionStorage as g_ret to be restored after login completes).
 *
 * Regression coverage for a real reported bug: a first-time Google sign-in
 * (no phone on file yet) got the customer stuck — the phone-entry form was
 * unhidden but its parent #authPage was never shown (still "hidden" from the
 * fresh post-redirect page load), so nothing was visible; recoverIfBlank()
 * then saw no view visible and, since ?v= was stripped, bounced the customer
 * to the shared Discovery/vendor list — an unrelated screen with no way back
 * into the phone form. See onGoogleCredential()'s need_phone branch and
 * finishGoogleLogin()'s g_ret restoration in index.html.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw } = require('./helpers');

test.describe('Google Sign-In redirect flow — first-time login (need_phone)', () => {
  // No opts.vendor here on purpose: this reproduces the actual post-Google-
  // redirect landing page (bare URL, ?v= stripped by Google's exact-match
  // redirect_uri requirement) — boot shows Discovery by default for a bare
  // link, exactly as it would right before onGoogleCredential's async
  // response arrives and the customer never explicitly saw #authPage.
  test('the phone-entry form is actually shown, not stuck invisible behind Discovery', async ({ page }) => {
    await openAppRaw(page, { loggedIn: false });
    await expect(page.locator('#dscView')).not.toHaveClass(/hidden/); // sanity: bare-link boot default
    await page.evaluate(() => window.onGoogleCredential({ credential: 'fake.jwt.token' }));
    await page.waitForTimeout(200);
    await expect(page.locator('#authPage')).not.toHaveClass(/hidden/);
    await expect(page.locator('#googlePhoneBox')).not.toHaveClass(/hidden/);
    // #bootLoader is already removed from the DOM by this point (normal boot
    // completion, unrelated to this fix) — nothing meaningful to assert on it here.
  });

  test('never leaves the customer stuck on the Discovery/vendor list instead of the phone form', async ({ page }) => {
    await openAppRaw(page, { loggedIn: false });
    await expect(page.locator('#dscView')).not.toHaveClass(/hidden/); // sanity: bare-link boot default
    await page.evaluate(() => window.onGoogleCredential({ credential: 'fake.jwt.token' }));
    await page.waitForTimeout(200);
    await expect(page.locator('#dscView')).toHaveClass(/hidden/);
  });

  test('completing the phone step logs the customer into the vendor they started with, not the default one', async ({ page }) => {
    // Simulate the post-Google-redirect landing page: bare URL (no ?v=, exactly
    // what Google's exact-match redirect_uri forces), with g_ret stashed by
    // googleRedirectLogin() before it navigated away.
    await openAppRaw(page, { loggedIn: false }); // no vendor -> bare URL, default-vendor context
    await page.evaluate(() => { sessionStorage.setItem('g_ret', '?v=otherkitchen'); });
    await page.evaluate(() => window.showAuth());
    await page.evaluate(() => window.onGoogleCredential({ credential: 'fake.jwt.token' }));
    await expect(page.locator('#googlePhoneBox')).not.toHaveClass(/hidden/);
    await page.fill('#authName', 'Test Customer');
    await page.fill('#authPhone', '9876543210');
    await Promise.all([
      page.waitForURL(/[?&]v=otherkitchen/),
      page.click('#finishLoginBtn'),
    ]);
    expect(page.url()).toContain('v=otherkitchen');
  });

  // Regression for a real reported bug: right after this exact redirect+restore
  // (base URL -> googleLogin succeeds -> ?v=otherkitchen restored via
  // location.replace), the customer was bounced straight back to the login
  // page. Root cause: storeSet('fbt_session', SESSION) ran while VENDOR_ID was
  // still resolving to the DEFAULT vendor (Google's redirect_uri can't carry
  // ?v=), so the session was persisted under the DEFAULT-vendor localStorage
  // key; the very next boot — now correctly on ?v=otherkitchen — reads the
  // vendor-namespaced key instead, finds nothing, and shows the login page.
  // Fixed by also stashing SESSION in a one-shot sessionStorage slot (g_sess)
  // right before the redirect, picked up by shared.js's boot code once
  // VENDOR_ID is correct. This test proves the fix by reloading — a real app
  // reopen — after landing on the restored URL and confirming login holds.
  test('session survives the ?v= restore — reopening the app after redirect login does NOT bounce back to login', async ({ page }) => {
    await openAppRaw(page, { loggedIn: false });
    await page.evaluate(() => { sessionStorage.setItem('g_ret', '?v=otherkitchen'); });
    await page.evaluate(() => window.showAuth());
    await page.evaluate(() => window.onGoogleCredential({ credential: 'fake.jwt.token' }));
    await expect(page.locator('#googlePhoneBox')).not.toHaveClass(/hidden/);
    await page.fill('#authName', 'Test Customer');
    await page.fill('#authPhone', '9876543210');
    await Promise.all([
      page.waitForURL(/[?&]v=otherkitchen/),
      page.click('#finishLoginBtn'),
    ]);
    await page.waitForLoadState('domcontentloaded');
    expect(await page.evaluate(() => window.isLoggedIn())).toBe(true);
    // A real app reopen: fresh navigation to the exact same (now vendor-correct) URL.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof window.isLoggedIn === 'function');
    expect(await page.evaluate(() => window.isLoggedIn())).toBe(true);
    await expect(page.locator('#authPage')).toHaveClass(/hidden/);
  });

  // Same fix, other call site: onGoogleCredential()'s own direct-success path
  // (phone already on file, so googleLogin succeeds without the phone step).
  test('session survives the ?v= restore on the direct (no phone-step) login path too', async ({ page }) => {
    await openAppRaw(page, { loggedIn: false });
    await page.evaluate(() => { sessionStorage.setItem('g_ret', '?v=otherkitchen'); });
    await page.evaluate(() => window.showAuth());
    // #authPhone is normally hidden until a credential arrives (need_phone
    // branch unhides it) — set the value directly, readAuthPhone() only cares
    // about .value, not visibility. This simulates a returning customer whose
    // phone is already on file, so googleLogin succeeds without the phone step.
    await page.evaluate(() => { document.getElementById('authPhone').value = '9876543210'; });
    await Promise.all([
      page.waitForURL(/[?&]v=otherkitchen/),
      page.evaluate(() => window.onGoogleCredential({ credential: 'fake.jwt.token' })),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof window.isLoggedIn === 'function');
    expect(await page.evaluate(() => window.isLoggedIn())).toBe(true);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof window.isLoggedIn === 'function');
    expect(await page.evaluate(() => window.isLoggedIn())).toBe(true);
    await expect(page.locator('#authPage')).toHaveClass(/hidden/);
  });
});
