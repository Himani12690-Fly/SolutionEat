/**
 * Public menu page (menu.html) — login ke bina aaj ka menu.
 *
 * Pehla-baar wala customer vendor ka link kholta tha aur seedha LOGIN par
 * pahunchta tha. Ye page wahi gate hata deta hai: menu bina login dikhta hai,
 * aur login sirf order karte waqt maanga jaata hai.
 *
 * Ye spec openApp() helper use NAHI karta. Wajah: openApp poore app ko boot
 * karta hai (session, geolocation gate, service worker, shared.js) — is page ke
 * paas unme se kuch bhi nahi hai. Yahan sirf ek cheez chahiye: backend ka
 * bootstrap response. Wahi stub karte hain.
 */
const { test, expect } = require('@playwright/test');
const { CONFIG, MENU } = require('./fixtures');

const PAGE = (process.env.APP_URL || 'http://localhost:8080/index.html').replace(/[^/]+$/, 'menu.html');

function bootstrap(over = {}) {
  return {
    status: 'success',
    menu: JSON.parse(JSON.stringify(MENU)),
    config: Object.assign(JSON.parse(JSON.stringify(CONFIG)), over.config || {}),
    promos: [],
    vendor: Object.assign({ name: 'Nest & Nosh', logo: '', whatsapp: '', scriptUrl: '' }, over.vendor || {}),
  };
}

// 08:00 — Lunch (cutoff 09:00) aur Dinner (cutoff 15:00) dono abhi orderable
// hain. Sirf Breakfast (cutoffAheadDay) "aaj" ke liye hamesha nikla hota hai —
// uska cutoff pichhli raat ka hai. Fixed time isliye taaki cutoff-hiding
// (menu.html) us par depend na kare ki suite kis waqt chal rahi hai.
const DEFAULT_IST = '2026-08-17T08:00:00';

async function openMenu(page, { vendor = 'nestandnosh', body = null, istOverride = DEFAULT_IST } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript((v) => { window.__TEST_IST_OVERRIDE = v; }, istOverride);
  await page.route('**/script.google.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(body || bootstrap()),
  }));
  await page.goto(PAGE + '?v=' + vendor, { waitUntil: 'domcontentloaded' });
  return errors;
}

test.describe('Public menu page', () => {
  test('aaj ka menu bina login dikhta hai', async ({ page }) => {
    const errors = await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Login ka koi nishaan nahi hona chahiye — na form, na Google button.
    await expect(page.locator('#gBtn')).toHaveCount(0);
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);
    await expect(page.locator('#vname')).toHaveText('Nest & Nosh');
    // Har ON meal ka apna card — Breakfast ke alawa: uska cutoff pichhli
    // raat ka hai (cutoffAheadDay), isliye "aaj" ke liye wo hamesha nikla
    // hota hai aur list se hat jaata hai.
    const on = CONFIG.mealTypes.filter(m => m.enabled !== false && !m.cutoffAheadDay).length;
    await expect(page.locator('.mc')).toHaveCount(on);
    expect(errors).toEqual([]);
  });

  test('aaj ki sabzi aur variants dono dikhte hain', async ({ page }) => {
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    const chips = await page.locator('.chip').allTextContents();
    // fixtures ke DAY se — har din ka menu same hai, isliye weekday matter nahi karta.
    expect(chips).toContain('Paneer Butter Masala');
    expect(chips).toContain('Aloo Gobi');
    // Variants (Mini/Full Tiffin) bhi list hote hain, apne daam ke saath.
    expect(await page.locator('.vr').count()).toBeGreaterThan(0);
  });

  test('din select karke uss din ka menu dekha ja sakta hai', async ({ page }) => {
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Aaj se shuru karke agle 6 din — poora hafta cover hona chahiye.
    await expect(page.locator('#daySelect option')).toHaveCount(7);

    // "Aaj" test chalne ke din par depend nahi karna chahiye, isliye jo bhi
    // aaj hai usse alag ek din chunte hain aur usi ka menu alag rakhte hain.
    const todayKey = await page.$eval('#daySelect', el => el.value);
    const DAY_KEYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const otherDay = DAY_KEYS.find(d => d !== todayKey);
    const body = bootstrap();
    body.menu[otherDay] = Object.assign({}, body.menu[otherDay], {
      lunch: { sabziOptions: ['Distinct Day Sabzi'] },
    });
    // menu.html ab bootstrap response cache karta hai (stale-while-revalidate)
    // — pehle wale openMenu() call ka data isi navigation par "cached render"
    // ban kar dikh sakta hai. Yahan hume sirf naya body chahiye, cache nahi.
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await openMenu(page, { body });
    await page.waitForSelector('.mc', { timeout: 15000 });

    let chips = await page.locator('.chip').allTextContents();
    expect(chips).not.toContain('Distinct Day Sabzi');

    await page.selectOption('#daySelect', otherDay);
    chips = await page.locator('.chip').allTextContents();
    expect(chips).toContain('Distinct Day Sabzi');
    // Dropdown khud hi selected din dikhata hai — header me alag se date
    // dohrai nahi jaati.
    const selectedLabel = await page.$eval('#daySelect', el => el.options[el.selectedIndex].textContent);
    expect(selectedLabel).toContain(otherDay.charAt(0).toUpperCase() + otherDay.slice(1));
  });

  test('app ka link usi kitchen par bhejta hai', async ({ page }) => {
    await openMenu(page, { vendor: 'hungrybirds' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(await page.getAttribute('#orderBtn', 'href')).toBe('/?v=hungrybirds');
  });

  test('?v= wale URL se load hone par bhi address bar clean /vendor/menu dikhata hai', async ({ page }) => {
    // GitHub Pages par /<vendor>/menu ka koi real file nahi hota, isliye
    // 404.html isko /menu.html?v=<vendor> par redirect karta hai. Wahi asli
    // page hai — par address bar me vendor ne jo clean link share kiya tha
    // wahi dikhna chahiye, "?v=" wala URL nahi.
    await openMenu(page, { vendor: 'hungrybirds' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe('/hungrybirds/menu');
  });

  test('WhatsApp na ho to app/login hi poora button rehta hai', async ({ page }) => {
    // Ye hi ek matra raasta bachta hai — ise chhota karna dead end bana dega.
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('#orderBtn')).not.toHaveClass(/sub/);
    await expect(page.locator('#orderBtn')).toContainText('Order Now');
  });

  test('kitchen band ho to menu phir bhi dikhta hai, par saaf likha hota hai', async ({ page }) => {
    await openMenu(page, { body: bootstrap({ config: { tempClosed: true, tempClosedMsg: 'Kal se shuru.' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Menu chhupana galat hoga — customer ko pata hona chahiye kya milta hai.
    expect(await page.locator('.mc').count()).toBeGreaterThan(0);
    await expect(page.locator('#note')).toBeVisible();
    await expect(page.locator('#note')).toContainText('Kal se shuru');
  });

  test('galat kitchen link par saaf message, khaali page nahi', async ({ page }) => {
    await openMenu(page, { vendor: 'nosuchkitchen', body: { status: 'error', message: 'vendor_not_found' } });
    await page.waitForSelector('.ld', { timeout: 15000 });
    await expect(page.locator('.ld')).toContainText('not found');
  });

  test('backend down ho to bhi kuch samajh me aata hai', async ({ page }) => {
    page.on('pageerror', () => {});
    await page.route('**/script.google.com/**', r => r.abort());
    await page.goto(PAGE + '?v=nestandnosh', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ld', { timeout: 15000 });
    await expect(page.locator('.ld')).toContainText('Could not load the menu');
  });

  test('cutoff meal ke naam ke peeche hai — alag lines nahi', async ({ page }) => {
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Pehle do alag lines thi: serving window aur "aaj ka time nikal gaya" chip.
    // Customer ko ek hi cheez chahiye — kab tak order kar sakta hai.
    await expect(page.locator('.mc-tm')).toHaveCount(0);
    await expect(page.locator('.mc-late')).toHaveCount(0);
    const lunch = CONFIG.mealTypes.find(m => m.key === 'lunch');
    await expect(page.locator('.mc-ti').filter({ hasText: 'Lunch' })).toContainText('order by');
    expect(lunch.cutoff).toBeTruthy();   // fixture cutoff ke bina test bekaar hai
  });

  test('jis meal ka cutoff nikal gaya wo list se hi hat jaata hai', async ({ page }) => {
    // 10:00 AM — Lunch ka cutoff (09:00) nikal chuka, Dinner ka (15:00) nahi.
    // Disabled/struck-through dikhane ki jagah, ab order na ho sakne wala
    // meal list me dikhta hi nahi.
    await openMenu(page, { istOverride: '2026-08-17T10:00:00' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('.mc-ti').filter({ hasText: 'Lunch' })).toHaveCount(0);
    await expect(page.locator('.mc-ti').filter({ hasText: 'Dinner' })).toHaveCount(1);
  });

  test('sabhi meals ka cutoff nikal jaaye to saaf message, khaali menu jaisa nahi', async ({ page }) => {
    // 11:00 PM — Breakfast "aaj" ke liye pehle se hi nikla hota hai
    // (cutoffAheadDay), aur is waqt Lunch/Dinner dono ka bhi nikal chuka hai.
    await openMenu(page, { istOverride: '2026-08-17T23:00:00' });
    // Ye "menu set nahi hua" wale generic message se alag hona chahiye —
    // menu to hai, bas ab order karne ka time nikal gaya. toContainText() khud
    // retry karta hai jab tak fetch/render poora nahi ho jaata.
    await expect(page.locator('.ld')).toContainText('Ordering has closed', { timeout: 15000 });
    await expect(page.locator('.mc')).toHaveCount(0);
  });

  test('cutoff nikalte hi list bina manual refresh ke khud update ho jaati hai', async ({ page }) => {
    // Real wall-clock ke bajaye Playwright ka fake clock — istOverride yahan
    // use nahi karte kyunki wo hamesha ek fixed time deta hai, aage badhta
    // nahi. Yahan asli waqt "aage badhna" hi test ho raha hai. Test machine
    // UTC me chalti hai, IST usse +5:30 hai — 03:25 UTC = 08:55 IST.
    await page.clock.install({ time: new Date('2026-08-17T03:25:00Z') });
    await page.route('**/script.google.com/**', r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap()),
    }));
    await page.goto(PAGE + '?v=nestandnosh', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('.mc-ti').filter({ hasText: 'Lunch' })).toHaveCount(1);

    // 9:00 AM (Lunch cutoff) paar karte hain. Refresh interval 60s hai,
    // isliye usse thoda zyada aage badhte hain taaki ek tick zaroor chale.
    await page.clock.fastForward('00:06:00');
    await expect(page.locator('.mc-ti').filter({ hasText: 'Lunch' })).toHaveCount(0);
  });

  test('phone dark mode me ho to bhi menu light rehta hai', async ({ page }) => {
    // Ye link ajnabiyon ko jaata hai — printed menu card ki tarah har phone par
    // ek hi tarah dikhna chahiye. App ke andar dark mode chalta hai, yahan nahi.
    await page.emulateMedia({ colorScheme: 'dark' });
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    await page.evaluate(() => localStorage.setItem('fbt_theme', '"dark"'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(245, 238, 224)');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.mc')).backgroundColor)).toBe('rgb(255, 255, 255)');
  });

  test('kitchen ka WhatsApp number ho to har item ka apna one-tap order button hai', async ({ page }) => {
    // window.open stub karte hain — asli wa.me tak navigate nahi karna,
    // sirf ye check karna hai final URL kya bana.
    await page.addInitScript(() => { window.__openedUrls = []; window.open = (u) => { window.__openedUrls.push(u); return null; }; });
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '9876543210' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Poora menu ek saath bhejne ki jagah, har item (Mini/Full Tiffin) ka apna
    // button hai — customer ko sirf apna item retype/reply nahi karna padta.
    const vo = page.locator('.vr .vo').first();
    await expect(vo).toBeVisible();

    // Tap karte hi seedha WhatsApp nahi khulta — pehle delivery address
    // modal aata hai, taaki vendor ko pata chale order kahan bhejna hai.
    await vo.click();
    await expect(page.locator('#addrModal')).toBeVisible();
    expect(await page.evaluate(() => window.__openedUrls.length)).toBe(0);

    // Address bhare bina confirm karne par error, WhatsApp abhi bhi nahi khulta.
    await page.click('#addrModal button:has-text("Place Order")');
    await expect(page.locator('#addrErr')).toBeVisible();
    expect(await page.evaluate(() => window.__openedUrls.length)).toBe(0);

    // Township aur society dono dropdown se aate hain (vendor ki apni Setup
    // se — CONFIG.township aur CONFIG.societies), sirf flat number type hota hai.
    await expect(page.locator('#addrTownship')).toHaveValue('Godrej Garden City');
    await page.selectOption('#addrSociety', 'Vrindavan');
    await page.fill('#addrFlat', 'A-1204');
    await page.click('#addrModal button:has-text("Place Order")');
    await expect(page.locator('#addrModal')).toBeHidden();

    const urls = await page.evaluate(() => window.__openedUrls);
    expect(urls.length).toBe(1);
    // 10-digit number 91 ke saath jaana chahiye, warna wa.me link kaam nahi karta.
    expect(urls[0]).toContain('https://wa.me/919876543210?text=');
    const msg = decodeURIComponent(urls[0].split('?text=')[1]);
    expect(msg).toContain('Hello *Nest & Nosh*');
    // Dropdown se jo select hua, wahi message me jaana chahiye — isi ke liye
    // to modal hai.
    expect(msg).toContain('Godrej Garden City, Vrindavan, A-1204');
    // 4-byte emoji (waving hand, meal icons) kuch WhatsApp/Android versions
    // par deep-link text me "�" ban jaate hain — is message me bilkul
    // nahi hone chahiye.
    expect(msg).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(msg).not.toContain('Mujhe chahiye');
    expect(msg).toMatch(/x 1 \(\d{1,2} \w+\)/);
    // WhatsApp se seedha order ho sakta hai, isliye "Order Now" (app/login)
    // yahan chhup jaata hai — Bulk Order/Subscription Plan alag flow hai,
    // WhatsApp number ho ya na ho, hamesha dikhte hain.
    await expect(page.locator('#orderBtn')).toBeHidden();
    await expect(page.locator('#bulkBtn')).toBeVisible();
    await expect(page.locator('#subBtn')).toBeVisible();
  });

  test('order button par icon ke saath "Order" likha hota hai, aur price naam ke baju me hi hai', async ({ page }) => {
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '9876543210' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    // Khaali gol icon dekh kar "click karne se order hoga" samajh nahi aata
    // tha — ab button khud "Order" bolta hai.
    await expect(page.locator('.vr .vo').first()).toContainText('Order');
    // "Mini Tiffin — ₹60" ek hi jagah, alag right-aligned column nahi.
    await expect(page.locator('.vr .vn').filter({ hasText: 'Mini Tiffin' }).first()).toContainText('₹60');
  });

  test('vendor ke societies na ho to sidha free-text building field aata hai', async ({ page }) => {
    await page.addInitScript(() => { window.__openedUrls = []; window.open = (u) => { window.__openedUrls.push(u); return null; }; });
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '9876543210' }, config: { societies: [] } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await page.locator('.vr .vo').first().click();
    await expect(page.locator('#addrModal')).toBeVisible();
    // Society dropdown ki zaroorat hi nahi jab vendor ne koi building list
    // nahi banayi — free-text field seedha dikhna chahiye.
    await expect(page.locator('#addrSocietyRow')).toBeHidden();
    await expect(page.locator('#addrSocietyOtherRow')).toBeVisible();
    await page.fill('#addrSocietyOther', 'Sunshine Apartments');
    await page.fill('#addrFlat', 'B-12');
    await page.click('#addrModal button:has-text("Place Order")');
    const urls = await page.evaluate(() => window.__openedUrls);
    const msg = decodeURIComponent(urls[0].split('?text=')[1]);
    expect(msg).toContain('Godrej Garden City, Sunshine Apartments, B-12');
  });

  test('society dropdown me "Other" chun kar bhi apni building type ki ja sakti hai', async ({ page }) => {
    await page.addInitScript(() => { window.__openedUrls = []; window.open = (u) => { window.__openedUrls.push(u); return null; }; });
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '9876543210' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await page.locator('.vr .vo').first().click();
    await expect(page.locator('#addrSocietyOtherRow')).toBeHidden();
    await page.selectOption('#addrSociety', '__other__');
    await expect(page.locator('#addrSocietyOtherRow')).toBeVisible();
    await page.fill('#addrSocietyOther', 'Palm Residency');
    await page.fill('#addrFlat', 'C-3');
    await page.click('#addrModal button:has-text("Place Order")');
    const urls = await page.evaluate(() => window.__openedUrls);
    const msg = decodeURIComponent(urls[0].split('?text=')[1]);
    expect(msg).toContain('Godrej Garden City, Palm Residency, C-3');
  });

  test('address modal ka Cancel WhatsApp khole bina band ho jaata hai', async ({ page }) => {
    await page.addInitScript(() => { window.__openedUrls = []; window.open = (u) => { window.__openedUrls.push(u); return null; }; });
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '9876543210' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await page.locator('.vr .vo').first().click();
    await expect(page.locator('#addrModal')).toBeVisible();
    await page.click('#addrModal button:has-text("Cancel")');
    await expect(page.locator('#addrModal')).toBeHidden();
    expect(await page.evaluate(() => window.__openedUrls.length)).toBe(0);
  });

  test('WhatsApp number na ho to per-item button nahi dikhta, poora "Order Now" rehta hai', async ({ page }) => {
    // App me number na milne par platform owner ke number par fallback hota hai.
    // Yahan wo KABHI nahi — ye page ajnabiyon ka hai, aur kisi ka order galat
    // number par chala jaana sabse bura outcome hai.
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('.vr .vo')).toHaveCount(0);
    await expect(page.locator('#orderBtn')).toBeVisible();
    await expect(page.locator('#bulkBtn')).toBeVisible();
    await expect(page.locator('#subBtn')).toBeVisible();
  });

  test('adhoora WhatsApp number bhi per-item button nahi dikhata', async ({ page }) => {
    await openMenu(page, { body: bootstrap({ vendor: { whatsapp: '98765' } }) });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('.vr .vo')).toHaveCount(0);
  });

  test('backend ke asli visit counts "Live ordering" / "Already Order" me dikhte hain', async ({ page }) => {
    // Fabricated/fake counter nahi — naya trackvisit backend action
    // (docs/apps-script-live-visits.md), jo asli page visits count karta hai.
    await page.addInitScript((v) => { window.__TEST_IST_OVERRIDE = v; }, DEFAULT_IST);
    let capturedParams = null;
    await page.route('**/script.google.com/**', r => {
      const u = new URL(r.request().url());
      if (u.searchParams.get('action') === 'trackvisit') {
        capturedParams = Object.fromEntries(u.searchParams);
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          status: 'success', live: 4, total: 19,
        }) });
      }
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap()) });
    });
    await page.goto(PAGE + '?v=nestandnosh', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('#statsBar')).toBeVisible();
    await expect(page.locator('#statLive')).toHaveText('4');
    await expect(page.locator('#statDone')).toHaveText('19');
    // Pehli ping vendorId + sessionId + first=1 ke saath jaani chahiye —
    // backend isi se "already visited" ka distinct-session count rakhta hai.
    expect(capturedParams.vendorId).toBe('nestandnosh');
    expect(capturedParams.sessionId).toBeTruthy();
    expect(capturedParams.first).toBe('1');
  });

  test('reload karne par dobara "first" visit count nahi hota', async ({ page }) => {
    await page.addInitScript((v) => { window.__TEST_IST_OVERRIDE = v; }, DEFAULT_IST);
    const firsts = [];
    await page.route('**/script.google.com/**', r => {
      const u = new URL(r.request().url());
      if (u.searchParams.get('action') === 'trackvisit') {
        firsts.push(u.searchParams.get('first'));
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          status: 'success', live: 1, total: 1,
        }) });
      }
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap()) });
    });
    await page.goto(PAGE + '?v=nestandnosh', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#statsBar:not(.hidden)', { timeout: 15000 });
    // sessionStorage tab ke andar reload se bachta hai — naya tab hi naya visit.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#statsBar:not(.hidden)', { timeout: 15000 });
    expect(firsts).toEqual(['1', null]);
  });

  test('doosri visit par cached menu turant dikhta hai, network ka wait nahi', async ({ page }) => {
    // Apps Script cold start slow ho sakta hai — pehli visit ke baad
    // localStorage me cache ho jaata hai, taaki agli baar spinner na dikhe.
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('#vname')).toHaveText('Nest & Nosh');

    // Doosri visit (reload) — fetch ko jaan-bujh kar atka dete hain, dekhne
    // ke liye ki menu network complete hue bina, cache se hi turant dikhta hai.
    let release;
    const held = new Promise(r => { release = r; });
    await page.unroute('**/script.google.com/**');
    await page.route('**/script.google.com/**', async r => {
      await held;
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap()) });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Fetch abhi hold hai, fir bhi menu poora dikhna chahiye — cache se aaya.
    await expect(page.locator('.mc').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#vname')).toHaveText('Nest & Nosh');
    release();
  });

  test('menu aane se pehle "Loading Today\'s Menu" dikhta hai', async ({ page }) => {
    // Pehle do khaali grey dabbe the — ajnabi ko "page toot gaya" jaisa lagta hai.
    let release;
    const held = new Promise(r => { release = r; });
    await page.addInitScript((v) => { window.__TEST_IST_OVERRIDE = v; }, DEFAULT_IST);
    await page.route('**/script.google.com/**', async r => {
      await held;
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap()) });
    });
    await page.goto(PAGE + '?v=nestandnosh', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#meals')).toContainText("Loading Today's Menu");
    // Data load hone tak day picker aur order/share bar khaali/bekaar
    // dikhte the — ab tak hidden rehte hain.
    await expect(page.locator('#daysel')).toBeHidden();
    await expect(page.locator('#cta')).toBeHidden();
    // Vendor ka naam/logo load hone tak "Today's Menu" jaisa galat placeholder
    // nahi dikhna chahiye jo baad me badal jaaye — khaali shimmer dikhta hai.
    await expect(page.locator('#vname')).toBeEmpty();
    await expect(page.locator('#vname')).toHaveClass(/skel/);
    release();
    await page.waitForSelector('.mc', { timeout: 15000 });
    await expect(page.locator('#vname')).toHaveText('Nest & Nosh');
    await expect(page.locator('#vname')).not.toHaveClass(/skel/);
    await expect(page.locator('#daysel')).toBeVisible();
    await expect(page.locator('#cta')).toBeVisible();
  });

  test('page mobile par sideways scroll nahi karta', async ({ page }) => {
    await openMenu(page);
    await page.waitForSelector('.mc', { timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});

test.describe('Vendor side — menu link', () => {
  const { openApp: openAppRaw, adminLogin, freshState } = require('./helpers');

  test('Setup me menu ka clean link milta hai', async ({ page }) => {
    await openAppRaw(page, { vendor: 'hungrybirds', state: freshState() });
    await adminLogin(page);
    await page.evaluate(() => window.adminBnGo('config'));
    await page.waitForTimeout(300);
    // ⚠️ vendorOwnLink() admin.html me '?v=' wala hai; menu link us par nahi bana
    // hai warna '?v=hb/menu' ban jaata. Clean path hona zaroori hai — 404.html
    // sirf usi shape ko menu.html par bhejta hai.
    const link = await page.evaluate(() => window.vendorMenuLink());
    expect(link).toBe('http://localhost:8080/hungrybirds/menu');
  });
});
