/**
 * One-tap "Install App" — instead of making the customer dig through the
 * browser's own menu for "Add to Home Screen", we capture Chrome/Android's
 * beforeinstallprompt event and expose our own button (Profile → Install App)
 * that triggers the SAME native browser install dialog. iOS Safari never
 * fires beforeinstallprompt (Apple's own choice, not a bug here), so there
 * the row falls back to manual Share-sheet instructions instead of a fake
 * button that would do nothing.
 * ⚠️ Deliberately opt-in only (a row inside Profile, no auto-popup on load) —
 * a pushy install nag reads as spammy/scammy and costs vendor trust.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

async function fireBeforeInstallPrompt(page) {
  await page.evaluate(() => {
    window.__installPromptCalls = 0;
    window.__resolveInstallChoice = null;
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.prompt = () => { window.__installPromptCalls++; };
    ev.userChoice = new Promise((resolve) => { window.__resolveInstallChoice = resolve; });
    window.dispatchEvent(ev);
  });
}

test('row stays hidden until beforeinstallprompt fires, then opens the native-prompt flow', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.showProfilePage());
  await expect(page.locator('#pfInstallApp')).toHaveClass(/hidden/);

  await fireBeforeInstallPrompt(page);
  await expect(page.locator('#pfInstallApp')).not.toHaveClass(/hidden/);

  await page.click('#pfInstallApp');
  await expect(page.locator('#installAppSheet')).not.toHaveClass(/hidden/);
  await expect(page.locator('#installAppGoBtn')).not.toHaveClass(/hidden/);
  await expect(page.locator('#installAppIosBlock')).toHaveClass(/hidden/);

  await page.click('#installAppGoBtn');
  const calls = await page.evaluate(() => window.__installPromptCalls);
  expect(calls).toBe(1);

  await page.evaluate(() => window.__resolveInstallChoice({ outcome: 'accepted' }));
  await page.waitForTimeout(200);
  await expect(page.locator('#installAppSheet')).toHaveClass(/hidden/);
});

test('dismissing the native prompt leaves the row visible for a retry', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.showProfilePage());
  await fireBeforeInstallPrompt(page);
  await page.click('#pfInstallApp');
  await page.click('#installAppGoBtn');
  await page.evaluate(() => window.__resolveInstallChoice({ outcome: 'dismissed' }));
  await page.waitForTimeout(200);
  await expect(page.locator('#pfInstallApp')).not.toHaveClass(/hidden/);
});

test('appinstalled hides the row and shows a confirmation toast', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.showProfilePage());
  await fireBeforeInstallPrompt(page);
  await expect(page.locator('#pfInstallApp')).not.toHaveClass(/hidden/);

  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('#pfInstallApp')).toHaveClass(/hidden/);
  await expect(page.locator('#toast')).toHaveClass(/show/);
});

test('iOS Safari (no beforeinstallprompt) shows manual Share-sheet steps instead', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  });
  await openApp(page);
  await page.evaluate(() => window.showProfilePage());
  await expect(page.locator('#pfInstallApp')).not.toHaveClass(/hidden/);

  await page.click('#pfInstallApp');
  await expect(page.locator('#installAppIosBlock')).not.toHaveClass(/hidden/);
  await expect(page.locator('#installAppGoBtn')).toHaveClass(/hidden/);
});

test('a wrapped Android APK never shows the install row, even if the event fires', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36; wv)',
    });
  });
  await openApp(page);
  await page.evaluate(() => window.showProfilePage());
  await fireBeforeInstallPrompt(page);
  await page.waitForTimeout(150);
  await expect(page.locator('#pfInstallApp')).toHaveClass(/hidden/);
});
