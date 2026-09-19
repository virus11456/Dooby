// The Vercel project `dooby` serves this repo's index.html as https://toolist.cc/.
// Homepage sibling links must be present with clean URLs (no affiliate params).
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
let fails = 0;
const check = (label, ok, detail) => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? '  → ' + JSON.stringify(detail) : ''}`); };
console.log('\n# unit: toolist.cc landing sibling links');

function tagHref(marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.lastIndexOf('<a', i);
  const end = html.indexOf('>', i);
  if (start < 0 || end < 0) return null;
  const m = html.slice(start, end).match(/href="([^"]+)"/);
  return m ? m[1] : null;
}
const stocktools = tagHref('data-sibling="stocktools"');
const crypig = tagHref('data-sibling="crypig"');
const warhubs = tagHref('data-sibling="warhubs"');
const simples = tagHref('data-footer="simples"');

check('Stocktools → https://stocktools.cc/', stocktools === 'https://stocktools.cc/', stocktools);
check('Crypig → https://hypeboss.cc/', crypig === 'https://hypeboss.cc/', crypig);
check('WARHUBS → https://warhubs.com/', warhubs === 'https://warhubs.com/', warhubs);
check('SIMPLES 工具網 → https://simples.com.tw/', simples === 'https://simples.com.tw/' && html.includes('SIMPLES 工具網'), simples);

const RELATED = {
  'us-fee': 'https://www.stocktools.cc/tw/us-fee-calculator',
  'us-etf': 'https://www.stocktools.cc/tw/us-etf',
  'us-deposit': 'https://www.stocktools.cc/tw/us-deposit',
  'us-open-account': 'https://www.stocktools.cc/tw/us-open-account',
  'us-dividend': 'https://www.stocktools.cc/tw/us-dividend',
  'us-first-buy': 'https://www.stocktools.cc/tw/us-first-buy',
  'us-premarket': 'https://www.stocktools.cc/tw/us-premarket',
  'us-order-types': 'https://www.stocktools.cc/tw/us-order-types',
  'us-adr': 'https://www.stocktools.cc/tw/us-adr',
  'us-fx': 'https://www.stocktools.cc/tw/us-fx',
  'us-fractional': 'https://www.stocktools.cc/tw/us-fractional',
  'us-earnings': 'https://www.stocktools.cc/tw/us-earnings',
};
const relatedHrefs = Object.keys(RELATED).map(k => tagHref(`data-related="${k}"`));
check('美股手續費 → Stocktools fee calculator', relatedHrefs[0] === RELATED['us-fee'], relatedHrefs[0]);
check('美股 ETF → Stocktools ETF page', relatedHrefs[1] === RELATED['us-etf'], relatedHrefs[1]);
check('美股入金 → Stocktools deposit page', relatedHrefs[2] === RELATED['us-deposit'], relatedHrefs[2]);
check('美股開戶 → Stocktools open-account page', relatedHrefs[3] === RELATED['us-open-account'], relatedHrefs[3]);
check('美股配息 → Stocktools dividend page', relatedHrefs[4] === RELATED['us-dividend'], relatedHrefs[4]);
check('第一次買美股 → Stocktools first-buy page', relatedHrefs[5] === RELATED['us-first-buy'], relatedHrefs[5]);
check('美股盤前盤後 → Stocktools premarket page', relatedHrefs[6] === RELATED['us-premarket'], relatedHrefs[6]);
check('市價／限價 → Stocktools order-types page', relatedHrefs[7] === RELATED['us-order-types'], relatedHrefs[7]);
check('美股 ADR → Stocktools ADR page', relatedHrefs[8] === RELATED['us-adr'], relatedHrefs[8]);
check('美股匯損 → Stocktools FX page', relatedHrefs[9] === RELATED['us-fx'], relatedHrefs[9]);
check('美股碎股 → Stocktools fractional page', relatedHrefs[10] === RELATED['us-fractional'], relatedHrefs[10]);
check('美股財報日 → Stocktools earnings page', relatedHrefs[11] === RELATED['us-earnings'], relatedHrefs[11]);
check('相關工具 rows in header and footer', (html.match(/aria-label="相關工具"/g) || []).length === 2);
check('each related deep link appears twice (header + footer)', Object.keys(RELATED).every(k => (html.match(new RegExp(`data-related="${k}"`, 'g')) || []).length === 2));
check('related labels are Traditional Chinese', html.includes('>美股手續費<') && html.includes('>美股 ETF<') && html.includes('>美股入金<') && html.includes('>美股開戶<') && html.includes('>美股配息<') && html.includes('>第一次買美股<') && html.includes('>美股盤前盤後<') && html.includes('>市價／限價<') && html.includes('>美股 ADR<') && html.includes('>美股匯損<') && html.includes('>美股碎股<') && html.includes('>美股財報日<'));

const networkUrls = [stocktools, crypig, warhubs, simples, ...relatedHrefs];
check('no affiliate query params on sibling or related URLs', networkUrls.every(u => u && !u.includes('?')));
check('does not link to moneytools-eight.vercel.app', !/moneytools-eight\.vercel\.app/i.test(html));
check('does not mention RimTown or Polyboy', !/rimtown/i.test(html) && !/polyboy/i.test(html));
check('no Firstrade or other financial affiliate URLs', !/firstrade|ftdl\.|affid=|ibstat|partnerid|ref_id=/i.test(html));

const ROOT = path.resolve(__dirname, '..', '..');
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
check('robots.txt allows all crawlers', /^\s*User-agent:\s*\*\s*$/m.test(robots));
check('robots.txt allows /', /^\s*Allow:\s*\/\s*$/m.test(robots));
check('robots.txt points at the sitemap', /^\s*Sitemap:\s*https:\/\/toolist\.cc\/sitemap\.xml\s*$/m.test(robots));

const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const expectedLocs = [
  'https://toolist.cc/',
  'https://toolist.cc/changelog',
  'https://toolist.cc/privacy-policy',
  'https://toolist.cc/app',
];
check('sitemap lists homepage + public 200 routes', expectedLocs.every(u => locs.includes(u)) && locs.length === expectedLocs.length, locs);
check('sitemap URLs are absolute toolist.cc https', locs.every(u => /^https:\/\/toolist\.cc(\/|$)/.test(u)));
check('sitemap has no .html aliases or /dooby duplicates', locs.every(u => !u.endsWith('.html') && !u.includes('/dooby')));

console.log(fails ? `\nlanding links: ${fails} FAILED` : '\nlanding links: PASSED');
process.exit(fails ? 1 : 0);
