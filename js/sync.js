// Dooby - Cloud Sync Manager
// Uses chrome.storage.sync for automatic cross-device sync via Chrome account.
// No Firebase or sign-in required — works if the user is signed into Chrome.
//
// chrome.storage.sync limits:
//   - QUOTA_BYTES: 102,400 (100KB total)
//   - QUOTA_BYTES_PER_ITEM: 8,192 (8KB per key)
//   - MAX_ITEMS: 512
//
// Strategy: chunk collections data across multiple keys to stay within limits.

const SyncManager = {
  _listeners: [],
  _syncDebounceTimer: null,
  _enabled: true,

  // ============================================
  // Initialization
  // ============================================

  async init() {
    // Listen for changes from other devices
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && !this._pushing) {
        this._notifyListeners('data_updated');
      }
    });

    // Try initial pull from sync storage
    await this.pullFromSync();
  },

  // ============================================
  // Sync Operations
  // ============================================

  async pushToSync() {
    if (!this._enabled) return;
    this._pushing = true;
    this._notifyListeners('sync_start');

    try {
      const spaces = await Storage.getSpaces();
      const collections = await Storage.getCollections();

      // Build sync payload with chunking
      const syncData = {};

      // Spaces are small, store directly
      syncData['dooby_spaces'] = JSON.stringify(spaces);
      syncData['dooby_meta'] = JSON.stringify({
        updatedAt: Date.now(),
        version: 1,
        chunkCount: 0
      });

      // Chunk collections (each key max ~8KB, leave margin)
      const MAX_CHUNK_SIZE = 7000; // bytes, conservative limit
      const collectionsStr = JSON.stringify(collections);

      // Clear old chunks first
      const existing = await chrome.storage.sync.get(null);
      const oldChunkKeys = Object.keys(existing).filter(k => k.startsWith('dooby_col_'));
      if (oldChunkKeys.length > 0) {
        await chrome.storage.sync.remove(oldChunkKeys);
      }

      // Split into chunks
      const chunks = [];
      for (let i = 0; i < collectionsStr.length; i += MAX_CHUNK_SIZE) {
        chunks.push(collectionsStr.slice(i, i + MAX_CHUNK_SIZE));
      }

      for (let i = 0; i < chunks.length; i++) {
        syncData[`dooby_col_${i}`] = chunks[i];
      }

      // Update meta with chunk count
      syncData['dooby_meta'] = JSON.stringify({
        updatedAt: Date.now(),
        version: 1,
        chunkCount: chunks.length
      });

      await chrome.storage.sync.set(syncData);
      this._notifyListeners('sync_complete', { time: Date.now() });
    } catch (err) {
      console.error('Dooby: Sync push failed:', err);
      this._notifyListeners('sync_error', { error: err.message });
    } finally {
      this._pushing = false;
    }
  },

  async pullFromSync() {
    try {
      const syncData = await chrome.storage.sync.get(null);

      // Check if there's any Dooby data in sync storage
      if (!syncData['dooby_meta']) return false;

      const meta = JSON.parse(syncData['dooby_meta']);

      // Check if sync data is newer than local
      const { localUpdateTime } = await chrome.storage.local.get('localUpdateTime');
      if (localUpdateTime && localUpdateTime >= meta.updatedAt) {
        return false; // Local is newer, skip pull
      }

      // Restore spaces
      if (syncData['dooby_spaces']) {
        const spaces = JSON.parse(syncData['dooby_spaces']);
        if (spaces && spaces.length > 0) {
          await chrome.storage.local.set({ spaces });
        }
      }

      // Reassemble chunked collections
      if (meta.chunkCount > 0) {
        let collectionsStr = '';
        for (let i = 0; i < meta.chunkCount; i++) {
          const chunk = syncData[`dooby_col_${i}`];
          if (chunk) collectionsStr += chunk;
        }

        if (collectionsStr) {
          const collections = JSON.parse(collectionsStr);
          await chrome.storage.local.set({ collections });
        }
      }

      await chrome.storage.local.set({ localUpdateTime: meta.updatedAt });
      return true;
    } catch (err) {
      console.error('Dooby: Sync pull failed:', err);
      return false;
    }
  },

  // Debounced sync - called after local data changes
  scheduleSyncAfterChange() {
    if (!this._enabled) return;

    // Mark local update time
    chrome.storage.local.set({ localUpdateTime: Date.now() });

    clearTimeout(this._syncDebounceTimer);
    this._syncDebounceTimer = setTimeout(() => {
      this.pushToSync();
    }, 2000); // Wait 2 seconds after last change
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
          console.error('Dooby: Listener error:', e);
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
