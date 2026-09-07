// Dooby UI localization.
//
// Messages live in _locales/<lang>/messages.json (Chrome i18n format, so the
// manifest name/description localize too). The UI language follows the
// browser unless the user picks one in Settings, which chrome.i18n cannot
// do on its own, so this small loader reads the JSON files directly.
//
//   t('key')                       -> string
//   t('key', { n: 3 })             -> "{n}" placeholders substituted
//   <el data-i18n="key">           -> textContent
//   <el data-i18n-html="key">      -> innerHTML (bundled messages only)
//   <el data-i18n-title="key">     -> title attribute
//   <el data-i18n-placeholder="key"> -> placeholder attribute
const I18n = {
  SUPPORTED: ['en', 'zh_TW'],
  _lang: 'en',
  _messages: {},
  _fallback: {},

  // 'auto' (or empty) follows the browser UI language.
  detect(pref) {
    if (pref && pref !== 'auto' && this.SUPPORTED.includes(pref)) return pref;
    let ui = '';
    try { ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || ''; } catch (e) { ui = navigator.language || ''; }
    return /^zh/i.test(ui) ? 'zh_TW' : 'en';
  },

  async load(pref) {
    this._lang = this.detect(pref);
    this._fallback = await this._fetch('en');
    this._messages = this._lang === 'en' ? this._fallback : await this._fetch(this._lang);
    document.documentElement.lang = this._lang === 'zh_TW' ? 'zh-TW' : 'en';
    return this._lang;
  },

  async _fetch(lang) {
    try {
      const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
      return await res.json();
    } catch (e) {
      console.warn('Dooby: could not load locale', lang, e);
      return {};
    }
  },

  lang() { return this._lang; },

  t(key, subs) {
    const entry = this._messages[key] || this._fallback[key];
    let s = entry && typeof entry.message === 'string' ? entry.message : key;
    if (subs) for (const [k, v] of Object.entries(subs)) s = s.split(`{${k}}`).join(String(v));
    return s;
  },

  applyToDom(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.t(el.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = this.t(el.dataset.i18nHtml); });
    scope.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = this.t(el.dataset.i18nTitle); });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = this.t(el.dataset.i18nPlaceholder); });
  }
};

function t(key, subs) { return I18n.t(key, subs); }
