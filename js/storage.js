// Storage layer for Dooby

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

  // Bulk remove multiple tabs from a collection
  async removeTabsFromCollection(collectionId, tabIds) {
    const collections = await this.getCollections();
    const col = collections.find(c => c.id === collectionId);
    if (col) {
      const idSet = new Set(tabIds);
      col.tabs = col.tabs.filter(t => !idSet.has(t.id));
      await chrome.storage.local.set({ collections });
      this._onDataChanged();
    }
  },

  // Bulk move tabs between collections
  async moveTabsBulk(fromCollectionId, toCollectionId, tabIds) {
    const collections = await this.getCollections();
    const fromCol = collections.find(c => c.id === fromCollectionId);
    const toCol = collections.find(c => c.id === toCollectionId);
    if (!fromCol || !toCol) return;

    const idSet = new Set(tabIds);
    const movedTabs = fromCol.tabs.filter(t => idSet.has(t.id));
    fromCol.tabs = fromCol.tabs.filter(t => !idSet.has(t.id));
    toCol.tabs.push(...movedTabs);
    await chrome.storage.local.set({ collections });
    this._onDataChanged();
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
    const collections = await this.getCollections();
    let removedCount = 0;

    for (const dup of duplicates) {
      // Skip first entry (keep it), remove the rest
      for (let i = 1; i < dup.entries.length; i++) {
        const entry = dup.entries[i];
        const col = collections.find(c => c.id === entry.collectionId);
        if (col) {
          const idx = col.tabs.findIndex(t => t.id === entry.tab.id);
          if (idx !== -1) {
            col.tabs.splice(idx, 1);
            removedCount++;
          }
        }
      }
    }

    await chrome.storage.local.set({ collections });
    this._onDataChanged();
    return removedCount;
  },

  // Import from Chrome bookmarks HTML format
  parseBookmarksHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const results = [];

    function processNode(node, folderName) {
      for (const child of node.children) {
        if (child.tagName === 'DT') {
          const h3 = child.querySelector(':scope > h3');
          const a = child.querySelector(':scope > a');
          const dl = child.querySelector(':scope > dl');

          if (h3 && dl) {
            // It's a folder
            const name = h3.textContent.trim();
            const folder = { name, tabs: [] };
            processNode(dl, name);
            // Collect links inside this folder
            const links = dl.querySelectorAll(':scope > dt > a');
            for (const link of links) {
              folder.tabs.push({
                title: link.textContent.trim() || 'Untitled',
                url: link.getAttribute('href') || '',
                favicon: link.getAttribute('icon') || ''
              });
            }
            if (folder.tabs.length > 0) {
              results.push(folder);
            }
            // Process sub-folders recursively
            const subDls = dl.querySelectorAll(':scope > dt > dl');
            for (const subDl of subDls) {
              const subH3 = subDl.parentElement.querySelector(':scope > h3');
              if (subH3) {
                const subFolder = { name: subH3.textContent.trim(), tabs: [] };
                const subLinks = subDl.querySelectorAll(':scope > dt > a');
                for (const link of subLinks) {
                  subFolder.tabs.push({
                    title: link.textContent.trim() || 'Untitled',
                    url: link.getAttribute('href') || '',
                    favicon: link.getAttribute('icon') || ''
                  });
                }
                if (subFolder.tabs.length > 0) {
                  results.push(subFolder);
                }
              }
            }
          }
        }
      }
    }

    const rootDl = doc.querySelector('dl');
    if (rootDl) {
      processNode(rootDl, 'Bookmarks');
    }

    // If no folders found, collect all links as one collection
    if (results.length === 0) {
      const allLinks = doc.querySelectorAll('a');
      if (allLinks.length > 0) {
        const tabs = [];
        for (const link of allLinks) {
          if (link.getAttribute('href')) {
            tabs.push({
              title: link.textContent.trim() || 'Untitled',
              url: link.getAttribute('href'),
              favicon: link.getAttribute('icon') || ''
            });
          }
        }
        if (tabs.length > 0) {
          results.push({ name: 'Imported Bookmarks', tabs });
        }
      }
    }

    return results;
  },

  // Import parsed bookmark folders into current space
  async importBookmarkFolders(spaceId, folders) {
    const collections = await this.getCollections();
    let importedCount = 0;

    for (const folder of folders) {
      const newCollection = {
        id: 'col-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        spaceId,
        name: folder.name,
        tabs: folder.tabs.map(t => ({
          id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          title: t.title,
          url: t.url,
          favicon: t.favicon || '',
          addedAt: Date.now()
        })),
        createdAt: Date.now()
      };
      collections.push(newCollection);
      importedCount += folder.tabs.length;
    }

    await chrome.storage.local.set({ collections });
    this._onDataChanged();
    return importedCount;
  },

  // Notify sync manager when data changes
  _onDataChanged() {
    if (typeof SyncManager !== 'undefined') {
      SyncManager.scheduleSyncAfterChange();
    }
  }
};
