// Browser capabilities Dooby adapts to. Loaded before every other script, in
// the new tab page and (via importScripts) in the background worker.
//
// Safari Web Extensions support almost everything Dooby uses, with two gaps:
//  - no chrome.identity, so Dooby Cloud sign-in runs on the web app instead
//    (see CloudManager._signInViaWebApp and js/ext-link.js);
//  - storage.sync never leaves the device, so Chrome sync is switched off and
//    Dooby Cloud is the only way to sync.
const DoobyPlatform = (() => {
  const protocol = (typeof location !== 'undefined' && location.protocol) || '';
  const build = typeof DOOBY_BUILD !== 'undefined' ? DOOBY_BUILD : 'chrome';
  const isSafari = build === 'safari' || protocol === 'safari-web-extension:';
  const hasIdentity = typeof chrome !== 'undefined' && !!(chrome.identity && chrome.identity.launchWebAuthFlow);
  return {
    build,
    isSafari,
    canUseIdentity: hasIdentity && !isSafari,
    chromeSyncWorks: !isSafari
  };
})();
