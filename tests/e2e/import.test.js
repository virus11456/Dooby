// Every JSON import entry point (top-bar icon, Export/Import modal, Import
// Bookmarks modal) accepts Dooby backups, TabMe, Toby and Chrome bookmark
// JSON, and the export buttons each trigger exactly one download.
const fs = require('fs'), os = require('os'), path = require('path');
const { launchExtension, openNewTab, collectErrors, suite } = require('../helpers');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooby-import-'));
const write = (name, obj) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
const tabme = write('tabme.json', { isTabme: true, version: 3, spaces: [{ objectType: 'space', title: 'Bookmarks', folders: [
  { objectType: 'folder', title: '一日牙醫', items: [{ objectType: 'bookmark', title: '成效表', url: 'https://docs.google.com/a', favIconUrl: '' }, { objectType: 'bookmark', title: '表單', url: 'https://docs.google.com/b', favIconUrl: '' }] },
  { objectType: 'folder', title: '愛妮島', items: [{ objectType: 'bookmark', title: 'El Nido', url: 'https://elnidogotour.com/', favIconUrl: '' }] },
  { objectType: 'folder', title: 'Empty', items: [] }
] }] });
const toby = write('toby.json', { version: 3, lists: [{ title: 'Toby List', cards: [{ title: 'Card 1', url: 'https://toby.example/1' }, { title: 'Card 2', url: 'https://toby.example/2' }] }] });
const backup = write('dooby.json', { version: 3, spaces: [{ id: 'space-x', name: 'Restored Space', createdAt: 1 }], collections: [{ id: 'col-x', spaceId: 'space-x', name: 'Restored Col', tabs: [{ id: 't1', title: 'Restored tab', url: 'https://restored.example/', favicon: '', addedAt: 1 }], createdAt: 1 }] });
const junk = path.join(dir, 'junk.json'); fs.writeFileSync(junk, 'not json at all');

suite('e2e: JSON import entry points and export buttons', async (check) => {
  const ext = await launchExtension({ tag: 'import' });
  try {
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.type() + ': ' + d.message()); await d.accept(); });
    await openNewTab(ext, page);
    const state = () => page.evaluate(async () => { const c = await Storage.getCollections(); return { names: c.map(x => x.name), tabs: c.reduce((a, x) => a + x.tabs.length, 0), spaces: (await Storage.getSpaces()).map(s => s.name) }; });

    // 1. Top-bar import icon with a TabMe backup (the reported failure)
    dialogs.length = 0;
    await page.setInputFiles('#importFileInput', tabme);
    await page.waitForTimeout(1500);
    let s = await state();
    check('top-bar import accepts TabMe: collections added', s.names.includes('一日牙醫') && s.names.includes('愛妮島') && !s.names.includes('Empty'), s);
    check('top-bar import of TabMe asks once and never says "Invalid import data"', dialogs.length === 1 && dialogs[0].includes('TabMe') && !dialogs.some(d => /Invalid import data|failed/i.test(d)), dialogs);
    check('success shown as toast', (await page.evaluate(() => document.getElementById('toastText').textContent)).includes('3'));
    check('TabMe tabs counted', s.tabs === 3, s.tabs);

    // 2. Export/Import modal "Import from JSON" with a Toby backup
    dialogs.length = 0;
    await page.click('#btnExportImport');
    await page.setInputFiles('#importBackupInput', toby);
    await page.waitForTimeout(1500);
    s = await state();
    check('modal import accepts Toby', s.names.includes('Toby List') && s.tabs === 5, s);
    check('Toby import asks once', dialogs.length === 1 && dialogs[0].includes('Toby'), dialogs);
    check('export/import modal closed after import', await page.evaluate(() => document.getElementById('exportImportModal').classList.contains('hidden')));

    // 3. Import Bookmarks modal with a Dooby backup (replace flow)
    dialogs.length = 0;
    await page.click('#btnImportBookmarks');
    await page.setInputFiles('#importBookmarkJson', backup);
    await page.waitForTimeout(1500);
    s = await state();
    check('Dooby backup replaces data from any entry point', s.spaces.length === 1 && s.spaces[0] === 'Restored Space' && s.names.length === 1 && s.names[0] === 'Restored Col', s);
    check('replace flow asks once with the replace warning', dialogs.length === 1 && /replace/i.test(dialogs[0]), dialogs);

    // 4. Invalid file gives a clear message, not a crash
    dialogs.length = 0;
    await page.setInputFiles('#importFileInput', junk);
    await page.waitForTimeout(800);
    check('invalid JSON reports a readable error', dialogs.length === 1 && dialogs[0].includes('not valid JSON'), dialogs);

    // 5. Export buttons: header and modal each trigger exactly one download
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.click('#btnExportData');
    await page.waitForTimeout(1200);
    check('header export triggers exactly one download', downloads === 1, downloads);
    await page.click('#btnExportImport');
    await page.click('#btnExportDataModal');
    await page.waitForTimeout(1200);
    check('modal export triggers exactly one download', downloads === 2, downloads);
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
