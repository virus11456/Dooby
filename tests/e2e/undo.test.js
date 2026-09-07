// Undo toast: removing a tab, bulk delete, deleting a collection and deleting
// a space can all be reverted from the toast, restoring original positions.
const { launchExtension, openNewTab, collectErrors, suite } = require('../helpers');

suite('e2e: undo after delete', async (check) => {
  const ext = await launchExtension({ tag: 'undo' });
  try {
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page);
    page.on('dialog', d => d.accept());
    await page.evaluate(async () => {
      const cols = await Storage.getCollections();
      const work = cols.find(c => c.name === 'Work');
      work.tabs = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t, i) => ({ id: 'w' + i, title: t, url: 'https://example.com/' + t, favicon: '', addedAt: i }));
      await chrome.storage.local.set({ collections: cols, localUpdateTime: Date.now() });
    });
    await openNewTab(ext, page, { settle: 800 });
    const titles = name => page.evaluate(async n => (await Storage.getCollections()).find(c => c.name === n).tabs.map(t => t.title), name);
    const toastVisible = () => page.evaluate(() => !document.getElementById('toast').classList.contains('hidden'));
    const toastText = () => page.evaluate(() => document.getElementById('toastText').textContent);
    const workCard = page.locator('.collection-card', { hasText: 'Work' });

    // 1. Remove a single tab (middle) via the × button, then undo
    await workCard.locator('.tab-item', { hasText: 'Bravo' }).hover();
    await workCard.locator('.tab-item', { hasText: 'Bravo' }).locator('.tab-remove').click();
    await page.waitForTimeout(300);
    check('tab removed', JSON.stringify(await titles('Work')) === JSON.stringify(['Alpha', 'Charlie', 'Delta']));
    check('toast shown with tab title', (await toastVisible()) && (await toastText()) === 'Removed "Bravo"', await toastText());
    await page.click('#toastAction');
    await page.waitForTimeout(300);
    check('undo restores the tab at its original position', JSON.stringify(await titles('Work')) === JSON.stringify(['Alpha', 'Bravo', 'Charlie', 'Delta']), await titles('Work'));
    check('toast hidden after undo', !(await toastVisible()));
    check('restored tab is rendered', (await workCard.locator('.tab-item').count()) === 4);

    // 2. Bulk delete two tabs, then undo
    await workCard.locator('.btn-more').click();
    await page.locator('#contextMenu li', { hasText: 'Select tabs' }).click();
    await workCard.locator('.tab-item', { hasText: 'Alpha' }).locator('.tab-checkbox').click();
    await workCard.locator('.tab-item', { hasText: 'Delta' }).locator('.tab-checkbox').click();
    await page.click('#btnBulkDelete');
    await page.waitForTimeout(400);
    check('bulk delete removed the tabs', JSON.stringify(await titles('Work')) === JSON.stringify(['Bravo', 'Charlie']));
    check('bulk toast text', (await toastText()) === 'Removed 2 tabs', await toastText());
    await page.click('#toastAction');
    await page.waitForTimeout(300);
    check('undo restores bulk-deleted tabs in order', JSON.stringify(await titles('Work')) === JSON.stringify(['Alpha', 'Bravo', 'Charlie', 'Delta']), await titles('Work'));

    // 3. Delete a collection (confirm accepted), then undo
    const orderBefore = await page.evaluate(async () => (await Storage.getCollections()).map(c => c.name));
    await workCard.locator('.btn-more').click();
    await page.locator('#contextMenu li', { hasText: 'Delete collection' }).click();
    await page.waitForTimeout(400);
    check('collection deleted', !(await page.evaluate(async () => (await Storage.getCollections()).some(c => c.name === 'Work'))));
    check('collection toast text', (await toastText()) === 'Deleted collection "Work"', await toastText());
    await page.click('#toastAction');
    await page.waitForTimeout(300);
    const orderAfter = await page.evaluate(async () => (await Storage.getCollections()).map(c => c.name));
    check('undo restores the collection at its original index with its tabs', JSON.stringify(orderAfter) === JSON.stringify(orderBefore) && (await titles('Work')).length === 4, orderAfter);

    // 4. Delete a space, then undo
    await page.evaluate(async () => { await Storage.addSpace('Temp'); });
    await openNewTab(ext, page, { settle: 600 });
    await page.locator('.space-item', { hasText: 'Temp' }).click();
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await Storage.addCollection(await Storage.getActiveSpaceId(), 'Temp Col'); });
    await page.locator('.space-item', { hasText: 'Temp' }).hover();
    await page.locator('.space-item', { hasText: 'Temp' }).locator('.btn-delete-space').click();
    await page.waitForTimeout(400);
    check('space deleted', !(await page.evaluate(async () => (await Storage.getSpaces()).some(s => s.name === 'Temp'))));
    check('space toast text', (await toastText()) === 'Deleted space "Temp"', await toastText());
    await page.click('#toastAction');
    await page.waitForTimeout(500);
    check('undo restores the space and its collections', (await page.evaluate(async () => (await Storage.getSpaces()).some(s => s.name === 'Temp'))) && (await page.evaluate(async () => (await Storage.getCollections()).some(c => c.name === 'Temp Col'))));
    check('restored space is active again', (await page.evaluate(() => document.querySelector('.space-item.active').textContent)).includes('Temp'));

    // 5. Toast auto-hides
    await workCard.locator('.tab-item', { hasText: 'Alpha' }).hover().catch(() => {});
    await page.locator('.space-item', { hasText: 'My Space' }).click();
    await page.waitForTimeout(300);
    await workCard.locator('.tab-item', { hasText: 'Charlie' }).hover();
    await workCard.locator('.tab-item', { hasText: 'Charlie' }).locator('.tab-remove').click();
    await page.waitForTimeout(6500);
    check('toast auto-hides after 6s', !(await toastVisible()));
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); }
});
