/**
 * GrudgeEngineCore — Runtime Project/Scene/Hierarchy/Network Systems
 *
 * Provides:
 * - ProjectManager: multiple projects + persistence in Puter FS
 * - SceneManager: scene lifecycle and active scene control
 * - HierarchySystem: parent/child entity graph
 * - NetworkManager: WebSocket and sync event abstraction
 */
window.GrudgeEngineCore = (function () {
  'use strict';

  const GRUDA_BASE = '/GRUDA';
  const PROJECTS_DIR = GRUDA_BASE + '/projects';
  const SCENES_DIR = GRUDA_BASE + '/editor-scenes';

  function nowISO() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    if (window.crypto && crypto.randomUUID) return prefix + '_' + crypto.randomUUID();
    return prefix + '_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ── Entity / Hierarchy ─────────────────────────────────────────────

  function createEntity(data) {
    data = data || {};
    return {
      id: data.id || uid('ent'),
      name: data.name || 'Entity',
      type: data.type || 'empty',
      parentId: data.parentId || null,
      children: Array.isArray(data.children) ? data.children.slice() : [],
      transform: Object.assign({
        x: 0, y: 0, z: 0,
        rotX: 0, rotY: 0, rotZ: 0,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      }, data.transform || {}),
      components: Object.assign({}, data.components || {}),
      tags: Array.isArray(data.tags) ? data.tags.slice() : [],
      metadata: Object.assign({}, data.metadata || {}),
      createdAt: data.createdAt || nowISO(),
      updatedAt: nowISO(),
    };
  }

  function createScene(data) {
    data = data || {};
    return {
      id: data.id || uid('scene'),
      name: data.name || 'New Scene',
      entities: Array.isArray(data.entities) ? data.entities.slice() : [],
      entityIndex: Object.assign({}, data.entityIndex || {}),
      settings: Object.assign({
        background: '#000000',
        gravity: { x: 0, y: 0, z: 0 },
        ambientLight: '#ffffff',
      }, data.settings || {}),
      createdAt: data.createdAt || nowISO(),
      updatedAt: nowISO(),
    };
  }

  function createProject(data) {
    data = data || {};
    return {
      id: data.id || uid('proj'),
      name: data.name || 'New Project',
      description: data.description || '',
      scenes: Array.isArray(data.scenes) ? data.scenes.slice() : [],
      activeSceneId: data.activeSceneId || null,
      metadata: Object.assign({
        source: data.source || 'grudge-engine',
        importedFrom: data.importedFrom || null,
      }, data.metadata || {}),
      createdAt: data.createdAt || nowISO(),
      updatedAt: nowISO(),
    };
  }

  // ── Scene Manager ─────────────────────────────────────────────────

  function SceneManager(project) {
    this.project = project;
    this.scenesById = {};
    this.listeners = [];

    for (var i = 0; i < project.scenes.length; i++) {
      var s = project.scenes[i];
      this.scenesById[s.id] = s;
    }
  }

  SceneManager.prototype.getScene = function (sceneId) {
    return this.scenesById[sceneId] || null;
  };

  SceneManager.prototype.getActiveScene = function () {
    if (!this.project.activeSceneId && this.project.scenes.length > 0) {
      this.project.activeSceneId = this.project.scenes[0].id;
    }
    return this.getScene(this.project.activeSceneId);
  };

  SceneManager.prototype.setActiveScene = function (sceneId) {
    if (!this.scenesById[sceneId]) throw new Error('Scene not found: ' + sceneId);
    this.project.activeSceneId = sceneId;
    this.project.updatedAt = nowISO();
    this.emit('scene:active', { sceneId: sceneId });
  };

  SceneManager.prototype.addScene = function (sceneData) {
    var scene = createScene(sceneData);
    this.project.scenes.push(scene);
    this.scenesById[scene.id] = scene;
    if (!this.project.activeSceneId) this.project.activeSceneId = scene.id;
    this.project.updatedAt = nowISO();
    this.emit('scene:add', { scene: scene });
    return scene;
  };

  SceneManager.prototype.removeScene = function (sceneId) {
    var idx = this.project.scenes.findIndex(function (s) { return s.id === sceneId; });
    if (idx < 0) return false;
    this.project.scenes.splice(idx, 1);
    delete this.scenesById[sceneId];
    if (this.project.activeSceneId === sceneId) {
      this.project.activeSceneId = this.project.scenes.length ? this.project.scenes[0].id : null;
    }
    this.project.updatedAt = nowISO();
    this.emit('scene:remove', { sceneId: sceneId });
    return true;
  };

  SceneManager.prototype.on = function (fn) {
    this.listeners.push(fn);
  };

  SceneManager.prototype.emit = function (event, payload) {
    for (var i = 0; i < this.listeners.length; i++) {
      try { this.listeners[i](event, payload); } catch (e) {}
    }
  };

  // ── Hierarchy System ──────────────────────────────────────────────

  function HierarchySystem(sceneManager) {
    this.sceneManager = sceneManager;
  }

  HierarchySystem.prototype._scene = function (sceneId) {
    return sceneId ? this.sceneManager.getScene(sceneId) : this.sceneManager.getActiveScene();
  };

  HierarchySystem.prototype.addEntity = function (entityData, sceneId) {
    var scene = this._scene(sceneId);
    if (!scene) throw new Error('No active scene');
    var entity = createEntity(entityData);
    scene.entities.push(entity);
    scene.entityIndex[entity.id] = entity;
    scene.updatedAt = nowISO();
    return entity;
  };

  HierarchySystem.prototype.getEntity = function (entityId, sceneId) {
    var scene = this._scene(sceneId);
    if (!scene) return null;
    return scene.entityIndex[entityId] || null;
  };

  HierarchySystem.prototype.setParent = function (childId, parentId, sceneId) {
    var scene = this._scene(sceneId);
    if (!scene) throw new Error('No active scene');
    var child = scene.entityIndex[childId];
    if (!child) throw new Error('Child entity not found');
    if (parentId && !scene.entityIndex[parentId]) throw new Error('Parent entity not found');
    if (child.id === parentId) throw new Error('Entity cannot be parent of itself');

    // Remove from old parent children
    if (child.parentId && scene.entityIndex[child.parentId]) {
      var prevParent = scene.entityIndex[child.parentId];
      prevParent.children = prevParent.children.filter(function (id) { return id !== child.id; });
      prevParent.updatedAt = nowISO();
    }

    child.parentId = parentId || null;
    child.updatedAt = nowISO();

    // Add to new parent children
    if (parentId) {
      var parent = scene.entityIndex[parentId];
      if (!parent.children.includes(child.id)) parent.children.push(child.id);
      parent.updatedAt = nowISO();
    }

    scene.updatedAt = nowISO();
    return child;
  };

  HierarchySystem.prototype.removeEntity = function (entityId, sceneId) {
    var scene = this._scene(sceneId);
    if (!scene) return false;
    var entity = scene.entityIndex[entityId];
    if (!entity) return false;

    // Re-parent children to root
    for (var i = 0; i < entity.children.length; i++) {
      var child = scene.entityIndex[entity.children[i]];
      if (child) child.parentId = null;
    }

    // Remove from parent child list
    if (entity.parentId && scene.entityIndex[entity.parentId]) {
      var p = scene.entityIndex[entity.parentId];
      p.children = p.children.filter(function (id) { return id !== entity.id; });
      p.updatedAt = nowISO();
    }

    scene.entities = scene.entities.filter(function (e) { return e.id !== entityId; });
    delete scene.entityIndex[entityId];
    scene.updatedAt = nowISO();
    return true;
  };

  HierarchySystem.prototype.getTree = function (sceneId) {
    var scene = this._scene(sceneId);
    if (!scene) return [];
    var roots = scene.entities.filter(function (e) { return !e.parentId; });
    function toNode(ent) {
      return {
        id: ent.id,
        name: ent.name,
        type: ent.type,
        children: ent.children.map(function (cid) {
          var child = scene.entityIndex[cid];
          return child ? toNode(child) : null;
        }).filter(Boolean),
      };
    }
    return roots.map(toNode);
  };

  // ── Network Manager ───────────────────────────────────────────────

  function NetworkManager() {
    this.socket = null;
    this.handlers = {};
    this.connected = false;
  }

  NetworkManager.prototype.connect = function (namespace) {
    if (!window.GrudgeAPI) throw new Error('GrudgeAPI not loaded');
    this.socket = GrudgeAPI.connectWS(namespace || '/game');
    var self = this;
    this.socket.on('connect', function () {
      self.connected = true;
      self._emitLocal('connect', { id: self.socket.id });
    });
    this.socket.on('disconnect', function (reason) {
      self.connected = false;
      self._emitLocal('disconnect', { reason: reason });
    });
    this.socket.onAny(function (event, payload) {
      self._emitLocal(event, payload);
    });
    return this.socket;
  };

  NetworkManager.prototype.disconnect = function () {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  };

  NetworkManager.prototype.emit = function (event, payload) {
    if (!this.socket) throw new Error('Socket not connected');
    this.socket.emit(event, payload);
  };

  NetworkManager.prototype.on = function (event, fn) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
  };

  NetworkManager.prototype._emitLocal = function (event, payload) {
    var listeners = (this.handlers[event] || []).concat(this.handlers['*'] || []);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](payload, event); } catch (e) {}
    }
  };

  // ── Project Manager ───────────────────────────────────────────────

  function ProjectManager() {
    this.projects = {};
    this.activeProjectId = null;
  }

  ProjectManager.prototype.createProject = function (projectData) {
    var project = createProject(projectData);
    if (!project.scenes.length) {
      var defaultScene = createScene({ name: 'Main Scene' });
      project.scenes.push(defaultScene);
      project.activeSceneId = defaultScene.id;
    }
    this.projects[project.id] = project;
    if (!this.activeProjectId) this.activeProjectId = project.id;
    return project;
  };

  ProjectManager.prototype.getProject = function (projectId) {
    return this.projects[projectId] || null;
  };

  ProjectManager.prototype.getActiveProject = function () {
    return this.getProject(this.activeProjectId);
  };

  ProjectManager.prototype.setActiveProject = function (projectId) {
    if (!this.projects[projectId]) throw new Error('Project not found: ' + projectId);
    this.activeProjectId = projectId;
    return this.projects[projectId];
  };

  ProjectManager.prototype.listProjects = function () {
    return Object.values(this.projects);
  };

  ProjectManager.prototype.deleteProject = function (projectId) {
    if (!this.projects[projectId]) return false;
    delete this.projects[projectId];
    if (this.activeProjectId === projectId) {
      var keys = Object.keys(this.projects);
      this.activeProjectId = keys.length ? keys[0] : null;
    }
    return true;
  };

  ProjectManager.prototype.saveToPuter = async function (projectId) {
    if (!window.puter) throw new Error('Puter SDK not available');
    var project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    var safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    var path = PROJECTS_DIR + '/' + safeName + '.json';
    await puter.fs.write(path, JSON.stringify(project, null, 2), { createMissingParents: true });
    return path;
  };

  ProjectManager.prototype.loadFromPuter = async function (path) {
    if (!window.puter) throw new Error('Puter SDK not available');
    var blob = await puter.fs.read(path);
    var project = JSON.parse(await blob.text());
    this.projects[project.id] = project;
    if (!this.activeProjectId) this.activeProjectId = project.id;
    return project;
  };

  ProjectManager.prototype.listPuterProjects = async function () {
    if (!window.puter) return [];
    try {
      return await puter.fs.readdir(PROJECTS_DIR);
    } catch (e) {
      return [];
    }
  };

  // ── Public factory ────────────────────────────────────────────────

  function createRuntime() {
    var projectManager = new ProjectManager();
    var networkManager = new NetworkManager();
    return {
      projectManager: projectManager,
      networkManager: networkManager,
      createForProject: function (project) {
        var sceneManager = new SceneManager(project);
        var hierarchy = new HierarchySystem(sceneManager);
        return { sceneManager: sceneManager, hierarchy: hierarchy };
      },
      constants: {
        PROJECTS_DIR: PROJECTS_DIR,
        SCENES_DIR: SCENES_DIR,
      },
    };
  }

  return {
    createRuntime: createRuntime,
    createProject: createProject,
    createScene: createScene,
    createEntity: createEntity,
  };
})();
