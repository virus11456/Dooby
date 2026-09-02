# Dooby - Tab & Bookmark Manager

> **v1.1.4** — A beautiful Chrome extension that replaces your new tab with a visual workspace for organizing tabs and bookmarks into collections. **Better than bookmarks.**

---

## Features

- **Spaces** — Separate workspaces (Work, Personal, Side Project...)
- **Collections** — Organize tabs into named groups within each space
- **Drag & Drop** — Drag open tabs from the sidebar into any collection
- **Session Save** — Save all open tabs as a collection with one click
- **Search** — Instantly search across all saved tabs (`Ctrl+K`)
- **Cloud Sync** — Auto-sync via your Chrome account across devices
- **Pin** — Pin important collections or individual tabs to the top
- **Bulk Actions** — Select multiple tabs to move or delete at once
- **Import** — Import from Chrome bookmarks (HTML), Toby, TabMe, or JSON
- **Export / Import** — Full JSON backup & restore
- **Duplicate Finder** — Detect and remove duplicate URLs
- **Themes** — 5 color themes (1 free + 4 premium for supporters)
- **Donation System** — Support development & unlock premium themes

---

## Installation

### Step 1: Download

**Option A — Git Clone:**
```bash
git clone https://github.com/virus11456/Dooby.git
```

**Option B — Download ZIP:**
1. Click the green **Code** button on this page
2. Click **Download ZIP**
3. Unzip the file to a folder you'll keep (e.g. `Desktop/Dooby`)

### Step 2: Load into Chrome

1. Open Chrome and type `chrome://extensions/` in the address bar, press Enter
2. Turn on **Developer mode** (toggle switch in the **top-right** corner)
3. Click the **Load unpacked** button (top-left)
4. Select the `Dooby` folder (the one containing `manifest.json`)
5. Done! Open a **new tab** to see Dooby

> **Tip:** After loading, you can pin Dooby's icon in the Chrome toolbar by clicking the puzzle icon (Extensions) and then the pin icon next to Dooby.

### Step 3: (Optional) Enable Sync

Dooby uses **Chrome's built-in sync storage** — no Firebase or external server needed.

- Make sure you're **signed in to Chrome** (`chrome://settings/people`)
- Make sure **Chrome Sync** is turned on (Settings > Sync and Google services > Manage what you sync > Extensions = ON)
- Your data will automatically sync across all Chrome browsers signed into the same Google account

---

## How to Use

### Basic Workflow

| Action | How |
|---|---|
| **Create a Space** | Click the `+` button in the left sidebar |
| **Switch Space** | Click on a space name in the sidebar |
| **Create a Collection** | Click **"Add Collection"** in the content header |
| **Save open tabs** | Drag tabs from the right sidebar into a collection |
| **Save all tabs** | Click **"Save Session"** button in the top bar |
| **Search** | Press `Ctrl+K` or click the search bar |
| **Rename** | Double-click any collection or space name |
| **Delete** | Right-click a collection > Delete |
| **Open all tabs** | Click the open-all icon on a collection header |
| **Pin collection** | Right-click a collection > Pin |
| **Bulk select** | Right-click a collection > Select tabs, then use the bottom action bar |

### Import Bookmarks

1. Click **"Import Bookmarks"** in the content header
2. Choose your format:
   - **HTML** — Export from Chrome (`chrome://bookmarks/` > three dots > Export bookmarks)
   - **JSON** — Dooby, Toby, or TabMe format
3. Each bookmark folder becomes a collection

### Export / Import Backup

1. Click the **arrow icon** in the top bar (Export/Import)
2. **Export**: Downloads a `.json` backup file
3. **Import**: Upload a previously exported `.json` file

### Themes & Donation

1. Click the **half-moon icon** (theme) or the **heart icon** (donate) in the top bar
2. Free theme: **Midnight** (default dark theme)
3. Premium themes: **Aurora**, **Sunset**, **Ocean**, **Sakura** — unlocked by donating
4. Donate **$1 USDT (TRC-20)** to support development and unlock all premium features

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Focus search bar |
| `Escape` | Close search / modal / cancel bulk select |
| `Enter` | Confirm rename |

---

## Cloud Sync Details

- **Storage**: Uses `chrome.storage.sync` (Chrome's native sync, tied to your Google account)
- **Capacity**: 100 KB total (shown in the storage usage indicator in the top bar)
- **Auto-sync**: Pushes changes 2 seconds after any edit
- **Cross-device**: Works on any Chrome browser signed into the same Google account
- **No server needed**: Everything goes through Chrome's built-in infrastructure
- **Offline**: Works fully offline; syncs when back online

---

## Support Development

If you enjoy Dooby, consider buying the developer a coffee!

**USDT (TRC-20):** `TATQGiRcFx14XGv2kBVmxQWwDENZwFSnap`

**Just $1** gets you:
- Your name in the **Wall of Fame**
- **4 premium color themes** (Aurora, Sunset, Ocean, Sakura)
- **Early access** to new features
- **Priority feature requests**

After donating, DM the developer with your **name + TX hash** to receive your activation code.

---

## Project Structure

```
Dooby/
├── manifest.json           # Chrome Extension Manifest V3
├── css/
│   └── newtab.css          # All styles (themes, layout, components)
├── js/
│   ├── background.js       # Service worker (click-to-save, init)
│   ├── storage.js          # Local storage abstraction layer
│   ├── sync.js             # Chrome sync with chunking
│   ├── donor.js            # Donor system, themes, Wall of Fame
│   ├── dragdrop.js         # Drag and drop manager
│   └── newtab.js           # Main application logic
├── pages/
│   └── newtab.html         # New tab dashboard
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (zero dependencies, no frameworks)
- Chrome Storage API (local + sync)
- Chrome Tabs API
- Pure CSS with custom properties for theming

---

## Updating

When a new version is available:

1. Pull the latest code (`git pull`) or download the new ZIP
2. Go to `chrome://extensions/`
3. Click the **refresh icon** on the Dooby card
4. Open a new tab — you're updated!

> Your data is safe — it's stored in Chrome's storage, not in the extension files.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| New tab doesn't show Dooby | Make sure the extension is enabled on `chrome://extensions/` |
| Sync not working | Check that you're signed into Chrome and sync is enabled for Extensions |
| Storage almost full | Use the Export feature to backup, then clean up unused collections |
| Themes not unlocking | Make sure you entered the activation code correctly in the Activate tab |
| Extension disappeared after Chrome update | Re-load the unpacked extension from `chrome://extensions/` |

---

## License

MIT

---

## Changelog

### v1.1.4 (2026-09-02)
- **Fix:** Cloud sync push failing with `QUOTA_BYTES_PER_ITEM` — chunks were sized by string length, but Chrome measures key + JSON-escaped UTF-8 bytes. Non-ASCII titles (Chinese, Japanese, emoji) and escaped quotes pushed 7000-char chunks past the 8 KB limit, so every push failed once you had ~25+ tabs
- **Fix:** Legacy `dooby_collections` key was written whenever the JSON was under 8000 chars, which also exceeded 8 KB after escaping; it is now only written when it really fits and is removed otherwise
- **Fix:** Total 100 KB quota check now measured in bytes the way Chrome does
- **Fix:** Periodic sync now waits for the pull to finish before pushing
- **Improve:** Clearer sync error messages (per-item vs total quota vs write-rate limits)

### v1.1.3 (2026-03-17)
- **New:** Add Domain5566 to Wall of Fame as first donor

### v1.1.2 (2026-03-17)
- **Fix:** Root cause of cloud sync failure — `onChanged` listener now properly pulls sync data into local storage before refreshing UI
- **Fix:** Added `force` flag to `pullFromSync()` to bypass timestamp check when receiving confirmed remote changes (prevents clock skew issues)

### v1.1.1 (2026-03-17)
- **Fix:** Remove unused `sessions` permission (Chrome Web Store review rejection)
- **Fix:** Initial sync pull now correctly refreshes UI on startup
- **Fix:** Sync push race condition — data writes are now atomic
- **Fix:** Background worker message delivery switched to `chrome.runtime.sendMessage`
- **Fix:** Sync error status no longer auto-clears to "Synced" — stays visible until next success

### v1.1.0 (2026-03-11)
- **New:** Cloud sync via `chrome.storage.sync` (auto-sync across Chrome devices)
- **New:** Storage usage indicator in top bar
- **New:** Manual sync button
- **New:** Export / Import JSON backup
- **New:** Donor system with activation codes
- **New:** 5 color themes (Midnight free + 4 premium)
- **New:** Wall of Fame for supporters
- **New:** Privacy policy page

### v1.0.0
- Initial release
- Spaces, Collections, Drag & Drop
- Session Save, Search, Pin, Bulk Actions
- Chrome bookmark import (HTML / JSON)
