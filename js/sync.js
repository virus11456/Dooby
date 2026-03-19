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
// Backwards compatible with old format (single dooby_collections key).

const SyncManager = {
  _listeners: [],
  _syncDebounceTimer: null,
  _enabled: true,
  _pushing: false,

  // ============================================
  // Initialization
  // ============================================

  async init() {
    // Listen for changes from other devices
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area === 'sync' && !this._pushing) {
        const doobyKeys = Object.keys(changes).filter(k => k.startsWith('dooby_'));
        if (doobyKeys.length > 0) {
          const pulled = await this.pullFromSync(true);
          if (pulled) {
            this._notifyListeners('data_updated');
          }
        }
      }
    });

    // Try initial pull from sync storage
    const pulled = await this.pullFromSync();
    return pulled;
  },

  // ============================================
  // Data Optimization
  // ============================================

  _optimizeForSync(collections) {
    return collections.map(col => ({
      ...col,
      tabs: col.tabs.map(tab => {
        const favicon = tab.favicon || '';
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

  _countTabs(collections) {
    if (!collections || !Array.isArray(collections)) return 0;
    return collections.reduce((sum, col) => sum + (col.tabs ? col.tabs.length : 0), 0);
  },

  // ============================================
  // Push to Cloud
  // ============================================

  async pushToSync() {
    if (!this._enabled) return;
    this._pushing = true;
    this._notifyListeners('sync_start');

    try {
      const spaces = await Storage.getSpaces();
      const collections = await Storage.getCollections();
      const localTabCount = this._countTabs(collections);

      // Safety: don't push empty data if cloud has real data
      if (localTabCount === 0 && collections.length <= 3) {
        try {
          const existing = await chrome.storage.sync.get(null);
          const hasCloudData = this._cloudHasData(existing);
          if (hasCloudData) {
            console.log('Dooby: Skipping push — local is empty but cloud has data');
            this._notifyListeners('sync_complete', { time: Date.now(), skipped: true });
            return;
          }
        } catch (e) {
          // Can't check cloud, proceed with caution
        }
      }

      // Optimize (strip data URIs)
      const optimizedCollections = this._optimizeForSync(collections);

      const syncData = {};
      syncData['dooby_spaces'] = JSON.stringify(spaces);

      // Chunk collections (each key max ~8KB)
      const MAX_CHUNK_SIZE = 7000;
      const collectionsStr = JSON.stringify(optimizedCollections);

      // Quota check
      const estimatedSize = collectionsStr.length + JSON.stringify(spaces).length + 200;
      if (estimatedSize > 95000) {
        console.warn('Dooby: Data too large for sync:', (estimatedSize / 1024).toFixed(1), 'KB');
        this._notifyListeners('sync_error', {
          error: 'Data too large',
          message: `Data (${(estimatedSize / 1024).toFixed(1)} KB) exceeds 100 KB limit. Remove some tabs or use Export to back up.`
        });
        return;
      }

      const chunks = [];
      for (let i = 0; i < collectionsStr.length; i += MAX_CHUNK_SIZE) {
        chunks.push(collectionsStr.slice(i, i + MAX_CHUNK_SIZE));
      }
      for (let i = 0; i < chunks.length; i++) {
        syncData[`dooby_col_${i}`] = chunks[i];
      }

      syncData['dooby_meta'] = JSON.stringify({
        updatedAt: Date.now(),
        version: 2,
        chunkCount: chunks.length,
        tabCount: localTabCount
      });

      // Also write old format for backwards compatibility with other devices
      // Only if it fits in the 8KB per-item limit
      if (collectionsStr.length < 8000) {
        syncData['dooby_collections'] = collectionsStr;
      }

      await chrome.storage.sync.set(syncData);

      // Clean up stale chunks
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
      console.error('Dooby: Push failed:', err);
      let message = err.message;
      if (err.message && err.message.includes('QUOTA')) {
        message = 'Storage quota exceeded. Remove some tabs or use Export.';
      }
      this._notifyListeners('sync_error', { error: err.message, message });
    } finally {
      this._pushing = false;
    }
  },

  // ============================================
  // Pull from Cloud
  // ============================================

  async pullFromSync(force = false) {
    try {
      const syncData = await chrome.storage.sync.get(null);

      // Check for ANY dooby data (new or old format)
      const hasMeta = !!syncData['dooby_meta'];
      const hasOldCollections = !!syncData['dooby_collections'];
      const hasOldSpaces = !!syncData['dooby_spaces'];

      if (!hasMeta && !hasOldCollections) {
        console.log('Dooby: No data in cloud sync storage');
        return false;
      }

      let meta = null;
      if (hasMeta) {
        meta = JSON.parse(syncData['dooby_meta']);
      }

      // Timestamp check (skip when forced)
      if (!force && meta) {
        const { localUpdateTime } = await chrome.storage.local.get('localUpdateTime');
        if (localUpdateTime && localUpdateTime >= meta.updatedAt) {
          const localCollections = await Storage.getCollections();
          const localTabCount = this._countTabs(localCollections);
          const cloudTabCount = meta.tabCount || 0;

          if (cloudTabCount <= localTabCount) {
            return false;
          }
          console.log('Dooby: Cloud has more tabs (' + cloudTabCount + ' vs ' + localTabCount + '), pulling');
        }
      }

      // Restore spaces
      if (syncData['dooby_spaces']) {
        const spaces = JSON.parse(syncData['dooby_spaces']);
        if (spaces && spaces.length > 0) {
          await chrome.storage.local.set({ spaces });
        }
      }

      // Restore collections — try new chunked format first, fall back to old format
      let collections = null;

      if (meta && meta.chunkCount > 0) {
        // New chunked format (v2)
        let collectionsStr = '';
        for (let i = 0; i < meta.chunkCount; i++) {
          const chunk = syncData[`dooby_col_${i}`];
          if (chunk) collectionsStr += chunk;
        }
        if (collectionsStr) {
          collections = JSON.parse(collectionsStr);
        }
      }

      if (!collections && hasOldCollections) {
        // Old format fallback (v1 — single dooby_collections key)
        console.log('Dooby: Using old format (dooby_collections)');
        collections = JSON.parse(syncData['dooby_collections']);
      }

      if (collections && collections.length > 0) {
        await chrome.storage.local.set({ collections });
      }

      const updateTime = meta ? meta.updatedAt : Date.now();
      await chrome.storage.local.set({ localUpdateTime: updateTime });
      return true;
    } catch (err) {
      console.error('Dooby: Pull failed:', err);
      return false;
    }
  },

  // Check if cloud has any real data (either format)
  _cloudHasData(syncData) {
    // Check new format
    if (syncData['dooby_meta']) {
      try {
        const meta = JSON.parse(syncData['dooby_meta']);
        if (meta.tabCount > 0) return true;
      } catch (e) {}
    }
    // Check old format
    if (syncData['dooby_collections']) {
      try {
        const cols = JSON.parse(syncData['dooby_collections']);
        if (cols.some(c => c.tabs && c.tabs.length > 0)) return true;
      } catch (e) {}
    }
    return false;
  },

  // Debounced sync after local changes
  scheduleSyncAfterChange() {
    if (!this._enabled) return;
    chrome.storage.local.set({ localUpdateTime: Date.now() });
    clearTimeout(this._syncDebounceTimer);
    this._syncDebounceTimer = setTimeout(() => {
      this.pushToSync();
    }, 2000);
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
    const quota = 102400;
    return { bytesInUse, quota, percent: Math.round((bytesInUse / quota) * 100) };
  },

  // ============================================
  // Export / Import (File-based backup)
  // ============================================

  async exportData() {
    const spaces = await Storage.getSpaces();
    const collections = await Storage.getCollections();
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      spaces,
      collections
    };
  },

  async importData(data) {
    if (!data || !data.spaces || !data.collections) {
      throw new Error('Invalid import data');
    }
    await chrome.storage.local.set({
      spaces: data.spaces,
      collections: data.collections
    });
    this._notifyListeners('data_updated');
    this.scheduleSyncAfterChange();
  }
};
