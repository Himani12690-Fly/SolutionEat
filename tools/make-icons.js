#!/usr/bin/env node
/**
 * PNG icons se WebP banata hai.  npm run icons
 *
 * Kyun: dono source PNG 192x192 par 32-bit RGBA (colortype 6) hain — 70 KB
 * aur 72 KB. Wire par ye first load ka ~44% the, aur PNG gzip se chhota hota
 * nahi (already compressed hai). Jabki UI me ye 18px aur 34px par render hote
 * hain.
 *
 * PNG files delete NAHI ki gayi hain — manifest ke install icon ke liye aur
 * WebP fail hone par fallback ke liye wahi rehti hain. WebP sirf wahan lagta
 * hai jahan first load par asar padta hai.
 *
 * Encode Chromium ke canvas se hota hai (yahan koi image toolchain nahi hai).
 * Fidelity naapi gayi thi: q=1.0 lossless hai par 45 KB, q=0.95 par 8 KB aur
 * max channel diff 43 — jo 34px par dikhta hi nahi. Isliye q=0.95.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

// out: kya banana hai | size: kis resolution par | why: kahan use hota hai
const JOBS = [
  { src: 'icon-192.png',   out: 'icon-192.webp',   size: 128,
    why: 'footer badge 18px + zo-avatar 34px — 128 se 3x DPR bhi cover' },
  { src: 'logo-round.png', out: 'logo-round.webp', size: 192,
    why: 'vendor-logo fallback (auth/boot par bada dikh sakta hai) + SW precache' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await (await browser.newContext()).newPage();

  for (const job of JOBS) {
    const srcPath = path.join(ROOT, job.src);
    const b64 = fs.readFileSync(srcPath).toString('base64');
    const dataUrl = await page.evaluate(async ({ src, size }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/webp', 0.95);
    }, { src: 'data:image/png;base64,' + b64, size: job.size });

    if (!dataUrl.startsWith('data:image/webp')) {
      console.error(`  ✘ ${job.out}: browser ne WebP nahi diya`);
      process.exit(1);
    }
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(ROOT, job.out), bytes);
    const before = fs.statSync(srcPath).size;
    console.log(`  ✓ ${job.out.padEnd(18)} ${(before/1024).toFixed(0)} KB -> `
      + `${(bytes.length/1024).toFixed(1)} KB  (${Math.round(100 - bytes.length/before*100)}% chhota, ${job.size}px)`);
    console.log(`    ${job.why}`);
  }

  await browser.close();
})();
