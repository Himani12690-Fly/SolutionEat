/**
 * Bundle of related changes: admin nav swap (Setup replaces Users in the
 * primary bottom bar — Setup holds the time-critical Emergency Close, Users
 * is an occasional lookup), removing the Home page's per-meal time-slot
 * dropdown (customer no longer picks it, builder[m].timeSlot silently
 * defaults), the Home page's open/closed + next-meal timer banner, and the
 * admin topbar's one-tap Emergency Close (with a duration, unlike Setup's
 * own indefinite-close checkbox) that auto-expires client-side once
 * tempClosedUntil passes — no server cron needed.
 */
const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState } = require('./helpers');
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

test.describe('Admin nav — Setup vs Users', () => {
  test('Setup is in the primary bottom bar, Users moved into More', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    const primaryHasConfig = await page.locator('#abn-config').count();
    const primaryHasUsers = await page.locator('#abn-users').count();
    const moreHasUsers = await page.locator('#adr-users').count();
    expect(primaryHasConfig).toBe(1);
    expect(primaryHasUsers).toBe(0);
    expect(moreHasUsers).toBe(1);
  });

  test('tapping Setup in the primary bar opens the Setup tab', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.click('#abn-config');
    await expect(page.locator('#aview-config')).not.toHaveClass(/hidden/);
  });
});

test.describe('Home page — time dropdown removed, timer banner added', () => {
  test('no time-slot <select> on Home, only the date-chip row', async ({ page }) => {
    await openApp(page);
    const selects = await page.locator('#menuDateTime select').count();
    expect(selects).toBe(0);
    await expect(page.locator('#menuDateTime .date-chips')).toBeVisible();
  });

  test('shows "closes in" when inside a meal window (lunch 12:00-14:00, pinned to 13:00)', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T13:00:00' });
    const banner = page.locator('#kitchenAvailBanner');
    await expect(banner).not.toHaveClass(/hidden/);
    await expect(banner).toContainText('closes in');
  });

  test('shows "Next" meal when between windows (10:00, before lunch)', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T10:00:00' });
    const banner = page.locator('#kitchenAvailBanner');
    await expect(banner).not.toHaveClass(/hidden/);
    await expect(banner).toContainText('Next');
  });
});

test.describe('Emergency Close — admin quick action with duration', () => {
  test('topbar icon opens the sheet, picking a duration and confirming closes the kitchen', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.click('#emgToggle');
    await expect(page.locator('#emergencySheet')).not.toHaveClass(/hidden/);
    await page.click('[data-mins="60"]');
    await page.click('text=🚨 Close Kitchen Now');
    await page.waitForTimeout(300);
    expect(state.config.tempClosed).toBe(true);
    expect(state.config.tempClosedUntil).toBeTruthy();
    await expect(page.locator('#emgToggle')).toHaveClass(/on/);
  });

  test('customer sees the reopen countdown on Home once closed', async ({ page }) => {
    const state = freshState();
    state.config.tempClosed = true;
    state.config.tempClosedUntil = new Date(Date.now() + 45 * 60000).toISOString();
    await openApp(page, { state });
    const banner = page.locator('#kitchenAvailBanner');
    await expect(banner).not.toHaveClass(/hidden/);
    await expect(banner).toContainText('reopens');
  });

  test('a timed close auto-expires client-side once tempClosedUntil has passed — no manual reopen needed', async ({ page }) => {
    const state = freshState();
    state.config.tempClosed = true;
    state.config.tempClosedUntil = new Date(Date.now() - 5 * 60000).toISOString();   // already in the past
    await openApp(page, { state });
    // Banner should read as a normal open/closed status, NOT the emergency "reopens" text.
    const banner = page.locator('#kitchenAvailBanner');
    const text = await banner.textContent();
    expect(text || '').not.toContain('reopens');
  });

  test('Reopen Now clears the close from the admin side', async ({ page }) => {
    const state = freshState();
    state.config.tempClosed = true;
    state.config.tempClosedMsg = 'Testing';
    state.config.tempClosedUntil = new Date(Date.now() + 30 * 60000).toISOString();
    await openApp(page, { state });
    await adminLogin(page);
    await page.click('#emgToggle');
    await expect(page.locator('#emgClosedBlock')).not.toHaveClass(/hidden/);
    await page.click('text=✅ Reopen Now');
    await page.waitForTimeout(300);
    expect(state.config.tempClosed).toBe(false);
    await expect(page.locator('#emgToggle')).not.toHaveClass(/on/);
  });
});
