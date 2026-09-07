// Donor activation in real Chromium. A throw-away ECDSA P-256 key pair is
// generated per run and its public half injected as
// DonorManager.ACTIVATION_PUBLIC_KEY, so the test never needs the real
// private key.
//  1. a pre-existing fake activation from an older version is revoked on start
//  2. an old-style fake code ("DOOBY-1-2") is rejected
//  3. a valid signed code for the wrong name is rejected
//  4. the code for the right name activates, unlocks premium themes, shows the
//     VIP badge and survives reload
const { generateKeyPairSync, sign } = require('crypto');
const { launchExtension, collectErrors, suite } = require('../helpers');

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicJwk = publicKey.export({ format: 'jwk' });
const codeFor = name => 'DOOBY-' + sign('sha256', Buffer.from(name.toLowerCase().replace(/\s+/g, ''), 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

suite('e2e: donor activation codes', async (check) => {
  const ext = await launchExtension({ tag: 'donor', viewport: { width: 1280, height: 900 } });
  try {
    const page = await ext.ctx.newPage();
    const errors = collectErrors(page);
    await page.addInitScript(({ jwk }) => {
      document.addEventListener('DOMContentLoaded', () => { DonorManager.ACTIVATION_PUBLIC_KEY = jwk; }, { once: true });
    }, { jwk: publicJwk });
    const open = async () => {
      await page.goto(ext.newtabUrl);
      await page.waitForFunction(() => typeof DonorManager !== 'undefined' && DonorManager._state);
      await page.waitForTimeout(800);
    };
    await open();

    // 1. fake activation seeded by an older version
    await page.evaluate(async () => {
      await chrome.storage.local.set({ donorState: { activated: true, name: 'Cheater', code: 'DOOBY-1-2', activatedAt: 1 }, activeTheme: 'aurora' });
    });
    await open();
    check('fake stored activation is revoked on start', !(await page.evaluate(() => DonorManager.isActivated())));
    check('premium theme falls back after revoke', (await page.evaluate(() => DonorManager.getCurrentTheme())) !== 'aurora');

    const tryActivate = async (name, code) => {
      await page.click('#btnDonate');
      await page.click('.donate-tab[data-tab="activate"]');
      await page.fill('#activateName', name);
      await page.fill('#activateCode', code);
      await page.click('#btnActivate');
      await page.waitForTimeout(600);
      const err = await page.evaluate(() => { const e = document.getElementById('activateError'); return e.classList.contains('hidden') ? null : e.textContent; });
      const activated = await page.evaluate(() => DonorManager.isActivated());
      await page.click('#btnCloseDonate');
      return { err, activated };
    };
    const realName = 'Test Donor';
    const realCode = codeFor(realName);
    const fake = await tryActivate('Cheater', 'DOOBY-1-2');
    check('old-style fake code is rejected', fake.activated === false && !!fake.err, fake);
    const wrong = await tryActivate('Someone Else', realCode);
    check('valid code with wrong name is rejected', wrong.activated === false && !!wrong.err, wrong);
    const real = await tryActivate('test  donor', realCode);
    check('right name (case/space-insensitive) activates', real.activated === true && !real.err, real);
    check('VIP badge visible', await page.evaluate(() => !document.getElementById('vipBadge').classList.contains('hidden')));

    await page.click('#btnDonate');
    await page.click('.donate-tab[data-tab="themes"]');
    await page.click('.theme-card[data-theme-id="sakura"]');
    await page.waitForTimeout(400);
    check('premium theme selectable after activation', (await page.evaluate(() => DonorManager.getCurrentTheme())) === 'sakura');
    await page.click('#btnCloseDonate');

    await open();
    check('activation survives reload', await page.evaluate(() => DonorManager.isActivated()));
    check('premium theme survives reload', (await page.evaluate(() => DonorManager.getCurrentTheme())) === 'sakura');
    check('no page errors', errors.length === 0, errors);
  } finally { await ext.close(); }
});
