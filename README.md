# Tooby - Tab & Bookmark Manager

A Chrome extension for organizing your tabs and bookmarks into visual collections. Better than bookmarks.

## Features

- **Collections** - Organize your tabs into named collections with drag-and-drop
- **Spaces** - Group collections into separate workspaces (Work, Personal, etc.)
- **Session Save** - Save all open tabs as a collection with one click
- **Search** - Instantly search across all your saved tabs (Ctrl+K)
- **Drag & Drop** - Drag open tabs from the sidebar into any collection
- **New Tab Override** - Replaces your new tab page with the Tooby dashboard
- **Context Menus** - Right-click tabs for quick actions (open, copy URL, delete)
- **Local Storage** - All data stored locally in your browser

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the `Tooby` folder
5. Open a new tab to see Tooby in action

## Usage

- **Create a Space**: Click the `+` button in the left sidebar
- **Create a Collection**: Click "Add Collection" in the main area
- **Save tabs**: Drag open tabs from the right sidebar into a collection
- **Save Session**: Click "Save Session" to save all open tabs at once
- **Search**: Press `Ctrl+K` or click the search bar to find saved tabs
- **Rename**: Double-click collection names to rename them
- **Open all**: Click the grid icon on a collection to open all its tabs

## Project Structure

```
Tooby/
├── manifest.json          # Chrome extension manifest (v3)
├── css/
│   └── newtab.css         # Styles for the new tab page
├── js/
│   ├── background.js      # Service worker (click-to-save, init)
│   ├── storage.js         # Storage abstraction layer
│   ├── dragdrop.js        # Drag and drop manager
│   └── newtab.js          # Main application logic
├── pages/
│   └── newtab.html        # New tab page
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks)
- Chrome Storage API for persistence
- Chrome Tabs API for tab management
