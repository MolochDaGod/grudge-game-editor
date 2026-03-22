/**
 * GrudgeConnector — Master Orchestrator
 *
 * Loads after all modules (grudge-auth, grudge-objectstore, grudge-api, gdevelop-parser)
 * and provides a unified initialization + status API.
 *
 * Globals available after init:
 *   window.GrudgeAuth         — auth + JWT
 *   window.GrudgeObjectStore  — R2 + static game data + Puter FS
 *   window.GrudgeAPI          — game backend endpoints
 *   window.GDevelopParser     — GDevelop project → scene converter
 *   window.GrudgeConnector    — this orchestrator
 */
window.GrudgeConnector = (function () {
  'use strict';

  const VERSION = '1.0.0';
  const GRUDA_BASE = '/GRUDA';

  var _ready = false;
  var _status = {
    puter: false,
    auth: false,
    objectStore: false,
    api: false,
    puterFS: false,
  };

  // ── Directory initialization ──

  var DIRS = [
    GRUDA_BASE,
    GRUDA_BASE + '/assets',
    GRUDA_BASE + '/assets/models',
    GRUDA_BASE + '/assets/textures',
    GRUDA_BASE + '/assets/animations',
    GRUDA_BASE + '/assets/audio',
    GRUDA_BASE + '/projects',
    GRUDA_BASE + '/exports',
    GRUDA_BASE + '/gdevelop-games',
    GRUDA_BASE + '/editor-scenes',
    GRUDA_BASE + '/editor-config',
    GRUDA_BASE + '/gruda-wars',
    GRUDA_BASE + '/gruda-wars/heroes',
    GRUDA_BASE + '/gruda-wars/saves',
    GRUDA_BASE + '/gruda-wars/settings',
  ];

  async function ensureDirectories() {
    if (!window.puter) return false;
    for (var i = 0; i < DIRS.length; i++) {
      try {
        await puter.fs.mkdir(DIRS[i], { createMissingParents: true });
      } catch (e) {
        // Directory already exists — fine
      }
    }
    return true;
  }

  // ── Health checks ──

  async function checkObjectStore() {
    try {
      var res = await GrudgeObjectStore.r2.health();
      return res && res.status === 'ok';
    } catch (e) {
      return false;
    }
  }

  async function checkAPI() {
    try {
      var res = await GrudgeAPI.health();
      return res && res.status === 'ok';
    } catch (e) {
      return false;
    }
  }

  // ── Public API ──

  return {
    version: VERSION,

    /** Initialize all systems. Call once after Puter.js SDK loads. */
    init: async function (opts) {
      opts = opts || {};
      var log = opts.onLog || function () {};

      log('Initializing Grudge Connector v' + VERSION + '...');

      // 1. Check Puter SDK
      _status.puter = !!(window.puter);
      log('Puter SDK: ' + (_status.puter ? '✓' : '✗'));

      // 2. Initialize auth
      try {
        var user = await GrudgeAuth.init();
        _status.auth = !!user;
        log('Auth: ' + (_status.auth ? '✓ ' + (user.username || user.grudgeId) : '✗ not signed in'));
      } catch (e) {
        _status.auth = false;
        log('Auth: ✗ ' + e.message);
      }

      // 3. Check ObjectStore R2
      _status.objectStore = await checkObjectStore();
      log('ObjectStore R2: ' + (_status.objectStore ? '✓' : '✗ offline'));

      // 4. Check Game API
      _status.api = await checkAPI();
      log('Game API: ' + (_status.api ? '✓' : '✗ offline'));

      // 5. Initialize Puter FS directories (only if signed into Puter)
      if (_status.puter && puter.auth.isSignedIn()) {
        _status.puterFS = await ensureDirectories();
        log('Puter FS: ' + (_status.puterFS ? '✓ directories ready' : '✗'));
      } else {
        _status.puterFS = false;
        log('Puter FS: ✗ not signed in');
      }

      _ready = true;
      log('Grudge Connector ready.');

      // Dispatch global event
      window.dispatchEvent(new CustomEvent('grudge-connector-ready', {
        detail: { status: Object.assign({}, _status), version: VERSION },
      }));

      return _status;
    },

    /** Get current connection status */
    getStatus: function () {
      return Object.assign({}, _status);
    },

    /** Whether init() has completed */
    isReady: function () { return _ready; },

    /** Quick sign in — Puter + Grudge backend */
    signIn: async function () {
      var user = await GrudgeAuth.signIn();
      _status.auth = true;

      // Now that we're signed in, ensure FS dirs exist
      if (window.puter && puter.auth.isSignedIn()) {
        _status.puterFS = await ensureDirectories();
      }

      return user;
    },

    /** Quick sign out */
    signOut: async function () {
      await GrudgeAuth.signOut();
      _status.auth = false;
    },

    /** Import a GDevelop game.json file (File object or Puter FS path) */
    importGDevelopGame: async function (fileOrPath, projectName) {
      if (typeof fileOrPath === 'string') {
        // Puter FS path
        return GDevelopParser.importFromPuter(fileOrPath);
      } else {
        // File object — upload and parse
        return GDevelopParser.uploadAndParse(fileOrPath, projectName);
      }
    },

    /** List all imported GDevelop projects */
    listGDevelopProjects: function () {
      return GDevelopParser.listProjects();
    },

    /** Load a scene from an imported project */
    loadScene: function (projectPath, sceneName) {
      return GDevelopParser.loadScene(projectPath, sceneName);
    },

    /** Fetch all game data definitions from ObjectStore */
    loadGameData: async function () {
      var gd = GrudgeObjectStore.gameData;
      var results = await Promise.allSettled([
        gd.weapons(), gd.armor(), gd.materials(), gd.consumables(),
        gd.skills(), gd.professions(), gd.races(), gd.classes(),
        gd.factions(), gd.attributes(), gd.bosses(), gd.enemies(),
      ]);

      var keys = [
        'weapons', 'armor', 'materials', 'consumables',
        'skills', 'professions', 'races', 'classes',
        'factions', 'attributes', 'bosses', 'enemies',
      ];

      var data = {};
      keys.forEach(function (key, i) {
        data[key] = results[i].status === 'fulfilled' ? results[i].value : null;
      });
      return data;
    },

    /** Re-run health checks */
    refresh: async function () {
      _status.puter = !!(window.puter);
      _status.auth = GrudgeAuth.isSignedIn();
      _status.objectStore = await checkObjectStore();
      _status.api = await checkAPI();
      _status.puterFS = _status.puter && puter.auth.isSignedIn();
      return _status;
    },
  };
})();
