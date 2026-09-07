// Shared helpers for Dooby's Playwright tests.
//
// The extension is loaded unpacked from the repo root into a real Chromium
// (new headless mode, which supports extensions). Chromium comes from the
// `playwright` package; set DOOBY_CHROME=/path/to/chrome to use another build.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXT_DIR = path.resolve(__dirname, '..');

async function launchExtension(opts = {}) {
  const extDir = opts.extDir || EXT_DIR;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `dooby-${opts.tag || 'test'}-`));
  const launch = {
    headless: false,
    viewport: opts.viewport || { width: 1280, height: 800 },
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`
    ]
  };
  if (process.env.DOOBY_CHROME) launch.executablePath = process.env.DOOBY_CHROME;
  const ctx = await chromium.launchPersistentContext(userData, launch);
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  const extId = new URL(sw.url()).host;
  const close = async () => {
    await ctx.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  };
  return { ctx, sw, extId, userData, close, newtabUrl: `chrome-extension://${extId}/pages/newtab.html` };
}

// Open the new-tab page and wait until the app scripts are loaded.
async function openNewTab(ext, page, { settle = 1200 } = {}) {
  await page.goto(ext.newtabUrl);
  // No argument is passed to waitForFunction: extension CSP rejects the eval
  // path Playwright uses when arguments are given.
  await page.waitForFunction(() => typeof SyncManager !== 'undefined' && typeof Storage !== 'undefined' && document.getElementById('collectionsGrid'));
  await page.waitForTimeout(settle);
}

// Poll a page-side predicate (evaluated via page.evaluate, CSP-safe).
async function waitFor(page, fn, { timeout = 10000, interval = 250, label = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(interval);
  }
  throw new Error(`timed out waiting for ${label}`);
}

// Collect page errors and console errors so tests can assert on a clean run.
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // "Failed to load resource" is a network error (e.g. an external favicon
  // blocked by the CI/sandbox network), not an application error.
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  return errors;
}

// Tiny local web server that serves titled HTML pages, used as "open tabs".
async function startPageServer() {
  const http = require('http');
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(200, { 'Content-Type': 'image/x-icon' }); return res.end(Buffer.alloc(0)); }
    const n = req.url.replace('/', '') || 'home';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>測試頁面 ${n} — Dooby</title><link rel="icon" href="/favicon.ico"><h1>page ${n}</h1>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Minimal test reporter: runs named checks, prints results, exits non-zero on failure.
async function suite(name, fn) {
  const results = [];
  const check = (label, ok, detail) => {
    results.push({ label, ok: !!ok });
    console.log(`${ok ? '  ✓' : '  ✗'} ${label}${!ok && detail !== undefined ? '  → ' + JSON.stringify(detail) : ''}`);
  };
  console.log(`\n# ${name}`);
  try {
    await fn(check);
  } catch (e) {
    console.error('  ✗ test crashed:', e && e.stack || e);
    results.push({ label: 'crash', ok: false });
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `\n${name}: ${failed} FAILED` : `\n${name}: PASSED`);
  process.exit(failed ? 1 : 0);
}

module.exports = { EXT_DIR, launchExtension, openNewTab, waitFor, collectErrors, startPageServer, suite };
