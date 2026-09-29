/* Shared language preference for the Toolist introduction pages. */
(async function () {
  const buttons = [...document.querySelectorAll('[data-site-lang]')];
  let lang = 'zh';
  try { const saved = localStorage.getItem('toolist-lang'); lang = saved === 'en' || saved === 'zh' ? saved : (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'); } catch (_) {}
  let dictionary;
  try { const response = await fetch('/translations.json'); if (!response.ok) throw new Error('translations'); dictionary = await response.json(); } catch (_) { buttons.forEach(b => { b.disabled = true; }); return; }
  const records = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode(node) { return node.parentElement.closest('script,style,textarea,code,[data-site-lang]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
  while (walker.nextNode()) { const node = walker.currentNode; const key = node.textContent.trim(); if (dictionary[key]) records.push({ node, zh: node.textContent, en: node.textContent.replace(key, dictionary[key]) }); }
  const attrs = [];
  document.querySelectorAll('[aria-label],meta[name="description"],meta[property="og:title"],meta[property="og:description"]').forEach(el => { const attr = el.tagName === 'META' ? 'content' : 'aria-label'; const zh = el.getAttribute(attr); if (dictionary[zh]) attrs.push({ el, attr, zh, en: dictionary[zh] }); });
  function apply(value, persist) {
    lang = value; document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
    records.forEach(r => { r.node.textContent = r[lang]; }); attrs.forEach(r => r.el.setAttribute(r.attr, r[lang]));
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.siteLang === lang)));
    if (persist) { try { localStorage.setItem('toolist-lang', lang); } catch (_) {} }
  }
  buttons.forEach(b => b.addEventListener('click', () => apply(b.dataset.siteLang, true)));
  apply(lang, false);
})();
