#!/usr/bin/env node
/**
 * tests/groups.json ko tests/ ki asli files se milata hai.
 *
 * Ye check isliye hai kyunki named groups ka ek khatarnak failure mode hai:
 * naya spec file banao, groups.json me daalna bhool jao — aur wo test CI me
 * kabhi chalta hi nahi, jabki sab kuch green dikhta rehta hai. Purane
 * --shard=i/N me ye problem nahi thi (wo har file khud utha leta tha), isliye
 * naam ka faayda lene ke saath ye guard bhi zaroori hai.
 *
 * Dono taraf se check karta hai:
 *   - har spec file kisi group me honi chahiye
 *   - har group me likhi file asli me maujood honi chahiye
 *   - koi file do groups me na ho (warna do baar chalegi)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const GROUPS_FILE = path.join(TESTS_DIR, 'groups.json');

const { groups } = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));

const onDisk = fs.readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.spec.js'))
  .map(f => 'tests/' + f)
  .sort();

const seen = new Map();          // file -> [group names]
for (const g of groups) {
  if (!g.name || !Array.isArray(g.files) || g.files.length === 0) {
    console.error(`  ✘ group "${g.name || '(unnamed)'}" ka name ya files galat hai`);
    process.exit(1);
  }
  for (const f of g.files) {
    if (!seen.has(f)) seen.set(f, []);
    seen.get(f).push(g.name);
  }
}

const problems = [];

for (const f of onDisk) {
  if (!seen.has(f)) problems.push(`${f} kisi group me nahi hai — CI me ye kabhi nahi chalega`);
}
for (const [f, names] of seen) {
  if (!onDisk.includes(f)) problems.push(`${f} groups.json me hai par file maujood nahi ("${names[0]}")`);
  else if (names.length > 1) problems.push(`${f} ${names.length} groups me hai (${names.join(', ')}) — do baar chalega`);
}

if (problems.length) {
  console.error('\n  tests/groups.json aur tests/ mel nahi kha rahe:\n');
  problems.forEach(p => console.error('    ✘ ' + p));
  console.error('\n  tests/groups.json me theek karo.\n');
  process.exit(1);
}

console.log(`  ✓ test groups OK — ${groups.length} groups, ${onDisk.length} spec files, sab exactly ek baar`);
