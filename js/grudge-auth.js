/**
 * GrudgeAuth — Puter Auth + Grudge ID Service Connector
 *
 * Handles authentication via Puter.js SDK, links Puter UUIDs to Grudge IDs,
 * and manages JWT tokens for backend API calls.
 *
 * Auth flow:
 *   1. User signs in via Puter (puter.auth.signIn)
 *   2. Puter UUID is sent to id.grudge-studio.com/auth/puter to get/create a Grudge ID
 *   3. JWT token is stored and used for all subsequent API calls
 */
window.GrudgeAuth = (function () {
  'use strict';

  const AUTH_URL = 'https://id.grudge-studio.com';
  const TOKEN_KEY = 'grudge_jwt';
  const USER_KEY = 'grudge_user';

  let _token = null;
  let _user = null;
  let _puterUser = null;
  let _listeners = [];

  // ── Helpers ──

  function emit(event, data) {
    _listeners.forEach(function (l) {
      if (l.event === event || l.event === '*') l.fn(event, data);
    });
  }

  function storeSession(token, user) {
    _token = token;
    _user = user;
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) { /* private browsing */ }
  }

  function loadSession() {
    try {
      _token = sessionStorage.getItem(TOKEN_KEY);
      var raw = sessionStorage.getItem(USER_KEY);
      _user = raw ? JSON.parse(raw) : null;
    } catch (e) { /* ignore */ }
  }

  function clearSession() {
    _token = null;
    _user = null;
    _puterUser = null;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch (e) { /* ignore */ }
  }

  async function apiPost(path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (_token) headers['Authorization'] = 'Bearer ' + _token;
    var res = await fetch(AUTH_URL + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return { error: res.statusText }; });
      throw new Error(err.error || 'Auth request failed: ' + res.status);
    }
    return res.json();
  }

  async function apiGet(path) {
    var headers = {};
    if (_token) headers['Authorization'] = 'Bearer ' + _token;
    var res = await fetch(AUTH_URL + path, { headers: headers });
    if (!res.ok) {
      var err = await res.json().catch(function () { return { error: res.statusText }; });
      throw new Error(err.error || 'Auth request failed: ' + res.status);
    }
    return res.json();
  }

  // ── Public API ──

  return {
    /** Listen for auth events: 'login', 'logout', 'error', '*' */
    on: function (event, fn) {
      _listeners.push({ event: event, fn: fn });
    },

    off: function (event, fn) {
      _listeners = _listeners.filter(function (l) {
        return !(l.event === event && l.fn === fn);
      });
    },

    /** Initialize — restore session and check Puter sign-in state */
    init: async function () {
      loadSession();

      // Check if Puter SDK is available and user is signed in
      if (window.puter && puter.auth.isSignedIn()) {
        try {
          _puterUser = await puter.auth.getUser();
          emit('puter-ready', _puterUser);
        } catch (e) {
          // 401 = not signed in, normal
          _puterUser = null;
        }
      }

      if (_token) {
        // Verify existing token
        try {
          var data = await apiGet('/auth/verify');
          if (data.valid) {
            emit('login', _user);
            return _user;
          }
        } catch (e) { /* token expired */ }
        clearSession();
      }

      return null;
    },

    /** Sign in via Puter, then link to Grudge ID */
    signIn: async function () {
      if (!window.puter) throw new Error('Puter SDK not loaded');

      // Step 1: Puter sign-in
      if (!puter.auth.isSignedIn()) {
        await puter.auth.signIn();
      }
      _puterUser = await puter.auth.getUser();
      emit('puter-ready', _puterUser);

      // Step 2: Exchange Puter identity for Grudge JWT
      try {
        var data = await apiPost('/auth/puter', {
          puterUuid: _puterUser.uuid,
          puterUsername: _puterUser.username,
          email: _puterUser.email || null,
        });

        if (data.token) {
          var user = {
            grudgeId: data.grudgeId || data.grudge_id,
            username: data.username || _puterUser.username,
            displayName: data.displayName || _puterUser.username,
            puterUuid: _puterUser.uuid,
            isNew: !!data.isNewUser,
          };
          storeSession(data.token, user);
          emit('login', user);
          return user;
        }
      } catch (e) {
        // Fallback: create guest account linked to Puter UUID
        try {
          var guest = await apiPost('/auth/guest', {
            puterUuid: _puterUser.uuid,
            puterUsername: _puterUser.username,
          });
          if (guest.token) {
            var guestUser = {
              grudgeId: guest.grudgeId || guest.grudge_id,
              username: guest.username || 'Guest_' + _puterUser.username,
              displayName: guest.displayName || _puterUser.username,
              puterUuid: _puterUser.uuid,
              isNew: true,
              isGuest: true,
            };
            storeSession(guest.token, guestUser);
            emit('login', guestUser);
            return guestUser;
          }
        } catch (e2) {
          emit('error', { message: e2.message, phase: 'guest-fallback' });
        }
        emit('error', { message: e.message, phase: 'puter-auth' });
        throw e;
      }
    },

    /** Sign out from both Puter and Grudge */
    signOut: async function () {
      try {
        if (_token) await apiPost('/auth/logout', {}).catch(function () { });
      } catch (e) { /* ignore */ }

      if (window.puter && puter.auth.isSignedIn()) {
        try { await puter.auth.signOut(); } catch (e) { /* ignore */ }
      }

      clearSession();
      emit('logout', null);
    },

    /** Link a Puter account to an existing Grudge account */
    linkPuter: async function () {
      if (!_puterUser || !_token) throw new Error('Must be signed in to both Puter and Grudge');
      return apiPost('/auth/puter-link', {
        puterUuid: _puterUser.uuid,
        puterUsername: _puterUser.username,
      });
    },

    /** Get current Grudge user (or null) */
    getUser: function () { return _user; },

    /** Get current Puter user (or null) */
    getPuterUser: function () { return _puterUser; },

    /** Get current JWT token (or null) */
    getToken: function () { return _token; },

    /** Whether user is authenticated */
    isSignedIn: function () { return !!_token && !!_user; },

    /** Auth-aware fetch helper */
    fetch: async function (url, opts) {
      opts = opts || {};
      opts.headers = opts.headers || {};
      if (_token) opts.headers['Authorization'] = 'Bearer ' + _token;
      return fetch(url, opts);
    },
  };
})();
