#!/usr/bin/env node
// Stage the Safari Web Extension: the same files as the Chrome Web Store
// build, with the manifest and build flag adjusted for Safari.
//
//   - no "key" (store/App Store builds get their own identity)
//   - no "identity" permission (Safari has no chrome.identity)
//   - js/ext-link.js content script on the web app, which hands the Dooby
//     Cloud session to the extension (see js/cloud.js, Safari auth flow)
//   - js/build-flags.js says 'safari', so js/platform.js switches off Chrome
//     sync and uses the web-app sign-in
//   - minimum Safari 15.4 (MV3 service worker, Web Locks)
//
// Usage: node scripts/stage-safari.js <out-dir>
// Test-only overrides (never used for a real build):
//   --webapp-url URL  --supabase-url URL  --anon-key KEY  --match PATTERN (repeatable)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--') && !isOptionValue(a));
if (!out) { console.error('usage: stage-safari.js <out-dir> [--webapp-url URL] [--supabase-url URL] [--anon-key KEY] [--match PATTERN]'); process.exit(2); }
function isOptionValue(a) { const i = args.indexOf(a); return i > 0 && args[i - 1].startsWith('--'); }
function opt(name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; }
function opts(name) { const r = []; args.forEach((a, i) => { if (a === '--' + name) r.push(args[i + 1]); }); return r; }

const dest = path.resolve(out);
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const entry of ['_locales', 'css', 'icons', 'js', 'pages', 'privacy-policy.html']) {
  fs.cpSync(path.join(ROOT, entry), path.join(dest, entry), { recursive: true });
}
fs.rmSync(path.join(dest, 'icons', 'generate_icons.html'), { force: true });

// Build flag
fs.writeFileSync(path.join(dest, 'js', 'build-flags.js'),
  "// Safari build (written by scripts/stage-safari.js).\n// eslint-disable-next-line no-unused-vars\nconst DOOBY_BUILD = 'safari';\n");

// Config overrides (tests only)
const overrides = {};
if (opt('webapp-url')) overrides.webAppUrl = opt('webapp-url');
if (opt('supabase-url')) overrides.supabaseUrl = opt('supabase-url');
if (opt('anon-key')) overrides.supabaseAnonKey = opt('anon-key');
if (Object.keys(overrides).length) {
  fs.appendFileSync(path.join(dest, 'js', 'config.js'), `\n// Test build overrides (stage-safari.js)\nObject.assign(DoobyConfig, ${JSON.stringify(overrides)});\n`);
}

// Manifest
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
delete manifest.key;
manifest.permissions = (manifest.permissions || []).filter(p => p !== 'identity');
const webAppUrl = overrides.webAppUrl || readConfigWebAppUrl();
const matches = opts('match').length ? opts('match') : [webAppUrl.replace(/\/?$/, '') + '*'];
manifest.content_scripts = [{ matches, js: ['js/ext-link.js'], run_at: 'document_start' }];
manifest.browser_specific_settings = { ...(manifest.browser_specific_settings || {}), safari: { strict_min_version: '15.4' } };
fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

function readConfigWebAppUrl() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
  const m = /webAppUrl:\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('webAppUrl not found in js/config.js');
  return m[1];
}

console.log(`staged Safari extension ${manifest.version} in ${dest}`);
console.log(`  content script on: ${matches.join(', ')}`);
