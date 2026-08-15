// shared.js -- extracted from index.html (Phase 1: shared/common code, zero behavior change).
// Loaded as a plain classic script immediately before the main inline <script> in index.html,
// so its top-level const/let/function declarations are visible as globals to that script.
// Do not add type="module" or defer/async to its <script> tag -- execution order matters.

    const ALL_VIEWS = ['authPage','homeView','page1','page2','cartView','ordersView','subView','aboutView','profileView','bulkView','c','adminKitchenGate','adminLogin','adminPanel','superLogin','superPanel','qaView','dscView','kitchenClosedView'];
  // ═══════ PER-VENDOR BACKEND ROUTING ═══════
  // ⚠️ Scale ka asli fix: har vendor ka APNA Apps Script deployment.
  // Apps Script ki quota (runtime, simultaneous executions) poore SCRIPT PROJECT ki
  // hoti hai — sirf sheet alag karne se kuch nahi badalta. Alag deployment matlab
  // alag quota bucket → ek vendor ka rush baaki vendors ko slow nahi karega.
  //
  // Routing ek static file se aati hai (vendors.json, index.html ke saath hi host karo):
  //   { "nestandnosh": { "url": "https://script.google.com/.../exec" },
  //     "maakaswaad":  { "url": "https://script.google.com/.../exec" } }
  // Ye file GitHub Pages/Netlify se serve hoti hai — koi Apps Script call nahi lagti,
  // isliye routing khud kabhi bottleneck nahi banegi.
  const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwdMXlSwNdqO84OspsUe2jAEeDL-hbwjwLcKL-fo6YObB6Se-dvTxX2iS5BMz2t8bV6/exec';
  let GOOGLE_SCRIPT_URL = DEFAULT_SCRIPT_URL;   // boot pe vendor ke hisaab se set hota hai
  // 25+ vendors ke baad shared deployment ka LockService.getScriptLock() SAARE
  // vendors ke order-placement ko globally serialize karne lagta hai (chahe wo
  // alag-alag Sheets me likh rahe hon) — real bottleneck load-testing me pakda
  // gaya. Vendor apna alag Apps Script deployment bana ke Super Admin me
  // scriptUrl set kar sakta hai; ye us record ko bootstrap response (j.vendor.
  // scriptUrl) se validate karke GOOGLE_SCRIPT_URL switch kar deta hai, taaki
  // uske baad ke saare calls (order/menu/admin) us alag deployment pe jaayein,
  // apne lock ke saath, doosre vendors se independent.
  // ⚠️ Pehle yahan alag se 'vendors.json' fetch karte the isi lookup ke liye —
  // wo file repo me kabhi bani hi nahi (guaranteed 404, silent no-op fallback).
  // Ab lookup alag request ki jagah usi bootstrap response ke andar aata hai.
  function applyVendorScriptUrl(vendor){
    const u = vendor && vendor.scriptUrl;
    if(!u) return;
    // Sirf asli script.google.com URL accept karo — GOOGLE_SCRIPT_URL har call
    // me session token bhejta hai, isliye kisi bhi arbitrary URL pe switch hona
    // (galat data-entry ya compromised Super Admin account se) token leak kar
    // sakta hai. Format galat ho to chup-chaap shared URL pe hi rehte hain.
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u)) return;
    GOOGLE_SCRIPT_URL = u;
  }
  function loadVendorEndpoint(){
    return Promise.resolve();
  }
  // ═══════ MULTI-TENANT: VENDOR ID ═══════
  // Har vendor ka apna link: yourapp.com/?v=vendorSlug — link na ho to DEFAULT_VENDOR chalta hai
  // (isliye maujooda users/links bilkul bhi nahi tootenge). Phase 2 mein backend isi vendorId se
  // Sheets (Orders/Menu/Config) filter karega.
  const DEFAULT_VENDOR_ID = 'nestandnosh';
  // ?Admin=<vendorSlug> (or ?admin=) — the ONLY way to reach admin login now;
  // there is no in-UI link (see authPage footer). Doubles as the vendor-slug
  // source for admin URLs, same as ?v= does for customer links — a vendor's
  // admin URL is just /?Admin=<theirSlug>, meant to be the Admin WebView APK's
  // start URL / a private bookmark, never surfaced to customers.
  const ADMIN_PARAM = (function(){
    try{
      const q = new URLSearchParams(location.search);
      const v = q.get('Admin') || q.get('admin');
      return (v && v.trim()) ? v.trim().toLowerCase() : '';
    }catch(e){ return ''; }
  })();
  const HAS_ADMIN_PARAM = !!ADMIN_PARAM;
  const VENDOR_ID = (function(){
    try{
      const q = new URLSearchParams(location.search).get('v');
      if (q && q.trim()) return q.trim().toLowerCase();
      if (ADMIN_PARAM) return ADMIN_PARAM;
      return DEFAULT_VENDOR_ID;
    }catch(e){ return DEFAULT_VENDOR_ID; }
  })();
  const IS_DEFAULT_VENDOR = (VENDOR_ID === DEFAULT_VENDOR_ID);
  const IS_DEMO = (VENDOR_ID === 'demo');   // ?v=demo → try-before-buy mode
  // Platform ka main link (bina ?v= ya ?Admin=) → pehle discovery. Vendor ke
  // apne link se aane wale customer ko seedha uski app milegi.
  const HAS_VENDOR_PARAM = (function(){
    try {
      const q = new URLSearchParams(location.search);
      return !!((q.get('v') || '').trim()) || HAS_ADMIN_PARAM;
    }
    catch(e){ return false; }
  })();
  // ═══════ ANDROID APK (WebView wrapper) ═══════
  // isWrappedApp(): Android WebViews append "; wv)" to their User-Agent — a
  // tool-agnostic signal that works regardless of which no-code WebView-to-APK
  // service wraps this app. Once a specific tool is picked, check its docs for
  // a more reliable injected flag (most provide one, e.g. window.isNativeApp)
  // and OR it in here.
  function isWrappedApp(){
    try{
      if(/;\s*wv\)/i.test(navigator.userAgent)) return true;
      if(window.isNativeApp || window.ReactNativeWebView) return true;
    }catch(e){}
    return false;
  }
  // APK_MODE: each APK build's "start URL" (set in the wrapper tool's dashboard,
  // not in code) points at ?mode=admin or ?mode=customer — plain web/PWA use
  // never sets this and behaves exactly as before.
  const APK_MODE = (function(){
    try{
      const m = (new URLSearchParams(location.search).get('mode') || '').trim().toLowerCase();
      return (m === 'admin' || m === 'customer') ? m : '';
    }catch(e){ return ''; }
  })();
  // Dynamic config (admin editable, synced from backend)
  // ═══════ MEAL TYPES — dynamic, admin-configurable list (replaces the old fixed
  // breakfast/lunch/dinner/meal4 model) ═══════
  // Each entry: { key, title, emoji, price, capacity, windowStart, windowEnd (the
  // meal's serving/delivery window — also used to auto-generate time-slot options),
  // cutoff (order deadline, "HH:MM"), cutoffAheadDay (true = cutoff is the PREVIOUS
  // day, breakfast-style; false = same day as delivery), enabled, core (true for the
  // 3 built-in meals — can be disabled but never removed), hasVariants (false only
  // for breakfast — no sabzi/roti/addons, matches the pre-existing business rule).
  // "Add Meal" in Setup just pushes a new entry with a generated key (meal_<ts>) and
  // the same shape — no code change needed for a 4th/5th/Nth meal.
  function defaultMealTypes(){
    return [
      { key:'breakfast', title:'Breakfast', emoji:'🌅', price:80, capacity:0, windowStart:'07:00', windowEnd:'09:00', cutoff:'22:00', cutoffAheadDay:true,  enabled:true, core:true, hasVariants:false, maxQtyPerOrder:1 },
      { key:'lunch',      title:'Lunch',     emoji:'☀️', price:80, capacity:0, windowStart:'12:00', windowEnd:'14:00', cutoff:'09:00', cutoffAheadDay:false, enabled:true, core:true, hasVariants:true,  maxQtyPerOrder:1 },
      { key:'dinner',     title:'Dinner',    emoji:'🌙', price:80, capacity:0, windowStart:'19:00', windowEnd:'21:00', cutoff:'15:00', cutoffAheadDay:false, enabled:true, core:true, hasVariants:true,  maxQtyPerOrder:1 }
    ];
  }
  let CFG = {
    prices: { tiffinMini:60, extraRotiPlain:10, extraRotiButter:15, dahi:15, extraSabzi:20 },
    mealTypes: defaultMealTypes(),
    township: '',    // ⚠️ real config load hone tak sirf khaali — kabhi bhi Raj ka apna township nahi
    societies: [],   // ⚠️ same wajah
    companies: [],
    homeEnabled: true,
    officeEnabled: false,
    whatsappAuto: true,
    closedDates: [],
    // Ye placeholder CFG hai — asli data aane tak sirf yehi dikhta hai. Pehle isme
    // tempClosed jaise fields MISSING the (backend ka defaultConfig() se match nahi
    // karta tha) — defensive fallbacks crash se bachate hain, par field yahan bhi
    // rakhna zyada sahi/consistent hai.
    tempClosed: false, tempClosedMsg: '',
    deliveryEnabled: true,
    deliveryNear: 10,
    deliveryFar: 20,
    farSocieties: [],
    upiId: '',
    upiName: '',
    fssai: '',
    variants: {},
    promos: [],
    banners: {}
  };
  function variantsFor(m){ return (CFG.variants&&CFG.variants[m]&&CFG.variants[m].length)?CFG.variants[m]:defaultVariantsFE()[m]; }
  function findVariant(m,id){ const vs=variantsFor(m); return vs.find(v=>v.id===id)||vs[0]; }
  let MENU = {
    monday:    { breakfast:['🍚 Poha','🫓 Paratha (2)','🥣 Curd','🍵 Chai'], lunch:{sabziOptions:['Paneer Butter Masala','Dal Tadka','Mix Veg'],fixedItems:['🍚 Jeera Rice','🫓 Roti (4)','🥗 Salad','🥣 Dal Fry']}, dinner:{sabziOptions:['Aloo Gobi','Rajma Masala','Chole'],fixedItems:['🍚 Steam Rice','🫓 Roti (4)','🥒 Raita','🥗 Salad']} },
    tuesday:   { breakfast:['🥣 Upma','🫓 Paratha (2)','🍯 Chutney','🍵 Chai'], lunch:{sabziOptions:['Dal Makhani','Shahi Paneer','Mix Veg'],fixedItems:['🍚 Peas Pulao','🫓 Roti (4)','🥗 Salad','🧈 Papad']}, dinner:{sabziOptions:['Rajma Masala','Aloo Matar','Paneer Tikka Masala'],fixedItems:['🍚 Rice','🫓 Roti (4)','🥗 Onion Salad','🍋 Lemon']} },
    wednesday: { breakfast:['🍘 Idli (2)','🥣 Sambar','🌶️ Chutney','🍵 Chai'], lunch:{sabziOptions:['Mix Veg','Paneer Butter Masala','Dal Fry'],fixedItems:['🍚 Veg Biryani','🫓 Roti (4)','🥗 Salad','🥣 Dal']}, dinner:{sabziOptions:['Chole','Aloo Gobi','Rajma Masala'],fixedItems:['🍚 Rice','🫓 Roti (2)','🥒 Raita','🥗 Salad']} },
    thursday:  { breakfast:['🫓 Aloo Paratha','🥣 Curd','🍯 Pickle','🍵 Chai'], lunch:{sabziOptions:['Aloo Gobi','Paneer Tikka Masala','Dal Tadka'],fixedItems:['🍚 Jeera Rice','🫓 Roti (4)','🥗 Salad','🥣 Dal Tadka']}, dinner:{sabziOptions:['Paneer Tikka Masala','Mix Veg','Dal Fry'],fixedItems:['🍚 Steam Rice','🫓 Roti (4)','🥗 Green Salad','🥒 Raita']} },
    friday:    { breakfast:['🍚 Sabudana Khichdi','🫓 Paratha (2)','🥣 Curd','🍵 Chai'], lunch:{sabziOptions:['Rajma Masala','Shahi Paneer','Mix Veg'],fixedItems:['🍚 Rice','🫓 Roti (4)','🥗 Salad','🧈 Papad']}, dinner:{sabziOptions:['Dal Makhani','Aloo Matar','Chole'],fixedItems:['🍚 Peas Pulao','🫓 Roti (4)','🥒 Raita','🥗 Salad']} },
    saturday:  { breakfast:['🥣 Dosa','🥣 Sambar','🌶️ Chutney','🍵 Chai'], lunch:{sabziOptions:['Chole','Paneer Butter Masala','Dal Tadka'],fixedItems:['🍚 Rice','🫓 Roti (2)','🥗 Salad','🥒 Raita']}, dinner:{sabziOptions:['Paneer Butter Masala','Rajma Masala','Mix Veg'],fixedItems:['🍚 Veg Biryani','🫓 Roti (2)','🥒 Raita','🥗 Salad']} },
    sunday:    { breakfast:['🫓 Paneer Paratha','🥣 Curd','🍯 Pickle','🍵 Chai'], lunch:{sabziOptions:['Dal Makhani','Shahi Paneer','Chole'],fixedItems:['🍚 Veg Pulao','🫓 Naan (2)','🥗 Salad','🍮 Gulab Jamun (1)']}, dinner:{sabziOptions:['Rajma Masala','Paneer Tikka Masala','Aloo Gobi'],fixedItems:['🍚 Steam Rice','🫓 Roti (4)','🥗 Onion Salad','🥒 Raita']} }
  };
  // ═══════ i18n ═══════
  const LANGS = { en:'English', hinglish:'Hinglish', hi:'हिन्दी', gu:'ગુજરાતી' };
  const T = {
    en: {
      loadingEllipsis:'Loading…', signingIn:'Signing in…', waitingInBrowser:'Waiting for sign-in in your browser…', shareKitchen:'Share this Kitchen', shareKitchenTitle:'Share this Kitchen', shareKitchenSub:'Send this link to friends, or let them scan the QR', shareKitchenBtn:'📤 Share', installAppRow:'Install App', installAppTitle:'Install App', installAppSub:'Add to your home screen for one-tap ordering — no browser needed.', installAppIosTitle:'Install on iPhone/iPad', installAppIosSteps:'Tap the Share icon below, then choose "Add to Home Screen".', installAppBtn:'📲 Install', installAppInstalled:'✅ App installed!', allKitchensBack:'‹ All Kitchens', demoModeTitle:'🎬 Demo Mode', demoModeDesc:'No signup needed — jump in with one tap and see the full customer experience.', demoLoginBtn2:'🚀 Demo Login', demoLoggingIn:'⏳ Taking you in…', dscTagline:'Fresh home-style meals near you', dscYourArea:'Your Area', dscTryLocation:'Try location again — see kitchens near you', dscLocBlockedToast:'Location is blocked for this site. Tap the 🔒/ⓘ icon next to the address bar → Permissions → Location → Allow, then try again.', orDivider:'or', loginWithOtp:'Login with Mobile OTP', sendOtpBtn:'Send OTP', sendingOtp:'Sending…', otpSentTo:'OTP sent to {phone}', verifying:'Verifying…', resendOtp:'Resend OTP', resendOtpIn:'Resend OTP in {s}s', changeNumber:'Change number', otpInvalid:'Please enter the 6-digit OTP', srv_bad_phone:'Please enter a valid 10-digit mobile number.', srv_otp_too_many_sends:'Too many OTP requests. Please try again after some time.', srv_otp_expired:'OTP expired or not requested. Please request a new one.', srv_otp_too_many_attempts:'Too many wrong attempts. Please request a new OTP.', srv_otp_wrong:'Incorrect OTP. Please try again.', srv_busy:'Server is busy right now — please try again.', srv_bad_name:'Please enter your name.', dscAvailableKitchens:'Available kitchens', dscSearchingNear:'Searching kitchens near you…', dscNoNearby:'No kitchens found within your delivery radius yet', browseKitchens:'Browse Kitchens', themeLabel:'🎨 Theme', themeSystem:'📱 System Default', themeLight:'☀️ Light', themeDark:'🌙 Dark', ratingTapStars:'Tap to choose stars', ratingCommentPh:'Want to say something? (optional)', ratingSubmitBtn:'Submit Rating', ratingNotNow:'Not Now', demoGlobalBanner:'🎬 DEMO — feel free to try anything, data resets every night', dscLoaderTitle:'Finding kitchens near you…', dscLoaderSub:'Fresh home-style meals, loading up', couldNotLoadOrders:'Could not load orders.', networkErrorShort:'Network error.', retryBtn:'🔄 Retry', lblVariant:'Variant', lblSabzi:'Sabzi', lblRoti:'Roti', topRatedBadge:'★ TOP RATED', newBadge:'🆕 NEW', newTag:'New', noReviewsYet:'No reviews yet', couponNotApplied:'Coupon not applied', amountChargedLbl:'Amount charged:', legalNameLbl:'Legal Name', gstNumberLbl:'GST Number', fssaiLbl:'FSSAI Lic No', menuLoadFailed:'Could not load the menu', totalLbl:'Total', ordersPlacedOne:'Your order has been placed successfully.', ordersPlacedMany:'Your {n} orders have been placed successfully.', ordersDupSuffix:' {n} date(s) already had an order.',
      errNetwork:'❌ Network error. Please check your connection and try again.', sessionExpired:'⚠️ Your session has expired — please sign in again.', completeFields:'⚠️ Please complete all required fields.', orderFailed:'❌ Your order could not be placed. Please try again.', selectDate:'⚠️ Please select a date first.', orderCancelled:'✅ Your order has been cancelled.', resetLinkBad:'❌ This reset link is invalid or has expired.', confirmCancel:'Cancel this order?', welcomeUser:'🎉 Welcome,', errLogin:'Please sign in to continue.',
      tagline:'Fresh • Home-Style • Home & Office Delivery', secureLogin:'🔐 Secure Login', signInTitle:'Welcome Back', emailLabel:'Email', passwordLabel:'Password', passwordPh:'Apna password daalein', passwordPh6:'Kam se kam 6 characters', confirmPwLabel:'Password Confirm Karein', confirmPwPh:'Password dobara daalein', errEmail:'Valid email address daalein.', errPassword:'Apna password daalein.', errPassword6:'Password kam se kam 6 characters ka ho.', errConfirmPw:'Password match nahi ho raha.', forgotPw:'Password Bhool Gaye?', signInBtn:'Sign In', signUpTitle:'Account Banayein', signUpSub:'Roz ka tiffin order karne ke liye sign up karein.', phoneDeliveryHint:'Delivery contact ke liye use hoga.', createAccountBtn:'Account Banayein', switchToSignUp:'Account nahi hai? <b onclick="showAuthMode(\'signup\')">Sign Up</b>', switchToSignIn:'Pehle se account hai? <b onclick="showAuthMode(\'signin\')">Sign In</b>', backToSignIn:'← Sign In par wapas', forgotTitle:'Password Reset Karein', forgotSub:'Apna email daalein, hum reset link bhej denge.', sendResetBtn:'Reset Link Bhejein', resetTitle:'Naya Password Set Karein', resetSub:'Apne account ke liye naya password chunein.', newPasswordLabel:'Naya Password', resetBtn:'Password Reset Karein', orDivider:'ya', resetLinkSent:'Agar ye email registered hai, reset link bhej diya gaya hai.', passwordResetDone:'Password update ho gaya — ab sign in kar sakte hain.', signInTitle:'Welcome Back', emailLabel:'Email', passwordLabel:'Password', passwordPh:'Enter your password', passwordPh6:'At least 6 characters', confirmPwLabel:'Confirm Password', confirmPwPh:'Re-enter your password', errEmail:'Please enter a valid email address.', errPassword:'Please enter your password.', errPassword6:'Password must be at least 6 characters.', errConfirmPw:'Passwords do not match.', forgotPw:'Forgot Password?', signInBtn:'Sign In', signUpTitle:'Create an Account', signUpSub:'Sign up to start ordering your daily tiffin.', phoneDeliveryHint:'Used for delivery contact.', createAccountBtn:'Create Account', switchToSignUp:'Don\'t have an account? <b onclick="showAuthMode(\'signup\')">Sign Up</b>', switchToSignIn:'Already have an account? <b onclick="showAuthMode(\'signin\')">Sign In</b>', backToSignIn:'← Back to Sign In', forgotTitle:'Reset Password', forgotSub:'Enter your email and we will send you a reset link.', sendResetBtn:'Send Reset Link', resetTitle:'Set New Password', resetSub:'Choose a new password for your account.', newPasswordLabel:'New Password', resetBtn:'Reset Password', orDivider:'or', resetLinkSent:'If that email is registered, a reset link has been sent.', passwordResetDone:'Password updated — you can sign in now.',
      loginTitle:'Login or Sign Up', mobileLabel:'Mobile Number', mobilePh:'Enter 10-digit mobile number',
      continueBtn2:'Continue', loginHint:'Choose from your Google accounts.', phoneFirstHint:'Needed only the first time — for delivery contact.', completeSignup:'✓ Complete Sign Up',
      verifyTitle:'One Last Step', googleWelcome:'✅ Signed in with Google. Add your mobile number for delivery contact.', nameLabel:'Your Name', namePh:'Enter your full name',
      otpLabel:'Enter Verification Code', verifyBtn:'Verify & Continue', changeNum:'Use a different Google account', errName:'Please enter a valid name (letters only).', errPhone:'Please enter a valid 10-digit mobile number.', errPickGoogle:'Please tap the Google button to pick an account first.',
      badgeFresh:'🌿 No Frozen Food', badgeCustom:'🍳 Customizable', badgeCOD:'💵 Cash on Delivery',
      freshStrip:'🌿 Freshly Prepared: Your meal is cooked only after you order — never frozen, never stale.',
      deliveryDate:'📅 Delivery Date',
      cutoffNote:'🕒 Order Cut-off Times (IST)\n• Breakfast — order by 10:00 PM the night before\n• Lunch — order by 9:00 AM same day\n• Dinner — order by 3:00 PM same day\nAfter cut-off, order for the next available day.',
      selectMeals:'🍽️ Select Your Meals', yourCart:'Your Cart', clearCart:'Clear', cartEmpty:'Your cart is empty. Add meals above to get started.',
      myOrders:'My Orders', refresh:'🔄 Refresh', viewPast:'🗓️ Select delivery date', view:'View',
      cartTotal:'CART TOTAL', checkout:'Checkout →', viewCart:'View Cart →', continueLbl:'Continue', okBtn:'Okay', rateKitchen:'Rate this kitchen', orSignInWith:'or sign in with', signInWithGoogle:'Sign in with Google', itemAdded:'item added', itemsAdded:'items added', logout:'Logout',
      checkoutTitle:'📦 Delivery Details', checkoutSub:'Final step — confirm your order', backMenu:'← Back to Menu',
      autofillNote:'✓ Your saved address has been auto-filled', township:'🏢 Township', society:'🏘️ Society', flat:'🏠 Flat Number',
      fullName:'👤 Full Name', verifiedMobile:'📱 Mobile Number (verified ✓)', payMethod:'💰 Payment Method',
      payCOD:'💵 Cash on Delivery', payCODsub:'Pay cash when you receive your tiffin', payUPI:'💳 Pay Online (UPI)', payUPIsub:'QR code appears right after you place the order', codNote:'Cash on Delivery — please pay when your tiffin arrives.',
      errSociety:'Please select your society.', errFlat:'Please enter your block and flat number, e.g. D-706.',
      placeOrder:'📤 Place Order', successTitle:'Order Confirmed', promoHave:'Have a coupon? Enter code', promoApply:'Apply', promoApplied:'applied', discountLbl:'Discount', promoFirstDateNote:'(applies to the first delivery date)', promoEditNote:'Discounted orders cannot be edited — please cancel and place a new order.', promoUseAtCheckout:'Tap a code in your cart to apply', promoNewTag:'new customers', policyTitle:'Cancellation & Refund Policy', abDeliveryOnly:'This is a delivery-only kitchen', abBackToMenu:'Go back to menu', abOpenNow:'Open now', abCloses:'Closes', abClosedNow:'Closed now', abOpensAt:'Opens', policyBody:'• Orders can be cancelled until 10:00 PM on the night before delivery. Orders placed after this window can be cancelled within 30 minutes of placing them. Orders cannot be edited — please cancel and place a fresh order instead.<br>• If you paid online via UPI and your order is cancelled — by you within the allowed window, or by us for any reason — the full amount is refunded to the same UPI account within 24 hours.<br>• Orders placed with a discount coupon cannot be edited; please cancel and place a fresh order instead.<br>• Any issue with your meal? WhatsApp us a photo within 2 hours of delivery — we will arrange a replacement or a full refund.<br>• Support: 📞 +91 70434 91481 (WhatsApp available).', waFallback:'Share order details on WhatsApp (optional) →', newOrder:'Place Another Order', trackOrderBtn:'Track Your Order', okayBtn:'Okay', successConfirmNote:'Your order has been confirmed. You can view and track it anytime in the My Orders section.',
      addToCart:'🛒 Add to Cart', addedShort:'added to cart', addToCart2:'ADD', payNowUpi:'PAY ONLINE', payRefLbl:'Payment reference', srv_dup_date:'You already have an order for this date.', srv_qty_limit:'You can order 1 tiffin per meal per day. For larger quantities, please contact the kitchen.', srv_cancel_window:'The cancellation window for this order has closed.', srv_already_cancelled:'This order is already cancelled.', srv_cancel_delivered:'A delivered order cannot be cancelled.', srv_not_yours:'This order does not belong to your account.', srv_no_meal:'Your order is empty — please select at least one meal.', srv_office_off:'Office delivery is not available right now.', srv_home_off:'Home delivery is not available right now.', srv_company_req:'Please select your company from the list.', srv_empid_req:'Employee ID is required.', srv_blocked:'Your account is blocked. Support: 70434 91481', srv_wrong_pw:'Incorrect password.', srv_no_account:'No account found with this email.', srv_email_exists:'An account with this email already exists — please sign in.', srv_phone_taken:'This mobile number is already linked to another account.', srv_use_google:'This account uses Google Sign-In — please use "Sign in with Google".', srv_reset_sent:'If this email is registered, a reset link has been sent.', srv_reset_bad:'This reset link is invalid or has expired.', srv_reset_expired:'This reset link has expired — please request a new one.', scanToPay:'Scan the QR with any UPI app', copyId:'COPY', pleaseWait:'Please wait…', cancelWindowOver:'The cancellation window for this order has closed. For any help, please contact the kitchen.', limitTitle:'One Tiffin Per Meal', limitBody:'Each customer can order 1 breakfast, 1 lunch and 1 dinner per day. For a larger quantity, please connect with our kitchen — we will be happy to arrange it.', limitCta:'Connect to Kitchen', limitClose:'Got it', subtotalLbl:'Subtotal', deliveryLbl:'Delivery', infoStripText:'Order timings — Breakfast: by 10 PM previous night · Lunch: by 9 AM · Dinner: by 3 PM', subPushLine:'Order daily? Set up a subscription', qaTitle:'Help', qaOnline:'● Online', qaPh:'Type your question…', qaGreet:'Namaste! 🙏 Ask me about the menu, prices or delivery timings.', qaSug1:'Today\'s menu', qaSug2:'Delivery time', qaSug3:'Where do you deliver?', qaOffTopic:'Sorry, I can only help with questions about this kitchen food 🍱 Ask me about the menu, prices, delivery or your order!', qaLimit:'You have used your 10 questions for today 🙏 Please try again tomorrow — or call us directly for help.', qaErr:'Could not reach the assistant. Please try again, or call us for help.', reorderBtn:'Reorder', alreadyOrderedT:'You have already ordered {meal} for this date.', alreadyOrderedBtn:'View my order', reorderDone:'Items added to your cart', reorderNoSlot:'These meals are not available in the next 3 days', lpTagline:'Fresh, home-style meals — cooked daily, delivered to home & office.', lpOrderNow:'Order Now', priceFrom:'Meals from ₹{p}', lpTodays:'Today&#39;s Meals', lpOpen:'Open', lpClosed:'Closed', lpWhy:'Why this kitchen', lpU1t:'Fresh Daily Batches', lpU1s:'Cooked in small batches every day — never stored or frozen.', lpU2t:'Home-Style Ingredients', lpU2s:'Freshly ground masalas — no packet mixes, no shortcuts.', lpU3t:'Safe, Hygienic Packaging', lpU3s:'Certified food-grade containers for every single meal.', lpSubT:'Daily Tiffin Subscription', lpSubS:'Set once — your tiffin arrives every day automatically.', lpHow:'How It Works', lpH1:'Pick your meal & customise it', lpH2:'Choose delivery date & time slot', lpH3:'Pay online or at delivery', pubLogin:'Login', pubBack:'← Back', dtypeQ:'Where should we deliver?', modeTitle:'Where would you like your tiffin?', modeSub:'Choose once — you can change it any time.', modeChange:'Change', dtHome:'Home', dtHomeSub:'Society / Flat', dtOffice:'Office', dtOfficeSub:'Company / Employee', companyLbl:'Select Your Company', companyHint:'Company not listed? Contact the kitchen — we will add it.', empIdLbl:'Employee ID', errCompany:'Please select your company', errEmpId:'Please enter your Employee ID', pubCta:'See Menu & Order', pubCutoffLine:'Lunch closes at <b>9:00 AM</b> · Dinner at <b>3:00 PM</b>', pubHookQ:'Can healthy food really be cooked in <em>20 minutes</em>?', pubHookA:'It can\'t. Food that fast was <b>cooked long before you ordered</b> — reheated, and rushed.', cmpUs:'Our Kitchen', cmpThem:'Delivery Apps', cmpU1:'Freshly ground masala', cmpT1:'Bulk packet masala', cmpU2:'Fresh oil, every day', cmpT2:'Oil reused all day', cmpU3:'Limited orders daily', cmpT3:'Unlimited, mass-cooked', cmpU4:'Same cook, same taste', cmpT4:'A new kitchen each time', cmpU5:'Fixed price, no extras', cmpT5:'Surge + platform fees', cmpU6:'Light, everyday food', cmpT6:'Heavy restaurant food', cmpU7:'A kitchen you can visit', cmpT7:'A kitchen you\'ll never see', cmpQualT:'Quality, not quantity.', cmpQualS:'We cap how many tiffins we cook each day — so every one gets the time it deserves.', cmpChip:'🍱 Limited orders daily — always fresh', lpPosT:'This Is Not a Quick-Delivery App', lpPosS:'It is your everyday kitchen — planned, fresh and always on time.', lpPos1:'Delivery in fixed time slots — no 10-minute race, no rush.', lpPos2:'Light, nourishing home-style food — not heavy restaurant fare.', lpPos3:'Simple fixed prices — no surge, no hidden or platform charges.', lpPos4:'One trusted kitchen every day — the same care in every tiffin.', navMenuShort:'Menu', navProfileShort:'Profile', pfTitle:'My Profile', pfAddr:'Saved Delivery Address', pfFlatLbl:'Flat / Block No.', pfSave:'Save Address', addrSaved:'Address saved', pfQuick:'Quick Links', pfLang:'Language', payWithUpiBtn:'Pay Now', orScan:'or scan the QR code', upiPayNote:'🔒 Secure payment via UPI. Amount is pre-filled — just approve in your UPI app.', copied:'UPI ID copied', updateCart:'✓ Update in Cart', addedToCart:'added to cart', customizable:'customizable', customizeBtn:'Customize', chooseSize:'Choose Size', sizeRequired:'Required · Select any 1 option', addOns:'Add-ons', dahiShort:'Dahi', extraSabziShort:'Extra Sabzi', freshCookedDesc:'Prepared fresh in small daily batches — never stored, never frozen.', selectSabzi:'Select sabzi', rotiType:'Roti type', plain:'Plain', butter:'Butter', deliveryTime:'⏰ Delivery Time', tiffinType:'🍱 Choose Your Tiffin', miniTiffin:'Mini Tiffin', fullTiffin:'Full Tiffin',
      extraRoti:'Extra Roti', addDahi:'Add Curd', extraSabzi:'Extra Sabzi portion', howMany:'How many tiffins?', unitPrice:'Unit price',
      perTiffin:'/ tiffin', specialInstr:'📝 Special instructions (optional)', notePh:'e.g. Less spicy, no onion...',
      backApp:'← Back to App', remove:'Remove', cancelOrder:'✖ Cancel', editOrder:'Edit', editLoaded:'Order loaded — make changes & checkout',
      closedBreakfast:'Same-day breakfast is not available — please order a day in advance.', kitchenClosedMsg:'Kitchen is closed on this date — please choose another day.', kitchenTempClosedTitle:'Kitchen Temporarily Closed', kitchenTempClosedMsg:"We're temporarily closed. We'll be back shortly — thank you for your patience!", happyCustomers:'Happy Customers Served', orderedForThisMeal:'tiffins ordered so far', beingPrepared:'being prepared right now', onlyLeftToday:'Only {n} remaining for today', soldOutToday:'Sold out for today', soldOutTitle:"We're Sold Out for This Meal", soldOutSub:'To keep every tiffin fresh, we only cook a limited batch. Please try another meal or day.',
      closedLunch:'Today\'s lunch booking is closed (was open till 9:00 AM).',
      closedDinner:'Today\'s dinner booking is closed (was open till 3:00 PM).', closedBkTom:'Tomorrow\'s breakfast booking is closed (was open till 10:00 PM last night).',
      closedTomorrow:'Tomorrow\'s booking is closed (was open till 10:00 PM).',
      cancelClosed:'Cancellation window has been closed.',
      dupMsg:'An order already exists for this date. To make changes, please contact Store Support at 70434 91481.',
      noUpcoming:'No upcoming orders yet. Add meals from the menu to place your first order.', noHistory:'No orders found for this date.', navHome:'Home', navCart:'Cart', navPast:'Past Orders', navAbout:'About Us', navSub:'Subscription', navHomeShort:'Home', navCartShort:'Cart', navSubShort:'Subscribe', navAiShort:'Ask AI', navOrdersShort:'Orders', navHomeShort:'Home', navCartShort:'Cart', navSubShort:'Subscribe', navOrdersShort:'Orders', navBulkShort:'Bulk', schedTitle:'📅 Schedule Your Meal', schedSub:'Which day do you want to order for?', schedOrderingFor:'Ordering for', schedBackToday:'Back to Today', schedDayLbl:'Day', schedMealLbl:'Meal', schedContinue:'Continue to Menu', exitConfirmTitle:'Exit App?', exitConfirmSub:'You\'ll be logged out.', exitConfirmBtn:'Exit', exitConfirmSubGuest:'Are you sure you want to exit?',
      bulkOrderRow:'Bulk / Party Order', bulkMyRequests:'My Bulk Requests', bulkTitle:'🎉 Bulk / Party Order',
      bulkSub:'Ordering for a group or event? Tell us the details — the kitchen will confirm availability & price.',
      bulkMealLbl:'Meal', bulkQtyLbl:'Quantity (min 5)', bulkDateLbl:'Delivery date', bulkAddrLbl:'Delivery address',
      bulkAddrPh:'Office / event address', bulkNotesLbl:'Notes (optional)', bulkNotesPh:'Veg only, no onion, etc.',
      bulkSubmit:'Submit Bulk Request', limitBulkCta:'🎉 Place a Bulk Order',
      bulkErrQty:'Please enter at least 5 tiffins.', bulkErrDate:'Please pick a delivery date.',
      bulkSubmitted:'Request sent — the kitchen will confirm shortly.', bulkApproved:'Approved', bulkDeclined:'Declined', bulkPending:'Pending',
      bulkRecentTitle:'Recent Bulk Orders', bulkColItem:'Item', bulkColDate:'Date', bulkColStatus:'Status', bulkNoHistory:'No bulk orders yet.',
      scheduleBtn:'Schedule', onbSkip:'Skip', onb1Title:'Fresh Tiffin, Daily', onb1Body:'Cooked only after you order — never frozen, never stale.', onb2Title:'Home & Office Delivery', onb2Body:'Order for wherever you are — home or work.', onb3Title:'Order Today or Schedule Ahead', onb3Body:"Need tomorrow sorted? Use Schedule Your Meal from the bottom menu.", onb4Title:'Easy Payments', onb4Body:'Pay via UPI or simply Cash on Delivery — your choice.', onbGetStarted:'Get Started', subTitle:'🔁 Subscription', subSub:'Ek baar set karein — aapka daily tiffin apne aap order ho jayega.', subActive:'Active Plan', subDaysWeek:'din/hafta', subSkipped:'Skip kiye', subSkipBtn:'Din skip karein', subCancelBtn:'Plan Cancel', subEditNote:'Neeche edit karke Update dabayein', subPickMeals:'Meals chunein', subPickDays:'Din chunein', subWeekdays:'Som–Shukra', subAllDays:'Saaton din', subClear:'Clear', subWeekdaysSub:'Som-Shukra, saare meals', subAllDaysSub:'Har din, saare meals', subClearSub:'Nayi shuruaat', subMealsPerWeek:'meals/hafta schedule hue', subDateRange:'Date range', subStart:'Shuru', subEnd:'Khatam', subDelivery:'Delivery', subUpdate:'Plan Update', subStart2:'Subscription Shuru', subAnySabzi:'Chef\'s choice', subSaved:'Subscription successfully save ho gaya.', subCancelled:'Subscription cancel ho gaya', subCancelConfirm:'Subscription cancel karein?', subSkipDone:'Din skip ho gaya', subUnskipDone:'Skip hata diya', subPickSkipDate:'Skip ke liye date chunein', subEndAfter:'End date start ke baad honi chahiye', subStartInfo:'Kal se aage', navSub:'Subscription', subTitle:'🔁 Subscription', subSub:'Set it once — your daily tiffin is placed automatically.', subActive:'Active Plan', subDaysWeek:'days/week', subWeekdaysSub:'Mon–Fri, all picked meals', subAllDaysSub:'Every day, all picked meals', subClearSub:'Start fresh', subMealsPerWeek:'meals scheduled per week', subSkipped:'Skipped', subSkipBtn:'Skip a day', subCancelBtn:'Cancel Plan', subEditNote:'Edit below & Update to change your plan', subPickMeals:'Pick meals', subPickDays:'Pick days', subWeekdays:'Mon–Fri', subAllDays:'All 7', subClear:'Clear', subDateRange:'Date range', subStart:'Start', subEnd:'End', subDelivery:'Delivery', subUpdate:'Update Plan', subStart2:'Start Subscription', subAnySabzi:'Chef\'s choice', subSaved:'Subscription saved successfully.', subCancelled:'Subscription cancelled', subCancelConfirm:'Cancel your subscription?', subSkipDone:'Day skipped', subUnskipDone:'Skip removed', subPickSkipDate:'Pick a date to skip', subEndAfter:'End date must be after start', subStartInfo:'From tomorrow onwards', navContact:'Contact Karein', contactTitle:'📞 Contact Karein', contactSub:'Aapki baat sunna hamesha achha lagta hai', contactInfoTitle:'ℹ️ Jaankari', contactAddrLbl:'Location', contactAreaLbl:'Delivery Area', contactHoursLbl:'Delivery Time', navContact:'Contact Us', contactTitle:'📞 Contact Us', contactSub:'We would love to hear from you', contactInfoTitle:'ℹ️ Info', contactAddrLbl:'Location', contactAreaLbl:'Delivery Area', contactHoursLbl:'Delivery Hours',
      aboutTitle:'ℹ️ About Us', aboutSub:'Why our tiffin is different', aboutSwipe:'← Swipe to see more →',
      aboutContact:'📞 Questions? We\'re just a call away.', locGateTitle:"Location Required", locGateSub:"We need your location to show nearby kitchens — the app won't work without it.", locGateBtn:"📍 Enable Location", locGateDeniedSub:"Location is blocked for this site. Tap the 🔒/ⓘ icon next to the address bar → Permissions → Location → Allow, then tap Retry.", locGateUnavailSub:"Permission is fine, but your phone's Location/GPS is turned off. Turn it on in your phone settings, then tap Retry.", locGateChecking:"⏳ Checking…", locGateRetryBtn:"🔄 Retry"
    },
    hinglish: {
      loadingEllipsis:'Loading…', signingIn:'Sign in ho raha hai…', waitingInBrowser:'Aapke browser me sign-in ka wait ho raha hai…', shareKitchen:'Share this Kitchen', shareKitchenTitle:'Share this Kitchen', shareKitchenSub:'Dosto ko ye link bhejo ya QR scan karwao', shareKitchenBtn:'📤 Share Karo', installAppRow:'App Install Karo', installAppTitle:'App Install Karo', installAppSub:'Home screen par add karo — ek tap me order karo, browser ki zaroorat nahi.', installAppIosTitle:'iPhone/iPad par Install karein', installAppIosSteps:'Neeche Share icon par tap karo, phir "Add to Home Screen" chuno.', installAppBtn:'📲 Install Karo', installAppInstalled:'✅ App install ho gayi!', allKitchensBack:'‹ All Kitchens', demoModeTitle:'🎬 Demo Mode', demoModeDesc:'Signup ki zaroorat nahi — ek tap me andar aa jaao aur poora customer experience dekho.', demoLoginBtn2:'🚀 Demo Customer se Login', demoLoggingIn:'⏳ Andar le ja rahe hain…', dscTagline:'Fresh home-style meals near you', dscYourArea:'Your Area', dscTryLocation:'Location dobara try karo — apne paas ki kitchens dekho', dscLocBlockedToast:'Is site ke liye location block hai. Address bar ke paas 🔒/ⓘ icon pe tap karo → Permissions → Location → Allow, phir dobara try karo.', orDivider:'ya', loginWithOtp:'Mobile OTP se Login Karein', sendOtpBtn:'OTP Bhejein', sendingOtp:'Bhej rahe hain…', otpSentTo:'OTP {phone} par bhej diya gaya hai', verifying:'Verify ho raha hai…', resendOtp:'OTP Dobara Bhejein', resendOtpIn:'{s}s me dobara bhejein', changeNumber:'Number badlein', otpInvalid:'6-digit OTP daalein', srv_bad_phone:'Sahi 10-digit mobile number daalein.', srv_otp_too_many_sends:'Bahut zyada OTP requests. Thodi der baad try karein.', srv_otp_expired:'OTP expire ho gaya ya maanga hi nahi gaya. Naya OTP mangwao.', srv_otp_too_many_attempts:'Bahut zyada galat try. Naya OTP mangwao.', srv_otp_wrong:'Galat OTP. Dobara try karein.', srv_busy:'Server abhi busy hai — thodi der baad try karein.', srv_bad_name:'Apna naam daalein.', dscAvailableKitchens:'Available kitchens', dscSearchingNear:'Aapke paas kitchens dhoondi ja rahi hain…', dscNoNearby:'Aapke delivery radius me abhi koi kitchen nahi mili', browseKitchens:'Browse Kitchens', themeLabel:'🎨 Theme', themeSystem:'📱 System Default', themeLight:'☀️ Light', themeDark:'🌙 Dark', ratingTapStars:'Tap karke stars chuniye', ratingCommentPh:'Kuch likhna chahein? (optional)', ratingSubmitBtn:'Rating bhejein', ratingNotNow:'Abhi nahi', demoGlobalBanner:'🎬 DEMO — jo chahe kar sakte ho, data roz raat ko reset ho jaata hai', dscLoaderTitle:'Finding kitchens near you…', dscLoaderSub:'Fresh home-style meals, loading up', couldNotLoadOrders:'Orders load nahi ho paaye.', networkErrorShort:'Network error.', retryBtn:'🔄 Retry', lblVariant:'Variant', lblSabzi:'Sabzi', lblRoti:'Roti', topRatedBadge:'★ TOP RATED', newBadge:'🆕 NEW', newTag:'New', noReviewsYet:'Abhi koi review nahi', couponNotApplied:'Coupon apply nahi hua', amountChargedLbl:'Amount charged:', legalNameLbl:'Legal Name', gstNumberLbl:'GST Number', fssaiLbl:'FSSAI Lic No', menuLoadFailed:'Menu load nahi ho paaya', totalLbl:'Total', ordersPlacedOne:'Aapka order successfully place ho gaya hai.', ordersPlacedMany:'Aapke {n} order successfully place ho gaye hain.', ordersDupSuffix:' {n} date par pehle se order maujood tha.',
      errNetwork:'❌ Network error. Connection check karke dobara try karein.', sessionExpired:'⚠️ Session expire ho gaya — kripya dobara sign in karein.', completeFields:'⚠️ Kripya saari zaroori details bharein.', orderFailed:'❌ Order place nahi ho paya. Kripya dobara try karein.', selectDate:'⚠️ Pehle ek date chunein.', orderCancelled:'✅ Aapka order cancel ho gaya.', resetLinkBad:'❌ Ye reset link invalid ya expire ho chuka hai.', confirmCancel:'Ye order cancel karein?', welcomeUser:'🎉 Swagat hai,', errLogin:'Aage badhne ke liye sign in karein.',
      // ── Auth (sign in / sign up / password reset) ──
      signInTitle:'Wapas Aapka Swagat Hai', signInBtn:'Sign In', signUpTitle:'Naya Account Banayein', signUpSub:'Roz ka tiffin order karne ke liye sign up karein.',
      createAccountBtn:'Account Banayein', emailLabel:'Email', passwordLabel:'Password', passwordPh:'Apna password daalein', passwordPh6:'Kam se kam 6 characters',
      confirmPwLabel:'Password Confirm Karein', confirmPwPh:'Password dobara daalein', newPasswordLabel:'Naya Password',
      errEmail:'Kripya sahi email address daalein.', errPassword:'Kripya apna password daalein.', errPassword6:'Password kam se kam 6 characters ka hona chahiye.', errConfirmPw:'Dono password match nahi ho rahe.',
      orDivider:'ya', forgotPw:'Password bhool gaye?', forgotTitle:'Password Reset Karein', forgotSub:'Apna email daalein — hum reset link bhej denge.',
      sendResetBtn:'Reset Link Bhejein', resetLinkSent:'Agar ye email registered hai to reset link bhej diya gaya hai.',
      resetTitle:'Naya Password Set Karein', resetSub:'Apne account ke liye naya password chunein.', resetBtn:'Password Reset Karein', passwordResetDone:'Password update ho gaya — ab sign in kar sakte hain.',
      backToSignIn:'← Sign In par wapas', switchToSignIn:'Pehle se account hai? <b onclick="showAuthMode(\'signin\')">Sign In</b>', switchToSignUp:'Account nahi hai? <b onclick="showAuthMode(\'signup\')">Sign Up</b>',
      phoneDeliveryHint:'Delivery ke liye isi number par sampark karenge.',
      // ── Bottom nav ──
      navHomeShort:'Home', navCartShort:'Cart', navOrdersShort:'Orders', navSub:'Subscription', navSubShort:'Subscribe', navBulkShort:'Bulk', schedTitle:'📅 Meal Schedule Karo', schedSub:'Kis din ke liye order karna hai?', schedOrderingFor:'Order ho raha hai', schedBackToday:'Aaj pe wapas', schedDayLbl:'Din', schedMealLbl:'Meal', schedContinue:'Menu Par Jaayein', exitConfirmTitle:'App Band Karein?', exitConfirmSub:'Aap logout ho jayenge.', exitConfirmBtn:'Exit Karein', exitConfirmSubGuest:'Kya aap sach me exit karna chahte hain?',
      bulkOrderRow:'Bulk / Party Order', bulkMyRequests:'Mere Bulk Requests', bulkTitle:'🎉 Bulk / Party Order',
      bulkSub:'Group ya event ke liye order kar rahe ho? Details batao — kitchen availability aur price confirm karega.',
      bulkMealLbl:'Meal', bulkQtyLbl:'Quantity (min 5)', bulkDateLbl:'Delivery date', bulkAddrLbl:'Delivery address',
      bulkAddrPh:'Office / event ka address', bulkNotesLbl:'Notes (optional)', bulkNotesPh:'Jaise, sirf veg, bina pyaz...',
      bulkSubmit:'Bulk Request Bhejein', limitBulkCta:'🎉 Bulk Order Karein',
      bulkErrQty:'Kam se kam 5 tiffin daaliye.', bulkErrDate:'Delivery date chuniye.',
      bulkSubmitted:'Request bhej di gayi — kitchen jald confirm karega.', bulkApproved:'Approved', bulkDeclined:'Declined', bulkPending:'Pending', scheduleBtn:'Schedule', onbSkip:'Skip', onb1Title:'Fresh Tiffin, Roz', onb1Body:'Order karne ke baad hi banta hai — na frozen, na baasi.', onb2Title:'Home aur Office Delivery', onb2Body:'Jahan bhi ho — ghar ya office, order karo.', onb3Title:'Aaj Order Karo ya Schedule Karo', onb3Body:'Kal ka tiffin plan karna hai? Neeche "Schedule Your Meal" use karo.', onb4Title:'Aasan Payment', onb4Body:'UPI se pay karo ya seedha Cash on Delivery — jo pasand ho.', onbGetStarted:'Shuru Karein', navAiShort:'AI Help',       // ── Subscription ──
      subTitle:'🔁 Subscription', subActive:'Active Plan', subPickMeals:'Meals chunein', subPickDays:'Din chunein',
      subWeekdays:'Som–Shukra', subAllDays:'Saaton din', subClear:'Clear', subWeekdaysSub:'Som-Shukra, saare meals', subAllDaysSub:'Har din, saare meals', subClearSub:'Nayi shuruaat', subMealsPerWeek:'meals/hafta schedule hue', subAnySabzi:'Chef ki pasand',
      subStart:'Shuru', subEnd:'Khatam', subStart2:'Subscription Shuru Karein', subUpdate:'Plan Update Karein', subCancelBtn:'Plan Cancel Karein',
      subCancelConfirm:'Subscription cancel karein?', subCancelled:'Subscription cancel ho gaya', subSaved:'Subscription save ho gaya.',
      subSkipBtn:'Ek din skip karein', subPickSkipDate:'Skip karne ke liye date chunein', subSkipDone:'Din skip ho gaya', subUnskipDone:'Skip hata diya', subSkipped:'Skipped',
      subDateRange:'Date range', subDaysWeek:'din/hafta', subDelivery:'Delivery', subEditNote:'Neeche edit karke Update dabayein — plan badal jayega', subEndAfter:'End date, start ke baad honi chahiye', subStartInfo:'Kal se shuru',
      // ── Contact ──
      navContact:'Contact Karein', contactTitle:'📞 Contact Karein', contactSub:'Aapki baat sunna hamesha achha lagta hai',
      contactInfoTitle:'ℹ️ Jaankari', contactAddrLbl:'Location', contactAreaLbl:'Delivery Area', contactHoursLbl:'Delivery Time',
      tagline:'Fresh • Homemade • Doorstep Delivery', secureLogin:'🔐 Secure Login',
      loginTitle:'Login ya Sign Up', mobileLabel:'Mobile Number', mobilePh:'10-digit mobile number daalein',
      continueBtn2:'Aage Badhein', loginHint:'Apna Google account chunein.', phoneFirstHint:'Sirf pehli baar zaroori — delivery contact ke liye.', completeSignup:'✓ Sign Up Poora Karein',
      verifyTitle:'Ek Aakhri Step', googleWelcome:'✅ Google se sign in ho gaya. Delivery contact ke liye mobile number daalein.', nameLabel:'Aapka Naam', namePh:'Apna pura naam likhein',
      otpLabel:'Verification Code daalein', verifyBtn:'Verify & Continue', changeNum:'Doosra Google account use karein', errName:'Valid naam daalein (sirf letters).', errPhone:'Valid 10-digit mobile number daalein.', errPickGoogle:'Pehle Google button dabakar account chunein.',
      badgeFresh:'🌿 No Frozen Food', badgeCustom:'🍳 Customizable', badgeCOD:'💵 Cash on Delivery',
      freshStrip:'🌿 Bilkul Fresh: Aapka khana order ke baad hi banta hai — na frozen, na baasi.',
      deliveryDate:'📅 Delivery Date',
      cutoffNote:'🕒 Order Cut-off Time (IST)\n• Breakfast — ek raat pehle 10:00 PM tak\n• Lunch — usi din 9:00 AM tak\n• Dinner — usi din 3:00 PM tak\nCut-off ke baad agle available din ke liye order karein.',
      selectMeals:'🍽️ Apne Meals Chunein', yourCart:'Aapki Cart', clearCart:'Clear', cartEmpty:'Cart khali hai. Upar se meals add karein.',
      myOrders:'Mere Orders', refresh:'🔄 Refresh', viewPast:'🗓️ Delivery date chunein', view:'View',
      cartTotal:'CART TOTAL', checkout:'Checkout →', viewCart:'Cart Dekhein →', continueLbl:'Continue', okBtn:'Okay', rateKitchen:'Is kitchen ko rate karein', orSignInWith:'ya sign in karein', signInWithGoogle:'Google se Sign in', itemAdded:'item add hua', itemsAdded:'items add hue', logout:'Logout',
      checkoutTitle:'📦 Delivery Details', checkoutSub:'Last step — order confirm karein', backMenu:'← Menu par wapas',
      autofillNote:'✓ Aapka saved address auto-fill ho gaya', township:'🏢 Township', society:'🏘️ Society', flat:'🏠 Flat Number',
      fullName:'👤 Pura Naam', verifiedMobile:'📱 Mobile Number (verified ✓)', payMethod:'💰 Payment Method',
      payCOD:'💵 Cash on Delivery', payCODsub:'Tiffin milne par cash dein', payUPI:'💳 Pay Online (UPI)', payUPIsub:'Order place karte hi QR code milega', codNote:'Cash on Delivery — tiffin milne par payment karein.',
      errSociety:'Apni society select karein.', errFlat:'Apna block aur flat number daalein, e.g. D-706.',
      placeOrder:'📤 Place Order', successTitle:'Order Confirm Ho Gaya', promoHave:'Coupon code hai? Yahan daalein', promoApply:'Apply', promoApplied:'apply ho gaya', discountLbl:'Discount', promoFirstDateNote:'(pehli delivery date par lagta hai)', promoEditNote:'Discount wale orders edit nahi ho sakte — cancel karke naya order karein.', promoUseAtCheckout:'Cart me code par tap karke apply karein', promoNewTag:'naye customers', policyTitle:'Cancellation & Refund Policy', abDeliveryOnly:'Ye ek delivery-only kitchen hai', abBackToMenu:'Menu par wapas jaayein', abOpenNow:'Open now', abCloses:'Band hoga', abClosedNow:'Band hai', abOpensAt:'Khulega', policyBody:'• Order delivery se ek raat pehle 10:00 PM tak cancel ho sakta hai. Uske baad place kiye gaye orders, place karne ke 30 minute ke andar cancel ho sakte hain. Order edit nahi ho sakta — cancel karke naya order place karein.<br>• Agar aapne UPI se online payment kiya hai aur order cancel hota hai — chahe aapne allowed window me kiya ho ya humne kisi wajah se — poora amount 24 ghante ke andar usi UPI account me refund kar diya jaata hai.<br>• Coupon discount wale orders edit nahi ho sakte; kripya cancel karke naya order place karein.<br>• Khaane me koi bhi problem ho? Delivery ke 2 ghante ke andar photo ke saath WhatsApp karein — hum replacement ya poora refund arrange karenge.<br>• Support: 📞 +91 70434 91481 (WhatsApp par available).', subSub:'Ek baar set karein — aapka daily tiffin apne aap order ho jayega.', subSaved:'Subscription successfully save ho gaya.', waFallback:'Order details WhatsApp par share karein (optional) →', newOrder:'Naya Order Place Karein', trackOrderBtn:'Order Track Karein', okayBtn:'Okay', successConfirmNote:'Aapka order confirm ho chuka hai. Aap ise kabhi bhi My Orders section mein dekh aur track kar sakte hain.',
      addToCart:'🛒 Cart mein daalein', addedShort:'cart mein add hua', addToCart2:'ADD', payNowUpi:'ONLINE PAYMENT', payRefLbl:'Payment reference', srv_dup_date:'Is date ka order pehle se hai.', srv_qty_limit:'Ek din me har meal ka sirf 1 tiffin. Zyada ke liye kitchen se sampark karein.', srv_cancel_window:'Is order ka cancellation window band ho chuka hai.', srv_already_cancelled:'Ye order pehle se cancelled hai.', srv_cancel_delivered:'Delivered order cancel nahi ho sakta.', srv_not_yours:'Ye order aapke account ka nahi hai.', srv_no_meal:'Order khali hai — kam se kam ek meal chunein.', srv_office_off:'Office delivery abhi available nahi hai.', srv_home_off:'Home delivery abhi available nahi hai.', srv_company_req:'Kripya list me se apni company chunein.', srv_empid_req:'Employee ID zaroori hai.', srv_blocked:'Aapka account block hai. Support: 70434 91481', srv_wrong_pw:'Password galat hai.', srv_no_account:'Is email se koi account nahi mila.', srv_email_exists:'Is email se account pehle se hai — sign in karein.', srv_phone_taken:'Ye mobile number doosre account se juda hai.', srv_use_google:'Ye account Google Sign-In ka hai — "Sign in with Google" use karein.', srv_reset_sent:'Agar ye email registered hai, reset link bhej diya gaya hai.', srv_reset_bad:'Ye reset link invalid ya expire ho chuka hai.', srv_reset_expired:'Reset link expire ho gaya — naya request karein.', scanToPay:'Kisi bhi UPI app se QR scan karein', copyId:'COPY', pleaseWait:'Ek moment…', cancelWindowOver:'Is order ka cancellation window band ho chuka hai. Kisi bhi madad ke liye kitchen se sampark karein.', limitTitle:'Ek Meal Ka Ek Tiffin', limitBody:'Har customer ek din me 1 breakfast, 1 lunch aur 1 dinner order kar sakta hai. Zyada quantity ke liye kripya kitchen se sampark karein — hum khushi se arrange kar denge.', limitCta:'Kitchen Se Sampark Karein', limitClose:'Theek hai', subtotalLbl:'Subtotal', deliveryLbl:'Delivery', infoStripText:'Order timing — Breakfast: ek raat pehle 10 PM tak · Lunch: 9 AM tak · Dinner: 3 PM tak', subPushLine:'Roz order karte hain? Subscription set karein', qaTitle:'Help', qaOnline:'● Online', qaPh:'Sawaal likhiye…', qaGreet:'Namaste! 🙏 Menu, prices ya delivery timing — kuch bhi poochiye.', qaSug1:'Aaj ka menu', qaSug2:'Delivery time', qaSug3:'Kaha deliver karte ho?', qaOffTopic:'Sorry, main sirf is kitchen ke khaane se related sawaalon mein help kar sakti hoon 🍱 Menu, prices, delivery ya order ke baare mein poochiye!', qaLimit:'Aaj ke liye aapke 10 sawaal ho gaye 🙏 Kal phir se pooch sakte hain — ya turant help ke liye humein call kar lijiye.', qaErr:'Assistant se baat nahi ho paayi. Dobara try karein, ya humein call kar lijiye.', reorderBtn:'Reorder', alreadyOrderedT:'Is date ka {meal} aap already order kar chuke hain.', alreadyOrderedBtn:'Mera order dekhein', reorderDone:'Items aapke cart mein add ho gaye', reorderNoSlot:'Ye meals agle 3 din available nahi hain', lpTagline:'Roz taaza, ghar jaisa khana — seedha aapke doorstep tak.', lpOrderNow:'Order Karein', priceFrom:'₹{p} se meals', lpTodays:'Aaj ke Meals', lpOpen:'Open', lpClosed:'Band', lpWhy:'is kitchen Hi Kyun', lpU1t:'Roz Taaze Batches', lpU1s:'Har din chhote batches mein banta hai — kabhi store ya frozen nahi.', lpU2t:'Ghar Jaise Ingredients', lpU2s:'Taaze pise masale — koi packet mix nahi.', lpU3t:'Safe, Hygienic Packaging', lpU3s:'Har meal certified food-grade container mein.', lpSubT:'Daily Tiffin Subscription', lpSubS:'Ek baar set karein — tiffin roz apne aap aayega.', lpHow:'Kaise Kaam Karta Hai', lpH1:'Meal chunein aur customise karein', lpH2:'Delivery date aur time slot chunein', lpH3:'Online ya delivery par pay karein', pubLogin:'Login', pubBack:'← Wapas', dtypeQ:'Delivery kahan chahiye?', modeTitle:'Tiffin kahan chahiye?', modeSub:'Ek baar chunein — kabhi bhi badal sakte hain.', modeChange:'Badlein', dtHome:'Home', dtHomeSub:'Society / Flat', dtOffice:'Office', dtOfficeSub:'Company / Employee', companyLbl:'Apni Company Chunein', companyHint:'Company list me nahi? Kitchen se sampark karein — hum add kar denge.', empIdLbl:'Employee ID', errCompany:'Kripya apni company chunein', errEmpId:'Kripya Employee ID daalein', pubCta:'Menu Dekhein & Order Karein', pubCutoffLine:'Lunch band <b>9:00 AM</b> · Dinner <b>3:00 PM</b>', pubHookQ:'Kya healthy khana sach me <em>20-minute delivery</em> me ban sakta hai?', pubHookA:'Nahi ban sakta. Itni jaldi aane wala khana <b>aapke order se pehle hi bana hota hai</b> — dobara garam karke bheja jaata hai.', cmpUs:'Hamara Kitchen', cmpThem:'Delivery Apps', cmpU1:'Ghar pe pise taaze masale', cmpT1:'Bulk packet masala', cmpU2:'Roz naya tel', cmpT2:'Wahi tel din bhar', cmpU3:'Roz limited orders', cmpT3:'Unlimited, bulk cooking', cmpU4:'Wahi cook, wahi swaad', cmpT4:'Har baar alag kitchen', cmpU5:'Fixed daam, koi extra nahi', cmpT5:'Surge + platform fees', cmpU6:'Halka, roz ka khana', cmpT6:'Bhaari restaurant food', cmpU7:'Kitchen jo aap dekh sakte hain', cmpT7:'Kitchen jo kabhi nahi dikhega', cmpQualT:'Quality, quantity nahi.', cmpQualS:'Hum roz ke orders limited rakhte hain — taaki har tiffin ko poora time mile.', cmpChip:'🍱 Roz limited orders — hamesha taaza', lpPosT:'Ye Fatafat-Delivery App Nahi Hai', lpPosS:'Ye aapka roz ka kitchen hai — planned, taaza aur hamesha time par.', lpPos1:'Fixed time slots par delivery — 10-minute wali race nahi.', lpPos2:'Halka, poshan-bhara ghar jaisa khana — restaurant ka bhaari tel-masala nahi.', lpPos3:'Seedhe fixed daam — na surge, na hidden ya platform charges.', lpPos4:'Roz ek hi bharosemand kitchen — har tiffin mein wahi apnapan.', navMenuShort:'Menu', navProfileShort:'Profile', pfTitle:'Meri Profile', pfAddr:'Saved Delivery Address', pfFlatLbl:'Flat / Block No.', pfSave:'Address Save Karein', addrSaved:'Address save ho gaya', pfQuick:'Quick Links', pfLang:'Language', payWithUpiBtn:'Payment Karein', orScan:'ya QR code scan karein', upiPayNote:'🔒 UPI se secure payment. Amount pehle se bhara hai — bas apne UPI app mein approve karein.', copied:'UPI ID copy ho gayi', updateCart:'✓ Cart update karein', addedToCart:'cart mein add hua', customizable:'customizable', customizeBtn:'Customize karein', chooseSize:'Size Chunein', sizeRequired:'Zaroori · Koi 1 chunein', addOns:'Add-ons', dahiShort:'Dahi', extraSabziShort:'Extra Sabzi', freshCookedDesc:'Roz chhote batches mein taaza banta hai — kabhi store ya frozen nahi.', selectSabzi:'Sabzi chunein', rotiType:'Roti type', plain:'Plain', butter:'Butter', deliveryTime:'⏰ Delivery Time', tiffinType:'🍱 Apna Tiffin Chunein', miniTiffin:'Mini Tiffin', fullTiffin:'Full Tiffin',
      extraRoti:'Extra Roti', addDahi:'Dahi add karein', extraSabzi:'Extra Sabzi', howMany:'Kitne tiffin?', unitPrice:'Unit price',
      perTiffin:'/ tiffin', specialInstr:'📝 Special instructions (optional)', notePh:'e.g. Kam mirchi, no onion...',
      backApp:'← App par wapas', remove:'Hatayein', cancelOrder:'✖ Cancel', editOrder:'Edit', editLoaded:'Order load ho gaya — badlav karke checkout karein',
      closedBreakfast:'Same-day breakfast available nahi — ek din pehle order karein.', kitchenClosedMsg:'Is date par kitchen band hai — koi doosra din chunein.', kitchenTempClosedTitle:'Kitchen Abhi Band Hai', kitchenTempClosedMsg:'Hum abhi ke liye band hain. Jald hi wapas aayenge — dhanyawad!', happyCustomers:'Happy Customers Served', orderedForThisMeal:'tiffins ab tak order hue', beingPrepared:'abhi ban rahe hain', onlyLeftToday:'Aaj ke liye sirf {n} available hain', soldOutToday:'Aaj ke liye sold out', soldOutTitle:'Is Meal Ke Slots Full Ho Gaye', soldOutSub:'Har tiffin fresh rakhne ke liye hum limited batch hi banate hain. Doosra meal ya din try karein.',
      closedLunch:'Aaj ke lunch ki booking band (9:00 AM tak thi).',
      closedDinner:'Aaj ke dinner ki booking band (3:00 PM tak thi).', closedBkTom:'Kal ke breakfast ki booking band (kal raat 10:00 PM tak thi).',
      closedTomorrow:'Kal ki booking band (10:00 PM tak thi).',
      cancelClosed:'Cancellation window band ho gaya hai.',
      dupMsg:'Is date ke liye order pehle se hai. Change ke liye Store Support ko call karein: 70434 91481.',
      noUpcoming:'Abhi koi upcoming order nahi hai. Menu se meals add karke order place karein.', noHistory:'Is date par koi order nahi mila.', navHome:'Home', navCart:'Cart', navPast:'Purane Orders', navAbout:'About Us',
      aboutTitle:'ℹ️ About Us', aboutSub:'Hamara tiffin alag kyun hai', aboutSwipe:'← Aage dekhne ke liye swipe karein →',
      aboutContact:'📞 Koi sawaal ho to humein call karein.', locGateTitle:"Location Zaroori Hai", locGateSub:"Aas-paas ki kitchens dikhane ke liye location chahiye — iske bina app kaam nahi karega.", locGateBtn:"📍 Location On Karein", locGateDeniedSub:"Is site ke liye location block hai. Address bar ke paas 🔒/ⓘ icon pe tap karo → Permissions → Location → Allow, phir Retry dabao.", locGateUnavailSub:"Permission theek hai, par phone ka Location/GPS off hai. Phone settings me Location ON karo, phir Retry dabao.", locGateChecking:"⏳ Check kar rahe hain…", locGateRetryBtn:"🔄 Retry"
    },
    hi: {
      loadingEllipsis:'लोड हो रहा है…', signingIn:'साइन इन हो रहा है…', waitingInBrowser:'आपके ब्राउज़र में साइन-इन का इंतज़ार हो रहा है…', shareKitchen:'यह किचन शेयर करें', shareKitchenTitle:'यह किचन शेयर करें', shareKitchenSub:'दोस्तों को यह लिंक भेजें या QR स्कैन करवाएं', shareKitchenBtn:'📤 शेयर करें', installAppRow:'ऐप इंस्टॉल करें', installAppTitle:'ऐप इंस्टॉल करें', installAppSub:'होम स्क्रीन पर जोड़ें — एक टैप में ऑर्डर करें, ब्राउज़र की ज़रूरत नहीं।', installAppIosTitle:'iPhone/iPad पर इंस्टॉल करें', installAppIosSteps:'नीचे Share आइकन पर टैप करें, फिर "Add to Home Screen" चुनें।', installAppBtn:'📲 इंस्टॉल करें', installAppInstalled:'✅ ऐप इंस्टॉल हो गई!', allKitchensBack:'‹ सभी किचन', demoModeTitle:'🎬 डेमो मोड', demoModeDesc:'साइनअप की ज़रूरत नहीं — एक टैप में अंदर जाएं और पूरा कस्टमर अनुभव देखें।', demoLoginBtn2:'🚀 डेमो कस्टमर से लॉगिन करें', demoLoggingIn:'⏳ अंदर ले जा रहे हैं…', dscTagline:'आपके पास ताज़ा घर-जैसा खाना', dscYourArea:'आपका इलाका', dscTryLocation:'लोकेशन फिर से आज़माएं — अपने पास की किचन देखें', dscLocBlockedToast:'इस साइट के लिए लोकेशन ब्लॉक है। एड्रेस बार के पास 🔒/ⓘ आइकन पर टैप करें → Permissions → Location → Allow, फिर दोबारा कोशिश करें।', orDivider:'या', loginWithOtp:'मोबाइल OTP से लॉगिन करें', sendOtpBtn:'OTP भेजें', sendingOtp:'भेजा जा रहा है…', otpSentTo:'OTP {phone} पर भेज दिया गया है', verifying:'वेरिफ़ाइ हो रहा है…', resendOtp:'OTP दोबारा भेजें', resendOtpIn:'{s} सेकंड में दोबारा भेजें', changeNumber:'नंबर बदलें', otpInvalid:'6-अंकों का OTP डालें', srv_bad_phone:'सही 10-अंकों का मोबाइल नंबर डालें।', srv_otp_too_many_sends:'बहुत ज़्यादा OTP रिक्वेस्ट। थोड़ी देर बाद कोशिश करें।', srv_otp_expired:'OTP एक्सपायर हो गया या मांगा ही नहीं गया। नया OTP मंगवाएं।', srv_otp_too_many_attempts:'बहुत ज़्यादा गलत कोशिशें। नया OTP मंगवाएं।', srv_otp_wrong:'गलत OTP। दोबारा कोशिश करें।', srv_busy:'सर्वर अभी व्यस्त है — थोड़ी देर बाद कोशिश करें।', srv_bad_name:'अपना नाम डालें।', dscAvailableKitchens:'उपलब्ध किचन', dscSearchingNear:'आपके पास किचन ढूंढी जा रही है…', dscNoNearby:'आपके डिलीवरी रेडियस में अभी कोई किचन नहीं मिली', browseKitchens:'किचन ब्राउज़ करें', themeLabel:'🎨 थीम', themeSystem:'📱 सिस्टम डिफ़ॉल्ट', themeLight:'☀️ लाइट', themeDark:'🌙 डार्क', ratingTapStars:'स्टार चुनने के लिए टैप करें', ratingCommentPh:'कुछ लिखना चाहेंगे? (वैकल्पिक)', ratingSubmitBtn:'रेटिंग भेजें', ratingNotNow:'अभी नहीं', demoGlobalBanner:'🎬 डेमो — जो चाहे कर सकते हैं, डेटा रोज़ रात को रीसेट हो जाता है', dscLoaderTitle:'आपके पास किचन ढूंढ रहे हैं…', dscLoaderSub:'ताज़ा घर-जैसा खाना लोड हो रहा है', couldNotLoadOrders:'ऑर्डर लोड नहीं हो पाए।', networkErrorShort:'नेटवर्क में समस्या।', retryBtn:'🔄 फिर कोशिश करें', lblVariant:'वैरिएंट', lblSabzi:'सब्ज़ी', lblRoti:'रोटी', topRatedBadge:'★ टॉप रेटेड', newBadge:'🆕 नया', newTag:'नया', noReviewsYet:'अभी कोई रिव्यू नहीं', couponNotApplied:'कूपन लागू नहीं हुआ', amountChargedLbl:'चार्ज की गई राशि:', legalNameLbl:'कानूनी नाम', gstNumberLbl:'GST नंबर', fssaiLbl:'FSSAI लाइसेंस नंबर', menuLoadFailed:'मेन्यू लोड नहीं हो पाया', totalLbl:'कुल', ordersPlacedOne:'आपका ऑर्डर सफलतापूर्वक प्लेस हो गया है।', ordersPlacedMany:'आपके {n} ऑर्डर सफलतापूर्वक प्लेस हो गए हैं।', ordersDupSuffix:' {n} तारीख़(ों) पर पहले से ऑर्डर मौजूद था।',
      errNetwork:'❌ नेटवर्क त्रुटि। कनेक्शन जाँचकर दोबारा प्रयास करें।', sessionExpired:'⚠️ आपका सेशन समाप्त हो गया — कृपया दोबारा साइन इन करें।', completeFields:'⚠️ कृपया सभी आवश्यक जानकारी भरें।', orderFailed:'❌ ऑर्डर प्लेस नहीं हो सका। कृपया दोबारा प्रयास करें।', selectDate:'⚠️ कृपया पहले एक तारीख़ चुनें।', orderCancelled:'✅ आपका ऑर्डर कैंसल हो गया।', resetLinkBad:'❌ यह रीसेट लिंक अमान्य या समाप्त हो चुका है।', confirmCancel:'क्या यह ऑर्डर कैंसल करें?', welcomeUser:'🎉 स्वागत है,', errLogin:'आगे बढ़ने के लिए साइन इन करें।',
      tagline:'ताज़ा • घर का बना • डोरस्टेप डिलीवरी', secureLogin:'🔐 सुरक्षित लॉगिन', signInTitle:'वापसी पर स्वागत है', emailLabel:'ईमेल', passwordLabel:'पासवर्ड', passwordPh:'अपना पासवर्ड डालें', passwordPh6:'कम से कम 6 अक्षर', confirmPwLabel:'पासवर्ड की पुष्टि करें', confirmPwPh:'पासवर्ड दोबारा डालें', errEmail:'सही ईमेल एड्रेस डालें।', errPassword:'अपना पासवर्ड डालें।', errPassword6:'पासवर्ड कम से कम 6 अक्षर का हो।', errConfirmPw:'पासवर्ड मैच नहीं हो रहा।', forgotPw:'पासवर्ड भूल गए?', signInBtn:'साइन इन करें', signUpTitle:'अकाउंट बनाएं', signUpSub:'रोज़ का टिफ़िन ऑर्डर करने के लिए साइन अप करें।', phoneDeliveryHint:'डिलीवरी संपर्क के लिए इस्तेमाल होगा।', createAccountBtn:'अकाउंट बनाएं', switchToSignUp:'अकाउंट नहीं है? <b onclick="showAuthMode(\'signup\')">साइन अप करें</b>', switchToSignIn:'पहले से अकाउंट है? <b onclick="showAuthMode(\'signin\')">साइन इन करें</b>', backToSignIn:'← साइन इन पर वापस', forgotTitle:'पासवर्ड रीसेट करें', forgotSub:'अपना ईमेल डालें, हम रीसेट लिंक भेज देंगे।', sendResetBtn:'रीसेट लिंक भेजें', resetTitle:'नया पासवर्ड सेट करें', resetSub:'अपने अकाउंट के लिए नया पासवर्ड चुनें।', newPasswordLabel:'नया पासवर्ड', resetBtn:'पासवर्ड रीसेट करें', orDivider:'या', resetLinkSent:'अगर ये ईमेल रजिस्टर्ड है, रीसेट लिंक भेज दिया गया है।', passwordResetDone:'पासवर्ड अपडेट हो गया — अब साइन इन कर सकते हैं।',
      loginTitle:'लॉगिन या साइन अप', mobileLabel:'मोबाइल नंबर', mobilePh:'10 अंकों का मोबाइल नंबर डालें',
      continueBtn2:'आगे बढ़ें', loginHint:'अपना Google अकाउंट चुनें।', phoneFirstHint:'सिर्फ़ पहली बार ज़रूरी — डिलीवरी संपर्क के लिए।', completeSignup:'✓ साइन अप पूरा करें',
      verifyTitle:'एक आख़िरी क़दम', googleWelcome:'✅ Google से साइन इन हो गया। डिलीवरी संपर्क के लिए मोबाइल नंबर डालें।', nameLabel:'आपका नाम', namePh:'अपना पूरा नाम लिखें',
      otpLabel:'वेरिफ़िकेशन कोड डालें', verifyBtn:'वेरिफ़ाई करें', changeNum:'दूसरा Google अकाउंट इस्तेमाल करें', errName:'सही नाम डालें (केवल अक्षर)।', errPhone:'सही 10 अंकों का मोबाइल नंबर डालें।', errPickGoogle:'पहले Google बटन दबाकर अकाउंट चुनें।',
      badgeFresh:'🌿 कोई फ़्रोज़न नहीं', badgeCustom:'🍳 कस्टमाइज़ेबल', badgeCOD:'💵 कैश ऑन डिलीवरी',
      freshStrip:'🌿 एकदम ताज़ा: आपका खाना ऑर्डर के बाद ही बनता है — न फ़्रोज़न, न बासी।',
      deliveryDate:'📅 डिलीवरी की तारीख़',
      cutoffNote:'🕒 ऑर्डर कट-ऑफ समय (IST)\n• नाश्ता — एक रात पहले 10:00 PM तक\n• लंच — उसी दिन 9:00 AM तक\n• डिनर — उसी दिन 3:00 PM तक\nकट-ऑफ के बाद अगले उपलब्ध दिन के लिए ऑर्डर करें।',
      selectMeals:'🍽️ अपने मील चुनें', yourCart:'आपकी कार्ट', clearCart:'खाली करें', cartEmpty:'कार्ट खाली है। ऊपर से मील जोड़ें।',
      myOrders:'मेरे ऑर्डर', refresh:'🔄 रिफ़्रेश', viewPast:'🗓️ डिलीवरी तारीख़ चुनें', view:'देखें',
      cartTotal:'कुल राशि', checkout:'चेकआउट →', viewCart:'कार्ट देखें →', continueLbl:'आगे बढ़ें', okBtn:'ठीक है', rateKitchen:'इस किचन को रेट करें', orSignInWith:'या साइन इन करें', signInWithGoogle:'Google से साइन इन', itemAdded:'आइटम जुड़ा', itemsAdded:'आइटम जुड़े', logout:'लॉगआउट',
      checkoutTitle:'📦 डिलीवरी जानकारी', checkoutSub:'आख़िरी कदम — ऑर्डर कन्फ़र्म करें', backMenu:'← मेन्यू पर वापस',
      autofillNote:'✓ आपका सेव किया पता अपने-आप भर गया', township:'🏢 टाउनशिप', society:'🏘️ सोसायटी', flat:'🏠 फ़्लैट नंबर',
      fullName:'👤 पूरा नाम', verifiedMobile:'📱 मोबाइल नंबर (वेरिफ़ाइड ✓)', payMethod:'💰 भुगतान का तरीका',
      payCOD:'💵 कैश ऑन डिलीवरी', payCODsub:'टिफ़िन मिलने पर कैश दें', payUPI:'💳 ऑनलाइन पेमेंट (UPI)', payUPIsub:'ऑर्डर करते ही QR कोड मिलेगा', codNote:'कैश ऑन डिलीवरी — टिफ़िन मिलने पर भुगतान करें।',
      errSociety:'अपनी सोसायटी चुनें।', errFlat:'कृपया ब्लॉक और फ़्लैट नंबर डालें, जैसे D-706।',
      placeOrder:'📤 ऑर्डर करें', successTitle:'ऑर्डर कन्फर्म हो गया', promoHave:'कूपन कोड है? यहाँ डालें', promoApply:'लगाएँ', promoApplied:'लागू हुआ', discountLbl:'छूट', promoFirstDateNote:'(पहली डिलीवरी तारीख़ पर लागू)', promoEditNote:'छूट वाले ऑर्डर एडिट नहीं हो सकते — कैंसल करके नया ऑर्डर करें।', promoUseAtCheckout:'कार्ट में कोड पर टैप करके लागू करें', promoNewTag:'नए ग्राहक', policyTitle:'कैंसलेशन और रिफ़ंड नीति', abDeliveryOnly:'यह एक डिलीवरी-ओनली किचन है', abBackToMenu:'मेनू पर वापस जाएँ', abOpenNow:'अभी खुला है', abCloses:'बंद होगा', abClosedNow:'अभी बंद है', abOpensAt:'खुलेगा', policyBody:'• ऑर्डर डिलीवरी से एक रात पहले 10:00 PM तक कैंसल किया जा सकता है। इसके बाद किए गए ऑर्डर, ऑर्डर करने के 30 मिनट के भीतर कैंसल किए जा सकते हैं। ऑर्डर एडिट नहीं हो सकता — कृपया कैंसल करके नया ऑर्डर करें।<br>• यदि आपने UPI से ऑनलाइन भुगतान किया है और ऑर्डर कैंसल होता है — चाहे आपने अनुमत समय में किया हो या हमने किसी कारण से — पूरी राशि 24 घंटे के भीतर उसी UPI खाते में रिफ़ंड कर दी जाती है।<br>• कूपन छूट वाले ऑर्डर एडिट नहीं हो सकते; कृपया कैंसल करके नया ऑर्डर करें।<br>• खाने में कोई समस्या हो? डिलीवरी के 2 घंटे के भीतर फ़ोटो के साथ WhatsApp करें — हम रिप्लेसमेंट या पूरा रिफ़ंड देंगे।<br>• सहायता: 📞 +91 70434 91481 (WhatsApp उपलब्ध)।', waFallback:'ऑर्डर WhatsApp पर साझा करें (optional) →', newOrder:'नया ऑर्डर करें', trackOrderBtn:'ऑर्डर ट्रैक करें', okayBtn:'ठीक है', successConfirmNote:'आपका ऑर्डर कन्फर्म हो चुका है। आप इसे कभी भी My Orders सेक्शन में देख और ट्रैक कर सकते हैं।',
      addToCart:'🛒 कार्ट में जोड़ें', addedShort:'कार्ट में जुड़ा', addToCart2:'जोड़ें', payNowUpi:'ऑनलाइन भुगतान', payRefLbl:'पेमेंट रेफ़रेंस', srv_dup_date:'इस तारीख़ का ऑर्डर पहले से है।', srv_qty_limit:'एक दिन में हर मील का सिर्फ़ 1 टिफ़िन। ज़्यादा के लिए किचन से संपर्क करें।', srv_cancel_window:'इस ऑर्डर की कैंसलेशन विंडो बंद हो चुकी है।', srv_already_cancelled:'यह ऑर्डर पहले से कैंसल है।', srv_cancel_delivered:'डिलीवर हुआ ऑर्डर कैंसल नहीं हो सकता।', srv_not_yours:'यह ऑर्डर आपके अकाउंट का नहीं है।', srv_no_meal:'ऑर्डर खाली है — कम से कम एक मील चुनें।', srv_office_off:'ऑफ़िस डिलीवरी अभी उपलब्ध नहीं है।', srv_home_off:'होम डिलीवरी अभी उपलब्ध नहीं है।', srv_company_req:'कृपया लिस्ट से अपनी कंपनी चुनें।', srv_empid_req:'एम्प्लॉई ID ज़रूरी है।', srv_blocked:'आपका अकाउंट ब्लॉक है। सपोर्ट: 70434 91481', srv_wrong_pw:'पासवर्ड ग़लत है।', srv_no_account:'इस ईमेल से कोई अकाउंट नहीं मिला।', srv_email_exists:'इस ईमेल से अकाउंट पहले से है — साइन इन करें।', srv_phone_taken:'यह मोबाइल नंबर दूसरे अकाउंट से जुड़ा है।', srv_use_google:'यह अकाउंट Google Sign-In का है — "Sign in with Google" चुनें।', srv_reset_sent:'अगर यह ईमेल रजिस्टर्ड है, रीसेट लिंक भेज दिया गया है।', srv_reset_bad:'यह रीसेट लिंक अमान्य या समाप्त है।', srv_reset_expired:'रीसेट लिंक समाप्त हो गया — नया अनुरोध करें।', scanToPay:'किसी भी UPI ऐप से QR स्कैन करें', copyId:'कॉपी', pleaseWait:'एक क्षण…', cancelWindowOver:'इस ऑर्डर का कैंसलेशन विंडो बंद हो चुका है। किसी भी मदद के लिए किचन से संपर्क करें।', limitTitle:'एक मील का एक टिफ़िन', limitBody:'हर ग्राहक एक दिन में 1 नाश्ता, 1 लंच और 1 डिनर ऑर्डर कर सकता है। ज़्यादा मात्रा के लिए कृपया किचन से संपर्क करें — हम खुशी से व्यवस्था कर देंगे।', limitCta:'किचन से संपर्क करें', limitClose:'ठीक है', subtotalLbl:'सबटोटल', deliveryLbl:'डिलीवरी', infoStripText:'ऑर्डर समय — नाश्ता: एक रात पहले 10 PM तक · लंच: 9 AM तक · डिनर: 3 PM तक', subPushLine:'रोज़ ऑर्डर करते हैं? सब्सक्रिप्शन सेट करें', qaTitle:'सहायता', qaOnline:'● ऑनलाइन', qaPh:'अपना सवाल लिखें…', qaGreet:'नमस्ते! 🙏 मेन्यू, दाम या डिलीवरी समय — कुछ भी पूछिए।', qaSug1:'आज का मेन्यू', qaSug2:'डिलीवरी समय', qaSug3:'कहाँ डिलीवर करते हैं?', qaOffTopic:'क्षमा करें, मैं सिर्फ़ इस किचन के खाने से जुड़े सवालों में मदद कर सकती हूँ 🍱 मेन्यू, दाम, डिलीवरी या ऑर्डर के बारे में पूछिए!', qaLimit:'आज के लिए आपके 10 सवाल हो गए 🙏 कल फिर पूछ सकते हैं — या तुरंत मदद के लिए हमें कॉल करें।', qaErr:'असिस्टेंट से संपर्क नहीं हो पाया। दोबारा कोशिश करें, या हमें कॉल करें।', reorderBtn:'फिर ऑर्डर करें', alreadyOrderedT:'इस तारीख़ का {meal} आप पहले ही ऑर्डर कर चुके हैं।', alreadyOrderedBtn:'मेरा ऑर्डर देखें', reorderDone:'आइटम आपके कार्ट में जुड़ गए', reorderNoSlot:'ये मील अगले 3 दिन उपलब्ध नहीं हैं', lpTagline:'रोज़ ताज़ा, घर जैसा खाना — सीधे आपके doorstep तक।', lpOrderNow:'ऑर्डर करें', priceFrom:'₹{p} से भोजन', lpTodays:'आज के मील', lpOpen:'उपलब्ध', lpClosed:'बंद', lpWhy:'इस किचन ही क्यों', lpU1t:'रोज़ ताज़े बैच', lpU1s:'हर दिन छोटे बैच में बनता है — कभी स्टोर या फ़्रोज़न नहीं।', lpU2t:'घर जैसी सामग्री', lpU2s:'ताज़े पिसे मसाले — कोई पैकेट मिक्स नहीं।', lpU3t:'सुरक्षित पैकेजिंग', lpU3s:'हर मील सर्टिफ़ाइड फ़ूड-ग्रेड कंटेनर में।', lpSubT:'डेली टिफ़िन सब्सक्रिप्शन', lpSubS:'एक बार सेट करें — टिफ़िन रोज़ अपने आप आएगा।', lpHow:'कैसे काम करता है', lpH1:'मील चुनें और कस्टमाइज़ करें', lpH2:'डिलीवरी की तारीख़ और समय चुनें', lpH3:'ऑनलाइन या डिलीवरी पर भुगतान करें', pubLogin:'लॉगिन', pubBack:'← वापस', dtypeQ:'डिलीवरी कहाँ चाहिए?', modeTitle:'टिफ़िन कहाँ चाहिए?', modeSub:'एक बार चुनें — कभी भी बदल सकते हैं।', modeChange:'बदलें', dtHome:'घर', dtHomeSub:'सोसाइटी / फ़्लैट', dtOffice:'ऑफ़िस', dtOfficeSub:'कंपनी / एम्प्लॉई', companyLbl:'अपनी कंपनी चुनें', companyHint:'कंपनी लिस्ट में नहीं? किचन से संपर्क करें — हम जोड़ देंगे।', empIdLbl:'एम्प्लॉई ID', errCompany:'कृपया अपनी कंपनी चुनें', errEmpId:'कृपया एम्प्लॉई ID डालें', pubCta:'मेन्यू देखें और ऑर्डर करें', pubCutoffLine:'लंच बंद <b>9:00 AM</b> · डिनर <b>3:00 PM</b>', pubHookQ:'क्या हेल्दी खाना सच में <em>20-मिनट डिलीवरी</em> में बन सकता है?', pubHookA:'नहीं बन सकता। इतनी जल्दी आने वाला खाना <b>आपके ऑर्डर से पहले ही बना होता है</b> — दोबारा गरम करके भेजा जाता है।', cmpUs:'हमारा किचन', cmpThem:'डिलीवरी ऐप्स', cmpU1:'घर पर पिसे ताज़े मसाले', cmpT1:'बल्क पैकेट मसाला', cmpU2:'रोज़ नया तेल', cmpT2:'वही तेल दिन भर', cmpU3:'रोज़ सीमित ऑर्डर', cmpT3:'अनलिमिटेड, बल्क कुकिंग', cmpU4:'वही रसोइया, वही स्वाद', cmpT4:'हर बार अलग किचन', cmpU5:'फ़िक्स्ड दाम, कोई एक्स्ट्रा नहीं', cmpT5:'सर्ज + प्लेटफ़ॉर्म फ़ीस', cmpU6:'हल्का, रोज़ का खाना', cmpT6:'भारी रेस्टोरेंट फ़ूड', cmpU7:'किचन जो आप देख सकते हैं', cmpT7:'किचन जो कभी नहीं दिखेगा', cmpQualT:'क्वालिटी, क्वांटिटी नहीं।', cmpQualS:'हम रोज़ के ऑर्डर सीमित रखते हैं — ताकि हर टिफ़िन को पूरा समय मिले।', cmpChip:'🍱 रोज़ सीमित ऑर्डर — हमेशा ताज़ा', lpPosT:'यह फटाफट-डिलीवरी ऐप नहीं है', lpPosS:'यह आपका रोज़ का किचन है — planned, ताज़ा और हमेशा समय पर।', lpPos1:'Fixed time slots पर डिलीवरी — 10-मिनट वाली रेस नहीं।', lpPos2:'हल्का, पोषण-भरा घर जैसा खाना — रेस्टोरेंट का भारी तेल-मसाला नहीं।', lpPos3:'सीधे fixed दाम — ना surge, ना hidden या platform charges।', lpPos4:'रोज़ एक ही भरोसेमंद किचन — हर टिफ़िन में वही अपनापन।', navMenuShort:'मेनू', navProfileShort:'प्रोफ़ाइल', pfTitle:'मेरी प्रोफ़ाइल', pfAddr:'सेव किया गया पता', pfFlatLbl:'फ़्लैट / ब्लॉक नं.', pfSave:'पता सेव करें', addrSaved:'पता सेव हो गया', pfQuick:'क्विक लिंक', pfLang:'भाषा', payWithUpiBtn:'भुगतान करें', orScan:'या QR कोड स्कैन करें', upiPayNote:'🔒 UPI से सुरक्षित भुगतान। राशि पहले से भरी है — बस अपने UPI ऐप में अप्रूव करें।', copied:'UPI ID कॉपी हो गई', updateCart:'✓ कार्ट अपडेट करें', addedToCart:'कार्ट में जुड़ा', customizable:'कस्टमाइज़ेबल', customizeBtn:'कस्टमाइज़ करें', chooseSize:'साइज़ चुनें', sizeRequired:'ज़रूरी · कोई 1 चुनें', addOns:'ऐड-ऑन', dahiShort:'दही', extraSabziShort:'एक्स्ट्रा सब्ज़ी', freshCookedDesc:'रोज़ छोटे बैच में ताज़ा बनता है — कभी स्टोर या फ़्रोज़न नहीं।', selectSabzi:'सब्ज़ी चुनें', rotiType:'रोटी टाइप', plain:'प्लेन', butter:'बटर', deliveryTime:'⏰ डिलीवरी समय', tiffinType:'🍱 अपना टिफ़िन चुनें', miniTiffin:'मिनी टिफ़िन', fullTiffin:'फ़ुल टिफ़िन',
      extraRoti:'एक्स्ट्रा रोटी', addDahi:'दही जोड़ें', extraSabzi:'एक्स्ट्रा सब्ज़ी', howMany:'कितने टिफ़िन?', unitPrice:'यूनिट प्राइस',
      perTiffin:'/ टिफ़िन', specialInstr:'📝 विशेष निर्देश (वैकल्पिक)', notePh:'जैसे कम मिर्च, बिना प्याज़...',
      backApp:'← ऐप पर वापस', remove:'हटाएँ', cancelOrder:'✖ कैंसिल', editOrder:'बदलें', editLoaded:'ऑर्डर लोड हुआ — बदलाव करके चेकआउट करें',
      closedBreakfast:'सेम-डे ब्रेकफ़ास्ट उपलब्ध नहीं — एक दिन पहले ऑर्डर करें।', kitchenClosedMsg:'इस तारीख़ को किचन बंद है — कोई और दिन चुनें।', kitchenTempClosedTitle:'किचन अभी बंद है', kitchenTempClosedMsg:'हम अभी के लिए बंद हैं। हम जल्द ही वापस आएंगे — धन्यवाद!', happyCustomers:'खुश ग्राहकों ने ऑर्डर किया', orderedForThisMeal:'टिफ़िन अब तक ऑर्डर हुए', beingPrepared:'अभी बन रहे हैं', onlyLeftToday:'आज के लिए केवल {n} उपलब्ध हैं', soldOutToday:'आज के लिए सोल्ड आउट', soldOutTitle:'इस मील के स्लॉट फुल हो गए', soldOutSub:'हर टिफ़िन ताज़ा रखने के लिए हम सीमित मात्रा में ही बनाते हैं। कोई और मील या दिन आज़माएँ।',
      closedLunch:'आज के लंच की बुकिंग बंद (9:00 AM तक थी)।',
      closedDinner:'आज के डिनर की बुकिंग बंद (3:00 PM तक थी)।', closedBkTom:'कल के ब्रेकफ़ास्ट की बुकिंग बंद (कल रात 10:00 PM तक थी)।',
      closedTomorrow:'कल की बुकिंग बंद (10:00 PM तक थी)।',
      cancelClosed:'कैंसिलेशन का समय समाप्त हो गया है।',
      dupMsg:'इस तारीख़ के लिए ऑर्डर पहले से है। बदलाव के लिए स्टोर सपोर्ट को कॉल करें: 70434 91481।',
      noUpcoming:'अभी कोई आगामी ऑर्डर नहीं है। मेनू से मील जोड़कर ऑर्डर करें।', noHistory:'इस तारीख़ पर कोई ऑर्डर नहीं मिला।', navHome:'होम', navCart:'कार्ट', navPast:'पुराने ऑर्डर', navAbout:'हमारे बारे में', navSub:'सब्सक्रिप्शन', navHomeShort:'होम', navCartShort:'कार्ट', navSubShort:'सब्सक्राइब', navBulkShort:'बल्क', schedTitle:'📅 मील शेड्यूल करें', schedSub:'किस दिन के लिए ऑर्डर करना है?', schedOrderingFor:'ऑर्डर हो रहा है', schedBackToday:'आज पर वापस', schedDayLbl:'दिन', schedMealLbl:'मील', schedContinue:'मेनू पर जाएं', exitConfirmTitle:'ऐप बंद करें?', exitConfirmSub:'आप लॉगआउट हो जाएंगे।', exitConfirmBtn:'बाहर निकलें', exitConfirmSubGuest:'क्या आप वाकई बाहर निकलना चाहते हैं?',
      bulkOrderRow:'बल्क / पार्टी ऑर्डर', bulkMyRequests:'मेरे बल्क रिक्वेस्ट', bulkTitle:'🎉 बल्क / पार्टी ऑर्डर',
      bulkSub:'ग्रुप या इवेंट के लिए ऑर्डर कर रहे हैं? विवरण बताएं — किचन उपलब्धता और कीमत कन्फर्म करेगा।',
      bulkMealLbl:'मील', bulkQtyLbl:'मात्रा (न्यूनतम 5)', bulkDateLbl:'डिलीवरी की तारीख', bulkAddrLbl:'डिलीवरी पता',
      bulkAddrPh:'ऑफिस / इवेंट का पता', bulkNotesLbl:'नोट्स (वैकल्पिक)', bulkNotesPh:'जैसे, सिर्फ वेज, बिना प्याज़...',
      bulkSubmit:'बल्क रिक्वेस्ट भेजें', limitBulkCta:'🎉 बल्क ऑर्डर करें',
      bulkErrQty:'कम से कम 5 टिफ़िन डालें।', bulkErrDate:'डिलीवरी की तारीख चुनें।',
      bulkSubmitted:'रिक्वेस्ट भेज दी गई — किचन जल्द कन्फर्म करेगा।', bulkApproved:'स्वीकृत', bulkDeclined:'अस्वीकृत', bulkPending:'लंबित', scheduleBtn:'शेड्यूल करें', onbSkip:'छोड़ें', onb1Title:'ताज़ा टिफ़िन, रोज़', onb1Body:'ऑर्डर के बाद ही बनता है — न फ़्रोज़न, न बासी।', onb2Title:'होम और ऑफिस डिलीवरी', onb2Body:'जहाँ भी हों — घर या ऑफिस, ऑर्डर करें।', onb3Title:'आज ऑर्डर करें या शेड्यूल करें', onb3Body:'कल का टिफ़िन प्लान करना है? नीचे "Schedule Your Meal" इस्तेमाल करें।', onb4Title:'आसान पेमेंट', onb4Body:'UPI से पे करें या सीधा कैश ऑन डिलीवरी — जो पसंद हो।', onbGetStarted:'शुरू करें', navAiShort:'AI मदद', navOrdersShort:'ऑर्डर', subTitle:'🔁 सब्सक्रिप्शन', subSub:'एक बार सेट करें — आपका डेली टिफ़िन अपने आप ऑर्डर हो जाएगा।', subActive:'चालू प्लान', subDaysWeek:'दिन/हफ़्ता', subWeekdaysSub:'सोम–शुक्र, सभी मील', subAllDaysSub:'हर दिन, सभी मील', subClearSub:'फिर से शुरू करें', subMealsPerWeek:'मील/हफ़्ता शेड्यूल हुए', subSkipped:'स्किप किए', subSkipBtn:'दिन स्किप करें', subCancelBtn:'प्लान रद्द करें', subEditNote:'नीचे बदलकर अपडेट दबाएँ', subPickMeals:'मील चुनें', subPickDays:'दिन चुनें', subWeekdays:'सोम–शुक्र', subAllDays:'सातों दिन', subClear:'साफ़', subDateRange:'तारीख़ रेंज', subStart:'शुरू', subEnd:'ख़त्म', subDelivery:'डिलीवरी', subUpdate:'प्लान अपडेट', subStart2:'सब्सक्रिप्शन शुरू', subAnySabzi:'शेफ़ की पसंद', subSaved:'सब्सक्रिप्शन सफलतापूर्वक सेव हुआ।', subCancelled:'सब्सक्रिप्शन रद्द हुआ', subCancelConfirm:'सब्सक्रिप्शन रद्द करें?', subSkipDone:'दिन स्किप हुआ', subUnskipDone:'स्किप हटा', subPickSkipDate:'स्किप के लिए तारीख़ चुनें', subEndAfter:'एंड डेट स्टार्ट के बाद हो', subStartInfo:'कल से आगे', navContact:'संपर्क करें', contactTitle:'📞 संपर्क करें', contactSub:'आपकी बात सुनना हमें अच्छा लगता है', contactInfoTitle:'ℹ️ जानकारी', contactAddrLbl:'लोकेशन', contactAreaLbl:'डिलीवरी क्षेत्र', contactHoursLbl:'डिलीवरी समय',
      aboutTitle:'ℹ️ हमारे बारे में', aboutSub:'हमारा टिफ़िन अलग क्यों है', aboutSwipe:'← आगे देखने के लिए स्वाइप करें →',
      aboutContact:'📞 कोई सवाल? हम एक कॉल दूर हैं।', locGateTitle:"लोकेशन ज़रूरी है", locGateSub:"आस-पास की किचन दिखाने के लिए लोकेशन चाहिए — इसके बिना ऐप काम नहीं करेगा।", locGateBtn:"📍 लोकेशन ऑन करें", locGateDeniedSub:"इस साइट के लिए लोकेशन ब्लॉक है। एड्रेस बार के पास 🔒/ⓘ आइकन पर टैप करें → Permissions → Location → Allow, फिर Retry दबाएं।", locGateUnavailSub:"परमिशन सही है, पर आपके फ़ोन का लोकेशन/GPS बंद है। फ़ोन सेटिंग्स में लोकेशन ऑन करें, फिर Retry दबाएं।", locGateChecking:"⏳ जांच रहे हैं…", locGateRetryBtn:"🔄 फिर कोशिश करें"
    },
    gu: {
      loadingEllipsis:'લોડ થઈ રહ્યું છે…', signingIn:'સાઇન ઇન થઈ રહ્યું છે…', waitingInBrowser:'તમારા બ્રાઉઝરમાં સાઇન-ઇનની રાહ જોવાઈ રહી છે…', shareKitchen:'આ કિચન શેર કરો', shareKitchenTitle:'આ કિચન શેર કરો', shareKitchenSub:'મિત્રોને આ લિંક મોકલો અથવા QR સ્કેન કરાવો', shareKitchenBtn:'📤 શેર કરો', installAppRow:'એપ ઇન્સ્ટોલ કરો', installAppTitle:'એપ ઇન્સ્ટોલ કરો', installAppSub:'હોમ સ્ક્રીન પર ઉમેરો — એક ટેપમાં ઓર્ડર કરો, બ્રાઉઝરની જરૂર નથી.', installAppIosTitle:'iPhone/iPad પર ઇન્સ્ટોલ કરો', installAppIosSteps:'નીચે Share આઇકન પર ટેપ કરો, પછી "Add to Home Screen" પસંદ કરો.', installAppBtn:'📲 ઇન્સ્ટોલ કરો', installAppInstalled:'✅ એપ ઇન્સ્ટોલ થઈ ગઈ!', allKitchensBack:'‹ બધા કિચન', demoModeTitle:'🎬 ડેમો મોડ', demoModeDesc:'સાઇનઅપની જરૂર નથી — એક ટેપમાં અંદર જાઓ અને પૂરો કસ્ટમર અનુભવ જુઓ.', demoLoginBtn2:'🚀 ડેમો કસ્ટમરથી લૉગિન કરો', demoLoggingIn:'⏳ અંદર લઈ જઈ રહ્યા છીએ…', dscTagline:'તમારી નજીક તાજું ઘર-જેવું ભોજન', dscYourArea:'તમારો વિસ્તાર', dscTryLocation:'લોકેશન ફરી પ્રયત્ન કરો — તમારી નજીકના કિચન જુઓ', dscLocBlockedToast:'આ સાઇટ માટે લોકેશન બ્લોક છે. એડ્રેસ બાર પાસે 🔒/ⓘ આઇકન પર ટેપ કરો → Permissions → Location → Allow, પછી ફરી પ્રયત્ન કરો.', orDivider:'અથવા', loginWithOtp:'મોબાઇલ OTP થી લૉગિન કરો', sendOtpBtn:'OTP મોકલો', sendingOtp:'મોકલી રહ્યા છીએ…', otpSentTo:'OTP {phone} પર મોકલી દેવાયો છે', verifying:'વેરિફાય થઈ રહ્યું છે…', resendOtp:'OTP ફરી મોકલો', resendOtpIn:'{s} સેકન્ડમાં ફરી મોકલો', changeNumber:'નંબર બદલો', otpInvalid:'6-અંકનો OTP દાખલ કરો', srv_bad_phone:'સાચો 10-અંકનો મોબાઇલ નંબર દાખલ કરો.', srv_otp_too_many_sends:'ઘણી બધી OTP વિનંતીઓ. થોડી વાર પછી પ્રયત્ન કરો.', srv_otp_expired:'OTP એક્સપાયર થયો અથવા માંગ્યો જ નહોતો. નવો OTP મંગાવો.', srv_otp_too_many_attempts:'ઘણા બધા ખોટા પ્રયત્નો. નવો OTP મંગાવો.', srv_otp_wrong:'ખોટો OTP. ફરી પ્રયત્ન કરો.', srv_busy:'સર્વર અત્યારે વ્યસ્ત છે — થોડી વાર પછી પ્રયત્ન કરો.', srv_bad_name:'તમારું નામ દાખલ કરો.', dscAvailableKitchens:'ઉપલબ્ધ કિચન', dscSearchingNear:'તમારી નજીકના કિચન શોધાઈ રહ્યા છે…', dscNoNearby:'તમારા ડિલિવરી રેડિયસમાં હજુ કોઈ કિચન મળ્યું નથી', browseKitchens:'કિચન બ્રાઉઝ કરો', themeLabel:'🎨 થીમ', themeSystem:'📱 સિસ્ટમ ડિફૉલ્ટ', themeLight:'☀️ લાઇટ', themeDark:'🌙 ડાર્ક', ratingTapStars:'સ્ટાર પસંદ કરવા ટેપ કરો', ratingCommentPh:'કંઈક લખવા માંગો છો? (વૈકલ્પિક)', ratingSubmitBtn:'રેટિંગ મોકલો', ratingNotNow:'હમણાં નહીં', demoGlobalBanner:'🎬 ડેમો — જે ઈચ્છો તે કરી શકો છો, ડેટા દરરોજ રાત્રે રીસેટ થાય છે', dscLoaderTitle:'તમારી નજીક કિચન શોધી રહ્યા છીએ…', dscLoaderSub:'તાજું ઘર-જેવું ભોજન લોડ થઈ રહ્યું છે', couldNotLoadOrders:'ઓર્ડર લોડ થઈ શક્યા નહીં.', networkErrorShort:'નેટવર્ક ભૂલ.', retryBtn:'🔄 ફરી પ્રયત્ન કરો', lblVariant:'વેરિઅન્ટ', lblSabzi:'શાક', lblRoti:'રોટલી', topRatedBadge:'★ ટોપ રેટેડ', newBadge:'🆕 નવું', newTag:'નવું', noReviewsYet:'હજુ કોઈ રિવ્યૂ નથી', couponNotApplied:'કૂપન લાગુ થયું નથી', amountChargedLbl:'ચાર્જ થયેલી રકમ:', legalNameLbl:'કાનૂની નામ', gstNumberLbl:'GST નંબર', fssaiLbl:'FSSAI લાઇસન્સ નંબર', menuLoadFailed:'મેનૂ લોડ થઈ શક્યું નહીં', totalLbl:'કુલ', ordersPlacedOne:'તમારો ઓર્ડર સફળતાપૂર્વક પ્લેસ થયો છે.', ordersPlacedMany:'તમારા {n} ઓર્ડર સફળતાપૂર્વક પ્લેસ થયા છે.', ordersDupSuffix:' {n} તારીખ(તારીખો) પર પહેલેથી ઓર્ડર હતો.',
      errNetwork:'❌ નેટવર્ક ભૂલ. કનેક્શન તપાસીને ફરી પ્રયાસ કરો.', sessionExpired:'⚠️ તમારું સેશન સમાપ્ત થયું — કૃપા કરીને ફરી સાઇન ઇન કરો.', completeFields:'⚠️ કૃપા કરીને બધી જરૂરી માહિતી ભરો.', orderFailed:'❌ ઓર્ડર પ્લેસ થઈ શક્યો નથી. કૃપા કરીને ફરી પ્રયાસ કરો.', selectDate:'⚠️ કૃપા કરીને પહેલા તારીખ પસંદ કરો.', orderCancelled:'✅ તમારો ઓર્ડર કૅન્સલ થઈ ગયો.', resetLinkBad:'❌ આ રીસેટ લિંક અમાન્ય અથવા સમાપ્ત થઈ ગઈ છે.', confirmCancel:'આ ઓર્ડર કૅન્સલ કરવો છે?', welcomeUser:'🎉 સ્વાગત છે,', errLogin:'આગળ વધવા માટે સાઇન ઇન કરો.',
      tagline:'તાજું • ઘરનું બનાવેલું • ડોરસ્ટેપ ડિલિવરી', secureLogin:'🔐 સુરક્ષિત લોગિન', signInTitle:'ફરી સ્વાગત છે', emailLabel:'ઈમેલ', passwordLabel:'પાસવર્ડ', passwordPh:'તમારો પાસવર્ડ દાખલ કરો', passwordPh6:'ઓછામાં ઓછા 6 અક્ષર', confirmPwLabel:'પાસવર્ડ કન્ફર્મ કરો', confirmPwPh:'પાસવર્ડ ફરીથી દાખલ કરો', errEmail:'સાચું ઈમેલ સરનામું દાખલ કરો.', errPassword:'તમારો પાસવર્ડ દાખલ કરો.', errPassword6:'પાસવર્ડ ઓછામાં ઓછા 6 અક્ષરનો હોવો જોઈએ.', errConfirmPw:'પાસવર્ડ મેચ થતો નથી.', forgotPw:'પાસવર્ડ ભૂલી ગયા?', signInBtn:'સાઇન ઇન કરો', signUpTitle:'એકાઉન્ટ બનાવો', signUpSub:'રોજનું ટિફિન ઓર્ડર કરવા સાઇન અપ કરો.', phoneDeliveryHint:'ડિલિવરી સંપર્ક માટે વપરાશે.', createAccountBtn:'એકાઉન્ટ બનાવો', switchToSignUp:'એકાઉન્ટ નથી? <b onclick="showAuthMode(\'signup\')">સાઇન અપ કરો</b>', switchToSignIn:'પહેલેથી એકાઉન્ટ છે? <b onclick="showAuthMode(\'signin\')">સાઇન ઇન કરો</b>', backToSignIn:'← સાઇન ઇન પર પાછા', forgotTitle:'પાસવર્ડ રીસેટ કરો', forgotSub:'તમારું ઈમેલ દાખલ કરો, અમે રીસેટ લિંક મોકલીશું.', sendResetBtn:'રીસેટ લિંક મોકલો', resetTitle:'નવો પાસવર્ડ સેટ કરો', resetSub:'તમારા એકાઉન્ટ માટે નવો પાસવર્ડ પસંદ કરો.', newPasswordLabel:'નવો પાસવર્ડ', resetBtn:'પાસવર્ડ રીસેટ કરો', orDivider:'અથવા', resetLinkSent:'જો આ ઈમેલ રજિસ્ટર્ડ છે, રીસેટ લિંક મોકલી દેવાઈ છે.', passwordResetDone:'પાસવર્ડ અપડેટ થયો — હવે સાઇન ઇન કરી શકો છો.',
      loginTitle:'લોગિન અથવા સાઇન અપ', mobileLabel:'મોબાઇલ નંબર', mobilePh:'10 અંકનો મોબાઇલ નંબર દાખલ કરો',
      continueBtn2:'આગળ વધો', loginHint:'તમારું Google એકાઉન્ટ પસંદ કરો.', phoneFirstHint:'ફક્ત પહેલી વાર જરૂરી — ડિલિવરી સંપર્ક માટે.', completeSignup:'✓ સાઇન અપ પૂર્ણ કરો',
      verifyTitle:'એક છેલ્લું પગલું', googleWelcome:'✅ Google થી સાઇન ઇન થયું. ડિલિવરી સંપર્ક માટે મોબાઇલ નંબર દાખલ કરો.', nameLabel:'તમારું નામ', namePh:'તમારું પૂરું નામ લખો',
      otpLabel:'વેરિફિકેશન કોડ દાખલ કરો', verifyBtn:'વેરિફાય કરો', changeNum:'બીજું Google એકાઉન્ટ વાપરો', errName:'સાચું નામ દાખલ કરો (ફક્ત અક્ષરો).', errPhone:'સાચો 10 અંકનો મોબાઇલ નંબર દાખલ કરો.', errPickGoogle:'પહેલા Google બટન દબાવીને એકાઉન્ટ પસંદ કરો.',
      badgeFresh:'🌿 ફ્રોઝન નહીં', badgeCustom:'🍳 કસ્ટમાઇઝેબલ', badgeCOD:'💵 કેશ ઓન ડિલિવરી',
      freshStrip:'🌿 એકદમ તાજું: તમારું ભોજન ઓર્ડર પછી જ બને છે — ન ફ્રોઝન, ન વાસી.',
      deliveryDate:'📅 ડિલિવરી તારીખ',
      cutoffNote:'🕒 ઓર્ડર કટ-ઓફ સમય (IST)\n• નાસ્તો — એક રાત પહેલા 10:00 PM સુધી\n• લંચ — તે જ દિવસે 9:00 AM સુધી\n• ડિનર — તે જ દિવસે 3:00 PM સુધી\nકટ-ઓફ પછી આગલા ઉપલબ્ધ દિવસ માટે ઓર્ડર કરો.',
      selectMeals:'🍽️ તમારા મીલ પસંદ કરો', yourCart:'તમારી કાર્ટ', clearCart:'ખાલી કરો', cartEmpty:'કાર્ટ ખાલી છે. ઉપરથી મીલ ઉમેરો.',
      myOrders:'મારા ઓર્ડર', refresh:'🔄 રિફ્રેશ', viewPast:'🗓️ ડિલિવરી તારીખ પસંદ કરો', view:'જુઓ',
      cartTotal:'કુલ રકમ', checkout:'ચેકઆઉટ →', viewCart:'કાર્ટ જુઓ →', continueLbl:'આગળ વધો', okBtn:'ઓકે', rateKitchen:'આ કિચનને રેટ કરો', orSignInWith:'અથવા સાઇન ઇન કરો', signInWithGoogle:'Google થી સાઇન ઇન', itemAdded:'આઇટમ ઉમેરાયું', itemsAdded:'આઇટમ ઉમેરાયા', logout:'લોગઆઉટ',
      checkoutTitle:'📦 ડિલિવરી વિગતો', checkoutSub:'છેલ્લું પગલું — ઓર્ડર કન્ફર્મ કરો', backMenu:'← મેન્યુ પર પાછા',
      autofillNote:'✓ તમારું સાચવેલ સરનામું ઓટો-ફિલ થયું', township:'🏢 ટાઉનશિપ', society:'🏘️ સોસાયટી', flat:'🏠 ફ્લેટ નંબર',
      fullName:'👤 પૂરું નામ', verifiedMobile:'📱 મોબાઇલ નંબર (વેરિફાઇડ ✓)', payMethod:'💰 ચુકવણી પદ્ધતિ',
      payCOD:'💵 કેશ ઓન ડિલિવરી', payCODsub:'ટિફિન મળે ત્યારે કેશ આપો', payUPI:'💳 ઓનલાઇન ચુકવણી (UPI)', payUPIsub:'ઓર્ડર કરતાં જ QR કોડ મળશે', codNote:'કેશ ઓન ડિલિવરી — ટિફિન મળે ત્યારે ચૂકવો.',
      errSociety:'તમારી સોસાયટી પસંદ કરો.', errFlat:'કૃપા કરીને બ્લોક અને ફ્લેટ નંબર દાખલ કરો, દા.ત. D-706.',
      placeOrder:'📤 ઓર્ડર કરો', successTitle:'ઓર્ડર કન્ફર્મ થયો', promoHave:'કૂપન કોડ છે? અહીં દાખલ કરો', promoApply:'લાગુ કરો', promoApplied:'લાગુ થયો', discountLbl:'ડિસ્કાઉન્ટ', promoFirstDateNote:'(પ્રથમ ડિલિવરી તારીખ પર લાગુ)', promoEditNote:'ડિસ્કાઉન્ટવાળા ઓર્ડર એડિટ થઈ શકતા નથી — કૅન્સલ કરીને નવો ઓર્ડર કરો.', promoUseAtCheckout:'કાર્ટમાં કોડ પર ટૅપ કરીને લાગુ કરો', promoNewTag:'નવા ગ્રાહકો', policyTitle:'કૅન્સલેશન અને રિફંડ નીતિ', abDeliveryOnly:'આ એક ડિલિવરી-ઓન્લી કિચન છે', abBackToMenu:'મેનૂ પર પાછા જાઓ', abOpenNow:'હાલ ખુલ્લું છે', abCloses:'બંધ થશે', abClosedNow:'હાલ બંધ છે', abOpensAt:'ખુલશે', policyBody:'• ઓર્ડર ડિલિવરીની આગલી રાત્રે 10:00 PM સુધી કૅન્સલ થઈ શકે છે. તે પછી કરેલા ઓર્ડર, ઓર્ડર કર્યાની 30 મિનિટમાં કૅન્સલ થઈ શકે છે. ઓર્ડર એડિટ થઈ શકતો નથી — કૅન્સલ કરીને નવો ઓર્ડર કરો.<br>• જો તમે UPI થી ઓનલાઇન ચુકવણી કરી હોય અને ઓર્ડર કૅન્સલ થાય — ભલે તમે માન્ય સમયમાં કર્યો હોય કે અમે કોઈ કારણસર — પૂરી રકમ 24 કલાકમાં એ જ UPI ખાતામાં રિફંડ થાય છે.<br>• કૂપન ડિસ્કાઉન્ટવાળા ઓર્ડર એડિટ થઈ શકતા નથી; કૃપા કરીને કૅન્સલ કરીને નવો ઓર્ડર કરો.<br>• ભોજનમાં કોઈ સમસ્યા? ડિલિવરીના 2 કલાકમાં ફોટા સાથે WhatsApp કરો — અમે રિપ્લેસમેન્ટ કે પૂરો રિફંડ આપીશું.<br>• સપોર્ટ: 📞 +91 70434 91481 (WhatsApp ઉપલબ્ધ).', waFallback:'ઓર્ડર WhatsApp પર શેર કરો (optional) →', newOrder:'નવો ઓર્ડર કરો', trackOrderBtn:'ઓર્ડર ટ્રૅક કરો', okayBtn:'બરાબર', successConfirmNote:'તમારો ઓર્ડર કન્ફર્મ થઈ ગયો છે. તમે તેને ગમે ત્યારે My Orders સેક્શનમાં જોઈ અને ટ્રૅક કરી શકો છો.',
      addToCart:'🛒 કાર્ટમાં ઉમેરો', addedShort:'કાર્ટમાં ઉમેરાયું', addToCart2:'ઉમેરો', payNowUpi:'ઓનલાઇન ચુકવણી', payRefLbl:'પેમેન્ટ રેફરન્સ', srv_dup_date:'આ તારીખનો ઓર્ડર પહેલેથી છે.', srv_qty_limit:'એક દિવસમાં દરેક મીલનું માત્ર 1 ટિફિન. વધુ માટે કિચનનો સંપર્ક કરો.', srv_cancel_window:'આ ઓર્ડરની કેન્સલેશન વિન્ડો બંધ થઈ ગઈ છે.', srv_already_cancelled:'આ ઓર્ડર પહેલેથી કૅન્સલ છે.', srv_cancel_delivered:'ડિલિવર થયેલો ઓર્ડર કૅન્સલ થઈ શકે નહીં.', srv_not_yours:'આ ઓર્ડર તમારા એકાઉન્ટનો નથી.', srv_no_meal:'ઓર્ડર ખાલી છે — ઓછામાં ઓછું એક મીલ પસંદ કરો.', srv_office_off:'ઓફિસ ડિલિવરી હમણાં ઉપલબ્ધ નથી.', srv_home_off:'હોમ ડિલિવરી હમણાં ઉપલબ્ધ નથી.', srv_company_req:'કૃપા કરીને લિસ્ટમાંથી તમારી કંપની પસંદ કરો.', srv_empid_req:'એમ્પ્લોયી ID જરૂરી છે.', srv_blocked:'તમારું એકાઉન્ટ બ્લોક છે. સપોર્ટ: 70434 91481', srv_wrong_pw:'પાસવર્ડ ખોટો છે.', srv_no_account:'આ ઇમેઇલથી કોઈ એકાઉન્ટ મળ્યું નથી.', srv_email_exists:'આ ઇમેઇલથી એકાઉન્ટ પહેલેથી છે — સાઇન ઇન કરો.', srv_phone_taken:'આ મોબાઇલ નંબર બીજા એકાઉન્ટ સાથે જોડાયેલો છે.', srv_use_google:'આ એકાઉન્ટ Google Sign-In નું છે — "Sign in with Google" વાપરો.', srv_reset_sent:'જો આ ઇમેઇલ રજિસ્ટર્ડ છે, તો રીસેટ લિંક મોકલી છે.', srv_reset_bad:'આ રીસેટ લિંક અમાન્ય અથવા સમાપ્ત છે.', srv_reset_expired:'રીસેટ લિંક સમાપ્ત થઈ — નવી વિનંતી કરો.', scanToPay:'કોઈપણ UPI એપથી QR સ્કૅન કરો', copyId:'કૉપિ', pleaseWait:'એક ક્ષણ…', cancelWindowOver:'આ ઓર્ડરની કેન્સલેશન વિન્ડો બંધ થઈ ગઈ છે. કોઈપણ મદદ માટે કિચનનો સંપર્ક કરો.', limitTitle:'એક મીલનું એક ટિફિન', limitBody:'દરેક ગ્રાહક એક દિવસમાં 1 નાસ્તો, 1 લંચ અને 1 ડિનર ઓર્ડર કરી શકે છે. વધુ જથ્થા માટે કૃપા કરીને કિચનનો સંપર્ક કરો — અમે ખુશીથી ગોઠવી આપીશું.', limitCta:'કિચનનો સંપર્ક કરો', limitClose:'સમજાયું', subtotalLbl:'સબટોટલ', deliveryLbl:'ડિલિવરી', infoStripText:'ઓર્ડર સમય — નાસ્તો: આગલી રાત્રે 10 PM સુધી · લંચ: 9 AM સુધી · ડિનર: 3 PM સુધી', subPushLine:'રોજ ઓર્ડર કરો છો? સબ્સ્ક્રિપ્શન સેટ કરો', qaTitle:'મદદ', qaOnline:'● ઓનલાઇન', qaPh:'તમારો પ્રશ્ન લખો…', qaGreet:'નમસ્તે! 🙏 મેનૂ, ભાવ કે ડિલિવરી સમય — કંઈ પણ પૂછો.', qaSug1:'આજનું મેનૂ', qaSug2:'ડિલિવરી સમય', qaSug3:'ક્યાં ડિલિવર કરો છો?', qaOffTopic:'માફ કરશો, હું ફક્ત આ કिचन ના ભોજન સંબંધિત પ્રશ્નોમાં મદદ કરી શકું છું 🍱 મેનૂ, ભાવ, ડિલિવરી કે ઓર્ડર વિશે પૂછો!', qaLimit:'આજ માટે તમારા 10 પ્રશ્નો થઈ ગયા 🙏 કાલે ફરી પૂછી શકો છો — અથવા તરત મદદ માટે અમને કૉલ કરો.', qaErr:'આસિસ્ટન્ટ સાથે સંપર્ક ન થઈ શક્યો. ફરી પ્રયાસ કરો, અથવા અમને કૉલ કરો.', reorderBtn:'ફરી ઓર્ડર કરો', alreadyOrderedT:'આ તારીખનું {meal} તમે પહેલેથી ઓર્ડર કરી ચૂક્યા છો.', alreadyOrderedBtn:'મારો ઓર્ડર જુઓ', reorderDone:'આઇટમ તમારા કાર્ટમાં ઉમેરાયા', reorderNoSlot:'આ મીલ આગામી 3 દિવસ ઉપલબ્ધ નથી', lpTagline:'રોજ તાજું, ઘર જેવું ભોજન — સીધું તમારા ડોરસ્ટેપ સુધી.', lpOrderNow:'ઓર્ડર કરો', priceFrom:'₹{p} થી ભોજન', lpTodays:'આજના મીલ', lpOpen:'ઉપલબ્ધ', lpClosed:'બંધ', lpWhy:'આ કिचन જ કેમ', lpU1t:'રોજ તાજા બેચ', lpU1s:'દરરોજ નાના બેચમાં બને છે — ક્યારેય સ્ટોર કે ફ્રોઝન નહીં.', lpU2t:'ઘર જેવી સામગ્રી', lpU2s:'તાજા દળેલા મસાલા — કોઈ પેકેટ મિક્સ નહીં.', lpU3t:'સુરક્ષિત પેકેજિંગ', lpU3s:'દરેક મીલ સર્ટિફાઇડ ફૂડ-ગ્રેડ કન્ટેનરમાં.', lpSubT:'ડેઇલી ટિફિન સબ્સ્ક્રિપ્શન', lpSubS:'એક વાર સેટ કરો — ટિફિન રોજ આપોઆપ આવશે.', lpHow:'કેવી રીતે કામ કરે છે', lpH1:'મીલ પસંદ કરો અને કસ્ટમાઇઝ કરો', lpH2:'ડિલિવરી તારીખ અને સમય પસંદ કરો', lpH3:'ઓનલાઇન અથવા ડિલિવરી પર ચૂકવો', pubLogin:'લૉગિન', pubBack:'← પાછા', dtypeQ:'ડિલિવરી ક્યાં જોઈએ?', modeTitle:'ટિફિન ક્યાં જોઈએ?', modeSub:'એક વાર પસંદ કરો — ગમે ત્યારે બદલી શકો છો.', modeChange:'બદલો', dtHome:'ઘર', dtHomeSub:'સોસાયટી / ફ્લેટ', dtOffice:'ઓફિસ', dtOfficeSub:'કંપની / એમ્પ્લોયી', companyLbl:'તમારી કંપની પસંદ કરો', companyHint:'કંપની લિસ્ટમાં નથી? કિચનનો સંપર્ક કરો — અમે ઉમેરી દઈશું.', empIdLbl:'એમ્પ્લોયી ID', errCompany:'કૃપા કરીને તમારી કંપની પસંદ કરો', errEmpId:'કૃપા કરીને એમ્પ્લોયી ID દાખલ કરો', pubCta:'મેનૂ જુઓ અને ઓર્ડર કરો', pubCutoffLine:'લંચ બંધ <b>9:00 AM</b> · ડિનર <b>3:00 PM</b>', pubHookQ:'શું હેલ્ધી ભોજન ખરેખર <em>20-મિનિટ ડિલિવરી</em>માં બની શકે?', pubHookA:'ના બની શકે. આટલું ઝડપી આવતું ભોજન <b>તમારા ઓર્ડર પહેલાં જ બનેલું હોય છે</b> — ફરી ગરમ કરીને મોકલાય છે.', cmpUs:'અમારું કિચન', cmpThem:'ડિલિવરી એપ્સ', cmpU1:'ઘરે દળેલા તાજા મસાલા', cmpT1:'બલ્ક પેકેટ મસાલા', cmpU2:'રોજ નવું તેલ', cmpT2:'એ જ તેલ આખો દિવસ', cmpU3:'રોજ મર્યાદિત ઓર્ડર', cmpT3:'અનલિમિટેડ, બલ્ક કુકિંગ', cmpU4:'એ જ રસોઇયો, એ જ સ્વાદ', cmpT4:'દર વખતે અલગ કિચન', cmpU5:'ફિક્સ ભાવ, કોઈ એક્સ્ટ્રા નહીં', cmpT5:'સર્જ + પ્લેટફોર્મ ફી', cmpU6:'હલકું, રોજનું ભોજન', cmpT6:'ભારે રેસ્ટોરન્ટ ફૂડ', cmpU7:'કિચન જે તમે જોઈ શકો', cmpT7:'કિચન જે ક્યારેય નહીં દેખાય', cmpQualT:'ક્વોલિટી, ક્વોન્ટિટી નહીં.', cmpQualS:'અમે રોજના ઓર્ડર મર્યાદિત રાખીએ છીએ — જેથી દરેક ટિફિનને પૂરો સમય મળે.', cmpChip:'🍱 રોજ મર્યાદિત ઓર્ડર — હંમેશા તાજું', lpPosT:'આ ફટાફટ-ડિલિવરી એપ નથી', lpPosS:'આ તમારું રોજનું કિચન છે — planned, તાજું અને હંમેશા સમયસર.', lpPos1:'Fixed time slots પર ડિલિવરી — 10-મિનિટવાળી રેસ નહીં.', lpPos2:'હલકું, પોષણભર્યું ઘર જેવું ભોજન — રેસ્ટોરન્ટનું ભારે તેલ-મસાલા નહીં.', lpPos3:'સીધા fixed ભાવ — ના surge, ના hidden કે platform charges.', lpPos4:'રોજ એક જ ભરોસાપાત્ર કિચન — દરેક ટિફિનમાં એ જ અપનાપણ.', navMenuShort:'મેનૂ', navProfileShort:'પ્રોફાઇલ', pfTitle:'મારી પ્રોફાઇલ', pfAddr:'સેવ કરેલું સરનામું', pfFlatLbl:'ફ્લેટ / બ્લોક નં.', pfSave:'સરનામું સેવ કરો', addrSaved:'સરનામું સેવ થયું', pfQuick:'ક્વિક લિંક', pfLang:'ભાષા', payWithUpiBtn:'ચુકવણી કરો', orScan:'અથવા QR કોડ સ્કૅન કરો', upiPayNote:'🔒 UPI થી સુરક્ષિત ચુકવણી. રકમ પહેલેથી ભરેલી છે — બસ તમારી UPI એપમાં અપ્રૂવ કરો.', copied:'UPI ID કૉપિ થઈ', updateCart:'✓ કાર્ટ અપડેટ કરો', addedToCart:'કાર્ટમાં ઉમેરાયું', customizable:'કસ્ટમાઇઝેબલ', customizeBtn:'કસ્ટમાઇઝ કરો', chooseSize:'સાઇઝ પસંદ કરો', sizeRequired:'જરૂરી · કોઈ 1 પસંદ કરો', addOns:'એડ-ઓન', dahiShort:'દહીં', extraSabziShort:'એક્સ્ટ્રા શાક', freshCookedDesc:'રોજ નાના બેચમાં તાજું બને છે — ક્યારેય સ્ટોર કે ફ્રોઝન નહીં.', selectSabzi:'શાક પસંદ કરો', rotiType:'રોટી પ્રકાર', plain:'પ્લેન', butter:'બટર', deliveryTime:'⏰ ડિલિવરી સમય', tiffinType:'🍱 તમારું ટિફિન પસંદ કરો', miniTiffin:'મિની ટિફિન', fullTiffin:'ફુલ ટિફિન',
      extraRoti:'એક્સ્ટ્રા રોટી', addDahi:'દહીં ઉમેરો', extraSabzi:'એક્સ્ટ્રા શાક', howMany:'કેટલા ટિફિન?', unitPrice:'યુનિટ ભાવ',
      perTiffin:'/ ટિફિન', specialInstr:'📝 ખાસ સૂચનાઓ (વૈકલ્પિક)', notePh:'દા.ત. ઓછું તીખું, ડુંગળી વગર...',
      backApp:'← એપ પર પાછા', remove:'દૂર કરો', cancelOrder:'✖ રદ કરો', editOrder:'બદલો', editLoaded:'ઓર્ડર લોડ થયો — ફેરફાર કરીને ચેકઆઉટ કરો',
      closedBreakfast:'સેમ-ડે બ્રેકફાસ્ટ ઉપલબ્ધ નથી — એક દિવસ પહેલા ઓર્ડર કરો.', kitchenClosedMsg:'આ તારીખે કિચન બંધ છે — બીજી તારીખ પસંદ કરો.', kitchenTempClosedTitle:'કિચન હાલમાં બંધ છે', kitchenTempClosedMsg:'અમે હાલમાં બંધ છીએ. અમે જલ્દી પાછા આવીશું — આભાર!', happyCustomers:'ખુશ ગ્રાહકોએ ઓર્ડર કર્યો', orderedForThisMeal:'ટિફિન અત્યાર સુધી ઓર્ડર થયા', beingPrepared:'હમણાં બની રહ્યા છે', onlyLeftToday:'આજ માટે ફક્ત {n} ઉપલબ્ધ છે', soldOutToday:'આજ માટે સોલ્ડ આઉટ', soldOutTitle:'આ મીલના સ્લોટ ભરાઈ ગયા', soldOutSub:'દરેક ટિફિન તાજું રાખવા અમે મર્યાદિત જથ્થામાં જ બનાવીએ છીએ. બીજું મીલ કે દિવસ પસંદ કરો.',
      closedLunch:'આજના લંચનું બુકિંગ બંધ (9:00 AM સુધી હતું).',
      closedDinner:'આજના ડિનરનું બુકિંગ બંધ (3:00 PM સુધી હતું).', closedBkTom:'આવતીકાલના બ્રેકફાસ્ટનું બુકિંગ બંધ (ગઈકાલે રાત્રે 10:00 PM સુધી હતું).',
      closedTomorrow:'આવતીકાલનું બુકિંગ બંધ (10:00 PM સુધી હતું).',
      cancelClosed:'રદ કરવાની સમયમર્યાદા પૂરી થઈ ગઈ છે.',
      dupMsg:'આ તારીખ માટે ઓર્ડર પહેલેથી છે. ફેરફાર માટે સ્ટોર સપોર્ટને કૉલ કરો: 70434 91481.',
      noUpcoming:'હમણાં કોઈ આગામી ઓર્ડર નથી. મેનૂમાંથી મીલ ઉમેરીને ઓર્ડર કરો.', noHistory:'આ તારીખે કોઈ ઓર્ડર મળ્યો નથી.', navHome:'હોમ', navCart:'કાર્ટ', navPast:'જૂના ઓર્ડર', navAbout:'અમારા વિશે', navSub:'સબ્સ્ક્રિપ્શન', navHomeShort:'હોમ', navCartShort:'કાર્ટ', navSubShort:'સબ્સ્ક્રાઇબ', navBulkShort:'બલ્ક', schedTitle:'📅 મીલ શેડ્યૂલ કરો', schedSub:'કયા દિવસ માટે ઓર્ડર કરવો છે?', schedOrderingFor:'ઓર્ડર થઈ રહ્યો છે', schedBackToday:'આજ પર પાછા', schedDayLbl:'દિવસ', schedMealLbl:'મીલ', schedContinue:'મેનૂ પર જાઓ', exitConfirmTitle:'ઍપ બંધ કરો?', exitConfirmSub:'તમે લૉગઆઉટ થઈ જશો.', exitConfirmBtn:'બહાર નીકળો', exitConfirmSubGuest:'શું તમે ખરેખર બહાર નીકળવા માંગો છો?',
      bulkOrderRow:'બલ્ક / પાર્ટી ઓર્ડર', bulkMyRequests:'મારી બલ્ક રિક્વેસ્ટ', bulkTitle:'🎉 બલ્ક / પાર્ટી ઓર્ડર',
      bulkSub:'ગ્રુપ કે ઇવેન્ટ માટે ઓર્ડર કરો છો? વિગતો જણાવો — કિચન ઉપલબ્ધતા અને ભાવ કન્ફર્મ કરશે.',
      bulkMealLbl:'મીલ', bulkQtyLbl:'જથ્થો (ઓછામાં ઓછા 5)', bulkDateLbl:'ડિલિવરી તારીખ', bulkAddrLbl:'ડિલિવરી સરનામું',
      bulkAddrPh:'ઓફિસ / ઇવેન્ટનું સરનામું', bulkNotesLbl:'નોંધ (વૈકલ્પિક)', bulkNotesPh:'દા.ત., ફક્ત વેજ, ડુંગળી વગર...',
      bulkSubmit:'બલ્ક રિક્વેસ્ટ મોકલો', limitBulkCta:'🎉 બલ્ક ઓર્ડર કરો',
      bulkErrQty:'ઓછામાં ઓછા 5 ટિફિન દાખલ કરો.', bulkErrDate:'ડિલિવરી તારીખ પસંદ કરો.',
      bulkSubmitted:'રિક્વેસ્ટ મોકલાઈ — કિચન જલ્દી કન્ફર્મ કરશે.', bulkApproved:'મંજૂર', bulkDeclined:'નકારેલ', bulkPending:'બાકી', scheduleBtn:'શેડ્યૂલ કરો', onbSkip:'છોડો', onb1Title:'તાજું ટિફિન, રોજ', onb1Body:'ઓર્ડર પછી જ બને છે — ન ફ્રોઝન, ન વાસી.', onb2Title:'હોમ અને ઓફિસ ડિલિવરી', onb2Body:'જ્યાં પણ હો — ઘરે કે ઓફિસે, ઓર્ડર કરો.', onb3Title:'આજે ઓર્ડર કરો અથવા શેડ્યૂલ કરો', onb3Body:'કાલનું ટિફિન પ્લાન કરવું છે? નીચે "Schedule Your Meal" વાપરો.', onb4Title:'સરળ પેમેન્ટ', onb4Body:'UPI થી પે કરો અથવા સીધું કેશ ઓન ડિલિવરી — જે પસંદ હોય.', onbGetStarted:'શરૂ કરો', navAiShort:'AI મદદ',  navOrdersShort:'ઓર્ડર', subTitle:'🔁 સબ્સ્ક્રિપ્શન', subSub:'એક વાર સેટ કરો — તમારું ડેઇલી ટિફિન આપોઆપ ઓર્ડર થઈ જશે.', subActive:'ચાલુ પ્લાન', subDaysWeek:'દિવસ/અઠવાડિયું', subWeekdaysSub:'સોમ–શુક્ર, બધા મીલ', subAllDaysSub:'દરરોજ, બધા મીલ', subClearSub:'ફરી શરૂ કરો', subMealsPerWeek:'મીલ/અઠવાડિયું શેડ્યૂલ થયા', subSkipped:'સ્કિપ કર્યા', subSkipBtn:'દિવસ સ્કિપ કરો', subCancelBtn:'પ્લાન રદ કરો', subEditNote:'નીચે બદલીને અપડેટ દબાવો', subPickMeals:'મીલ પસંદ કરો', subPickDays:'દિવસ પસંદ કરો', subWeekdays:'સોમ–શુક્ર', subAllDays:'સાતેય દિવસ', subClear:'સાફ', subDateRange:'તારીખ રેન્જ', subStart:'શરૂ', subEnd:'અંત', subDelivery:'ડિલિવરી', subUpdate:'પ્લાન અપડેટ', subStart2:'સબ્સ્ક્રિપ્શન શરૂ', subAnySabzi:'શેફની પસંદ', subSaved:'સબ્સ્ક્રિપ્શન સફળતાપૂર્વક સેવ થયું.', subCancelled:'સબ્સ્ક્રિપ્શન રદ થયું', subCancelConfirm:'સબ્સ્ક્રિપ્શન રદ કરો?', subSkipDone:'દિવસ સ્કિપ થયો', subUnskipDone:'સ્કિપ દૂર', subPickSkipDate:'સ્કિપ માટે તારીખ પસંદ કરો', subEndAfter:'એન્ડ ડેટ સ્ટાર્ટ પછી હોવી જોઈએ', subStartInfo:'કાલથી આગળ', navContact:'સંપર્ક કરો', contactTitle:'📞 સંપર્ક કરો', contactSub:'તમારી વાત સાંભળવી અમને ગમે છે', contactInfoTitle:'ℹ️ માહિતી', contactAddrLbl:'લોકેશન', contactAreaLbl:'ડિલિવરી વિસ્તાર', contactHoursLbl:'ડિલિવરી સમય',
      aboutTitle:'ℹ️ અમારા વિશે', aboutSub:'અમારું ટિફિન કેમ અલગ છે', aboutSwipe:'← વધુ જોવા માટે સ્વાઇપ કરો →',
      aboutContact:'📞 કોઈ સવાલ? અમે એક કોલ દૂર છીએ.', locGateTitle:"લોકેશન જરૂરી છે", locGateSub:"નજીકના કિચન બતાવવા માટે લોકેશન જોઈએ — તેના વગર એપ કામ નહીં કરે.", locGateBtn:"📍 લોકેશન ચાલુ કરો", locGateDeniedSub:"આ સાઇટ માટે લોકેશન બ્લોક છે. એડ્રેસ બાર પાસે 🔒/ⓘ આઇકન પર ટેપ કરો → Permissions → Location → Allow, પછી Retry દબાવો.", locGateUnavailSub:"પરમિશન બરાબર છે, પણ તમારા ફોનનું લોકેશન/GPS બંધ છે. ફોન સેટિંગ્સમાં લોકેશન ચાલુ કરો, પછી Retry દબાવો.", locGateChecking:"⏳ ચકાસી રહ્યા છીએ…", locGateRetryBtn:"🔄 ફરી પ્રયત્ન કરો"
    }
  };
  let LANG = 'en';
  function t(k) { return (T[LANG] && T[LANG][k]) || T.en[k] || k; }
  function applyTheme(mode){
    let effective = mode;
    if (mode === 'system' || !mode) {
      effective = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', effective === 'dark' ? 'dark' : 'light');
    const tc=document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', effective === 'dark' ? '#14151f' : '#6366f1');
  }
  // Theme read helper — vendor key, phir shared user-level key, phir default
  function readTheme(){
    let m = storeGet('fbt_theme');
    if(!m){ try{ const s=localStorage.getItem('nn_theme_shared'); m = s?JSON.parse(s):null; }catch(e){} }
    return m || 'light';
  }
  function initTheme(){
    const saved = readTheme();
    applyTheme(saved);
    // System badle to (agar 'system' chuna hai) live update ho
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (readTheme() === 'system') applyTheme('system');
      });
    } catch(e){}
  }
  function setLang(l) {
    if (!T[l]) l = 'en';
    LANG = l;
    try { localStorage.setItem('fbt_lang', l); } catch(e){}
    document.documentElement.lang = (l === 'hinglish' ? 'en' : l);
    // ⚠️ Pehle sirf init() ke waqt EK BAAR initLangSelectors() chalta tha. Agar
    // koi bhi select.js-lang element us EXACT waqt options se khaali reh gaya
    // (Profile/Admin panel jaise sections), to yahan neeche `.value=l` set karne
    // se kuch nahi hota — browser silently ignore karta hai agar koi matching
    // <option> na ho, aur dropdown HAMESHA ke liye blank dikhta reh jaata (login/
    // discovery ke selects theek dikhte kyunki unke options waqt pe ban gaye the).
    // Ab har setLang() call pe options FIR SE guaranteed bante hain — value set
    // karne se pehle — isliye ye khaali-dropdown bug kabhi wapas nahi aa sakta.
    initLangSelectors();
    document.querySelectorAll('select.js-lang').forEach(s => { s.value = l; });
    applyLang();
  }
  function applyLang() {
    document.querySelectorAll('[data-i]').forEach(el => { el.textContent = t(el.getAttribute('data-i')); });
    document.querySelectorAll('[data-i-html]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i-html')); });
    document.querySelectorAll('[data-ph]').forEach(el => { el.placeholder = t(el.getAttribute('data-ph')); });
    if (SESSION && SESSION.name) document.getElementById('profileName').textContent = '👤 ' + SESSION.name;
    renderDateSelector(); renderMealTabs(); renderMenuDateTime(); renderMealPanel(); renderCart(); renderAbout(); renderHome(); renderProfile();
    if (isLoggedIn()) { const hd=document.getElementById('histDate'); loadMyOrders(hd&&hd.value?hd.value:fmtYMD(dateWithOffset(0))); }
  }
  function initLangSelectors() {
    const opts = Object.keys(LANGS).map(k => `<option value="${k}">${LANGS[k]}</option>`).join('');
    document.querySelectorAll('select.js-lang').forEach(s => { s.innerHTML = opts; s.value = LANG; });
  }
  // ═══════ IST TIME ═══════
  // Playwright tests seed window.__TEST_IST_OVERRIDE (a fixed early-morning ISO
  // string, via addInitScript — see tests/helpers.js) BEFORE this script runs, so
  // every test gets a deterministic "current time," never flaky depending on
  // when in the day the suite happens to execute (cutoff logic below is real
  // wall-clock-sensitive: lunch/dinner/etc. legitimately close after their
  // configured cutoff, which used to make "Today" tests fail only in the
  // afternoon/evening).
  let __istOverride = (typeof window !== 'undefined' && window.__TEST_IST_OVERRIDE) || null;
  function getISTNow() {
    if (__istOverride) return new Date(__istOverride);
    try { return new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Kolkata' })); } catch(e){ return new Date(); }
  }
  function dateWithOffset(off){ const n=getISTNow(); return new Date(n.getFullYear(),n.getMonth(),n.getDate()+off); }
  function fmtYMD(d){ const p=x=>String(x).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  const WEEKDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  function weekdayKey(d){ return WEEKDAYS[d.getDay()]; }
  function fmtLabel(d){ const dd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return dd[d.getDay()]+', '+String(d.getDate()).padStart(2,'0')+' '+mo[d.getMonth()]; }
  // meal type lookup + cutoff — "cutoff" is stored as "HH:MM" on the meal-type
  // record now (admin-editable per meal, see CFG.mealTypes / defaultMealTypes()).
  function mealType(meal){ return (CFG.mealTypes||[]).find(mt=>mt.key===meal); }
  function hhmmToMins(hhmm){ const p=String(hhmm||'').split(':'); const h=parseInt(p[0],10), m=parseInt(p[1],10); return (isFinite(h)&&isFinite(m))?(h*60+m):null; }
  function cutoffMins(meal){
    const mt=mealType(meal); const v=mt&&hhmmToMins(mt.cutoff);
    return (typeof v==='number'&&v>=0&&v<1440)?v:570;   // 9:30 AM generic fallback if meal/cutoff missing
  }
  function formatMinutesAsClock(mins){
    mins=((mins%1440)+1440)%1440;
    const h=Math.floor(mins/60), m=mins%60;
    const ap=h>=12?'PM':'AM'; let h12=h%12; if(h12===0)h12=12;
    return h12+':'+String(m).padStart(2,'0')+' '+ap;
  }
  function mealsAvail(off) {
    const n=getISTNow(); const mins=n.getHours()*60+n.getMinutes();
    const A=(ok,why)=>({ok:ok,why:why||''});
    const dstr=fmtYMD(dateWithOffset(off));
    const out={};
    // ⚠️ Emergency close — planned closedDates se PEHLE aur SABHI din (aaj + future)
    // ke liye check karo. closedDates ek SPECIFIC calendar date block karta hai
    // (pre-planned); tempClosed admin ka turant "sab kuch abhi pause karo" switch
    // hai (jaise gas leak, staff na hona) — quick-close se duration di gayi ho to
    // us time ke baad apne aap khul jaata hai, warna jab tak khud OFF na kare.
    if(isKitchenEmergencyClosed()){
      const msg=CFG.tempClosedMsg||t('kitchenClosedMsg');
      MEALS.forEach(m=>out[m]=A(false,msg)); return out;
    }
    if((CFG.closedDates||[]).indexOf(dstr)>=0){
      const closedMsg=t('kitchenClosedMsg');
      MEALS.forEach(m=>out[m]=A(false,closedMsg)); return out;
    }
    // Per-meal cutoff (admin Setup se configurable — mt.cutoff/.cutoffAheadDay),
    // delivery din pe apply hota hai:
    //  cutoffAheadDay:true (breakfast-style)  → raat pehle configured time tak, kabhi same-day nahi
    //  cutoffAheadDay:false (lunch/dinner/etc) → usi din configured time tak
    (CFG.mealTypes||[]).forEach(mt=>{
      const cm=cutoffMins(mt.key);
      if(mt.cutoffAheadDay){
        if(off===0) out[mt.key]=A(false, t('closedBreakfast')||closedMsgFor(mt));
        else if(off===1) out[mt.key]= mins<cm ? A(true) : A(false, closedMsgFor(mt,cm));
        else out[mt.key]=A(true);
      } else {
        if(off===0) out[mt.key]= mins<cm ? A(true) : A(false, closedMsgFor(mt,cm));
        else out[mt.key]=A(true);
      }
    });
    return out;
  }
  // Admin Setup se jo meals ON hain sirf wahi customer ko dikhte hain. Sab meals ab
  // uniform hain (har ek ka apna .enabled hai) — purana meal4-only opt-in special
  // case hata diya, sab meals same tarah opt-out (enabled defaults true) hai.
  function enabledMeals(){
    const list=(CFG.mealTypes||[]).filter(mt=>mt.enabled!==false).map(mt=>mt.key);
    return list.length?list:MEALS;   // sab OFF ho jaye to app khali na dikhe
  }
  // ═══════ STORAGE + SESSION ═══════
  // Multi-tenant: non-default vendor ki keys namespace ho jaati hain (vendorId_key) —
  // taaki 2 vendors ka data same device pe mix na ho. Default vendor (abhi ke live users)
  // bilkul same purani keys use karta rehta hai, koi migration/breakage nahi.
  function nsKey(k){ return IS_DEFAULT_VENDOR ? k : (VENDOR_ID+'_'+k); }
  function storeSet(k,v){ try{ if(k==='fbt_session'&&v&&typeof v==='object'&&!v.vid) v.vid=VENDOR_ID; localStorage.setItem(nsKey(k),JSON.stringify(v)); }catch(e){} }
  function storeGet(k){ try{ const v=localStorage.getItem(nsKey(k)); return v?JSON.parse(v):null; }catch(e){ return null; } }
  function storeDel(k){ try{ localStorage.removeItem(nsKey(k)); }catch(e){} }
  // ⚠️ Cross-vendor shared session hata diya gaya — ek global (bina-namespace)
  // key me har login save hota tha, aur agar is vendor ka apna session na mile
  // to WAHI shared token silently utha ke "logged in" maan liya jaata tha, bina
  // ye check kiye ki wo asal me abhi wale customer ka hi hai ya kisi purane/
  // doosre account ka (jaise shared/test device pe). Isi se "kabhi-kabhi default
  // User 3 se login ho jaata hai" wali bug aati thi — koi bhi naya vendor visit,
  // agar device pe koi purana cached session pada ho, use silently apna lega
  // bina customer ne "Sign in with Google" tak dabaya ho. SHARED_SESSION_KEY
  // sirf legacy cleanup ke liye (neeche logout()) rakha gaya hai.
  const SHARED_SESSION_KEY = 'nn_session_shared';
  let SESSION = storeGet('fbt_session');
  function isLoggedIn(){ return !!(SESSION && SESSION.token); }
  let __toastT=null;
  // XSS guard — user ka koi bhi text innerHTML me jaane se pehle escape
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function showToast(msg,type=''){
    const el=document.getElementById('toast');
    el.textContent=msg; el.className='toast '+type; el.classList.add('show');
    if(__toastT) clearTimeout(__toastT);                    // purana timer cancel (warna naya toast jaldi gayab hota tha)
    __toastT=setTimeout(()=>{ el.classList.remove('show'); __toastT=null; },3800);
  }
  // Server error → user ki chuni hui language me (code-based translation)
  function srvMsg(j){
    if(j && j.code){ const k='srv_'+j.code; const s=t(k); if(s && s!==k) return s; }
    return (j && j.message) || t('errNetwork');
  }
  function apiPost(p, _tries){
    _tries = (_tries==null) ? 2 : _tries;   // total 2 koshish (cold GAS ke liye)
    const body=Object.assign({},p,{vendorId:VENDOR_ID, authVendorId:(SESSION&&SESSION.vid)||VENDOR_ID});
    const ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
    // 45s tha — measured cold-start ~5s hi lagta hai, isliye 45s×2 tries=90s worst-case
    // ek call ke liye bahut zyada tha (login me 3-4 sequential calls milke minutes
    // khinch jaate the). 20s abhi bhi generous margin hai, par fail jaldi dikhega.
    const timer = setTimeout(()=>{ try{ ctrl&&ctrl.abort(); }catch(e){} }, 20000);
    const opts = { method:'POST', body:JSON.stringify(body) };
    if(ctrl) opts.signal = ctrl.signal;
    // ⚠️ bad-JSON wala retry .then() ke andar hota hai. Wo retry jab khud fail hota
    // hai to uska rejection niche wale .catch() me aata hai — jahan _tries abhi bhi
    // 2 hai — to wo DOBARA retry kar deta tha (total 3 round-trip, cold GAS pe
    // ~60s tak user login screen pe atka rehta). Ye flag dono ko ek hi baar rakhta hai.
    let __retried = false;
    return fetch(GOOGLE_SCRIPT_URL, opts)
      .then(r=> r.text())                    // pehle text lo — cold GAS redirect kabhi HTML/empty deta hai
      .then(txt=>{
        clearTimeout(timer);
        let j=null;
        try{ j = JSON.parse(txt); }
        catch(e){
          // JSON nahi mila (HTML/khaali/redirect-page). Ek baar chup-chaap retry.
          if(_tries>1){ __retried = true; return new Promise(res=>setTimeout(res,1200)).then(()=>apiPost(p,_tries-1)); }
          dbgLog({ev:'POST_badjson', act:p&&p.action, body:String(txt).slice(0,80)});
          throw new Error('bad_json');
        }
        if(j&&j.status==='invalid_session'){ dbgLog({ev:'POST_invalid', act:p&&p.action, vid:VENDOR_ID}); }
        return j;
      })
      .catch(err=>{
        clearTimeout(timer);
        // abort/network fail — ek baar retry, warna throw karo (upar ka .catch toast dega)
        if(_tries>1 && !__retried){ return new Promise(res=>setTimeout(res,1200)).then(()=>apiPost(p,_tries-1)); }
        throw err;
      });
  }
  // ═══════ VIEW NAV ═══════
  function closeAllPopups(){
    ['mealSheet','orderModal','limitModal','modeModal'].forEach(x=>{ const e=document.getElementById(x); if(e) e.classList.add('hidden'); });
  }
  
  let lastGoodView = null;
  function showView(id){
    // Agar koi galat/unknown id aa jaye to SAB views hide ho jaate the → blank white page.
    // Ab aisi id ko chup-chaap safe view pe redirect kar dete hain.
    if(ALL_VIEWS.indexOf(id) < 0) id = isLoggedIn() ? 'homeView' : 'dscView';
    // Logged-in user ko login page kabhi mat dikhao. Rapid back/forward pe
    // recoverIfBlank/stale state isi wajah se login flash karta tha.
    if(id==='authPage' && isLoggedIn()) id='homeView';
    // ⚠️ Kitchen temporarily closed (emergency close) → customer ki koi bhi
    // navigation (kahin se bhi — bottom nav, back button, deep link, restore)
    // isi ek gate screen pe le jaani chahiye. Ye SINGLE enforcement point hai
    // (showView()) isliye alag-alag jagah check duplicate nahi karna padta — jo
    // bhi view khulwane ki koshish kare, tempClosed hone par yahi jeetega.
    // Admin/superadmin apna alag login hai — customer ke tempClosed se unka
    // koi lena dena nahi.
    if(isKitchenEmergencyClosed() && isLoggedIn() && id!=='kitchenClosedView' && ['adminPanel','adminLogin','superPanel','superLogin'].indexOf(id)<0){
      id='kitchenClosedView';
    }
    if(id==='kitchenClosedView') renderKitchenClosedGate();
    closeAllPopups();                                       // page badle to koi popup upar chipka na rahe
    // authPage/pubView transient screens hai — inko fbt_view me SAVE nahi karna.
    // Warna recoverIfBlank() baad me inhe "last good view" samajh ke restore kar deta
    // hai, aur logged-in user ko random login page dikh jaata hai.
    // profileView bhi nahi — wo sirf bottom-nav ke Profile button se khulna chahiye.
    try{ if(['homeView','page1','cartView','ordersView','subView','aboutView','adminPanel'].indexOf(id)>=0) storeSet('fbt_view',id); }catch(e){}
    ALL_VIEWS.forEach(v=>{ const el=document.getElementById(v); if(el) el.classList.toggle('hidden', v!==id); });
    // dscView kisi bhi raste se khule (fallback/recover se bhi), uska data load hona
    // chahiye. Pehle sirf openDiscovery() load karta tha, isliye fallback se aane par
    // "Available kitchens" ke neeche khaali page dikhta tha.
    if(id==='dscView'){ startDiscoveryFlow(); }
    // ⚠️ Profile aur Admin panel me kabhi-kabhi language dropdown + kuch labels
    // blank dikhte the (boot ke waqt kisi wajah se translation apply hone se
    // reh gaya ho). Ye do views jab bhi khulte hain, translations ek baar zaroor
    // fresh laga do — bilkul safe hai (idempotent), aur ye class of bug hamesha
    // ke liye khatam ho jaata hai.
    if(id==='profileView'||id==='adminPanel'){ try{ setLang(LANG); }catch(e){} }
    lastGoodView = id;
    // ⚠️ Ek synchronous window.scrollTo(0,0) yahin turant call karna kaafi
    // nahi tha — lambi page (jaise Home, bahut scroll ho chuki) se ek CHOTI
    // page (jaise bulkView) pe switch karte waqt, real mobile Chrome/WebView
    // apna "scroll anchoring" try karta hai aur reset ko fight kar deta hai:
    // naya view render hota hai, par viewport wahi purani scroll position pe
    // atka reh jaata hai jo nayi (chhoti) page ke actual content se aage
    // nikal chuki hoti hai — result: sirf khaali overscroll area dikhta hai,
    // page bilkul blank lagta hai (bottom-nav ke alawa), jab tak user khud
    // upar scroll na kare. Do bar requestAnimationFrame se agle paint ke
    // BAAD scroll karte hain — tab tak naya (chhota) layout settle ho chuka
    // hota hai, isliye reset asal me tikta hai.
    requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ window.scrollTo(0,0); }); });
    updateBottomNav(id); }

  // ═══════ BLANK-SCREEN GUARD ═══════
  // App background se wapas aaye aur (kisi bhi wajah se) koi view visible na ho,
  // to khaali safed page dikhta tha. Ye har baar check karke wapas la deta hai.
  function noViewVisible(){
    return !ALL_VIEWS.some(v=>{ const el=document.getElementById(v); return el && !el.classList.contains('hidden'); });
  }
  function recoverIfBlank(){
    if(!noViewVisible()) return;
    let target = lastGoodView;
    if(!target){
      try{ target = storeGet('fbt_view'); }catch(e){}
      // Reload ke baad sirf inhi views ko restore karna hai. profileView / authPage /
      // pubView purane localStorage me pade ho sakte hai — unhe ignore karo, warna
      // profile apne aap khul jaata hai. (lastGoodView pe ye filter NAHI lagta —
      // agar user abhi profile pe hi hai to app wapas aane par profile hi chahiye.)
      let RESTORABLE = ['homeView','page1','cartView','ordersView','subView','aboutView','adminPanel','adminLogin','dscView','superPanel','superLogin'];
      // Customer APK build — vendor/admin views ko kabhi restore mat karo, chahe
      // fbt_view me pade ho (purani plain-web session ka leftover ho sakta hai).
      if(APK_MODE==='customer') RESTORABLE = RESTORABLE.filter(v=>['adminPanel','adminLogin','superPanel','superLogin'].indexOf(v)<0);
      if(target && RESTORABLE.indexOf(target)<0) target = null;
    }
    // ⚠️ CRITICAL: showView() seedha yahan se lagta hai, bina kisi backend
    // credential-check ke — showOrdersPage()/adminLogin() jaise wrapper functions
    // ke apne guard yahan BYPASS ho jaate hain. Matlab session expire/logout ke
    // baad, ya kisi bhi vendor-switch/refresh/back-button pe, agar fbt_view me
    // stale customer/admin/super view pada tha (purani session se), seedha khul
    // jaata tha — bina ye check kiye ki abhi genuinely logged-in/validated hai ya
    // nahi. Isi se ek real bug mila: customer ne kisi vendor card pe click kiya,
    // aur us vendor ke liye stale (galat/purana) cached admin credentials hone ki
    // wajah se, use Admin Orders panel dikh gaya — pehle hi login/validate hue
    // bina. Fix: sirf-cached (adminCreds/superCreds set hai) kaafi nahi — ACTUAL
    // backend-confirmed flag (adminCredsValidated/superCredsValidated) chahiye.
    const CUSTOMER_ONLY = ['homeView','page1','cartView','ordersView','subView'];
    if(target && CUSTOMER_ONLY.indexOf(target)>=0 && !isLoggedIn()) target = null;
    // ⚠️ adminCredsValidated===false ka matlab HAMESHA "invalid/stale creds" nahi
    // hota — jab tak restoreAdmin() (finishInit() ke andar, jo khud vendor-bootstrap
    // fetch resolve hone ke BAAD chalta hai) apna backend round-trip complete na
    // kare, ye flag false hi rahega, chahe creds bilkul valid hi hon. Ye function
    // (recoverIfBlank) page load ke ~80ms baad hi 'pageshow' se chal jaata hai —
    // restoreAdmin() ko apna network call karne ka mauka milne se BHI PEHLE. Pehle
    // yahan seedha customer login (authPage) dikha diya jaata tha, aur restoreAdmin()
    // ka asli result baad me aata — matlab HAR admin refresh pe 1-2 second ke liye
    // login page flash hota tha, ek baar nahi. Fix: agar raw cached creds maujood
    // hain (matlab restoreAdmin() abhi chalega ya chal raha hai), kuch mat badlo —
    // jo bhi loader dikh raha hai usse dikhne do, normal boot flow apna kaam poora
    // karega. Sirf creds bilkul cached na hone par hi customer fallback pe jao.
    if(target==='adminPanel' && !adminCredsValidated){
      if(storeGet('fbt_admin')) return;
      target = null;
    }
    if(target==='superPanel' && !superCredsValidated){
      if(storeGet('fbt_super')) return;
      target = null;
    }
    // Admin APK build — recovery hamesha admin par hi resolve ho, kabhi customer
    // home/discovery pe nahi.
    if(APK_MODE==='admin'){ showView(adminCredsValidated ? 'adminPanel' : 'adminLogin'); return; }
    // ?Admin=<vendorSlug> — same treatment as Admin APK: recovery always
    // resolves to admin, never customer landing (mirrors finishInit()'s
    // HAS_ADMIN_PARAM branch above).
    if(HAS_ADMIN_PARAM){ showView(adminCredsValidated ? 'adminPanel' : 'adminLogin'); return; }
    // Super Admin mode me customer landing pe mat phenko (Customer APK me ye
    // param kabhi honor nahi hota — RESTORABLE filter se upar hi handle ho chuka).
    let isSuper=false; try{ isSuper = new URLSearchParams(location.search).get('superadmin')==='1'; }catch(e){}
    if(isSuper && APK_MODE!=='customer'){ showView(superCredsValidated ? 'superPanel' : 'superLogin'); return; }
    // admin.html/superadmin.html (phase 3 split files) declare their own
    // APP_ROLE — neither has a legitimate customer/Discovery destination,
    // ever, so resolve straight to that role's login/panel instead of
    // falling into the generic "no vendor param -> dscView" default below,
    // which was written for index.html/customer.html and would otherwise
    // wrongly show the marketplace inside what must be an admin-only file.
    if(typeof APP_ROLE!=='undefined'){
      if(APP_ROLE==='admin'){ showView(adminCredsValidated ? 'adminPanel' : 'adminLogin'); return; }
      if(APP_ROLE==='superadmin'){ showView(superCredsValidated ? 'superPanel' : 'superLogin'); return; }
    }
    if(!target || ALL_VIEWS.indexOf(target)<0){
      if(isLoggedIn()) target = 'homeView';
      // Vendor page (?v=slug) pe logged-out user ko discovery/browse-kitchens pe mat
      // phenko — wahaan login dikhna chahiye. Pehle yahi "browse kitchens" flash aata tha
      // jab login page refresh hota tha (pageshow/focus pe recover trigger hota hai).
      else if(HAS_VENDOR_PARAM){
        const bl0=document.getElementById('bootLoader'); if(bl0){ bl0.classList.add('gone'); setTimeout(()=>bl0.remove(),300); }
        if(typeof showAuth==='function'){ showAuth(); return; }
        target = 'dscView';
      }
      else target = 'dscView';
    }
    showView(target);
    // Boot loader agar atka reh gaya ho to usko bhi hatao
    const bl=document.getElementById('bootLoader'); if(bl){ bl.classList.add('gone'); setTimeout(()=>bl.remove(),300); }
    // ⚠️ SELF-HEAL: Home dikh rahi hai par meal panel khaali hai (koi bhi wajah se —
    // stale dateOffset, ek round-trip ke baad refresh chook gaya, jo bhi) — turant
    // dobara bhar do. Ye check yahan (pageshow/focus/visibilitychange se) hamesha
    // chalta hai, isliye trigger jo bhi ho, khaali screen zyada der nahi rukti.
    if(target==='homeView'){
      const mp=document.getElementById('mealPanel');
      if(mp && !mp.children.length && isLoggedIn()){ refreshAvailability(); renderHome(); }
    }
  }
  // ═══════ CUSTOM CONFIRM (native confirm() ki jagah — app jaisa dikhta hai) ═══════
  let __confirmResolve = null;
  // Simple ek-button popup (sirf "Okay"). confirmModal ko reuse karta hai aur
  // 'No' button chhupa deta hai — naya markup banane ki zarurat nahi.
  function showAlert(opts){
    const o = opts || {};
    document.getElementById('cfIcon').textContent = o.icon || 'ℹ️';
    document.getElementById('cfTitle').textContent = o.title || '';
    document.getElementById('cfBody').textContent = o.body || '';
    const yes = document.getElementById('cfYes'), no = document.getElementById('cfNo');
    yes.textContent = o.ok || t('okBtn');
    yes.style.background = 'var(--accent)';
    if(no) no.style.display = 'none';
    document.getElementById('confirmModal').classList.remove('hidden');
    return new Promise(res => { __confirmResolve = res; });
  }
  function showConfirm(opts){
    const o = opts || {};
    document.getElementById('cfIcon').textContent = o.icon || '⚠️';
    document.getElementById('cfTitle').textContent = o.title || '';
    document.getElementById('cfBody').textContent = o.body || '';
    document.getElementById('cfYes').textContent = o.yes || 'Yes';
    document.getElementById('cfNo').textContent = o.no || 'Cancel';
    const yes = document.getElementById('cfYes');
    yes.style.background = o.danger ? 'var(--danger)' : 'var(--accent)';
    const no = document.getElementById('cfNo'); if(no) no.style.display = '';   // showAlert ne chhupaya ho to wapas
    document.getElementById('confirmModal').classList.remove('hidden');
    return new Promise(res => { __confirmResolve = res; });
  }
  function closeConfirm(val){
    document.getElementById('confirmModal').classList.add('hidden');
    const no = document.getElementById('cfNo'); if(no) no.style.display = '';   // alert ke baad restore
    if(__confirmResolve){ const r = __confirmResolve; __confirmResolve = null; r(!!val); }
  }
