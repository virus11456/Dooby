// Dooby Cloud — Google sign-in + cross-platform sync backed by Supabase.
//
// Why this exists: chrome.storage.sync only reaches other desktop Chromes.
// Dooby Cloud stores the same spaces/collections document in a Supabase table
// (one row per user, protected by Row Level Security) so the web app on
// iPad/iPhone can read and edit it too.
//
// Everything here is plain fetch() against Supabase's REST endpoints; no SDK
// is bundled, so the extension stays free of remote or third-party code.
//
// Auth flow (Chrome, Edge):
//   1. chrome.identity.launchWebAuthFlow → Google OAuth (response_type=id_token)
//   2. POST {supabase}/auth/v1/token?grant_type=id_token  → Supabase session
//   3. session kept in chrome.storage.local ("cloudSession"), refreshed as needed
//
// Auth flow (Safari, which has no chrome.identity):
//   1. the page stores a one-time nonce ("cloudLinkPending") and opens the web
//      app at {webAppUrl}#dooby-ext-link=<nonce>
//   2. the web app signs in with Google in its own, separate session and posts
//      it to js/ext-link.js (content script, Safari build only)
//   3. the background worker checks the nonce and the sender, asks Supabase who
//      the token belongs to, then stores the session (acceptLinkedSession)
//
// Sync policy: one JSON document per user, last-writer-wins by updatedAt.
// On first sign-in the local and cloud documents are UNION-merged so nothing
// is lost; afterwards local edits push (debounced) and the page polls for
// newer cloud versions.

const CloudManager = {
  _t(key, fallback, subs) { return typeof I18n !== 'undefined' ? I18n.t(key, subs) : fallback; },

  _session: null,
  _listeners: [],
  _pushTimer: null,
  _pushing: false,
  _pollTimer: null,
  _lastSyncAt: null,
  _lastError: null,

  // ------------------------------------------------------------------
  // Configuration / state
  // ------------------------------------------------------------------

  isConfigured() {
    const c = typeof DoobyConfig !== 'undefined' ? DoobyConfig : {};
    return !!(c.supabaseUrl && c.supabaseAnonKey && c.googleClientId);
  },

  isSignedIn() {
    return !!(this._session && this._session.refresh_token);
  },

  getUser() {
    return this._session ? this._session.user : null;
  },

  getStatus() {
    return {
      configured: this.isConfigured(),
      signedIn: this.isSignedIn(),
      user: this.getUser(),
      lastSyncAt: this._lastSyncAt,
      lastError: this._lastError
    };
  },

  async init() {
    const { cloudSession, cloudLastSyncAt, cloudNeedsMerge } = await chrome.storage.local.get(['cloudSession', 'cloudLastSyncAt', 'cloudNeedsMerge']);
    this._session = cloudSession || null;
    this._lastSyncAt = cloudLastSyncAt || null;
    if (!this.isConfigured() || !this.isSignedIn()) return false;

    let pulled = false;
    try {
      if (cloudNeedsMerge) {
        // Signed in through the web app while no Dooby tab was waiting:
        // do the first-sign-in union merge now.
        await this._firstSync();
        pulled = true;
      } else {
        pulled = await this.pull();
      }
    } catch (e) {
      this._fail(e);
    }
    this._startPolling();
    return pulled;
  },

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  _randomString(bytes = 32) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  },

  async _sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  },

  // Separated so tests can stub the browser round-trip.
  _launchAuthFlow(url) {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, redirectUrl => {
        if (chrome.runtime.lastError || !redirectUrl) {
          reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : this._t('cloud_err_cancelled', 'Sign-in was cancelled')));
        } else {
          resolve(redirectUrl);
        }
      });
    });
  },

  async signIn() {
    if (!this.isConfigured()) throw new Error('Dooby Cloud is not configured in this build');
    if (typeof DoobyPlatform !== 'undefined' && !DoobyPlatform.canUseIdentity) return this._signInViaWebApp();

    // Supabase verifies that the ID token's nonce claim equals SHA-256(nonce),
    // so Google gets the hash and Supabase gets the raw value.
    const rawNonce = this._randomString(16);
    const hashedNonce = await this._sha256Hex(rawNonce);
    const state = this._randomString(16);
    const redirectUri = chrome.identity.getRedirectURL();

    const params = new URLSearchParams({
      client_id: DoobyConfig.googleClientId,
      redirect_uri: redirectUri,
      response_type: 'id_token',
      scope: 'openid email profile',
      nonce: hashedNonce,
      state,
      prompt: 'select_account'
    });
    const redirectUrl = await this._launchAuthFlow('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());

    const hash = new URL(redirectUrl).hash.replace(/^#/, '');
    const out = new URLSearchParams(hash);
    if (out.get('state') !== state) throw new Error('Sign-in state mismatch');
    const idToken = out.get('id_token');
    if (!idToken) throw new Error(out.get('error_description') || out.get('error') || 'Google did not return an ID token');

    const res = await fetch(`${DoobyConfig.supabaseUrl}/auth/v1/token?grant_type=id_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: DoobyConfig.supabaseAnonKey },
      body: JSON.stringify({ provider: 'google', id_token: idToken, nonce: rawNonce })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error_description || body.msg || body.message || `Sign-in failed (${res.status})`);

    await this._storeSession(body);
    this._notify('auth_changed');
    await this._firstSync();
    this._startPolling();
    return this.getUser();
  },

  // First sync after signing in: union-merge so neither side loses bookmarks.
  async _firstSync() {
    try {
      await this.mergeAndPush();
      await chrome.storage.local.remove('cloudNeedsMerge');
    } catch (e) {
      this._fail(e);
    }
  },

  // ---- Safari: sign in on the web app, hand the session back ----

  LINK_TIMEOUT_MS: 10 * 60 * 1000,

  async _signInViaWebApp() {
    const nonce = this._randomString(16);
    await chrome.storage.local.set({ cloudLinkPending: { nonce, at: Date.now() } });
    const url = DoobyConfig.webAppUrl + '#dooby-ext-link=' + nonce;
    const tab = await chrome.tabs.create({ url, active: true });

    const session = await new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.storage.onChanged.removeListener(onStorage);
        chrome.tabs.onRemoved.removeListener(onTabClosed);
        fn(v);
      };
      const onStorage = (changes, area) => {
        if (area === 'local' && changes.cloudSession && changes.cloudSession.newValue) finish(resolve, changes.cloudSession.newValue);
      };
      // Closing the sign-in tab before it finished cancels; a tab the worker
      // closes after success arrives after the session, so it is ignored.
      const onTabClosed = (tabId) => {
        if (tab && tabId === tab.id) setTimeout(() => finish(reject, new Error(this._t('cloud_err_cancelled', 'Sign-in was cancelled'))), 300);
      };
      const timer = setTimeout(() => finish(reject, new Error(this._t('cloud_err_cancelled', 'Sign-in was cancelled'))), this.LINK_TIMEOUT_MS);
      chrome.storage.onChanged.addListener(onStorage);
      chrome.tabs.onRemoved.addListener(onTabClosed);
    });

    this._session = session;
    this._notify('auth_changed');
    await this._firstSync();
    this._startPolling();
    return this.getUser();
  },

  // Runs in the background worker when js/ext-link.js forwards a session from
  // the web app. Trusts nothing in the message: the nonce must match the one
  // this extension just issued, the sender must be the web app, and the user
  // comes from Supabase, not from the page.
  async acceptLinkedSession(message, senderUrl) {
    const { cloudLinkPending } = await chrome.storage.local.get('cloudLinkPending');
    if (!cloudLinkPending || !message || message.nonce !== cloudLinkPending.nonce) throw new Error('Unknown sign-in request');
    if (Date.now() - cloudLinkPending.at > this.LINK_TIMEOUT_MS) throw new Error('Sign-in request expired');
    const app = new URL(DoobyConfig.webAppUrl);
    let from;
    try { from = new URL(senderUrl); } catch (e) { throw new Error('Unexpected sender'); }
    if (from.origin !== app.origin || !from.pathname.startsWith(app.pathname)) throw new Error('Unexpected sender');
    const s = message.session || {};
    if (!s.refresh_token) throw new Error('Incomplete session');

    // Trade the page's refresh token for a brand-new session owned by the
    // extension: proves the token is real, gets the user from Supabase, and
    // leaves the copy the web page held unusable (refresh tokens rotate).
    const res = await fetch(`${DoobyConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: DoobyConfig.supabaseAnonKey },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token || !body.user || !body.user.id) throw new Error('Session rejected by Dooby Cloud');

    await chrome.storage.local.remove('cloudLinkPending');
    await chrome.storage.local.set({ cloudNeedsMerge: true });
    await this._storeSession(body);
    return { ok: true, email: this._session.user.email };
  },

  async signOut() {
    const s = this._session;
    this._session = null;
    this._stopPolling();
    await chrome.storage.local.remove(['cloudSession', 'cloudRemoteStamp', 'cloudNeedsMerge', 'cloudLinkPending']);
    if (s && s.access_token) {
      fetch(`${DoobyConfig.supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: DoobyConfig.supabaseAnonKey, Authorization: 'Bearer ' + s.access_token }
      }).catch(() => {});
    }
    this._notify('auth_changed');
  },

  async _storeSession(body) {
    const u = body.user || {};
    const meta = u.user_metadata || {};
    this._session = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Date.now() + Math.max(60, (body.expires_in || 3600) - 60) * 1000,
      user: {
        id: u.id,
        email: u.email || meta.email || '',
        name: meta.full_name || meta.name || u.email || '',
        avatar: meta.avatar_url || meta.picture || ''
      }
    };
    await chrome.storage.local.set({ cloudSession: this._session });
  },

  async _accessToken() {
    if (!this._session) throw new Error(this._t('cloud_err_not_signed_in', 'Not signed in'));
    if (Date.now() < this._session.expires_at) return this._session.access_token;

    const res = await fetch(`${DoobyConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: DoobyConfig.supabaseAnonKey },
      body: JSON.stringify({ refresh_token: this._session.refresh_token })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Refresh token revoked/expired: drop the session so the UI asks to sign in again.
      this._session = null;
      await chrome.storage.local.remove(['cloudSession', 'cloudRemoteStamp']);
      this._notify('auth_changed');
      throw new Error(body.error_description || body.msg || this._t('cloud_err_session_expired', 'Session expired, please sign in again'));
    }
    await this._storeSession(body);
    return this._session.access_token;
  },

  async _headers(extra = {}) {
    const token = await this._accessToken();
    return {
      apikey: DoobyConfig.supabaseAnonKey,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...extra
    };
  },

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------

  _countTabs(collections) {
    return (collections || []).reduce((n, c) => n + ((c.tabs && c.tabs.length) || 0), 0);
  },

  async _localDocument() {
    const { spaces = [], collections = [], localUpdateTime = 0 } = await chrome.storage.local.get(['spaces', 'collections', 'localUpdateTime']);
    return { version: 3, spaces, collections, updatedAt: localUpdateTime || 0 };
  },

  async _applyDocument(doc) {
    await chrome.storage.local.set({
      spaces: doc.spaces || [],
      collections: doc.collections || [],
      localUpdateTime: doc.updatedAt || Date.now()
    });
  },

  async fetchRemote() {
    const uid = this.getUser().id;
    const res = await fetch(`${DoobyConfig.supabaseUrl}/rest/v1/dooby_data?select=data,updated_at&user_id=eq.${encodeURIComponent(uid)}`, {
      headers: await this._headers({ Accept: 'application/json' })
    });
    if (!res.ok) throw new Error(this._t('cloud_err_read', `Cloud read failed (${res.status})`, { status: res.status }));
    const rows = await res.json();
    if (!rows.length) return null;
    const doc = rows[0].data || {};
    const stamp = Date.parse(rows[0].updated_at) || 0;
    if (!doc.updatedAt) doc.updatedAt = stamp;
    await this._rememberRemoteStamp(stamp);
    return doc;
  },

  // Cheap freshness probe: only the row's updated_at (a few dozen bytes)
  // instead of the whole document. Returns epoch ms, or null when there is no row.
  async fetchRemoteStamp() {
    const uid = this.getUser().id;
    const res = await fetch(`${DoobyConfig.supabaseUrl}/rest/v1/dooby_data?select=updated_at&user_id=eq.${encodeURIComponent(uid)}`, {
      headers: await this._headers({ Accept: 'application/json' })
    });
    if (!res.ok) throw new Error(this._t('cloud_err_read', `Cloud read failed (${res.status})`, { status: res.status }));
    const rows = await res.json();
    if (!rows.length) return null;
    return Date.parse(rows[0].updated_at) || 0;
  },

  // Remember the updated_at of the cloud copy this device last saw (read or
  // wrote), so polls skip the download while nothing has changed remotely.
  async _rememberRemoteStamp(ms) {
    if (ms) await chrome.storage.local.set({ cloudRemoteStamp: ms });
  },

  async writeRemote(doc) {
    const uid = this.getUser().id;
    const res = await fetch(`${DoobyConfig.supabaseUrl}/rest/v1/dooby_data`, {
      method: 'POST',
      headers: await this._headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ user_id: uid, data: doc, updated_at: new Date(doc.updatedAt || Date.now()).toISOString() })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(this._t('cloud_err_write', `Cloud write failed (${res.status}) ${text.slice(0, 120)}`, { status: res.status, detail: text.slice(0, 120) }));
    }
    await this._rememberRemoteStamp(Date.parse(new Date(doc.updatedAt || Date.now()).toISOString()));
  },

  async deleteRemote() {
    const uid = this.getUser().id;
    const res = await fetch(`${DoobyConfig.supabaseUrl}/rest/v1/dooby_data?user_id=eq.${encodeURIComponent(uid)}`, {
      method: 'DELETE',
      headers: await this._headers()
    });
    if (!res.ok) throw new Error(this._t('cloud_err_delete', `Cloud delete failed (${res.status})`, { status: res.status }));
  },

  // Pull if the cloud document is newer than local. Returns true when local
  // storage was replaced.
  async pull(force = false) {
    if (!this.isSignedIn()) return false;
    if (!force) {
      // Polls run every minute on every visible Dooby tab: ask only for the
      // timestamp and download the document only when it actually changed.
      const stamp = await this.fetchRemoteStamp();
      if (stamp === null) return false;
      const { localUpdateTime = 0, cloudRemoteStamp = 0 } = await chrome.storage.local.get(['localUpdateTime', 'cloudRemoteStamp']);
      if (stamp === cloudRemoteStamp || (localUpdateTime && stamp <= localUpdateTime)) {
        this._markSynced();
        return false;
      }
    }
    const remote = await this.fetchRemote();
    if (!remote) return false;
    // Compare and replace under the shared data lock: an edit made while the
    // request was in flight bumps localUpdateTime first and wins.
    const outcome = await DoobyData.withLock(async () => {
      const local = await this._localDocument();
      const remoteHasTabs = this._countTabs(remote.collections) > 0;
      if (!force && local.updatedAt && remote.updatedAt <= local.updatedAt) return 'current';
      if (!remoteHasTabs && this._countTabs(local.collections) > 0 && !force) {
        // Never let an empty cloud document wipe a populated device.
        console.warn('Dooby Cloud: cloud document is empty, keeping local data');
        return 'kept';
      }
      await this._applyDocument(remote);
      return 'applied';
    });
    if (outcome === 'current') { this._markSynced(); return false; }
    if (outcome === 'kept') return false;
    this._markSynced();
    this._notify('data_updated');
    return true;
  },

  // Push local to the cloud (used after local edits).
  async push() {
    if (!this.isSignedIn()) return false;
    if (this._pushing) return false;
    this._pushing = true;
    this._notify('sync_start');
    try {
      const local = await this._localDocument();
      if (!local.updatedAt) local.updatedAt = Date.now();
      if (this._countTabs(local.collections) === 0) {
        const remote = await this.fetchRemote();
        if (remote && this._countTabs(remote.collections) > 0) {
          console.warn('Dooby Cloud: local is empty but cloud has data, skipping push');
          return false;
        }
      }
      await this.writeRemote(local);
      this._markSynced();
      return true;
    } catch (e) {
      this._fail(e);
      return false;
    } finally {
      this._pushing = false;
    }
  },

  // Union-merge local and cloud, write the result to both sides.
  async mergeAndPush() {
    const remote = await this.fetchRemote();
    const merged = await DoobyData.withLock(async () => {
      const local = await this._localDocument();
      const doc = remote ? this._merge(local, remote) : local;
      doc.updatedAt = Math.max(doc.updatedAt || 0, Date.now());
      await this._applyDocument(doc);
      return doc;
    });
    await this.writeRemote(merged);
    this._markSynced();
    this._notify('data_updated');
  },

  _merge(a, b) {
    const spaces = [];
    const seenSpace = new Set();
    for (const s of [...(a.spaces || []), ...(b.spaces || [])]) {
      if (!s || seenSpace.has(s.id)) continue;
      seenSpace.add(s.id); spaces.push(s);
    }
    const byId = new Map();
    for (const c of [...(a.collections || []), ...(b.collections || [])]) {
      if (!c) continue;
      if (!byId.has(c.id)) { byId.set(c.id, { ...c, tabs: [...(c.tabs || [])] }); continue; }
      const dst = byId.get(c.id);
      const urls = new Set(dst.tabs.map(t => t.url));
      for (const t of c.tabs || []) if (t && !urls.has(t.url)) { dst.tabs.push(t); urls.add(t.url); }
      if (c.pinned) dst.pinned = true;
    }
    // Drop collections whose space no longer exists.
    const collections = [...byId.values()].filter(c => seenSpace.has(c.spaceId));
    if (spaces.length === 0 && collections.length) spaces.push({ id: collections[0].spaceId, name: 'My Space', createdAt: Date.now() });
    return { version: 3, spaces, collections, updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0) };
  },

  // Debounced push after a local change.
  scheduleSyncAfterChange() {
    if (!this.isSignedIn()) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 2000);
  },

  // Called by the periodic alarm / visibility change.
  async poll() {
    if (!this.isSignedIn()) return false;
    try {
      return await this.pull();
    } catch (e) {
      this._fail(e);
      return false;
    }
  },

  _startPolling() {
    this._stopPolling();
    this._pollTimer = setInterval(() => { if (document.visibilityState === 'visible') this.poll(); }, 60 * 1000);
    if (!this._visHandler) {
      this._visHandler = () => { if (document.visibilityState === 'visible') this.poll(); };
      document.addEventListener('visibilitychange', this._visHandler);
    }
  },

  _stopPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
  },

  _markSynced() {
    this._lastSyncAt = Date.now();
    this._lastError = null;
    chrome.storage.local.set({ cloudLastSyncAt: this._lastSyncAt });
    this._notify('sync_complete', { time: this._lastSyncAt });
  },

  _fail(e) {
    console.error('Dooby Cloud:', e);
    this._lastError = e && e.message ? e.message : String(e);
    this._notify('sync_error', { message: this._lastError });
  },

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------

  on(event, cb) { this._listeners.push({ event, cb }); },

  _notify(event, data) {
    for (const l of this._listeners) {
      if (l.event === event || l.event === '*') {
        try { l.cb(event, data); } catch (e) { console.error('Dooby Cloud listener error:', e); }
      }
    }
  }
};
