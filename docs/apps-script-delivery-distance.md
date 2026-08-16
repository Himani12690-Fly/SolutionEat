# Delivery charge by distance — Apps Script changes

The app now shows a distance-based delivery charge and sends the customer's
delivery coordinates with every order. **The server is what actually charges**
(`deliveryFeeForOrder` in your Apps Script), so until these three edits are in,
the customer would see one amount and be charged another.

The slab must stay identical on both sides. In the app it lives in `shared.js`
(`deliveryFeeForKm`); below is the same thing for Apps Script.

| Distance | Charge |
|---|---|
| up to 1 km | free |
| 1–2 km | ₹5 |
| 2–3 km | ₹10 |
| 3–4 km | ₹15 |
| 4–5 km | ₹20 |

---

## 1. Add these two helpers

Paste anywhere at top level (e.g. just above `deliveryFeeForOrder`):

```js
// ⚠️ Ye slab app ke shared.js (deliveryFeeForKm) se BILKUL same honi chahiye.
// Alag hui to customer ko kuch aur dikhega aur charge kuch aur hoga.
const DELIVERY_MAX_RADIUS_KM = 5;

function distanceKmGeo(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.pow(Math.sin(dLat / 2), 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.pow(Math.sin(dLon / 2), 2);
  return R * 2 * Math.asin(Math.sqrt(a));
}

function deliveryFeeForKm(km) {
  if (typeof km !== 'number' || !isFinite(km) || km < 0) return null;
  if (km <= 1) return 0;
  if (km <= 2) return 5;
  if (km <= 3) return 10;
  if (km <= 4) return 15;
  return 20;
}

// App order payload me p.lat / p.lng bhejta hai; kitchen ka location config me
// pehle se hai (kitchenLat / kitchenLng).
function orderDistanceKm(p) {
  const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const c = readConfig();
  if (typeof c.kitchenLat !== 'number' || typeof c.kitchenLng !== 'number') return null;
  return distanceKmGeo(lat, lng, c.kitchenLat, c.kitchenLng);
}
```

## 2. Use it in `deliveryFeeForOrder`

Only the **last three lines** of the existing function change. Keep the
`deliveryEnabled` check and the same-date "same trip = no second fee" block
exactly as they are.

Replace this ending:

```js
  if (String(p.deliveryType || 'home') === 'office') {
    const co = findCompany(p.society);
    return co ? co.fee : readConfig().deliveryNear;
  }
  return deliveryFeeFor(p.society);
}
```

with:

```js
  // Distance-based charge. Location na mile to purana society/company wala
  // fee fallback rehta hai, taaki koi order fee ke bina na nikal jaaye.
  const slab = deliveryFeeForKm(orderDistanceKm(p));
  if (slab !== null) return slab;

  if (String(p.deliveryType || 'home') === 'office') {
    const co = findCompany(p.society);
    return co ? co.fee : readConfig().deliveryNear;
  }
  return deliveryFeeFor(p.society);
}
```

## 3. Cap the delivery radius at 5 km

In `saveConfig`, this line currently allows 50:

```js
  deliveryRadiusKm = Math.min(50, deliveryRadiusKm);
```

change to:

```js
  deliveryRadiusKm = Math.min(DELIVERY_MAX_RADIUS_KM, deliveryRadiusKm);
```

The admin screen already caps the input at 5; this stops a hand-edited request
from getting a larger value past it.

---

## Optional: reject out-of-range orders server-side

The app already blocks ordering beyond the radius. If you want the server to
refuse too, add this near the top of the order handler, right after
`p._phoneForFee = phone;`:

```js
  const _km = orderDistanceKm(p);
  if (_km !== null) {
    const _max = Math.min(Number(readConfig().deliveryRadiusKm) || DELIVERY_MAX_RADIUS_KM, DELIVERY_MAX_RADIUS_KM);
    if (_km > _max) return { status: 'error', message: 'This kitchen does not deliver to your location yet.' };
  }
```

## After deploying

Re-deploy the Apps Script (new version), then place one test order and check
that the delivery charge written to the Orders sheet matches what the app
showed in the cart. If they differ, the two slabs have drifted apart.
