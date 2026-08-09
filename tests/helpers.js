const { CONFIG, MENU, PROMOS, SESSION } = require('./fixtures');

const APP_URL = process.env.APP_URL || 'http://localhost:8080/index.html';
const SCRIPT_HOST = 'script.google.com';

// ── Mutable server state — har test se pehle reset ──
function freshState() {
  return {
    orders: [],        // { row, deliveryDate, meal, status, total, phone }
    users: [{ phone:'9876543210', name:'Test User', email:'t@test.com',
              created:'01 Jan 25', lastLogin:'01 Jan 25', status:'Active', orders:0 }],
    promos: [{ row:2, code:'WELCOME50', type:'FLAT', value:50, maxDiscount:0, minOrder:0,
               firstOnly:true, perUser:1, totalLimit:0, expiry:'', active:true,
               visible:true, used:0 }],
    vendors: [{ vendorId:'nestandnosh', name:'Nest & Nosh', sheetId:'SHEET1',
                notifyEmail:'a@b.com', status:'Active', isDefault:true,
                subStatus:'exempt', subDueDate:'', subLastPaid:'', subAmount:499 }],
    platformPayment: { upiId:'', upiName:'', qrImageUrl:'' },
    config: JSON.parse(JSON.stringify(CONFIG)),
    menu: JSON.parse(JSON.stringify(MENU)),
    nextRow: 2,
    bulkRequests: [],  // { row, id, phone, name, meal, qty, date, address, notes, status, approvedQty, approvedPrice, adminNote }
    calls: [],         // audit trail — tests isse assert karte hain
    // Super Admin cross-tenant actions ka apna alag store — state.config/state.users
    // hamesha "jis vendor se abhi login hai" ke liye hain, ye targetVendorId -> data
    // hai (Super Admin doosre vendor ki config/users chhoo raha hai, apni nahi).
    vendorConfigs: {}, // targetVendorId -> config object
    vendorUsers: {},   // targetVendorId -> users array
    notifications: []  // { time, audience:'vendor'|phone, title, body, type, relatedRow } — bell feed
  };
}

function todayIST(offset = 0) {
  const n = new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Kolkata' }));
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

// Mirrors apps-script-v6.txt's logNotification() — audience is 'vendor' or a
// customer phone number.
function logNotif(state, audience, title, body, type, relatedRow) {
  state.notifications.push({ time: new Date().toISOString(), audience: String(audience || ''),
    title: title || '', body: body || '', type: type || '', relatedRow: relatedRow || '' });
}
// Mirrors apps-script-v6.txt's orderStatusPushText().
function orderStatusText(status) {
  if (status === 'Preparing') return { title: '👨‍🍳 Order Update', body: 'Your order is being prepared!' };
  if (status === 'Delivered') return { title: '✅ Order Delivered', body: 'Your order has been delivered. Enjoy your meal!' };
  if (status === 'Cancelled') return { title: '❌ Order Cancelled', body: 'Your order was cancelled by the kitchen.' };
  return null;
}

// GET handler — bootstrap/config/menu/myorders/mysub/me/publicstats
function handleGet(state, url) {
  const action = (url.searchParams.get('action') || '').toLowerCase();
  const token  = url.searchParams.get('token');

  if (action === 'bootstrap')
    return { status:'success', menu:state.menu, config:state.config,
             promos: state.promos.filter(p => p.active && p.visible)
                       .map(p => ({ code:p.code, label:'₹'+p.value+' off',
                                    minOrder:p.minOrder, firstOnly:p.firstOnly })),
             ...(state.vendorBrand ? { vendor: state.vendorBrand } : {}) };
  if (action === 'config') return { status:'success', config:state.config,
             ...(state.vendorBrand ? { vendor: state.vendorBrand } : {}) };
  if (action === 'menu')   return { status:'success', menu:state.menu };
  if (action === 'publicstats')
    return { status:'success', stats:{ date:url.searchParams.get('date'),
             totalCustomers:42,
             breakfast:{ordered:0,preparing:0,delivered:0},
             lunch:{ordered:3,preparing:1,delivered:0},
             dinner:{ordered:2,preparing:0,delivered:0} } };

  if (action === 'me')
    return token === SESSION.token
      ? { status:'success', name:SESSION.name, phone:SESSION.phone, email:'t@test.com' }
      : { status:'invalid_session' };

  if (action === 'myorders') {
    if (token !== SESSION.token) return { status:'invalid_session' };
    const date = url.searchParams.get('date');
    let out = state.orders.filter(o => o.phone === SESSION.phone);
    out = date ? out.filter(o => o.deliveryDate === date)
               : out.filter(o => o.deliveryDate >= todayIST(0));
    return { status:'success', orders: out };
  }

  if (action === 'mysub')
    return token === SESSION.token ? { status:'success', sub:null }
                                   : { status:'invalid_session' };

  if (action === 'mynotifications') {
    if (token !== SESSION.token) return { status:'invalid_session' };
    return { status:'success', notifications: state.notifications.filter(n => n.audience === SESSION.phone).slice().reverse().slice(0, 50) };
  }

  // Discovery/marketplace (no ?v= vendor) — volume tests seed state.discoveryVendors;
  // default [] keeps every existing test (which never sets it) unaffected.
  // listInDiscovery mirrors apps-script-v6.txt's discoverVendors()/listAreas() —
  // a vendor with it explicitly false is excluded, same as opting out in Setup.
  if (action === 'areas') {
    const vs = (state.discoveryVendors || []).filter(v => v.listInDiscovery !== false);
    const counts = {};
    vs.forEach(v => (v.areas || []).forEach(a => { counts[a] = (counts[a] || 0) + 1; }));
    return { status:'success', areas: Object.keys(counts).map(a => ({ area:a, count:counts[a] })) };
  }
  if (action === 'discover') {
    const area = url.searchParams.get('area') || '';
    const vs = (state.discoveryVendors || []).filter(v => v.listInDiscovery !== false && (!area || (v.areas || []).includes(area)));
    return { status:'success', vendors: vs };
  }
  if (action === 'nearbyvendors') {
    const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng'));
    if (isNaN(lat) || isNaN(lng)) return { status:'success', vendors: [] };
    const toRad = d => d * Math.PI / 180;
    const haversineKm = (la1, ln1, la2, ln2) => {
      const R = 6371, dLat = toRad(la2 - la1), dLng = toRad(ln2 - ln1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const vs = (state.discoveryVendors || [])
      .filter(v => v.listInDiscovery !== false && v.lat != null && v.lng != null)
      .map(v => ({ ...v, distanceKm: Math.round(haversineKm(lat, lng, v.lat, v.lng) * 10) / 10 }))
      .filter(v => v.distanceKm <= (v.deliveryRadiusKm || 4))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    return { status:'success', vendors: vs };
  }

  return { status:'success' };
}

// POST handler — orders, admin CRUD, promo, superadmin
function handlePost(state, body) {
  const p = body || {};
  const action = (p.action || '').toLowerCase();
  state.calls.push({ action, payload: p });

  const adminOK  = p.user === 'demo' && p.pass === 'demo123';
  const superOK  = p.user === 'yuvraj_owner' && p.pass === 'ChangeThisSuperPassword!123';
  const denied   = { status:'error', message:'Invalid credentials' };

  // ── Super admin ──
  if (action === 'listvendors') return superOK ? { status:'success', vendors:state.vendors, platformPayment:state.platformPayment } : denied;
  if (action === 'savevendor') {
    if (!superOK) return denied;
    // Real backend reads p.slug first (apiPost stamps p.vendorId with the CURRENT
    // page's own VENDOR_ID, which clobbers the real target on the Super Admin page) —
    // mock must match, else every save is silently misread as editing 'nestandnosh'.
    const id = String(p.slug || p.vendorId || '').trim().toLowerCase();
    if (!id) return { status:'error', message:'Vendor ID zaroori hai' };
    if (!/^[a-z0-9]+$/.test(id)) return { status:'error', message:'Slug galat hai' };
    if (id === 'nestandnosh') return { status:'error', message:'default vendor ka slug hai' };
    const existing = state.vendors.find(v => v.vendorId === id);
    if (!existing) {
      if (!p.sheetId || !p.adminUser || !p.adminPass)
        return { status:'error', message:'Sheet ID, Admin Username aur Password zaroori hain' };
      if (state.vendors.some(v => v.sheetId === p.sheetId))
        return { status:'error', message:'Ye Sheet pehle se kisi vendor ke paas hai' };
      // Naya vendor — billing turant 'pending' se shuru (real backend jaisa hi: kabhi
      // paid nahi hua, due date aaj).
      state.vendors.push({ vendorId:id, name:p.name || id, sheetId:p.sheetId,
                           notifyEmail:p.notifyEmail || '', status:p.status || 'Active', isDefault:false,
                           subStatus:'pending', subDueDate:todayIST(0), subLastPaid:'', subAmount:499 });
    } else {
      // Existing vendor edit (ya status toggle) — billing state chhedo mat.
      existing.name = p.name || existing.name;
      if (p.status) existing.status = p.status;
    }
    return { status:'success', vendors:state.vendors };
  }
  if (action === 'markvendorpaid') {
    if (!superOK) return denied;
    const id = String(p.slug || p.vendorId || '').trim().toLowerCase();
    const v = state.vendors.find(x => x.vendorId === id);
    if (!v) return { status:'error', message:'Vendor mila hi nahi' };
    v.subLastPaid = todayIST(0);
    const next = new Date(); next.setDate(next.getDate() + 30);
    v.subDueDate = next.toISOString().slice(0, 10);
    v.subStatus = 'active';
    return { status:'success', vendors:state.vendors };
  }
  if (action === 'saveplatformpayment') {
    if (!superOK) return denied;
    state.platformPayment = { upiId:p.upiId || '', upiName:p.upiName || '', qrImageUrl:p.qrImageUrl || '' };
    return { status:'success', platformPayment:state.platformPayment };
  }
  if (action === 'uploadplatformqr' || action === 'uploadvendorlogo')
    return superOK ? { status:'success', url:'https://example.test/img.jpg', id:'x1' } : denied;

  // ── Super Admin acting on behalf of a specific vendor ──
  if (['supergetvendorconfig', 'supersavevendorconfig', 'superaddmealtype', 'superlistusers', 'supersetuserstatus', 'superresetuser'].includes(action)) {
    if (!superOK) return denied;
    const tid = String(p.targetVendorId || '').trim().toLowerCase();
    if (!state.vendors.some(v => v.vendorId === tid)) return { status:'error', message:'Vendor not found' };
    if (!state.vendorConfigs[tid]) state.vendorConfigs[tid] = JSON.parse(JSON.stringify(CONFIG));
    if (!state.vendorUsers[tid]) state.vendorUsers[tid] = [];

    if (action === 'supergetvendorconfig') return { status:'success', config: state.vendorConfigs[tid] };
    if (action === 'supersavevendorconfig') {
      Object.assign(state.vendorConfigs[tid], p.patch || {});
      return { status:'success', config: state.vendorConfigs[tid] };
    }
    if (action === 'superaddmealtype') {
      const list = state.vendorConfigs[tid].mealTypes || [];
      if (!p.mealType || !p.mealType.key || !p.mealType.title) return { status:'error', message:'Meal key aur title zaroori hain' };
      if (list.some(m => m.key === p.mealType.key)) return { status:'error', message:'Ye meal key already maujood hai' };
      list.push(p.mealType);
      state.vendorConfigs[tid].mealTypes = list;
      return { status:'success', config: state.vendorConfigs[tid] };
    }
    if (action === 'superlistusers') return { status:'success', users: state.vendorUsers[tid] };
    if (action === 'supersetuserstatus') {
      const u = state.vendorUsers[tid].find(x => x.phone === p.phone);
      if (!u) return { status:'error', message:'User not found.' };
      u.status = p.status;
      return { status:'success' };
    }
    if (action === 'superresetuser') {
      state.vendorUsers[tid] = state.vendorUsers[tid].filter(x => x.phone !== p.phone);
      return { status:'success' };
    }
  }

  // ── Customer session ──
  if (action === 'emaillogin')
    return p.email && p.password === 'correct-pw'
      ? { status:'success', ...SESSION }
      : { status:'error', code:'wrong_pw', message:'Incorrect password.' };
  if (action === 'demologin') return { status:'success', ...SESSION };
  if (action === 'logout')    return { status:'success' };
  if (action === 'googlelogin') {
    if (!p.credential) return { status:'error', message:'Missing credential' };
    if (!p.phone) return { status:'need_phone' };
    return { status:'success', token: SESSION.token, name: p.name || SESSION.name, phone: p.phone };
  }

  // ── Wrapped-APK Google sign-in bounce-back (mirrors completePendingGoogleAuth/
  // checkPendingGoogleAuth in apps-script-v6.txt) ──
  if (action === 'completependinggoogleauth') {
    if (!p.pendingId) return { status:'error', message:'Missing pending auth id' };
    const result = { status:'success', ...SESSION };
    state.pendingAuth = state.pendingAuth || {};
    state.pendingAuth[p.pendingId] = result;
    return result;
  }
  if (action === 'checkpendinggoogleauth') {
    if (!p.pendingId) return { status:'error', message:'Missing pending auth id' };
    const stash = (state.pendingAuth || {})[p.pendingId];
    if (!stash) return { status:'pending' };
    delete state.pendingAuth[p.pendingId];
    return stash;
  }

  // ── Promo ──
  if (action === 'checkpromo') {
    if (p.token !== SESSION.token) return { status:'invalid_session' };
    const pr = state.promos.find(x =>
      x.code === String(p.code || '').trim().toUpperCase() && x.active);
    if (!pr) return { status:'error', message:'Invalid coupon code' };
    const amt = parseInt(p.amount, 10) || 0;
    if (amt < pr.minOrder)
      return { status:'error', message:'Minimum order of ₹'+pr.minOrder+' required' };
    if (pr.firstOnly && state.orders.some(o => o.status !== 'Cancelled'))
      return { status:'error', message:'valid only on your first order' };
    let d = pr.type === 'PERCENT' ? Math.floor(amt * pr.value / 100) : pr.value;
    if (pr.type === 'PERCENT' && pr.maxDiscount) d = Math.min(d, pr.maxDiscount);
    d = Math.max(0, Math.min(d, amt));
    return { status:'success', discount:d, code:pr.code, label:'₹'+pr.value+' off' };
  }
  if (action === 'getpromos')  return adminOK ? { status:'success', promos:state.promos } : denied;
  if (action === 'savepromo') {
    if (!adminOK) return denied;
    const code = String(p.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return { status:'error', message:'Code required' };
    const ex = state.promos.find(x => x.code === code);
    const rec = { row: ex ? ex.row : state.promos.length + 2, code,
      type: p.type === 'PERCENT' ? 'PERCENT' : 'FLAT',
      value: Math.max(1, parseInt(p.value, 10) || 0),
      maxDiscount: parseInt(p.maxDiscount, 10) || 0,
      minOrder: parseInt(p.minOrder, 10) || 0,
      firstOnly: p.firstOnly === '1', perUser: Math.max(1, parseInt(p.perUser, 10) || 1),
      totalLimit: parseInt(p.totalLimit, 10) || 0, expiry: p.expiry || '',
      active: p.active === '1', visible: p.visible === '1', used: ex ? ex.used : 0 };
    if (ex) Object.assign(ex, rec); else state.promos.push(rec);
    return { status:'success', promos:state.promos };
  }
  if (action === 'deletepromo') {
    if (!adminOK) return denied;
    state.promos = state.promos.filter(x => x.code !== String(p.code).toUpperCase());
    return { status:'success', promos:state.promos };
  }

  // ── Bulk / party order requests (vendor approval queue) ──
  if (action === 'listbulkrequests') {
    if (!adminOK) return denied;
    return { status:'success', requests: [...state.bulkRequests].reverse() };
  }
  if (action === 'respondbulkrequest') {
    if (!adminOK) return denied;
    const r = state.bulkRequests.find(x => x.row === parseInt(p.row, 10));
    if (!r) return { status:'error', message:'Invalid request' };
    if (r.status !== 'Pending') return { status:'error', message:'This request has already been ' + r.status.toLowerCase() + '.' };
    const decision = String(p.decision || '').toLowerCase();
    if (decision === 'approve') {
      r.status = 'Approved';
      r.approvedQty = parseInt(p.approvedQty, 10) || r.qty;
      r.approvedPrice = (p.approvedPrice !== undefined && p.approvedPrice !== '') ? Number(p.approvedPrice) : null;
      r.adminNote = p.adminNote || '';
      logNotif(state, r.phone, '✅ Bulk order approved', r.meal + ' x' + r.approvedQty, 'bulk_request_approved', r.row);
    } else if (decision === 'decline') {
      r.status = 'Declined';
      r.adminNote = p.adminNote || '';
      logNotif(state, r.phone, '❌ Bulk order declined', r.meal + ' x' + r.qty, 'bulk_request_declined', r.row);
    } else return { status:'error', message:'Invalid decision' };
    return { status:'success' };
  }

  if (action === 'vendornotifications') {
    if (!adminOK) return denied;
    return { status:'success', notifications: state.notifications.filter(n => n.audience === 'vendor').slice().reverse().slice(0, 50) };
  }

  // ── Admin reads ──
  if (action === 'stats') {
    if (!adminOK) return denied;
    const live = state.orders.filter(o => o.status !== 'Cancelled');
    const rev = live.reduce((s,o) => s + (parseInt(String(o.total).replace(/\D/g,''),10)||0), 0);
    const vid = String(p.vendorId || 'nestandnosh').toLowerCase();
    const v = state.vendors.find(x => x.vendorId === vid) || state.vendors[0];
    return { status:'success',
      today:{ count:live.filter(o=>o.deliveryDate===todayIST(0)).length, revenue:rev },
      week:{ count:live.length, revenue:rev },
      total:{ count:live.length, revenue:rev },
      recent: live.slice(-10).reverse(),
      vendorBilling: { status:v.subStatus||'pending', amount:v.subAmount||499, dueDate:v.subDueDate||'', lastPaid:v.subLastPaid||'' },
      vendorBillingHistory: v.subHistory || [],
      platformPayment: state.platformPayment };
  }
  if (action === 'orders') {
    if (!adminOK) return denied;
    const d = p.date || todayIST(0);
    return { status:'success', orders: state.orders.filter(o => o.deliveryDate === d) };
  }
  if (action === 'users')     return adminOK ? { status:'success', users:state.users } : denied;
  if (action === 'lastorder')
    return adminOK ? { status:'success', lastRow: state.nextRow - 1, latest:null } : denied;

  // ── Admin writes ──
  if (action === 'setstatus') {
    if (!adminOK) return denied;
    const o = state.orders.find(x => x.row === parseInt(p.row, 10));
    if (!o) return { status:'error', message:'Invalid row' };
    if (['Pending','Preparing','Delivered'].indexOf(p.status) < 0)
      return { status:'error', message:'Invalid status' };
    const prev = o.status;
    o.status = p.status;
    o.mealStatus = { breakfast:p.status, lunch:p.status, dinner:p.status };
    const txt = orderStatusText(p.status);
    if (txt && p.status !== prev) logNotif(state, o.phone, txt.title, txt.body, 'order_status', o.row);
    return { status:'success' };
  }
  if (action === 'setmealstatus') {
    if (!adminOK) return denied;
    const o = state.orders.find(x => x.row === parseInt(p.row, 10));
    if (!o) return { status:'error', message:'Invalid row' };
    const prev = o.status;
    o.mealStatus = Object.assign({}, o.mealStatus, { [p.meal]: p.status });
    const active = ['breakfast','lunch','dinner'].filter(m => Number(o[m+'Qty']) > 0);
    const live = active.map(m => o.mealStatus[m]);
    o.status = live.every(s => s === 'Delivered') ? 'Delivered'
             : live.some(s => s === 'Preparing')  ? 'Preparing' : 'Pending';
    const txt = orderStatusText(o.status);
    if (txt && o.status !== prev) logNotif(state, o.phone, txt.title, txt.body, 'order_status', o.row);
    return { status:'success', mealStatus:o.mealStatus, orderStatus:o.status };
  }
  if (action === 'setstatusbulk') {
    if (!adminOK) return denied;
    const rows = (p.rows || []).map(Number);
    const txt = orderStatusText(p.status);
    state.orders.forEach(o => {
      if (rows.includes(o.row)) {
        const prev = o.status;
        o.status = p.status;
        if (txt && p.status !== prev) logNotif(state, o.phone, txt.title, txt.body, 'order_status', o.row);
      }
    });
    return { status:'success', updated: rows.length, statusVal: p.status };
  }
  if (action === 'setpaid') {
    if (!adminOK) return denied;
    const o = state.orders.find(x => x.row === parseInt(p.row, 10));
    if (!o) return { status:'error', message:'Order not found' };
    o.paymentStatus = String(p.paid) === '1' ? 'Paid' : 'Unpaid';
    return { status:'success', paymentStatus:o.paymentStatus };
  }
  if (action === 'setuserstatus') {
    if (!adminOK) return denied;
    const u = state.users.find(x => x.phone === p.phone);
    if (!u) return { status:'error', message:'User not found.' };
    u.status = p.status;
    return { status:'success' };
  }
  if (action === 'resetuser') {
    if (!adminOK) return denied;
    const before = state.orders.length;
    state.orders = state.orders.filter(o => o.phone !== p.phone);
    state.users  = state.users.filter(u => u.phone !== p.phone);
    return { status:'success', counts:{ orders: before - state.orders.length,
             sessions:1, subs:0, promoUses:0, user:1 } };
  }
  if (action === 'savemenu') {
    // App ab poora hafta nahi, ek din (day + dayData) bhejta hai aur backend se
    // poora MERGED menu wapas expect karta hai (saveMenu() dekho index.html me) —
    // pehle ye mock purane "poora menu ek saath" shape ke liye likha tha
    // (state.menu = p.menu), jo naye payload se state.menu ko poora undefined
    // kar deta tha (p.menu ab bheja hi nahi jaata).
    if (!adminOK) return denied;
    if (!p.day || !p.dayData) return { status:'error', message:'day/dayData required' };
    state.menu[p.day] = p.dayData;
    return { status:'success', menu: state.menu };
  }
  if (action === 'savemenuweek') {
    if (!adminOK) return denied;
    state.menu = p.menu || state.menu;
    return { status:'success', menu: state.menu };
  }
  if (action === 'saveconfig') {
    if (!adminOK) return denied;
    Object.assign(state.config, p.config);
    return { status:'success' };
  }
  if (action === 'setemergencyclose') {
    if (!adminOK) return denied;
    const closed = p.closed === '1' || p.closed === true;
    state.config.tempClosed = closed;
    state.config.tempClosedMsg = closed ? String(p.msg || '') : '';
    state.config.tempClosedUntil = closed ? String(p.until || '') : '';
    return { status:'success', tempClosed: state.config.tempClosed, tempClosedUntil: state.config.tempClosedUntil, tempClosedMsg: state.config.tempClosedMsg };
  }
  if (action === 'setcloseddates') {
    if (!adminOK) return denied;
    state.config.closedDates = Array.isArray(p.dates) ? p.dates : [];
    return { status:'success', closedDates: state.config.closedDates };
  }
  if (action === 'savevariants') {
    if (!adminOK) return denied;
    state.config.variants = p.variants;
    return { status:'success', variants:p.variants, banners:p.banners };
  }
  if (action === 'uploadimage')
    return adminOK ? { status:'success', url:'https://example.test/img.jpg', id:'x1' } : denied;

  // ── Customer order + cancel ──
  if (action === 'cancelorder') {
    if (p.token !== SESSION.token) return { status:'invalid_session' };
    const o = state.orders.find(x => x.row === parseInt(p.row, 10));
    if (!o) return { status:'error', message:'Invalid order' };
    if (o.status === 'Cancelled')
      return { status:'error', code:'already_cancelled', message:'already cancelled' };
    o.status = 'Cancelled';
    logNotif(state, 'vendor', '🚫 Order cancelled — ' + (o.name || SESSION.name), o.deliveryDate, 'order_cancelled', o.row);
    return { status:'success' };
  }
  if (action === 'submitbulkrequest') {
    if (p.token !== SESSION.token) return { status:'invalid_session' };
    const qty = parseInt(p.qty, 10);
    if (!p.meal || !qty || qty < 5) return { status:'error', message:'Please enter a valid meal and quantity (5+).' };
    if (!p.date) return { status:'error', message:'Please pick a delivery date.' };
    const row = state.bulkRequests.length + 2;
    state.bulkRequests.push({ row, id:'bulk'+row, phone:SESSION.phone, name:SESSION.name,
      meal:p.meal, qty, date:p.date, address:p.address || '', notes:p.notes || '',
      status:'Pending', approvedQty:null, approvedPrice:null, adminNote:'' });
    logNotif(state, 'vendor', '🎉 Bulk order request — ' + SESSION.name, p.meal + ' x' + qty + ' on ' + p.date, 'bulk_request_submitted', row);
    return { status:'success', id:'bulk'+row };
  }
  if (action === 'mybulkrequests') {
    if (p.token !== SESSION.token) return { status:'invalid_session' };
    return { status:'success', requests: state.bulkRequests.filter(r => r.phone === SESSION.phone).reverse() };
  }

  // Default = place order
  if (p.token !== SESSION.token) return { status:'invalid_session' };
  const meal = ['breakfast','lunch','dinner'].find(m => Number(p[m+'Qty']) > 0);
  if (!meal) return { status:'error', code:'no_meal', message:'Your order is empty' };
  // Vendor-configurable per-meal limit (mirrors apps-script-v6.txt) — default 1
  // when a meal type has no maxQtyPerOrder set, matching the old hardcoded rule.
  const mtCfg = (state.config.mealTypes || []).find(x => x.key === meal);
  const maxQty = (mtCfg && parseInt(mtCfg.maxQtyPerOrder, 10)) || 1;
  if (Number(p[meal+'Qty']) > maxQty)
    return { status:'error', code:'qty_limit', message:'You can order up to ' + maxQty + ' tiffin(s) per meal per day.' };
  if (state.orders.some(o => o.deliveryDate === p.deliveryDate &&
        o.meal === meal && o.status !== 'Cancelled' && o.phone === SESSION.phone))
    return { status:'duplicate', code:'dup_date', message:'You already have an order for this date.' };

  // Server-side total — client ke total pe bharosa nahi
  const V = state.config.variants, PR = state.config.prices;
  let subtotal = 0;
  (p.items || []).forEach(it => {
    const list = V[it.meal] || [];
    const v = list.find(x => x.id === it.tiffinType) || list[0];
    let unit = v.price;
    if (it.meal !== 'breakfast') {
      unit += (it.extraRoti || 0) * (it.butterRoti ? PR.extraRotiButter : PR.extraRotiPlain);
      if (it.dahi) unit += PR.dahi;
      if (it.extraSabzi) unit += PR.extraSabzi;
    }
    subtotal += unit * (it.qty || 1);
  });
  const sameDate = state.orders.some(o => o.deliveryDate === p.deliveryDate &&
                                          o.status !== 'Cancelled' && o.phone === SESSION.phone);
  const fee = (sameDate || state.config.deliveryEnabled === false) ? 0
    : (state.config.farSocieties.includes(p.society) ? state.config.deliveryFar
                                                     : state.config.deliveryNear);
  let total = subtotal + fee;

  let promoStr = '', couponRejected = '';
  if (p.applyCoupon === '1' && p.couponCode) {
    const pr = state.promos.find(x => x.code === String(p.couponCode).toUpperCase() && x.active);
    if (!pr) couponRejected = 'Invalid coupon code';
    else if (pr.firstOnly && state.orders.some(o => o.status !== 'Cancelled'))
      couponRejected = 'valid only on your first order';
    else {
      const d = Math.min(pr.type === 'PERCENT'
        ? Math.floor(total * pr.value / 100) : pr.value, total);
      total -= d;
      promoStr = pr.code + ' −₹' + d;
      pr.used++;
    }
  }

  const row = state.nextRow++;
  state.orders.push({
    row, deliveryDate:p.deliveryDate, meal, phone:SESSION.phone,
    name:p.name, society:p.society, flat:p.flatNo,
    status:'Pending', mealStatus:{ [meal]:'Pending' },
    total:'₹'+total, payment:p.payment, paymentStatus:'Unpaid', promo:promoStr,
    breakfastQty: Number(p.breakfastQty)||0,
    lunchQty: Number(p.lunchQty)||0,
    dinnerQty: Number(p.dinnerQty)||0,
    lunchSabzi:p.lunchSabzi||'', dinnerSabzi:p.dinnerSabzi||'',
    lunchTiffin:p.lunchTiffin||'', dinnerTiffin:p.dinnerTiffin||'',
    lunchRoti:p.lunchRoti||'', dinnerRoti:p.dinnerRoti||'',
    lunchAddons:p.lunchAddons||'None', dinnerAddons:p.dinnerAddons||'None',
    lunchTimeSlot:p.lunchTimeSlot||'', dinnerTimeSlot:p.dinnerTimeSlot||'',
    breakfastTimeSlot:p.breakfastTimeSlot||'',
    note:p.note||'', deliveryType:p.deliveryType||'home',
    time:'01/01 10:00 AM', day:p.day||'', createdIso:new Date().toISOString().slice(0,16)
  });
  logNotif(state, 'vendor', '🧾 New order — ' + (p.name || SESSION.name), p.deliveryDate + ' · ₹' + total, 'new_order', row);
  return { status:'success', total, promo:promoStr, couponRejected };
}

// ── Mock install ──
async function mockBackend(page, state) {
  await page.route(url => url.hostname === SCRIPT_HOST, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let payload;
    if (req.method() === 'POST') {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
      payload = handlePost(state, body);
    } else {
      payload = handleGet(state, url);
    }
    await route.fulfill({ status:200, contentType:'application/json',
                          body: JSON.stringify(payload) });
  });
  // Google Sign-In script — network se mat lao
  await page.route('**/gsi/client', r =>
    r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  // QR image
  await page.route('**/api.qrserver.com/**', r =>
    r.fulfill({ status:200, contentType:'image/png', body:'' }));
  // Reverse geocoding (Discovery's top location label) — free, no API key, but
  // network se mat lao in tests, taaki offline/deterministic rahe.
  await page.route('**/nominatim.openstreetmap.org/**', r =>
    r.fulfill({ status:200, contentType:'application/json',
                body: JSON.stringify({ address: { suburb: 'Bopal', city: 'Ahmedabad' } }) }));
}

// ── App open karo (guest ya logged-in) ──
async function openApp(page, opts = {}) {
  const state = opts.state || freshState();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await mockBackend(page, state);

  await page.addInitScript(({ session, theme, loggedIn, addr, istOverride, skipOnboarding, vendor }) => {
    if (loggedIn) localStorage.setItem('fbt_session', JSON.stringify(session));
    if (theme) localStorage.setItem('fbt_theme', JSON.stringify(theme));
    if (addr)  localStorage.setItem('fbt_addr', JSON.stringify(addr));
    localStorage.setItem('fbt_infostrip_x', JSON.stringify(1));
    // Har existing test ek "returning" browser simulate karta hai (default) —
    // warna first-run onboarding overlay (position:fixed, poori screen cover
    // karta hai) har test me upar aa jaata, sab clicks intercept kar leta.
    // Sirf onboarding-specific tests isse explicitly skipOnboarding:false karke off karte hain.
    // ⚠️ App ka apna storeGet/storeSet non-default vendors ke liye key ko
    // "<vendorId>_fbt_onboarded" namespace karta hai (nsKey()) — sirf raw
    // 'fbt_onboarded' set karna default vendor ('nestandnosh') ke liye hi
    // match karta, multi-vendor load tests (jo apna vendorId use karte hain)
    // ke liye nahi. Dono key set kar do, harmless hai jo match na ho.
    if (skipOnboarding) {
      localStorage.setItem('fbt_onboarded', JSON.stringify(1));
      if (vendor && vendor !== 'nestandnosh') localStorage.setItem(vendor + '_fbt_onboarded', JSON.stringify(1));
    }
    if (istOverride) window.__TEST_IST_OVERRIDE = istOverride;   // app's getISTNow() reads this once at load
  }, { session:SESSION, theme:opts.theme,
       loggedIn: opts.loggedIn !== false,
       addr: opts.addr || { deliveryType:'home', society:'Vrindavan', flatNo:'D-706' },
       istOverride: opts.istOverride || null,
       skipOnboarding: opts.skipOnboarding !== false,
       vendor: opts.vendor || null });

  // ⚠️ opts.vendor tha hi nahi yahan — callers (admin.spec.js, customer.spec.js)
  // ise pass karte the (?v=<vendor> se real bootstrap/CFG load karne ke liye,
  // warna app hardcoded DEFAULT CFG seed pe hi atka rehta — township/societies
  // khaali, prices/mealTypes sirf ISLIYE "sahi" dikhte the kyunki default seed ke
  // numbers (₹80/₹60) fixture ke numbers se coincidentally match kar gaye).
  // Isse saveConfig() ka township-required check har baar fail hota, aur meal-
  // panel bhi kabhi asli vendor menu load nahi karta. Ab query string me jodte hain.
  const qs = new URLSearchParams();
  if (opts.vendor) qs.set('v', opts.vendor);
  if (opts.mode) qs.set('mode', opts.mode);   // APK mode split testing — 'admin' | 'customer'
  const url = qs.toString() ? `${APP_URL}?${qs.toString()}` : APP_URL;
  await page.goto(url);
  await page.waitForSelector('#bootLoader.gone', { timeout:15000 }).catch(() => {});
  return { errors, state };
}

async function setTheme(page, theme) {
  await page.evaluate(t => window.setTheme(t), theme);
  await page.waitForTimeout(150);
}

async function goTo(page, tab) {
  await page.evaluate(t => window.navTo(t), tab);
  await page.waitForTimeout(250);
}

async function adminLogin(page, user = 'demo', pass = 'demo123') {
  await page.evaluate(() => window.showAdminLogin());
  await page.fill('#adminUser', user);
  await page.fill('#adminPass', pass);
  await page.click('#loginBtn');
  await page.waitForTimeout(400);
}

async function superLogin(page, user = 'yuvraj_owner', pass = 'ChangeThisSuperPassword!123') {
  await page.evaluate(() => window.showView('superLogin'));
  await page.fill('#superUser', user);
  await page.fill('#superPass', pass);
  await page.click('#superLoginBtn');
  await page.waitForTimeout(400);
}

module.exports = { openApp, setTheme, goTo, adminLogin, superLogin,
                   freshState, todayIST, APP_URL, SESSION };
