// Persistent partner shortcut chips on the new-tab page: Stocktools + Crypig,
// plus a small SIMPLES 工具網 footer. No RimTown/Polyboy, no affiliate params.
const { launchExtension, openNewTab, collectErrors, suite } = require('../helpers');

const STOCKTOOLS = 'https://stocktools.cc/';
const CRYPIG = 'https://hypeboss.cc/';
const SIMPLES = 'https://simples.com.tw/';

suite('e2e: persistent shortcut chips and footer', async (check) => {
  const ext = await launchExtension({ tag: 'shortcuts' });
  try {
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page);

    const chips = await page.evaluate(() => [...document.querySelectorAll('.quick-link-chip')].map(a => ({
      key: a.dataset.shortcut,
      href: a.href,
      text: a.textContent.replace(/\s+/g, ' ').trim(),
      search: a.search,
      target: a.getAttribute('target')
    })));
    check('exactly two shortcut chips', chips.length === 2, chips);
    check('Stocktools chip URL (no affiliate params)', chips[0] && chips[0].key === 'stocktools' && chips[0].href === STOCKTOOLS && chips[0].search === '' && chips[0].text === 'Stocktools');
    check('Crypig chip URL (no affiliate params)', chips[1] && chips[1].key === 'crypig' && chips[1].href === CRYPIG && chips[1].search === '' && chips[1].text === 'Crypig');
    check('chips open in a new tab', chips.every(c => c.target === '_blank'));

    const footer = await page.evaluate(() => {
      const a = document.querySelector('.page-footer a[data-footer="simples"]');
      return a ? { href: a.href, text: a.textContent.trim(), search: a.search } : null;
    });
    check('SIMPLES 工具網 footer', footer && footer.text === 'SIMPLES 工具網' && footer.href === SIMPLES && footer.search === '');

    const banned = await page.evaluate(() => {
      const html = document.body.innerText;
      return { rimtown: /rimtown/i.test(html), polyboy: /polyboy/i.test(html) };
    });
    check('does not mention RimTown or Polyboy', !banned.rimtown && !banned.polyboy, banned);

    const manifest = await ext.sw.evaluate(() => {
      const m = chrome.runtime.getManifest();
      return { permissions: m.permissions || [], host_permissions: m.host_permissions || [] };
    });
    check('no extra host_permissions', manifest.host_permissions.length === 0, manifest);
    check('permissions unchanged (tabs, storage, alarms, identity)', JSON.stringify(manifest.permissions) === JSON.stringify(['tabs', 'storage', 'alarms', 'identity']), manifest.permissions);

    await openNewTab(ext, page);
    check('chips persist after reload', (await page.evaluate(() => document.querySelectorAll('.quick-link-chip').length)) === 2
      && (await page.evaluate(() => document.querySelector('[data-shortcut="stocktools"]').href)) === STOCKTOOLS
      && (await page.evaluate(() => document.querySelector('[data-shortcut="crypig"]').href)) === CRYPIG
      && (await page.evaluate(() => document.querySelector('[data-footer="simples"]').textContent.trim())) === 'SIMPLES 工具網');

    await page.click('#btnSettings');
    await page.selectOption('#settingLanguage', 'zh_TW');
    await page.waitForTimeout(800);
    check('shortcuts label localizes to 連結', (await page.evaluate(() => document.getElementById('quickLinksLabel').textContent.trim())) === '連結');
    check('brand names stay Stocktools / Crypig in zh_TW', (await page.evaluate(() => [...document.querySelectorAll('.quick-link-chip')].map(a => a.textContent.replace(/\s+/g, ' ').trim())))
      .join('|') === 'Stocktools|Crypig');

    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); }
});
