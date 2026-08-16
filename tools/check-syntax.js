#!/usr/bin/env node
/**
 * Har HTML file ke andar jo <script> likhe hain unka syntax check karta hai,
 * plus shared.js ka.
 *
 * Kyun chahiye: app ka zyadatar JS chaaron HTML files ke andar inline hai.
 * `node --check` seedha .html par nahi chal sakta, isliye ek chhota sa
 * comma/bracket ka typo — khaaskar jab file phone se edit ki gayi ho — kisi
 * ko dikhta hi nahi jab tak koi asli user page na khole. Ye script wahi gap
 * bharti hai: inline blocks nikaal kar unhe alag se parse karti hai.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = ['index.html', 'customer.html', 'admin.html', 'superadmin.html'];
const JS = ['shared.js'];

let failures = 0;
let checked = 0;

function report(file, label, err) {
  failures++;
  console.error(`\n  ✘ ${file} ${label}`);
  console.error(`    ${String(err.message).split('\n')[0]}`);
}

// src= wale <script> skip karo — unka apna file alag se check hota hai.
const INLINE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

for (const file of HTML) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { console.error(`  ✘ ${file} missing`); failures++; continue; }
  const html = fs.readFileSync(full, 'utf8');
  let m, i = 0;
  while ((m = INLINE.exec(html)) !== null) {
    i++;
    checked++;
    try {
      new vm.Script(m[1], { filename: `${file}#script[${i}]` });
    } catch (e) {
      report(file, `inline <script> #${i}`, e);
    }
  }
  if (i === 0) console.warn(`  ! ${file} me koi inline <script> nahi mila`);
}

for (const file of JS) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { console.error(`  ✘ ${file} missing`); failures++; continue; }
  checked++;
  try {
    new vm.Script(fs.readFileSync(full, 'utf8'), { filename: file });
  } catch (e) {
    report(file, '', e);
  }
}

if (failures) {
  console.error(`\n  ${failures} syntax error(s) mile — push se pehle theek karo.\n`);
  process.exit(1);
}
console.log(`  ✓ syntax OK — ${checked} script block(s) checked`);
