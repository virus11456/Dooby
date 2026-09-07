// Daylight light theme is free: selectable without activation, applies light
// CSS variables, survives reload; premium themes stay locked.
const { launchExtension, openNewTab, collectErrors, suite } = require('../helpers');

suite('e2e: Daylight light theme', async (check) => {
  const ext = await launchExtension({ tag: 'theme' });
  try {
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await openNewTab(ext, page);
    const cssVar = name => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.click('#btnTheme');
    const cards = await page.evaluate(() => [...document.querySelectorAll('.theme-card')].map(c => ({ id: c.dataset.themeId, locked: c.classList.contains('locked'), badge: c.querySelector('.theme-card-badge').textContent })));
    const daylight = cards.find(c => c.id === 'daylight');
    check('Daylight card listed as free and unlocked', daylight && !daylight.locked && daylight.badge === 'Free', cards);
    check('premium themes still locked', cards.filter(c => !['midnight', 'daylight'].includes(c.id)).every(c => c.locked));
    await page.click('.theme-card[data-theme-id="daylight"]');
    await page.waitForTimeout(400);
    check('theme switched to daylight', (await page.evaluate(() => DonorManager.getCurrentTheme())) === 'daylight');
    check('light background applied', (await bodyBg()) === 'rgb(244, 246, 250)', await bodyBg());
    check('ink alpha variables switched to dark ink', (await cssVar('--ink-08')).startsWith('rgba(15, 23, 42'), await cssVar('--ink-08'));
    check('text is dark on light', (await cssVar('--text-primary')) === '#171a23');
    await page.click('#btnCloseDonate');
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'dooby-daylight.png') }).catch(() => {});

    await openNewTab(ext, page, { settle: 600 });
    check('daylight persists after reload', (await page.evaluate(() => DonorManager.getCurrentTheme())) === 'daylight' && (await bodyBg()) === 'rgb(244, 246, 250)');

    await page.click('#btnTheme');
    await page.click('.theme-card[data-theme-id="midnight"]');
    await page.waitForTimeout(300);
    check('switching back restores white ink alphas', (await cssVar('--ink-08')).startsWith('rgba(255, 255, 255'), await cssVar('--ink-08'));
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); }
});
