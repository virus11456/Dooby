// Dooby web app (app.html, served at /dooby/app) against the mock Supabase:
// reads the same dooby_data row the extension writes, renders spaces /
// collections / tabs, searches, adds via the ?add= bookmarklet flow and
// removes tabs, writing documents the extension can merge.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { suite, waitFor } = require('../helpers');
const { start } = require('../mock-supabase');
const ROOT = path.resolve(__dirname, '..', '..');

// Static server mimicking the Vercel rewrites (cleanUrls + /dooby/app -> app.html).
function serveSite() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.css': 'text/css' };
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

suite('e2e: Dooby web app (iPad / iPhone) against mock Supabase', async (check) => {
  const srv = await start();
  const site = await serveSite();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.DOOBY_CHROME ? { executablePath: process.env.DOOBY_CHROME } : {}) });
  try {
    // A user the extension already synced: seed the row + a valid session in the mock.
    const uid = 'web-user-1';
    srv.users.set(uid, { id: uid, email: 'frank@example.com', name: 'Frank', picture: '' });
    srv.sessions.set('at_web', uid);
    srv.refreshes.set('rt_web', uid);
    const doc = { version: 3, updatedAt: 1000,
      spaces: [{ id: 's1', name: 'Work Space', createdAt: 1 }, { id: 's2', name: 'Personal', createdAt: 2 }],
      collections: [
        { id: 'c1', spaceId: 's1', name: 'Quick Save', tabs: [{ id: 't1', title: 'Notion roadmap', url: 'https://notion.so/a', favicon: '', addedAt: 1 }, { id: 't2', title: 'Figma file', url: 'https://figma.com/a', favicon: '', addedAt: 2 }], createdAt: 1 },
        { id: 'c2', spaceId: 's1', name: 'Reading', tabs: [{ id: 't3', title: '巴哈姆特 討論', url: 'https://gamer.com.tw/x', favicon: '', addedAt: 3 }], createdAt: 2, pinned: true },
        { id: 'c3', spaceId: 's2', name: 'Travel', tabs: [{ id: 't4', title: 'El Nido', url: 'https://elnidogotour.com/', favicon: '', addedAt: 4 }], createdAt: 3 }
      ] };
    srv.rows.set(uid, { data: doc, updated_at: new Date(1000).toISOString() });

    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, locale: 'zh-TW' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    // Point the app at the mock and pre-seed a Supabase session (storage key sb-<host>-auth-token).
    await page.addInitScript(({ supabaseUrl }) => {
      window.__DOOBY_APP_CONFIG__ = { supabaseUrl, supabaseAnonKey: 'anon-test' };
      const session = { access_token: 'at_web', refresh_token: 'rt_web', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'web-user-1', aud: 'authenticated', role: 'authenticated', email: 'frank@example.com', user_metadata: { full_name: 'Frank', avatar_url: '' }, app_metadata: { provider: 'google' }, created_at: '2026-01-01T00:00:00Z' } };
      try { localStorage.setItem('sb-127-auth-token', JSON.stringify(session)); } catch (e) {}
    }, { supabaseUrl: srv.url });

    // 1. Signed-out state (fresh context without a session)
    const anon = await (await browser.newContext({ locale: 'en-US' })).newPage();
    await anon.addInitScript(({ supabaseUrl }) => { window.__DOOBY_APP_CONFIG__ = { supabaseUrl, supabaseAnonKey: 'anon-test' }; }, { supabaseUrl: srv.url });
    await anon.goto(`${site.url}/dooby/app`);
    await waitFor(anon, () => !document.getElementById('viewSignedOut').classList.contains('hidden'), { label: 'signed-out view' });
    check('signed-out view shows the Google button', await anon.evaluate(() => getComputedStyle(document.getElementById('btnSignIn')).display !== 'none' && document.getElementById('viewApp').classList.contains('hidden')));
    check('English UI on an English browser', await anon.evaluate(() => document.documentElement.className === 'lang-en' && getComputedStyle(document.querySelector('#btnSignIn .en')).display !== 'none'));
    await anon.context().close();

    // 2. Signed-in: renders the synced document
    await page.goto(`${site.url}/dooby/app`);
    await waitFor(page, () => document.querySelectorAll('.card').length > 0, { label: 'cards to render' });
    const cards = () => page.evaluate(() => [...document.querySelectorAll('.card')].map(c => ({ name: c.querySelector('.h').firstChild.textContent.trim(), tabs: [...c.querySelectorAll('li a')].map(a => a.textContent) })));
    let c = await cards();
    check('zh-TW UI on a Chinese browser', await page.evaluate(() => document.documentElement.className === 'lang-zh'));
    check('renders the active space with pinned collection first', JSON.stringify(c.map(x => x.name)) === JSON.stringify(['Reading', 'Quick Save']), c);
    check('renders every tab of the space', c.find(x => x.name === 'Quick Save').tabs.join('|') === 'Notion roadmap|Figma file', c);
    check('space selector lists both spaces', (await page.evaluate(() => [...document.querySelectorAll('#spaceSelect option')].map(o => o.textContent))).join('|') === 'Work Space|Personal');
    check('tab links open in a new tab with the right URL', await page.evaluate(() => { const a = document.querySelector('.card li a'); return a.target === '_blank' && a.href === 'https://gamer.com.tw/x'; }));

    // 3. Switch space
    await page.selectOption('#spaceSelect', 's2');
    await page.waitForTimeout(200);
    c = await cards();
    check('switching space shows its collections', c.length === 1 && c[0].name === 'Travel' && c[0].tabs[0] === 'El Nido', c);

    // 4. Search across spaces
    await page.fill('#search', 'figma');
    await page.waitForTimeout(200);
    c = await cards();
    check('search filters tabs across all spaces', c.length === 1 && c[0].name === 'Quick Save' && c[0].tabs.join() === 'Figma file', c);
    await page.fill('#search', '');
    await page.selectOption('#spaceSelect', 's1');
    await page.waitForTimeout(200);

    // 5. Remove a tab → row updated with a newer updatedAt
    await page.locator('.card[data-collection-id="c1"] li[data-tab-id="t2"] .x').click();
    await waitFor(page, () => !document.querySelector('li[data-tab-id="t2"]'), { label: 'tab removal' });
    let row = srv.rows.get(uid).data;
    check('removing a tab writes back to the cloud row', row.collections.find(x => x.id === 'c1').tabs.map(t => t.id).join() === 't1', row.collections[0]);
    check('write bumps updatedAt (last-writer-wins with the extension)', row.updatedAt > 1000 && row.version === 3, row.updatedAt);
    check('other collections untouched by the write', row.collections.length === 3 && row.spaces.length === 2);

    // 6. Bookmarklet flow: ?add=URL&title=T pre-fills the sheet, saving appends to the chosen collection
    await page.goto(`${site.url}/dooby/app?add=${encodeURIComponent('https://example.com/from-ipad?x=1')}&title=${encodeURIComponent('Saved from iPad')}`);
    await waitFor(page, () => !document.getElementById('addSheet').classList.contains('hidden'), { label: 'add sheet' });
    check('add sheet pre-filled from the URL', await page.evaluate(() => document.getElementById('addUrl').value === 'https://example.com/from-ipad?x=1' && document.getElementById('addTitle').value === 'Saved from iPad'));
    check('add sheet defaults to Quick Save of the active space', (await page.evaluate(() => document.getElementById('addCollection').selectedOptions[0].textContent)) === 'Quick Save');
    await page.selectOption('#addCollection', 'c2');
    await page.click('#btnAddSave');
    await waitFor(page, () => document.getElementById('addSheet').classList.contains('hidden'), { label: 'sheet to close' });
    row = srv.rows.get(uid).data;
    const added = row.collections.find(x => x.id === 'c2').tabs.slice(-1)[0];
    check('saved bookmark lands in the chosen collection with the extension\'s tab shape', added && added.title === 'Saved from iPad' && added.url === 'https://example.com/from-ipad?x=1' && /^tab-/.test(added.id) && typeof added.addedAt === 'number' && 'favicon' in added, added);
    check('query string cleared after saving', (await page.evaluate(() => location.search)) === '');
    check('page shows the new bookmark', (await cards()).find(x => x.name === 'Reading').tabs.includes('Saved from iPad'));

    // 7. Invalid URL is rejected
    await page.click('#btnAdd');
    await page.fill('#addUrl', 'not a url');
    await page.evaluate(() => document.getElementById('addForm').requestSubmit());
    await page.waitForTimeout(200);
    check('invalid URL shows an error and does not save', await page.evaluate(() => !document.getElementById('addError').classList.contains('hidden') || document.getElementById('addUrl').validity.valid === false));
    await page.click('#btnAddCancel');

    // 8. Language switch
    await page.click('.lang-switch button[data-lang="en"]');
    check('language switch to English', await page.evaluate(() => document.documentElement.className === 'lang-en' && document.getElementById('search').placeholder === 'Search bookmarks…'));
    check('bookmarklet points at toolist.cc', (await page.evaluate(() => document.getElementById('bookmarkletEn').textContent)).startsWith("javascript:(function(){location.href='https://toolist.cc/dooby/app?add='"));

    // 9. Sign out
    await page.click('#btnSignOut');
    await waitFor(page, () => !document.getElementById('viewSignedOut').classList.contains('hidden'), { label: 'signed-out after sign-out' });
    check('sign out returns to the signed-out view', true);
    check('no page errors', errors.length === 0, errors);
  } finally { await browser.close(); site.close(); srv.close(); }
});
