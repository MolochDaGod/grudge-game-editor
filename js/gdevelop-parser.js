/**
 * GDevelopParser — GDevelop Project → Editor Scene Converter
 *
 * Parses GDevelop game.json project files and converts them into
 * a normalized scene graph that Grudge-Game-Editor can render.
 *
 * GDevelop project structure:
 *   project.layouts[]         → scenes
 *   layout.objects[]          → object definitions (Sprite, TiledSprite, TextObject, etc.)
 *   layout.instances[]        → placed instances (x, y, angle, layer, zOrder)
 *   layout.layers[]           → rendering layers
 *   layout.behaviorsSharedData[] → shared behavior configs
 *   project.resources         → image/audio resource manifest
 *   project.eventsFunctionsExtensions[] → custom behaviors/events
 *
 * Storage:
 *   - Source GDevelop files: /GRUDA/gdevelop-games/<project-name>/game.json
 *   - Parsed scenes:         /GRUDA/editor-scenes/<project-name>/<scene-name>.json
 */
window.GDevelopParser = (function () {
  'use strict';

  const GRUDA_BASE = '/GRUDA';
  const GDEVELOP_DIR = GRUDA_BASE + '/gdevelop-games';
  const SCENES_DIR = GRUDA_BASE + '/editor-scenes';

  // ── Object type mapping ──

  var TYPE_MAP = {
    'Sprite':              'sprite',
    'TiledSpriteObject::TiledSprite': 'tiled-sprite',
    'TextObject::Text':    'text',
    'PanelSpriteObject::PanelSprite': 'panel-sprite',
    'ShapePainterObject::Drawer': 'shape',
    'ParticleSystem::ParticleEmitter': 'particles',
    'PrimitiveDrawing::Drawer': 'shape',
    'TextEntryObject::TextEntry': 'text-input',
    'Scene3D::Cube3DObject': 'cube-3d',
    'Scene3D::Model3DObject': 'model-3d',
    'TileMap::TileMap':    'tilemap',
    'TileMap::CollisionMask': 'tilemap-collision',
    'Video::VideoObject':  'video',
    'BBText::BBText':      'rich-text',
    'BitmapText::BitmapTextObject': 'bitmap-text',
    'SpineObject::SpineObject': 'spine',
  };

  function mapObjectType(gdType) {
    return TYPE_MAP[gdType] || 'unknown';
  }

  // ── Resource resolution ──

  function buildResourceMap(project) {
    var map = {};
    if (!project.resources || !project.resources.resources) return map;
    project.resources.resources.forEach(function (res) {
      map[res.name] = {
        name: res.name,
        file: res.file,
        kind: res.kind, // 'image', 'audio', 'font', 'json', 'tilemap', 'video', 'bitmapFont'
        metadata: res.metadata || '',
      };
    });
    return map;
  }

  function resolveAssetUrl(resourceName, resourceMap, projectDir) {
    var res = resourceMap[resourceName];
    if (!res) return null;

    // If the file path starts with http, use as-is
    if (res.file && (res.file.startsWith('http://') || res.file.startsWith('https://'))) {
      return res.file;
    }

    // Check if it matches an ObjectStore icon path
    if (res.file && res.file.includes('icons/')) {
      return GrudgeObjectStore.getStaticUrl() + '/' + res.file;
    }

    // Default: relative to the project directory on Puter FS
    if (projectDir && res.file) {
      return projectDir + '/' + res.file;
    }

    return res.file || null;
  }

  // ── Object parsing ──

  function parseObject(obj, resourceMap, projectDir) {
    var parsed = {
      name: obj.name,
      type: mapObjectType(obj.type),
      rawType: obj.type,
      variables: parseVariables(obj.variables || []),
      behaviors: (obj.behaviors || []).map(function (b) {
        return {
          name: b.name,
          type: b.type,
          properties: Object.assign({}, b),
        };
      }),
      effects: (obj.effects || []).map(function (e) {
        return { name: e.name, type: e.effectType, params: e.parameters || {} };
      }),
    };

    // Extract sprite animations
    if (obj.type === 'Sprite' && obj.animations) {
      parsed.animations = obj.animations.map(function (anim, idx) {
        return {
          name: anim.name || 'Animation_' + idx,
          useMultipleDirections: !!anim.useMultipleDirections,
          directions: (anim.directions || []).map(function (dir) {
            return {
              looping: !!dir.looping,
              timeBetweenFrames: dir.timeBetweenFrames || 0.08,
              sprites: (dir.sprites || []).map(function (spr) {
                return {
                  image: spr.image,
                  url: resolveAssetUrl(spr.image, resourceMap, projectDir),
                  points: spr.points || [],
                  originPoint: spr.originPoint || { x: 0, y: 0 },
                  centerPoint: spr.centerPoint || { x: 0, y: 0 },
                  customCollisionMask: spr.hasCustomCollisionMask ? spr.customCollisionMask : null,
                };
              }),
            };
          }),
        };
      });
    }

    // Extract text content
    if (obj.type === 'TextObject::Text' && obj.content) {
      parsed.text = {
        string: obj.content.string || '',
        font: obj.content.font || '',
        characterSize: obj.content.characterSize || 20,
        color: obj.content.color || { r: 255, g: 255, b: 255 },
        bold: !!obj.content.bold,
        italic: !!obj.content.italic,
      };
    }

    // Extract 3D model info
    if (obj.type === 'Scene3D::Model3DObject' && obj.content) {
      parsed.model3d = {
        modelResourceName: obj.content.modelResourceName,
        url: resolveAssetUrl(obj.content.modelResourceName, resourceMap, projectDir),
        width: obj.content.width || 1,
        height: obj.content.height || 1,
        depth: obj.content.depth || 1,
        rotationX: obj.content.rotationX || 0,
        rotationY: obj.content.rotationY || 0,
        rotationZ: obj.content.rotationZ || 0,
      };
    }

    return parsed;
  }

  function parseVariables(vars) {
    if (!Array.isArray(vars)) return {};
    var result = {};
    vars.forEach(function (v) {
      result[v.name] = {
        type: v.type || 'number',
        value: v.value !== undefined ? v.value : 0,
        children: v.children ? parseVariables(v.children) : undefined,
      };
    });
    return result;
  }

  // ── Instance parsing ──

  function parseInstance(inst) {
    return {
      objectName: inst.objName,
      x: inst.x || 0,
      y: inst.y || 0,
      z: inst.z || 0,
      angle: inst.angle || 0,
      zOrder: inst.zOrder || 0,
      layer: inst.layer || '',
      locked: !!inst.locked,
      width: inst.customSize ? inst.width : null,
      height: inst.customSize ? inst.height : null,
      depth: inst.depth || null,
      rotationX: inst.rotationX || 0,
      rotationY: inst.rotationY || 0,
      variables: parseVariables(inst.initialVariables || []),
    };
  }

  // ── Layer parsing ──

  function parseLayer(layer) {
    return {
      name: layer.name,
      visibility: layer.visibility !== false,
      isLightingLayer: !!layer.isLightingLayer,
      ambientLightColor: layer.ambientLightColorR != null
        ? { r: layer.ambientLightColorR, g: layer.ambientLightColorG, b: layer.ambientLightColorB }
        : null,
      camera3dFieldOfView: layer.camera3dFieldOfView || 45,
      camera3dNearPlane: layer.camera3dNearPlane || 0.1,
      camera3dFarPlane: layer.camera3dFarPlane || 2000,
      effects: (layer.effects || []).map(function (e) {
        return { name: e.name, type: e.effectType, params: e.parameters || {} };
      }),
    };
  }

  // ── Scene (layout) parsing ──

  function parseScene(layout, resourceMap, projectDir) {
    var objectDefs = {};
    (layout.objects || []).forEach(function (obj) {
      objectDefs[obj.name] = parseObject(obj, resourceMap, projectDir);
    });

    // Also include global objects if they're referenced
    var instances = (layout.instances || []).map(parseInstance);
    var layers = (layout.layers || []).map(parseLayer);

    return {
      name: layout.name,
      backgroundColor: layout.r != null
        ? { r: layout.r, g: layout.g, b: layout.b }
        : { r: 0, g: 0, b: 0 },
      windowDefaultTitle: layout.title || layout.name,
      objects: objectDefs,
      instances: instances,
      layers: layers,
      variables: parseVariables(layout.variables || []),
      behaviorsSharedData: layout.behaviorsSharedData || [],
    };
  }

  // ── Full project parsing ──

  function parseProject(projectJson) {
    var project = typeof projectJson === 'string' ? JSON.parse(projectJson) : projectJson;
    var resourceMap = buildResourceMap(project);

    var properties = project.properties || {};
    var scenes = (project.layouts || []).map(function (layout) {
      return parseScene(layout, resourceMap, null);
    });

    // Also extract global objects (available to all scenes)
    var globalObjects = {};
    (project.objects || []).forEach(function (obj) {
      globalObjects[obj.name] = parseObject(obj, resourceMap, null);
    });

    return {
      name: properties.name || 'Untitled',
      author: properties.author || '',
      version: properties.version || '1.0.0',
      windowWidth: properties.windowWidth || 800,
      windowHeight: properties.windowHeight || 600,
      maxFPS: properties.maxFPS || 60,
      minFPS: properties.minFPS || 20,
      orientation: properties.orientation || 'default',
      scaleMode: properties.scaleMode || 'linear',
      scenes: scenes,
      sceneNames: scenes.map(function (s) { return s.name; }),
      globalObjects: globalObjects,
      resources: resourceMap,
      extensions: (project.eventsFunctionsExtensions || []).map(function (ext) {
        return { name: ext.name, version: ext.version, description: ext.description };
      }),
    };
  }

  // ── Puter FS integration ──

  return {
    /** Parse a GDevelop project JSON object or string */
    parse: parseProject,

    /** Parse a single scene/layout from a project */
    parseScene: function (layout, resourceMap) {
      return parseScene(layout, resourceMap || {}, null);
    },

    /** Import a GDevelop game.json from a local File object */
    importFromFile: function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var project = JSON.parse(e.target.result);
            resolve(parseProject(project));
          } catch (err) {
            reject(new Error('Invalid GDevelop project JSON: ' + err.message));
          }
        };
        reader.onerror = function () { reject(new Error('Failed to read file')); };
        reader.readAsText(file);
      });
    },

    /** Load and parse a GDevelop project from Puter FS */
    importFromPuter: async function (path) {
      if (!window.puter) throw new Error('Puter SDK not available');
      var blob = await puter.fs.read(path);
      var text = await blob.text();
      var project = JSON.parse(text);
      return parseProject(project);
    },

    /** Save a parsed project to Puter FS for the editor */
    saveParsedProject: async function (projectName, parsedProject) {
      if (!window.puter) throw new Error('Puter SDK not available');

      var projectDir = SCENES_DIR + '/' + projectName.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Save full project manifest
      await puter.fs.write(
        projectDir + '/manifest.json',
        JSON.stringify({
          name: parsedProject.name,
          sceneNames: parsedProject.sceneNames,
          windowWidth: parsedProject.windowWidth,
          windowHeight: parsedProject.windowHeight,
          extensions: parsedProject.extensions,
          savedAt: new Date().toISOString(),
        }, null, 2),
        { createMissingParents: true }
      );

      // Save each scene as a separate file
      for (var i = 0; i < parsedProject.scenes.length; i++) {
        var scene = parsedProject.scenes[i];
        var sceneName = scene.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        await puter.fs.write(
          projectDir + '/' + sceneName + '.json',
          JSON.stringify(scene, null, 2),
          { createMissingParents: true }
        );
      }

      // Save global objects
      if (Object.keys(parsedProject.globalObjects).length > 0) {
        await puter.fs.write(
          projectDir + '/global-objects.json',
          JSON.stringify(parsedProject.globalObjects, null, 2),
          { createMissingParents: true }
        );
      }

      return projectDir;
    },

    /** Upload a GDevelop game.json file to Puter FS and parse it */
    uploadAndParse: async function (file, projectName) {
      if (!window.puter) throw new Error('Puter SDK not available');

      projectName = projectName || file.name.replace(/\.json$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

      // Store the raw GDevelop file
      var rawPath = GDEVELOP_DIR + '/' + projectName + '/game.json';
      await puter.fs.write(rawPath, file, { createMissingParents: true });

      // Parse it
      var text = await file.text();
      var parsed = parseProject(JSON.parse(text));

      // Save parsed scenes
      var scenesDir = await this.saveParsedProject(projectName, parsed);

      return {
        rawPath: rawPath,
        scenesDir: scenesDir,
        project: parsed,
      };
    },

    /** List all imported GDevelop projects */
    listProjects: async function () {
      if (!window.puter) return [];
      try {
        var items = await puter.fs.readdir(SCENES_DIR);
        var projects = [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].is_dir) {
            try {
              var blob = await puter.fs.read(items[i].path + '/manifest.json');
              var manifest = JSON.parse(await blob.text());
              projects.push(Object.assign({ dirName: items[i].name, path: items[i].path }, manifest));
            } catch (e) {
              projects.push({ dirName: items[i].name, path: items[i].path, name: items[i].name, sceneNames: [] });
            }
          }
        }
        return projects;
      } catch (e) {
        return [];
      }
    },

    /** Load a specific scene from a parsed project on Puter FS */
    loadScene: async function (projectPath, sceneName) {
      if (!window.puter) throw new Error('Puter SDK not available');
      var safeName = sceneName.replace(/[^a-zA-Z0-9_-]/g, '_');
      var blob = await puter.fs.read(projectPath + '/' + safeName + '.json');
      return JSON.parse(await blob.text());
    },

    /** Get the object type mapping */
    getTypeMap: function () { return Object.assign({}, TYPE_MAP); },

    /** Directories used */
    dirs: {
      gdevelopGames: GDEVELOP_DIR,
      editorScenes: SCENES_DIR,
    },
  };
})();
