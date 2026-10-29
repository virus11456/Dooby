// Content script, Safari build only (added to the manifest by
// scripts/stage-safari.js; the Chrome build signs in with chrome.identity).
//
// Safari has no identity API, so Dooby Cloud sign-in runs on the web app
// (toolist.cc/dooby/app). When the web app was opened by the extension it
// posts its fresh session here; this script passes it to the background
// worker, which verifies it, and reports the result back to the page.
(() => {
  // Tells the web app an extension is listening (checked before it posts).
  document.documentElement.setAttribute('data-dooby-extension', '1');

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const m = event.data;
    if (!m || m.type !== 'dooby:ext-session' || typeof m.nonce !== 'string') return;
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'DOOBY_CLOUD_LINK', nonce: m.nonce, session: m.session });
    } catch (err) {
      reply = { ok: false, error: (err && err.message) || String(err) };
    }
    window.postMessage({ type: 'dooby:ext-session-ack', nonce: m.nonce, ok: !!(reply && reply.ok), error: (reply && reply.error) || '' }, location.origin);
  });
})();
