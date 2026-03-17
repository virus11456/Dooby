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
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area === 'sync' && !this._pushing) {
        // Only react to dooby keys to avoid spurious triggers
        const doobyKeys = Object.keys(changes).filter(k => k.startsWith('dooby_'));
        if (doobyKeys.length > 0) {
          // CRITICAL: Must pull sync data into local storage first,
          // because loadApp() reads from chrome.storage.local.
          // force=true because onChanged already confirms new data exists.
          const pulled = await this.pullFromSync(true);
          if (pulled) {
            this._notifyListeners('data_updated');
          }
        }
      }
    });

    // Try initial pull from sync storage, return whether data was pulled
    const pulled = await this.pullFromSync();
    return pulled;
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

      // Write all new data atomically first (meta + spaces + chunks)
      // meta.chunkCount ensures readers only read the correct number of chunks
      await chrome.storage.sync.set(syncData);

      // Then clean up any stale old chunks (safe because meta already has correct count)
      const existing = await chrome.storage.sync.get(null);
      const staleKeys = Object.keys(existing).filter(k => {
        if (!k.startsWith('dooby_col_')) return false;
        const idx = parseInt(k.replace('dooby_col_', ''), 10);
        return idx >= chunks.length;
      });
      if (staleKeys.length > 0) {
        await chrome.storage.sync.remove(staleKeys);
      }
      this._notifyListeners('sync_complete', { time: Date.now() });
    } catch (err) {
      console.error('Dooby: Sync push failed:', err);
      this._notifyListeners('sync_error', { error: err.message });
    } finally {
      this._pushing = false;
    }
  },

  // Pull data from chrome.storage.sync into chrome.storage.local
  // force=true skips timestamp check (used when onChanged confirms new data exists)
  async pullFromSync(force = false) {
    try {
      const syncData = await chrome.storage.sync.get(null);

      // Check if there's any Dooby data in sync storage
      if (!syncData['dooby_meta']) return false;

      const meta = JSON.parse(syncData['dooby_meta']);

      // Skip timestamp check when forced (e.g. from onChanged listener)
      if (!force) {
        const { localUpdateTime } = await chrome.storage.local.get('localUpdateTime');
        if (localUpdateTime && localUpdateTime >= meta.updatedAt) {
          return false; // Local is newer, skip pull
        }
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
  // Storage Usage
  // ============================================

  async getUsage() {
    const bytesInUse = await chrome.storage.sync.getBytesInUse(null);
    const quota = 102400; // chrome.storage.sync QUOTA_BYTES
    return { bytesInUse, quota, percent: Math.round((bytesInUse / quota) * 100) };
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
