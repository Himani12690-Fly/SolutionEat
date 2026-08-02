/**
 * A vendor can register their own Apps Script deployment (Super Admin ->
 * scriptUrl) so their order-placement doesn't serialize through the shared
 * deployment's global LockService.getScriptLock() alongside every other
 * vendor — a real bottleneck found while load-testing 50 concurrent vendors.
 *
 * loadVendorEndpoint() used to be the hook for this (a separate vendors.json
 * lookup) but was long dead — this file proves the replacement (scriptUrl
 * carried on the bootstrap response, applied via applyVendorScriptUrl())
 * actually switches where subsequent calls go, and that a malformed/foreign
 * URL is safely ignored rather than silently redirecting session tokens.
 */
const { test, expect } = require('@playwright/test');
const { openApp, freshState, SESSION } = require('./helpers');

test('vendor with a valid own deployment: calls after boot switch to it', async ({ page }) => {
  const state = freshState();
  const altUrl = 'https://script.google.com/macros/s/AKfycbALT0WNDEPLOY1234567/exec';
  state.vendorBrand = { name: 'Alt Kitchen', logo: '', whatsapp: '', scriptUrl: altUrl };

  const { errors } = await openApp(page, { state, vendor: 'nestandnosh' });
  expect(errors).toEqual([]);

  const seenUrls = [];
  await page.route(u => u.hostname === 'script.google.com', async (route) => {
    seenUrls.push(route.request().url());
    await route.fallback();
  });

  const r = await page.evaluate(async (token) => window.apiPost({ action: 'demologin', token }), SESSION.token);
  expect(r.status).toBe('success');
  expect(seenUrls.length).toBeGreaterThan(0);
  seenUrls.forEach(u => expect(u.startsWith(altUrl)).toBe(true));

  const activeUrl = await page.evaluate(() => window.GOOGLE_SCRIPT_URL);
  // GOOGLE_SCRIPT_URL is a page-scoped `let`, not attached to window — if this
  // read comes back undefined the assertion above (every seen call already
  // hit altUrl) is still the real proof; this is just a friendlier signal.
  expect(activeUrl === undefined || activeUrl === altUrl).toBe(true);
});

test('vendor with a malformed/foreign scriptUrl: stays on the shared deployment', async ({ page }) => {
  const state = freshState();
  const evilUrl = 'https://evil.example.com/steal?u=';
  state.vendorBrand = { name: 'Sketchy Kitchen', logo: '', whatsapp: '', scriptUrl: evilUrl };

  const { errors } = await openApp(page, { state, vendor: 'nestandnosh' });
  expect(errors).toEqual([]);

  const seenHosts = [];
  const KNOWN_HOSTS = ['script.google.com', 'accounts.google.com', 'api.qrserver.com'];
  await page.route(() => true, async (route) => {
    const host = new URL(route.request().url()).hostname;
    seenHosts.push(host);
    // Never let an actually-broken fix reach a real network — only fall
    // through for hosts helpers.js already mocks; abort anything else.
    if (KNOWN_HOSTS.includes(host)) await route.fallback();
    else await route.abort();
  });

  const r = await page.evaluate(async (token) => window.apiPost({ action: 'demologin', token }), SESSION.token);
  expect(r.status).toBe('success');
  expect(seenHosts).not.toContain('evil.example.com');
});
