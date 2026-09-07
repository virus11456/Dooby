// Load the extension from two DIFFERENT directories (two "computers") and
// require the same extension ID: manifest.json must carry a "key" so
// chrome.storage.sync namespaces meet across devices.
const fs = require('fs'), os = require('os'), path = require('path');
const { EXT_DIR, launchExtension, suite } = require('../helpers');

suite('e2e: stable extension id across install folders', async (check) => {
  const dirs = ['computerA', 'computerB'].map(n => fs.mkdtempSync(path.join(os.tmpdir(), `dooby-${n}-`)));
  try {
    for (const d of dirs) fs.cpSync(EXT_DIR, d, { recursive: true, filter: p => !/node_modules|\/\.git|\/tests|\/dist/.test(p) });
    const ids = [];
    for (const d of dirs) { const ext = await launchExtension({ extDir: d, tag: 'id' }); ids.push(ext.extId); await ext.close(); }
    check(`same id on both folders (${ids[0]})`, ids[0] === ids[1], ids);
    check('id matches the published unpacked id', ids[0] === 'dfoidibckihcnmakgoabkebinahggked', ids[0]);
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});
