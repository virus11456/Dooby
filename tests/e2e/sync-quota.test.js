// Chrome sync holds about 100 KB, a few hundred bookmarks. From 80% the page
// warns once (toast + hint in the Dooby Cloud dialog) and points at Dooby
// Cloud; it warns again when sync is full, never twice for the same level,
// and not at all for users already on Dooby Cloud.
const { launchExtension, openNewTab, collectErrors, waitFor, suite } = require('../helpers');

suite('e2e: Chrome sync quota warning', async (check) => {
  const ext = await launchExtension({ tag: 'quota' });
  try {
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page, { settle: 1500 });

    // Seed N realistic bookmarks and push through the real chrome.storage.sync.
    const pushWith = (n) => page.evaluate(async (n) => {
      const sp = (await Storage.getSpaces())[0];
      const collections = [];
      for (let c = 0; c < Math.ceil(n / 20); c++) collections.push({ id: `qc-${c}`, spaceId: sp.id, name: `收藏 ${c}`, tabs: [], createdAt: 1 });
      for (let i = 0; i < n; i++) collections[Math.floor(i / 20)].tabs.push({ id: `qt-${i}`, title: `第${i}篇 台北週末去哪玩？十個私房景點整理 | 旅遊部落格`, url: `https://travel.example.com.tw/post/${100000 + i}?utm_source=line`, favicon: '', addedAt: i });
      await chrome.storage.sync.clear();
      await chrome.storage.local.set({ collections, localUpdateTime: Date.now() });
      const events = [];
      const off = (e, d) => { if (e === 'sync_usage' || e === 'sync_error') events.push({ e, d }); };
      SyncManager.on('*', off);
      SyncManager._enabled = true;
      await SyncManager.pushToSync();
      await new Promise(r => setTimeout(r, 300));
      return events;
    }, n);
    const toast = () => page.evaluate(() => ({ visible: !document.getElementById('toast').classList.contains('hidden'), text: document.getElementById('toastText').textContent, action: document.getElementById('toastAction').textContent }));
    const closeToast = () => page.evaluate(() => hideToast());

    // 1. Small library: no warning.
    let ev = await pushWith(100);
    let usage = ev.find(x => x.e === 'sync_usage');
    check('usage is reported on push', usage && usage.d.percent > 0 && usage.d.percent < 80 && usage.d.tabCount === 100 && usage.d.remainingTabs > 100, usage && usage.d);
    check('no warning below 80%', !(await toast()).visible || !/Chrome/.test((await toast()).text));

    // 2. Near the limit: one toast with a Dooby Cloud action, and the dialog hint.
    ev = await pushWith(390);
    usage = ev.find(x => x.e === 'sync_usage').d;
    check('390 Chinese-titled bookmarks use 80%+ of Chrome sync', usage.percent >= 80 && usage.percent < 100, usage);
    await waitFor(page, () => !document.getElementById('toast').classList.contains('hidden'), { label: 'near-full toast' });
    let tst = await toast();
    check('near-full toast names the percentage and remaining room', tst.text.includes(`${usage.percent}%`) && tst.text.includes(String(usage.remainingTabs)) && /Dooby Cloud/.test(tst.text), tst);
    check('toast offers to open Dooby Cloud', /Dooby Cloud/.test(tst.action), tst);
    await page.click('#toastAction');
    check('action opens the Dooby Cloud dialog', await page.evaluate(() => !document.getElementById('cloudModal').classList.contains('hidden')));
    check('dialog shows the quota hint', await page.evaluate(() => { const h = document.getElementById('syncQuotaHint'); return !h.classList.contains('hidden') && h.textContent.length > 10 && !h.classList.contains('full'); }));
    await page.click('#btnCloseCloud');

    // 3. Same level again: no repeat.
    await closeToast();
    await pushWith(395);
    check('no second toast for the same level', !(await toast()).visible);

    // 4. Over the limit: push refused, a "full" toast appears once.
    ev = await pushWith(520);
    check('over the limit the push is refused with an error', ev.some(x => x.e === 'sync_error'), ev.map(x => x.e));
    await waitFor(page, () => !document.getElementById('toast').classList.contains('hidden'), { label: 'full toast' });
    tst = await toast();
    check('full toast says new bookmarks stay on this computer', /Dooby Cloud/.test(tst.text) && !tst.text.includes('%'), tst);
    check('dialog hint switches to the full style', await page.evaluate(() => document.getElementById('syncQuotaHint').classList.contains('full')));
    await closeToast();

    // 5. Back under 80%: state resets, so a later climb warns again.
    await pushWith(100);
    check('dropping below 80% clears the warning state', await page.evaluate(async () => !(await chrome.storage.local.get('syncQuotaWarning')).syncQuotaWarning));
    check('hint hidden again below 80%', await page.evaluate(() => document.getElementById('syncQuotaHint').classList.contains('hidden')));

    // 6. Dooby Cloud users are not nagged.
    await page.evaluate(() => { window.__origSignedIn = CloudManager.isSignedIn; CloudManager.isSignedIn = () => true; });
    await pushWith(390);
    check('no toast for users already on Dooby Cloud', !(await toast()).visible);
    check('no hint for users already on Dooby Cloud', await page.evaluate(() => document.getElementById('syncQuotaHint').classList.contains('hidden')));
    await page.evaluate(() => { CloudManager.isSignedIn = window.__origSignedIn; });

    // 7. Translations: Chinese UI shows the Chinese message.
    check('messages exist in both languages', await page.evaluate(async () => {
      const [en, zh] = await Promise.all(['en', 'zh_TW'].map(l => fetch(`/_locales/${l}/messages.json`).then(r => r.json())));
      return ['sync_quota_near', 'sync_quota_full', 'sync_quota_action'].every(k => en[k] && zh[k] && /[一-鿿]/.test(zh[k].message));
    }));
    check('no page errors', errors.length === 0, errors);
  } finally {
    await ext.close();
  }
});
