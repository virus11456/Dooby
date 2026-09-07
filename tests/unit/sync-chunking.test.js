// Round-trip test: load js/storage.js + js/sync.js into a VM with a fake
// chrome.storage that enforces the REAL chrome.storage.sync quota rules
// (8192 bytes per item, 102400 total, 512 items), then push and pull data
// with English, Chinese and emoji titles and verify nothing is lost.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const QUOTA_BYTES = 102400, QUOTA_BYTES_PER_ITEM = 8192, MAX_ITEMS = 512;
const bytes = s => Buffer.byteLength(s, 'utf8');
const itemSize = (k, v) => k.length + bytes(JSON.stringify(v));

function makeArea(enforce) {
  const store = {};
  return {
    _store: store,
    async get(keys) {
      if (keys === null || keys === undefined) return JSON.parse(JSON.stringify(store));
      if (typeof keys === 'string') keys = [keys];
      const out = {}; for (const k of keys) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); return out;
    },
    async set(items) {
      if (enforce) {
        for (const [k, v] of Object.entries(items)) {
          if (itemSize(k, v) > QUOTA_BYTES_PER_ITEM) throw new Error('Resource::kQuotaBytesPerItem quota exceeded');
        }
        const merged = { ...store, ...items };
        const total = Object.entries(merged).reduce((a, [k, v]) => a + itemSize(k, v), 0);
        if (total > QUOTA_BYTES) throw new Error('Resource::kQuotaBytes quota exceeded');
        if (Object.keys(merged).length > MAX_ITEMS) throw new Error('Resource::kMaxItems quota exceeded');
      }
      Object.assign(store, JSON.parse(JSON.stringify(items)));
    },
    async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
    async getBytesInUse() { return Object.entries(store).reduce((a, [k, v]) => a + itemSize(k, v), 0); }
  };
}

function loadSync() {
  const local = makeArea(false), sync = makeArea(true);
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, TextEncoder, setTimeout, clearTimeout,
    chrome: { storage: { local, sync, onChanged: { addListener() {} } } }
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(ROOT, 'js/sync.js'), 'utf8') +
    '\nthis.SyncManager = SyncManager; this.Storage = Storage;', ctx);
  return { ctx, local, sync, SyncManager: ctx.SyncManager, Storage: ctx.Storage };
}

function mkTab(i, kind) {
  const titles = {
    en: `Article ${i}: Why does Chrome extension sync keep failing - Stack Overflow`,
    zh: `第${i}篇 為什麼Chrome套件的雲端同步都會失敗 — 技術討論 | 巴哈姆特`,
    emoji: `🔥🚀 第${i}篇 "quoted" back\\slash 😀😀😀😀😀😀😀😀😀😀 テスト 테스트`
  };
  return {
    id: `tab-${1725000000000 + i}-ab12c`, title: titles[kind],
    url: `https://example.com/questions/${100000 + i}/why-does-chrome-extension-sync-keep-failing?utm_source=share&ref=${i}`,
    favicon: i % 3 === 0 ? 'data:image/png;base64,AAAA' : `https://example.com/favicon-${i % 7}.ico`,
    addedAt: 1725000000000 + i, ...(i % 5 === 0 ? { pinned: true } : {})
  };
}
function build(nTabs, kind) {
  const cols = [];
  for (let c = 0; c < Math.ceil(nTabs / 20); c++) cols.push({ id: `col-${c}`, spaceId: 'space-default', name: `收藏 ${c}`, tabs: [], createdAt: 1, ...(c === 0 ? { pinned: true } : {}) });
  for (let i = 0; i < nTabs; i++) cols[Math.floor(i / 20)].tabs.push(mkTab(i, kind));
  return cols;
}

async function run(nTabs, kind) {
  const { SyncManager, local, sync } = loadSync();
  const spaces = [{ id: 'space-default', name: '我的空間', createdAt: 1 }];
  const collections = build(nTabs, kind);
  await local.set({ spaces, collections });
  const events = [];
  SyncManager.on('*', (e, d) => events.push([e, d]));
  await SyncManager.pushToSync();
  const err = events.find(e => e[0] === 'sync_error');
  if (err) return { ok: false, err: err[1] };
  const maxItem = Math.max(...Object.entries(sync._store).map(([k, v]) => itemSize(k, v)));
  const chunkKeys = Object.keys(sync._store).filter(k => k.startsWith('dooby_col_')).length;
  // Pull into a fresh "device"
  const dev2 = loadSync();
  Object.assign(dev2.sync._store, JSON.parse(JSON.stringify(sync._store)));
  const pulled = await dev2.SyncManager.pullFromSync(true);
  assert(pulled, 'pull returned false');
  const got = (await dev2.local.get('collections')).collections;
  const expected = SyncManager._optimizeForSync(collections);
  assert.strictEqual(JSON.stringify(got), JSON.stringify(expected), 'round-trip mismatch');
  assert.strictEqual(JSON.stringify((await dev2.local.get('spaces')).spaces), JSON.stringify(spaces));
  return { ok: true, maxItem, chunkKeys, legacy: 'dooby_collections' in sync._store, total: await sync.getBytesInUse() };
}

(async () => {
  let fails = 0;
  console.log('\n# unit: sync chunking round-trip against real quota rules');
  for (const kind of ['en', 'zh', 'emoji']) {
    for (const n of [5, 10, 20, 24, 25, 26, 27, 30, 40, 60, 100, 200, 300]) {
      const r = await run(n, kind);
      if (r.ok) {
        console.log(`  ✓ ${kind.padEnd(5)} tabs=${String(n).padStart(3)} chunks=${String(r.chunkKeys).padStart(2)} legacy=${r.legacy ? 'y' : 'n'} maxItem=${r.maxItem} total=${r.total}`);
        assert(r.maxItem <= QUOTA_BYTES_PER_ITEM);
      } else if (/too large/i.test(r.err.error)) {
        // Data genuinely exceeds the 100 KB total quota: a clear error is the expected outcome.
        console.log(`  ✓ ${kind.padEnd(5)} tabs=${String(n).padStart(3)} reports clear "too large" error: ${r.err.message}`);
      } else {
        console.log(`  ✗ ${kind.padEnd(5)} tabs=${String(n).padStart(3)} ERROR ${r.err.error}: ${r.err.message}`);
        fails++;
      }
    }
  }
  // Stale chunk + stale legacy cleanup: big push then small push
  {
    const { SyncManager, local, sync } = loadSync();
    await local.set({ spaces: [{ id: 's', name: 's', createdAt: 1 }], collections: build(100, 'zh') });
    await SyncManager.pushToSync();
    const before = Object.keys(sync._store).filter(k => k.startsWith('dooby_col_')).length;
    await local.set({ collections: build(5, 'zh') });
    await SyncManager.pushToSync();
    const keys = Object.keys(sync._store);
    assert.strictEqual(keys.filter(k => k.startsWith('dooby_col_')).length, 1, 'stale chunks not cleaned');
    assert(keys.includes('dooby_collections'), 'legacy should be written when small');
    await local.set({ collections: build(100, 'zh') });
    await SyncManager.pushToSync();
    assert(!Object.keys(sync._store).includes('dooby_collections'), 'stale legacy key should be removed');
    console.log(`  ✓ stale chunk/legacy cleanup (${before} chunks -> 1 -> ${Object.keys(sync._store).filter(k => k.startsWith('dooby_col_')).length})`);
  }
  // Surrogate-pair boundary fuzz: chunker must never produce lone surrogates
  {
    const { SyncManager } = loadSync();
    for (let trial = 0; trial < 200; trial++) {
      let s = '';
      const len = 20000 + Math.floor(Math.random() * 5000);
      while (s.length < len) s += ['a', '"', '\\', '中', '😀', '\n', 'é'][Math.floor(Math.random() * 7)];
      const chunks = SyncManager._chunkString(s, 'dooby_col_');
      assert.strictEqual(chunks.join(''), s);
      chunks.forEach((c, i) => {
        assert(SyncManager._itemBytes(`dooby_col_${i}`, c) <= SyncManager.MAX_ITEM_BYTES, 'chunk over budget');
        assert(!/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c), 'split surrogate');
      });
    }
    console.log('  ✓ surrogate/escape boundary fuzz (200 trials)');
  }
  console.log(fails ? `\nsync chunking: ${fails} FAILED` : '\nsync chunking: PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('  ✗', e); process.exit(1); });
