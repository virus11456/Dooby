// Static homepage (index.html) that Vercel serves at https://toolist.cc/.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { suite } = require('../helpers');
const ROOT = path.resolve(__dirname, '..', '..');

function serveSite() {
  const server = http.createServer((req, res) => {
    let p = new URL(req.url, 'http://x').pathname;
    if (p === '/' || p === '/dooby' || p === '/dooby/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

suite('e2e: toolist.cc landing sibling links', async (check) => {
  const site = await serveSite();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.DOOBY_CHROME ? { executablePath: process.env.DOOBY_CHROME } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(site.url + '/');
    const links = await page.evaluate(() => [...document.querySelectorAll('[data-sibling]')].map(a => ({
      key: a.dataset.sibling, href: a.href, text: a.textContent.replace(/\s+/g, ' ').trim(), search: a.search
    })));
    check('exactly three sibling chips', links.length === 3, links);
    check('Stocktools', links[0] && links[0].key === 'stocktools' && links[0].href === 'https://stocktools.cc/' && links[0].search === '' && links[0].text.includes('Stocktools'));
    check('Crypig / hypeboss.cc', links[1] && links[1].key === 'crypig' && links[1].href === 'https://hypeboss.cc/' && links[1].search === '' && links[1].text.includes('Crypig'));
    check('WARHUBS', links[2] && links[2].key === 'warhubs' && links[2].href === 'https://warhubs.com/' && links[2].search === '' && links[2].text.includes('WARHUBS'));
    const simples = await page.evaluate(() => {
      const a = document.querySelector('[data-footer="simples"]');
      return a ? { href: a.href, text: a.textContent.trim(), search: a.search } : null;
    });
    check('SIMPLES 工具網 footer', simples && simples.href === 'https://simples.com.tw/' && simples.text === 'SIMPLES 工具網' && simples.search === '');
    check('no RimTown/Polyboy', await page.evaluate(() => !/rimtown/i.test(document.body.innerText) && !/polyboy/i.test(document.body.innerText)));
    check('no moneytools-eight.vercel.app in sibling list', await page.evaluate(() => ![...document.querySelectorAll('[data-sibling]')].some(a => /moneytools-eight\.vercel\.app/i.test(a.href))));
    const chipsVisible = await page.evaluate(() => {
      const el = document.querySelector('.siblings');
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0;
    });
    check('sibling chips visible without scrolling', chipsVisible);
  } finally {
    await browser.close();
    site.close();
  }
});
