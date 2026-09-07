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
// Auth flow (extension):
//   1. chrome.identity.launchWebAuthFlow → Google OAuth (response_type=id_token)
//   2. POST {supabase}/auth/v1/token?grant_type=id_token  → Supabase session
//   3. session kept in chrome.storage.local ("cloudSession"), refreshed as needed
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
    const { cloudSession, cloudLastSyncAt } = await chrome.storage.local.get(['cloudSession', 'cloudLastSyncAt']);
    this._session = cloudSession || null;
    this._lastSyncAt = cloudLastSyncAt || null;
    if (!this.isConfigured() || !this.isSignedIn()) return false;

    let pulled = false;
    try {
      pulled = await this.pull();
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

    // First sync: union-merge so neither side loses bookmarks.
    try {
      await this.mergeAndPush();
    } catch (e) {
      this._fail(e);
    }
    this._startPolling();
    return this.getUser();
  },

  async signOut() {
    const s = this._session;
    this._session = null;
    this._stopPolling();
    await chrome.storage.local.remove(['cloudSession']);
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
      await chrome.storage.local.remove(['cloudSession']);
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
    if (!doc.updatedAt) doc.updatedAt = Date.parse(rows[0].updated_at) || 0;
    return doc;
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
    const remote = await this.fetchRemote();
    if (!remote) return false;
    const local = await this._localDocument();
    const remoteHasTabs = this._countTabs(remote.collections) > 0;
    if (!force && local.updatedAt && remote.updatedAt <= local.updatedAt) {
      this._markSynced();
      return false;
    }
    if (!remoteHasTabs && this._countTabs(local.collections) > 0 && !force) {
      // Never let an empty cloud document wipe a populated device.
      console.warn('Dooby Cloud: cloud document is empty, keeping local data');
      return false;
    }
    await this._applyDocument(remote);
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
    const local = await this._localDocument();
    const remote = await this.fetchRemote();
    const merged = remote ? this._merge(local, remote) : local;
    if (!merged.updatedAt) merged.updatedAt = Date.now();
    merged.updatedAt = Math.max(merged.updatedAt, Date.now());
    await this._applyDocument(merged);
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
