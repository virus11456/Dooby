// UI language: English by default on an English Chromium, switchable to
// 繁體中文 in Settings, applied to static markup, dynamic renders, prompts and
// the manifest name; persists across reload; Auto returns to the browser language.
const { launchExtension, openNewTab, collectErrors, suite } = require('../helpers');

suite('e2e: localization (en / zh_TW)', async (check) => {
  const ext = await launchExtension({ tag: 'i18n' });
  try {
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page);
    const txt = sel => page.evaluate(s => document.querySelector(s).textContent.trim(), sel);
    const attr = (sel, a) => page.evaluate(([s, a]) => document.querySelector(s).getAttribute(a), [sel, a]);

    check('manifest name is localized (English)', (await ext.sw.evaluate(() => chrome.runtime.getManifest().name)) === 'Dooby - Tab & Bookmark Manager');
    check('default language is English on an English browser', (await txt('#btnSaveSession')) === 'Save Session' && (await txt('.spaces-sidebar h3')) === 'Spaces');
    check('html lang is en', (await page.evaluate(() => document.documentElement.lang)) === 'en');

    // Switch to zh_TW
    await page.click('#btnSettings');
    check('language select defaults to Auto', (await page.evaluate(() => document.getElementById('settingLanguage').value)) === 'auto');
    await page.selectOption('#settingLanguage', 'zh_TW');
    await page.waitForTimeout(800);
    check('static markup switches to zh_TW', (await txt('#btnSaveSession')) === '儲存工作階段' && (await txt('.spaces-sidebar h3')) === '空間' && (await txt('.tabs-sidebar h3')) === '開啟中的分頁');
    check('settings modal itself is translated', (await txt('#settingsModal h3')) === '設定' && (await txt('#btnCloseSettings')) === '完成');
    check('select options are translated', (await page.evaluate(() => document.querySelector('#settingCollectionSort option[value="name"]').textContent)) === '名稱 A → Z');
    check('attributes (placeholder/title) are translated', (await attr('#searchInput', 'placeholder')) === '搜尋分頁和收藏…（Ctrl+K）' && (await attr('#btnSettings', 'title')) === '設定');
    check('html lang is zh-TW', (await page.evaluate(() => document.documentElement.lang)) === 'zh-TW');
    check('document title translated', (await page.title()) === 'Dooby - 新分頁');
    check('dynamic render translated (empty collection hint)', (await txt('.collection-body-empty')) === '把分頁拖到這裡');
    check('sync status translated', (await txt('#syncStatusText')) === '已同步');
    await page.click('#btnCloseSettings');

    // Prompts use the translated string
    await page.evaluate(() => { window.__prompts = []; window.prompt = (m) => { window.__prompts.push(m); return null; }; });
    await page.click('#btnAddCollection');
    check('prompt text translated', JSON.stringify(await page.evaluate(() => window.__prompts)) === JSON.stringify(['輸入收藏名稱：']));

    // Context menu labels translated
    await page.click('.collection-card .btn-more');
    await page.waitForTimeout(200);
    const menu = await page.evaluate(() => [...document.querySelectorAll('#contextMenu li')].map(li => li.textContent.trim()).filter(Boolean));
    check('context menu translated', menu.includes('重新命名') && menu.includes('刪除收藏'), menu);
    await page.keyboard.press('Escape');
    await page.click('body', { position: { x: 5, y: 400 } });

    // Donate modal (html messages) translated
    await page.click('#btnDonate');
    check('donate pitch (html message) translated', (await page.evaluate(() => document.querySelector('[data-i18n-html="donate_pitch"]').innerHTML)).includes('<strong>1 USDT</strong>') && (await txt('[data-i18n-html="donate_pitch"]')).startsWith('喜歡 Dooby'));
    await page.click('#btnCloseDonate');

    // Persists across reload
    await openNewTab(ext, page);
    check('language persists after reload', (await txt('#btnSaveSession')) === '儲存工作階段');

    // Back to Auto → English
    await page.click('#btnSettings');
    await page.selectOption('#settingLanguage', 'auto');
    await page.waitForTimeout(800);
    check('Auto returns to English', (await txt('#btnSaveSession')) === 'Save Session' && (await txt('#settingsModal h3')) === 'Settings');
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); }
});
