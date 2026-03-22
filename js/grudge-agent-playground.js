/**
 * GrudgeAgentPlayground — Real Puter AI (no mock responses)
 *
 * Uses Puter free AI through puter.ai.chat() and function-calling tools
 * connected to live app state:
 * - Projects/scenes from GrudgeConnector
 * - Object storage assets from GrudgeObjectStore
 * - Config persistence in Puter FS
 */
window.GrudgeAgentPlayground = (function () {
  'use strict';

  const NOTE_DIR = '/GRUDA/editor-config/agent-notes';
  const MAX_TOOL_STEPS = 5;

  function safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function stringifyShort(value, maxLen) {
    maxLen = maxLen || 5000;
    var txt = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (txt.length > maxLen) return txt.slice(0, maxLen) + '\n...[truncated]';
    return txt;
  }

  function extractAssistantText(resp) {
    if (!resp) return '';
    if (typeof resp === 'string') return resp;
    if (resp.message && typeof resp.message.content === 'string') return resp.message.content;
    if (resp.message && Array.isArray(resp.message.content)) {
      return resp.message.content
        .map(function (c) { return c.text || c.content || ''; })
        .join('\n')
        .trim();
    }
    if (resp.choices && resp.choices[0] && resp.choices[0].message) {
      return resp.choices[0].message.content || '';
    }
    return '';
  }

  function extractToolCalls(resp) {
    if (!resp) return [];
    if (resp.message && Array.isArray(resp.message.tool_calls)) return resp.message.tool_calls;
    if (resp.choices && resp.choices[0] && resp.choices[0].message && Array.isArray(resp.choices[0].message.tool_calls)) {
      return resp.choices[0].message.tool_calls;
    }
    return [];
  }

  async function ensureReady() {
    if (!window.puter) throw new Error('Puter SDK not available');
    if (!window.GrudgeConnector) throw new Error('GrudgeConnector not available');
    if (!GrudgeConnector.isReady()) {
      await GrudgeConnector.init();
    }
    if (!puter.auth.isSignedIn()) {
      await GrudgeConnector.signIn();
    }
    try { await puter.fs.mkdir(NOTE_DIR, { createMissingParents: true }); } catch (e) {}
  }

  async function tool_list_projects() {
    var projects = await GrudgeConnector.listGDevelopProjects();
    return projects.map(function (p) {
      return {
        name: p.name || p.dirName,
        path: p.path,
        scenes: p.sceneNames || [],
        sceneCount: (p.sceneNames || []).length,
      };
    });
  }

  async function tool_inspect_scene(args) {
    if (!args || !args.projectPath || !args.sceneName) {
      throw new Error('projectPath and sceneName are required');
    }
    var scene = await GrudgeConnector.loadScene(args.projectPath, args.sceneName);
    return {
      name: scene.name,
      objectCount: Object.keys(scene.objects || {}).length,
      instanceCount: (scene.instances || []).length,
      layerCount: (scene.layers || []).length,
      objectNames: Object.keys(scene.objects || {}),
      layers: (scene.layers || []).map(function (l) { return l.name || '(base)'; }),
    };
  }

  async function tool_search_assets(args) {
    args = args || {};
    var result = await GrudgeObjectStore.r2.list({
      q: args.query || undefined,
      category: args.category || undefined,
      limit: args.limit || 25,
      offset: args.offset || 0,
    });
    var items = result.items || [];
    return {
      count: result.count || items.length,
      items: items.map(function (a) {
        return {
          id: a.id,
          filename: a.filename,
          category: a.category,
          mime: a.mime,
          size: a.size,
          fileUrl: GrudgeObjectStore.r2.fileUrl(a.id),
        };
      }),
    };
  }

  async function tool_get_game_data(args) {
    var dataset = (args && args.dataset) || 'weapons';
    if (!GrudgeObjectStore.gameData[dataset]) {
      throw new Error('Unknown dataset: ' + dataset);
    }
    var data = await GrudgeObjectStore.gameData[dataset]();
    return { dataset: dataset, data: data };
  }

  async function tool_save_note(args) {
    if (!args || !args.projectName || !args.note) throw new Error('projectName and note are required');
    var safeProject = args.projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    var safeCategory = (args.category || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
    var filename = safeProject + '_' + safeCategory + '_' + Date.now() + '.json';
    var path = NOTE_DIR + '/' + filename;
    var payload = {
      projectName: args.projectName,
      category: args.category || 'general',
      note: args.note,
      createdAt: new Date().toISOString(),
      by: 'agent-playground',
    };
    await puter.fs.write(path, JSON.stringify(payload, null, 2), { createMissingParents: true });
    return { saved: true, path: path };
  }

  var TOOL_IMPL = {
    list_projects: tool_list_projects,
    inspect_scene: tool_inspect_scene,
    search_assets: tool_search_assets,
    get_game_data: tool_get_game_data,
    save_project_note: tool_save_note,
  };

  var TOOL_SCHEMA = [
    {
      type: 'function',
      function: {
        name: 'list_projects',
        description: 'List available imported game projects and their scene names',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'inspect_scene',
        description: 'Inspect a scene in a project and return structure summary',
        parameters: {
          type: 'object',
          properties: {
            projectPath: { type: 'string', description: 'Puter FS path to the parsed project' },
            sceneName: { type: 'string', description: 'Scene name from the project manifest' },
          },
          required: ['projectPath', 'sceneName'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_assets',
        description: 'Search live object storage assets in R2',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            category: { type: 'string' },
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_game_data',
        description: 'Fetch static game dataset from ObjectStore API',
        parameters: {
          type: 'object',
          properties: {
            dataset: {
              type: 'string',
              enum: ['weapons', 'armor', 'materials', 'consumables', 'skills', 'professions', 'races', 'classes', 'factions', 'attributes', 'bosses', 'enemies'],
            },
          },
          required: ['dataset'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_project_note',
        description: 'Persist an agent note to Puter cloud storage for a project',
        parameters: {
          type: 'object',
          properties: {
            projectName: { type: 'string' },
            category: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['projectName', 'note'],
        },
      },
    },
  ];

  async function runTools(toolCalls, messages, hooks) {
    for (var i = 0; i < toolCalls.length; i++) {
      var tc = toolCalls[i];
      var fnName = tc.function && tc.function.name;
      var fnArgs = safeJsonParse((tc.function && tc.function.arguments) || '{}', {});

      if (!fnName || !TOOL_IMPL[fnName]) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id || ('unknown_' + i),
          content: JSON.stringify({ error: 'Unknown tool: ' + fnName }),
        });
        continue;
      }

      hooks && hooks.onToolStart && hooks.onToolStart(fnName, fnArgs);
      try {
        var result = await TOOL_IMPL[fnName](fnArgs);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id || (fnName + '_' + i),
          content: stringifyShort(result, 9000),
        });
        hooks && hooks.onToolEnd && hooks.onToolEnd(fnName, result);
      } catch (err) {
        var errPayload = { error: err.message || String(err) };
        messages.push({
          role: 'tool',
          tool_call_id: tc.id || (fnName + '_' + i),
          content: JSON.stringify(errPayload),
        });
        hooks && hooks.onToolError && hooks.onToolError(fnName, errPayload);
      }
    }
  }

  return {
    /**
     * Chat with real Puter AI and live app tools.
     * @param {Array<{role:string, content:string}>} history
     * @param {{model?:string, temperature?:number, maxTokens?:number}} options
     * @param {{onToolStart?:Function,onToolEnd?:Function,onToolError?:Function}} hooks
     */
    chat: async function (history, options, hooks) {
      options = options || {};
      await ensureReady();

      var systemPrompt = [
        'You are the Grudge Engine Agent Playground assistant.',
        'Never fabricate asset, project, or scene data.',
        'Use tools whenever project/scenes/assets/game-data are needed.',
        'Keep responses concise and implementation-focused.',
      ].join(' ');

      var messages = [{ role: 'system', content: systemPrompt }];
      (history || []).forEach(function (m) {
        if (m && m.role && m.content != null) {
          messages.push({ role: m.role, content: String(m.content) });
        }
      });

      var steps = 0;
      while (steps < MAX_TOOL_STEPS) {
        steps++;
        var resp = await puter.ai.chat(messages, {
          model: options.model || undefined,
          temperature: options.temperature != null ? options.temperature : 0.2,
          max_tokens: options.maxTokens || 1200,
          tools: TOOL_SCHEMA,
        });

        var assistantText = extractAssistantText(resp);
        var toolCalls = extractToolCalls(resp);

        // Persist assistant message in history
        messages.push({
          role: 'assistant',
          content: assistantText || '',
          tool_calls: toolCalls && toolCalls.length ? toolCalls : undefined,
        });

        if (!toolCalls || !toolCalls.length) {
          return {
            text: assistantText || '(no text returned)',
            messages: messages,
            usedTools: steps > 1,
          };
        }

        await runTools(toolCalls, messages, hooks);
      }

      return {
        text: 'Tool loop limit reached. Please retry with a narrower request.',
        messages: messages,
        usedTools: true,
      };
    },

    /** Return true when Puter AI is available in this runtime */
    isAvailable: function () {
      return !!(window.puter && puter.ai && typeof puter.ai.chat === 'function');
    },
  };
})();
