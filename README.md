# Dooby - Tab & Bookmark Manager

> **v1.2.0** — A beautiful Chrome extension that replaces your new tab with a visual workspace for organizing tabs and bookmarks into collections. **Better than bookmarks.**

---

## Features

- **Spaces** — Separate workspaces (Work, Personal, Side Project...)
- **Collections** — Organize tabs into named groups within each space
- **Drag & Drop** — Drag open tabs from the sidebar into any collection
- **Session Save** — Save all open tabs as a collection with one click
- **Search** — Instantly search across all saved tabs (`Ctrl+K`)
- **Cloud Sync** — Auto-sync via your Chrome account across desktop Chromes
- **Dooby Cloud** — Optional Google sign-in; bookmarks stored in Supabase so the web app can use them on iPad, iPhone and any browser (no 100 KB limit)
- **Pin** — Pin important collections or individual tabs to the top
- **Settings** — Close tab after saving on/off, quick-save target collection, collection and tab sort order
- **Languages** — English and 繁體中文 (auto-detected, or pick one in Settings)
- **Undo** — Deleted tabs, collections and spaces can be restored from a toast
- **Bulk Actions** — Select multiple tabs to move or delete at once
- **Import** — Import from Chrome bookmarks (HTML), Toby, TabMe, or JSON
- **Export / Import** — Full JSON backup & restore
- **Duplicate Finder** — Detect and remove duplicate URLs
- **Themes** — 6 color themes (Midnight + Daylight light theme free, 4 premium for supporters)
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

## Publishing to the Chrome Web Store

```bash
scripts/build-store-zip.sh          # writes dist/dooby-<version>-webstore.zip
```

The script strips the `key` field (the store rejects a first upload that contains it and assigns its own ID) and leaves out repo-only files. Upload the zip in the Developer Dashboard, fill in the Privacy tab (single purpose: tab & bookmark manager; `tabs` is used to read open tab titles/URLs the user chooses to save; `storage`/`alarms` for local data and periodic sync), and point the privacy policy field at a public copy of `privacy-policy.html`. "Unlisted" visibility is enough for personal use across devices.

Once installed from the store, every device shares the store's extension ID, so cross-device sync works without the manifest `key`. Store installs and unpacked installs have different IDs and do not share data: export before switching, import after.

---

## Issuing Donor Activation Codes

```bash
export DOOBY_ACTIVATION_KEY=~/.dooby/activation-key.pem   # developer's private key, never committed
node scripts/gen-activation-code.js "Donor Name"
```

The code is an ECDSA P-256 signature of the normalized display name (lowercased, whitespace removed). The extension verifies it against `DonorManager.ACTIVATION_PUBLIC_KEY` in `js/donor.js`, so a code only works together with the name it was issued for and cannot be forged from the public source. To rotate keys, generate a new pair, replace the JWK in `js/donor.js`, and re-issue codes.

---

## Dooby Cloud (Google sign-in)

Dooby Cloud is optional. When enabled, the account button in the top bar lets a user sign in with Google; their spaces and collections are then stored as one JSON document per user in a Supabase table protected by Row Level Security, and kept in step with local storage (debounced push after edits, poll every minute and on tab focus, last-writer-wins by `updatedAt`, union-merge on first sign-in). `chrome.storage.sync` keeps working alongside it.

The extension talks to Supabase with plain `fetch()` (no SDK, no remote code) and signs in through `chrome.identity.launchWebAuthFlow` → Google OAuth (`response_type=id_token`) → Supabase `signInWithIdToken`.

### One-time setup

1. **Supabase**: create a free project at supabase.com. In *SQL Editor* run `supabase/schema.sql`. Note *Project Settings → API*: the project URL and the `anon` public key.
2. **Google OAuth client**: Google Cloud Console → *APIs & Services → Credentials → Create credentials → OAuth client ID → Web application*. Add these **Authorized redirect URIs**:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - `https://pjbjldjdeaiffdbehpmbndjaiehcoahg.chromiumapp.org/` (store install)
   - `https://dfoidibckihcnmakgoabkebinahggked.chromiumapp.org/` (unpacked install)
   Add `https://toolist.cc` under **Authorized JavaScript origins** (for the web app). Note the client ID and secret.
3. **Supabase → Authentication → Providers → Google**: enable, paste the client ID and secret.
4. Fill `js/config.js` (`supabaseUrl`, `supabaseAnonKey`, `googleClientId`). These are public identifiers; the private data stays behind RLS.
5. Rebuild the store zip.

While `js/config.js` is empty the account button explains that Dooby Cloud is not enabled and nothing else changes.

---

## Cloud Sync Details

- **Storage**: Uses `chrome.storage.sync` (Chrome's native sync, tied to your Google account)
- **Extension ID**: Sync data is namespaced by extension ID. `manifest.json` carries a fixed `key`, so every unpacked install gets the same ID (`dfoidibckihcnmakgoabkebinahggked`). Hover the sync status in the top bar to see the ID on a device — it must match on all of them
- **Capacity**: 100 KB total (shown in the storage usage indicator in the top bar)
- **Auto-sync**: Pushes changes 2 seconds after any edit
- **Cross-device**: Works on any Chrome browser signed into the same Google account
- **No server needed**: Everything goes through Chrome's built-in infrastructure
- **Offline**: Works fully offline; syncs when back online

---

## Support Development

If you enjoy Dooby, consider buying the developer a coffee!

**USDT (TRC-20):** `TMx7ja4r3WGFcnwKNqAVogY91XRgGaQA1q`

**Just $1** gets you:
- Your name in the **Wall of Fame**
- **4 premium color themes** (Aurora, Sunset, Ocean, Sakura)
- **Early access** to new features
- **Priority feature requests**

After donating, DM the developer with your **name + TX hash** to receive your activation code.

---

## Testing

The test suite runs the extension in a real Chromium (Playwright, new headless mode) plus a few pure-Node unit tests. It runs on every push through GitHub Actions (`.github/workflows/test.yml`).

```bash
npm ci
npx playwright install --with-deps chromium   # first time only
npm test            # everything
npm run test:unit   # VM-level tests of js/sync.js (fast)
npm run test:e2e    # Chromium tests
node tests/run-all.js cloud   # only files whose name contains "cloud"
```

| File | What it proves |
|------|----------------|
| `tests/unit/sync-chunking.test.js` | 100 KB / 8 KB per-item quota rules are honoured for English, Chinese and emoji titles; stale chunks are cleaned; the chunker never splits a surrogate pair |
| `tests/unit/sync-errors.test.js` | Chrome's real `Resource::kQuota…` error strings map to readable messages |
| `tests/e2e/sync.test.js` | 100 Chinese-titled tabs push through the real `chrome.storage.sync` and pull back on a wiped profile |
| `tests/e2e/add-bookmark.test.js` | Drag from favicon, drop on the card header, toolbar quick save (closes the tab), quick save into an empty space, non-web URLs refused |
| `tests/e2e/background.test.js` | The periodic alarm leaves no unhandled rejection when no Dooby page is open |
| `tests/e2e/extension-id.test.js` | The `key` in `manifest.json` yields the same extension ID from two different folders |
| `tests/e2e/donor.test.js` | Activation codes: forged/old codes rejected, wrong name rejected, valid code activates and survives reload (uses a throw-away key pair, never the real private key) |
| `tests/e2e/cloud.test.js` | Dooby Cloud against a mock Supabase (`tests/mock-supabase.js`): two devices sign in with the same Google account, merge, push/poll, token refresh, sign-out, delete, and row-level isolation |

Set `DOOBY_CHROME=/path/to/chrome` to test against a different Chromium build.

## Project Structure

```
Dooby/
├── manifest.json           # Chrome Extension Manifest V3
├── css/
│   └── newtab.css          # All styles (themes, layout, components)
├── _locales/               # UI strings: en, zh_TW (Chrome i18n format)
├── js/
│   ├── background.js       # Service worker (click-to-save, init)
│   ├── i18n.js             # Loads _locales, t('key'), data-i18n attributes
│   ├── config.js           # Dooby Cloud endpoints (Supabase URL, Google client ID)
│   ├── storage.js          # Local storage abstraction layer
│   ├── sync.js             # Chrome sync with chunking
│   ├── cloud.js            # Dooby Cloud (Google sign-in, Supabase sync)
│   ├── donor.js            # Donor system, themes, Wall of Fame
│   ├── dragdrop.js         # Drag and drop manager
│   └── newtab.js           # Main application logic
├── pages/
│   └── newtab.html         # New tab dashboard
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/                # Store zip build, activation-code generator
├── supabase/schema.sql     # Dooby Cloud table + RLS policies
├── tests/                  # Unit + Playwright/Chromium tests (npm test)
├── .github/workflows/      # CI: runs the test suite on every push
└── index.html, changelog.html, privacy-policy.html, vercel.json   # toolist.cc website
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

### v1.5.1 (2026-09-07)
- **Fix:** TabMe / Toby / Chrome-bookmark JSON can now be imported from every entry point (toolbar Import button, Export / Import dialog, Import Bookmarks dialog); previously only the last one detected formats and the others failed with "Invalid import data"
- **Fix:** Duplicate element ids made the toolbar Export button download twice and the dialog's Export button do nothing
- **Improve:** Import success is a toast; invalid JSON gets a clear message

### v1.5.0 (2026-09-07)
- **New:** Undo toast after removing a tab, bulk-deleting, or deleting a collection or space (restores at the original position)
- **New:** Free "Daylight" light theme

### v1.4.0 (2026-09-07)
- **New:** Traditional Chinese (zh_TW) UI. Follows the browser language by default; pick English / 繁體中文 in Settings. Messages live in `_locales/` (Chrome i18n format, so the store listing name/description localize too); `js/i18n.js` applies them via `data-i18n` attributes and `t('key')`

### v1.3.0 (2026-09-07)
- **New:** Settings modal (gear button in the top bar): close tab after saving on/off, quick-save target collection, collection sort (name / newest / oldest / tab count) and tab sort (newest / oldest / title). Pinned items always stay first; settings are per device (`chrome.storage.local`)
- **Improve:** Test suite in `tests/` runs on every push through GitHub Actions

### v1.1.8 (2026-09-02)
- **Fix:** Cross-device sync never connected for unpacked installs — Chrome derives an unpacked extension's ID from its folder path, so each computer got a different ID and therefore a separate `chrome.storage.sync` namespace. `manifest.json` now carries a fixed `key`, giving every install the same ID (`dfoidibckihcnmakgoabkebinahggked`)
- **Improve:** Hovering the sync status shows the extension ID so mismatches between devices are easy to spot
- **Note:** Because the ID changes once, export your data (Export button) before reloading this version, then import it afterwards

### v1.1.7 (2026-09-02)
- **Fix:** Dropping an Open Tab onto a collection's title bar now saves it (previously only the card body accepted drops)
- **Fix:** Dragging an Open Tab by its favicon no longer starts a native image drag that could swallow the drop
- **Fix:** Toolbar quick-save now targets the active space instead of always the first one, prefers the "Quick Save" collection, creates one if the space is empty, and only closes the tab after a successful save
- **Improve:** Quick-save and drag-drop log what they did (or why they skipped) to the console for troubleshooting

### v1.1.6 (2026-09-02)
- **Fix:** Save Session, the Open Tabs sidebar and the toolbar quick-save no longer include non-web pages such as `about:blank`, new tab pages or `data:` URLs

### v1.1.5 (2026-09-02)
- **Fix:** Background worker logged `Uncaught (in promise) Error: Could not establish connection. Receiving end does not exist.` every 5 minutes when no Dooby new tab was open — `chrome.runtime.sendMessage` rejections are now awaited and swallowed

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
