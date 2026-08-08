/**
 * Vendor-uploaded meal/variant photos — systematic Drive organization + cleanup.
 *
 * Backend (apps-script-v6.txt, not covered by these mocked tests) files every
 * upload under FlyingBirdsTiffin_Images/<VendorName>/<MealName>/ instead of one
 * flat folder, and trashes the previous Drive file when a photo is replaced.
 * These tests cover the frontend's half of that contract — the POST payload it
 * sends must carry the REAL variant name (not an internal code like "lunch-0")
 * and the previous image URL (so the backend knows what to clean up).
 */
const { test, expect } = require('@playwright/test');
const { openApp, adminLogin } = require('./helpers');

function uploadImageCalls(state) {
  return state.calls.filter((c) => c.action === 'uploadimage');
}

// Bypasses the native file-picker (not automatable) and calls the same
// compress-then-upload function the picker's onchange handler calls, with a
// tiny real JPEG built in-page so Image.onload actually fires.
async function uploadVariantPhoto(page, state, i) {
  const before = uploadImageCalls(state).length;
  await page.evaluate(async (idx) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg'));
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    window.compressAndUpload(file, idx);
  }, i);
  // Mock always returns the same fixed URL, so waiting on DOM state (the <img src>,
  // or the status text — which renderVariantsEditor() wipes on every re-render
  // anyway) can't distinguish "first upload done" from "second upload done".
  // The call count is the one signal that's unambiguous across repeats.
  await expect.poll(() => uploadImageCalls(state).length, { timeout: 10000 }).toBe(before + 1);
}

test('first upload sends the real variant name, not an internal meal-index code', async ({ page }) => {
  const { state } = await openApp(page);
  await adminLogin(page);
  await page.evaluate(() => window.adminTab('variants'));
  await page.waitForSelector('#varList .var-card');

  await uploadVariantPhoto(page, state, 0);

  const call = uploadImageCalls(state).pop();
  expect(call.payload.name).toBe('Full Tiffin'); // real name — backend uses this as the Drive subfolder
  expect(call.payload.oldUrl || '').toBe('');     // no previous photo yet — nothing to clean up
});

test('replacing a photo sends the previous Drive URL so the backend can delete it', async ({ page }) => {
  const { state } = await openApp(page);
  await adminLogin(page);
  await page.evaluate(() => window.adminTab('variants'));
  await page.waitForSelector('#varList .var-card');

  await uploadVariantPhoto(page, state, 0);
  expect(uploadImageCalls(state).pop().payload.oldUrl || '').toBe('');

  await uploadVariantPhoto(page, state, 0);
  const secondCall = uploadImageCalls(state).pop();
  // Mock always returns the same fixed URL — real backend returns a fresh one each
  // time, but either way the frontend must forward whatever was stored as .img.
  expect(secondCall.payload.oldUrl).toBe('https://example.test/img.jpg');
  expect(secondCall.payload.name).toBe('Full Tiffin');
});
