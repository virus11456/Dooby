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
check('no affiliate query params on sibling URLs', [stocktools, crypig, warhubs, simples].every(u => u && !u.includes('?')));
check('does not link to moneytools-eight.vercel.app', !/moneytools-eight\.vercel\.app/i.test(html));
check('does not mention RimTown or Polyboy', !/rimtown/i.test(html) && !/polyboy/i.test(html));

console.log(fails ? `\nlanding links: ${fails} FAILED` : '\nlanding links: PASSED');
process.exit(fails ? 1 : 0);
