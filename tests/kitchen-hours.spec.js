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

test.describe('Home page — time dropdown removed, date chips + timer banner present', () => {
  test('no time-slot <select> on Home, but Today/Tomorrow/Day After chips are there', async ({ page }) => {
    // ⚠️ Pehle koi istOverride nahi tha — real wall-clock IST time pe depend
    // karta tha. Dinner ka cutoff (15:00) paar hote hi "today" par kuch bhi
    // orderable nahi rehta, aur app sahi se "tomorrow" pe pickDefaultDate()
    // se shift ho jaata hai (real bug nahi) — jisse ye test dopahar 3 baje ke
    // baad chalne par hamesha fail hota. Fixed morning time se deterministic.
    await openApp(page, { istOverride: '2026-08-04T08:00:00' });
    const selects = await page.locator('#menuDateTime select').count();
    expect(selects).toBe(0);
    const chips = page.locator('#menuDateTime .dt-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveClass(/sel/);
  });

  // Banner now reads the real ORDER CUTOFF (mealsAvail), not the serving
  // window — at 13:00, lunch's cutoff (09:00) has already passed, so the
  // "closes in" meal is dinner (cutoff 15:00), not lunch's 12:00-14:00
  // serving window like the old (buggy) windowStart/windowEnd logic showed.
  test('shows "closes in" for dinner once lunch cutoff has passed (13:00)', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T13:00:00' });
    const banner = page.locator('#kitchenAvailBanner');
    await expect(banner).not.toHaveClass(/hidden/);
    await expect(banner).toContainText('Dinner');
    await expect(banner).toContainText('close in');
  });

  // "Next meal opens at X" messaging was removed entirely — only "closes in"
  // for whatever is actually orderable right now, or nothing at all.
  test('never shows a "next meal opens at" message — only "closes in" for what is orderable now', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T10:00:00' });
    const banner = page.locator('#kitchenAvailBanner');
    await expect(banner).not.toHaveClass(/hidden/);
    const text = await banner.textContent();
    expect(text).not.toContain('Next');
    expect(text).toContain('close in');
  });
});

// Schedule Your Meal (dedicated sheet/nav-tab) reverted back to how it worked
// before — Today/Tomorrow/Day After chips inline on Home (see #menuDateTime's
// renderMenuDateTime()), not a separate sheet. Bulk/Party Order now takes the
// bottom-nav slot Schedule used to occupy (covered in bulk-order.spec.js).
test.describe('Home date chips — Today/Tomorrow/Day After', () => {
  test('tapping Tomorrow switches Home to that date and highlights the chip', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T10:00:00' });
    const tomorrowChip = page.locator('#menuDateTime .dt-chip').nth(1);
    await expect(tomorrowChip).toContainText('Tomorrow');
    await tomorrowChip.click();
    await page.waitForTimeout(200);
    await expect(tomorrowChip).toHaveClass(/sel/);
    await expect(page.locator('#menuDateTime .dt-chip').nth(0)).not.toHaveClass(/sel/);
  });

  test('tapping Today resets Home back after viewing a future date', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T10:00:00' });
    await page.locator('#menuDateTime .dt-chip').nth(1).click();
    await page.waitForTimeout(200);
    await page.locator('#menuDateTime .dt-chip').nth(0).click();
    await page.waitForTimeout(200);
    await expect(page.locator('#menuDateTime .dt-chip').nth(0)).toHaveClass(/sel/);
    await expect(page.locator('#bn-land')).toHaveClass(/active/);
  });

  test('a fully-closed future day greys out its chip — tapping it does nothing', async ({ page }) => {
    const state = freshState();
    state.config.closedDates = ['2026-08-05'];   // "tomorrow" relative to the istOverride below
    await openApp(page, { state, istOverride: '2026-08-04T10:00:00' });
    const tomorrowChip = page.locator('#menuDateTime .dt-chip').nth(1);
    await expect(tomorrowChip).toHaveClass(/off/);
    await tomorrowChip.click();
    await page.waitForTimeout(200);
    await expect(tomorrowChip).not.toHaveClass(/sel/);
  });
});

test.describe('Emergency Close — admin quick action with duration', () => {
  // "Close Kitchen" ab bottom nav me seedha hai (ek hi jagah — pehle topbar icon +
  // Setup ke 2 alag jagah bikhra hua tha, phir kuch waqt More menu me tha), instant
  // close + planned dates dono isi sheet me.
  test('opens from the bottom nav, picking a duration and confirming closes the kitchen', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.click('#abn-closekitchen');
    await expect(page.locator('#emergencySheet')).not.toHaveClass(/hidden/);
    await page.click('[data-mins="60"]');
    await page.click('text=🚨 Close Kitchen Now');
    await page.waitForTimeout(300);
    expect(state.config.tempClosed).toBe(true);
    expect(state.config.tempClosedUntil).toBeTruthy();
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
    await page.click('#abn-closekitchen');
    await expect(page.locator('#emgClosedBlock')).not.toHaveClass(/hidden/);
    await page.click('text=✅ Reopen Now');
    await page.waitForTimeout(300);
    expect(state.config.tempClosed).toBe(false);
  });
});
