# "Live ordering" / "Already Order" — Apps Script changes

The public menu page (`menu.html`) shows two numbers above the menu:

- **Live ordering** — how many people have the menu page open right now.
- **Already Order** — how many people have visited it today.

Neither of these can be computed from data your backend already has (the
Sheet only records actual orders — name, time, status, total — never plain
page visits). So a new backend action is needed: `trackvisit`. Nothing
about your existing actions (`bootstrap`, `publicstats`, `stats`, `order`,
etc.) needs to change — this is purely additive.

The two labels stay as-is even though the counts are now about *visits*,
not orders — that's a deliberate choice already made for this page.

---

## 1. Add this function

Paste it anywhere at the top level of your Apps Script project:

```js
// Live-visitor tracking for the public menu page (menu.html). Two counts,
// both scoped per vendor:
//   - "live" = distinct sessions seen in the last 90 seconds (menu.html
//     pings every ~45s while the page stays open, so 90s covers one missed
//     beat without a visitor dropping off the count the moment they blink).
//   - "total" = running count of *first* pings today — one per browser tab
//     session, not one per heartbeat, so refreshing the page doesn't
//     inflate it.
// PropertiesService is small-scale storage built into Apps Script — no
// extra Sheet needed. LockService avoids two simultaneous visitors
// corrupting each other's read-modify-write.
function trackVisit(e) {
  var vendorId = String((e.parameter.vendorId || '')).trim();
  var sessionId = String((e.parameter.sessionId || '')).trim();
  var isFirst = e.parameter.first === '1';
  if (!vendorId || !sessionId) {
    return jsonOut_({ status: 'error', message: 'missing vendorId/sessionId' });
  }

  var LIVE_TTL_MS = 90 * 1000;
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  var live = 0, total = 0;

  if (lock.tryLock(5000)) {
    try {
      var liveKey = 'live_' + vendorId;
      var liveMap = {};
      try { liveMap = JSON.parse(props.getProperty(liveKey) || '{}'); } catch (err) {}
      var now = Date.now();
      liveMap[sessionId] = now;
      var pruned = {};
      for (var sid in liveMap) {
        if (now - liveMap[sid] < LIVE_TTL_MS) pruned[sid] = liveMap[sid];
      }
      props.setProperty(liveKey, JSON.stringify(pruned));
      live = Object.keys(pruned).length;

      var dateStr = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
      var totalKey = 'visits_' + vendorId + '_' + dateStr;
      total = parseInt(props.getProperty(totalKey) || '0', 10) || 0;
      if (isFirst) {
        total += 1;
        props.setProperty(totalKey, String(total));
      }
    } finally {
      lock.releaseLock();
    }
  }

  return jsonOut_({ status: 'success', live: live, total: total });
}
```

## 2. Route `action=trackvisit` to it

Your `doGet(e)` already dispatches on `e.parameter.action` for `bootstrap`,
`publicstats`, and everything else — add one more branch next to those,
routed to `trackVisit(e)`. The exact syntax depends on whether your
dispatcher is an `if/else` chain or a `switch`; either way it's a single
line pointing at the function above.

## 3. Reuse your existing JSON-response helper

Every action already returns JSON the same way — `trackVisit` above calls
that same helper via `jsonOut_(...)`. If your helper has a different name
(e.g. `output_`, `json_`, `resp_`), either rename the calls in `trackVisit`
to match it, or — if you don't have one — add this:

```js
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

(Skip this step if a same-shaped helper already exists under a different
name — don't define two.)

## After deploying

Re-deploy the Apps Script (new version), then open the menu page and
confirm the "Live ordering" / "Already Order" numbers appear (they only
show once the first `trackvisit` call succeeds — if the backend isn't
updated yet, the stats bar just stays hidden, the rest of the page works
fine either way).
