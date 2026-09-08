// Adding a bookmark must not rebuild the whole page: untouched cards, their
// favicon <img> elements and the open-tabs rows keep their DOM identity, and
// an expanded "Show more" card stays expanded.
const { launchExtension, openNewTab, collectErrors, startPageServer, waitFor, suite } = require('../helpers');

suite('e2e: incremental rendering when bookmarks change', async (check) => {
  const server = await startPageServer();
  const ext = await launchExtension({ tag: 'render' });
  try {
    for (const n of ['a', 'b']) { const p = await ext.ctx.newPage(); await p.goto(`${server.base}/${n}`); }
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page);
    await page.evaluate(async () => {
      const cols = await Storage.getCollections();
      const work = cols.find(c => c.name === 'Work');
      work.tabs = Array.from({ length: 7 }, (_, i) => ({ id: 'w' + i, title: 'Work tab ' + i, url: 'https://work.example/' + i, favicon: '', addedAt: i }));
      await chrome.storage.local.set({ collections: cols, localUpdateTime: Date.now() });
    });
    await openNewTab(ext, page, { settle: 800 });

    const work = page.locator('.collection-card', { hasText: 'Work' });
    await work.locator('.btn-show-more').click();
    check('Work card expanded', await page.evaluate(() => !document.querySelector('.collection-card[data-collection-id="col-work"] .collection-body').classList.contains('collapsed')));
    // Mark nodes so we can tell later whether they were re-created.
    await page.evaluate(() => {
      document.querySelector('.collection-card[data-collection-id="col-work"]').__keep = true;
      document.querySelector('.collection-card[data-collection-id="col-work"] .tab-favicon').__keep = true;
      [...document.querySelectorAll('#openTabsList .open-tab-item')].forEach(li => { li.__keep = true; li.querySelector('img').__keep = true; });
    });
    const workKept = () => page.evaluate(() => { const c = document.querySelector('.collection-card[data-collection-id="col-work"]'); return !!(c && c.__keep && c.querySelector('.tab-favicon').__keep); });
    const workExpanded = () => page.evaluate(() => !document.querySelector('.collection-card[data-collection-id="col-work"] .collection-body').classList.contains('collapsed'));

    // 1. Drag an open tab into Reading List
    await page.locator('#openTabsList .open-tab-item', { hasText: '測試頁面 a' }).dragTo(page.locator('.collection-card', { hasText: 'Reading List' }).locator('.collection-body'));
    await waitFor(page, () => document.querySelector('.collection-card[data-collection-id="col-reading"] .tab-item') !== null, { label: 'drop to render' });
    check('Reading List shows the new bookmark', (await page.evaluate(() => document.querySelectorAll('.collection-card[data-collection-id="col-reading"] .tab-item').length)) === 1);
    check('untouched Work card and its favicon were NOT re-created', await workKept());
    check('Work card stays expanded after the add', await workExpanded());
    check('remaining open-tab row and favicon were NOT re-created', await page.evaluate(() => { const li = [...document.querySelectorAll('#openTabsList .open-tab-item')].find(l => l.textContent.includes('測試頁面 b')); return !!(li && li.__keep && li.querySelector('img').__keep); }));

    // 2. Toolbar quick save (background → DOOBY_DATA_CHANGED → loadApp)
    const tabB = await page.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url && t.url.endsWith('/b')));
    await ext.sw.evaluate(t => handleActionClick(t), tabB);
    await waitFor(page, () => document.querySelectorAll('.collection-card[data-collection-id="col-quicksave"] .tab-item').length === 1, { label: 'quick save to render' });
    check('Work card survives a full loadApp() triggered by the service worker', await workKept());
    check('Work card still expanded after loadApp()', await workExpanded());

    // 3. Renaming a collection rebuilds only that card
    await page.evaluate(async () => { await Storage.renameCollection('col-reading', 'Reading Renamed'); await renderCollections(); });
    check('renamed card re-created, others kept', await page.evaluate(() => document.querySelector('.collection-card[data-collection-id="col-reading"] .collection-title').textContent === 'Reading Renamed') && await workKept());

    // 4. Collapsing again is remembered across a re-render
    await work.locator('.btn-show-more').click();
    await page.evaluate(() => renderCollections());
    await page.waitForTimeout(300);
    check('collapsed state remembered after re-render', !(await workExpanded()));
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); server.close(); }
});
