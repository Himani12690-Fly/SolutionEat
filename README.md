# myTiffin

Multi-tenant tiffin ordering PWA. Har vendor ki apni kitchen ek hi app par chalti hai —
`mytiffin.cloud/<kitchen>` customer ko, `mytiffin.cloud/admin/<kitchen>` vendor ko.

Frontend ek static site hai jo **GitHub Pages** par host hoti hai (custom domain: `mytiffin.cloud`).
Backend **Google Apps Script** par hai aur is repo ka hissa nahi hai.

## Folder structure

```
/                     ← sirf wahi files jo root par HONI hi chahiye (neeche wajah)
├── assets/           CSS, JS aur icons — jo bhi browser page ke saath load karta hai
│   ├── shared.js       chaaron pages ka common JS (session, config, vendor routing)
│   ├── styles.css      poori app ki stylesheet
│   ├── theme.js        light/dark theme helper (defer)
│   ├── manifest.json         customer PWA manifest
│   ├── admin-manifest.json   vendor PWA manifest
│   └── icons/          app icons + logo (png + webp)
├── images/           app ke andar dikhne wale photos (default meal photo)
├── tests/            Playwright UI tests + unka README + CI test groups
├── tools/            build/verify scripts (stamp, syntax check, dev server, bench)
├── docs/             technical notes (performance, delivery-distance)
└── store-assets/     Play Store listing ke liye graphics + copy (site par deploy nahi hota)
```

## Root par kya hai aur kyun

Root ki har file yahan **majboori se** hai — inhe folder me mat daalna, warna kuch na kuch tootega.

| File | Kyun root par hona zaroori hai |
|---|---|
| `index.html` | GitHub Pages ka entry point |
| `404.html` | Pages har unmatched path par yahi serve karta hai — clean vendor URLs (`/hungrybirds`) isi se `?v=` me badalte hain |
| `sw.js` | Service worker sirf apne folder aur usse neeche ko control kar sakta hai. `/assets/sw.js` hota to poori site ka cache/push band ho jaata, aur Pages custom header set nahi kar sakta |
| `CNAME` | Pages custom domain |
| `.nojekyll` | Pages ko Jekyll build skip karne ko kehta hai |
| `.well-known/` | Android App Links ka fixed path — badal nahi sakta |
| `version.json` | Purani khuli hui build isi URL ko poll karke naya deploy detect karti hai. Isko hilane par deploy ke waqt purane tabs ka update-check chup-chaap toot jaayega |
| `admin.html` | **Play Store** ke vendor app ka `start_url` — published APK isi URL par jaata hai |
| `privacy.html` | **Play Store** listing me diya gaya privacy policy URL |
| `index/customer/superadmin/become-a-vendor .html` | Ye khud public URL hain — inhe hilane ka matlab URL badalna hai, cleanup nahi |
| `package.json`, `playwright.config.js`, `.gitignore` | npm/Playwright convention |

## Chalao

```bash
npm run setup    # ek baar: npm install + chromium
npm run serve    # local dev server (GitHub Pages jaisa 404 fallback ke saath)
npm test         # poore UI tests — tests/README.md dekho
```

## Deploy se pehle

`assets/shared.js` ya `assets/styles.css` badle ho to stamp dobara chalana zaroori hai —
warna users ko GitHub Pages ke CDN se ~10 minute tak purani file milti rahegi:

```bash
npm run stamp          # naye content-hash se ?v= URLs update karta hai
npm run verify:stamp   # CI yahi check karta hai
npm run verify:syntax
```

`main` par push hote hi GitHub Actions poora test suite chalata hai
(`.github/workflows/ci.yml`), aur Pages khud deploy kar deta hai.

## Chaar HTML files lockstep me hain

`index.html`, `customer.html`, `admin.html`, `superadmin.html` bahut sara markup aur logic
share karte hain, par ye **alag-alag files** hain — inme koi shared include nahi hai.
Ek me shared UI ya boot logic badlo to baaki teen me bhi wahi badlav haath se karna padta hai.
`assets/shared.js` me jo hai wo apne aap chaaron me jaata hai; HTML ke andar ka kuch bhi nahi.
