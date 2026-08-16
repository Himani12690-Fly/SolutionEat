/**
 * Per-vendor "Add to Home Screen" branding — GitHub Pages is static hosting
 * (one manifest.json for everyone), so applyVendorManifest() swaps the
 * <link rel="manifest"> to a data: URI per vendor at runtime. Two things
 * matter, not just the icon: start_url must point back at THIS vendor's own
 * clean /<vendor> link (otherwise the installed icon would open the bare
 * platform site,
 * losing vendor context entirely), and the icon must never be the transparent
 * placeholder used before real vendor data arrives.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, freshState } = require('./helpers');
const openApp = (page, opts = {}) => {
  const state = opts.state || freshState();
  if (!state.vendorBrand) state.vendorBrand = { name: 'Nest & Nosh', logo: '', whatsapp: '' };
  return openAppRaw(page, { vendor: 'nestandnosh', ...opts, state });
};

test('manifest link becomes a per-vendor data: URI with the correct start_url', async ({ page }) => {
  await openApp(page);
  const manifest = await page.evaluate(() => {
    const href = document.getElementById('appManifestLink').href;
    const json = decodeURIComponent(href.replace('data:application/manifest+json,', ''));
    return JSON.parse(json);
  });
  // URL ab ?v=<id> se maskarke clean /<id> path par aa gaya hai, aur
  // start_url wahi clean path hai. scope jaan-boojh kar poora origin ('/')
  // hai — warna installed app ek vendor ke path me hi kaid ho jaata.
  expect(manifest.start_url).toBe('/nestandnosh');
  expect(manifest.scope).toBe('/');
  expect(manifest.name).toContain('Nest & Nosh');
  expect(manifest.icons.length).toBeGreaterThan(0);
  expect(manifest.icons[0].src).toBeTruthy();
});

test('apple-touch-icon updates to the same vendor icon', async ({ page }) => {
  await openApp(page);
  const [touchIconHref, manifestIconSrc] = await page.evaluate(() => {
    const href = document.getElementById('appManifestLink').href;
    const json = decodeURIComponent(href.replace('data:application/manifest+json,', ''));
    return [document.getElementById('appTouchIcon').href, JSON.parse(json).icons[0].src];
  });
  expect(touchIconHref).toBe(manifestIconSrc);
});

test('different vendors get different manifests (name + start_url both vendor-specific)', async ({ page }) => {
  const state = freshState();
  state.vendorBrand = { name: 'Shyam Rasoi', logo: '', whatsapp: '' };
  await openAppRaw(page, { vendor: 'shyamrasoi', state });
  const manifest = await page.evaluate(() => {
    const href = document.getElementById('appManifestLink').href;
    return JSON.parse(decodeURIComponent(href.replace('data:application/manifest+json,', '')));
  });
  expect(manifest.start_url).toBe('/shyamrasoi');
  expect(manifest.name).toContain('Shyam Rasoi');
});
