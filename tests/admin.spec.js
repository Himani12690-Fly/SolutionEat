const { test, expect } = require('@playwright/test');
const { openApp: openAppRaw, adminLogin, freshState, todayIST } = require('./helpers');
// Admin flows need real bootstrap config (menu/prices/etc.) — default to the
// vendor context so it actually loads (see opts.vendor in helpers.js openApp()).
const openApp = (page, opts) => openAppRaw(page, { vendor: 'nestandnosh', ...opts });

function seedOrder(state, over = {}) {
  const row = state.nextRow++;
  state.orders.push(Object.assign({
    row, deliveryDate:todayIST(0), meal:'lunch', phone:'9876543210',
    name:'Test User', society:'Vrindavan', flat:'D-706',
    status:'Pending', mealStatus:{ lunch:'Pending' },
    total:'₹90', payment:'COD', paymentStatus:'Unpaid',
    breakfastQty:0, lunchQty:1, dinnerQty:0,
    lunchSabzi:'Dal Tadka', lunchTiffin:'1 Full Tiffin', lunchRoti:'Plain',
    lunchAddons:'None', lunchTimeSlot:'12–1 PM', dinnerSabzi:'', dinnerTiffin:'',
    dinnerRoti:'', dinnerAddons:'None', note:'', promo:'', deliveryType:'home',
    time:'01/01 10:00 AM', day:'Monday', createdIso:new Date().toISOString().slice(0,16)
  }, over));
  return row;
}

test.describe('Admin auth', () => {
  test('sahi credentials se panel khulta hai', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await expect(page.locator('#adminPanel')).toBeVisible();
  });

  test('galat password reject', async ({ page }) => {
    await openApp(page);
    await adminLogin(page, 'demo', 'wrong');
    await expect(page.locator('#adminPanel')).toHaveClass(/hidden/);
    await expect(page.locator('#toast')).toContainText('Invalid');
  });

  test('khaali fields par warning', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.showAdminLogin());
    await page.click('#loginBtn');
    await expect(page.locator('#toast')).toContainText('username and password');
  });

  // ⚠️ Pehle logout ke baad hideAdmin() customer-side showLanding()/showPublic()
  // route karta tha — admin.html Phase 3 split ke baad ek dedicated admin-only
  // file hai (koi customer fallback nahi), isliye wo galat/dead route tha
  // (customer login/discovery jaisa "galat page" dikhta). Ab seedha adminLogin.
  test('logout se panel band aur admin login page par wapas aata hai', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminLogout());
    await page.waitForTimeout(300);
    await expect(page.locator('#adminPanel')).toHaveClass(/hidden/);
    await expect(page.locator('#adminLogin')).not.toHaveClass(/hidden/);
  });
});

test.describe('Admin orders', () => {
  test('order list dikhti hai', async ({ page }) => {
    const state = freshState();
    seedOrder(state); seedOrder(state, { meal:'dinner', dinnerQty:1, lunchQty:0 });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    // Orders load hote hi Kitchen Summary ek meal (jiske orders hon) auto-select
    // kar leta hai aur grouped/society checklist view khol deta hai (kitchen staff
    // ke liye) — .oc wale full order cards sirf 'All' view me dikhte hain.
    // setMealFilter('All') hamesha 'All' pe le jaata hai, chahe abhi kuch bhi
    // selected ho (dekho index.html ka setMealFilter).
    await page.evaluate(() => window.setMealFilter('All'));
    await expect(page.locator('#ordersList .oc')).toHaveCount(2);
  });

  test('status filter kaam karta hai', async ({ page }) => {
    const state = freshState();
    seedOrder(state);
    seedOrder(state, { status:'Delivered', mealStatus:{ lunch:'Delivered' } });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.setMealFilter('All'));   // grouped view se bahar — status chips wahan hidden hain
    await page.evaluate(() => window.setOrderFilter('Delivered'));
    await page.waitForTimeout(200);
    await expect(page.locator('#ordersList .oc')).toHaveCount(1);
  });

  test('meal status badalne se order status derive hota hai', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(r => window.setMealSt(r, 'lunch', 'Preparing'), row);
    await page.waitForTimeout(400);
    expect(state.orders[0].status).toBe('Preparing');
    await page.evaluate(r => window.setMealSt(r, 'lunch', 'Delivered'), row);
    await page.waitForTimeout(400);
    expect(state.orders[0].status).toBe('Delivered');
  });

  test('bulk status update', async ({ page }) => {
    const state = freshState();
    seedOrder(state); seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => window.bulkStatus('Pending', 'Preparing'));
    await page.waitForTimeout(500);
    expect(state.orders.every(o => o.status === 'Preparing')).toBe(true);
  });

  test('kitchen summary sahi qty jodta hai', async ({ page }) => {
    const state = freshState();
    seedOrder(state);
    seedOrder(state);
    seedOrder(state, { meal:'dinner', lunchQty:0, dinnerQty:1,
                       mealStatus:{ dinner:'Pending' } });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    const cells = await page.locator('#kitchenSummary .ks-n').allTextContents();
    expect(cells).toEqual(['0', '2', '1']);   // breakfast, lunch, dinner
  });

  test('money bar COD/UPI alag ginta hai', async ({ page }) => {
    const state = freshState();
    seedOrder(state, { payment:'COD', total:'₹90' });
    seedOrder(state, { payment:'UPI', total:'₹150' });
    seedOrder(state, { payment:'COD', total:'₹999', status:'Cancelled' });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    const nums = await page.locator('#moneyBar .mb-n').allTextContents();
    expect(nums).toEqual(['₹90', '₹150', '₹240']);   // cancelled count nahi hua
  });

  test('paid toggle', async ({ page }) => {
    const state = freshState();
    const row = seedOrder(state);
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(r => window.togglePaid(r, 'Unpaid'), row);
    await page.waitForTimeout(400);
    expect(state.orders[0].paymentStatus).toBe('Paid');
  });

  test('society filter', async ({ page }) => {
    const state = freshState();
    seedOrder(state, { society:'Vrindavan' });
    seedOrder(state, { society:'Eden' });
    await openApp(page, { state });
    await adminLogin(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.setMealFilter('All'));   // grouped view se bahar — society dropdown wahan hidden hai
    await page.evaluate(() => window.setSocFilter('Eden'));
    await page.waitForTimeout(200);
    await expect(page.locator('#ordersList .oc')).toHaveCount(1);
  });
});

test.describe('Admin users', () => {
  test('user list aur search', async ({ page }) => {
    const state = freshState();
    state.users.push({ phone:'9000000002', name:'Priya Patel', email:'p@t.com',
      created:'01 Jan 25', lastLogin:'01 Jan 25', status:'Active', orders:3 });
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('users'));
    await page.waitForTimeout(500);
    await expect(page.locator('#usersList .oc')).toHaveCount(2);
    await page.fill('#userSearch', 'Priya');
    await page.waitForTimeout(200);
    await expect(page.locator('#usersList .oc')).toHaveCount(1);
  });

  // Block/unblock aur reset ab Super Admin ke paas hain (tests/super-vendor-
  // config.spec.js me cover hote hain) — vendor apni Users tab se sirf list
  // dekh sakta hai, ab koi manage action yahan nahi bacha.
});

test.describe('Admin menu & config', () => {
  test('menu save hota hai', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('menu'));
    await page.waitForTimeout(300);
    await page.fill('#ed-lunchSabzi', 'Kadhi\nBhindi Masala');
    await page.click('#saveMenuBtn');
    await page.waitForTimeout(500);
    expect(state.menu.monday.lunch.sabziOptions).toEqual(['Kadhi','Bhindi Masala']);
  });

  test('sirf non-sabzi variants (jaise Khichdi) waali meal ke liye sabzi options zaroori nahi', async ({ page }) => {
    // Pehle hardcoded tha ki har variants-wali meal ke sabzi options bharna
    // zaroori hai, chahe uski koi variant sabzi use hi na karti ho. Jo kitchen
    // sirf alag tarah ki Khichdi bechti hai, use ye force nahi hona chahiye.
    const state = freshState();
    state.config.variants.lunch = [
      { id:'moong', name:'Moong Khichdi', price:70, items:['Khichdi','Papad','Achar'], usesSabzi:false },
      { id:'masoor', name:'Masoor Khichdi', price:80, items:['Khichdi','Papad','Achar'], usesSabzi:false }
    ];
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('menu'));
    await page.waitForTimeout(300);
    await page.fill('#ed-lunchSabzi', '');
    await page.click('#saveMenuBtn');
    await page.waitForTimeout(500);
    // Dinner abhi bhi tiffin hai (default sabzi bhara hua) — save clean hona
    // chahiye, koi "sabzi options bharo" warning nahi.
    await expect(page.locator('#toast')).toContainText('ka menu saved');
    expect(state.menu.monday.lunch.sabziOptions).toEqual([]);
  });

  test('sabzi options khaali ho to save nahi hota', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('menu'));
    await page.waitForTimeout(300);
    await page.fill('#ed-lunchSabzi', '');
    await page.click('#saveMenuBtn');
    await page.waitForTimeout(300);
    // Message ab batata hai KIS meal ka kya missing hai — pehle sirf
    // "menu incomplete" tha.
    await expect(page.locator('#toast')).toContainText('sabzi options');
  });

  // Menu editor me pehle har meal ke 2-3 box the. "Fixed Items" (Roti 4 /
  // 1 Sabzi / Salad) poore app me kahin dikhta hi nahi tha, aur wahi cheez
  // variants me likhi hoti hai — isliye wo aur breakfast ka items box hata
  // diye. Ek din ke liye badalne wali ek hi cheez bachi: sabzi.
  test('menu editor me sirf sabzi options ke box hain', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('menu'));
    await page.waitForTimeout(300);
    await expect(page.locator('#ed-lunchSabzi')).toHaveCount(1);
    await expect(page.locator('#ed-dinnerSabzi')).toHaveCount(1);
    await expect(page.locator('#ed-lunchFixed')).toHaveCount(0);
    await expect(page.locator('#ed-dinnerFixed')).toHaveCount(0);
    await expect(page.locator('#ed-breakfast')).toHaveCount(0);
  });

  test('hate hue fields ka purana data save par mitta nahi', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('menu'));
    await page.waitForTimeout(300);
    await page.fill('#ed-lunchSabzi', 'Kadhi');
    await page.click('#saveMenuBtn');
    await page.waitForTimeout(500);
    // UI se field hatane ka matlab vendor ka likha hua content udana nahi hai.
    expect(state.menu.monday.lunch.sabziOptions).toEqual(['Kadhi']);
    expect(state.menu.monday.lunch.fixedItems).toEqual(['Jeera Rice','Roti (4)']);
    expect(state.menu.monday.breakfast).toEqual(['Poha','Chai']);
  });

  test('price update customer side pe dikhta hai', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.waitForTimeout(300);
    // Config sections are collapsed accordions (cfgCloseAll() by default) —
    // fields inside are present but hidden until their tab is opened.
    await page.evaluate(() => window.cfgOpen('meals'));
    // Meal & Prices redesign: per-meal base price now lives on each meal-type
    // card (Setup → Meal Types), not a flat #pr-lunch field.
    await page.fill('#mt-lunch-price', '95');
    await page.click('#saveConfigBtn');
    await page.waitForTimeout(500);
    const lunch = state.config.mealTypes.find(mt => mt.key === 'lunch');
    expect(lunch.price).toBe(95);
  });

  // "dono delivery mode band nahi ho sakte" / "office ON par company zaroori" —
  // ab Super Admin Delivery Setup group ki validation hai (tests/super-vendor-
  // config.spec.js), kyunki Home/Office toggle aur Companies vendor Setup se
  // hata diye gaye hain.

  // Planned closed dates ab Setup ka hissa nahi — "Close Kitchen" sheet me hain
  // (More menu), aur turant save hote hain (koi "Save Setup" wait nahi).
  test('closed date add / remove (Close Kitchen sheet)', async ({ page }) => {
    const { state } = await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.openEmergencySheet());
    await page.fill('#closedDateInput', '2026-01-26');
    await page.click('button[onclick="addClosedDate()"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#closedDatesList .oc')).toHaveCount(1);
    expect(state.config.closedDates).toEqual(['2026-01-26']);
    await page.click('text=✖ Remove');
    await page.waitForTimeout(300);
    await expect(page.locator('#closedDatesList')).toContainText('No closed dates');
    expect(state.config.closedDates).toEqual([]);
  });
});

test.describe('Admin variants', () => {
  test('variant add aur save', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('variants'));
    await page.waitForTimeout(300);
    await page.click('text=➕ Add New Variant');
    await page.waitForTimeout(200);
    await expect(page.locator('#varList .var-card')).toHaveCount(3);
    await page.click('#saveVarBtn');
    await page.waitForTimeout(500);
    expect(state.config.variants.lunch.length).toBe(3);
  });

  test('variant ka "roz ka sabzi poochna hai" checkbox save hota hai', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('variants'));
    await page.waitForTimeout(300);
    // Default fixture ke variants "Full Tiffin"/"Mini Tiffin" hain, isliye
    // checkbox andaza se already checked hona chahiye.
    const box = page.locator('#varList .var-card').first().locator('.cfg-chk input[type="checkbox"]');
    await expect(box).toBeChecked();
    await box.uncheck();
    await page.click('#saveVarBtn');
    await page.waitForTimeout(500);
    expect(state.config.variants.lunch[0].usesSabzi).toBe(false);
  });

  test('aakhri variant delete nahi hota', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('variants'));
    await page.evaluate(() => window.varSetMeal('breakfast'));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.delVariant(0));
    await page.waitForTimeout(200);
    await expect(page.locator('#toast')).toContainText('At least 1 variant');
  });
});

test.describe('Admin promos', () => {
  test('promo create', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('promos'));
    await page.waitForTimeout(400);
    await page.fill('#pmCode', 'SAVE20');
    await page.selectOption('#pmType', 'PERCENT');
    await page.fill('#pmValue', '20');
    await page.fill('#pmMaxD', '40');
    await page.click('#pmSaveBtn');
    await page.waitForTimeout(500);
    const p = state.promos.find(x => x.code === 'SAVE20');
    expect(p.type).toBe('PERCENT');
    expect(p.value).toBe(20);
    expect(p.maxDiscount).toBe(40);
  });

  test('code ya value bina save nahi', async ({ page }) => {
    await openApp(page);
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('promos'));
    await page.waitForTimeout(400);
    await page.click('#pmSaveBtn');
    await page.waitForTimeout(200);
    await expect(page.locator('#toast')).toContainText('required');
  });

  test('promo toggle aur delete', async ({ page }) => {
    const state = freshState();
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('promos'));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.togglePromoFE(0));
    await page.waitForTimeout(400);
    expect(state.promos[0].active).toBe(false);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => window.delPromoFE(0));
    await page.waitForTimeout(400);
    expect(state.promos.length).toBe(0);
  });
});

test.describe('Admin stats', () => {
  test('cancelled order revenue mein nahi', async ({ page }) => {
    const state = freshState();
    seedOrder(state, { total:'₹100' });
    seedOrder(state, { total:'₹999', status:'Cancelled' });
    await openApp(page, { state });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('stats'));
    await page.waitForTimeout(500);
    await expect(page.locator('#st-todayRev')).toHaveText('₹100');
  });
});
