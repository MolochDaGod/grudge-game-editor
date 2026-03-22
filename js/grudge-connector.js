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
    puterAI: false,
    auth: false,
    objectStore: false,
    api: false,
    puterFS: false,
  };
  var _runtime = null;

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
      _status.puterAI = !!(window.puter && puter.ai && typeof puter.ai.chat === 'function');
      log('Puter SDK: ' + (_status.puter ? '✓' : '✗'));
      log('Puter AI: ' + (_status.puterAI ? '✓' : '✗'));

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

      // 6. Initialize engine runtime
      if (window.GrudgeEngineCore) {
        _runtime = GrudgeEngineCore.createRuntime();
        log('Engine Runtime: ✓');
      } else {
        _runtime = null;
        log('Engine Runtime: ✗');
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
      var parsed;
      var importedMeta = null;
      if (typeof fileOrPath === 'string') {
        // Puter FS path
        parsed = await GDevelopParser.importFromPuter(fileOrPath);
      } else {
        // File object — upload and parse
        importedMeta = await GDevelopParser.uploadAndParse(fileOrPath, projectName);
        parsed = importedMeta.project || importedMeta;
      }

      // Build engine project model from parsed scene graph
      var engineProject = this.buildEngineProjectFromParsed(parsed, {
        sourceName: projectName || parsed.name || 'Imported Project',
      });

      // Register inside runtime project manager
      if (_runtime && _runtime.projectManager) {
        _runtime.projectManager.projects[engineProject.id] = engineProject;
        if (!_runtime.projectManager.activeProjectId) {
          _runtime.projectManager.activeProjectId = engineProject.id;
        }
      }

      return {
        project: parsed,
        engineProject: engineProject,
        rawPath: importedMeta ? importedMeta.rawPath : null,
        scenesDir: importedMeta ? importedMeta.scenesDir : null,
      };
    },

    /** Convert parsed GDevelop structure to Grudge engine project/scene/entity graph */
    buildEngineProjectFromParsed: function (parsed, opts) {
      opts = opts || {};
      var p = parsed || {};
      var sourceName = opts.sourceName || p.name || 'Imported Project';
      var project = GrudgeEngineCore.createProject({
        name: sourceName,
        description: 'Imported from GDevelop',
        source: 'gdevelop',
        importedFrom: sourceName,
      });

      // Reset default scene and replace with imported scenes
      project.scenes = [];
      project.activeSceneId = null;

      var scenes = p.scenes || [];
      for (var s = 0; s < scenes.length; s++) {
        var srcScene = scenes[s];
        var scene = GrudgeEngineCore.createScene({
          name: srcScene.name || ('Scene_' + (s + 1)),
          settings: {
            background: srcScene.backgroundColor
              ? 'rgb(' + srcScene.backgroundColor.r + ',' + srcScene.backgroundColor.g + ',' + srcScene.backgroundColor.b + ')'
              : '#000000',
          },
        });

        // Build quick object definition index
        var objDefs = srcScene.objects || {};

        // Convert instances to entities
        var instances = srcScene.instances || [];
        for (var i = 0; i < instances.length; i++) {
          var inst = instances[i];
          var def = objDefs[inst.objectName] || {};
          var entity = GrudgeEngineCore.createEntity({
            name: inst.objectName || ('Entity_' + i),
            type: def.type || def.rawType || 'unknown',
            transform: {
              x: inst.x || 0,
              y: inst.y || 0,
              z: inst.z || 0,
              rotX: inst.rotationX || 0,
              rotY: inst.rotationY || 0,
              rotZ: inst.angle || inst.rotationZ || 0,
              scaleX: 1,
              scaleY: 1,
              scaleZ: 1,
            },
            metadata: {
              layer: inst.layer || '',
              zOrder: inst.zOrder || 0,
              sourceObjectType: def.rawType || def.type || 'unknown',
              behaviors: (def.behaviors || []).map(function (b) { return b.name; }),
            },
          });
          scene.entities.push(entity);
          scene.entityIndex[entity.id] = entity;
        }

        project.scenes.push(scene);
        if (!project.activeSceneId) project.activeSceneId = scene.id;
      }

      if (!project.scenes.length) {
        var fallback = GrudgeEngineCore.createScene({ name: 'Main Scene' });
        project.scenes.push(fallback);
        project.activeSceneId = fallback.id;
      }

      return project;
    },
    /** List all imported GDevelop projects */
    listGDevelopProjects: function () {
      return GDevelopParser.listProjects();
    },

    /** Load a scene from an imported project */
    loadScene: function (projectPath, sceneName) {
      return GDevelopParser.loadScene(projectPath, sceneName);
    },

    /** List animations discovered from imported projects/scenes */
    listAnimations: async function () {
      var projects = await this.listGDevelopProjects();
      var out = [];
      for (var p = 0; p < projects.length; p++) {
        var proj = projects[p];
        var sceneNames = proj.sceneNames || [];
        for (var s = 0; s < sceneNames.length; s++) {
          try {
            var scene = await this.loadScene(proj.path, sceneNames[s]);
            var objects = scene.objects || {};
            Object.keys(objects).forEach(function (objName) {
              var obj = objects[objName];
              if (obj && Array.isArray(obj.animations) && obj.animations.length) {
                out.push({
                  project: proj.name || proj.dirName,
                  scene: scene.name,
                  object: objName,
                  animations: obj.animations.map(function (a) { return a.name; }),
                });
              }
            });
          } catch (e) { /* ignore single scene failures */ }
        }
      }
      return out;
    },

    /** Access engine runtime (project/scene/hierarchy/network managers) */
    getRuntime: function () {
      return _runtime;
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
      _status.puterAI = !!(window.puter && puter.ai && typeof puter.ai.chat === 'function');
      _status.auth = GrudgeAuth.isSignedIn();
      _status.objectStore = await checkObjectStore();
      _status.api = await checkAPI();
      _status.puterFS = _status.puter && puter.auth.isSignedIn();
      return _status;
    },
  };
})();
