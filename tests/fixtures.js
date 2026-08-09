// Backend responses — sab tests yahan se data lete hain
const CONFIG = {
  // Add-on prices only — per-meal base price now lives on each mealTypes[] entry
  // (see below), matching index.html's CFG.mealTypes/defaultMealTypes() shape.
  prices: { tiffinMini:60, extraRotiPlain:12, extraRotiButter:16, dahi:20, extraSabzi:30 },
  // Real index.html CFG.mealTypes shape — bootstrap responses without this key
  // fall back to defaultMealTypes() (see the "!CFG.mealTypes.length" guards in
  // index.html), but tests should exercise the real shape, not just the fallback.
  mealTypes: [
    { key:'breakfast', title:'Breakfast', emoji:'🌅', price:30, capacity:0, windowStart:'07:00', windowEnd:'09:00', cutoff:'22:00', cutoffAheadDay:true,  enabled:true, core:true, hasVariants:false },
    { key:'lunch',     title:'Lunch',     emoji:'☀️', price:80, capacity:0, windowStart:'12:00', windowEnd:'14:00', cutoff:'09:00', cutoffAheadDay:false, enabled:true, core:true, hasVariants:true },
    { key:'dinner',    title:'Dinner',    emoji:'🌙', price:80, capacity:0, windowStart:'19:00', windowEnd:'21:00', cutoff:'15:00', cutoffAheadDay:false, enabled:true, core:true, hasVariants:true }
  ],
  township: 'Godrej Garden City',
  societies: ['Vrindavan','Eden'],
  deliveryEnabled: true, deliveryNear: 10, deliveryFar: 20, farSocieties: ['Eden'],
  closedDates: [], capacity: { breakfast:0, lunch:0, dinner:0 },
  // ⚠️ Order matters — app ka defaultVariantId(m) hamesha variantsFor(m)[0] uthata hai
  // (quickAdd isi se default tiffin decide karta hai). Real app me 'full' hamesha
  // pehla hota hai (index.html defaultVariantsFE) — mock isi order ko match kare,
  // warna quickAdd tests 'mini' pick karke galat total expect karte hain.
  variants: {
    breakfast: [{ id:'std', name:'Breakfast', price:30, items:['Poha','Chai'], img:'' }],
    lunch: [
      { id:'full', name:'Full Tiffin', price:80, items:['Roti (5)','Daal','Chawal'], img:'' },
      { id:'mini', name:'Mini Tiffin', price:60, items:['Roti (4)','1 Sabzi'], img:'' }
    ],
    dinner: [
      { id:'full', name:'Full Tiffin', price:80, items:['Roti (5)','Daal','Chawal'], img:'' },
      { id:'mini', name:'Mini Tiffin', price:60, items:['Roti (4)','1 Sabzi'], img:'' }
    ]
  },
  banners: { breakfast:'', lunch:'', dinner:'' },
  upiId: '7043491481@ybl', upiName: 'Nest & Nosh', fssai: '20724XXXXXXXXXX',
  whatsappAuto: false,
  mealsEnabled: { breakfast:true, lunch:true, dinner:true },
  homeEnabled: true, officeEnabled: false, companies: [],
  // Kitchen location is now mandatory to save Setup (see index.html's
  // saveConfig()) — default every test's vendor to already having it set
  // (Ahmedabad coords, matching nearby-kitchens.spec.js's CUSTOMER_LAT/LNG),
  // so existing Setup-save tests aren't all forced to capture location first.
  kitchenLat: 23.0225, kitchenLng: 72.5714, deliveryRadiusKm: 4
};

const DAY = {
  breakfast: ['Poha','Chai'],
  lunch:  { sabziOptions:['Paneer Butter Masala','Dal Tadka'], fixedItems:['Jeera Rice','Roti (4)'] },
  dinner: { sabziOptions:['Aloo Gobi','Rajma Masala'],        fixedItems:['Steam Rice','Roti (4)'] }
};
const MENU = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
  .reduce((m,d) => (m[d] = JSON.parse(JSON.stringify(DAY)), m), {});

const PROMOS = [{ code:'WELCOME50', label:'₹50 off', minOrder:0, firstOnly:true }];

const SESSION = { token:'test-token-123', name:'Test User', phone:'9876543210' };

module.exports = { CONFIG, MENU, PROMOS, SESSION };
