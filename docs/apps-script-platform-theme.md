# Platform theme picker — Apps Script changes

Super Admin (`superadmin.html`) now has a "🎨 Platform Theme" picker — 22
color swatches (Chrome's theme-picker style). Whichever one the super admin
picks should show up as the accent color everywhere: the customer app
(`index.html`/`customer.html`), the vendor admin panel (`admin.html`), the
public menu (`menu.html`) and ad-landing page (`land.html`) for every
vendor, not just one kitchen.

The frontend already ships all 22 presets and the color math to derive
light/dark shades from a single base hex — nothing about that needs backend
work. What's missing is **persistence + delivery**: today `platformTheme`
is not part of any response, so every page just falls back to the default
orange. This mirrors the existing `platformPayment` feature (super-admin
payment settings, already wired end to end) — same auth, same shape, one
new field.

Nothing about your existing actions changes structurally — this is purely
additive, and every call site already treats a missing `platformTheme` as
"keep the current default," so you can ship this whenever, with zero
frontend redeploy required.

---

## 1. Add a `platformTheme` value to platform settings storage

Wherever `platformPayment` (upiId/upiName/qrImageUrl) is currently stored —
PropertiesService, a "Platform Settings" sheet, whatever — add one more
string field next to it, e.g. `platformTheme`, defaulting to `'orange'`.

## 2. Return it from `listvendors`

The response super-admin login/restore already gets (alongside
`vendors` and `platformPayment`) should also include:

```js
{
  status: 'success',
  vendors: [...],
  platformPayment: { upiId, upiName, qrImageUrl },
  platformTheme: 'orange'   // <-- new
}
```

## 3. Return it from `bootstrap`

Every vendor's public bootstrap response (used by `index.html`,
`customer.html`, `admin.html`, `menu.html`, `land.html`) should also
include the same platform-wide value:

```js
{
  status: 'success',
  vendor: {...},
  menu: {...},
  config: {...},
  promos: [...],
  platformTheme: 'orange'   // <-- new, same value regardless of vendorId
}
```

This is how customers/vendors who never touch the super-admin panel still
see the chosen color — it rides along on the bootstrap call every page
already makes.

## 4. Add `action=saveplatformtheme`

Same auth pattern as `saveplatformpayment` — validates the super-admin
`user`/`pass`, then persists the new value:

```js
// Route: action=saveplatformtheme (POST). Same super-admin auth as
// saveplatformpayment — reuse whatever function validates that.
function saveplatformtheme(e) {
  var p = JSON.parse(e.postData.contents);
  if (!isValidSuperAdmin_(p.user, p.pass)) {  // reuse your existing check
    return jsonOut_({ status: 'error', message: 'Invalid username or password.' });
  }
  var theme = String(p.theme || '').trim();
  if (!theme) {
    return jsonOut_({ status: 'error', message: 'Missing theme.' });
  }
  // Store alongside platformPayment — same place, same pattern.
  savePlatformSetting_('platformTheme', theme);
  return jsonOut_({ status: 'success', platformTheme: theme });
}
```

The frontend sends `theme` as one of the 22 preset ids (`orange`, `red`,
`rose`, `pink`, `fuchsia`, `purple`, `violet`, `indigo`, `blue`, `sky`,
`cyan`, `teal`, `emerald`, `green`, `lime`, `yellow`, `amber`,
`terracotta`, `brown`, `maroon`, `slate`, `gray`) — store and return
whatever string you're given verbatim, no validation needed against that
list (a raw `#rrggbb` would also work fine if you ever want to allow a
custom color, the frontend already accepts either shape).

## 5. Route `action=saveplatformtheme` to it

Same as any other action — one more branch in `doGet`/`doPost`'s dispatcher
next to `saveplatformpayment`.

## After deploying

Re-deploy the Apps Script, open Super Admin → pick a swatch. It should
show "✅ Saved — sab users ko live dikhega" and the accent updates
immediately on that screen. Refresh the customer app, admin panel, or a
public menu link for any vendor — same color should now appear there too
(each page also caches the last-seen value in `localStorage`, so it stays
consistent even before the next network round-trip completes).

If the backend isn't updated yet, every page just keeps using the default
orange — nothing breaks either way.
