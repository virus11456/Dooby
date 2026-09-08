// Dooby - New Tab Main Application

let activeSpaceId = null;
let allCollections = [];
let bulkMode = false;
let selectedTabs = new Map(); // tabId -> { collectionId, url, title }
let appSettings = { ...DEFAULT_SETTINGS };
const expandedCollections = new Set(); // collection ids the user expanded ("Show more")

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  appSettings = await Storage.getSettings();
  await I18n.load(appSettings.language);
  I18n.applyToDom();
  showAppVersion();
  await DonorManager.init();
  DragDrop.init();
  await loadApp();
  setupEventListeners();
  setupSettingsListeners();
  setupToastListeners();
  setupTabListeners();
  await initSync();
  await initCloud();
  refreshDonateUI();
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

// loadApp() can be triggered from several places at once (user action,
// sync pull, cloud update). Serialize the calls so two overlapping renders
// never append the same cards twice.
let _loadAppChain = Promise.resolve();
function loadApp() {
  const run = _loadAppChain.then(() => _loadAppImpl());
  _loadAppChain = run.catch(() => {});
  return run;
}

async function _loadAppImpl() {
  appSettings = await Storage.getSettings();
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
        <button class="btn-icon btn-edit-space" title="${t('rename')}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </button>
        <button class="btn-icon btn-delete-space" title="${t('delete')}">
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
        alert(t('at_least_one_space'));
        return;
      }
      if (confirm(t('delete_space_confirm', { name: space.name }))) {
        const allSpaces = await Storage.getSpaces();
        const index = allSpaces.findIndex(s => s.id === space.id);
        const snapshot = index >= 0 ? allSpaces[index] : space;
        const spaceCollections = await Storage.getCollectionsBySpace(space.id);
        const wasActive = activeSpaceId === space.id;
        await Storage.deleteSpace(space.id);
        const remaining = await Storage.getSpaces();
        activeSpaceId = remaining[0]?.id || null;
        await Storage.setActiveSpaceId(activeSpaceId);
        renderSpaces(remaining);
        await renderCollections();
        showToast(t('toast_space_deleted', { name: snapshot.name }), {
          actionLabel: t('undo'),
          onAction: async () => {
            await Storage.restoreSpace(snapshot, Math.max(index, 0), spaceCollections);
            if (wasActive) { activeSpaceId = snapshot.id; await Storage.setActiveSpaceId(snapshot.id); }
            await loadApp();
          }
        });
      }
    });

    list.appendChild(li);
  }
}

async function addSpace() {
  const name = prompt(t('enter_space_name'));
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

  if (!activeSpaceId) { grid.innerHTML = ''; return; }

  allCollections = await Storage.getCollectionsBySpace(activeSpaceId);
  const spaces = await Storage.getSpaces();
  const space = spaces.find(s => s.id === activeSpaceId);
  document.getElementById('spaceTitle').textContent = space ? space.name : 'Untitled';

  // Sort: pinned collections first, then by the chosen order (Settings)
  const pinned = sortCollections(allCollections.filter(c => c.pinned));
  const unpinned = sortCollections(allCollections.filter(c => !c.pinned));
  const sorted = [...pinned, ...unpinned];

  // Reconcile instead of rebuilding: cards whose content did not change are
  // kept as-is (no favicon reload, no flicker, expanded state and scroll
  // position survive); only changed cards are re-created, then the DOM order
  // is fixed up with the minimum number of moves.
  const existing = new Map();
  for (const el of grid.querySelectorAll(':scope > .collection-card')) existing.set(el.dataset.collectionId, el);
  const desired = [];
  sorted.forEach((collection, i) => {
    const sig = collectionSignature(collection, i);
    let el = existing.get(collection.id);
    if (!el || el.dataset.sig !== sig) {
      el = createCollectionCard(collection, i);
      el.dataset.sig = sig;
    }
    desired.push(el);
  });
  const keep = new Set(desired);
  for (const el of existing.values()) if (!keep.has(el)) el.remove();
  desired.forEach((el, i) => {
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
  });
}

// Everything a card's markup depends on; equal signature = card can be reused.
function collectionSignature(c, colorIndex) {
  return JSON.stringify([
    c.name, !!c.pinned, colorIndex, appSettings.tabSort, I18n.lang(),
    (c.tabs || []).map(t => [t.id, t.title, t.url, t.favicon || '', !!t.pinned])
  ]);
}

// Stable sorts driven by Settings. "manual" keeps the stored order.
function sortCollections(list) {
  const by = appSettings.collectionSort;
  if (!by || by === 'manual') return list;
  const arr = [...list];
  const cmp = {
    name: (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }),
    newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    oldest: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    count: (a, b) => (b.tabs || []).length - (a.tabs || []).length
  }[by];
  return cmp ? arr.sort(cmp) : list;
}

function sortTabs(tabs) {
  const by = appSettings.tabSort;
  const pinned = tabs.filter(t => t.pinned);
  const rest = tabs.filter(t => !t.pinned);
  if (!by || by === 'manual') return [...pinned, ...rest];
  const cmp = {
    newest: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    oldest: (a, b) => (a.addedAt || 0) - (b.addedAt || 0),
    title: (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
  }[by];
  return cmp ? [...pinned.sort(cmp), ...rest.sort(cmp)] : [...pinned, ...rest];
}

function createCollectionCard(collection, colorIndex = 0) {
  const card = document.createElement('div');
  card.className = 'collection-card' + (collection.pinned ? ' pinned-card' : '');
  card.dataset.collectionId = collection.id;

  // Apply per-card color
  const color = getCardColor(colorIndex);
  card.style.setProperty('--card-accent', color.border);
  card.style.setProperty('--card-accent-bg', color.bg);
  card.style.setProperty('--card-badge-bg', color.badge);
  card.style.setProperty('--card-accent-text', color.text);

  const pinIndicator = collection.pinned ? '<svg class="collection-pin-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189a5.1 5.1 0 0 1 .752-.555l.078-.048V2.323a2 2 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z"/></svg>' : '';

  // Header
  const header = document.createElement('div');
  header.className = 'collection-header';
  header.innerHTML = `
    <span class="collection-color-dot"></span>
    ${pinIndicator}
    <span class="collection-title" contenteditable="false">${escapeHtml(collection.name)}</span>
    <span class="collection-count">${collection.tabs.length}</span>
    <div class="collection-actions">
      <button class="btn-icon btn-open-all" title="${t('open_all_tabs_title')}">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
      <button class="btn-icon btn-more" title="${t('more_actions')}">
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
      { label: collection.pinned ? t('unpin_card') : t('pin_card'), action: async () => {
        await Storage.togglePinCollection(collection.id);
        await renderCollections();
      }},
      { type: 'separator' },
      { label: t('rename'), action: () => { titleEl.contentEditable = 'true'; titleEl.focus(); document.execCommand('selectAll'); } },
      { label: t('open_all_new_window'), action: () => {
        if (collection.tabs.length > 0) {
          chrome.windows.create({ url: collection.tabs.map(t => t.url) });
        }
      }},
      { label: bulkMode ? t('exit_select_mode') : t('select_tabs'), action: () => toggleBulkMode() },
      { type: 'separator' },
      { label: t('delete_collection'), danger: true, action: async () => {
        if (!confirm(t('delete_collection_confirm', { name: collection.name }))) return;
        const all = await Storage.getCollections();
        const index = all.findIndex(c => c.id === collection.id);
        const snapshot = index >= 0 ? all[index] : collection;
        await Storage.deleteCollection(collection.id);
        await renderCollections();
        showToast(t('toast_collection_deleted', { name: snapshot.name }), {
          actionLabel: t('undo'),
          onAction: async () => {
            await Storage.restoreCollection(snapshot, Math.max(index, 0));
            await renderCollections();
          }
        });
      }}
    ]);
  });

  card.appendChild(header);

  // Body (tabs)
  const body = document.createElement('div');
  body.className = 'collection-body';

  const MAX_VISIBLE = 5;
  if (collection.tabs.length === 0) {
    body.innerHTML = `<div class="collection-body-empty">${t('drag_tabs_here')}</div>`;
  } else {
    const expanded = expandedCollections.has(collection.id);
    if (collection.tabs.length > MAX_VISIBLE && !expanded) {
      body.classList.add('collapsed');
    }
    for (const tab of sortTabs(collection.tabs)) {
      const tabEl = createTabElement(tab, collection.id);
      body.appendChild(tabEl);
    }
    if (collection.tabs.length > MAX_VISIBLE) {
      const showMoreBtn = document.createElement('button');
      showMoreBtn.className = 'btn-show-more';
      const hiddenCount = collection.tabs.length - MAX_VISIBLE;
      const paintShowMore = (collapsed) => {
        showMoreBtn.innerHTML = collapsed
          ? `<span>${t('show_more', { n: hiddenCount })}</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
          : `<span>${t('show_less')}</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      };
      paintShowMore(!expanded);
      showMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = body.classList.toggle('collapsed');
        if (isCollapsed) expandedCollections.delete(collection.id); else expandedCollections.add(collection.id);
        paintShowMore(isCollapsed);
      });
      body.appendChild(showMoreBtn);
    }
  }

  // Shared drop handling for the body (with insertion index) and the header
  // (append to the end), so dropping anywhere on the card works.
  const handleDrop = async (data, dropIndex) => {
    if (data.type === 'open-tab') {
      // From open tabs sidebar
      await Storage.addTabToCollection(collection.id, {
        title: data.title,
        url: data.url,
        favicon: data.favicon
      });
      console.log('Dooby: added "' + data.title + '" to collection "' + collection.name + '"');
      // Close the browser tab (unless turned off in Settings)
      if (appSettings.closeTabAfterSave !== false) {
        try { await chrome.tabs.remove(data.chromeTabId); } catch(e) {}
      }
    } else if (data.type === 'collection-tab') {
      // From another collection (or reordering). A visual index only means
      // something in manual order; in sorted views append to the end.
      const index = appSettings.tabSort && appSettings.tabSort !== 'manual' ? collection.tabs.length : dropIndex;
      await Storage.moveTab(data.collectionId, collection.id, data.tabId, index);
    }
    await renderCollections();
    await renderOpenTabs();
  };

  DragDrop.makeDropTarget(body, { type: 'collection-body', onDrop: handleDrop });
  DragDrop.makeDropTarget(header, {
    type: 'collection-header',
    onDrop: (data) => handleDrop(data, collection.tabs.length)
  });
  header.addEventListener('dragover', () => card.classList.add('drag-over'));
  header.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  header.addEventListener('drop', () => card.classList.remove('drag-over'));

  card.appendChild(body);
  return card;
}

// Remove a tab and offer Undo (restores it at its original position).
async function removeTabWithUndo(collectionId, tab) {
  const cols = await Storage.getCollections();
  const col = cols.find(c => c.id === collectionId);
  const index = col ? col.tabs.findIndex(x => x.id === tab.id) : -1;
  const snapshot = index >= 0 ? col.tabs[index] : tab;
  await Storage.removeTabFromCollection(collectionId, tab.id);
  await renderCollections();
  showToast(t('toast_tab_removed', { title: snapshot.title || snapshot.url }), {
    actionLabel: t('undo'),
    onAction: async () => {
      await Storage.restoreTabs(collectionId, [{ tab: snapshot, index: Math.max(index, 0) }]);
      await renderCollections();
    }
  });
}

function createTabElement(tab, collectionId) {
  const el = document.createElement('div');
  el.className = 'tab-item' + (tab.pinned ? ' pinned' : '');
  el.dataset.tabId = tab.id;

  let faviconSrc = '';
  try {
    faviconSrc = tab.favicon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(tab.url).hostname)}&sz=32`;
  } catch(e) {
    faviconSrc = '';
  }

  el.innerHTML = `
    <input type="checkbox" class="tab-checkbox">
    ${tab.pinned ? '<svg class="tab-pin-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189a5.1 5.1 0 0 1 .752-.555l.078-.048V2.323a2 2 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z"/></svg>' : ''}
    <img class="tab-favicon" src="${escapeHtml(faviconSrc)}" alt="" draggable="false">
    <span class="tab-title" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title)}</span>
    <button class="tab-remove" title="${t('remove')}">&times;</button>
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
    await removeTabWithUndo(collectionId, tab);
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
      { label: tab.pinned ? t('unpin_tab') : t('pin_tab'), action: async () => {
        await Storage.togglePinTab(collectionId, tab.id);
        await renderCollections();
      }},
      { type: 'separator' },
      { label: t('open_in_new_tab'), action: () => chrome.tabs.create({ url: tab.url }) },
      { label: t('open_in_new_window'), action: () => chrome.windows.create({ url: tab.url }) },
      { label: t('copy_url'), action: () => navigator.clipboard.writeText(tab.url) },
      { type: 'separator' },
      { label: t('remove'), danger: true, action: () => removeTabWithUndo(collectionId, tab) }
    ]);
  });

  return el;
}

async function addCollection() {
  if (!activeSpaceId) return;
  const name = prompt(t('enter_collection_name'));
  if (!name || !name.trim()) return;
  await Storage.addCollection(activeSpaceId, name.trim());
  await renderCollections();
}

// ============================================
// Open Tabs Sidebar
// ============================================

// Only real web pages are worth saving: skip chrome://, extension pages,
// about:blank, new tab pages, data: URLs, etc.
function isSavableUrl(url) {
  return typeof url === 'string' && /^(https?|ftp|file):/i.test(url);
}

async function renderOpenTabs() {
  const list = document.getElementById('openTabsList');

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch(e) {
    // Not in extension context
    return;
  }

  // Filter out chrome:// and extension pages
  tabs = tabs.filter(t => isSavableUrl(t.url));

  document.getElementById('openTabCount').textContent = tabs.length;

  // Reuse unchanged rows (keyed by tab id) so favicons do not reload.
  const existing = new Map();
  for (const el of list.querySelectorAll(':scope > .open-tab-item')) existing.set(el.dataset.tabId, el);
  const desired = [];
  for (const tab of tabs) {
    const sig = JSON.stringify([tab.title || '', tab.url, tab.favIconUrl || '', tab.windowId, I18n.lang()]);
    let li = existing.get(String(tab.id));
    if (!li || li.dataset.sig !== sig) {
      li = createOpenTabItem(tab);
      li.dataset.tabId = String(tab.id);
      li.dataset.sig = sig;
    }
    desired.push(li);
  }
  const keep = new Set(desired);
  for (const el of existing.values()) if (!keep.has(el)) el.remove();
  desired.forEach((el, i) => {
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
}

function createOpenTabItem(tab) {
  const li = document.createElement('li');
  li.className = 'open-tab-item';

  const faviconSrc = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(tab.url).hostname)}&sz=32`;

  li.innerHTML = `
    <img src="${escapeHtml(faviconSrc)}" alt="" draggable="false">
    <span class="open-tab-title" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title || t('untitled'))}</span>
  `;

  li.querySelector('img').addEventListener('error', function() {
    this.style.display = 'none';
  });

  // Make draggable
  DragDrop.makeDraggable(li, {
    type: 'open-tab',
    chromeTabId: tab.id,
    title: tab.title || t('untitled'),
    url: tab.url,
    favicon: tab.favIconUrl || ''
  });

  // Click to switch to tab
  li.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });
  return li;
}

// ============================================
// Save Session
// ============================================

async function saveSession() {
  if (!activeSpaceId) return;

  const name = prompt(t('save_session_as'), t('session_default_name', { date: new Date().toLocaleDateString() }));
  if (!name || !name.trim()) return;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch(e) {
    return;
  }

  tabs = tabs.filter(t => isSavableUrl(t.url));

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
    resultsEl.innerHTML = `<div class="search-result-item"><span class="search-result-info"><span class="search-result-title">${t('no_results')}</span></span></div>`;
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
// Toast with optional action (used for Undo)
// ============================================

let _toastTimer = null;
let _toastOnAction = null;

function showToast(message, opts = {}) {
  const el = document.getElementById('toast');
  const action = document.getElementById('toastAction');
  document.getElementById('toastText').textContent = message;
  _toastOnAction = opts.onAction || null;
  action.textContent = opts.actionLabel || '';
  action.classList.toggle('hidden', !opts.onAction);
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(hideToast, opts.duration || 6000);
}

function hideToast() {
  clearTimeout(_toastTimer);
  _toastOnAction = null;
  document.getElementById('toast').classList.add('hidden');
}

function setupToastListeners() {
  document.getElementById('toastAction').addEventListener('click', async () => {
    const fn = _toastOnAction;
    hideToast();
    if (fn) await fn();
  });
  document.getElementById('toastClose').addEventListener('click', hideToast);
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
  document.getElementById('bulkSelectedCount').textContent = t('bulk_selected', { n: count });
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
    if (!confirm(t('delete_selected_confirm', { n: selectedTabs.size }))) return;

    // Group by collection
    const byCollection = {};
    for (const [tabId, data] of selectedTabs) {
      if (!byCollection[data.collectionId]) byCollection[data.collectionId] = [];
      byCollection[data.collectionId].push(tabId);
    }

    const all = await Storage.getCollections();
    const removed = {}; // colId -> [{ tab, index }]
    for (const [colId, tabIds] of Object.entries(byCollection)) {
      const col = all.find(c => c.id === colId);
      const ids = new Set(tabIds);
      removed[colId] = col ? col.tabs.map((tab, index) => ({ tab, index })).filter(e => ids.has(e.tab.id)) : [];
      await Storage.removeTabsFromCollection(colId, tabIds);
    }
    const total = Object.values(removed).reduce((a, e) => a + e.length, 0);

    toggleBulkMode();
    await renderCollections();
    showToast(t('toast_tabs_removed', { n: total }), {
      actionLabel: t('undo'),
      onAction: async () => {
        for (const [colId, entries] of Object.entries(removed)) await Storage.restoreTabs(colId, entries);
        await renderCollections();
      }
    });
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
    desc.textContent = t('no_duplicates');
    document.getElementById('btnRemoveAllDuplicates').style.display = 'none';
  } else {
    const totalDups = duplicates.reduce((sum, d) => sum + d.entries.length - 1, 0);
    desc.textContent = t('duplicates_found', { urls: duplicates.length, extra: totalDups });
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
          <span class="${i === 0 ? 'dup-keep' : 'dup-remove'}">${i === 0 ? t('keep_label') : t('remove_label')}</span>
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
    if (!confirm(t('remove_duplicates_confirm', { n: totalDups }))) return;

    const removed = await Storage.removeDuplicates(duplicates);
    alert(t('removed_duplicates', { n: removed }));
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
        alert(t('no_bookmarks_in_file'));
        return;
      }
      const totalTabs = folders.reduce((sum, f) => sum + f.tabs.length, 0);
      if (confirm(t('import_folders_confirm', { folders: folders.length, tabs: totalTabs }))) {
        const count = await Storage.importBookmarkFolders(activeSpaceId, folders);
        alert(t('imported_result', { count, folders: folders.length }));
        await renderCollections();
      }
    } catch (err) {
      alert(t('import_failed', { error: err.message }));
    }
    e.target.value = '';
    document.getElementById('importBookmarksModal').classList.add('hidden');
  });

  // Import JSON bookmarks
  document.getElementById('importBookmarkJson').addEventListener('change', handleImportFileChange);
}

// ============================================
// JSON import / export (shared by every entry point)
// ============================================

// Detects the file format and imports it:
//  - Dooby backup (spaces + collections)  -> replaces all data
//  - TabMe export (isTabme + spaces[].folders[].items[])
//  - Toby export (lists[].cards[])         -> appended as collections
//  - Chrome bookmark JSON (children[])        in the active space
async function importJsonFile(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(t('import_not_json')); }
  if (!data || typeof data !== 'object') throw new Error(t('import_not_json'));

  if (Array.isArray(data.spaces) && Array.isArray(data.collections)) {
    if (!confirm(t('import_replace_confirm', { spaces: data.spaces.length, collections: data.collections.length }))) return false;
    await SyncManager.importData(data);
    await loadApp();
    updateStorageUsage();
    updateSyncUI('success', t('imported'));
    setTimeout(() => updateSyncUI('idle', t('synced')), 3000);
    return true;
  }

  let folders, confirmKey, emptyKey;
  if (data.isTabme && Array.isArray(data.spaces)) {
    folders = parseTabMeJson(data); confirmKey = 'import_tabme_confirm'; emptyKey = 'no_bookmarks_tabme';
  } else if (Array.isArray(data.lists)) {
    folders = parseTobyJson(data); confirmKey = 'import_toby_confirm'; emptyKey = 'no_bookmarks_toby';
  } else {
    folders = parseJsonBookmarks(data); confirmKey = 'import_folders_confirm'; emptyKey = 'no_bookmarks_json';
  }
  if (folders.length === 0) { alert(t(emptyKey)); return false; }
  const totalTabs = folders.reduce((sum, f) => sum + f.tabs.length, 0);
  if (!confirm(t(confirmKey, { folders: folders.length, tabs: totalTabs }))) return false;
  const count = await Storage.importBookmarkFolders(activeSpaceId, folders);
  await renderCollections();
  updateStorageUsage();
  showToast(t('imported_result', { count, folders: folders.length }));
  return true;
}

// change handler for every <input type="file"> that imports JSON
async function handleImportFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await importJsonFile(file);
  } catch (err) {
    console.warn('Dooby: import failed:', err.message);
    alert(t('import_failed', { error: err.message }));
    updateSyncUI('error', t('import_failed_short'));
  }
  e.target.value = '';
  document.getElementById('importBookmarksModal').classList.add('hidden');
  document.getElementById('exportImportModal').classList.add('hidden');
}

async function exportDataToFile() {
  try {
    const data = await SyncManager.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dooby-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    updateSyncUI('success', t('exported'));
    setTimeout(() => updateSyncUI('idle', t('synced')), 3000);
  } catch (e) {
    console.error('Export failed:', e);
    updateSyncUI('error', t('export_failed'));
  }
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
  // Register event listeners BEFORE init so we don't miss events
  SyncManager.on('*', (event, data) => {
    switch (event) {
      case 'sync_start':
        updateSyncUI('syncing', t('syncing'));
        break;
      case 'sync_complete':
        updateSyncUI('success', t('synced'));
        updateStorageUsage();
        setTimeout(() => updateSyncUI('idle', t('synced')), 3000);
        break;
      case 'sync_error':
        updateSyncUI('error', data?.message || t('sync_failed'));
        // Keep error visible — only clear on next successful sync
        break;
      case 'data_updated':
        // Remote data was pulled from another device, refresh UI
        loadApp();
        updateStorageUsage();
        break;
    }
  });

  // Now init sync manager (may pull newer data from cloud)
  const pulled = await SyncManager.init();
  if (pulled) {
    // Sync had newer data, reload UI with updated data
    await loadApp();
  } else {
    // Check if cloud has more data than local — prompt user to sync
    await checkCloudDataPrompt();
  }

  // Listen for messages from background service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOOBY_SYNC_TRIGGER') {
      // Periodic sync: pull first, then push once the pull has finished so we
      // never push stale local data over newer cloud data.
      SyncManager.pullFromSync().then(async pulled => {
        if (pulled) await loadApp();
        await SyncManager.pushToSync();
      });
      if (typeof CloudManager !== 'undefined') CloudManager.poll();
    } else if (message.type === 'DOOBY_DATA_CHANGED') {
      // Data was changed externally (e.g. icon click save), refresh and sync
      loadApp();
      SyncManager.scheduleSyncAfterChange();
      if (typeof CloudManager !== 'undefined') CloudManager.scheduleSyncAfterChange();
    }
  });

  setupSyncEventListeners();
  updateStorageUsage();

  // Show the extension ID in the status tooltip. chrome.storage.sync is
  // namespaced by extension ID, so two devices only share data when this
  // ID is identical on both.
  const statusEl = document.getElementById('syncStatus');
  if (statusEl) {
    statusEl.title = 'Cloud sync via Chrome account\nExtension ID: ' + chrome.runtime.id + '\n(must be identical on every device)';
  }
}

async function checkCloudDataPrompt() {
  try {
    const syncData = await chrome.storage.sync.get('dooby_meta');
    if (!syncData['dooby_meta']) return;

    const meta = JSON.parse(syncData['dooby_meta']);
    const cloudTabCount = meta.tabCount || 0;

    const localCollections = await Storage.getCollections();
    const localTabCount = localCollections.reduce((sum, c) => sum + (c.tabs ? c.tabs.length : 0), 0);

    if (cloudTabCount > 0 && cloudTabCount > localTabCount) {
      // Cloud has more data — show prompt
      const desc = document.getElementById('cloudSyncDesc');
      desc.textContent = t('cloud_data_found_counts', { cloud: cloudTabCount, local: localTabCount });
      document.getElementById('cloudSyncPrompt').classList.remove('hidden');
    }
  } catch (e) {
    console.error('Dooby: Cloud data check failed:', e);
  }
}

function updateSyncUI(status, text) {
  const el = document.getElementById('syncStatus');
  const textEl = document.getElementById('syncStatusText');
  const led = document.getElementById('syncLed');

  el.classList.remove('syncing', 'success', 'error');
  led.classList.remove('led-green', 'led-red', 'led-yellow');

  if (status !== 'idle') {
    el.classList.add(status);
  }

  // Update LED
  switch (status) {
    case 'syncing':
      led.classList.add('led-yellow');
      break;
    case 'success':
      led.classList.add('led-green');
      break;
    case 'error':
      led.classList.add('led-red');
      break;
    default:
      led.classList.add('led-green'); // idle = last sync was ok
      break;
  }

  textEl.textContent = text;
}

async function updateStorageUsage() {
  try {
    const { bytesInUse, quota, percent } = await SyncManager.getUsage();
    const fill = document.getElementById('storageUsageFill');
    const text = document.getElementById('storageUsageText');
    const container = document.getElementById('storageUsage');

    fill.style.width = percent + '%';

    const kb = (bytesInUse / 1024).toFixed(1);
    const totalKb = (quota / 1024).toFixed(0);
    text.textContent = `${kb} / ${totalKb} KB`;

    container.classList.remove('usage-warning', 'usage-critical');
    if (percent >= 90) {
      container.classList.add('usage-critical');
      container.title = t('storage_almost_full', { percent });
    } else if (percent >= 70) {
      container.classList.add('usage-warning');
      container.title = t('storage_used', { percent });
    } else {
      container.title = t('storage_sync_used', { percent });
    }
  } catch (e) {
    console.error('Dooby: Failed to get storage usage:', e);
  }
}

// ============================================
// Donate / Donor / Theme System
// ============================================

function openDonateModal(tab) {
  document.getElementById('donateModal').classList.remove('hidden');
  switchDonateTab(tab || 'support');
  refreshDonateUI();
  renderThemeGrid();
  renderWallOfFame();
}

function switchDonateTab(tabId) {
  document.querySelectorAll('.donate-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  document.querySelectorAll('.donate-tab-content').forEach(c => {
    c.classList.toggle('active', c.dataset.tab === tabId);
  });
}

function refreshDonateUI() {
  const isActivated = DonorManager.isActivated();

  // Activate tab: show/hide forms
  document.getElementById('activateNotDonor').classList.toggle('hidden', isActivated);
  document.getElementById('activateIsDonor').classList.toggle('hidden', !isActivated);

  if (isActivated) {
    document.getElementById('donorDisplayName').textContent = DonorManager.getDonorName();
  }

  // Update heart button style for donors
  const heartBtn = document.getElementById('btnDonate');
  const vipBadge = document.getElementById('vipBadge');
  if (isActivated) {
    heartBtn.classList.add('donor-active');
    heartBtn.title = t('dooby_supporter');
    vipBadge.classList.remove('hidden');
  } else {
    heartBtn.classList.remove('donor-active');
    heartBtn.title = t('support_developer');
    vipBadge.classList.add('hidden');
  }
}

function renderThemeGrid() {
  const grid = document.getElementById('themeGrid');
  const themes = DonorManager.getThemeList();
  const avatarColors = ['#10b981', '#7c3aed', '#f97316', '#0ea5e9', '#ec4899'];

  grid.innerHTML = themes.map(t => {
    const colors = DonorManager.THEMES[t.id].colors;
    const swatches = [
      colors['--bg-primary'],
      colors['--bg-secondary'],
      colors['--accent'],
      colors['--accent-2']
    ];

    let badgeHtml = '';
    if (t.free) {
      badgeHtml = `<span class="theme-card-badge free">${I18n.t('theme_free')}</span>`;
    } else if (t.locked) {
      badgeHtml = `<span class="theme-card-badge premium">${I18n.t('theme_premium')}</span>`;
    } else {
      badgeHtml = `<span class="theme-card-badge unlocked">${I18n.t('theme_unlocked')}</span>`;
    }

    let statusIcon = '';
    if (t.active) {
      statusIcon = '<div class="theme-card-active-dot"></div>';
    } else if (t.locked) {
      statusIcon = '<span class="theme-lock-icon">🔒</span>';
    }

    return `
      <div class="theme-card ${t.active ? 'active' : ''} ${t.locked ? 'locked' : ''}"
           data-theme-id="${t.id}">
        ${statusIcon}
        <div class="theme-card-preview">
          ${swatches.map(c => `<div class="theme-color-swatch" style="background:${c}"></div>`).join('')}
        </div>
        <span class="theme-card-name">${t.name}</span>
        ${badgeHtml}
      </div>
    `;
  }).join('');

  // Click handlers
  grid.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', async () => {
      const themeId = card.dataset.themeId;
      const theme = DonorManager.THEMES[themeId];

      if (!theme.free && !DonorManager.isActivated()) {
        // Locked - switch to support tab
        switchDonateTab('support');
        return;
      }

      const success = await DonorManager.setTheme(themeId);
      if (success) {
        renderThemeGrid();
      }
    });
  });
}

function renderWallOfFame() {
  const container = document.getElementById('wallOfFame');
  const donors = DonorManager.WALL_OF_FAME;
  const avatarColors = ['#10b981', '#7c3aed', '#f97316', '#0ea5e9', '#ec4899', '#6366f1', '#14b8a6', '#f59e0b'];

  // Add current donor if activated and not already in list
  const allDonors = [...donors];
  if (DonorManager.isActivated()) {
    const donorName = DonorManager.getDonorName();
    if (!allDonors.find(d => d.name === donorName)) {
      allDonors.push({ name: donorName, date: t('wof_you'), message: '' });
    }
  }

  if (allDonors.length === 0) {
    container.innerHTML = `
      <div class="wof-empty">
        <div class="wof-empty-icon">🏆</div>
        <p>${t('wof_empty')}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = allDonors.map((d, i) => {
    const color = avatarColors[i % avatarColors.length];
    const initial = d.name.charAt(0).toUpperCase();
    return `
      <div class="wof-entry">
        <div class="wof-avatar" style="background:${color}">${initial}</div>
        <span class="wof-name">${d.name}</span>
        <span class="wof-date">${d.date}</span>
        ${d.message ? `<span class="wof-message">"${d.message}"</span>` : ''}
      </div>
    `;
  }).join('');
}

function setupSyncEventListeners() {
  // Upload to cloud button
  document.getElementById('btnCloudPush').addEventListener('click', () => {
    SyncManager.pushToSync();
  });

  // Sync from cloud button
  document.getElementById('btnCloudPull').addEventListener('click', async () => {
    updateSyncUI('syncing', t('pulling_from_cloud'));
    const pulled = await SyncManager.pullFromSync(true);
    if (pulled) {
      await loadApp();
      updateStorageUsage();
      updateSyncUI('success', t('synced_from_cloud'));
      setTimeout(() => updateSyncUI('idle', t('synced')), 3000);
    } else {
      updateSyncUI('idle', t('no_new_cloud_data'));
      setTimeout(() => updateSyncUI('idle', t('synced')), 3000);
    }
  });

  // Cloud sync prompt buttons
  document.getElementById('btnCloudSyncYes').addEventListener('click', async () => {
    document.getElementById('cloudSyncPrompt').classList.add('hidden');
    const pulled = await SyncManager.pullFromSync(true);
    if (pulled) {
      await loadApp();
      updateStorageUsage();
      updateSyncUI('success', t('synced_from_cloud'));
      setTimeout(() => updateSyncUI('idle', t('synced')), 3000);
    }
  });

  document.getElementById('btnCloudSyncNo').addEventListener('click', () => {
    document.getElementById('cloudSyncPrompt').classList.add('hidden');
  });

  // Export data to JSON file
  document.getElementById('btnExportData').addEventListener('click', exportDataToFile);

  // Import data from JSON file
  document.getElementById('btnImportData').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });

  document.getElementById('importFileInput').addEventListener('change', handleImportFileChange);

  // Donate modal open/close
  document.getElementById('btnDonate').addEventListener('click', () => {
    openDonateModal('support');
  });

  document.getElementById('btnCloseDonate').addEventListener('click', () => {
    document.getElementById('donateModal').classList.add('hidden');
  });

  // Theme button opens donate modal on Themes tab
  document.getElementById('btnTheme').addEventListener('click', () => {
    openDonateModal('themes');
  });

  // Donate tab switching
  document.querySelectorAll('.donate-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchDonateTab(tab.dataset.tab);
    });
  });

  // "Switch to tab" buttons inside content
  document.querySelectorAll('[data-switch-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchDonateTab(btn.dataset.switchTab);
    });
  });

  // Copy address
  document.getElementById('btnCopyAddress').addEventListener('click', () => {
    const address = document.getElementById('donateAddress').textContent;
    navigator.clipboard.writeText(address).then(() => {
      const btn = document.getElementById('btnCopyAddress');
      const original = btn.innerHTML;
      btn.innerHTML = t('copied');
      btn.style.color = 'var(--accent)';
      setTimeout(() => {
        btn.innerHTML = original;
        btn.style.color = '';
      }, 2000);
    });
  });

  // Activate donor code
  document.getElementById('btnActivate').addEventListener('click', async () => {
    const name = document.getElementById('activateName').value.trim();
    const code = document.getElementById('activateCode').value.trim();
    const errorEl = document.getElementById('activateError');

    if (!name) {
      errorEl.textContent = t('enter_display_name');
      errorEl.classList.remove('hidden');
      return;
    }
    if (!code) {
      errorEl.textContent = t('enter_activation_code');
      errorEl.classList.remove('hidden');
      return;
    }

    const result = await DonorManager.activate(code, name);
    if (result.success) {
      errorEl.classList.add('hidden');
      refreshDonateUI();
      renderThemeGrid();
    } else {
      errorEl.textContent = result.error;
      errorEl.classList.remove('hidden');
    }
  });

  // Deactivate
  document.getElementById('btnDeactivate').addEventListener('click', async () => {
    if (confirm(t('deactivate_confirm'))) {
      await DonorManager.deactivate();
      await DonorManager.setTheme('midnight');
      refreshDonateUI();
      renderThemeGrid();
    }
  });

  // Export/Import modal
  document.getElementById('btnExportImport').addEventListener('click', () => {
    document.getElementById('exportImportModal').classList.remove('hidden');
  });

  document.getElementById('btnCloseExportImport').addEventListener('click', () => {
    document.getElementById('exportImportModal').classList.add('hidden');
  });

  // Export / Import (same functions as the top-bar buttons)
  document.getElementById('btnExportDataModal').addEventListener('click', async () => {
    await exportDataToFile();
    document.getElementById('exportImportModal').classList.add('hidden');
  });
  document.getElementById('importBackupInput').addEventListener('change', handleImportFileChange);
}


// ============================================
// Dooby Cloud (Google sign-in + Supabase)
// ============================================

// ============================================
// Version (Settings footer + logo tooltip)
// ============================================

function showAppVersion() {
  let version = '';
  try { version = chrome.runtime.getManifest().version || ''; } catch (e) {}
  const label = version ? `Dooby v${version}` : 'Dooby';
  const el = document.getElementById('appVersion');
  if (el) el.textContent = label;
  const logo = document.getElementById('logoText');
  if (logo) logo.title = label;
}

// ============================================
// Settings
// ============================================

async function openSettingsModal() {
  appSettings = await Storage.getSettings();
  document.getElementById('settingLanguage').value = appSettings.language || 'auto';
  document.getElementById('settingCloseTab').checked = appSettings.closeTabAfterSave !== false;
  document.getElementById('settingCollectionSort').value = appSettings.collectionSort || 'manual';
  document.getElementById('settingTabSort').value = appSettings.tabSort || 'manual';

  // Quick-save target: every collection, grouped by space.
  const select = document.getElementById('settingQuickSave');
  select.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = t('quick_save_auto');
  select.appendChild(auto);
  const spaces = await Storage.getSpaces();
  const collections = await Storage.getCollections();
  for (const space of spaces) {
    const group = document.createElement('optgroup');
    group.label = space.name;
    for (const c of collections.filter(c => c.spaceId === space.id)) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      group.appendChild(opt);
    }
    if (group.children.length) select.appendChild(group);
  }
  const wanted = appSettings.quickSaveCollectionId || '';
  select.value = collections.some(c => c.id === wanted) ? wanted : '';
  document.getElementById('settingsModal').classList.remove('hidden');
}

function setupSettingsListeners() {
  document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
  const modal = document.getElementById('settingsModal');
  document.getElementById('btnCloseSettings').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  const apply = async (patch, rerender) => {
    appSettings = await Storage.saveSettings(patch);
    if (rerender) await renderCollections();
  };
  document.getElementById('settingLanguage').addEventListener('change', async (e) => {
    appSettings = await Storage.saveSettings({ language: e.target.value });
    await I18n.load(appSettings.language);
    I18n.applyToDom();
    await loadApp();
    refreshDonateUI();
    refreshCloudUI();
    updateSyncUI('idle', t('synced'));
    updateStorageUsage();
    await openSettingsModal();
  });
  document.getElementById('settingCloseTab').addEventListener('change', (e) => apply({ closeTabAfterSave: e.target.checked }, false));
  document.getElementById('settingQuickSave').addEventListener('change', (e) => apply({ quickSaveCollectionId: e.target.value }, false));
  document.getElementById('settingCollectionSort').addEventListener('change', (e) => apply({ collectionSort: e.target.value }, true));
  document.getElementById('settingTabSort').addEventListener('change', (e) => apply({ tabSort: e.target.value }, true));
}

async function initCloud() {
  if (typeof CloudManager === 'undefined') return;

  CloudManager.on('*', async (event, data) => {
    switch (event) {
      case 'data_updated':
        await loadApp();
        break;
      case 'sync_error':
        updateSyncUI('error', data?.message || t('cloud_sync_failed'));
        break;
      case 'sync_complete':
        if (CloudManager.isSignedIn()) {
          updateSyncUI('success', t('synced'));
          setTimeout(() => updateSyncUI('idle', t('synced')), 3000);
        }
        break;
    }
    refreshCloudUI();
  });

  const pulled = await CloudManager.init();
  if (pulled) await loadApp();
  refreshCloudUI();

  document.getElementById('btnAccount').addEventListener('click', () => {
    refreshCloudUI();
    document.getElementById('cloudModal').classList.remove('hidden');
  });
  // The toolbar sync indicator opens the same dialog (Chrome sync controls live there now).
  const openCloud = () => { refreshCloudUI(); document.getElementById('cloudModal').classList.remove('hidden'); };
  document.getElementById('syncStatus').addEventListener('click', openCloud);
  document.getElementById('syncStatus').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCloud(); } });
  document.getElementById('btnCloseCloud').addEventListener('click', () => {
    document.getElementById('cloudModal').classList.add('hidden');
  });
  document.getElementById('cloudModal').addEventListener('click', (e) => {
    if (e.target.id === 'cloudModal') document.getElementById('cloudModal').classList.add('hidden');
  });

  document.getElementById('btnCloudSignIn').addEventListener('click', async () => {
    const btn = document.getElementById('btnCloudSignIn');
    const err = document.getElementById('cloudSignInError');
    err.classList.add('hidden');
    btn.disabled = true;
    try {
      await CloudManager.signIn();
      await loadApp();
    } catch (e) {
      err.textContent = e.message || t('sign_in_failed');
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      refreshCloudUI();
    }
  });

  document.getElementById('btnCloudSignOut').addEventListener('click', async () => {
    await CloudManager.signOut();
    refreshCloudUI();
  });

  document.getElementById('btnCloudSyncNow').addEventListener('click', async () => {
    const err = document.getElementById('cloudError');
    err.classList.add('hidden');
    updateSyncUI('syncing', t('syncing'));
    try {
      const pulled = await CloudManager.pull(true);
      if (pulled) await loadApp();
      await CloudManager.push();
    } catch (e) {
      err.textContent = e.message; err.classList.remove('hidden');
    }
    refreshCloudUI();
  });

  document.getElementById('btnCloudDelete').addEventListener('click', async () => {
    if (!confirm(t('delete_cloud_confirm'))) return;
    const err = document.getElementById('cloudError');
    err.classList.add('hidden');
    try {
      await CloudManager.deleteRemote();
      await CloudManager.signOut();
    } catch (e) {
      err.textContent = e.message; err.classList.remove('hidden');
    }
    refreshCloudUI();
  });
}

function refreshCloudUI() {
  if (typeof CloudManager === 'undefined') return;
  const st = CloudManager.getStatus();
  const btn = document.getElementById('btnAccount');
  const avatar = document.getElementById('accountAvatar');

  document.getElementById('cloudNotConfigured').classList.toggle('hidden', st.configured);
  document.getElementById('cloudSignedOut').classList.toggle('hidden', !st.configured || st.signedIn);
  document.getElementById('cloudSignedIn').classList.toggle('hidden', !st.configured || !st.signedIn);
  document.querySelectorAll('#cloudModal .cloud-only').forEach(el => el.classList.toggle('hidden', !(st.configured && st.signedIn)));

  if (st.signedIn && st.user) {
    btn.classList.add('signed-in');
    btn.title = t('account_title_signed_in', { user: st.user.email || st.user.name });
    if (st.user.avatar) { avatar.src = st.user.avatar; avatar.classList.remove('hidden'); } else { avatar.classList.add('hidden'); }
    document.getElementById('cloudAvatar').src = st.user.avatar || '';
    document.getElementById('cloudName').textContent = st.user.name || '';
    document.getElementById('cloudEmail').textContent = st.user.email || '';
    const when = st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString() : t('never');
    const info = document.getElementById('cloudSyncInfo');
    info.textContent = st.lastError ? t('last_error', { error: st.lastError }) : t('last_synced', { when });
    info.classList.toggle('error', !!st.lastError);
    document.getElementById('cloudWebAppLink').href = (typeof DoobyConfig !== 'undefined' && DoobyConfig.webAppUrl) || '#';
  } else {
    btn.classList.remove('signed-in');
    btn.title = st.configured ? t('account_title') : t('account_title_disabled');
    avatar.classList.add('hidden');
  }
}
