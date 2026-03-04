// Dooby - New Tab Main Application

let activeSpaceId = null;
let allCollections = [];
let bulkMode = false;
let selectedTabs = new Map(); // tabId -> { collectionId, url, title }

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  DragDrop.init();
  await loadApp();
  setupEventListeners();
  setupTabListeners();
  await initSync();
});

function setupTabListeners() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  chrome.tabs.onCreated.addListener(() => renderOpenTabs());
  chrome.tabs.onRemoved.addListener(() => renderOpenTabs());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.url || changeInfo.status === 'complete') {
      renderOpenTabs();
    }
  });
}

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
    // Escape to close search or exit bulk mode
    if (e.key === 'Escape') {
      if (bulkMode) {
        toggleBulkMode();
      } else {
        searchInput.blur();
        document.getElementById('searchResults').classList.add('hidden');
        // Close modals
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
      }
    }
  });

  // New feature listeners
  setupBulkEventListeners();
  setupDuplicatesListeners();
  setupImportBookmarksListeners();
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

// Color palette for collection cards
const CARD_COLORS = [
  { border: '#10b981', bg: 'rgba(16, 185, 129, 0.08)', badge: 'rgba(16, 185, 129, 0.15)', text: '#10b981' },
  { border: '#6366f1', bg: 'rgba(99, 102, 241, 0.08)', badge: 'rgba(99, 102, 241, 0.15)', text: '#6366f1' },
  { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', badge: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' },
  { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.08)', badge: 'rgba(236, 72, 153, 0.15)', text: '#ec4899' },
  { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.08)', badge: 'rgba(6, 182, 212, 0.15)', text: '#06b6d4' },
  { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.08)', badge: 'rgba(139, 92, 246, 0.15)', text: '#8b5cf6' },
  { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)', badge: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
  { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.08)', badge: 'rgba(20, 184, 166, 0.15)', text: '#14b8a6' },
];

function getCardColor(index) {
  return CARD_COLORS[index % CARD_COLORS.length];
}

async function renderCollections() {
  const grid = document.getElementById('collectionsGrid');
  grid.innerHTML = '';

  if (!activeSpaceId) return;

  allCollections = await Storage.getCollectionsBySpace(activeSpaceId);
  const spaces = await Storage.getSpaces();
  const space = spaces.find(s => s.id === activeSpaceId);
  document.getElementById('spaceTitle').textContent = space ? space.name : 'Untitled';

  for (let i = 0; i < allCollections.length; i++) {
    const card = createCollectionCard(allCollections[i], i);
    grid.appendChild(card);
  }
}

function createCollectionCard(collection, colorIndex = 0) {
  const card = document.createElement('div');
  card.className = 'collection-card';
  card.dataset.collectionId = collection.id;

  // Apply per-card color
  const color = getCardColor(colorIndex);
  card.style.setProperty('--card-accent', color.border);
  card.style.setProperty('--card-accent-bg', color.bg);
  card.style.setProperty('--card-badge-bg', color.badge);
  card.style.setProperty('--card-accent-text', color.text);

  // Header
  const header = document.createElement('div');
  header.className = 'collection-header';
  header.innerHTML = `
    <span class="collection-color-dot"></span>
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
      { label: bulkMode ? 'Exit select mode' : 'Select tabs', action: () => toggleBulkMode() },
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

  const MAX_VISIBLE = 5;
  if (collection.tabs.length === 0) {
    body.innerHTML = '<div class="collection-body-empty">Drag tabs here</div>';
  } else {
    if (collection.tabs.length > MAX_VISIBLE) {
      body.classList.add('collapsed');
    }
    for (const tab of collection.tabs) {
      const tabEl = createTabElement(tab, collection.id);
      body.appendChild(tabEl);
    }
    if (collection.tabs.length > MAX_VISIBLE) {
      const showMoreBtn = document.createElement('button');
      showMoreBtn.className = 'btn-show-more';
      const hiddenCount = collection.tabs.length - MAX_VISIBLE;
      showMoreBtn.innerHTML = `<span>Show ${hiddenCount} more</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      showMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = body.classList.toggle('collapsed');
        if (isCollapsed) {
          showMoreBtn.innerHTML = `<span>Show ${hiddenCount} more</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
        } else {
          showMoreBtn.innerHTML = `<span>Show less</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
        }
      });
      body.appendChild(showMoreBtn);
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
    <input type="checkbox" class="tab-checkbox">
    <img class="tab-favicon" src="${escapeHtml(faviconSrc)}" alt="">
    <span class="tab-title" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title)}</span>
    <button class="tab-remove" title="Remove">&times;</button>
  `;

  // Handle favicon load error via JS (CSP does not allow inline handlers)
  el.querySelector('.tab-favicon').addEventListener('error', function() {
    this.style.display = 'none';
  });

  // Checkbox for bulk selection
  const checkbox = el.querySelector('.tab-checkbox');
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    if (checkbox.checked) {
      selectedTabs.set(tab.id, { collectionId, url: tab.url, title: tab.title });
      el.classList.add('selected');
    } else {
      selectedTabs.delete(tab.id);
      el.classList.remove('selected');
    }
    updateBulkBar();
  });

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
      <img src="${escapeHtml(faviconSrc)}" alt="">
      <span class="open-tab-title" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title || 'Untitled')}</span>
    `;

    li.querySelector('img').addEventListener('error', function() {
      this.style.display = 'none';
    });

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
        <img src="${escapeHtml(faviconSrc)}" alt="">
        <span class="search-result-info">
          <span class="search-result-title">${escapeHtml(result.title)}</span>
          <span class="search-result-collection">${escapeHtml(result.collectionName)}</span>
        </span>
      `;
      item.querySelector('img').addEventListener('error', function() {
        this.style.display = 'none';
      });
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
// Bulk Operations
// ============================================

function toggleBulkMode() {
  bulkMode = !bulkMode;
  selectedTabs.clear();
  document.body.classList.toggle('bulk-mode', bulkMode);
  document.getElementById('bulkActionBar').classList.toggle('hidden', !bulkMode);
  // Uncheck all checkboxes
  document.querySelectorAll('.tab-checkbox').forEach(cb => {
    cb.checked = false;
  });
  document.querySelectorAll('.tab-item.selected').forEach(el => {
    el.classList.remove('selected');
  });
  updateBulkBar();
}

function updateBulkBar() {
  const count = selectedTabs.size;
  document.getElementById('bulkSelectedCount').textContent = `${count} selected`;
}

function setupBulkEventListeners() {
  document.getElementById('btnBulkCancel').addEventListener('click', () => {
    toggleBulkMode();
  });

  document.getElementById('btnBulkOpen').addEventListener('click', () => {
    for (const [, data] of selectedTabs) {
      chrome.tabs.create({ url: data.url, active: false });
    }
    toggleBulkMode();
  });

  document.getElementById('btnBulkDelete').addEventListener('click', async () => {
    if (selectedTabs.size === 0) return;
    if (!confirm(`Delete ${selectedTabs.size} selected tabs?`)) return;

    // Group by collection
    const byCollection = {};
    for (const [tabId, data] of selectedTabs) {
      if (!byCollection[data.collectionId]) byCollection[data.collectionId] = [];
      byCollection[data.collectionId].push(tabId);
    }

    for (const [colId, tabIds] of Object.entries(byCollection)) {
      await Storage.removeTabsFromCollection(colId, tabIds);
    }

    toggleBulkMode();
    await renderCollections();
  });

  document.getElementById('btnBulkMove').addEventListener('click', async (e) => {
    if (selectedTabs.size === 0) return;

    // Show collection picker as context menu
    const collections = await Storage.getCollectionsBySpace(activeSpaceId);
    const items = collections.map(col => ({
      label: col.name,
      action: async () => {
        const byCollection = {};
        for (const [tabId, data] of selectedTabs) {
          if (data.collectionId === col.id) continue; // skip same collection
          if (!byCollection[data.collectionId]) byCollection[data.collectionId] = [];
          byCollection[data.collectionId].push(tabId);
        }
        for (const [fromColId, tabIds] of Object.entries(byCollection)) {
          await Storage.moveTabsBulk(fromColId, col.id, tabIds);
        }
        toggleBulkMode();
        await renderCollections();
      }
    }));
    showContextMenu(e, items);
  });
}

// ============================================
// Duplicate Detection
// ============================================

async function showDuplicatesModal() {
  const duplicates = await Storage.findDuplicates();
  const modal = document.getElementById('duplicatesModal');
  const list = document.getElementById('duplicatesList');
  const desc = document.getElementById('duplicatesDesc');

  list.innerHTML = '';

  if (duplicates.length === 0) {
    desc.textContent = 'No duplicate URLs found. Your collections are clean!';
    document.getElementById('btnRemoveAllDuplicates').style.display = 'none';
  } else {
    const totalDups = duplicates.reduce((sum, d) => sum + d.entries.length - 1, 0);
    desc.textContent = `Found ${duplicates.length} URLs with duplicates (${totalDups} extra copies).`;
    document.getElementById('btnRemoveAllDuplicates').style.display = '';

    for (const dup of duplicates) {
      const group = document.createElement('div');
      group.className = 'duplicate-group';

      const urlEl = document.createElement('div');
      urlEl.className = 'duplicate-url';
      urlEl.textContent = dup.entries[0].tab.url;
      group.appendChild(urlEl);

      dup.entries.forEach((entry, i) => {
        const entryEl = document.createElement('div');
        entryEl.className = 'duplicate-entry';
        entryEl.innerHTML = `
          <span>${escapeHtml(entry.tab.title)}</span>
          <span class="dup-collection">${escapeHtml(entry.collectionName)}</span>
          <span class="${i === 0 ? 'dup-keep' : 'dup-remove'}">${i === 0 ? 'KEEP' : 'REMOVE'}</span>
        `;
        group.appendChild(entryEl);
      });

      list.appendChild(group);
    }
  }

  modal.classList.remove('hidden');

  // Store duplicates for removal
  modal._duplicates = duplicates;
}

function setupDuplicatesListeners() {
  document.getElementById('btnFindDuplicates').addEventListener('click', showDuplicatesModal);

  document.getElementById('btnCloseDuplicates').addEventListener('click', () => {
    document.getElementById('duplicatesModal').classList.add('hidden');
  });

  document.getElementById('btnRemoveAllDuplicates').addEventListener('click', async () => {
    const modal = document.getElementById('duplicatesModal');
    const duplicates = modal._duplicates;
    if (!duplicates || duplicates.length === 0) return;

    const totalDups = duplicates.reduce((sum, d) => sum + d.entries.length - 1, 0);
    if (!confirm(`Remove ${totalDups} duplicate tabs? The first copy of each will be kept.`)) return;

    const removed = await Storage.removeDuplicates(duplicates);
    alert(`Removed ${removed} duplicate tabs.`);
    modal.classList.add('hidden');
    await renderCollections();
  });
}

// ============================================
// Import Bookmarks
// ============================================

function setupImportBookmarksListeners() {
  document.getElementById('btnImportBookmarks').addEventListener('click', () => {
    document.getElementById('importBookmarksModal').classList.remove('hidden');
  });

  document.getElementById('btnCloseImportBookmarks').addEventListener('click', () => {
    document.getElementById('importBookmarksModal').classList.add('hidden');
  });

  // Import HTML bookmarks
  document.getElementById('importBookmarkHtml').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const html = await file.text();
      const folders = Storage.parseBookmarksHtml(html);
      if (folders.length === 0) {
        alert('No bookmarks found in the file.');
        return;
      }
      const totalTabs = folders.reduce((sum, f) => sum + f.tabs.length, 0);
      if (confirm(`Import ${folders.length} folders with ${totalTabs} bookmarks?`)) {
        const count = await Storage.importBookmarkFolders(activeSpaceId, folders);
        alert(`Imported ${count} bookmarks into ${folders.length} collections.`);
        await renderCollections();
      }
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = '';
    document.getElementById('importBookmarksModal').classList.add('hidden');
  });

  // Import JSON bookmarks
  document.getElementById('importBookmarkJson').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Handle Dooby format
      if (data.spaces && data.collections) {
        if (confirm(`Import ${data.spaces.length} spaces and ${data.collections.length} collections? This will replace your current data.`)) {
          await SyncManager.importData(data);
          await loadApp();
        }
        e.target.value = '';
        document.getElementById('importBookmarksModal').classList.add('hidden');
        return;
      }

      // Handle TabMe format (isTabme flag + spaces[].folders[].items[])
      if (data.isTabme && data.spaces) {
        const folders = parseTabMeJson(data);
        if (folders.length === 0) {
          alert('No bookmarks found in the TabMe JSON file.');
          e.target.value = '';
          document.getElementById('importBookmarksModal').classList.add('hidden');
          return;
        }
        const totalTabs = folders.reduce((sum, f) => sum + f.tabs.length, 0);
        if (confirm(`Import ${folders.length} collections with ${totalTabs} bookmarks from TabMe?`)) {
          const count = await Storage.importBookmarkFolders(activeSpaceId, folders);
          alert(`Imported ${count} bookmarks into ${folders.length} collections.`);
          await renderCollections();
        }
        e.target.value = '';
        document.getElementById('importBookmarksModal').classList.add('hidden');
        return;
      }

      // Handle Toby format (version + lists with cards)
      if (data.lists && Array.isArray(data.lists)) {
        const folders = parseTobyJson(data);
        if (folders.length === 0) {
          alert('No bookmarks found in the Toby JSON file.');
          e.target.value = '';
          document.getElementById('importBookmarksModal').classList.add('hidden');
          return;
        }
        const totalTabs = folders.reduce((sum, f) => sum + f.tabs.length, 0);
        if (confirm(`Import ${folders.length} collections with ${totalTabs} bookmarks from Toby?`)) {
          const count = await Storage.importBookmarkFolders(activeSpaceId, folders);
          alert(`Imported ${count} bookmarks into ${folders.length} collections.`);
          await renderCollections();
        }
        e.target.value = '';
        document.getElementById('importBookmarksModal').classList.add('hidden');
        return;
      }

      // Handle Chrome JSON bookmark format (nested with children)
      const folders = parseJsonBookmarks(data);
      if (folders.length === 0) {
        alert('No bookmarks found in the JSON file.');
        return;
      }
      const totalTabs = folders.reduce((sum, f) => sum + f.tabs.length, 0);
      if (confirm(`Import ${folders.length} folders with ${totalTabs} bookmarks?`)) {
        const count = await Storage.importBookmarkFolders(activeSpaceId, folders);
        alert(`Imported ${count} bookmarks into ${folders.length} collections.`);
        await renderCollections();
      }
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = '';
    document.getElementById('importBookmarksModal').classList.add('hidden');
  });
}

function parseJsonBookmarks(data) {
  const folders = [];

  function walk(node, parentName) {
    if (!node) return;

    // Chrome bookmark JSON format has "children" array
    if (node.children) {
      const name = node.name || parentName || 'Bookmarks';
      const tabs = [];

      for (const child of node.children) {
        if (child.url) {
          tabs.push({
            title: child.name || 'Untitled',
            url: child.url,
            favicon: ''
          });
        } else if (child.children) {
          walk(child, child.name);
        }
      }

      if (tabs.length > 0) {
        folders.push({ name, tabs });
      }
    }

    // Handle "roots" object (Chrome bookmark tree root)
    if (node.roots) {
      for (const key of Object.keys(node.roots)) {
        walk(node.roots[key], node.roots[key]?.name || key);
      }
    }
  }

  // Handle array of items or single object
  if (Array.isArray(data)) {
    for (const item of data) walk(item, 'Imported');
  } else {
    walk(data, 'Imported');
  }

  return folders;
}

// Parse Toby JSON format (version + lists with cards)
function parseTobyJson(data) {
  const folders = [];
  if (!data.lists || !Array.isArray(data.lists)) return folders;

  for (const list of data.lists) {
    if (!list.cards || list.cards.length === 0) continue;
    const tabs = [];
    for (const card of list.cards) {
      if (card.url) {
        tabs.push({
          title: card.customTitle || card.title || 'Untitled',
          url: card.url,
          favicon: ''
        });
      }
    }
    if (tabs.length > 0) {
      folders.push({ name: list.title || 'Imported', tabs });
    }
  }
  return folders;
}

// Parse TabMe JSON format (spaces[].folders[].items[])
function parseTabMeJson(data) {
  const folders = [];
  if (!data.spaces || !Array.isArray(data.spaces)) return folders;

  for (const space of data.spaces) {
    if (!space.folders || !Array.isArray(space.folders)) continue;
    for (const folder of space.folders) {
      if (!folder.items || folder.items.length === 0) continue;
      const tabs = [];
      for (const item of folder.items) {
        if (item.url) {
          tabs.push({
            title: item.title || 'Untitled',
            url: item.url,
            favicon: item.favIconUrl || ''
          });
        }
      }
      if (tabs.length > 0) {
        folders.push({ name: folder.title || 'Imported', tabs });
      }
    }
  }
  return folders;
}

// ============================================
// Cloud Sync (via chrome.storage.sync)
// ============================================

async function initSync() {
  await SyncManager.init();

  // Listen for sync events
  SyncManager.on('*', (event, data) => {
    switch (event) {
      case 'sync_start':
        updateSyncUI('syncing', 'Syncing...');
        break;
      case 'sync_complete':
        updateSyncUI('success', 'Synced');
        setTimeout(() => updateSyncUI('idle', 'Synced'), 3000);
        break;
      case 'sync_error':
        updateSyncUI('error', 'Sync failed');
        setTimeout(() => updateSyncUI('idle', 'Synced'), 5000);
        break;
      case 'data_updated':
        // Remote data was pulled from another device, refresh UI
        loadApp();
        break;
    }
  });

  setupSyncEventListeners();
}

function updateSyncUI(status, text) {
  const el = document.getElementById('syncStatus');
  const textEl = document.getElementById('syncStatusText');

  el.classList.remove('syncing', 'success', 'error');
  if (status !== 'idle') {
    el.classList.add(status);
  }
  textEl.textContent = text;
}

function setupSyncEventListeners() {
  // Manual sync button
  document.getElementById('btnSync').addEventListener('click', () => {
    SyncManager.pushToSync();
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
    a.download = `dooby-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
}
