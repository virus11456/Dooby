// Storage layer for Dooby
//
// Reads go straight to chrome.storage.local. Every write to spaces /
// collections goes through DoobyData.mutate() (js/datalock.js), which
// serializes it against all other writers and stamps localUpdateTime.

// Per-device preferences. Stored in chrome.storage.local only (not synced).
const DEFAULT_SETTINGS = {
  language: 'auto',             // auto | en | zh_TW
  openTabsCollapsed: false,     // Open Tabs column collapsed to a rail
  closeTabAfterSave: true,      // close the browser tab after quick-save / drag-save
  quickSaveCollectionId: '',    // '' = auto (the "Quick Save" collection of the active space)
  collectionSort: 'manual',     // manual | name | newest | oldest | count
  tabSort: 'manual'             // manual | newest | oldest | title
};

const Storage = {
  async getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  },

  async saveSettings(patch) {
    const current = await this.getSettings();
    const settings = { ...current, ...patch };
    await chrome.storage.local.set({ settings });
    return settings;
  },

  async getSpaces() {
    const { spaces } = await chrome.storage.local.get('spaces');
    return spaces || [];
  },

  async getActiveSpaceId() {
    const { activeSpaceId } = await chrome.storage.local.get('activeSpaceId');
    return activeSpaceId || null;
  },

  async setActiveSpaceId(spaceId) {
    await chrome.storage.local.set({ activeSpaceId: spaceId });
  },

  async getCollections() {
    const { collections } = await chrome.storage.local.get('collections');
    return collections || [];
  },

  async getCollectionsBySpace(spaceId) {
    const collections = await this.getCollections();
    return collections.filter(c => c.spaceId === spaceId);
  },

  async addSpace(name) {
    const newSpace = { id: DoobyData.newId('space'), name, createdAt: Date.now() };
    await DoobyData.mutate(['spaces'], (d) => { d.spaces.push(newSpace); });
    this._onDataChanged();
    return newSpace;
  },

  async renameSpace(spaceId, name) {
    const changed = await DoobyData.mutate(['spaces'], (d) => {
      const space = d.spaces.find(s => s.id === spaceId);
      if (!space) return DoobyData.unchanged(false);
      space.name = name;
      return true;
    });
    if (changed) this._onDataChanged();
  },

  async deleteSpace(spaceId) {
    await DoobyData.mutate(['spaces', 'collections'], (d) => {
      d.spaces = d.spaces.filter(s => s.id !== spaceId);
      d.collections = d.collections.filter(c => c.spaceId !== spaceId);
    });
    this._onDataChanged();
  },

  async addCollection(spaceId, name) {
    return this.addCollectionWithTabs(spaceId, name, []);
  },

  // Create a collection already holding `tabs` (browser tabs or {title,url,favicon})
  // in one write, e.g. "Save session".
  async addCollectionWithTabs(spaceId, name, tabs) {
    const now = Date.now();
    const newCollection = {
      id: DoobyData.newId('col'),
      spaceId,
      name,
      tabs: (tabs || []).map(t => this._newTab(t, now)),
      createdAt: now
    };
    await DoobyData.mutate(['collections'], (d) => { d.collections.push(newCollection); });
    this._onDataChanged();
    return newCollection;
  },

  async renameCollection(collectionId, name) {
    const changed = await DoobyData.mutate(['collections'], (d) => {
      const col = d.collections.find(c => c.id === collectionId);
      if (!col) return DoobyData.unchanged(false);
      col.name = name;
      return true;
    });
    if (changed) this._onDataChanged();
  },

  // ---- Undo helpers: put deleted items back where they were ----
  async restoreTabs(collectionId, entries) {
    // entries: [{ tab, index }] in ascending index order
    const ok = await DoobyData.mutate(['collections'], (d) => {
      const col = d.collections.find(c => c.id === collectionId);
      if (!col) return DoobyData.unchanged(false);
      const existing = new Set(col.tabs.map(t => t.id));
      for (const { tab, index } of [...entries].sort((a, b) => a.index - b.index)) {
        if (existing.has(tab.id)) continue;
        col.tabs.splice(Math.min(index, col.tabs.length), 0, tab);
        existing.add(tab.id);
      }
      return true;
    });
    if (ok) this._onDataChanged();
    return ok;
  },

  async restoreCollection(collection, index) {
    const ok = await DoobyData.mutate(['collections'], (d) => {
      if (d.collections.some(c => c.id === collection.id)) return DoobyData.unchanged(false);
      d.collections.splice(Math.min(index, d.collections.length), 0, collection);
      return true;
    });
    if (ok) this._onDataChanged();
    return ok;
  },

  async restoreSpace(space, index, spaceCollections) {
    await DoobyData.mutate(['spaces', 'collections'], (d) => {
      if (!d.spaces.some(s => s.id === space.id)) d.spaces.splice(Math.min(index, d.spaces.length), 0, space);
      const ids = new Set(d.collections.map(c => c.id));
      for (const c of spaceCollections) if (!ids.has(c.id)) d.collections.push(c);
    });
    this._onDataChanged();
    return true;
  },

  async deleteCollection(collectionId) {
    await DoobyData.mutate(['collections'], (d) => {
      d.collections = d.collections.filter(c => c.id !== collectionId);
    });
    this._onDataChanged();
  },

  async addTabToCollection(collectionId, tab) {
    const changed = await DoobyData.mutate(['collections'], (d) => {
      const col = d.collections.find(c => c.id === collectionId);
      if (!col) return DoobyData.unchanged(false);
      if (!Array.isArray(col.tabs)) col.tabs = [];
      col.tabs.push(this._newTab(tab));
      return true;
    });
    if (changed) this._onDataChanged();
  },

  async removeTabFromCollection(collectionId, tabId) {
    return this.removeTabsFromCollection(collectionId, [tabId]);
  },

  async moveTab(fromCollectionId, toCollectionId, tabId, toIndex) {
    const changed = await DoobyData.mutate(['collections'], (d) => {
      const fromCol = d.collections.find(c => c.id === fromCollectionId);
      const toCol = d.collections.find(c => c.id === toCollectionId);
      if (!fromCol || !toCol) return DoobyData.unchanged(false);
      const tabIndex = fromCol.tabs.findIndex(t => t.id === tabId);
      if (tabIndex === -1) return DoobyData.unchanged(false);
      const [tab] = fromCol.tabs.splice(tabIndex, 1);
      toCol.tabs.splice(toIndex, 0, tab);
      return true;
    });
    if (changed) this._onDataChanged();
  },

  // Replace every collection (used by drag-reordering whole collections).
  // Prefer the targeted methods above: they cannot lose concurrent edits.
  async saveCollections(collections) {
    await DoobyData.mutate(['collections'], (d) => { d.collections = collections; });
    this._onDataChanged();
  },

  _newTab(tab, now = Date.now()) {
    return {
      id: DoobyData.newId('tab'),
      title: (tab && tab.title) || 'Untitled',
      url: tab && tab.url,
      favicon: (tab && (tab.favicon || tab.favIconUrl)) || '',
      addedAt: now
    };
  },

  async searchTabs(query) {
    const collections = await this.getCollections();
    const results = [];
    const q = query.toLowerCase();
    for (const col of collections) {
      for (const tab of col.tabs) {
        if (tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)) {
          results.push({ ...tab, collectionName: col.name, collectionId: col.id });
        }
      }
    }
    return results;
  },

  // Bulk remove multiple tabs from a collection
  async removeTabsFromCollection(collectionId, tabIds) {
    const changed = await DoobyData.mutate(['collections'], (d) => {
      const col = d.collections.find(c => c.id === collectionId);
      if (!col) return DoobyData.unchanged(false);
      const idSet = new Set(tabIds);
      col.tabs = col.tabs.filter(t => !idSet.has(t.id));
      return true;
    });
    if (changed) this._onDataChanged();
  },

  // Bulk move tabs between collections
  async moveTabsBulk(fromCollectionId, toCollectionId, tabIds) {
    const changed = await DoobyData.mutate(['collections'], (d) => {
      const fromCol = d.collections.find(c => c.id === fromCollectionId);
      const toCol = d.collections.find(c => c.id === toCollectionId);
      if (!fromCol || !toCol) return DoobyData.unchanged(false);
      const idSet = new Set(tabIds);
      const movedTabs = fromCol.tabs.filter(t => idSet.has(t.id));
      fromCol.tabs = fromCol.tabs.filter(t => !idSet.has(t.id));
      toCol.tabs.push(...movedTabs);
      return true;
    });
    if (changed) this._onDataChanged();
  },

  // Find duplicate URLs across all collections
  async findDuplicates() {
    const collections = await this.getCollections();
    const urlMap = {}; // url -> [{collectionId, collectionName, tab}]

    for (const col of collections) {
      for (const tab of col.tabs) {
        const normalizedUrl = tab.url.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '');
        if (!urlMap[normalizedUrl]) urlMap[normalizedUrl] = [];
        urlMap[normalizedUrl].push({
          collectionId: col.id,
          collectionName: col.name,
          tab
        });
      }
    }

    const duplicates = [];
    for (const [url, entries] of Object.entries(urlMap)) {
      if (entries.length > 1) {
        duplicates.push({ url, entries });
      }
    }
    return duplicates;
  },

  // Remove specific duplicate entries (keep the first one)
  async removeDuplicates(duplicates) {
    const removedCount = await DoobyData.mutate(['collections'], (d) => {
      let removed = 0;
      for (const dup of duplicates) {
        // Skip first entry (keep it), remove the rest
        for (let i = 1; i < dup.entries.length; i++) {
          const entry = dup.entries[i];
          const col = d.collections.find(c => c.id === entry.collectionId);
          if (!col) continue;
          const idx = col.tabs.findIndex(t => t.id === entry.tab.id);
          if (idx !== -1) { col.tabs.splice(idx, 1); removed++; }
        }
      }
      return removed ? removed : DoobyData.unchanged(0);
    });
    if (removedCount) this._onDataChanged();
    return removedCount;
  },

  // Import from Chrome bookmarks HTML format (Netscape bookmark file).
  // Every folder that directly holds links becomes one collection, at any
  // depth, exactly once, parents before their sub-folders.
  parseBookmarksHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const results = [];
    const linkOf = (a) => ({
      title: a.textContent.trim() || 'Untitled',
      url: a.getAttribute('href') || '',
      favicon: a.getAttribute('icon') || ''
    });
    // The parser does not always nest <DL> inside its <DT>, so a folder's list
    // is the <DL> inside the <DT> or, failing that, the next sibling <DL>.
    const listOf = (dt) => {
      const inner = dt.querySelector(':scope > dl');
      if (inner) return inner;
      let n = dt.nextElementSibling;
      while (n && n.tagName === 'P') n = n.nextElementSibling;
      return n && n.tagName === 'DL' ? n : null;
    };
    const entriesOf = (dl) => {
      const out = [];
      for (const child of dl.children) {
        if (child.tagName === 'DT') out.push(child);
        else if (child.tagName === 'P') for (const dt of child.children) if (dt.tagName === 'DT') out.push(dt);
      }
      return out;
    };
    const seen = new Set();
    const walk = (dl) => {
      if (!dl || seen.has(dl)) return;
      seen.add(dl);
      for (const dt of entriesOf(dl)) {
        const h3 = dt.querySelector(':scope > h3');
        if (!h3) continue;
        const sub = listOf(dt);
        if (!sub) continue;
        const tabs = entriesOf(sub).map(e => e.querySelector(':scope > a')).filter(Boolean).map(linkOf).filter(t => t.url);
        if (tabs.length) results.push({ name: h3.textContent.trim() || 'Bookmarks', tabs });
        walk(sub);
      }
    };
    walk(doc.querySelector('dl'));

    // No folders with links: collect every link as one collection.
    if (results.length === 0) {
      const tabs = Array.from(doc.querySelectorAll('a')).map(linkOf).filter(t => t.url);
      if (tabs.length > 0) results.push({ name: 'Imported Bookmarks', tabs });
    }
    return results;
  },

  // Import parsed bookmark folders into current space
  async importBookmarkFolders(spaceId, folders) {
    const now = Date.now();
    const created = folders.map(folder => ({
      id: DoobyData.newId('col'),
      spaceId,
      name: folder.name,
      tabs: folder.tabs.map(t => this._newTab(t, now)),
      createdAt: now
    }));
    await DoobyData.mutate(['collections'], (d) => { d.collections.push(...created); });
    this._onDataChanged();
    return folders.reduce((n, f) => n + f.tabs.length, 0);
  },

  async togglePinCollection(collectionId) {
    const pinned = await DoobyData.mutate(['collections'], (d) => {
      const col = d.collections.find(c => c.id === collectionId);
      if (!col) return DoobyData.unchanged(false);
      col.pinned = !col.pinned;
      return col.pinned;
    });
    this._onDataChanged();
    return pinned;
  },

  async togglePinTab(collectionId, tabId) {
    const pinned = await DoobyData.mutate(['collections'], (d) => {
      const col = d.collections.find(c => c.id === collectionId);
      const tab = col && col.tabs.find(t => t.id === tabId);
      if (!tab) return DoobyData.unchanged(false);
      tab.pinned = !tab.pinned;
      // Move pinned tabs to top, unpinned below
      col.tabs = [...col.tabs.filter(t => t.pinned), ...col.tabs.filter(t => !t.pinned)];
      return tab.pinned;
    });
    this._onDataChanged();
    return pinned;
  },

  // Notify sync manager when data changes
  _onDataChanged() {
    if (typeof SyncManager !== 'undefined') {
      SyncManager.scheduleSyncAfterChange();
    }
    if (typeof CloudManager !== 'undefined') {
      CloudManager.scheduleSyncAfterChange();
    }
  }
};
