// Background service worker for Dooby

importScripts('build-flags.js', 'platform.js', 'config.js', 'datalock.js', 'cloud.js');

// Send a message to any open Dooby new tab pages. When none are open,
// chrome.runtime.sendMessage rejects with "Receiving end does not exist";
// that is expected, so swallow it instead of surfacing an uncaught rejection.
async function notifyNewTabPages(type) {
  try {
    await chrome.runtime.sendMessage({ type });
  } catch (e) {
    // No listeners available
  }
}

// Save a browser tab into the quick-save collection of the active space.
// Exposed as a plain function so it can be exercised from tests.
async function saveTabToQuickSave(tab) {
  // Only save real web pages (skip chrome://, extension pages, about:blank, etc.)
  if (!tab || !tab.url || !/^(https?|ftp|file):/i.test(tab.url)) {
    console.warn('Dooby: not saving non-web page', tab && tab.url);
    return false;
  }

  const { activeSpaceId, settings = {} } = await chrome.storage.local.get(['activeSpaceId', 'settings']);
  // Runs under the shared data lock so a save from the toolbar can never be
  // overwritten by an edit happening at the same moment in a Dooby tab.
  const saved = await DoobyData.mutate(['spaces', 'collections'], ({ spaces, collections }) => {
    if (spaces.length === 0) return DoobyData.unchanged(null);

    // Prefer the space the user is currently viewing, fall back to the first one.
    let space = spaces.find(s => s.id === activeSpaceId) || spaces[0];

    // 1. A collection the user picked in Settings (any space), if it still exists.
    // 2. Otherwise a collection named "Quick Save" (or the original default id)
    //    in the active space, then the first collection in it.
    // 3. Otherwise create one in the active space.
    let target = settings.quickSaveCollectionId ? collections.find(c => c.id === settings.quickSaveCollectionId) : null;
    if (target) {
      space = spaces.find(s => s.id === target.spaceId) || space;
    } else {
      target = collections.find(c => c.spaceId === space.id && (c.id === 'col-quicksave' || /^quick save$/i.test(c.name || '')))
        || collections.find(c => c.spaceId === space.id);
    }
    if (!target) {
      target = { id: DoobyData.newId('col'), spaceId: space.id, name: 'Quick Save', tabs: [], createdAt: Date.now() };
      collections.push(target);
    }
    if (!Array.isArray(target.tabs)) target.tabs = [];

    target.tabs.push({
      id: DoobyData.newId('tab'),
      title: tab.title || 'Untitled',
      url: tab.url,
      favicon: tab.favIconUrl || '',
      addedAt: Date.now()
    });
    return { space, target };
  });
  if (!saved) {
    console.warn('Dooby: no spaces exist, cannot quick-save');
    return false;
  }
  const { space, target } = saved;

  console.log('Dooby: quick-saved "' + (tab.title || tab.url) + '" into "' + target.name + '" (' + space.name + ')');

  // Notify any open new tab pages to refresh and sync
  await notifyNewTabPages('DOOBY_DATA_CHANGED');
  return true;
}

// When the extension icon is clicked, save the current tab and (unless
// turned off in Settings) close it. Plain function so tests can call it.
async function handleActionClick(tab) {
  try {
    const saved = await saveTabToQuickSave(tab);
    if (saved && tab.id !== undefined) {
      const { settings = {} } = await chrome.storage.local.get('settings');
      if (settings.closeTabAfterSave !== false) await chrome.tabs.remove(tab.id);
    }
    return saved;
  } catch (e) {
    console.error('Dooby: quick-save failed:', e);
    return false;
  }
}
chrome.action.onClicked.addListener(handleActionClick);

// Initialize default data on install
chrome.runtime.onInstalled.addListener(async () => {
  const { spaces } = await chrome.storage.local.get('spaces');
  if (spaces && spaces.length > 0) return;

  const defaultSpace = {
    id: 'space-default',
    name: 'My Space',
    createdAt: Date.now()
  };

  const defaultCollections = [
    {
      id: 'col-quicksave',
      spaceId: 'space-default',
      name: 'Quick Save',
      tabs: [],
      createdAt: Date.now()
    },
    {
      id: 'col-work',
      spaceId: 'space-default',
      name: 'Work',
      tabs: [],
      createdAt: Date.now()
    },
    {
      id: 'col-reading',
      spaceId: 'space-default',
      name: 'Reading List',
      tabs: [],
      createdAt: Date.now()
    }
  ];

  await chrome.storage.local.set({
    spaces: [defaultSpace],
    collections: defaultCollections,
    activeSpaceId: 'space-default'
  });

  // Set up periodic sync alarm (every 5 minutes)
  chrome.alarms.create('dooby-sync', { periodInMinutes: 5 });
});

// Periodic sync alarm handler
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'dooby-sync') {
    // Notify any open new tab pages to sync
    await notifyNewTabPages('DOOBY_SYNC_TRIGGER');
  }
});

// Ensure sync alarm exists on startup
chrome.alarms.get('dooby-sync', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('dooby-sync', { periodInMinutes: 5 });
  }
});

// Safari: Dooby Cloud sign-in happens on the web app (no chrome.identity), and
// js/ext-link.js forwards the resulting session here. CloudManager checks the
// one-time nonce and the sender before storing anything.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'DOOBY_CLOUD_LINK') return false;
  const senderUrl = (sender && (sender.url || (sender.tab && sender.tab.url))) || '';
  CloudManager.acceptLinkedSession(message, senderUrl).then(
    (result) => {
      sendResponse(result);
      // Close the sign-in tab shortly after it has shown its "linked" message.
      if (sender && sender.tab && sender.tab.id != null) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 2500);
    },
    (err) => sendResponse({ ok: false, error: (err && err.message) || String(err) })
  );
  return true; // respond asynchronously
});
