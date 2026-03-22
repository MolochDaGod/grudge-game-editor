/**
 * GrudgeAPI — Game API Client (api.grudge-studio.com)
 *
 * Wraps all game backend endpoints: characters, economy, crafting,
 * combat, islands, missions, crews, PvP.
 *
 * Requires GrudgeAuth to be initialized first for JWT tokens.
 */
window.GrudgeAPI = (function () {
  'use strict';

  const API_URL = 'https://api.grudge-studio.com';
  const ACCOUNT_URL = 'https://account.grudge-studio.com';
  const WS_URL = 'https://ws.grudge-studio.com';

  // ── Internals ──

  function authHeaders(extra) {
    var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (window.GrudgeAuth && GrudgeAuth.getToken()) {
      h['Authorization'] = 'Bearer ' + GrudgeAuth.getToken();
    }
    return h;
  }

  async function api(method, path, body, baseUrl) {
    var url = (baseUrl || API_URL) + path;
    var opts = { method: method, headers: authHeaders() };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    var res = await fetch(url, opts);
    if (!res.ok) {
      var err = await res.json().catch(function () { return { error: res.statusText }; });
      throw new Error('API ' + method + ' ' + path + ' failed (' + res.status + '): ' + (err.error || err.message || res.statusText));
    }
    var ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  var GET = function (p, base) { return api('GET', p, null, base); };
  var POST = function (p, b, base) { return api('POST', p, b, base); };
  var PATCH = function (p, b, base) { return api('PATCH', p, b, base); };
  var DELETE = function (p, b, base) { return api('DELETE', p, b, base); };

  // ── Public API ──

  return {
    /** Health check */
    health: function () { return GET('/health'); },

    // ── Characters ──
    characters: {
      list:   function ()            { return GET('/characters'); },
      get:    function (id)          { return GET('/characters/' + id); },
      create: function (data)        { return POST('/characters', data); },
      update: function (id, data)    { return PATCH('/characters/' + id, data); },
    },

    // ── Economy ──
    economy: {
      balance:  function (charId)          { return GET('/economy/balance?char_id=' + charId); },
      spend:    function (data)            { return POST('/economy/spend', data); },
      transfer: function (data)            { return POST('/economy/transfer', data); },
    },

    // ── Crafting ──
    crafting: {
      recipes: function (query)   {
        var qs = '';
        if (query) {
          var params = new URLSearchParams();
          if (query.class) params.set('class', query.class);
          if (query.tier) params.set('tier', String(query.tier));
          qs = '?' + params.toString();
        }
        return GET('/crafting/recipes' + qs);
      },
      queue:   function ()         { return GET('/crafting/queue'); },
      start:   function (data)     { return POST('/crafting/start', data); },
      cancel:  function (id)       { return DELETE('/crafting/' + id); },
    },

    // ── Combat ──
    combat: {
      history:     function (charId) { return GET('/combat/history?char_id=' + charId); },
      leaderboard: function ()       { return GET('/combat/leaderboard'); },
    },

    // ── Islands ──
    islands: {
      list: function ()     { return GET('/islands'); },
      get:  function (key)  { return GET('/islands/' + key); },
    },

    // ── Missions ──
    missions: {
      list:     function ()         { return GET('/missions'); },
      create:   function (data)     { return POST('/missions', data); },
      complete: function (id)       { return PATCH('/missions/' + id + '/complete', {}); },
      abandon:  function (id)       { return DELETE('/missions/' + id); },
    },

    // ── Crews ──
    crews: {
      current:   function ()       { return GET('/crews'); },
      create:    function (data)   { return POST('/crews/create', data); },
      join:      function (id)     { return POST('/crews/' + id + '/join', {}); },
      leave:     function (id)     { return POST('/crews/' + id + '/leave', {}); },
      claimBase: function (id)     { return POST('/crews/' + id + '/claim-base', {}); },
    },

    // ── PvP ──
    pvp: {
      lobbies:     function (query) {
        var qs = '';
        if (query) {
          var params = new URLSearchParams();
          if (query.mode) params.set('mode', query.mode);
          if (query.limit) params.set('limit', String(query.limit));
          qs = '?' + params.toString();
        }
        return GET('/pvp/lobbies' + qs);
      },
      createLobby: function (data)   { return POST('/pvp/lobbies', data); },
      joinLobby:   function (code)   { return POST('/pvp/lobbies/' + code + '/join', {}); },
      readyLobby:  function (code)   { return POST('/pvp/lobbies/' + code + '/ready', {}); },
      leaveLobby:  function (code)   { return POST('/pvp/lobbies/' + code + '/leave', {}); },
      joinQueue:   function (data)   { return POST('/pvp/queue', data); },
      leaveQueue:  function ()       { return DELETE('/pvp/queue'); },
      queueStatus: function ()       { return GET('/pvp/queue'); },
      leaderboard: function (query) {
        var qs = '';
        if (query) {
          var params = new URLSearchParams();
          if (query.mode) params.set('mode', query.mode);
          if (query.limit) params.set('limit', String(query.limit));
          qs = '?' + params.toString();
        }
        return GET('/pvp/leaderboard' + qs);
      },
      match: function (id) { return GET('/pvp/match/' + id); },
    },

    // ── Account ──
    account: {
      profile: function ()      { return GET('/profile', ACCOUNT_URL); },
      wallet:  function ()      { return GET('/wallet', ACCOUNT_URL); },
    },

    // ── WebSocket helper ──
    /** Connect to a Socket.IO namespace (requires socket.io-client loaded) */
    connectWS: function (namespace) {
      if (typeof io === 'undefined') throw new Error('socket.io-client not loaded');
      var token = (window.GrudgeAuth && GrudgeAuth.getToken()) || '';
      return io(WS_URL + (namespace || '/game'), {
        auth: { token: token },
        transports: ['websocket', 'polling'],
      });
    },

    /** Get the API base URL */
    getApiUrl: function () { return API_URL; },
  };
})();
