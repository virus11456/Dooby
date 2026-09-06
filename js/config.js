// Dooby Cloud configuration.
//
// These are PUBLIC identifiers (safe to ship in the extension): the Supabase
// project URL and anon key are designed to be embedded in clients and are
// protected by Row Level Security; the Google client ID only identifies the
// OAuth app. Leave them empty to ship without Dooby Cloud — the extension then
// falls back to chrome.storage.sync only.
const DoobyConfig = {
  supabaseUrl: '',        // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseAnonKey: '',    // Supabase → Project Settings → API → anon public
  googleClientId: '',     // Google Cloud → OAuth 2.0 Client ID (Web application)
  // Optional: where the Dooby web app lives (used for the "Open on iPad" hint).
  webAppUrl: 'https://toolist.cc/dooby/app'
};
