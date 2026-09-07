// Dooby Cloud end-to-end: two Chromium profiles ("devices") + mock Supabase.
//  A: seed bookmarks, sign in through the real modal (Google round-trip
//     stubbed), data lands in the cloud row.
//  B: sign in with the same Google account → receives A's bookmarks (merge).
//  B adds a tab → debounced push → A polls and receives it.
//  Token refresh, sign-out, delete-cloud-data, and RLS isolation.
const { launchExtension, collectErrors, suite } = require('../helpers');
const { start } = require('../mock-supabase');

async function device(tag, supabaseUrl) {
  const ext = await launchExtension({ tag: `cloud-${tag}` });
  const page = await ext.ctx.newPage();
  const errors = collectErrors(page);
  // Inject config + stub the Google round-trip on every load, before scripts run.
  await page.addInitScript(({ supabaseUrl }) => {
    document.addEventListener('DOMContentLoaded', () => {
      DoobyConfig.supabaseUrl = supabaseUrl; DoobyConfig.supabaseAnonKey = 'anon-test'; DoobyConfig.googleClientId = 'test-client';
      CloudManager._launchAuthFlow = async (url) => {
        const u = new URL(url);
        const hashedNonce = u.searchParams.get('nonce'), state = u.searchParams.get('state');
        const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const who = window.__googleUser || { sub: 'google-sub-frank', email: 'frank@example.com', name: 'Frank' };
        const idToken = [b64(JSON.stringify({ alg: 'none' })), b64(JSON.stringify({ ...who, picture: '', nonce: hashedNonce })), 'sig'].join('.');
        return `${u.searchParams.get('redirect_uri')}#id_token=${idToken}&state=${state}`;
      };
    }, { once: true });
  }, { supabaseUrl });
  const open = async () => {
    await page.goto(ext.newtabUrl);
    await page.waitForFunction(() => typeof CloudManager !== 'undefined' && document.getElementById('btnAccount'));
    await page.waitForTimeout(1200);
  };
  await open();
  return { ext, page, open, errors };
}

const tabsOf = page => page.evaluate(async () => (await Storage.getCollections()).flatMap(c => c.tabs.map(t => t.title)));
const waitSignedIn = async page => { for (let i = 0; i < 40; i++) { if (await page.evaluate(() => CloudManager.isSignedIn())) return true; await page.waitForTimeout(250); } throw new Error('sign-in did not complete'); };

suite('e2e: Dooby Cloud (Google sign-in + Supabase sync, mocked)', async (check) => {
  const srv = await start();
  let A, B;
  try {
    // ---------------- Device A ----------------
    A = await device('A', srv.url);
    await A.page.evaluate(async () => {
      const collections = await Storage.getCollections();
      collections[0].tabs.push({ id: 'tab-a1', title: 'A: Notion roadmap', url: 'https://notion.so/a', favicon: '', addedAt: Date.now() });
      collections[0].tabs.push({ id: 'tab-a2', title: 'A: Figma file', url: 'https://figma.com/a', favicon: '', addedAt: Date.now() });
      await chrome.storage.local.set({ collections, localUpdateTime: Date.now() });
    });
    await A.open();
    await A.page.click('#btnAccount');
    check('signed-out panel shown before sign-in', await A.page.evaluate(() => !document.getElementById('cloudSignedOut').classList.contains('hidden')));
    await A.page.click('#btnCloudSignIn');
    await waitSignedIn(A.page);
    await A.page.waitForTimeout(800);
    const user = await A.page.evaluate(() => CloudManager.getUser());
    check('A signed in as frank@example.com', user && user.email === 'frank@example.com', user);
    check('modal shows email', (await A.page.evaluate(() => document.getElementById('cloudEmail').textContent)) === 'frank@example.com');
    check('account button marked signed-in', await A.page.evaluate(() => document.getElementById('btnAccount').classList.contains('signed-in')));
    const panels = await A.page.evaluate(() => [...document.querySelectorAll('.cloud-panel')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id));
    check('only the signed-in panel is visible', panels.length === 1 && panels[0] === 'cloudSignedIn', panels);
    await A.page.click('#btnCloseCloud');
    const rowA = srv.rows.get('google-sub-frank');
    check('A\'s bookmarks uploaded to cloud row', rowA && rowA.data.collections.flatMap(c => c.tabs.map(t => t.title)).includes('A: Notion roadmap'));
    await A.open();
    check('session persists across reload', await A.page.evaluate(() => CloudManager.isSignedIn()));

    // ---------------- Device B ----------------
    B = await device('B', srv.url);
    await B.page.click('#btnAccount'); await B.page.click('#btnCloudSignIn');
    await waitSignedIn(B.page);
    await B.page.waitForTimeout(1000);
    await B.page.click('#btnCloseCloud');
    const bTabs = await tabsOf(B.page);
    check('B receives A\'s bookmarks after sign-in', bTabs.includes('A: Figma file') && bTabs.includes('A: Notion roadmap'), bTabs);
    check('B renders the merged bookmarks', (await B.page.evaluate(() => document.querySelectorAll('.tab-item').length)) === 2);

    await B.page.evaluate(async () => {
      const cols = await Storage.getCollections();
      await Storage.addTabToCollection(cols[0].id, { title: 'B: Added on iPad-ish device', url: 'https://example.com/b' });
    });
    await B.page.waitForTimeout(3000);
    check('B\'s addition pushed to cloud (debounced)', srv.rows.get('google-sub-frank').data.collections.flatMap(c => c.tabs.map(t => t.title)).includes('B: Added on iPad-ish device'));
    await A.page.evaluate(() => CloudManager.poll());
    await A.page.waitForTimeout(800);
    check('A receives B\'s addition on poll', (await tabsOf(A.page)).includes('B: Added on iPad-ish device'));

    // Token refresh
    await A.page.evaluate(async () => { CloudManager._session.expires_at = 0; await chrome.storage.local.set({ cloudSession: CloudManager._session }); });
    const pullRes = await A.page.evaluate(() => CloudManager.pull(true).then(() => 'ok').catch(e => 'ERR ' + e.message));
    check('pull after access-token expiry succeeds', pullRes === 'ok', pullRes);
    check('refresh_token grant was used', srv.log.some(l => l.includes('grant_type=refresh_token')));

    // Sign out on B, delete cloud data from A
    await B.page.click('#btnAccount'); await B.page.click('#btnCloudSignOut'); await B.page.waitForTimeout(300);
    check('B signed out', !(await B.page.evaluate(() => CloudManager.isSignedIn())));
    await B.page.click('#btnCloseCloud');
    A.page.once('dialog', d => d.accept());
    await A.page.click('#btnAccount'); await A.page.click('#btnCloudDelete'); await A.page.waitForTimeout(800);
    check('cloud row deleted', !srv.rows.has('google-sub-frank'));
    check('A signed out after delete', !(await A.page.evaluate(() => CloudManager.isSignedIn())));
    check('A keeps local bookmarks after delete', (await tabsOf(A.page)).length >= 3);

    // RLS isolation
    await A.page.click('#btnCloseCloud');
    await A.page.evaluate(() => { window.__googleUser = { sub: 'google-sub-other', email: 'other@example.com', name: 'Other' }; });
    await A.page.evaluate(async () => { await chrome.storage.local.set({ collections: [], spaces: [{ id: 'space-default', name: 'My Space', createdAt: 1 }] }); });
    srv.rows.set('google-sub-frank', { data: { version: 3, spaces: [{ id: 's', name: 'S', createdAt: 1 }], collections: [{ id: 'c', spaceId: 's', name: 'Secret', tabs: [{ id: 't', title: 'Frank secret', url: 'https://x/1', favicon: '', addedAt: 1 }] }], updatedAt: Date.now() }, updated_at: new Date().toISOString() });
    await A.page.click('#btnAccount'); await A.page.click('#btnCloudSignIn');
    await waitSignedIn(A.page);
    await A.page.waitForTimeout(800);
    check('another Google user cannot see Frank\'s data', !(await tabsOf(A.page)).includes('Frank secret'));
    check('no page errors on A', A.errors.length === 0, A.errors);
    check('no page errors on B', B.errors.length === 0, B.errors);
  } finally {
    if (A) await A.ext.close();
    if (B) await B.ext.close();
    srv.close();
  }
});
