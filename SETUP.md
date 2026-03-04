# Tooby - Setup Guide

## Basic Installation (Local Only, No Sync)

1. Open Chrome, go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** and select the `Tooby` folder
4. Open a new tab - Tooby is ready!

> Without cloud sync setup, you can still use Export/Import (JSON file) to manually transfer data between devices.

---

## Cloud Sync Setup (Google Sign-In + Firebase)

To enable cross-device cloud sync, you need to set up a Firebase project and configure OAuth2.

### Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project**, name it (e.g., "tooby-sync")
3. Disable Google Analytics (optional), then **Create project**

### Step 2: Enable Firestore Database

1. In Firebase Console, go to **Build > Firestore Database**
2. Click **Create database**
3. Choose **Start in test mode** (you can add security rules later)
4. Select a region close to your users

### Step 3: Set Firestore Security Rules

Go to **Firestore > Rules** and set:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/data/{document} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Step 4: Create OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. Go to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth 2.0 Client ID**
5. Application type: **Chrome Extension**
6. Enter your extension's **Item ID** (find it on `chrome://extensions/`)
7. Copy the **Client ID**

### Step 5: Enable Required APIs

In Google Cloud Console, go to **APIs & Services > Library** and enable:
- **Cloud Firestore API**
- **Google People API** (for user profile)

### Step 6: Configure the Extension

1. Open `manifest.json` and replace:
   ```json
   "oauth2": {
     "client_id": "YOUR_CHROME_CLIENT_ID.apps.googleusercontent.com",
     ...
   }
   ```
   with your actual Client ID.

2. Open `js/sync.js` and replace the `FIREBASE_CONFIG` object:
   ```javascript
   FIREBASE_CONFIG: {
     apiKey: 'your-api-key',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project-id',
     ...
   }
   ```
   (Find these in Firebase Console > Project Settings > General > Your apps > Web app config)

3. In `manifest.json`, replace `"key": "YOUR_EXTENSION_KEY"` with your extension's key
   (or remove this line for development)

### Step 7: Reload Extension

1. Go to `chrome://extensions/`
2. Click the refresh icon on Tooby
3. Open a new tab
4. Click **Sign In** to connect your Google account

---

## How Sync Works

- **Auto-sync**: Data syncs automatically 3 seconds after any change
- **Periodic sync**: Background sync runs every 5 minutes
- **Manual sync**: Click the sync icon in the top bar
- **Conflict resolution**: Last-write-wins strategy (most recent data takes priority)
- **Offline support**: Works fully offline, syncs when back online

## Data Privacy

- All data is stored in your own Firebase project
- Only you have access to your Firestore database
- No third-party servers involved
- Export/Import works completely offline
