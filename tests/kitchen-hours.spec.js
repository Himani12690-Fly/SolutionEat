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

test.describe('Home page — time dropdown and date chips removed, timer banner added', () => {
  test('no time-slot <select> and no date-chip row on Home by default (today)', async ({ page }) => {
    // ⚠️ Pehle koi istOverride nahi tha — real wall-clock IST time pe depend
    // karta tha. Dinner ka cutoff (15:00) paar hote hi "today" par kuch bhi
    // orderable nahi rehta, aur app sahi se "tomorrow" pe pickDefaultDate()
    // se shift ho jaata hai (real bug nahi) — jisse ye test dopahar 3 baje ke
    // baad chalne par hamesha fail hota. Fixed morning time se deterministic.
    await openApp(page, { istOverride: '2026-08-04T08:00:00' });
    const selects = await page.locator('#menuDateTime select').count();
    expect(selects).toBe(0);
    await expect(page.locator('#menuDateTime .date-chips')).toHaveCount(0);
    await expect(page.locator('#menuDateTime')).toBeEmpty();
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

test.describe('Schedule Your Meal', () => {
  test('bottom nav has a Schedule tab between Orders and Subscribe', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#bn-schedule')).toBeVisible();
  });

  // Zomato-style sheet: horizontal date strip (Today/Tomorrow/Day After) +
  // meal chips (breakfast/lunch/dinner) + delivery window + Continue button.
  // Defaults to Tomorrow pre-selected (Today isn't scheduleable) with its
  // first available meal auto-picked.
  test('opens a sheet with a 3-day date strip and meal chips, defaulting to Tomorrow', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T10:00:00' });
    await page.click('#bn-schedule');
    await expect(page.locator('#scheduleSheet')).not.toHaveClass(/hidden/);
    await expect(page.locator('#scheduleDateStrip .sched-day')).toHaveCount(3);
    await expect(page.locator('#scheduleMealChips .sched-meal')).toHaveCount(3);
    await expect(page.locator('#scheduleDateStrip .sched-day.sel')).toHaveCount(1);
    await expect(page.locator('#scheduleDateStrip .sched-day').nth(1)).toHaveClass(/sel/);
    await expect(page.locator('#scheduleMealChips .sched-meal.sel')).toHaveCount(1);
    await expect(page.locator('#scheduleContinueBtn')).toBeEnabled();
  });

  test('picking a day + meal then Continue switches Home to that date/meal and shows the "ordering for" banner', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T10:00:00' });
    await page.click('#bn-schedule');
    await page.locator('#scheduleDateStrip .sched-day').nth(2).click(); // Day After
    await page.locator('#scheduleMealChips .sched-meal').filter({ hasText: 'Dinner' }).click();
    await expect(page.locator('#scheduleWindow')).toContainText('19:00');
    await page.click('#scheduleContinueBtn');
    await page.waitForTimeout(200);
    await expect(page.locator('#homeView')).not.toHaveClass(/hidden/);
    await expect(page.locator('#menuDateTime')).toContainText('Ordering for');
    await expect(page.locator('#menuDateTime')).toContainText('Back to Today');
    await expect(page.locator('#bn-schedule')).toHaveClass(/active/);
  });

  test('"Back to Today" resets Home to today and clears the banner', async ({ page }) => {
    await openApp(page, { istOverride: '2026-08-04T10:00:00' });
    await page.click('#bn-schedule');
    await page.click('#scheduleContinueBtn');
    await page.waitForTimeout(200);
    await page.click('text=Back to Today');
    await page.waitForTimeout(200);
    await expect(page.locator('#menuDateTime')).toBeEmpty();
    await expect(page.locator('#bn-land')).toHaveClass(/active/);
  });

  test('tapping a closed date/meal does nothing — only enabled options are selectable', async ({ page }) => {
    // Breakfast has cutoffAheadDay:true, cutoff 22:00 — at 23:00 today, ordering
    // breakfast for Tomorrow (off=1) is already closed (mins>=cutoff), so it
    // must render greyed-out (.off) and be untappable.
    await openApp(page, { istOverride: '2026-08-04T23:00:00' });
    await page.click('#bn-schedule');
    const breakfastChip = page.locator('#scheduleMealChips .sched-meal').filter({ hasText: 'Breakfast' });
    await expect(breakfastChip).toHaveClass(/off/);
    await breakfastChip.click();
    await expect(breakfastChip).not.toHaveClass(/sel/);
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
