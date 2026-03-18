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
// Favicon data URIs are stripped before sync to save space.

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
  // Data Optimization
  // ============================================

  // Strip large favicon data URIs to save sync space.
  // Keep only short URLs (http/https favicons), remove base64 data URIs.
  _optimizeForSync(collections) {
    return collections.map(col => ({
      ...col,
      tabs: col.tabs.map(tab => {
        const favicon = tab.favicon || '';
        // Keep favicon only if it's a short URL (not a data URI)
        const optimizedFavicon = favicon.startsWith('data:') ? '' : favicon;
        return {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favicon: optimizedFavicon,
          addedAt: tab.addedAt,
          ...(tab.pinned ? { pinned: true } : {})
        };
      })
    }));
  },

  // Count total tabs across all collections
  _countTabs(collections) {
    return collections.reduce((sum, col) => sum + (col.tabs ? col.tabs.length : 0), 0);
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

      // Safety check: don't overwrite cloud data with empty local data
      // If local has no meaningful data, check if cloud has more
      const localTabCount = this._countTabs(collections);
      if (localTabCount === 0 && collections.length <= 3) {
        const syncData = await chrome.storage.sync.get('dooby_meta');
        if (syncData['dooby_meta']) {
          const meta = JSON.parse(syncData['dooby_meta']);
          if (meta.tabCount && meta.tabCount > 0) {
            console.log('Dooby: Skipping push — local is empty but cloud has', meta.tabCount, 'tabs');
            this._notifyListeners('sync_complete', { time: Date.now(), skipped: true });
            return;
          }
        }
      }

      // Optimize collections for sync (strip large favicons)
      const optimizedCollections = this._optimizeForSync(collections);

      // Build sync payload with chunking
      const syncData = {};

      // Spaces are small, store directly
      syncData['dooby_spaces'] = JSON.stringify(spaces);

      // Chunk collections (each key max ~8KB, leave margin)
      const MAX_CHUNK_SIZE = 7000; // bytes, conservative limit
      const collectionsStr = JSON.stringify(optimizedCollections);

      // Check if data will exceed quota
      const estimatedSize = collectionsStr.length + JSON.stringify(spaces).length + 200;
      if (estimatedSize > 95000) { // Leave 5KB margin
        console.warn('Dooby: Data too large for sync storage:', (estimatedSize / 1024).toFixed(1), 'KB');
        this._notifyListeners('sync_error', {
          error: 'Data too large',
          message: `Data size (${(estimatedSize / 1024).toFixed(1)} KB) exceeds sync limit (100 KB). Try removing some tabs or collections.`
        });
        return;
      }

      // Split into chunks
      const chunks = [];
      for (let i = 0; i < collectionsStr.length; i += MAX_CHUNK_SIZE) {
        chunks.push(collectionsStr.slice(i, i + MAX_CHUNK_SIZE));
      }

      for (let i = 0; i < chunks.length; i++) {
        syncData[`dooby_col_${i}`] = chunks[i];
      }

      // Update meta with chunk count and tab count for safety checks
      syncData['dooby_meta'] = JSON.stringify({
        updatedAt: Date.now(),
        version: 1,
        chunkCount: chunks.length,
        tabCount: localTabCount
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

      // Provide user-friendly error message for quota exceeded
      let message = err.message;
      if (err.message && err.message.includes('QUOTA')) {
        message = 'Storage quota exceeded. Try removing some tabs or collections to free up space.';
      }
      this._notifyListeners('sync_error', { error: err.message, message });
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
          // Even if local timestamp is newer, check if cloud has more data
          // This prevents empty local data from blocking a pull of real data
          const localCollections = await Storage.getCollections();
          const localTabCount = this._countTabs(localCollections);
          const cloudTabCount = meta.tabCount || 0;

          if (cloudTabCount > localTabCount) {
            console.log('Dooby: Cloud has more tabs (' + cloudTabCount + ') than local (' + localTabCount + '), pulling anyway');
            // Fall through to pull
          } else {
            return false; // Local is newer and has same or more data, skip pull
          }
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
