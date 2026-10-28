// Shared by the new tab page and the background service worker.
//
// Every read-modify-write of `spaces` / `collections` goes through
// DoobyData.mutate() so concurrent writers (this page, other Dooby tabs, the
// toolbar quick-save in the worker, Chrome sync and Dooby Cloud pulls) can
// never overwrite each other's changes. Web Locks are shared by every context
// of the extension's origin; where they are missing, writes are at least
// serialized within the current context.
//
// Lock callbacks must not call another DoobyData.mutate()/withLock(): Web
// Locks are not re-entrant, so that would wait forever.

const DoobyData = {
  LOCK: 'dooby-data',
  _chain: Promise.resolve(),

  withLock(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      return navigator.locks.request(this.LOCK, () => fn());
    }
    const run = this._chain.then(() => fn());
    this._chain = run.catch(() => {});
    return run;
  },

  // Returned from a mutate() callback to skip the write (nothing changed).
  unchanged(value) {
    return { __doobyUnchanged: true, value };
  },

  // Read `keys` (any of 'spaces', 'collections'), hand them to fn as a plain
  // object it can change in place or reassign, then write them back together
  // with a fresh localUpdateTime so sync and Dooby Cloud see the edit at once.
  async mutate(keys, fn) {
    return this.withLock(async () => {
      const stored = await chrome.storage.local.get(keys);
      const state = {};
      for (const k of keys) state[k] = Array.isArray(stored[k]) ? stored[k] : [];
      const result = await fn(state);
      if (result && result.__doobyUnchanged) return result.value;
      const patch = { localUpdateTime: Date.now() };
      for (const k of keys) patch[k] = state[k];
      await chrome.storage.local.set(patch);
      return result;
    });
  },

  // Unique id like "tab-lq3x9a-k2f8d1zp": time plus random, so two ids made in
  // the same millisecond (bulk saves, imports) never collide.
  newId(prefix) {
    let rand = '';
    try {
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      rand = Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('');
    } catch (e) {
      rand = Math.random().toString(36).slice(2, 12);
    }
    return `${prefix}-${Date.now().toString(36)}-${rand}`;
  }
};
