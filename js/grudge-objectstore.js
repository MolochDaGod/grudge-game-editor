/**
 * GrudgeObjectStore — Browser-Side Object Storage Client
 *
 * Two backends:
 *   1. R2 Worker (objectstore.grudge-studio.com) — dynamic asset CRUD
 *   2. Static JSON API (molochdagod.github.io/ObjectStore) — game data definitions
 *
 * Caches static data in memory to avoid redundant fetches.
 */
window.GrudgeObjectStore = (function () {
  'use strict';

  const R2_URL = 'https://objectstore.grudge-studio.com';
  const STATIC_URL = 'https://molochdagod.github.io/ObjectStore';

  const _cache = {};

  // ── Internals ──

  async function r2Fetch(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    // Use GrudgeAuth token if available for write ops
    if (window.GrudgeAuth && GrudgeAuth.getToken()) {
      opts.headers['Authorization'] = 'Bearer ' + GrudgeAuth.getToken();
    }
    var res = await fetch(R2_URL + path, opts);
    if (!res.ok) {
      var err = await res.json().catch(function () { return { error: res.statusText }; });
      throw new Error('ObjectStore error ' + res.status + ': ' + (err.error || res.statusText));
    }
    var ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res;
  }

  async function staticFetch(path) {
    if (_cache[path]) return _cache[path];
    var res = await fetch(STATIC_URL + path);
    if (!res.ok) throw new Error('Static ObjectStore fetch failed: ' + path);
    var data = await res.json();
    _cache[path] = data;
    return data;
  }

  // ── R2 Asset API ──

  var r2 = {
    /** List/search assets with optional filters */
    list: async function (query) {
      query = query || {};
      var params = new URLSearchParams();
      if (query.category) params.set('category', query.category);
      if (query.tag) params.set('tag', query.tag);
      if (query.q) params.set('q', query.q);
      if (query.prefix) params.set('prefix', query.prefix);
      if (query.limit) params.set('limit', String(query.limit));
      if (query.offset) params.set('offset', String(query.offset));
      var qs = params.toString();
      return r2Fetch('/v1/assets' + (qs ? '?' + qs : ''));
    },

    /** Get asset metadata by ID */
    get: async function (id) {
      return r2Fetch('/v1/assets/' + encodeURIComponent(id));
    },

    /** Get public file URL for an asset */
    fileUrl: function (id) {
      return R2_URL + '/v1/assets/' + encodeURIComponent(id) + '/file';
    },

    /** Upload an asset (requires auth) */
    upload: async function (file, meta) {
      meta = meta || {};
      var form = new FormData();
      form.append('file', file, meta.filename || file.name);
      if (meta.category) form.append('category', meta.category);
      if (meta.tags) form.append('tags', JSON.stringify(meta.tags));
      if (meta.visibility) form.append('visibility', meta.visibility);
      if (meta.metadata) form.append('metadata', JSON.stringify(meta.metadata));

      var headers = {};
      if (window.GrudgeAuth && GrudgeAuth.getToken()) {
        headers['Authorization'] = 'Bearer ' + GrudgeAuth.getToken();
      }

      var res = await fetch(R2_URL + '/v1/assets', {
        method: 'POST',
        headers: headers,
        body: form,
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error('Upload failed: ' + (err.error || res.statusText));
      }
      return res.json();
    },

    /** Delete asset by ID (requires auth) */
    delete: async function (id) {
      return r2Fetch('/v1/assets/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    /** Health check */
    health: async function () {
      return r2Fetch('/health');
    },
  };

  // ── Static Game Data API ──

  var gameData = {
    weapons:      function () { return staticFetch('/api/v1/weapons.json'); },
    armor:        function () { return staticFetch('/api/v1/armor.json'); },
    materials:    function () { return staticFetch('/api/v1/materials.json'); },
    consumables:  function () { return staticFetch('/api/v1/consumables.json'); },
    skills:       function () { return staticFetch('/api/v1/skills.json'); },
    professions:  function () { return staticFetch('/api/v1/professions.json'); },
    races:        function () { return staticFetch('/api/v1/races.json'); },
    classes:      function () { return staticFetch('/api/v1/classes.json'); },
    factions:     function () { return staticFetch('/api/v1/factions.json'); },
    attributes:   function () { return staticFetch('/api/v1/attributes.json'); },
    bosses:       function () { return staticFetch('/api/v1/bosses.json'); },
    enemies:      function () { return staticFetch('/api/v1/enemies.json'); },

    /** Fetch any custom JSON path from the static store */
    custom: function (jsonPath) {
      return staticFetch(jsonPath);
    },

    /** Build an icon URL for a given item path */
    iconUrl: function (relativePath) {
      return STATIC_URL + '/icons/' + relativePath;
    },
  };

  // ── Puter FS helpers (for user's cloud files) ──

  var puterFS = {
    /** Read a JSON file from Puter cloud storage */
    readJSON: async function (path) {
      if (!window.puter) throw new Error('Puter SDK not available');
      var blob = await puter.fs.read(path);
      var text = await blob.text();
      return JSON.parse(text);
    },

    /** Write a JSON file to Puter cloud storage */
    writeJSON: async function (path, data) {
      if (!window.puter) throw new Error('Puter SDK not available');
      await puter.fs.write(path, JSON.stringify(data, null, 2), {
        createMissingParents: true,
      });
    },

    /** List files in a Puter FS directory */
    list: async function (dirPath) {
      if (!window.puter) throw new Error('Puter SDK not available');
      return puter.fs.readdir(dirPath);
    },

    /** Upload a File to Puter FS */
    upload: async function (path, file) {
      if (!window.puter) throw new Error('Puter SDK not available');
      return puter.fs.write(path, file, {
        createMissingParents: true,
        dedupeName: true,
      });
    },
  };

  return {
    r2: r2,
    gameData: gameData,
    puterFS: puterFS,
    /** Clear the static data cache */
    clearCache: function () {
      Object.keys(_cache).forEach(function (k) { delete _cache[k]; });
    },
    /** Get the R2 base URL */
    getR2Url: function () { return R2_URL; },
    /** Get the static store base URL */
    getStaticUrl: function () { return STATIC_URL; },
  };
})();
