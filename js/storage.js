// Storage layer for Tooby

const Storage = {
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
    const spaces = await this.getSpaces();
    const newSpace = {
      id: 'space-' + Date.now(),
      name,
      createdAt: Date.now()
    };
    spaces.push(newSpace);
    await chrome.storage.local.set({ spaces });
    this._onDataChanged();
    return newSpace;
  },

  async renameSpace(spaceId, name) {
    const spaces = await this.getSpaces();
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
      space.name = name;
      await chrome.storage.local.set({ spaces });
      this._onDataChanged();
    }
  },

  async deleteSpace(spaceId) {
    let spaces = await this.getSpaces();
    spaces = spaces.filter(s => s.id !== spaceId);
    let collections = await this.getCollections();
    collections = collections.filter(c => c.spaceId !== spaceId);
    await chrome.storage.local.set({ spaces, collections });
    this._onDataChanged();
  },

  async addCollection(spaceId, name) {
    const collections = await this.getCollections();
    const newCollection = {
      id: 'col-' + Date.now(),
      spaceId,
      name,
      tabs: [],
      createdAt: Date.now()
    };
    collections.push(newCollection);
    await chrome.storage.local.set({ collections });
    this._onDataChanged();
    return newCollection;
  },

  async renameCollection(collectionId, name) {
    const collections = await this.getCollections();
    const col = collections.find(c => c.id === collectionId);
    if (col) {
      col.name = name;
      await chrome.storage.local.set({ collections });
      this._onDataChanged();
    }
  },

  async deleteCollection(collectionId) {
    let collections = await this.getCollections();
    collections = collections.filter(c => c.id !== collectionId);
    await chrome.storage.local.set({ collections });
    this._onDataChanged();
  },

  async addTabToCollection(collectionId, tab) {
    const collections = await this.getCollections();
    const col = collections.find(c => c.id === collectionId);
    if (col) {
      col.tabs.push({
        id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        title: tab.title || 'Untitled',
        url: tab.url,
        favicon: tab.favicon || tab.favIconUrl || '',
        addedAt: Date.now()
      });
      await chrome.storage.local.set({ collections });
      this._onDataChanged();
    }
  },

  async removeTabFromCollection(collectionId, tabId) {
    const collections = await this.getCollections();
    const col = collections.find(c => c.id === collectionId);
    if (col) {
      col.tabs = col.tabs.filter(t => t.id !== tabId);
      await chrome.storage.local.set({ collections });
      this._onDataChanged();
    }
  },

  async moveTab(fromCollectionId, toCollectionId, tabId, toIndex) {
    const collections = await this.getCollections();
    const fromCol = collections.find(c => c.id === fromCollectionId);
    const toCol = collections.find(c => c.id === toCollectionId);
    if (!fromCol || !toCol) return;

    const tabIndex = fromCol.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const [tab] = fromCol.tabs.splice(tabIndex, 1);
    toCol.tabs.splice(toIndex, 0, tab);
    await chrome.storage.local.set({ collections });
    this._onDataChanged();
  },

  async saveCollections(collections) {
    await chrome.storage.local.set({ collections });
    this._onDataChanged();
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

  // Notify sync manager when data changes
  _onDataChanged() {
    if (typeof SyncManager !== 'undefined' && SyncManager.isSignedIn()) {
      SyncManager.scheduleSyncAfterChange();
    }
  }
};
