// ═══════════ Nest & Nosh — SINGLE Service Worker (cache + push) ═══════════
// ⚠️ Pehle do alag SW the: sw.js (offline cache) aur firebase-messaging-sw.js (push).
// DONO scope '/' pe register hote the. Service worker registration scope se keyed
// hoti hai — same scope pe doosra script register karne se pehla REPLACE ho jaata
// hai. Isliye dono ek dusre ko khaate rehte the:
//   push toggle  → firebase SW jeeta → offline cache mar gaya
//   page reload   → sw.js jeeta       → push handler mar gaya (FCM 200 deta tha,
//                                        par device pe kuch dikhta nahi tha)
// Ab dono ek hi file me hain = ek scope, ek registration, koi race nahi.
//
// Order maayne rakhta hai: cache ke listeners SABSE PEHLE register hote hain, phir
// firebase. Agar user offline ho aur ye SW naya install ho raha ho to gstatic se
// importScripts fail ho sakta hai — us case me bhi offline cache poora kaam karta
// rehna chahiye, isliye push wala hissa alag try/catch me isolate hai.

const CACHE = 'fbt-v38';
const ASSETS = ['./', './index.html', './manifest.json', './logo-round.png'];

// ─────────────────────────── 1. CACHE (firebase se bilkul independent) ───────────────────────────

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }   // parse fail → SW haath na lagaye

  // 1) Sirf GET handle karo. POST/PUT waghera (saare API calls) → seedha network,
  //    SW bilkul beech me na aaye (yehi GAS redirect ko todta tha).
  if (req.method !== 'GET') return;

  // 2) Sirf apni hi origin (GitHub Pages) ki requests handle karo. Baaki sab —
  //    script.google.com, googleusercontent.com, gstatic (firebase SDK), drive,
  //    apis, qrserver, koi bhi third-party — SW touch hi na kare.
  if (url.origin !== self.location.origin) return;

  // 3) HTML/navigation → network-first (naya deploy turant dikhe), offline pe cache.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // 4) vendors.json → hamesha network se (stale vendor endpoint na chale).
  if (url.pathname.endsWith('vendors.json')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // 5) Baaki apni static assets (icons, manifest) → cache-first, fast.
  e.respondWith(caches.match(req).then(c => c || fetch(req)));
});

// ─────────────────────────── 2. PUSH (Firebase Cloud Messaging) ───────────────────────────
// Ye config PUBLIC/client-safe hai. Asli secret (service account) Apps Script ke
// Script Properties me rehta hai, frontend me kabhi nahi aata.
// index.html ke FIREBASE_CONFIG se ye values EXACT SAME honi chahiye.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBkPMD8OvXGwbCGPVZFKNcQ0lc1cmkFjKg",
  authDomain: "flyingbirdstiffin.firebaseapp.com",
  projectId: "flyingbirdstiffin",
  storageBucket: "flyingbirdstiffin.firebasestorage.app",
  messagingSenderId: "842880418359",
  appId: "1:842880418359:web:2fc80730cd2ab88eb8f5b2"
};

let __pushReady = false;

// ⚠️ importScripts try/catch ke ANDAR hai. Pehle ye top-level pe khula pada tha —
// offline install ya gstatic down hone pe ye throw karta aur POORA SW install fail
// ho jaata, yani offline cache bhi chala jaata. Ab worst case sirf push miss hota hai.
try {
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  // App band ho (background / tab closed) tab bhi ye push dikhata hai. Foreground
  // (app khula) ke liye index.html ka onMessage() handler chalta hai.
  messaging.onBackgroundMessage(function (payload) {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || 'Nest & Nosh', {
      body: n.body || '',
      icon: 'logo-round.png',
      data: payload.data || {}
    });
  });
  __pushReady = true;
} catch (e) {
  // Firebase SDK load/init nahi hua — neeche ka raw fallback sambhal lega.
}

// Fallback: firebase SDK load hi na ho paaya to bhi raw push event se notification
// dikhao. Ye listener SIRF tab lagta hai jab firebase ready NAHI hua — warna
// firebase ka apna push listener aur ye dono chalte aur DO notification aati.
if (!__pushReady) {
  self.addEventListener('push', function (e) {
    let p = {};
    try { p = e.data ? e.data.json() : {}; }
    catch (_) { p = { notification: { body: e.data ? e.data.text() : '' } }; }
    const n = p.notification || {};
    e.waitUntil(self.registration.showNotification(n.title || 'Nest & Nosh', {
      body: n.body || '',
      icon: 'logo-round.png',
      data: p.data || {}
    }));
  });
}

// Notification pe tap karne pe app kholo. Pehle koi handler nahi tha — tap karne pe
// kuch hota hi nahi tha. Agar app pehle se khula hai to usi tab ko focus karo,
// naya tab na kholo. payload.data.url ho to wahan bhejo (vendor-specific link),
// warna app root.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const data = e.notification.data || {};
  const target = data.url || self.registration.scope;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.registration.scope) === 0) {
          return list[i].focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
