// Dooby - Cloud Sync Manager
// Uses chrome.storage.sync for automatic cross-device sync via Chrome account.
// No Firebase or sign-in required — works if the user is signed into Chrome.
//
// chrome.storage.sync limits:
//   - QUOTA_BYTES: 102,400 (100KB total)
//   - QUOTA_BYTES_PER_ITEM: 8,192 (8KB per key)
//   - MAX_ITEMS: 512
//
// Chrome measures each item as key.length + UTF-8 byte length of
// JSON.stringify(value). Because each chunk is itself a JSON string, storing it
// escapes every quote (\" costs 2 bytes) and non-ASCII characters cost 2-4 bytes
// each. Chunks are therefore sized by *encoded bytes*, never by string length.
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
  // Quota-aware sizing
  // ============================================

  QUOTA_BYTES: 102400,
  QUOTA_BYTES_PER_ITEM: 8192,
  // Target size for a single item, leaving headroom under the hard 8192 limit.
  MAX_ITEM_BYTES: 8000,

  _encoder: new TextEncoder(),

  // Size of one item exactly as chrome.storage.sync accounts for it.
  _itemBytes(key, value) {
    return key.length + this._encoder.encode(JSON.stringify(value)).length;
  },

  // Encoded byte cost of one UTF-16 code unit at index i inside a JSON string
  // value. Mirrors JSON.stringify escaping plus UTF-8 encoding.
  _charCost(str, i) {
    const code = str.charCodeAt(i);
    if (code === 0x22 || code === 0x5c) return 2;              // \" or \\
    if (code < 0x20) return (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) ? 2 : 6;
    if (code < 0x80) return 1;
    if (code < 0x800) return 2;
    if (code >= 0xd800 && code <= 0xdbff) return 4;              // high surrogate: whole pair costs 4, low half costs 0
    if (code >= 0xdc00 && code <= 0xdfff) return 0;
    return 3;
  },

  // Split a string into pieces such that each stored item (key + escaped,
  // UTF-8 encoded value) stays under MAX_ITEM_BYTES. Never splits a surrogate pair.
  _chunkString(str, keyPrefix) {
    const chunks = [];
    let start = 0;
    while (start < str.length) {
      const key = `${keyPrefix}${chunks.length}`;
      const budget = this.MAX_ITEM_BYTES - key.length - 2; // 2 = surrounding quotes
      let bytes = 0;
      let end = start;
      while (end < str.length) {
        const cost = this._charCost(str, end);
        if (bytes + cost > budget) break;
        bytes += cost;
        end++;
      }
      if (end === start) end = start + 1; // always make progress
      // Never end a chunk on a high surrogate (would split an emoji).
      const lastCode = str.charCodeAt(end - 1);
      if (end < str.length && lastCode >= 0xd800 && lastCode <= 0xdbff) end--;
      if (end === start) end = start + 2;

      let piece = str.slice(start, end);
      // Verify against the real encoder and shrink if the estimate was off.
      while (piece.length > 1 && this._itemBytes(key, piece) > this.MAX_ITEM_BYTES) {
        end--;
        piece = str.slice(start, end);
      }
      chunks.push(piece);
      start = end;
    }
    return chunks;
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
      const spacesStr = JSON.stringify(spaces);
      syncData['dooby_spaces'] = spacesStr;
      if (this._itemBytes('dooby_spaces', spacesStr) > this.QUOTA_BYTES_PER_ITEM) {
        this._notifyListeners('sync_error', {
          error: 'Spaces too large',
          message: 'Too many spaces to sync (over 8 KB). Remove or rename some spaces.'
        });
        return;
      }

      // Chunk collections by *encoded bytes* so every key stays under the
      // 8 KB per-item limit even with CJK titles or lots of escaped quotes.
      const collectionsStr = JSON.stringify(optimizedCollections);
      const chunks = this._chunkString(collectionsStr, 'dooby_col_');
      for (let i = 0; i < chunks.length; i++) {
        syncData[`dooby_col_${i}`] = chunks[i];
      }

      syncData['dooby_meta'] = JSON.stringify({
        updatedAt: Date.now(),
        version: 2,
        chunkCount: chunks.length,
        tabCount: localTabCount
      });

      // Also write old format for backwards compatibility with other devices,
      // but only if the whole thing fits in one item (measured in bytes).
      const legacyFits = this._itemBytes('dooby_collections', collectionsStr) <= this.MAX_ITEM_BYTES;
      if (legacyFits) {
        syncData['dooby_collections'] = collectionsStr;
      }

      // Total quota check, measured the way Chrome measures it.
      let estimatedBytes = 0;
      for (const [key, value] of Object.entries(syncData)) {
        estimatedBytes += this._itemBytes(key, value);
      }
      if (estimatedBytes > this.QUOTA_BYTES) {
        const kb = (estimatedBytes / 1024).toFixed(1);
        console.warn('Dooby: Data too large for sync:', kb, 'KB');
        this._notifyListeners('sync_error', {
          error: 'Data too large',
          message: `Data (${kb} KB) exceeds the 100 KB sync limit. Remove some tabs or use Export to back up.`
        });
        return;
      }

      await chrome.storage.sync.set(syncData);

      // Clean up stale chunks (and a stale legacy key that no longer fits, so
      // an old device can't restore outdated data from it).
      const existing = await chrome.storage.sync.get(null);
      const staleKeys = Object.keys(existing).filter(k => {
        if (k === 'dooby_collections') return !legacyFits;
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
      const msg = err.message || '';
      if (msg.includes('QUOTA_BYTES_PER_ITEM')) {
        message = 'A sync item exceeded the 8 KB per-item limit. Please report this bug.';
      } else if (msg.includes('QUOTA_BYTES')) {
        message = 'Storage quota exceeded (100 KB). Remove some tabs or use Export.';
      } else if (msg.includes('MAX_WRITE_OPERATIONS')) {
        message = 'Too many sync writes in a short time. Sync will retry automatically.';
      } else if (msg.includes('MAX_ITEMS')) {
        message = 'Too many sync items. Remove some tabs or use Export.';
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
    const quota = this.QUOTA_BYTES;
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
