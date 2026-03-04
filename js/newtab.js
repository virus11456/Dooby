// Tooby - New Tab Main Application

let activeSpaceId = null;
let allCollections = [];

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  DragDrop.init();
  await loadApp();
  setupEventListeners();
  await initSync();
});

async function loadApp() {
  const spaces = await Storage.getSpaces();
  activeSpaceId = await Storage.getActiveSpaceId();

  if (!activeSpaceId && spaces.length > 0) {
    activeSpaceId = spaces[0].id;
    await Storage.setActiveSpaceId(activeSpaceId);
  }

  renderSpaces(spaces);
  await renderCollections();
  await renderOpenTabs();
}

// ============================================
// Event Listeners
// ============================================

function setupEventListeners() {
  // Add Space
  document.getElementById('btnAddSpace').addEventListener('click', addSpace);

  // Add Collection
  document.getElementById('btnAddCollection').addEventListener('click', addCollection);

  // Save Session
  document.getElementById('btnSaveSession').addEventListener('click', saveSession);

  // Search
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handleSearch(e.target.value), 200);
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      document.getElementById('searchResults').classList.add('hidden');
    }, 200);
  });

  searchInput.addEventListener('focus', (e) => {
    if (e.target.value.trim()) {
      handleSearch(e.target.value);
    }
  });

  // Close context menu on click outside
  document.addEventListener('click', () => {
    document.getElementById('contextMenu').classList.add('hidden');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+K to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
    // Escape to close search
    if (e.key === 'Escape') {
      searchInput.blur();
      document.getElementById('searchResults').classList.add('hidden');
    }
  });
}

// ============================================
// Spaces
// ============================================

function renderSpaces(spaces) {
  const list = document.getElementById('spacesList');
  list.innerHTML = '';

  for (const space of spaces) {
    const li = document.createElement('li');
    li.className = `space-item${space.id === activeSpaceId ? ' active' : ''}`;
    li.innerHTML = `
      <span class="space-icon"></span>
      <span class="space-name">${escapeHtml(space.name)}</span>
      <span class="space-actions">
        <button class="btn-icon btn-edit-space" title="Rename">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </button>
        <button class="btn-icon btn-delete-space" title="Delete">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </span>
    `;

    li.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-edit-space') || e.target.closest('.btn-delete-space')) return;
      activeSpaceId = space.id;
      await Storage.setActiveSpaceId(activeSpaceId);
      renderSpaces(spaces);
      await renderCollections();
    });

    li.querySelector('.btn-edit-space').addEventListener('click', async (e) => {
      e.stopPropagation();
      const nameEl = li.querySelector('.space-name');
      const input = document.createElement('input');
      input.className = 'inline-edit';
      input.value = space.name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const save = async () => {
        const newName = input.value.trim();
        if (newName && newName !== space.name) {
          await Storage.renameSpace(space.id, newName);
        }
        const spaces = await Storage.getSpaces();
        renderSpaces(spaces);
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = space.name; input.blur(); }
      });
    });

    li.querySelector('.btn-delete-space').addEventListener('click', async (e) => {
      e.stopPropagation();
      const spaces = await Storage.getSpaces();
      if (spaces.length <= 1) {
        alert('You must have at least one space.');
        return;
      }
      if (confirm(`Delete space "${space.name}" and all its collections?`)) {
        await Storage.deleteSpace(space.id);
        const remaining = await Storage.getSpaces();
        activeSpaceId = remaining[0]?.id || null;
        await Storage.setActiveSpaceId(activeSpaceId);
        renderSpaces(remaining);
        await renderCollections();
      }
    });

    list.appendChild(li);
  }
}

async function addSpace() {
  const name = prompt('Enter space name:');
  if (!name || !name.trim()) return;
  const space = await Storage.addSpace(name.trim());
  activeSpaceId = space.id;
  await Storage.setActiveSpaceId(activeSpaceId);
  const spaces = await Storage.getSpaces();
  renderSpaces(spaces);
  await renderCollections();
}

// ============================================
// Collections
// ============================================

async function renderCollections() {
  const grid = document.getElementById('collectionsGrid');
  grid.innerHTML = '';

  if (!activeSpaceId) return;

  allCollections = await Storage.getCollectionsBySpace(activeSpaceId);
  const spaces = await Storage.getSpaces();
  const space = spaces.find(s => s.id === activeSpaceId);
  document.getElementById('spaceTitle').textContent = space ? space.name : 'Untitled';

  for (const collection of allCollections) {
    const card = createCollectionCard(collection);
    grid.appendChild(card);
  }
}

function createCollectionCard(collection) {
  const card = document.createElement('div');
  card.className = 'collection-card';
  card.dataset.collectionId = collection.id;

  // Header
  const header = document.createElement('div');
  header.className = 'collection-header';
  header.innerHTML = `
    <span class="collection-title" contenteditable="false">${escapeHtml(collection.name)}</span>
    <span class="collection-count">${collection.tabs.length}</span>
    <div class="collection-actions">
      <button class="btn-icon btn-open-all" title="Open all tabs">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
      <button class="btn-icon btn-more" title="More actions">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="3" r="1.5" fill="currentColor"/>
          <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
          <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
        </svg>
      </button>
    </div>
  `;

  // Title editing
  const titleEl = header.querySelector('.collection-title');
  titleEl.addEventListener('dblclick', () => {
    titleEl.contentEditable = 'true';
    titleEl.focus();
    document.execCommand('selectAll');
  });
  titleEl.addEventListener('blur', async () => {
    titleEl.contentEditable = 'false';
    const newName = titleEl.textContent.trim();
    if (newName && newName !== collection.name) {
      await Storage.renameCollection(collection.id, newName);
    }
  });
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
  });

  // Open all tabs
  header.querySelector('.btn-open-all').addEventListener('click', () => {
    for (const tab of collection.tabs) {
      chrome.tabs.create({ url: tab.url, active: false });
    }
  });

  // More actions (context menu)
  header.querySelector('.btn-more').addEventListener('click', (e) => {
    e.stopPropagation();
    showContextMenu(e, [
      { label: 'Rename', action: () => { titleEl.contentEditable = 'true'; titleEl.focus(); document.execCommand('selectAll'); } },
      { label: 'Open all in new window', action: () => {
        if (collection.tabs.length > 0) {
          chrome.windows.create({ url: collection.tabs.map(t => t.url) });
        }
      }},
      { type: 'separator' },
      { label: 'Delete collection', danger: true, action: async () => {
        if (confirm(`Delete "${collection.name}" and all its tabs?`)) {
          await Storage.deleteCollection(collection.id);
          await renderCollections();
        }
      }}
    ]);
  });

  card.appendChild(header);

  // Body (tabs)
  const body = document.createElement('div');
  body.className = 'collection-body';

  if (collection.tabs.length === 0) {
    body.innerHTML = '<div class="collection-body-empty">Drag tabs here</div>';
  } else {
    for (const tab of collection.tabs) {
      const tabEl = createTabElement(tab, collection.id);
      body.appendChild(tabEl);
    }
  }

  // Make body a drop target
  DragDrop.makeDropTarget(body, {
    type: 'collection-body',
    onDrop: async (data, dropIndex) => {
      if (data.type === 'open-tab') {
        // From open tabs sidebar
        await Storage.addTabToCollection(collection.id, {
          title: data.title,
          url: data.url,
          favicon: data.favicon
        });
        // Close the browser tab
        try { chrome.tabs.remove(data.chromeTabId); } catch(e) {}
      } else if (data.type === 'collection-tab') {
        // From another collection
        await Storage.moveTab(data.collectionId, collection.id, data.tabId, dropIndex);
      }
      await renderCollections();
      await renderOpenTabs();
    }
  });

  card.appendChild(body);
  return card;
}

function createTabElement(tab, collectionId) {
  const el = document.createElement('div');
  el.className = 'tab-item';
  el.dataset.tabId = tab.id;

  const faviconSrc = tab.favicon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(tab.url).hostname)}&sz=32`;

  el.innerHTML = `
    <img class="tab-favicon" src="${escapeHtml(faviconSrc)}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect width=%2216%22 height=%2216%22 rx=%222%22 fill=%22%236C5CE7%22/><text x=%228%22 y=%2212%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2210%22>${escapeHtml(tab.title.charAt(0).toUpperCase())}</text></svg>'">
    <span class="tab-title" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title)}</span>
    <button class="tab-remove" title="Remove">&times;</button>
  `;

  // Click to open tab
  el.querySelector('.tab-title').addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.create({ url: tab.url });
  });

  // Remove tab
  el.querySelector('.tab-remove').addEventListener('click', async (e) => {
    e.stopPropagation();
    await Storage.removeTabFromCollection(collectionId, tab.id);
    await renderCollections();
  });

  // Make draggable
  DragDrop.makeDraggable(el, {
    type: 'collection-tab',
    tabId: tab.id,
    collectionId: collectionId,
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon
  });

  // Right-click context menu
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, [
      { label: 'Open in new tab', action: () => chrome.tabs.create({ url: tab.url }) },
      { label: 'Open in new window', action: () => chrome.windows.create({ url: tab.url }) },
      { label: 'Copy URL', action: () => navigator.clipboard.writeText(tab.url) },
      { type: 'separator' },
      { label: 'Remove', danger: true, action: async () => {
        await Storage.removeTabFromCollection(collectionId, tab.id);
        await renderCollections();
      }}
    ]);
  });

  return el;
}

async function addCollection() {
  if (!activeSpaceId) return;
  const name = prompt('Enter collection name:');
  if (!name || !name.trim()) return;
  await Storage.addCollection(activeSpaceId, name.trim());
  await renderCollections();
}

// ============================================
// Open Tabs Sidebar
// ============================================

async function renderOpenTabs() {
  const list = document.getElementById('openTabsList');
  list.innerHTML = '';

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch(e) {
    // Not in extension context
    return;
  }

  // Filter out chrome:// and extension pages
  tabs = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));

  document.getElementById('openTabCount').textContent = tabs.length;

  for (const tab of tabs) {
    const li = document.createElement('li');
    li.className = 'open-tab-item';

    const faviconSrc = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(tab.url).hostname)}&sz=32`;

    li.innerHTML = `
      <img src="${escapeHtml(faviconSrc)}" alt="" onerror="this.style.display='none'">
      <span class="open-tab-title" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title || 'Untitled')}</span>
    `;

    // Make draggable
    DragDrop.makeDraggable(li, {
      type: 'open-tab',
      chromeTabId: tab.id,
      title: tab.title || 'Untitled',
      url: tab.url,
      favicon: tab.favIconUrl || ''
    });

    // Click to switch to tab
    li.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });

    list.appendChild(li);
  }
}

// ============================================
// Save Session
// ============================================

async function saveSession() {
  if (!activeSpaceId) return;

  const name = prompt('Save session as:', `Session ${new Date().toLocaleDateString()}`);
  if (!name || !name.trim()) return;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch(e) {
    return;
  }

  tabs = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));

  const collection = await Storage.addCollection(activeSpaceId, name.trim());
  const collections = await Storage.getCollections();
  const col = collections.find(c => c.id === collection.id);

  if (col) {
    col.tabs = tabs.map(t => ({
      id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      title: t.title || 'Untitled',
      url: t.url,
      favicon: t.favIconUrl || '',
      addedAt: Date.now()
    }));
    await Storage.saveCollections(collections);
  }

  await renderCollections();
}

// ============================================
// Search
// ============================================

async function handleSearch(query) {
  const resultsEl = document.getElementById('searchResults');

  if (!query.trim()) {
    resultsEl.classList.add('hidden');
    return;
  }

  const results = await Storage.searchTabs(query);
  resultsEl.innerHTML = '';

  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="search-result-item"><span class="search-result-info"><span class="search-result-title">No results found</span></span></div>';
  } else {
    for (const result of results.slice(0, 20)) {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const faviconSrc = result.favicon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(result.url).hostname)}&sz=32`;
      item.innerHTML = `
        <img src="${escapeHtml(faviconSrc)}" alt="" onerror="this.style.display='none'">
        <span class="search-result-info">
          <span class="search-result-title">${escapeHtml(result.title)}</span>
          <span class="search-result-collection">${escapeHtml(result.collectionName)}</span>
        </span>
      `;
      item.addEventListener('click', () => {
        chrome.tabs.create({ url: result.url });
        resultsEl.classList.add('hidden');
      });
      resultsEl.appendChild(item);
    }
  }

  resultsEl.classList.remove('hidden');
}

// ============================================
// Context Menu
// ============================================

function showContextMenu(e, items) {
  const menu = document.getElementById('contextMenu');
  const ul = menu.querySelector('ul');
  ul.innerHTML = '';

  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('li');
      sep.className = 'separator';
      ul.appendChild(sep);
      continue;
    }

    const li = document.createElement('li');
    li.textContent = item.label;
    if (item.danger) li.className = 'danger';
    li.addEventListener('click', (ev) => {
      ev.stopPropagation();
      menu.classList.add('hidden');
      item.action();
    });
    ul.appendChild(li);
  }

  // Position
  menu.classList.remove('hidden');
  const menuRect = menu.getBoundingClientRect();
  let x = e.clientX;
  let y = e.clientY;
  if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 8;
  if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

// ============================================
// Utilities
// ============================================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// Cloud Sync
// ============================================

async function initSync() {
  const user = await SyncManager.init();

  // Listen for sync events
  SyncManager.on('*', (event, data) => {
    switch (event) {
      case 'sync_start':
        updateSyncUI('syncing', 'Syncing...');
        break;
      case 'sync_complete':
        updateSyncUI('success', 'Synced');
        setTimeout(() => updateSyncUI('idle', ''), 3000);
        break;
      case 'sync_error':
        updateSyncUI('error', 'Sync failed');
        setTimeout(() => updateSyncUI('idle', ''), 5000);
        break;
      case 'data_updated':
        // Remote data was pulled, refresh UI
        loadApp();
        break;
      case 'signed_in':
        renderUserUI(data);
        break;
      case 'signed_out':
        renderUserUI(null);
        break;
    }
  });

  renderUserUI(user);
  setupSyncEventListeners();
}

function renderUserUI(user) {
  const btnSignIn = document.getElementById('btnSignIn');
  const userProfile = document.getElementById('userProfile');
  const syncStatusEl = document.getElementById('syncStatus');
  const btnSync = document.getElementById('btnSync');

  if (user) {
    btnSignIn.style.display = 'none';
    userProfile.classList.remove('hidden');
    syncStatusEl.classList.remove('hidden');
    btnSync.classList.remove('hidden');

    document.getElementById('userAvatar').src = user.photoURL || '';
    document.getElementById('userName').textContent = user.displayName || user.email || '';
  } else {
    btnSignIn.style.display = '';
    userProfile.classList.add('hidden');
    syncStatusEl.classList.add('hidden');
    btnSync.classList.add('hidden');
  }
}

function updateSyncUI(status, text) {
  const el = document.getElementById('syncStatus');
  const textEl = document.getElementById('syncStatusText');

  el.classList.remove('syncing', 'success', 'error');
  if (status !== 'idle') {
    el.classList.add(status);
    el.classList.remove('hidden');
  }
  textEl.textContent = text;
}

function setupSyncEventListeners() {
  // Sign In
  document.getElementById('btnSignIn').addEventListener('click', async () => {
    try {
      await SyncManager.signIn();
    } catch (err) {
      alert('Sign in failed: ' + err.message);
    }
  });

  // User menu (sign out)
  document.getElementById('btnUserMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    showContextMenu(e, [
      { label: 'Sync now', action: () => SyncManager.syncNow() },
      { type: 'separator' },
      { label: 'Sign out', danger: true, action: async () => {
        if (confirm('Sign out? Your data will remain on this device.')) {
          await SyncManager.signOut();
        }
      }}
    ]);
  });

  // Manual sync button
  document.getElementById('btnSync').addEventListener('click', () => {
    SyncManager.syncNow();
  });

  // Export/Import modal
  document.getElementById('btnExportImport').addEventListener('click', () => {
    document.getElementById('exportImportModal').classList.remove('hidden');
  });

  document.getElementById('btnCloseExportImport').addEventListener('click', () => {
    document.getElementById('exportImportModal').classList.add('hidden');
  });

  // Export
  document.getElementById('btnExportData').addEventListener('click', async () => {
    const data = await SyncManager.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tooby-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    document.getElementById('exportImportModal').classList.add('hidden');
  });

  // Import
  document.getElementById('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (confirm(`Import ${data.spaces?.length || 0} spaces and ${data.collections?.length || 0} collections? This will replace your current data.`)) {
        await SyncManager.importData(data);
        await loadApp();
      }
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = '';
    document.getElementById('exportImportModal').classList.add('hidden');
  });

  // Listen for sync triggers from background
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TOOBY_SYNC_TRIGGER') {
        SyncManager.syncNow();
      }
    });
  } catch (e) {
    // Not in extension context
  }
}
