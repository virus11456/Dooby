// Dooby Cloud configuration.
//
// These are PUBLIC identifiers (safe to ship in the extension): the Supabase
// project URL and anon key are designed to be embedded in clients and are
// protected by Row Level Security; the Google client ID only identifies the
// OAuth app. Leave them empty to ship without Dooby Cloud — the extension then
// falls back to chrome.storage.sync only.
const DoobyConfig = {
  supabaseUrl: 'https://rsxtczsldaajrvtwjjpf.supabase.co',        // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzeHRjenNsZGFhanJ2dHdqanBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NDg4NTAsImV4cCI6MjEwNDQyNDg1MH0.E3BCpcf9c4Fwe6wAqcH1HvOwqp66BDYfDpPMVeGevRo',    // Supabase → Project Settings → API → anon public
  googleClientId: '172617727018-jpdmhp81eh6ht2guk8dkedbgkphoojnt.apps.googleusercontent.com',     // Google Cloud → OAuth 2.0 Client ID (Web application)
  // Optional: where the Dooby web app lives (used for the "Open on iPad" hint).
  webAppUrl: 'https://toolist.cc/dooby/app'
};
