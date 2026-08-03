/**
 * Google Sign-In inside a wrapped Android APK: Google blocks its own sign-in
 * flow inside any embedded WebView, so googleRedirectLogin() opens the auth
 * URL in the external system browser instead (simulated here by stubbing
 * window.open) and polls checkpendinggoogleauth until the external tab
 * (simulated by directly calling completependinggoogleauth, the way that
 * tab's consumeAuthCompleteHash() would) has finished.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', loggedIn: false, ...opts });

async function stubAsWrappedWebView(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36; wv)',
    });
    window.__openedUrls = [];
    window.open = (url) => { window.__openedUrls.push(url); return null; };
  });
}

test('isWrappedApp() detects the Android WebView user-agent marker', async ({ page }) => {
  await stubAsWrappedWebView(page);
  await openApp(page);
  const wrapped = await page.evaluate(() => window.isWrappedApp());
  expect(wrapped).toBe(true);
});

test('a normal mobile browser is not detected as wrapped', async ({ page }) => {
  await openApp(page); // default Pixel 7 UA from playwright.config.js — no "; wv)"
  const wrapped = await page.evaluate(() => window.isWrappedApp());
  expect(wrapped).toBe(false);
});

test('googleRedirectLogin() opens Google auth externally instead of navigating the WebView', async ({ page }) => {
  await stubAsWrappedWebView(page);
  await openApp(page);
  await page.evaluate(() => window.showAuth());
  await page.evaluate(() => window.googleRedirectLogin());
  const urls = await page.evaluate(() => window.__openedUrls);
  expect(urls.length).toBe(1);
  expect(urls[0]).toContain('accounts.google.com/o/oauth2/v2/auth');
  expect(urls[0]).toContain('authcomplete%3D1'); // redirect_uri carries ?authcomplete=1, URL-encoded
  expect(urls[0]).toMatch(/state=[a-f0-9]{24}/); // pendingId
  // The WebView itself must NOT have navigated away.
  expect(page.url()).not.toContain('accounts.google.com');
});

test('WebView resumes the session once the external tab completes sign-in', async ({ page }) => {
  const { state } = await openApp(page);
  await stubAsWrappedWebView(page);
  // stubAsWrappedWebView's addInitScript only applies on the NEXT navigation —
  // reload so both the UA stub and window.open stub are actually in effect.
  await page.reload();
  await page.waitForSelector('#bootLoader.gone', { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.showAuth());
  await page.evaluate(() => window.googleRedirectLogin());
  const pendingId = await page.evaluate(() => {
    const u = new URL(window.__openedUrls[0]);
    return u.searchParams.get('state');
  });
  expect(pendingId).toBeTruthy();
  // Simulate the external browser tab's consumeAuthCompleteHash() completing.
  await page.evaluate((pid) => window.apiPost({ action: 'completependinggoogleauth', credential: 'fake.jwt.token', pendingId: pid }), pendingId);
  // pollPendingGoogleAuth() runs on a 2s interval — wait for it to pick this up.
  await page.waitForFunction(() => window.isLoggedIn && window.isLoggedIn(), { timeout: 10000 });
  expect(state.calls.some(c => c.action === 'checkpendinggoogleauth')).toBe(true);
});
