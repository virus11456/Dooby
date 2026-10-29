// The Safari build, staged by scripts/stage-safari.js and loaded in Chromium.
// Safari itself cannot be automated here, but everything Dooby changes for
// Safari is driven by the build flag and the staged manifest, so this covers:
// Chrome sync switched off and hidden; Dooby Cloud sign-in handed over from
// the web app (link mode -> js/ext-link.js -> background worker) end to end
// against the mock Supabase; forged or misdirected hand-offs rejected; the
// web app's "no extension" message; and the Chrome build left unchanged.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { launchExtension, openNewTab, collectErrors, waitFor, suite } = require('../helpers');
const { start } = require('../mock-supabase');
const ROOT = path.resolve(__dirname, '..', '..');

function serveSite() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    let p = new URL(req.url, 'http://x').pathname;
    if (p === '/dooby/app' || p === '/dooby/app/') p = '/app.html';
    if (!path.extname(p)) p += '.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

suite('e2e: Safari build (staged, in Chromium)', async (check) => {
  const srv = await start();
  const site = await serveSite();
  const appUrl = `${site.url}/dooby/app`;
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooby-safari-'));
  execFileSync('node', [path.join(ROOT, 'scripts/stage-safari.js'), stageDir, '--webapp-url', appUrl, '--supabase-url', srv.url, '--anon-key', 'anon-test', '--match', 'http://127.0.0.1/*'], { stdio: 'pipe' });

  // A Google user the web app signs in as; each hand-off uses its own refresh token.
  const uid = 'google-sub-sara';
  srv.users.set(uid, { id: uid, email: 'sara@example.com', name: 'Sara', picture: '' });
  for (const rt of ['rt_link', 'rt_wrong', 'rt_sender']) srv.refreshes.set(rt, uid);

  let ext, chromeExt, plain;
  try {
    // ---------- Staged manifest ----------
    const m = JSON.parse(fs.readFileSync(path.join(stageDir, 'manifest.json'), 'utf8'));
    check('Safari manifest: no key, no identity permission', !('key' in m) && !m.permissions.includes('identity'), m.permissions);
    check('Safari manifest: hand-off content script on the web app only', m.content_scripts.length === 1 && m.content_scripts[0].js.join() === 'js/ext-link.js' && m.content_scripts[0].run_at === 'document_start');
    check('Safari manifest: minimum Safari 15.4', m.browser_specific_settings.safari.strict_min_version === '15.4');
    execFileSync('node', [path.join(ROOT, 'scripts/stage-safari.js'), stageDir + '-prod'], { stdio: 'pipe' });
    const prod = JSON.parse(fs.readFileSync(path.join(stageDir + '-prod', 'manifest.json'), 'utf8'));
    check('production Safari build targets toolist.cc/dooby/app', prod.content_scripts[0].matches.join() === 'https://toolist.cc/dooby/app*', prod.content_scripts[0].matches);
    check('production Safari build has no test overrides', !/Test build overrides/.test(fs.readFileSync(path.join(stageDir + '-prod', 'js/config.js'), 'utf8')));

    // ---------- Safari build in the browser ----------
    ext = await launchExtension({ extDir: stageDir, tag: 'safari' });
    await ext.ctx.addInitScript(({ supabaseUrl, origin }) => {
      if (location.origin !== origin) return;
      window.__DOOBY_APP_CONFIG__ = { supabaseUrl, supabaseAnonKey: 'anon-test' };
      const m = /dooby-ext-link=([A-Za-z0-9]+)/.exec(location.hash);
      if (!m) return;
      // The web app is "already signed in" in its link session; which refresh
      // token depends on the scenario (encoded in the nonce for forged ones).
      const rt = m[1].startsWith('forged') ? 'rt_wrong' : 'rt_link';
      const session = { access_token: 'at_' + rt, refresh_token: rt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'google-sub-sara', aud: 'authenticated', role: 'authenticated', email: 'sara@example.com', user_metadata: { full_name: 'Sara' }, app_metadata: { provider: 'google' }, created_at: '2026-01-01T00:00:00Z' } };
      localStorage.setItem('dooby-ext-link', JSON.stringify(session));
    }, { supabaseUrl: srv.url, origin: site.url });

    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page, { settle: 1500 });
    const plat = await page.evaluate(() => ({ ...DoobyPlatform, cls: document.documentElement.classList.contains('platform-safari'), syncOn: SyncManager._enabled }));
    check('build flag says Safari; identity sign-in off', plat.isSafari && plat.build === 'safari' && !plat.canUseIdentity && !plat.chromeSyncWorks, plat);
    check('Chrome sync switched off', plat.cls && plat.syncOn === false);
    await page.click('#btnAccount');
    check('Chrome sync section hidden in the Dooby Cloud dialog', await page.evaluate(() => getComputedStyle(document.querySelector('.chrome-sync')).display === 'none'));
    await page.click('#btnCloseCloud');
    await page.evaluate(async () => { const c = (await Storage.getCollections())[0]; await Storage.addTabToCollection(c.id, { title: 'Local before sign-in', url: 'https://example.com/local' }); });
    await page.waitForTimeout(2500);
    check('nothing written to storage.sync', await page.evaluate(async () => Object.keys(await chrome.storage.sync.get(null)).length === 0));

    // ---------- Forged hand-offs are rejected ----------
    // (a) a web-app page with a nonce the extension never issued
    await page.evaluate(() => chrome.storage.local.set({ cloudLinkPending: { nonce: 'realnonce1', at: Date.now() } }));
    const forged = await ext.ctx.newPage();
    await forged.goto(`${appUrl}#dooby-ext-link=forgednonce1`);
    await waitFor(forged, () => /連結失敗|Could not connect/.test(document.getElementById('linkStatus').textContent), { label: 'forged nonce rejected' });
    check('unknown nonce: web app shows the failure', true);
    check('unknown nonce: no session stored, refresh token untouched', !(await page.evaluate(async () => !!(await chrome.storage.local.get('cloudSession')).cloudSession)) && srv.refreshes.has('rt_wrong'));
    check('unknown nonce: link session wiped from the web app anyway', await forged.evaluate(() => localStorage.getItem('dooby-ext-link') === null));
    await forged.close();
    // (b) the right nonce, but not sent from the web app
    const misdirected = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'DOOBY_CLOUD_LINK', nonce: 'realnonce1', session: { refresh_token: 'rt_sender' } }));
    check('right nonce from a non-web-app sender is rejected', misdirected && misdirected.ok === false && /sender/i.test(misdirected.error) && srv.refreshes.has('rt_sender'), misdirected);
    // (c) an expired request
    await page.evaluate(() => chrome.storage.local.set({ cloudLinkPending: { nonce: 'oldnonce1', at: Date.now() - 11 * 60 * 1000 } }));
    const old = await ext.ctx.newPage();
    await old.goto(`${appUrl}#dooby-ext-link=oldnonce1`);
    await waitFor(old, () => /連結失敗|Could not connect/.test(document.getElementById('linkStatus').textContent), { label: 'expired nonce rejected' });
    check('expired sign-in request is rejected', srv.refreshes.has('rt_link'));
    await old.close();
    await page.evaluate(() => chrome.storage.local.remove('cloudLinkPending'));

    // ---------- Real hand-off from the Sign-in button ----------
    await page.click('#btnAccount');
    const linkPagePromise = ext.ctx.waitForEvent('page', { predicate: p => p.url().includes('/dooby/app'), timeout: 10000 });
    await page.click('#btnCloudSignIn');
    const linkPage = await linkPagePromise;
    await waitFor(linkPage, () => !document.getElementById('viewLink').classList.contains('hidden'), { label: 'link view' });
    check('Sign in opens the web app in link mode', linkPage.url().startsWith(appUrl) && !linkPage.url().includes('dooby-ext-link'), linkPage.url());
    check('the waiting page explains sign-in continues in the new tab', await page.evaluate(() => { const e = document.getElementById('cloudSignInError'); return !e.classList.contains('hidden') && e.classList.contains('is-info') && e.textContent.length > 5; }));
    await waitFor(linkPage, () => /已連結|Connected/.test(document.getElementById('linkStatus').textContent), { label: 'web app reports connected', timeout: 15000 });
    check('web app reports success', true);
    check('web app forgets its link session afterwards', await linkPage.evaluate(() => localStorage.getItem('dooby-ext-link') === null && !sessionStorage.getItem('dooby-ext-link-nonce')));
    check('web app only showed the link view (no bookmarks UI)', await linkPage.evaluate(() => document.getElementById('viewApp').classList.contains('hidden') && document.getElementById('viewSignedOut').classList.contains('hidden')));
    await waitFor(page, () => CloudManager.isSignedIn(), { label: 'extension signed in', timeout: 15000 });
    const who = await page.evaluate(() => CloudManager.getUser());
    check('extension signed in as the Google user (user from Supabase)', who && who.email === 'sara@example.com' && who.id === uid, who);
    check('page\'s refresh token was traded for the extension\'s own', !srv.refreshes.has('rt_link') && await page.evaluate(async () => { const s = (await chrome.storage.local.get('cloudSession')).cloudSession; return s && s.refresh_token && s.refresh_token !== 'rt_link'; }));
    await waitFor(page, async () => !(await chrome.storage.local.get('cloudNeedsMerge')).cloudNeedsMerge, { label: 'first sync done' });
    const row = srv.rows.get(uid);
    check('first sync uploaded the local bookmarks', row && row.data.collections.flatMap(c => c.tabs.map(t => t.title)).includes('Local before sign-in'));
    check('no leftover sign-in request', await page.evaluate(async () => !(await chrome.storage.local.get('cloudLinkPending')).cloudLinkPending));
    const closed = await (async () => { const end = Date.now() + 6000; while (Date.now() < end) { if (linkPage.isClosed()) return true; await page.waitForTimeout(200); } return false; })();
    check('the sign-in tab closes itself', closed);
    check('no page errors in the Safari build', errors.length === 0, errors);

    // ---------- Web app without the extension ----------
    plain = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.DOOBY_CHROME ? { executablePath: process.env.DOOBY_CHROME } : {}) });
    const pctx = await plain.newContext({ locale: 'en-US' });
    await pctx.addInitScript(({ supabaseUrl }) => {
      window.__DOOBY_APP_CONFIG__ = { supabaseUrl, supabaseAnonKey: 'anon-test' };
      localStorage.setItem('dooby-ext-link', JSON.stringify({ access_token: 'x', refresh_token: 'rt_none', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u', aud: 'authenticated', email: 'n@example.com', user_metadata: {}, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
    }, { supabaseUrl: srv.url });
    const p2 = await pctx.newPage();
    await p2.goto(`${appUrl}#dooby-ext-link=abc123`);
    await waitFor(p2, () => /not detected/.test(document.getElementById('linkStatus').textContent), { label: 'no-extension message' });
    check('without the extension the web app says how to enable it', /toolist\.cc/.test(await p2.evaluate(() => document.getElementById('linkStatus').textContent)));
    await p2.goto(appUrl);
    check('reloading the tab stays in link mode until cancelled', await p2.evaluate(() => !document.getElementById('viewLink').classList.contains('hidden')));
    await p2.click('#linkCancel');
    await waitFor(p2, () => document.getElementById('viewLink').classList.contains('hidden'), { label: 'cancel back to normal app' });
    check('Cancel returns to the normal web app', true);

    // ---------- Chrome build is unchanged ----------
    const cm = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    check('Chrome manifest: no content scripts, keeps identity', !cm.content_scripts && cm.permissions.includes('identity'));
    chromeExt = await launchExtension({ tag: 'chrome-plat' });
    const cp = await chromeExt.ctx.newPage();
    await openNewTab(chromeExt, cp);
    const cplat = await cp.evaluate(() => ({ ...DoobyPlatform, cls: document.documentElement.classList.contains('platform-safari'), syncOn: SyncManager._enabled }));
    check('Chrome build: identity sign-in and Chrome sync stay on', cplat.build === 'chrome' && !cplat.isSafari && cplat.canUseIdentity && cplat.chromeSyncWorks && cplat.syncOn && !cplat.cls, cplat);
  } finally {
    if (ext) await ext.close();
    if (chromeExt) await chromeExt.close();
    if (plain) await plain.close();
    site.close(); srv.close();
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.rmSync(stageDir + '-prod', { recursive: true, force: true });
  }
});
