#!/usr/bin/env node
// Runs every tests/unit/*.test.js and tests/e2e/*.test.js as a separate
// process (each test launches its own Chromium) and summarizes.
//   node tests/run-all.js          # everything
//   node tests/run-all.js unit     # only unit
//   node tests/run-all.js e2e      # only e2e
//   node tests/run-all.js cloud    # any test file whose name contains "cloud"
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filter = process.argv[2] || '';
const groups = ['unit', 'e2e'];
const files = [];
for (const g of groups) {
  const dir = path.join(__dirname, g);
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.test.js')) continue;
    const rel = `${g}/${f}`;
    if (filter && !rel.includes(filter)) continue;
    files.push(rel);
  }
}
if (!files.length) { console.error(`no tests match "${filter}"`); process.exit(1); }

const results = [];
for (const rel of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, rel)], { stdio: 'inherit', env: process.env });
  results.push({ rel, ok: r.status === 0, ms: Date.now() - t0 });
}
console.log('\n==================== summary ====================');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.rel.padEnd(32)} ${(r.ms / 1000).toFixed(1)}s`);
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} of ${results.length} test files failed` : `\nall ${results.length} test files passed`);
process.exit(failed ? 1 : 0);
