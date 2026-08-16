# Performance — 100 vendors × 50 customers

Chalane ke liye: `npm run perf` (ya `N_VENDORS=200 N_CUSTOMERS=100 npm run perf`).

Ye sab **mocked backend** ke against chalta hai. Real Apps Script deployment ko
jaan-boojh kar touch nahi kiya jaata — wo production hai; use load-test karna
live users ko todega aur Google ka quota bhi jala dega.

---

## 1. Frontend — customer side

**Verdict: eye-blink hai.** 100 vendors aur 50 customers/vendor ke data par har
customer operation p95 par 1 frame (16 ms) se neeche hai.

| Operation | p50 | p95 | max |
|---|---|---|---|
| discovery list (100 vendors) | 2.0 ms | 3.1 ms | 6.9 ms |
| discovery nearby (sort + distance filter) | 2.6 ms | 3.5 ms | 4.6 ms |
| menu panel render | 1.0 ms | 1.2 ms | 1.5 ms |
| date switch (today ↔ tomorrow) | 1.4 ms | 2.0 ms | 2.1 ms |
| add to cart | 1.3 ms | 1.8 ms | 1.9 ms |
| cart render (20 items) | 0.8 ms | 7.1 ms | 14.3 ms |
| cart total recompute | 0.1 ms | 0.2 ms | 0.2 ms |
| delivery fee (haversine) | ~0 ms | ~0 ms | ~0 ms |
| view switch | ~0 ms | 0.2 ms | 0.2 ms |

Zero JS errors poore run me.

### Boot naapne ka sahi tareeka

App **~200 ms** me usable ho jaata hai — tab bhi jab saare external CDNs
(Google Sign-In, Razorpay, Firebase, QR) 20 second tak hang karein. Chaaron
`defer` hain, isliye rendering rukti nahi.

⚠️ `DOMContentLoaded` par mat naapo. `defer` scripts DCL ko rokte hain, to jis
sandbox me ye CDNs blocked the wahan DCL **12.8 s** aaya jabki app 182 ms me
usable tha. `waitUntil:'commit'` + apna poll — wahi asli number deta hai.

⚠️ `npm run serve` (http-server) gzip nahi karta. Uske against naapoge to
payload ~2.3× bada dikhega (694 KB vs 305 KB). `tools/perf-bench.js` apna
gzip server start karta hai taaki numbers GitHub Pages jaise hon.

### First load — asli mobile networks

| Network | FCP | usable | transfer |
|---|---|---|---|
| Fast 4G | 300 ms | 838 ms | 507 KB |
| Slow 4G | 580 ms | 1482 ms | 507 KB |
| Good 3G | 1148 ms | 3105 ms | 507 KB |
| Slow 3G | 2728 ms | 10970 ms | 507 KB |

Ye **pehli** visit hai (cold cache). Repeat visits par `sw.js` app-shell cache
se serve karta hai, isliye bahut tez.

### Ek asli bottleneck mila: inline base64 images

`index.html` me **do 125 KB JPEG base64 me inline** hain (MEAL_META ke default
lunch/dinner photos). File ka 40% yahi hai — aur chaaron HTML files me hain.

| | gzipped |
|---|---|
| `index.html` abhi | 299 KB |
| images alag files me nikaal dein to | **104 KB** |

Faayda sirf 195 KB ka nahi:

- **Har update par dobara download hota hai.** Stamp badalne par naya
  `index.html` aata hai — aur uske saath wahi 188 KB ki images jo kabhi badli
  hi nahi. `sw.js` me vendor logos ke liye ye problem already solve ki gayi
  thi (`IMG_CACHE`), in do images ke liye nahi.
- Alag files parallel me download hoti hain aur HTML parse ko nahi rokti.
- Binary JPEG base64 se ~33% chhota hota hai.

Karna kya hai: dono JPEG ko `images/lunch.jpg` / `images/dinner.jpg` me nikaalo,
`MEAL_META` me path do, aur `sw.js` ke `ASSETS` me add karo (warna offline toot
jayega).

---

## 2. Backend — yahan asli limit hai

**Frontend 5000 customers sambhal lega. Shared Apps Script deployment nahi
sambhalega**, aur ye tuning se theek hone wali cheez nahi — architecture ki
limit hai.

`placeOrder()` `LockService.getScriptLock()` leta hai. Ye lock **script-level**
hai, vendor-level nahi — ek hi deployment par baithe **saare 100 vendors ke
orders globally serialize** ho jaate hain, chahe wo alag-alag Sheets me likh
rahe hon. Code me ye already likha hai (`vendorBrand()` ke comment me).

Lock ke andar ~11 Google Sheets round-trips hote hain (7 `getRange`, 4
`getLastRow`). Sheets I/O par har round-trip typically ~50-200 ms hai, yaani
**~0.5-2 second per order, ek waqt me sirf ek order**.

Iska seedha matlab:

- Throughput ≈ **0.5-2 orders/second, poore platform ke liye** — 1 vendor ho ya 100.
- `tryLock(30000)` — 30 second se zyada wait karne wale ko seedha
  `"Server is busy"` milta hai.
- Dinner rush me agar 500 customers 10 minute me order karein, to bade hisse ko
  busy error milega. 5000 orders drain hone me ~1.5 ghanta lagega.

Login (`googleLogin`, `emailLogin`) bhi wahi global lock leta hai, to rush me
log in bhi nahi ho payega.

### Iska hal already code me maujood hai

Har vendor ko apna Apps Script deployment do. `Vendors` sheet ka `scriptUrl`
column bootstrap response me aata hai aur frontend `GOOGLE_SCRIPT_URL` switch
kar leta hai (`tryBootstrap()`; test: `tests/vendor-scripturl.spec.js`).

Alag deployment = alag script lock. 100 vendors = 100 parallel locks, ek nahi.
**Yahi wo ek cheez hai jo "100 vendors, no failure" ko mumkin banati hai.**

Iske baad bhi Google Apps Script ki apni quotas (simultaneous executions,
6-minute runtime, daily limits) lagti hain. Agar sach me har vendor par sustained
high volume chahiye, to Apps Script se nikal kar ek asli backend chahiye hoga —
lekin per-vendor deployment ke baad wo turant zaroori nahi rehta.
