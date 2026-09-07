// chrome.storage.sync throws messages like "Resource::kQuotaBytesPerItem
// quota exceeded" (not the documented constant names). SyncManager must map
// every known variant to a human-readable explanation.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

async function messageFor(errText) {
  const ctx = { console: { log() {}, warn() {}, error() {} }, TextEncoder, setTimeout, clearTimeout,
    chrome: { storage: { onChanged: { addListener() {} },
      local: { async get() { return { spaces: [{ id: 's' }], collections: [{ id: 'c', spaceId: 's', name: 'c', tabs: [{ id: 't', title: 'x', url: 'u', favicon: '', addedAt: 1 }] }] }; }, async set() {} },
      sync: { async get() { return {}; }, async set() { throw new Error(errText); }, async remove() {} } } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'js/sync.js'), 'utf8') + '\nthis.SyncManager = SyncManager;', ctx);
  const ev = []; ctx.SyncManager.on('sync_error', (e, d) => ev.push(d));
  await ctx.SyncManager.pushToSync();
  assert(ev.length, 'no sync_error event emitted');
  return ev[0].message;
}

(async () => {
  console.log('\n# unit: sync error message mapping');
  const cases = [
    ['Resource::kQuotaBytesPerItem quota exceeded', /8 KB per-item/],
    ['QUOTA_BYTES_PER_ITEM quota exceeded', /8 KB per-item/],
    ['Resource::kQuotaBytes quota exceeded', /100 KB/],
    ['QUOTA_BYTES quota exceeded', /100 KB/],
    ['Resource::kMaxWriteOperationsPerMinute quota exceeded', /Too many sync writes/],
    ['MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded', /Too many sync writes/],
    ['Resource::kMaxItems quota exceeded', /Too many sync items/],
    ['Something else entirely', /Something else entirely/],
  ];
  let fails = 0;
  for (const [input, expect] of cases) {
    const out = await messageFor(input);
    const ok = expect.test(out);
    if (!ok) fails++;
    console.log(`  ${ok ? '✓' : '✗'} ${input.padEnd(55)} -> ${out}`);
  }
  console.log(fails ? `\nsync errors: ${fails} FAILED` : '\nsync errors: PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('  ✗', e.message); process.exit(1); });
