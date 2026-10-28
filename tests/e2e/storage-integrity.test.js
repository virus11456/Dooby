// Data integrity under concurrent writes. Every write to spaces / collections
// runs under one lock (js/datalock.js) shared by the new tab page, other Dooby
// tabs and the background worker, so simultaneous saves never overwrite each
// other; ids stay unique when created in the same millisecond; every edit
// stamps localUpdateTime so a cloud pull cannot replace a fresh local edit;
// nested bookmark folders import exactly once.
const { launchExtension, openNewTab, collectErrors, suite } = require('../helpers');

suite('e2e: storage integrity (concurrent writes, ids, timestamps, import)', async (check) => {
  const ext = await launchExtension({ tag: 'integrity' });
  try {
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page);

    // 1. Same page: five saves fired at once all land.
    let r = await page.evaluate(async () => {
      const sp = (await Storage.getSpaces())[0];
      const col = await Storage.addCollection(sp.id, 'Burst');
      await Promise.all([1, 2, 3, 4, 5].map(i => Storage.addTabToCollection(col.id, { title: 'p' + i, url: 'https://e.com/' + i })));
      return (await Storage.getCollections()).find(c => c.id === col.id).tabs.map(t => t.title).sort();
    });
    check('five simultaneous saves keep all five bookmarks', r.join() === 'p1,p2,p3,p4,p5', r);

    // 2. A rename and a save at the same moment both survive.
    r = await page.evaluate(async () => {
      const sp = (await Storage.getSpaces())[0];
      const col = await Storage.addCollection(sp.id, 'Before');
      await Promise.all([Storage.renameCollection(col.id, 'After'), Storage.addTabToCollection(col.id, { title: 'x', url: 'https://e.com/x' })]);
      const c = (await Storage.getCollections()).find(c => c.id === col.id);
      return { name: c.name, tabs: c.tabs.length };
    });
    check('rename is not lost to a concurrent save', r.name === 'After' && r.tabs === 1, r);

    // 3. Mixed operations at once: delete one bookmark, move another, pin a third, add a fourth.
    r = await page.evaluate(async () => {
      const sp = (await Storage.getSpaces())[0];
      const a = await Storage.addCollectionWithTabs(sp.id, 'Mix A', [1, 2, 3].map(i => ({ title: 'm' + i, url: 'https://m.com/' + i })));
      const b = await Storage.addCollection(sp.id, 'Mix B');
      const [t1, t2, t3] = a.tabs;
      await Promise.all([
        Storage.removeTabFromCollection(a.id, t1.id),
        Storage.moveTab(a.id, b.id, t2.id, 0),
        Storage.togglePinTab(a.id, t3.id),
        Storage.addTabToCollection(b.id, { title: 'm4', url: 'https://m.com/4' })
      ]);
      const cols = await Storage.getCollections();
      const A = cols.find(c => c.id === a.id), B = cols.find(c => c.id === b.id);
      return { a: A.tabs.map(t => t.title + (t.pinned ? '*' : '')), b: B.tabs.map(t => t.title).sort() };
    });
    check('delete, move, pin and add at once all apply', r.a.join() === 'm3*' && r.b.join() === 'm2,m4', r);

    // 4. Page and background worker writing at the same time (toolbar quick-save while editing).
    const qsId = await page.evaluate(async () => {
      await Storage.saveSettings({ quickSaveCollectionId: '' });
      const sp = (await Storage.getSpaces())[0];
      await Storage.setActiveSpaceId(sp.id);
      return (await Storage.getCollectionsBySpace(sp.id)).find(c => /^quick save$/i.test(c.name)).id;
    });
    const before = await page.evaluate(async (id) => (await Storage.getCollections()).find(c => c.id === id).tabs.length, qsId);
    await Promise.all([
      page.evaluate(async (id) => { await Promise.all(Array.from({ length: 8 }, (_, i) => Storage.addTabToCollection(id, { title: 'page' + i, url: 'https://page.example/' + i }))); }, qsId),
      ext.sw.evaluate(async () => { await Promise.all(Array.from({ length: 8 }, (_, i) => saveTabToQuickSave({ title: 'bg' + i, url: 'https://bg.example/' + i, favIconUrl: '' }))); })
    ]);
    r = await page.evaluate(async (id) => (await Storage.getCollections()).find(c => c.id === id).tabs, qsId);
    check('page and toolbar saves at once: none lost', r.length - before === 16, { before, after: r.length });
    check('all bookmark ids unique', new Set(r.map(t => t.id)).size === r.length);

    // 5. Ids made in the same millisecond are distinct.
    r = await page.evaluate(async () => {
      const sp = (await Storage.getSpaces())[0];
      const made = await Promise.all([Storage.addCollection(sp.id, 'Twin A'), Storage.addCollection(sp.id, 'Twin B'), Storage.addSpace('Twin S1'), Storage.addSpace('Twin S2')]);
      const ids = Array.from({ length: 2000 }, () => DoobyData.newId('tab'));
      return { cols: made[0].id !== made[1].id, spaces: made[2].id !== made[3].id, bulkUnique: new Set(ids).size === ids.length, shape: /^tab-[0-9a-z]+-[0-9a-z]+$/.test(ids[0]) };
    });
    check('collections and spaces created together get different ids', r.cols && r.spaces, r);
    check('2000 ids in a burst are all unique and keep the tab- prefix', r.bulkUnique && r.shape, r);

    // 6. Every edit stamps localUpdateTime, even with Chrome sync off (Dooby Cloud only users).
    r = await page.evaluate(async () => {
      SyncManager._enabled = false;
      await chrome.storage.local.set({ localUpdateTime: 1000 });
      const col = (await Storage.getCollections())[0];
      await Storage.renameCollection(col.id, col.name + ' ');
      const { localUpdateTime } = await chrome.storage.local.get('localUpdateTime');
      return localUpdateTime;
    });
    check('an edit bumps localUpdateTime with Chrome sync disabled', r > Date.now() - 60000, r);

    // 7. A cloud pull whose request was in flight during a local edit keeps that edit.
    r = await page.evaluate(async () => {
      const cols = await Storage.getCollections();
      const target = cols[0];
      await chrome.storage.local.set({ localUpdateTime: 1000 });
      const remote = { version: 3, updatedAt: 5000, spaces: await Storage.getSpaces(), collections: cols.map(c => ({ ...c, name: c.id === target.id ? 'From cloud' : c.name })) };
      const orig = { isSignedIn: CloudManager.isSignedIn, fetchRemote: CloudManager.fetchRemote };
      CloudManager.isSignedIn = () => true;
      CloudManager.fetchRemote = async () => { await Storage.renameCollection(target.id, 'Edited locally'); return JSON.parse(JSON.stringify(remote)); };
      let replaced;
      try { replaced = await CloudManager.pull(); } finally { Object.assign(CloudManager, orig); }
      return { replaced, name: (await Storage.getCollections()).find(c => c.id === target.id).name };
    });
    check('cloud pull does not overwrite an edit made while it was fetching', r.replaced === false && r.name === 'Edited locally', r);

    // 8. Nested bookmark folders (the shape every browser exports) import once each.
    r = await page.evaluate(() => Storage.parseBookmarksHtml(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><H3>Bookmarks bar</H3><DL><p>
        <DT><A HREF="https://a.com">A</A>
        <DT><H3>Work</H3><DL><p>
          <DT><A HREF="https://b.com">B</A>
          <DT><H3>Docs</H3><DL><p><DT><A HREF="https://c.com">C</A><DT><A HREF="https://d.com">D</A></DL><p>
        </DL><p>
        <DT><H3>Empty</H3><DL><p></DL><p>
      </DL><p>
      <DT><H3>Other</H3><DL><p><DT><A HREF="https://e.com">E</A></DL><p>
    </DL><p>`).map(f => f.name + ':' + f.tabs.map(t => t.url.replace('https://', '').replace('/', '')).join('+')));
    check('nested folders import exactly once, parents first, empty folders skipped', r.join('|') === 'Bookmarks bar:a.com|Work:b.com|Docs:c.com+d.com|Other:e.com', r);
    r = await page.evaluate(() => Storage.parseBookmarksHtml('<a href="https://x.com">X</a><a href="https://y.com">Y</a><a>no href</a>').map(f => f.name + ':' + f.tabs.length));
    check('flat link list still imports as one collection', r.join() === 'Imported Bookmarks:2', r);

    check('no page errors', errors.length === 0, errors);
  } finally {
    await ext.close();
  }
});
