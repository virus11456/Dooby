// Push 100 tabs with Chinese titles through the REAL chrome.storage.sync API
// in Chromium, then wipe local and pull them back like a second device.
const { launchExtension, openNewTab, suite } = require('../helpers');

suite('e2e: chrome.storage.sync push/pull with 100 Chinese-titled tabs', async (check) => {
  const ext = await launchExtension({ tag: 'sync' });
  try {
    const page = await ext.ctx.newPage();
    await openNewTab(ext, page, { settle: 1500 });
    for (const [N, KIND] of [[100, 'zh'], [100, 'en'], [40, 'zh']]) {
      const r = await page.evaluate(async ({ N, KIND }) => {
        const spaces = [{ id: 'space-default', name: '我的空間', createdAt: 1 }];
        const collections = [];
        for (let c = 0; c < Math.ceil(N / 20); c++) collections.push({ id: `col-${c}`, spaceId: 'space-default', name: KIND === 'en' ? `Coll ${c}` : `收藏 ${c}`, tabs: [], createdAt: 1 });
        for (let i = 0; i < N; i++) {
          collections[Math.floor(i / 20)].tabs.push({
            id: `tab-${1725000000000 + i}-ab12c`,
            title: KIND === 'en' ? `Article ${i}: Why does Chrome extension sync keep failing - Stack Overflow` : `第${i}篇 為什麼Chrome套件的雲端同步都會失敗 — 技術討論 | 巴哈姆特 😀`,
            url: `https://example.com/questions/${100000 + i}/why-does-chrome-extension-sync-keep-failing?utm_source=share&ref=${i}`,
            favicon: `https://example.com/favicon-${i % 7}.ico`,
            addedAt: 1725000000000 + i
          });
        }
        await chrome.storage.sync.clear();
        await chrome.storage.local.set({ spaces, collections, localUpdateTime: Date.now() });
        const events = [];
        SyncManager.on('*', (e, d) => events.push({ e, d }));
        await SyncManager.pushToSync();
        const synced = await chrome.storage.sync.get(null);
        const enc = new TextEncoder();
        const maxItem = Math.max(...Object.entries(synced).map(([k, v]) => k.length + enc.encode(JSON.stringify(v)).length));
        // Second device: wipe local, pull.
        await chrome.storage.local.set({ collections: [], spaces: [] });
        const pulled = await SyncManager.pullFromSync(true);
        const { collections: c2 } = await chrome.storage.local.get('collections');
        return { err: events.find(x => x.e === 'sync_error'), keys: Object.keys(synced).length, maxItem, pulled, pulledTabs: (c2 || []).reduce((a, c) => a + c.tabs.length, 0) };
      }, { N, KIND });
      check(`${KIND} ${N} tabs: push succeeds`, !r.err, r.err);
      check(`${KIND} ${N} tabs: every item ≤ 8192 bytes (max ${r.maxItem})`, r.maxItem <= 8192);
      check(`${KIND} ${N} tabs: pull restores all tabs`, r.pulled && r.pulledTabs === N, r);
    }
  } finally { await ext.close(); }
});
