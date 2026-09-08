// Minimal Supabase-compatible mock for testing Dooby Cloud without a real
// project: auth (id_token sign-in, refresh, logout) + PostgREST-ish
// /rest/v1/dooby_data with per-user isolation. Exposed for e2e tests.
const http = require('http');
const crypto = require('crypto');

function b64url(s) { return Buffer.from(s).toString('base64url'); }
function parseJwtPayload(tok) { try { return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); } catch { return null; } }

function start() {
  const users = new Map();     // sub -> {id,email,name,picture}
  const sessions = new Map();  // access_token -> uid
  const refreshes = new Map(); // refresh_token -> uid
  const rows = new Map();      // uid -> {data, updated_at}
  const log = [];

  const mkSession = (uid) => {
    const u = users.get(uid);
    const access = 'at_' + crypto.randomBytes(12).toString('hex');
    const refresh = 'rt_' + crypto.randomBytes(12).toString('hex');
    sessions.set(access, uid); refreshes.set(refresh, uid);
    return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'bearer',
      user: { id: uid, email: u.email, user_metadata: { full_name: u.name, avatar_url: u.picture, email: u.email } } };
  };
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const auth = (req) => { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); return m ? sessions.get(m[1]) : null; };

  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      log.push(req.method + ' ' + url.pathname + url.search);
      if (req.method === 'OPTIONS') return json(res, 204);
      if (!req.headers.apikey) return json(res, 401, { message: 'No API key found in request' });
      const data = body ? JSON.parse(body) : {};

      if (url.pathname === '/auth/v1/token') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'id_token') {
          const p = parseJwtPayload(data.id_token || '');
          if (!p || !p.sub) return json(res, 400, { error: 'invalid_grant', error_description: 'Bad ID token' });
          const expectedNonce = crypto.createHash('sha256').update(data.nonce || '').digest('hex');
          if (p.nonce !== expectedNonce) return json(res, 400, { error: 'invalid_grant', error_description: 'Passed nonce and nonce in id_token should either both exist or not.' });
          // Stable uuid per google sub
          const uid = users.has(p.sub) ? p.sub : p.sub;
          users.set(uid, { id: uid, email: p.email, name: p.name, picture: p.picture });
          return json(res, 200, mkSession(uid));
        }
        if (grant === 'refresh_token') {
          const uid = refreshes.get(data.refresh_token);
          if (!uid) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
          refreshes.delete(data.refresh_token);
          return json(res, 200, mkSession(uid));
        }
        return json(res, 400, { error: 'unsupported_grant_type' });
      }
      if (url.pathname === '/auth/v1/logout') { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (m) sessions.delete(m[1]); return json(res, 204); }

      if (url.pathname === '/rest/v1/dooby_data') {
        const uid = auth(req);
        if (!uid) return json(res, 401, { message: 'JWT expired or invalid' });
        const filter = url.searchParams.get('user_id') || '';
        const target = filter.startsWith('eq.') ? filter.slice(3) : null;
        if (req.method === 'GET') {
          if (target !== uid) return json(res, 200, []); // RLS: other users' rows are invisible
          const r = rows.get(uid); return json(res, 200, r ? [{ data: r.data, updated_at: r.updated_at }] : []);
        }
        if (req.method === 'POST') {
          if (data.user_id !== uid) return json(res, 403, { message: 'new row violates row-level security policy' });
          rows.set(uid, { data: data.data, updated_at: data.updated_at || new Date().toISOString() });
          return json(res, 201);
        }
        if (req.method === 'DELETE') { if (target === uid) rows.delete(uid); return json(res, 204); }
      }
      json(res, 404, { message: 'not found' });
    });
  });

  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(), rows, users, sessions, refreshes, log,
    // Fake Google ID token for a user; nonce = sha256(rawNonce) like Google would return.
    idToken: (sub, email, name, hashedNonce) => [b64url(JSON.stringify({ alg: 'none' })), b64url(JSON.stringify({ sub, email, name, picture: '', nonce: hashedNonce, iss: 'https://accounts.google.com' })), 'sig'].join('.')
  })));
}

module.exports = { start };
if (require.main === module) start().then(s => console.log('mock supabase at', s.url));
