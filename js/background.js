// Background service worker for Tooby

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
  chrome.alarms.create('tooby-sync', { periodInMinutes: 5 });
});

// Periodic sync alarm handler
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tooby-sync') {
    const { syncUser } = await chrome.storage.local.get('syncUser');
    if (!syncUser) return;

    // Notify any open new tab pages to sync
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && tab.url.includes('newtab.html')) {
        try {
          chrome.tabs.sendMessage(tab.id, { type: 'TOOBY_SYNC_TRIGGER' });
        } catch (e) {
          // Tab might not have content script
        }
      }
    }
  }
});

// Ensure sync alarm exists on startup
chrome.alarms.get('tooby-sync', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('tooby-sync', { periodInMinutes: 5 });
  }
});
