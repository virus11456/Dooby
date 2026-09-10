// Layout: spaces are chips in the content header (no left column), the Open
// Tabs column collapses to a rail and remembers it, and the collections grid
// gains columns when the column is collapsed.
const { launchExtension, openNewTab, collectErrors, startPageServer, waitFor, suite } = require('../helpers');

suite('e2e: layout (space chips, collapsible Open Tabs, fluid grid)', async (check) => {
  const server = await startPageServer();
  const ext = await launchExtension({ tag: 'layout', viewport: { width: 1600, height: 900 } });
  try {
    for (const n of ['a', 'b', 'c']) { const p = await ext.ctx.newPage(); await p.goto(`${server.base}/${n}`); }
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page);
    await page.evaluate(async () => {
      await Storage.addSpace('Personal');
      const cols = await Storage.getCollections();
      for (let i = 0; i < 6; i++) cols.push({ id: 'col-x' + i, spaceId: 'space-default', name: 'Col ' + i, tabs: [{ id: 't' + i, title: 'Tab ' + i, url: 'https://x.example/' + i, favicon: '', addedAt: i }], createdAt: i });
      await chrome.storage.local.set({ collections: cols, localUpdateTime: Date.now() });
    });
    await openNewTab(ext, page, { settle: 800 });

    // Space chips live in the content header; there is no left sidebar.
    check('no left sidebar element', await page.evaluate(() => !document.querySelector('.spaces-sidebar')));
    check('spaces render as chips inside the content header', await page.evaluate(() => document.querySelectorAll('.content-header .spaces-bar .space-item').length === 2));
    check('active chip is highlighted', await page.evaluate(() => document.querySelector('.space-item.active .space-name').textContent === 'My Space'));
    await page.locator('.space-item', { hasText: 'Personal' }).click();
    await page.waitForTimeout(300);
    check('clicking a chip switches the space', await page.evaluate(() => document.querySelector('.space-item.active .space-name').textContent === 'Personal' && document.querySelectorAll('.collection-card').length === 0));
    await page.locator('.space-item', { hasText: 'My Space' }).click();
    await page.waitForTimeout(300);

    // Column count grows when the Open Tabs column is collapsed.
    const columns = () => page.evaluate(() => new Set([...document.querySelectorAll('.collection-card')].map(c => Math.round(c.getBoundingClientRect().left))).size);
    const before = await columns();
    check('Open Tabs column expanded by default with rows', await page.evaluate(() => !document.getElementById('tabsSidebar').classList.contains('collapsed') && document.querySelectorAll('#openTabsList .open-tab-item').length === 3));
    await page.click('#btnToggleTabs');
    await page.waitForTimeout(400);
    check('toggle collapses the Open Tabs column to a rail', await page.evaluate(() => document.getElementById('tabsSidebar').classList.contains('collapsed') && getComputedStyle(document.getElementById('btnExpandTabs')).display !== 'none' && document.getElementById('tabsSidebar').getBoundingClientRect().width < 60));
    check('rail shows the open tab count', (await page.evaluate(() => document.getElementById('openTabCountRail').textContent)) === '3');
    const after = await columns();
    check(`grid gains columns when collapsed (${before} → ${after})`, after > before, { before, after });
    check('collapsed state persisted in settings', (await page.evaluate(() => Storage.getSettings())).openTabsCollapsed === true);

    // Expanding a card must not move cards in other columns.
    await page.evaluate(async () => {
      const cols = await Storage.getCollections();
      const c = cols.find(x => x.id === 'col-x0');
      c.tabs = Array.from({ length: 9 }, (_, i) => ({ id: 'big' + i, title: 'Big ' + i, url: 'https://big.example/' + i, favicon: '', addedAt: i }));
      await chrome.storage.local.set({ collections: cols, localUpdateTime: Date.now() });
      await renderCollections();
    });
    await page.waitForTimeout(300);
    const rects = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.collection-card')].map(c => [c.dataset.collectionId, { l: Math.round(c.getBoundingClientRect().left), t: Math.round(c.getBoundingClientRect().top) }])));
    const beforeExpand = await rects();
    await page.locator('.collection-card[data-collection-id="col-x0"] .btn-show-more').click();
    await page.waitForTimeout(400);
    const afterExpand = await rects();
    const bigLeft = beforeExpand['col-x0'].l;
    const otherCols = Object.entries(beforeExpand).filter(([id, r]) => r.l !== bigLeft);
    check('expanding a card leaves every card in other columns exactly where it was', otherCols.every(([id, r]) => afterExpand[id].l === r.l && afterExpand[id].t === r.t), { beforeExpand, afterExpand });
    check('cards below it in the same column only move down, never sideways', Object.entries(beforeExpand).filter(([id, r]) => r.l === bigLeft && r.t > beforeExpand['col-x0'].t).every(([id, r]) => afterExpand[id].l === r.l && afterExpand[id].t > r.t));
    check('card order still reads left to right (first row = first N collections)', await page.evaluate(() => {
      const n = parseInt(document.getElementById('collectionsGrid').dataset.columns);
      const cards = [...document.querySelectorAll('.collection-card')].map(c => ({ id: c.dataset.collectionId, l: c.getBoundingClientRect().left, t: Math.round(c.getBoundingClientRect().top) }));
      const top = Math.min(...cards.map(c => c.t));
      const firstRow = cards.filter(c => Math.abs(c.t - top) <= 4).sort((a, b) => a.l - b.l).map(c => c.id); // hover lifts a card by 2px
      const expected = ['col-quicksave', 'col-work', 'col-reading', 'col-x0', 'col-x1', 'col-x2', 'col-x3', 'col-x4', 'col-x5'].slice(0, n);
      return { ok: JSON.stringify(firstRow) === JSON.stringify(expected), firstRow, expected, n };
    }).then(r => (r.ok ? true : (console.log('    order detail:', JSON.stringify(r)), false))));

    await openNewTab(ext, page, { settle: 600 });
    check('collapsed state survives reload', await page.evaluate(() => document.getElementById('tabsSidebar').classList.contains('collapsed')));
    await page.click('#btnExpandTabs');
    await page.waitForTimeout(300);
    check('rail click expands the column again', await page.evaluate(() => !document.getElementById('tabsSidebar').classList.contains('collapsed')));
    check('drag from Open Tabs still works after expanding', await (async () => {
      await page.locator('#openTabsList .open-tab-item', { hasText: '測試頁面 a' }).dragTo(page.locator('.collection-card', { hasText: 'Work' }).locator('.collection-body'));
      await waitFor(page, () => document.querySelectorAll('.collection-card[data-collection-id="col-work"] .tab-item').length === 1, { label: 'drop' });
      return true;
    })());
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); server.close(); }
});
