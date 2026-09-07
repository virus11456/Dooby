// Every i18n key used in the HTML/JS exists in _locales/en, en and zh_TW have
// identical key sets with identical {placeholders}, and no message contains
// "$" (Chrome's own placeholder syntax, which would break manifest loading).
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const en = JSON.parse(read('_locales/en/messages.json'));
const zh = JSON.parse(read('_locales/zh_TW/messages.json'));
let fails = 0;
const check = (label, ok, detail) => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? '  → ' + JSON.stringify(detail) : ''}`); };
console.log('\n# unit: i18n key coverage');

const enKeys = Object.keys(en), zhKeys = Object.keys(zh);
check(`en and zh_TW have the same keys (${enKeys.length})`, JSON.stringify([...enKeys].sort()) === JSON.stringify([...zhKeys].sort()),
  { onlyEn: enKeys.filter(k => !zh[k]), onlyZh: zhKeys.filter(k => !en[k]) });
check('every message has a non-empty string', enKeys.every(k => typeof en[k].message === 'string' && en[k].message.length) && zhKeys.every(k => typeof zh[k].message === 'string' && zh[k].message.length));
check('no "$" in any message (Chrome placeholder syntax)', enKeys.every(k => !en[k].message.includes('$')) && zhKeys.every(k => !zh[k].message.includes('$')));
check('keys are valid Chrome i18n names', enKeys.every(k => /^[a-zA-Z0-9_]+$/.test(k)));
const ph = s => (s.match(/\{[a-z]+\}/g) || []).sort().join(',');
const phMismatch = enKeys.filter(k => zh[k] && ph(en[k].message) !== ph(zh[k].message));
check('placeholders match between languages', phMismatch.length === 0, phMismatch);

const used = new Set();
const src = ['pages/newtab.html', ...fs.readdirSync(path.join(ROOT, 'js')).map(f => 'js/' + f)].map(read).join('\n').replace(/^\s*\/\/.*$/gm, ''); // ignore comment lines
for (const m of src.matchAll(/\b(?:t|_t|I18n\.t)\(\s*'([a-zA-Z0-9_]+)'/g)) used.add(m[1]);
for (const m of src.matchAll(/data-i18n(?:-html|-title|-placeholder)?="([a-zA-Z0-9_]+)"/g)) used.add(m[1]);
// keys chosen at runtime: `confirmKey = 'x'` / `emptyKey = 'x'`
for (const m of src.matchAll(/(?:confirmKey|emptyKey)\s*=\s*'([a-zA-Z0-9_]+)'/g)) used.add(m[1]);
const missing = [...used].filter(k => !en[k]);
check(`all ${used.size} keys used in source exist in en`, missing.length === 0, missing);
const unused = enKeys.filter(k => !used.has(k) && !['ext_name', 'ext_description'].includes(k));
check('no unused keys in en', unused.length === 0, unused);
const manifest = JSON.parse(read('manifest.json'));
check('manifest uses __MSG_ext_name__ with default_locale en', manifest.name === '__MSG_ext_name__' && manifest.default_locale === 'en');

console.log(fails ? `\ni18n keys: ${fails} FAILED` : '\ni18n keys: PASSED');
process.exit(fails ? 1 : 0);
