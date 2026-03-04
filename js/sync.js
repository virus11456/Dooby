// Tooby - Cloud Sync Manager
// Uses Firebase Firestore for cross-device cloud sync with Google Sign-In

const SyncManager = {
  // Firebase config - users should replace with their own Firebase project config
  FIREBASE_CONFIG: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
  },

  _user: null,
  _db: null,
  _syncInProgress: false,
  _listeners: [],
  _lastSyncTime: 0,
  _syncDebounceTimer: null,

  // ============================================
  // Initialization
  // ============================================

  async init() {
    const { syncUser } = await chrome.storage.local.get('syncUser');
    if (syncUser) {
      this._user = syncUser;
    }
    return this._user;
  },

  // ============================================
  // Authentication
  // ============================================

  async signIn() {
    try {
      // Use Chrome Identity API for Google Sign-In
      const token = await this._getAuthToken(true);
      if (!token) throw new Error('Failed to get auth token');

      // Get user info from Google
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to fetch user info');

      const userInfo = await response.json();
      this._user = {
        uid: userInfo.sub,
        email: userInfo.email,
        displayName: userInfo.name,
        photoURL: userInfo.picture,
        token: token,
        signedInAt: Date.now()
      };

      await chrome.storage.local.set({ syncUser: this._user });
      this._notifyListeners('signed_in', this._user);

      // Perform initial sync after sign in
      await this.syncNow();

      return this._user;
    } catch (err) {
      console.error('Tooby: Sign in failed:', err);
      throw err;
    }
  },

  async signOut() {
    try {
      const token = await this._getAuthToken(false);
      if (token) {
        // Revoke the token
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
        chrome.identity.removeCachedAuthToken({ token });
      }
    } catch (e) {
      // Ignore revocation errors
    }

    this._user = null;
    await chrome.storage.local.remove('syncUser');
    await chrome.storage.local.remove('lastSyncTime');
    this._notifyListeners('signed_out');
  },

  getUser() {
    return this._user;
  },

  isSignedIn() {
    return !!this._user;
  },

  async _getAuthToken(interactive) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });
  },

  // ============================================
  // Firestore REST API Helpers
  // ============================================

  _firestoreBaseUrl() {
    return `https://firestore.googleapis.com/v1/projects/${this.FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
  },

  async _firestoreRequest(method, path, body) {
    // Refresh token if needed
    let token;
    try {
      token = await this._getAuthToken(false);
    } catch (e) {
      // Token expired, try interactive
      token = await this._getAuthToken(true);
    }

    if (!token) throw new Error('No auth token');

    const url = `${this._firestoreBaseUrl()}${path}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (response.status === 404) return null;
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Firestore ${method} failed: ${response.status} - ${error}`);
    }

    return response.json();
  },

  // Convert JS object to Firestore document format
  _toFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    if (Array.isArray(value)) {
      return { arrayValue: { values: value.map(v => this._toFirestoreValue(v)) } };
    }
    if (typeof value === 'object') {
      const fields = {};
      for (const [k, v] of Object.entries(value)) {
        fields[k] = this._toFirestoreValue(v);
      }
      return { mapValue: { fields } };
    }
    return { stringValue: String(value) };
  },

  // Convert Firestore document format back to JS object
  _fromFirestoreValue(value) {
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return parseInt(value.integerValue, 10);
    if ('doubleValue' in value) return value.doubleValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('arrayValue' in value) {
      return (value.arrayValue.values || []).map(v => this._fromFirestoreValue(v));
    }
    if ('mapValue' in value) {
      const obj = {};
      for (const [k, v] of Object.entries(value.mapValue.fields || {})) {
        obj[k] = this._fromFirestoreValue(v);
      }
      return obj;
    }
    return null;
  },

  _toFirestoreDoc(data) {
    const fields = {};
    for (const [key, value] of Object.entries(data)) {
      fields[key] = this._toFirestoreValue(value);
    }
    return { fields };
  },

  _fromFirestoreDoc(doc) {
    if (!doc || !doc.fields) return null;
    const obj = {};
    for (const [key, value] of Object.entries(doc.fields)) {
      obj[key] = this._fromFirestoreValue(value);
    }
    return obj;
  },

  // ============================================
  // Sync Operations
  // ============================================

  async syncNow() {
    if (!this._user || this._syncInProgress) return;
    this._syncInProgress = true;
    this._notifyListeners('sync_start');

    try {
      const userId = this._user.uid;

      // Get local data
      const localSpaces = await Storage.getSpaces();
      const localCollections = await Storage.getCollections();
      const { lastSyncTime } = await chrome.storage.local.get('lastSyncTime');

      // Get remote data
      const remoteData = await this._getRemoteData(userId);

      if (!remoteData) {
        // First sync - push local to remote
        await this._pushToRemote(userId, localSpaces, localCollections);
      } else {
        // Merge: remote timestamp vs local timestamp
        const remoteTime = remoteData.updatedAt || 0;
        const localTime = lastSyncTime || 0;

        if (remoteTime > localTime) {
          // Remote is newer - pull remote data
          await this._pullFromRemote(remoteData);
        } else {
          // Local is newer or same - push local data
          await this._pushToRemote(userId, localSpaces, localCollections);
        }
      }

      const now = Date.now();
      this._lastSyncTime = now;
      await chrome.storage.local.set({ lastSyncTime: now });
      this._notifyListeners('sync_complete', { time: now });
    } catch (err) {
      console.error('Tooby: Sync failed:', err);
      this._notifyListeners('sync_error', { error: err.message });
    } finally {
      this._syncInProgress = false;
    }
  },

  async _getRemoteData(userId) {
    try {
      const doc = await this._firestoreRequest('GET', `/users/${userId}/data/tooby`);
      return this._fromFirestoreDoc(doc);
    } catch (e) {
      return null;
    }
  },

  async _pushToRemote(userId, spaces, collections) {
    const data = {
      spaces,
      collections,
      updatedAt: Date.now(),
      version: 1
    };

    await this._firestoreRequest(
      'PATCH',
      `/users/${userId}/data/tooby`,
      this._toFirestoreDoc(data)
    );
  },

  async _pullFromRemote(remoteData) {
    if (remoteData.spaces) {
      await chrome.storage.local.set({ spaces: remoteData.spaces });
    }
    if (remoteData.collections) {
      await chrome.storage.local.set({ collections: remoteData.collections });
    }
    this._notifyListeners('data_updated');
  },

  // Debounced sync - called after local data changes
  scheduleSyncAfterChange() {
    if (!this._user) return;

    clearTimeout(this._syncDebounceTimer);
    this._syncDebounceTimer = setTimeout(() => {
      this.syncNow();
    }, 3000); // Wait 3 seconds after last change before syncing
  },

  // ============================================
  // Event Listeners
  // ============================================

  on(event, callback) {
    this._listeners.push({ event, callback });
  },

  off(event, callback) {
    this._listeners = this._listeners.filter(
      l => !(l.event === event && l.callback === callback)
    );
  },

  _notifyListeners(event, data) {
    for (const listener of this._listeners) {
      if (listener.event === event || listener.event === '*') {
        try {
          listener.callback(event, data);
        } catch (e) {
          console.error('Tooby: Listener error:', e);
        }
      }
    }
  },

  // ============================================
  // Export / Import (Offline backup)
  // ============================================

  async exportData() {
    const spaces = await Storage.getSpaces();
    const collections = await Storage.getCollections();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      spaces,
      collections
    };
  },

  async importData(data) {
    if (!data || !data.spaces || !data.collections) {
      throw new Error('Invalid import data format');
    }
    await chrome.storage.local.set({
      spaces: data.spaces,
      collections: data.collections
    });
    this._notifyListeners('data_updated');
    this.scheduleSyncAfterChange();
  }
};
