// Background service worker for Dooby

// When the extension icon is clicked, save the current tab to the default collection
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }

  const { spaces } = await chrome.storage.local.get('spaces');
  if (!spaces || spaces.length === 0) return;

  const activeSpaceId = spaces[0].id;
  const { collections } = await chrome.storage.local.get('collections');
  if (!collections) return;

  const spaceCollections = collections.filter(c => c.spaceId === activeSpaceId);
  if (spaceCollections.length === 0) return;

  // Add to first collection (Quick Save)
  const targetCollection = spaceCollections[0];
  const newTab = {
    id: Date.now().toString(),
    title: tab.title || 'Untitled',
    url: tab.url,
    favicon: tab.favIconUrl || '',
    addedAt: Date.now()
  };

  targetCollection.tabs.push(newTab);
  await chrome.storage.local.set({ collections });
  await chrome.storage.local.set({ localUpdateTime: Date.now() });

  // Notify any open new tab pages to refresh and sync
  try {
    chrome.runtime.sendMessage({ type: 'DOOBY_DATA_CHANGED' });
  } catch (e) {
    // No listeners available
  }

  // Close the saved tab
  chrome.tabs.remove(tab.id);
});

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
    try {
      chrome.runtime.sendMessage({ type: 'DOOBY_SYNC_TRIGGER' });
    } catch (e) {
      // No listeners available
    }
  }
});

// Ensure sync alarm exists on startup
chrome.alarms.get('dooby-sync', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('dooby-sync', { periodInMinutes: 5 });
  }
});
