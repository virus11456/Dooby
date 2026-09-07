// Settings modal: close-tab-after-save, quick-save target collection,
// collection sort and tab sort, all persisted per device.
const { launchExtension, openNewTab, collectErrors, startPageServer, suite, waitFor } = require('../helpers');

suite('e2e: settings (close after save, quick-save target, sorting)', async (check) => {
  const server = await startPageServer();
  const ext = await launchExtension({ tag: 'settings' });
  try {
    for (const n of ['a', 'b', 'c']) { const p = await ext.ctx.newPage(); await p.goto(`${server.base}/${n}`); }
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    // openSettingsModal() populates the selects asynchronously; wait until it is really open.
    const openSettings = async () => {
      await page.click('#btnSettings');
      await waitFor(page, () => !document.getElementById('settingsModal').classList.contains('hidden') && document.querySelectorAll('#settingQuickSave option').length > 0, { label: 'settings modal to open' });
    };
    await openNewTab(ext, page, { settle: 1500 });

    const tabCount = () => page.evaluate(async () => (await chrome.tabs.query({})).length);
    const tabsIn = name => page.evaluate(async n => { const c = (await Storage.getCollections()).find(x => x.name === n); return c ? c.tabs.map(t => t.title) : null; }, name);
    const cardOrder = () => page.evaluate(() => [...document.querySelectorAll('.collection-card .collection-title')].map(e => e.textContent));
    const findTab = suffix => page.evaluate(async s => (await chrome.tabs.query({})).find(t => t.url && t.url.endsWith(s)), suffix);
    const modalVisible = () => page.evaluate(() => !document.getElementById('settingsModal').classList.contains('hidden'));

    // Open the modal, check defaults
    await openSettings();
    check('settings modal opens from the top bar', await modalVisible());
    check('default: close tab after save is on', await page.evaluate(() => document.getElementById('settingCloseTab').checked));
    check('default: quick-save target is Auto', (await page.evaluate(() => document.getElementById('settingQuickSave').value)) === '');
    const options = await page.evaluate(() => [...document.querySelectorAll('#settingQuickSave option')].map(o => o.textContent));
    check('quick-save select lists every collection', ['Quick Save', 'Work', 'Reading List'].every(n => options.includes(n)), options);

    // 1. Close-after-save OFF: toolbar click keeps the tab open, drag-save keeps the tab open
    await page.click('label.switch');
    await page.waitForTimeout(200);
    check('setting persisted to storage', (await page.evaluate(() => Storage.getSettings())).closeTabAfterSave === false);
    await page.click('#btnCloseSettings');
    check('modal closes with Done', !(await modalVisible()));
    let before = await tabCount();
    const tabA = await findTab('/a');
    const savedA = await ext.sw.evaluate(t => handleActionClick(t), tabA);
    await page.waitForTimeout(1200);
    check('toolbar quick-save still saves with closing off', savedA === true && (await tabsIn('Quick Save')).length === 1);
    check('toolbar quick-save leaves the tab open when closing is off', (await tabCount()) === before);
    before = await tabCount();
    await page.locator('#openTabsList .open-tab-item', { hasText: '測試頁面 b' }).dragTo(page.locator('.collection-card', { hasText: 'Reading List' }).locator('.collection-body'));
    await page.waitForTimeout(1200);
    check('drag-save still saves with closing off', (await tabsIn('Reading List')).length === 1);
    check('drag-save leaves the tab open when closing is off', (await tabCount()) === before);

    // 2. Close-after-save back ON + quick-save target = Work
    await openSettings();
    await page.click('label.switch');
    const workId = await page.evaluate(async () => (await Storage.getCollections()).find(c => c.name === 'Work').id);
    await page.selectOption('#settingQuickSave', workId);
    await page.waitForTimeout(200);
    await page.click('#btnCloseSettings');
    before = await tabCount();
    const tabC = await findTab('/c');
    await ext.sw.evaluate(t => handleActionClick(t), tabC);
    await page.waitForTimeout(1200);
    check('toolbar quick-save goes to the chosen collection (Work)', (await tabsIn('Work')).length === 1, await tabsIn('Work'));
    check('toolbar quick-save closes the tab when closing is on', (await tabCount()) === before - 1);

    // 3. Collection sort
    await openSettings();
    await page.selectOption('#settingCollectionSort', 'name');
    await page.waitForTimeout(400);
    check('sort collections by name', JSON.stringify(await cardOrder()) === JSON.stringify(['Quick Save', 'Reading List', 'Work']), await cardOrder());
    await page.selectOption('#settingCollectionSort', 'manual');
    await page.waitForTimeout(400);
    check('manual restores creation order', JSON.stringify(await cardOrder()) === JSON.stringify(['Quick Save', 'Work', 'Reading List']), await cardOrder());

    // 4. Tab sort inside a collection
    await page.evaluate(async () => {
      const cols = await Storage.getCollections();
      const work = cols.find(c => c.name === 'Work');
      work.tabs = [
        { id: 't-z', title: 'Zebra', url: 'https://z.example', favicon: '', addedAt: 3000 },
        { id: 't-a', title: 'apple', url: 'https://a.example', favicon: '', addedAt: 1000 },
        { id: 't-m', title: 'Mango', url: 'https://m.example', favicon: '', addedAt: 2000 }
      ];
      await chrome.storage.local.set({ collections: cols, localUpdateTime: Date.now() });
    });
    const workTitles = () => page.evaluate(() => [...[...document.querySelectorAll('.collection-card')].find(c => c.querySelector('.collection-title').textContent === 'Work').querySelectorAll('.tab-title')].map(e => e.textContent));
    await page.selectOption('#settingTabSort', 'title');
    await page.waitForTimeout(400);
    check('sort tabs by title (case-insensitive)', JSON.stringify(await workTitles()) === JSON.stringify(['apple', 'Mango', 'Zebra']), await workTitles());
    await page.selectOption('#settingTabSort', 'newest');
    await page.waitForTimeout(400);
    check('sort tabs newest first', JSON.stringify(await workTitles()) === JSON.stringify(['Zebra', 'Mango', 'apple']), await workTitles());
    await page.click('#btnCloseSettings');

    // 5. Persist across reload
    await openNewTab(ext, page, { settle: 1000 });
    check('tab sort persists after reload', JSON.stringify(await workTitles()) === JSON.stringify(['Zebra', 'Mango', 'apple']), await workTitles());
    await openSettings();
    check('modal reflects saved values after reload', (await page.evaluate(() => [document.getElementById('settingTabSort').value, document.getElementById('settingQuickSave').value === document.getElementById('settingQuickSave').value && document.getElementById('settingQuickSave').selectedOptions[0].textContent])).join('|') === 'newest|Work');
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); server.close(); }
});
