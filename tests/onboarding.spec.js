/**
 * App-tour overlay — Android-app-style swipeable walkthrough. Used to
 * auto-show on a brand-new browser (fbt_onboarded flag) — this popped up
 * unpredictably on top of whatever screen the boot sequence landed on
 * (sometimes the login page, sometimes Home, depending on whether the
 * browser already had a session), which read as a random/broken popup. Now
 * it's on-demand only, via a persistent "❓" corner button (#helpTourBtn)
 * that showView() shows/hides per screen (hidden on admin/checkout/kitchen-
 * closed, visible everywhere else customer-facing).
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

test('never shows automatically on boot, brand-new browser or not', async ({ page }) => {
  await openApp(page, { skipOnboarding: false }); // brand-new-browser state
  await expect(page.locator('#onboardOverlay')).toHaveClass(/hidden/);
});

test('the help corner button opens the tour on Home', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#helpTourBtn')).not.toHaveClass(/hidden/);
  await page.click('#helpTourBtn');
  await expect(page.locator('#onboardOverlay')).not.toHaveClass(/hidden/);
});

test('the help button is hidden inside the admin panel', async ({ page }) => {
  await openApp(page);
  await adminLogin(page);
  await expect(page.locator('#helpTourBtn')).toHaveClass(/hidden/);
});

test('Skip dismisses it, and the help button can reopen it again later', async ({ page }) => {
  await openApp(page);
  await page.click('#helpTourBtn');
  await expect(page.locator('#onboardOverlay')).not.toHaveClass(/hidden/);
  await page.click('text=Skip');
  await expect(page.locator('#onboardOverlay')).toHaveClass(/hidden/);
  await expect(page.locator('#helpTourBtn')).not.toHaveClass(/hidden/);
  await page.click('#helpTourBtn'); // not a one-time thing — reopens fine
  await expect(page.locator('#onboardOverlay')).not.toHaveClass(/hidden/);
});

test('Get Started dismisses it the same way as Skip', async ({ page }) => {
  await openApp(page);
  await page.click('#helpTourBtn');
  await page.click('text=Get Started');
  await expect(page.locator('#onboardOverlay')).toHaveClass(/hidden/);
});

test('has exactly 4 full-bleed slides', async ({ page }) => {
  await openApp(page);
  await page.click('#helpTourBtn');
  const slides = await page.locator('#onboardSlides .onb-slide').count();
  expect(slides).toBe(4);
});
