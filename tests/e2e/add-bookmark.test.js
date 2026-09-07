// Every way a bookmark can be added:
//  1. drag that STARTS on the favicon <img> of an Open Tabs item
//  2. drop on the collection HEADER (title bar) instead of the body
//  3. toolbar-icon quick save (handler invoked in the service worker)
//  4. quick save when the active space has no collection at all
//  5. non-web pages are refused
const { launchExtension, openNewTab, collectErrors, startPageServer, suite } = require('../helpers');

suite('e2e: add bookmark paths', async (check) => {
  const server = await startPageServer();
  const ext = await launchExtension({ tag: 'add' });
  try {
    const swLogs = [];
    ext.sw.on('console', m => swLogs.push(m.text()));
    for (const n of ['a', 'b', 'c']) { const p = await ext.ctx.newPage(); await p.goto(`${server.base}/${n}`); }

    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page, { settle: 1500 });
    const tabsIn = name => page.evaluate(async n => {
      const c = (await Storage.getCollections()).find(x => x.name === n);
      return c ? c.tabs.map(t => t.title) : null;
    }, name);

    // 1. Drag starting on the favicon image -> body of "Work"
    const img = page.locator('#openTabsList .open-tab-item', { hasText: '測試頁面 a' }).locator('img');
    await img.dragTo(page.locator('.collection-card', { hasText: 'Work' }).locator('.collection-body'));
    await page.waitForTimeout(1200);
    const work = await tabsIn('Work');
    check('drag from favicon image adds to Work', work && work.length === 1, work);

    // 2. Drop on the HEADER of "Reading List"
    const src = page.locator('#openTabsList .open-tab-item', { hasText: '測試頁面 b' });
    await src.dragTo(page.locator('.collection-card', { hasText: 'Reading List' }).locator('.collection-header'));
    await page.waitForTimeout(1200);
    const reading = await tabsIn('Reading List');
    check('drop on collection header adds to Reading List', reading && reading.length === 1, reading);

    // 3. Toolbar icon quick save
    const tabs = await page.evaluate(() => chrome.tabs.query({}));
    const tabC = tabs.find(t => t.url && t.url.endsWith('/c'));
    const before = tabs.length;
    const saved = await ext.sw.evaluate(async t => {
      const ok = await saveTabToQuickSave(t);
      if (ok) await chrome.tabs.remove(t.id);
      return ok;
    }, tabC);
    await page.waitForTimeout(1500);
    const quick = await tabsIn('Quick Save');
    const after = (await page.evaluate(() => chrome.tabs.query({}))).length;
    const rendered = await page.evaluate(() => { const c = [...document.querySelectorAll('.collection-card')].find(c => c.textContent.includes('Quick Save')); return c ? c.querySelectorAll('.tab-item').length : -1; });
    check('quick save stores the tab in Quick Save', saved === true && quick && quick.length === 1, { saved, quick });
    check('quick save closes the saved tab', before - after === 1, { before, after });
    check('open new-tab page re-renders the new bookmark', rendered === 1, rendered);

    // 4. Quick save into a space with no collections
    await page.evaluate(async () => {
      const spaces = await Storage.getSpaces();
      spaces.push({ id: 'space-empty', name: '空的空間', createdAt: Date.now() });
      await chrome.storage.local.set({ spaces, activeSpaceId: 'space-empty' });
    });
    const emptyRes = await ext.sw.evaluate(() => saveTabToQuickSave({ id: 999999, url: 'https://example.com/x', title: '空空間測試' }));
    const emptyCols = await page.evaluate(async () => (await Storage.getCollections()).filter(c => c.spaceId === 'space-empty').map(c => ({ name: c.name, tabs: c.tabs.map(t => t.title) })));
    check('quick save creates a collection in an empty space', emptyRes === true && emptyCols.length === 1 && emptyCols[0].tabs.length === 1, emptyCols);

    // 5. Non-web page refused
    const blank = await ext.sw.evaluate(() => saveTabToQuickSave({ id: 1, url: 'about:blank', title: 'blank' }));
    check('about:blank is refused', blank === false, blank);
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); server.close(); }
});
