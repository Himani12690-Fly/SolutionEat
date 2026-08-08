/**
 * First-run onboarding overlay — Android-app-style swipeable walkthrough,
 * shown only the very first time this browser/device opens the app
 * (fbt_onboarded flag), skippable, never repeats. helpers.js's openApp()
 * sets fbt_onboarded=1 by default for every OTHER test (skipOnboarding
 * defaults true) specifically so this overlay doesn't cover the screen
 * and break unrelated tests — these tests explicitly opt back into a
 * "new browser" state via skipOnboarding:false.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

test('shows automatically for a brand-new browser (fbt_onboarded not set)', async ({ page }) => {
  await openApp(page, { skipOnboarding: false });
  await expect(page.locator('#onboardOverlay')).not.toHaveClass(/hidden/);
});

test('does not show for a returning browser (default test state)', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#onboardOverlay')).toHaveClass(/hidden/);
});

test('Skip dismisses it and it never shows again on reload', async ({ page }) => {
  await openApp(page, { skipOnboarding: false });
  await expect(page.locator('#onboardOverlay')).not.toHaveClass(/hidden/);
  await page.click('text=Skip');
  await expect(page.locator('#onboardOverlay')).toHaveClass(/hidden/);
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.locator('#onboardOverlay')).toHaveClass(/hidden/);
});

test('Get Started dismisses it the same way as Skip', async ({ page }) => {
  await openApp(page, { skipOnboarding: false });
  await page.click('text=Get Started');
  await expect(page.locator('#onboardOverlay')).toHaveClass(/hidden/);
});

test('has exactly 4 slides', async ({ page }) => {
  await openApp(page, { skipOnboarding: false });
  const slides = await page.locator('#onboardSlides .about-slide').count();
  expect(slides).toBe(4);
});
