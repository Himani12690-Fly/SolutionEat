// theme.js — deferred theme helpers
(function(){
  'use strict';
  function getVendorKey() {
    const q = new URLSearchParams(location.search).get('v') || 'nestandnosh';
    const vendorId = (typeof q === 'string' && q.trim()) ? q.trim().toLowerCase() : 'nestandnosh';
    return vendorId === 'nestandnosh' ? 'fbt_theme' : (vendorId + '_fbt_theme');
  }

  window.nnTheme = {
    setTheme: function(val) {
      try {
        const key = getVendorKey();
        localStorage.setItem(key, JSON.stringify(val));
        document.documentElement.setAttribute('data-theme', (val === 'dark') ? 'dark' : 'light');
      } catch(e){}
    },
    getTheme: function(){
      try {
        const key = getVendorKey();
        let m = localStorage.getItem(key) || localStorage.getItem('nn_theme_shared') || 'light';
        if (typeof m === 'string' && (m.startsWith('"') || m.startsWith("'"))) {
          try { m = JSON.parse(m); } catch(e){}
        }
        return m;
      } catch(e){ return 'light'; }
    }
  };
})();
