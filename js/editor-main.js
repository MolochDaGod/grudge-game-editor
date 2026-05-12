/**
 * editor-main.js — Grudge Game Editor Main Controller
 *
 * Handles: tab routing, 3D viewport (Three.js + GLTFLoader), asset upload,
 * scene hierarchy, animation preview, character management, agent chat.
 */
(function () {
  'use strict';

  // ── State ──
  var _gameData = null;
  var _projects = [];
  var _animations = [];
  var _agentMessages = [];
  var _currentScene = null;
  var _selectedNode = null;
  var _assetFile = null;
  var _assetSearchTimer = null;

  // ── Three.js state ──
  var _three = {
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    gltfLoader: null,
    raycaster: null,
    mouse: null,
    objects: [],
    grid: null,
    animFrameId: null,
    wireframe: false,
    selectedMesh: null,
  };

  // ── Utility ──

  function log(msg, type) {
    var el = document.getElementById('init-log');
    if (!el) return;
    var line = document.createElement('div');
    line.className = 'line' + (type ? ' ' + type : '');
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  function syncPathToTab(name) {
    var path = '/' + name;
    if (name === 'dashboard') path = '/';
    if (name === 'characterstudio') path = '/character-studio';
    if (name === 'agentplayground') path = '/agent-playground';
    if (name === 'gamedata') path = '/game-data';
    try {
      if (window.location.pathname !== path) history.replaceState({}, '', path);
    } catch (e) {}
  }

  // ── Tab routing ──

  window.switchTab = function (name) {
    document.querySelectorAll('.tab-content').forEach(function (el) { el.classList.remove('active'); });
    document.querySelectorAll('.sidebar-item').forEach(function (el) { el.classList.remove('active'); });
    var tab = document.getElementById('tab-' + name);
    if (tab) tab.classList.add('active');
    var item = document.querySelector('.sidebar-item[data-tab="' + name + '"]');
    if (item) item.classList.add('active');
    syncPathToTab(name);

    if (name === 'scenes' && _three.renderer) {
      setTimeout(function () { resizeRenderer(); }, 50);
    }
  };

  function bootstrapTabFromPath() {
    var path = (window.location.pathname || '/').toLowerCase();

    // Dedicated /auth route — shows focused login page, supports ?redirect=
    if (path === '/auth') {
      showAuthPage();
      return;
    }

    var map = {
      '/animations': 'animations',
      '/character-studio': 'characterstudio',
      '/agent-playground': 'agentplayground',
      '/assets': 'assets',
      '/game-data': 'gamedata',
      '/scenes': 'scenes',
      '/import': 'import',
      '/characters': 'characterstudio',
    };
    var tab = map[path] || 'dashboard';
    switchTab(tab);
  }

  // ── Dedicated Auth Page ──

  function showAuthPage() {
    // Hide the full editor UI, show the auth page
    var mainEl = document.querySelector('.main');
    var headerEl = document.querySelector('.header');
    if (mainEl) mainEl.style.display = 'none';
    if (headerEl) headerEl.style.display = 'none';

    // Create auth page container
    var authDiv = document.createElement('div');
    authDiv.id = 'auth-page';
    authDiv.innerHTML = '<div style="min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); padding:20px;">' +
      '<div style="max-width:420px; width:100%; text-align:center;">' +
        '<div style="margin-bottom:24px;">' +
          '<div style="font-size:48px; margin-bottom:12px;">&#9876;</div>' +
          '<h1 style="font-size:22px; color:var(--accent); font-weight:700; margin-bottom:4px;">Sign in to Grudge Studio</h1>' +
          '<p style="font-size:13px; color:var(--text-dim); line-height:1.5;">Authenticate with your Puter account to access Grudge Studio services. Your Grudge ID links all games, saves, and assets.</p>' +
        '</div>' +
        '<div id="auth-status" style="margin-bottom:16px;"></div>' +
        '<button class="btn primary" id="auth-page-btn" onclick="authPageSignIn()" style="width:100%; padding:12px; font-size:14px;">' +
          'Sign in with Puter' +
        '</button>' +
        '<div style="display:flex; gap:8px; margin-top:12px;">' +
          '<button class="btn" onclick="authOAuth(\'google\')" style="flex:1; padding:10px; font-size:12px;">Google</button>' +
          '<button class="btn" onclick="authOAuth(\'discord\')" style="flex:1; padding:10px; font-size:12px;">Discord</button>' +
          '<button class="btn" onclick="authOAuth(\'github\')" style="flex:1; padding:10px; font-size:12px;">GitHub</button>' +
        '</div>' +
        '<div style="margin-top:16px;">' +
          '<p style="font-size:11px; color:var(--text-dim);">Sign in with Puter (recommended) or use Google, Discord, or GitHub. Your Grudge ID is minted automatically.</p>' +
        '</div>' +
        '<div id="auth-error" style="margin-top:12px; color:var(--red); font-size:12px; display:none;"></div>' +
        '<div style="margin-top:24px; border-top:1px solid var(--border); padding-top:16px;">' +
          '<p style="font-size:10px; color:var(--text-dim);">Grudge Studio · by Racalvin The Pirate King</p>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.appendChild(authDiv);

    // If already signed in, show status and handle redirect
    if (window.GrudgeAuth && GrudgeAuth.isSignedIn()) {
      authPageShowSignedIn(GrudgeAuth.getUser());
    }
  }

  window.authOAuth = function (provider) {
    var authBase = 'https://id.grudge-studio.com/auth/';
    var params = new URLSearchParams(window.location.search);
    var redirect = params.get('redirect') || params.get('returnTo') || params.get('next') || window.location.origin;
    var url = authBase + provider + '?redirect=' + encodeURIComponent(redirect);
    window.location.href = url;
  };

  window.authPageSignIn = async function () {
    var btn = document.getElementById('auth-page-btn');
    var errEl = document.getElementById('auth-error');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in\u2026'; }
    if (errEl) errEl.style.display = 'none';

    try {
      // Initialize connector if not already
      if (!GrudgeConnector.isReady()) {
        await GrudgeConnector.init({ onLog: function () {} });
      }
      var user = await GrudgeConnector.signIn();
      authPageShowSignedIn(user);
    } catch (e) {
      if (errEl) {
        errEl.textContent = 'Sign-in failed: ' + e.message;
        errEl.style.display = 'block';
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in with Puter'; }
    }
  };

  function authPageShowSignedIn(user) {
    var statusEl = document.getElementById('auth-status');
    var btn = document.getElementById('auth-page-btn');
    var name = (user && (user.username || user.displayName)) || 'Unknown';
    var grudgeId = (user && user.grudgeId) || '';

    if (statusEl) {
      statusEl.innerHTML = '<div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:8px;">' +
        '<div style="color:var(--green); font-size:13px; font-weight:600; margin-bottom:4px;">&#10003; Signed in</div>' +
        '<div style="font-size:14px; color:var(--accent); font-weight:600;">' + escapeHtml(name) + '</div>' +
        (grudgeId ? '<div style="font-size:11px; color:var(--text-dim); font-family:monospace;">' + escapeHtml(grudgeId) + '</div>' : '') +
      '</div>';
    }

    // Check for ?redirect= parameter
    var params = new URLSearchParams(window.location.search);
    var redirectUrl = params.get('redirect') || params.get('returnTo') || params.get('next');

    if (redirectUrl) {
      // Validate the redirect is to a Grudge domain
      try {
        var u = new URL(redirectUrl);
        var allowed = /(grudge-studio\.com|grudgewarlords\.com|grudgeplatform\.io|vercel\.app|puter\.site|grudgestudio\.com)$/i;
        if (allowed.test(u.hostname) || u.hostname === 'localhost') {
          // Append token as hash fragment (not query) for security
          var token = GrudgeAuth.getToken();
          if (token) {
            var sep = redirectUrl.includes('#') ? '&' : '#';
            redirectUrl += sep + 'grudge_token=' + encodeURIComponent(token);
          }
          if (statusEl) {
            statusEl.innerHTML += '<p style="font-size:12px; color:var(--text-dim); margin-top:8px;">Redirecting to ' + escapeHtml(u.hostname) + '\u2026</p>';
          }
          setTimeout(function () { window.location.href = redirectUrl; }, 1500);
          return;
        }
      } catch (e) { /* invalid URL, ignore redirect */ }
    }

    // No redirect — offer to continue to editor or go to other Grudge apps
    if (btn) {
      btn.textContent = 'Continue to Editor';
      btn.disabled = false;
      btn.className = 'btn primary';
      btn.onclick = function () {
        var authPage = document.getElementById('auth-page');
        if (authPage) authPage.remove();
        var mainEl = document.querySelector('.main');
        var headerEl = document.querySelector('.header');
        if (mainEl) mainEl.style.display = 'flex';
        if (headerEl) headerEl.style.display = 'flex';
        history.replaceState({}, '', '/');
        switchTab('dashboard');
        refreshStatus();
      };
    }
  }

  // ── Status display ──

  function updateStatusUI(status) {
    var map = { puter: 's-puter', puterAI: 's-puterai', auth: 's-auth', objectStore: 's-r2', api: 's-api', puterFS: 's-fs' };
    Object.keys(map).forEach(function (key) {
      var el = document.getElementById(map[key]);
      if (!el) return;
      el.textContent = status[key] ? 'Online' : 'Offline';
      el.style.color = status[key] ? 'var(--green)' : 'var(--red)';
    });

    var online = Object.values(status).filter(Boolean).length;
    var total = Object.keys(status).length;
    var connEl = document.getElementById('conn-status');
    if (connEl) {
      connEl.textContent = online + '/' + total + ' connected';
      connEl.style.color = online === total ? 'var(--green)' : online > 0 ? 'var(--accent)' : 'var(--red)';
    }

    var btn = document.getElementById('btn-auth');
    if (btn) {
      if (window.GrudgeAuth && GrudgeAuth.isSignedIn()) {
        var user = GrudgeAuth.getUser();
        btn.textContent = (user && user.username) ? user.username : 'Signed In';
        btn.className = 'btn';
      } else {
        btn.textContent = 'Sign In';
        btn.className = 'btn primary';
      }
    }
  }

  // ── Init ──

  async function initConnector() {
    bootstrapTabFromPath();
    try {
      var status = await GrudgeConnector.init({
        onLog: function (msg) {
          var type = msg.includes('✓') ? 'ok' : msg.includes('✗') ? 'err' : '';
          log(msg, type);
        },
      });
      updateStatusUI(status);
      await refreshProjectsList();
      populateProjectSelects();
      initThreeViewport();
    } catch (e) {
      log('Init failed: ' + e.message, 'err');
    }
  }

  // ── Auth ──

  window.handleAuth = async function () {
    if (window.GrudgeAuth && GrudgeAuth.isSignedIn()) {
      if (confirm('Sign out?')) {
        await GrudgeConnector.signOut();
        updateStatusUI(GrudgeConnector.getStatus());
        log('Signed out.', '');
      }
    } else {
      try {
        log('Signing in...', '');
        var user = await GrudgeConnector.signIn();
        log('Signed in as ' + user.username, 'ok');
        updateStatusUI(GrudgeConnector.getStatus());
        await refreshProjectsList();
        populateProjectSelects();
      } catch (e) {
        log('Sign in failed: ' + e.message, 'err');
      }
    }
  };

  window.refreshStatus = async function () {
    log('Refreshing status...', '');
    var status = await GrudgeConnector.refresh();
    updateStatusUI(status);
    log('Status refreshed.', 'ok');
  };

  // ── GDevelop Import ──

  var dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) importFile(e.dataTransfer.files[0]);
    });
  }

  window.handleFileSelect = function (e) {
    if (e.target.files.length > 0) importFile(e.target.files[0]);
  };

  async function importFile(file) {
    log('Importing ' + file.name + '...', '');
    showImportProgress(10, 'Reading file...');
    try {
      showImportProgress(30, 'Parsing GDevelop project...');
      var result = await GrudgeConnector.importGDevelopGame(file);
      showImportProgress(80, 'Saving scenes to Puter FS...');
      var project = result.project || result;
      showImportProgress(100, 'Done!');

      var el = document.getElementById('import-result');
      if (el) el.style.display = 'block';
      var html = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">';
      html += '<div class="status-card"><div class="label">Project</div><div class="value" style="font-size:12px;">' + escapeHtml(project.name) + '</div></div>';
      html += '<div class="status-card"><div class="label">Scenes</div><div class="value">' + project.sceneNames.length + '</div></div>';
      html += '<div class="status-card"><div class="label">Window</div><div class="value" style="font-size:11px;">' + project.windowWidth + 'x' + project.windowHeight + '</div></div>';
      html += '<div class="status-card"><div class="label">Extensions</div><div class="value">' + (project.extensions || []).length + '</div></div>';
      html += '</div>';
      html += '<p style="font-size:12px; color:var(--text-dim); margin-bottom:8px;">Scenes: ' + project.sceneNames.map(escapeHtml).join(', ') + '</p>';
      if (result.rawPath) html += '<p style="font-size:11px; color:var(--text-dim);">Stored at: <code>' + escapeHtml(result.rawPath) + '</code></p>';
      var detailEl = document.getElementById('import-details');
      if (detailEl) detailEl.innerHTML = html;

      log('Imported ' + project.name + ' — ' + project.sceneNames.length + ' scenes', 'ok');
      await refreshProjectsList();
      populateProjectSelects();
      setTimeout(function () { hideImportProgress(); }, 1500);
    } catch (e) {
      log('Import failed: ' + e.message, 'err');
      hideImportProgress();
    }
  }

  function showImportProgress(pct, text) {
    var wrap = document.getElementById('import-progress');
    var bar = document.getElementById('import-progress-bar');
    var txt = document.getElementById('import-progress-text');
    if (wrap) wrap.style.display = 'block';
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = text;
  }

  function hideImportProgress() {
    var wrap = document.getElementById('import-progress');
    if (wrap) wrap.style.display = 'none';
  }

  // ── Projects list ──

  async function refreshProjectsList() {
    try {
      _projects = await GrudgeConnector.listGDevelopProjects();
    } catch (e) {
      _projects = [];
    }
    renderProjectsSidebar();
  }

  function renderProjectsSidebar() {
    var el = document.getElementById('projects-list-panel');
    if (!el) return;
    if (_projects.length === 0) {
      el.innerHTML = '<h3>Projects</h3><p style="font-size:11px; color:var(--text-dim);">No projects imported yet</p>';
      return;
    }
    var html = '<h3>Projects (' + _projects.length + ')</h3>';
    _projects.forEach(function (p) {
      var name = escapeHtml(p.name || p.dirName || 'Unnamed');
      var scenes = p.sceneNames ? p.sceneNames.length : 0;
      html += '<div class="sidebar-item" onclick="openProjectFromSidebar(' + JSON.stringify(encodeURIComponent(p.path)) + ')">';
      html += '<span class="icon">&#9783;</span>';
      html += '<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + name + '</span>';
      if (scenes) html += '<span class="sidebar-badge">' + scenes + '</span>';
      html += '</div>';
    });
    el.innerHTML = html;
  }

  window.openProjectFromSidebar = function (encodedPath) {
    var path = decodeURIComponent(encodedPath);
    var proj = _projects.find(function (p) { return p.path === path; });
    if (!proj) return;
    switchTab('scenes');
    var projSelect = document.getElementById('scene-project-select');
    if (projSelect) {
      projSelect.value = path;
      onProjectSelect();
    }
  };

  function populateProjectSelects() {
    var sel = document.getElementById('scene-project-select');
    if (!sel) return;
    var prev = sel.value;
    var html = '<option value="">-- Select Project --</option>';
    _projects.forEach(function (p) {
      var name = escapeHtml(p.name || p.dirName || 'Unnamed');
      var selected = p.path === prev ? ' selected' : '';
      html += '<option value="' + escapeHtml(p.path) + '"' + selected + '>' + name + '</option>';
    });
    sel.innerHTML = html;
    if (prev) onProjectSelect();
  }

  window.onProjectSelect = function () {
    var projSel = document.getElementById('scene-project-select');
    var sceneSel = document.getElementById('scene-scene-select');
    if (!projSel || !sceneSel) return;
    var path = projSel.value;
    if (!path) {
      sceneSel.innerHTML = '<option value="">-- Select Scene --</option>';
      sceneSel.disabled = true;
      return;
    }
    var proj = _projects.find(function (p) { return p.path === path; });
    if (!proj || !proj.sceneNames) { sceneSel.disabled = true; return; }
    var html = '<option value="">-- Select Scene --</option>';
    proj.sceneNames.forEach(function (name) {
      html += '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
    });
    sceneSel.innerHTML = html;
    sceneSel.disabled = false;
    if (proj.sceneNames.length === 1) {
      sceneSel.value = proj.sceneNames[0];
      loadSceneView();
    }
  };

  window.loadSceneView = async function () {
    var projSel = document.getElementById('scene-project-select');
    var sceneSel = document.getElementById('scene-scene-select');
    if (!projSel || !sceneSel || !sceneSel.value) return;
    var projectPath = projSel.value;
    var sceneName = sceneSel.value;
    try {
      _currentScene = await GrudgeConnector.loadScene(projectPath, sceneName);
      renderSceneEditor(_currentScene);
    } catch (e) {
      log('Failed to load scene: ' + e.message, 'err');
    }
  };

  // ── 3D Scene Editor ──

  function initThreeViewport() {
    if (!window.THREE) return;
    var container = document.getElementById('scene-3d-canvas');
    if (!container) return;

    _three.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    _three.renderer.setPixelRatio(window.devicePixelRatio);
    _three.renderer.shadowMap.enabled = true;
    _three.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _three.renderer.setClearColor(0x080812, 1);
    container.appendChild(_three.renderer.domElement);

    _three.scene = new THREE.Scene();
    _three.scene.fog = new THREE.Fog(0x080812, 80, 200);

    _three.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    _three.camera.position.set(10, 10, 15);
    _three.camera.lookAt(0, 0, 0);

    if (THREE.OrbitControls) {
      _three.controls = new THREE.OrbitControls(_three.camera, _three.renderer.domElement);
      _three.controls.enableDamping = true;
      _three.controls.dampingFactor = 0.05;
    }

    // Lights
    var ambient = new THREE.AmbientLight(0xffffff, 0.4);
    _three.scene.add(ambient);
    var dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    _three.scene.add(dirLight);
    var fillLight = new THREE.DirectionalLight(0xd4a84b, 0.3);
    fillLight.position.set(-10, 5, -10);
    _three.scene.add(fillLight);

    // Grid
    _three.grid = new THREE.GridHelper(100, 50, 0x2a2a3a, 0x1a1a2a);
    _three.scene.add(_three.grid);

    if (THREE.GLTFLoader) {
      _three.gltfLoader = new THREE.GLTFLoader();
    }

    _three.raycaster = new THREE.Raycaster();
    _three.mouse = new THREE.Vector2();

    _three.renderer.domElement.addEventListener('click', onViewportClick);
    window.addEventListener('resize', resizeRenderer);
    resizeRenderer();
    startRenderLoop();
  }

  function resizeRenderer() {
    if (!_three.renderer) return;
    var container = document.getElementById('scene-3d-canvas');
    if (!container) return;
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (w === 0 || h === 0) return;
    _three.renderer.setSize(w, h);
    if (_three.camera) {
      _three.camera.aspect = w / h;
      _three.camera.updateProjectionMatrix();
    }
  }

  function startRenderLoop() {
    function animate() {
      _three.animFrameId = requestAnimationFrame(animate);
      if (_three.controls) _three.controls.update();
      if (_three.renderer && _three.scene && _three.camera) {
        _three.renderer.render(_three.scene, _three.camera);
      }
    }
    animate();
  }

  function clearViewport() {
    if (!_three.scene) return;
    var toRemove = [];
    _three.scene.traverse(function (obj) {
      if (obj !== _three.grid && obj.parent === _three.scene && !(obj instanceof THREE.Light)) {
        toRemove.push(obj);
      }
    });
    toRemove.forEach(function (obj) { _three.scene.remove(obj); });
    _three.objects = [];
    _three.selectedMesh = null;
  }

  function renderSceneEditor(scene) {
    var placeholder = document.getElementById('canvas-placeholder');
    var controls = document.getElementById('canvas-controls');
    if (placeholder) placeholder.style.display = 'none';
    if (controls) controls.style.display = 'flex';
    resizeRenderer();

    clearViewport();
    _three.objects = [];

    var instances = scene.instances || [];
    var objects = scene.objects || {};
    var placed = 0;

    instances.forEach(function (inst) {
      var def = objects[inst.objectName] || {};
      var type = def.type || 'unknown';
      var mesh = null;

      if (type === 'model-3d' && def.model3d && def.model3d.url && _three.gltfLoader) {
        _three.gltfLoader.load(def.model3d.url, function (gltf) {
          var model = gltf.scene;
          model.position.set(inst.x * 0.01, inst.z * 0.01 || 0, inst.y * 0.01);
          model.rotation.set(
            (inst.rotationX || 0) * Math.PI / 180,
            (inst.angle || 0) * Math.PI / 180,
            (inst.rotationY || 0) * Math.PI / 180
          );
          model.userData = { instanceData: inst, def: def, name: inst.objectName };
          model.traverse(function (child) {
            if (child.isMesh) {
              child.userData = model.userData;
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          _three.scene.add(model);
          _three.objects.push(model);
        }, null, function (err) {
          mesh = makeProxyMesh(inst, def, type);
          if (mesh) { _three.scene.add(mesh); _three.objects.push(mesh); }
        });
        return;
      }

      mesh = makeProxyMesh(inst, def, type);
      if (mesh) {
        _three.scene.add(mesh);
        _three.objects.push(mesh);
        placed++;
      }
    });

    // Build hierarchy panel
    renderHierarchyPanel(scene);
    renderSceneStats(scene);
    renderSidebarObjects(scene);

    var saveBtn = document.getElementById('btn-save-scene');
    if (saveBtn) saveBtn.disabled = false;

    log('Loaded scene "' + scene.name + '" — ' + instances.length + ' instances', 'ok');
  }

  function makeProxyMesh(inst, def, type) {
    var geo, mat, mesh;
    var color = typeColor(type);
    var scale = 0.01;

    var w = (inst.width || 64) * scale;
    var h = (inst.height || 64) * scale;
    var d = (inst.depth || 64) * scale;

    if (type === 'cube-3d') {
      geo = new THREE.BoxGeometry(w, h, d);
    } else if (type === 'sprite' || type === 'tiled-sprite' || type === 'panel-sprite') {
      geo = new THREE.PlaneGeometry(w, h);
    } else if (type === 'text' || type === 'rich-text' || type === 'bitmap-text') {
      geo = new THREE.PlaneGeometry(w * 2, h * 0.5);
    } else if (type === 'particles') {
      geo = new THREE.SphereGeometry(Math.max(w, h) * 0.5, 8, 8);
    } else {
      geo = new THREE.BoxGeometry(Math.max(w, 0.3), Math.max(h, 0.3), Math.max(d, 0.1));
    }

    mat = new THREE.MeshLambertMaterial({
      color: color,
      transparent: true,
      opacity: 0.85,
    });

    mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(inst.x * scale, (inst.z || 0) * scale, inst.y * scale);
    mesh.rotation.y = (inst.angle || 0) * Math.PI / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { instanceData: inst, def: def, type: type, name: inst.objectName };
    return mesh;
  }

  function typeColor(type) {
    var map = {
      'sprite': 0x60a5fa,
      'tiled-sprite': 0x60a5fa,
      'panel-sprite': 0x60a5fa,
      'cube-3d': 0xd4a84b,
      'model-3d': 0x4ade80,
      'text': 0xfbbf24,
      'particles': 0xf87171,
      'shape': 0xa78bfa,
      'tilemap': 0x6b7280,
      'spine': 0x34d399,
    };
    return map[type] || 0x8a8a9a;
  }

  function onViewportClick(e) {
    if (!_three.renderer) return;
    var rect = _three.renderer.domElement.getBoundingClientRect();
    _three.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _three.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _three.raycaster.setFromCamera(_three.mouse, _three.camera);

    var meshes = [];
    _three.objects.forEach(function (obj) {
      if (obj.isMesh) meshes.push(obj);
      obj.traverse(function (child) { if (child.isMesh) meshes.push(child); });
    });

    var hits = _three.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      var hit = hits[0].object;
      selectViewportObject(hit);
    }
  }

  function selectViewportObject(mesh) {
    // Deselect previous
    if (_three.selectedMesh) {
      var prevMat = _three.selectedMesh.material;
      if (prevMat && prevMat._origEmissive !== undefined) {
        prevMat.emissive.setHex(prevMat._origEmissive);
      }
    }
    _three.selectedMesh = mesh;

    // Highlight
    if (mesh.material) {
      if (mesh.material._origEmissive === undefined) {
        mesh.material._origEmissive = mesh.material.emissive ? mesh.material.emissive.getHex() : 0;
      }
      if (mesh.material.emissive) mesh.material.emissive.setHex(0xd4a84b);
    }

    var data = mesh.userData;
    var name = data.name || 'Unknown';

    // Update hierarchy selection
    document.querySelectorAll('.hierarchy-node').forEach(function (n) { n.classList.remove('selected'); });
    var node = document.querySelector('.hierarchy-node[data-name="' + CSS.escape(name) + '"]');
    if (node) { node.classList.add('selected'); node.scrollIntoView({ block: 'nearest' }); }

    renderInspector(data);
  }

  function renderInspector(data) {
    var el = document.getElementById('inspector-content');
    if (!el) return;
    if (!data) {
      el.innerHTML = '<p style="font-size:11px; color:var(--text-dim);">Select an object</p>';
      return;
    }
    var inst = data.instanceData || {};
    var def = data.def || {};
    var html = '';

    html += '<div class="inspector-field"><label>Name</label><input type="text" value="' + escapeHtml(data.name || '') + '" readonly /></div>';
    html += '<div class="inspector-field"><label>Type</label><input type="text" value="' + escapeHtml(data.type || def.type || 'unknown') + '" readonly /></div>';
    html += '<div class="inspector-field"><label>Layer</label><input type="text" value="' + escapeHtml(inst.layer || '') + '" readonly /></div>';
    html += '<div class="inspector-field"><label>Position X</label><input type="number" value="' + (inst.x || 0) + '" onchange="updateEntityPosition(\'x\', this.value)" /></div>';
    html += '<div class="inspector-field"><label>Position Y</label><input type="number" value="' + (inst.y || 0) + '" onchange="updateEntityPosition(\'y\', this.value)" /></div>';
    html += '<div class="inspector-field"><label>Position Z</label><input type="number" value="' + (inst.z || 0) + '" onchange="updateEntityPosition(\'z\', this.value)" /></div>';
    html += '<div class="inspector-field"><label>Rotation</label><input type="number" value="' + (inst.angle || 0) + '" /></div>';
    html += '<div class="inspector-field"><label>Z-Order</label><input type="number" value="' + (inst.zOrder || 0) + '" readonly /></div>';

    if (def.behaviors && def.behaviors.length) {
      html += '<div class="inspector-field"><label>Behaviors</label>';
      def.behaviors.forEach(function (b) {
        html += '<div class="chip" style="margin:2px 0; display:block;">' + escapeHtml(b.name) + '</div>';
      });
      html += '</div>';
    }

    if (def.model3d) {
      html += '<div class="inspector-field"><label>3D Model</label><input type="text" value="' + escapeHtml(def.model3d.modelResourceName || '') + '" readonly /></div>';
      html += '<div class="inspector-field"><label>Dimensions</label><input type="text" value="' + def.model3d.width + 'x' + def.model3d.height + 'x' + def.model3d.depth + '" readonly /></div>';
    }

    el.innerHTML = html;
  }

  window.updateEntityPosition = function (axis, val) {
    if (!_three.selectedMesh) return;
    var v = parseFloat(val) || 0;
    var scale = 0.01;
    if (axis === 'x') _three.selectedMesh.position.x = v * scale;
    if (axis === 'y') _three.selectedMesh.position.z = v * scale;
    if (axis === 'z') _three.selectedMesh.position.y = v * scale;
    var saveBtn = document.getElementById('btn-save-scene');
    if (saveBtn) saveBtn.disabled = false;
  };

  function renderHierarchyPanel(scene) {
    var el = document.getElementById('hierarchy-list');
    if (!el) return;
    var instances = scene.instances || [];
    if (instances.length === 0) {
      el.innerHTML = '<p style="padding:8px; font-size:11px; color:var(--text-dim);">Empty scene</p>';
      return;
    }

    // Group by layer
    var byLayer = {};
    instances.forEach(function (inst) {
      var layer = inst.layer || '(base)';
      if (!byLayer[layer]) byLayer[layer] = [];
      byLayer[layer].push(inst);
    });

    var html = '';
    Object.keys(byLayer).forEach(function (layer) {
      html += '<div style="padding:4px 6px; font-size:10px; text-transform:uppercase; color:var(--text-dim); letter-spacing:0.5px; margin-top:4px;">' + escapeHtml(layer) + '</div>';
      byLayer[layer].forEach(function (inst) {
        var type = (scene.objects[inst.objectName] || {}).type || 'unknown';
        html += '<div class="hierarchy-node" data-name="' + escapeHtml(inst.objectName) + '" onclick="selectHierarchyNode(this, ' + JSON.stringify(inst.objectName) + ')">';
        html += '<span class="node-icon">' + typeIcon(type) + '</span>';
        html += '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtml(inst.objectName) + '</span>';
        html += '</div>';
      });
    });
    el.innerHTML = html;
  }

  function typeIcon(type) {
    var map = { 'sprite': '&#9632;', 'cube-3d': '&#9633;', 'model-3d': '&#9651;', 'text': '&#9868;', 'particles': '&#10022;', 'tilemap': '&#9741;', 'sprite3d': '&#9651;' };
    return map[type] || '&#8226;';
  }

  window.selectHierarchyNode = function (el, name) {
    document.querySelectorAll('.hierarchy-node').forEach(function (n) { n.classList.remove('selected'); });
    el.classList.add('selected');
    _selectedNode = name;

    // Find the corresponding mesh
    var found = null;
    _three.objects.forEach(function (obj) {
      if (obj.userData && obj.userData.name === name) found = obj;
      obj.traverse(function (child) { if (child.userData && child.userData.name === name) found = child; });
    });
    if (found) selectViewportObject(found);
    else {
      // Render inspector from scene data
      var inst = (_currentScene && _currentScene.instances || []).find(function (i) { return i.objectName === name; });
      var def = (_currentScene && _currentScene.objects || {})[name] || {};
      if (inst) renderInspector({ instanceData: inst, def: def, name: name, type: def.type });
    }
  };

  function renderSceneStats(scene) {
    var card = document.getElementById('scene-stats-card');
    var el = document.getElementById('scene-stats');
    if (!card || !el) return;
    card.style.display = 'block';
    var objCount = Object.keys(scene.objects || {}).length;
    var instCount = (scene.instances || []).length;
    var layerCount = (scene.layers || []).length;
    var model3dCount = Object.values(scene.objects || {}).filter(function (o) { return o.type === 'model-3d'; }).length;
    var spriteCount = Object.values(scene.objects || {}).filter(function (o) { return o.type === 'sprite'; }).length;

    var html = '<div class="status-grid">';
    html += stat('Objects', objCount) + stat('Instances', instCount) + stat('Layers', layerCount);
    html += stat('3D Models', model3dCount, model3dCount > 0 ? 'var(--green)' : null);
    html += stat('Sprites', spriteCount);
    html += stat('BG Color', '#' + rgbToHex(scene.backgroundColor || {}));
    html += '</div>';

    html += '<div style="margin-top:10px;"><table class="table"><tr><th>Object</th><th>Type</th><th>Behaviors</th></tr>';
    Object.values(scene.objects || {}).forEach(function (obj) {
      html += '<tr><td>' + escapeHtml(obj.name) + '</td>';
      html += '<td><span class="mono">' + escapeHtml(obj.type) + '</span></td>';
      html += '<td>' + (obj.behaviors || []).map(function (b) { return '<span class="chip blue">' + escapeHtml(b.name) + '</span>'; }).join('') + '</td></tr>';
    });
    html += '</table></div>';

    if (scene.layers && scene.layers.length) {
      html += '<div style="margin-top:10px;"><p style="font-size:11px; color:var(--text-dim); margin-bottom:6px;">Layers:</p>';
      scene.layers.forEach(function (l) {
        html += '<span class="chip' + (l.isLightingLayer ? ' green' : '') + '">' + escapeHtml(l.name || '(base)') + (l.isLightingLayer ? ' [light]' : '') + '</span>';
      });
      html += '</div>';
    }

    el.innerHTML = html;
  }

  function stat(label, value, color) {
    return '<div class="status-card"><div class="label">' + label + '</div><div class="value"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div></div>';
  }

  function renderSidebarObjects(scene) {
    var panel = document.getElementById('scene-objects-panel');
    var list = document.getElementById('scene-objects-list');
    if (!panel || !list) return;
    panel.style.display = 'block';
    var objs = Object.values(scene.objects || {});
    if (!objs.length) { list.innerHTML = '<p style="font-size:11px; color:var(--text-dim);">No objects</p>'; return; }
    var html = objs.map(function (o) {
      return '<div class="sidebar-item" onclick="selectHierarchyNodeByName(' + JSON.stringify(o.name) + ')">' +
        '<span class="node-icon">' + typeIcon(o.type) + '</span>' +
        '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtml(o.name) + '</span>' +
        '</div>';
    }).join('');
    list.innerHTML = html;
  }

  window.selectHierarchyNodeByName = function (name) {
    switchTab('scenes');
    var node = document.querySelector('.hierarchy-node[data-name="' + CSS.escape(name) + '"]');
    if (node) node.click();
  };

  window.resetCamera = function () {
    if (!_three.camera || !_three.controls) return;
    _three.camera.position.set(10, 10, 15);
    _three.camera.lookAt(0, 0, 0);
    _three.controls.reset();
  };

  window.toggleGridHelper = function () {
    if (_three.grid) _three.grid.visible = !_three.grid.visible;
  };

  window.toggleWireframe = function () {
    _three.wireframe = !_three.wireframe;
    _three.objects.forEach(function (obj) {
      obj.traverse(function (child) {
        if (child.isMesh && child.material) child.material.wireframe = _three.wireframe;
      });
    });
  };

  window.focusSelected = function () {
    if (!_three.selectedMesh || !_three.camera || !_three.controls) return;
    var box = new THREE.Box3().setFromObject(_three.selectedMesh);
    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3()).length();
    _three.camera.position.set(center.x + size, center.y + size, center.z + size);
    _three.controls.target.copy(center);
  };

  window.saveSceneChanges = function () {
    log('Scene changes saved (in-memory). Puter FS sync requires re-export.', 'ok');
    var btn = document.getElementById('btn-save-scene');
    if (btn) btn.disabled = true;
  };

  // ── Add Entity ──

  window.addEntityToScene = function () {
    var modal = document.getElementById('add-entity-modal');
    if (modal) modal.classList.add('open');
  };

  window.closeAddEntityModal = function () {
    var modal = document.getElementById('add-entity-modal');
    if (modal) modal.classList.remove('open');
  };

  window.confirmAddEntity = function () {
    var name = (document.getElementById('new-entity-name').value || '').trim() || 'New Entity';
    var type = document.getElementById('new-entity-type').value;
    var x = parseFloat(document.getElementById('new-entity-x').value) || 0;
    var y = parseFloat(document.getElementById('new-entity-y').value) || 0;
    var layer = (document.getElementById('new-entity-layer').value || '').trim();

    var mesh = makeProxyMesh({ x: x, y: y, z: 0, angle: 0, layer: layer, objectName: name, width: 64, height: 64 }, { type: type }, type);
    if (mesh) {
      _three.scene.add(mesh);
      _three.objects.push(mesh);
      if (_currentScene) {
        _currentScene.instances = _currentScene.instances || [];
        _currentScene.instances.push({ objectName: name, x: x, y: y, z: 0, angle: 0, layer: layer, zOrder: 0, width: 64, height: 64 });
        _currentScene.objects = _currentScene.objects || {};
        _currentScene.objects[name] = { name: name, type: type, behaviors: [], animations: [] };
        renderHierarchyPanel(_currentScene);
        renderSidebarObjects(_currentScene);
      }
    }
    closeAddEntityModal();
    log('Added entity: ' + name + ' (' + type + ')', 'ok');
  };

  // ── Animations ──

  var _animTimer = null;
  var _animFrames = [];
  var _animFrameIdx = 0;
  var _animPlaying = false;
  var _animSpeedMult = 1;

  window.loadAnimations = async function () {
    switchTab('animations');
    var target = document.getElementById('animations-list');
    if (target) target.innerHTML = '<p style="font-size:12px; color:var(--text-dim);">Loading...</p>';
    try {
      _animations = await GrudgeConnector.listAnimations();
      renderAnimationsList();
    } catch (e) {
      if (target) target.innerHTML = '<p style="color:var(--red); font-size:12px;">Error: ' + escapeHtml(e.message) + '</p>';
    }
  };

  function renderAnimationsList() {
    var target = document.getElementById('animations-list');
    if (!target) return;
    if (!_animations.length) {
      target.innerHTML = '<p style="font-size:12px; color:var(--text-dim);">No animations found in imported projects.</p>';
      return;
    }
    var html = '<table class="table"><tr><th>Project</th><th>Scene</th><th>Object</th><th>Animations</th><th>Preview</th></tr>';
    _animations.forEach(function (a, idx) {
      html += '<tr>';
      html += '<td>' + escapeHtml(a.project) + '</td>';
      html += '<td>' + escapeHtml(a.scene) + '</td>';
      html += '<td>' + escapeHtml(a.object) + '</td>';
      html += '<td>' + a.animations.map(function (n) { return '<span class="chip">' + escapeHtml(n) + '</span>'; }).join('') + '</td>';
      html += '<td><button class="btn" style="font-size:11px; padding:3px 8px;" onclick="previewAnimation(' + idx + ')">Preview</button></td>';
      html += '</tr>';
    });
    html += '</table>';
    target.innerHTML = html;
  }

  window.previewAnimation = function (idx) {
    var anim = _animations[idx];
    if (!anim) return;
    var player = document.getElementById('anim-player');
    var controls = document.getElementById('anim-controls');
    if (!player) return;

    stopAnimPlay();
    _animFrames = [];

    // Look up sprite frames from current scene data
    var frames = [];
    if (_currentScene && _currentScene.objects[anim.object]) {
      var obj = _currentScene.objects[anim.object];
      if (obj.animations && obj.animations.length > 0) {
        var firstAnim = obj.animations[0];
        if (firstAnim.directions && firstAnim.directions.length > 0) {
          frames = firstAnim.directions[0].sprites || [];
        }
      }
    }

    if (frames.length > 0) {
      _animFrames = frames;
      var canvas = document.createElement('canvas');
      canvas.className = 'anim-sprite-canvas';
      canvas.width = 128;
      canvas.height = 128;
      player.innerHTML = '';
      player.appendChild(canvas);
      if (controls) controls.style.display = 'flex';
      document.getElementById('anim-frame-info').textContent = 'Frame 0/' + _animFrames.length;
      renderAnimFrame(0, canvas);
      startAnimPlay(canvas);
    } else {
      // Show text preview
      player.innerHTML = '<div style="text-align:center;">' +
        '<p style="color:var(--accent); font-size:13px; margin-bottom:6px;">' + escapeHtml(anim.object) + '</p>' +
        '<p style="color:var(--text-dim); font-size:12px;">Animations: ' + anim.animations.map(escapeHtml).join(', ') + '</p>' +
        '<p style="font-size:11px; color:var(--text-dim); margin-top:8px;">Sprite frames not available in current scope.<br>Load the full scene to preview sprites.</p>' +
        '</div>';
      if (controls) controls.style.display = 'none';
    }
  };

  function renderAnimFrame(idx, canvas) {
    var frame = _animFrames[idx];
    if (!frame) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#080812';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (frame.url) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = frame.url;
    } else {
      ctx.fillStyle = 'rgba(212,168,75,0.2)';
      ctx.fillRect(10, 10, canvas.width - 20, canvas.height - 20);
      ctx.fillStyle = '#d4a84b';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(frame.image || 'Frame ' + idx, canvas.width / 2, canvas.height / 2);
    }

    var info = document.getElementById('anim-frame-info');
    if (info) info.textContent = 'Frame ' + (idx + 1) + '/' + _animFrames.length;
  }

  function startAnimPlay(canvas) {
    _animPlaying = true;
    _animFrameIdx = 0;
    var fps = 8 * _animSpeedMult;
    var btn = document.getElementById('anim-play-btn');
    if (btn) btn.innerHTML = '&#9646;&#9646;';

    _animTimer = setInterval(function () {
      _animFrameIdx = (_animFrameIdx + 1) % _animFrames.length;
      renderAnimFrame(_animFrameIdx, canvas);
    }, 1000 / fps);
  }

  function stopAnimPlay() {
    clearInterval(_animTimer);
    _animPlaying = false;
    _animFrameIdx = 0;
    var btn = document.getElementById('anim-play-btn');
    if (btn) btn.innerHTML = '&#9654;';
  }

  window.toggleAnimPlay = function () {
    var canvas = document.querySelector('.anim-sprite-canvas');
    if (_animPlaying) { stopAnimPlay(); }
    else if (canvas && _animFrames.length) { startAnimPlay(canvas); }
  };

  window.setAnimSpeed = function (v) {
    _animSpeedMult = parseFloat(v) || 1;
    if (_animPlaying) {
      var canvas = document.querySelector('.anim-sprite-canvas');
      if (canvas) { stopAnimPlay(); startAnimPlay(canvas); }
    }
  };

  // ── Characters ──

  var _characters = [];

  window.loadCharacters = async function () {
    var listEl = document.getElementById('char-list-items');
    if (!window.GrudgeAuth || !GrudgeAuth.isSignedIn()) {
      if (listEl) listEl.innerHTML = '<div style="padding:10px; font-size:11px; color:var(--text-dim);">Sign in to view characters</div>';
      return;
    }
    if (listEl) listEl.innerHTML = '<div style="padding:10px; font-size:11px; color:var(--text-dim);">Loading...</div>';
    try {
      var res = await GrudgeAPI.characters.list();
      _characters = Array.isArray(res) ? res : (res.characters || []);
      renderCharacterList();
      renderRuntimePanel();
    } catch (e) {
      if (listEl) listEl.innerHTML = '<div style="padding:10px; font-size:11px; color:var(--red);">Error: ' + escapeHtml(e.message) + '</div>';
    }
  };

  function renderCharacterList() {
    var el = document.getElementById('char-list-items');
    if (!el) return;
    if (!_characters.length) {
      el.innerHTML = '<div style="padding:10px; font-size:11px; color:var(--text-dim);">No characters found. Create one!</div>';
      return;
    }
    el.innerHTML = _characters.map(function (c, i) {
      return '<div class="char-list-item" onclick="selectCharacter(' + i + ')">' +
        '<div class="char-name">' + escapeHtml(c.name || 'Unnamed') + '</div>' +
        '<div class="char-sub">' + escapeHtml(c.race || '') + ' ' + escapeHtml(c.class || '') + ' · Lv' + (c.level || 1) + '</div>' +
        '</div>';
    }).join('');
  }

  window.selectCharacter = function (idx) {
    var char = _characters[idx];
    if (!char) return;
    document.querySelectorAll('.char-list-item').forEach(function (el, i) {
      el.classList.toggle('selected', i === idx);
    });
    renderCharacterDetail(char);
  };

  function renderCharacterDetail(char) {
    var el = document.getElementById('char-detail');
    if (!el) return;
    var html = '<div class="card" style="margin:0;">';
    html += '<div class="card-header"><h2>' + escapeHtml(char.name || 'Character') + '</h2></div>';
    html += '<div class="status-grid">';
    html += stat('Race', char.race || '—') + stat('Class', char.class || '—');
    html += stat('Level', char.level || 1) + stat('Gold', (char.gold || 0).toLocaleString());
    html += '</div>';

    if (char.attributes || char.stats) {
      html += '<div style="margin-top:10px;"><p style="font-size:11px; color:var(--text-dim); margin-bottom:6px;">Attributes</p>';
      var attrs = char.attributes || char.stats || {};
      html += '<table class="table" style="margin-top:0;"><tr><th>Attribute</th><th>Value</th></tr>';
      Object.keys(attrs).slice(0, 10).forEach(function (k) {
        html += '<tr><td>' + escapeHtml(k) + '</td><td>' + attrs[k] + '</td></tr>';
      });
      html += '</table></div>';
    }

    // Animation binding candidates
    if (_animations.length) {
      html += '<div style="margin-top:10px;"><p style="font-size:11px; color:var(--text-dim); margin-bottom:6px;">Animation Bind Candidates</p>';
      _animations.slice(0, 5).forEach(function (a) {
        html += '<div style="display:flex; gap:6px; align-items:center; margin-bottom:4px;">';
        html += '<span class="chip green">' + escapeHtml(a.object) + '</span>';
        html += '<span style="font-size:11px; color:var(--text-dim);">' + a.animations.slice(0, 2).map(escapeHtml).join(', ') + '</span>';
        html += '<button class="btn" style="font-size:10px; padding:2px 6px; margin-left:auto;" onclick="bindAnimation(' + JSON.stringify(char.name) + ',' + JSON.stringify(a.object) + ')">Bind</button>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  }

  window.bindAnimation = function (charName, objectName) {
    log('Bound animation "' + objectName + '" to character "' + charName + '"', 'ok');
  };

  function renderRuntimePanel() {
    var el = document.getElementById('runtime-panel');
    if (!el) return;
    var runtime = GrudgeConnector.getRuntime();
    if (!runtime) {
      el.innerHTML = '<p style="font-size:12px; color:var(--text-dim);">Runtime offline.</p>';
      return;
    }
    var projects = Object.values(runtime.projectManager.projects || {});
    var html = '<div class="status-grid">';
    html += stat('Projects', projects.length, projects.length ? 'var(--green)' : null);
    html += stat('Characters', _characters.length);
    html += stat('Animations', _animations.length);
    html += stat('Runtime', 'READY', 'var(--green)');
    html += '</div>';
    if (projects.length) {
      html += '<div style="margin-top:10px;"><table class="table"><tr><th>Project</th><th>Scenes</th><th>Source</th></tr>';
      projects.forEach(function (p) {
        html += '<tr><td>' + escapeHtml(p.name) + '</td><td>' + (p.scenes || []).length + '</td><td><span class="chip">' + (p.metadata && p.metadata.source || 'unknown') + '</span></td></tr>';
      });
      html += '</table></div>';
    }
    el.innerHTML = html;
  }

  window.openCreateCharModal = function () {
    var modal = document.getElementById('create-char-modal');
    if (modal) modal.classList.add('open');
    var errEl = document.getElementById('create-char-error');
    if (errEl) errEl.style.display = 'none';
  };

  window.closeCreateCharModal = function () {
    var modal = document.getElementById('create-char-modal');
    if (modal) modal.classList.remove('open');
  };

  window.createCharacter = async function () {
    var name = (document.getElementById('new-char-name').value || '').trim();
    var race = document.getElementById('new-char-race').value;
    var cls = document.getElementById('new-char-class').value;
    var errEl = document.getElementById('create-char-error');
    var btn = document.getElementById('create-char-btn');

    if (!name) {
      if (errEl) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; }
      return;
    }
    if (!window.GrudgeAuth || !GrudgeAuth.isSignedIn()) {
      if (errEl) { errEl.textContent = 'You must be signed in to create a character.'; errEl.style.display = 'block'; }
      return;
    }

    btn.disabled = true;
    try {
      await GrudgeAPI.characters.create({ name: name, race: race, class: cls });
      closeCreateCharModal();
      log('Created character: ' + name, 'ok');
      await loadCharacters();
    } catch (e) {
      if (errEl) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
    } finally {
      btn.disabled = false;
    }
  };

  // ── R2 Assets ──

  var _currentAssetCategory = null;

  window.listR2Assets = async function (category) {
    switchTab('assets');
    _currentAssetCategory = category || null;
    var q = (document.getElementById('asset-search-input') || {}).value || '';
    var listEl = document.getElementById('assets-list');
    if (listEl) listEl.innerHTML = '<p style="font-size:12px; color:var(--text-dim);">Loading assets...</p>';
    try {
      var result = await GrudgeObjectStore.r2.list({ category: category, q: q || undefined, limit: 60 });
      var items = result.items || result.assets || [];
      renderAssetGrid(items, category);
    } catch (e) {
      if (listEl) listEl.innerHTML = '<p style="color:var(--red); font-size:12px;">Error: ' + escapeHtml(e.message) + '</p>';
    }
  };

  function renderAssetGrid(items, category) {
    var listEl = document.getElementById('assets-list');
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<p style="font-size:12px; color:var(--text-dim);">No assets found' + (category ? ' in category: ' + category : '') + '</p>';
      return;
    }
    var html = '<div class="asset-grid">';
    items.forEach(function (a) {
      var icon = assetIcon(a.category || a.mime || '');
      var sizeTxt = a.size ? (a.size / 1024).toFixed(1) + ' KB' : '';
      var fileUrl = GrudgeObjectStore.r2.fileUrl(a.id || a.key);
      html += '<div class="asset-card" onclick="selectAsset(this)">';
      html += '<div class="asset-thumb">' + icon + '</div>';
      html += '<div class="asset-name">' + escapeHtml(a.filename || a.key || 'Asset') + '</div>';
      html += '<div class="asset-meta">' + escapeHtml(a.category || '') + (sizeTxt ? ' · ' + sizeTxt : '') + '</div>';
      html += '<div class="asset-actions">';
      html += '<a href="' + escapeHtml(fileUrl) + '" target="_blank" class="btn" style="font-size:10px; padding:3px 8px; text-decoration:none;">View</a>';
      if (a.mime && a.mime.startsWith('model/') || (a.filename && /\.(glb|gltf)$/i.test(a.filename))) {
        html += '<button class="btn" style="font-size:10px; padding:3px 8px;" onclick="loadGltfFromUrl(event,' + JSON.stringify(fileUrl) + ')">Load 3D</button>';
      }
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
    listEl.innerHTML = html;
  }

  window.selectAsset = function (el) {
    document.querySelectorAll('.asset-card').forEach(function (c) { c.classList.remove('selected'); });
    el.classList.add('selected');
  };

  window.loadGltfFromUrl = function (e, url) {
    e.stopPropagation();
    if (!_three.gltfLoader) { log('GLTFLoader not available', 'err'); return; }
    switchTab('scenes');
    _three.gltfLoader.load(url, function (gltf) {
      var model = gltf.scene;
      model.userData = { name: 'Loaded Asset', type: 'model-3d' };
      _three.scene.add(model);
      _three.objects.push(model);
      var box = new THREE.Box3().setFromObject(model);
      var center = box.getCenter(new THREE.Vector3());
      var size = box.getSize(new THREE.Vector3()).length();
      if (_three.camera && _three.controls) {
        _three.camera.position.set(center.x + size, center.y + size, center.z + size);
        _three.controls.target.copy(center);
      }
      log('GLTF model loaded from asset store', 'ok');
    }, null, function (err) {
      log('GLTF load error: ' + err.message, 'err');
    });
  };

  function assetIcon(type) {
    if (/model|glb|gltf/i.test(type)) return '&#9651;';
    if (/texture|image|png|jpg/i.test(type)) return '&#9632;';
    if (/audio|sound|mp3|wav/i.test(type)) return '&#9834;';
    if (/weapon/i.test(type)) return '&#9876;';
    if (/armor/i.test(type)) return '&#9870;';
    if (/anim/i.test(type)) return '&#9654;';
    return '&#9783;';
  }

  window.debounceAssetSearch = function () {
    clearTimeout(_assetSearchTimer);
    _assetSearchTimer = setTimeout(function () {
      listR2Assets(_currentAssetCategory);
    }, 400);
  };

  // ── Asset Upload ──

  window.openUploadModal = function () {
    var modal = document.getElementById('upload-modal');
    if (modal) modal.classList.add('open');
    _assetFile = null;
    var label = document.getElementById('asset-drop-label');
    if (label) label.textContent = 'Drop file here or click to browse';
    var prog = document.getElementById('upload-progress-wrap');
    if (prog) prog.style.display = 'none';
  };

  window.closeUploadModal = function () {
    var modal = document.getElementById('upload-modal');
    if (modal) modal.classList.remove('open');
  };

  window.handleAssetFileSelect = function (e) {
    if (e.target.files.length > 0) {
      _assetFile = e.target.files[0];
      var label = document.getElementById('asset-drop-label');
      if (label) label.textContent = _assetFile.name + ' (' + (_assetFile.size / 1024).toFixed(1) + ' KB)';
    }
  };

  var assetDropZone = document.getElementById('asset-drop-zone');
  if (assetDropZone) {
    assetDropZone.addEventListener('dragover', function (e) { e.preventDefault(); assetDropZone.classList.add('dragover'); });
    assetDropZone.addEventListener('dragleave', function () { assetDropZone.classList.remove('dragover'); });
    assetDropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      assetDropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        _assetFile = e.dataTransfer.files[0];
        var label = document.getElementById('asset-drop-label');
        if (label) label.textContent = _assetFile.name + ' (' + (_assetFile.size / 1024).toFixed(1) + ' KB)';
      }
    });
  }

  window.uploadAsset = async function () {
    if (!_assetFile) { alert('Please select a file first.'); return; }
    if (!window.GrudgeAuth || !GrudgeAuth.isSignedIn()) { alert('You must be signed in to upload assets.'); return; }

    var category = document.getElementById('upload-category').value;
    var visibility = document.getElementById('upload-visibility').value;
    var tagsRaw = (document.getElementById('upload-tags').value || '').trim();
    var tags = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];

    var prog = document.getElementById('upload-progress-wrap');
    var bar = document.getElementById('upload-progress-bar');
    var txt = document.getElementById('upload-progress-text');
    var btn = document.getElementById('upload-submit-btn');
    if (prog) prog.style.display = 'block';
    if (bar) bar.style.width = '20%';
    if (txt) txt.textContent = 'Uploading ' + _assetFile.name + '...';
    if (btn) btn.disabled = true;

    try {
      if (bar) bar.style.width = '60%';
      var result = await GrudgeObjectStore.r2.upload(_assetFile, { category: category, tags: tags, visibility: visibility });
      if (bar) bar.style.width = '100%';
      if (txt) txt.textContent = 'Upload complete!';
      log('Uploaded: ' + _assetFile.name + ' to R2 (' + category + ')', 'ok');
      setTimeout(function () {
        closeUploadModal();
        listR2Assets(category);
      }, 1000);
    } catch (e) {
      if (txt) txt.textContent = 'Upload failed: ' + e.message;
      if (bar) bar.style.width = '0%';
      log('Upload failed: ' + e.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  // ── Game Data ──

  window.loadAllGameData = async function () {
    log('Loading game data...', '');
    switchTab('gamedata');
    try {
      _gameData = await GrudgeConnector.loadGameData();
      var keys = Object.keys(_gameData).filter(function (k) { return _gameData[k] !== null; });
      log('Loaded: ' + keys.join(', '), 'ok');
      renderGameDataTabs(keys);
    } catch (e) {
      log('Failed to load game data: ' + e.message, 'err');
    }
  };

  function renderGameDataTabs(keys) {
    var tabsEl = document.getElementById('gd-tabs');
    if (!tabsEl) return;
    var html = keys.map(function (k, i) {
      return '<button class="tab' + (i === 0 ? ' active' : '') + '" onclick="showGameDataTab(\'' + escapeHtml(k) + '\', this)">' + k + '</button>';
    }).join('');
    tabsEl.innerHTML = html;
    if (keys.length) showGameDataTab(keys[0]);
  }

  window.showGameDataTab = function (key, btnEl) {
    if (btnEl) {
      document.querySelectorAll('#gd-tabs .tab').forEach(function (t) { t.classList.remove('active'); });
      btnEl.classList.add('active');
    }
    var el = document.getElementById('gamedata-content');
    if (!el || !_gameData) return;
    var data = _gameData[key];
    if (!data) { el.innerHTML = '<p style="color:var(--red);">No data for ' + escapeHtml(key) + '</p>'; return; }

    var arr = Array.isArray(data) ? data : (data.items || data.data || Object.values(data));
    if (arr.length && typeof arr[0] === 'object') {
      var cols = Object.keys(arr[0]).slice(0, 6);
      var html = '<div style="overflow-x:auto;"><table class="table"><tr>' + cols.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '</tr>';
      arr.slice(0, 100).forEach(function (row) {
        html += '<tr>' + cols.map(function (c) {
          var v = row[c];
          if (v === null || v === undefined) return '<td>—</td>';
          if (typeof v === 'object') return '<td><span class="chip">' + Object.keys(v).length + ' fields</span></td>';
          return '<td>' + escapeHtml(String(v).slice(0, 60)) + '</td>';
        }).join('') + '</tr>';
      });
      html += '</table></div>';
      if (arr.length > 100) html += '<p style="font-size:11px; color:var(--text-dim); margin-top:6px;">Showing 100 of ' + arr.length + ' records</p>';
      el.innerHTML = html;
    } else {
      el.innerHTML = '<pre style="font-size:11px; color:var(--text-dim); max-height:400px; overflow:auto; background:#0d0d14; padding:10px; border-radius:6px;">' + escapeHtml(JSON.stringify(data, null, 2).slice(0, 12000)) + '</pre>';
    }
  };

  // ── Agent Playground ──

  window.resetAgentChat = function () {
    _agentMessages = [];
    var el = document.getElementById('agent-chat-log');
    if (el) el.innerHTML = '';
    agentMsg('system', 'Agent session reset. Ready to help with scenes, assets, and game data.');
  };

  function agentMsg(role, text) {
    var el = document.getElementById('agent-chat-log');
    if (!el) return;
    var div = document.createElement('div');
    div.className = 'agent-msg ' + role;
    var roleLabels = { user: 'You', assistant: 'Agent', tool: 'Tool', system: 'System', error: 'Error' };
    div.innerHTML = '<div class="msg-role">' + (roleLabels[role] || role) + '</div><div class="msg-text">' + escapeHtml(text) + '</div>';
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  window.agentInputKeydown = function (e) {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); sendAgentMessage(); }
  };

  window.sendAgentMessage = async function () {
    var input = document.getElementById('agent-input');
    var modelInput = document.getElementById('agent-model');
    var sendBtn = document.getElementById('agent-send-btn');
    var prompt = (input.value || '').trim();
    if (!prompt) return;

    if (!window.GrudgeAgentPlayground || !GrudgeAgentPlayground.isAvailable()) {
      agentMsg('error', 'Puter AI is not available. Sign in to Puter to use the agent.');
      return;
    }

    input.value = '';
    sendBtn.disabled = true;
    _agentMessages.push({ role: 'user', content: prompt });
    agentMsg('user', prompt);

    try {
      var response = await GrudgeAgentPlayground.chat(_agentMessages, {
        model: (modelInput.value || '').trim() || undefined,
        temperature: 0.2,
        maxTokens: 1600,
      }, {
        onToolStart: function (name) { agentMsg('tool', 'Calling tool: ' + name + '...'); },
        onToolEnd: function (name) { agentMsg('tool', 'Tool done: ' + name); },
        onToolError: function (name, err) { agentMsg('error', 'Tool error — ' + name + ': ' + (err.error || 'failed')); },
      });

      _agentMessages.push({ role: 'assistant', content: response.text });
      agentMsg('assistant', response.text);
    } catch (e) {
      agentMsg('error', 'Agent error: ' + e.message);
    } finally {
      sendBtn.disabled = false;
    }
  };

  // ── Helpers ──

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function rgbToHex(c) {
    function h(v) { return ('0' + (parseInt(v) || 0).toString(16)).slice(-2); }
    return h(c.r) + h(c.g) + h(c.b);
  }

  // ── Boot ──

  window.addEventListener('load', initConnector);
})();
