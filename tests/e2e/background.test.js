// The periodic sync alarm must not leave an unhandled "Receiving end does not
// exist" rejection in the service worker when no Dooby page is open.
const { launchExtension, suite } = require('../helpers');

suite('e2e: background alarm with no listener', async (check) => {
  const ext = await launchExtension({ tag: 'bg' });
  try {
    await ext.sw.evaluate(() => new Promise(r => setTimeout(r, 500)));
    for (const p of ext.ctx.pages()) await p.close();
    const consoleErrors = [];
    ext.sw.on('console', m => { if (/Receiving end|Uncaught/.test(m.text())) consoleErrors.push(m.text()); });
    await ext.sw.evaluate(() => {
      self.__rej = [];
      self.addEventListener('unhandledrejection', e => self.__rej.push(String(e.reason && e.reason.message || e.reason)));
    });
    await ext.sw.evaluate(() => chrome.alarms.create('dooby-sync', { when: Date.now() + 200 }));
    await ext.sw.evaluate(() => new Promise(r => setTimeout(r, 2500)));
    const rej = await ext.sw.evaluate(() => self.__rej);
    check('no unhandled rejections in service worker', rej.length === 0, rej);
    check('no "Receiving end does not exist" console errors', consoleErrors.length === 0, consoleErrors);
  } finally { await ext.close(); }
});
