// User interface: connecting to the data folder, My work, task list, board,
// task page, projects, people, roles, email notifications and export.
window.TO = window.TO || {};

(function () {
  var C = TO.config;
  var main = document.getElementById('main');
  // Logo and name shown on the welcome screens.
  var HERO = '<img class="hero-logo" src="img/logo.svg" alt=""><p class="hero-name"><b>Bear</b> with me</p>' +
    '<p class="hero-tag">Tasks, reviews and WBS for the team</p>';

  var state = {
    store: null,
    demo: false,
    me: lsGet('to.me') || '',
    project: lsGet('to.project') || '',
    filters: { q: '', status: 'open', assignee: '', severity: '' },
    sort: { col: 'key', dir: 1 },
    boardMine: false,
    logFilter: 'all',
    view: '',
    edit: null,          // { base, isNew, dirty: {}, logDraft }
    pendingNotify: null, // offer to notify people after a save
    seen: null,          // task id -> rev this user has looked at
    wbs: null, wbsVersion: -1,
    lastRefresh: null,
    refreshing: false,
    timer: null
  };

  // ---------- small helpers ----------

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a == null ? '' : a) === JSON.stringify(b == null ? '' : b); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function addDays(dateStr, n) { var d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
  function fmtDate(iso) {
    if (!iso) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    return ymd(new Date(iso));
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return fmtDate(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.hidden = true; }, isError ? 7000 : 3500);
  }

  function findById(list, id, fallback) { return list.filter(function (s) { return s.id === id; })[0] || fallback; }
  function statusOf(id) { return findById(C.statuses, id, C.statuses[0]); }
  function severityOf(id) { return findById(C.severities, id, C.severities[2]); }
  function reviewOf(id) { return findById(C.reviewStatuses, id, C.reviewStatuses[0]); }
  function linkTypeOf(id) { return findById(C.linkTypes, id, C.linkTypes[0]); }
  function notifyTypeOf(id) { return findById(C.notifyTypes, id, C.notifyTypes[0]); }
  function roleName(id) { return findById(C.roles, id, C.roles[1]).name; }
  function isDone(t) { return !!statusOf(t.status).done; }
  function badge(item) { return '<span class="badge" style="background:' + item.color + '">' + esc(item.name) + '</span>'; }
  function reviewBadge(t) { return t.reviewRequired ? badge(reviewOf(t.reviewStatus)) : ''; }

  function users() { return (state.store && state.store.users.users) || []; }
  function activeUsers() { return users().filter(function (u) { return u.active !== false; }); }
  function userById(id) { return users().filter(function (x) { return x.id === id; })[0]; }
  function userName(id) {
    if (!id) return '';
    var u = userById(id);
    return u ? u.name : id;
  }
  function userDept(id) { var u = userById(id); return (u && u.department) || ''; }
  function userLabel(id) { var d = userDept(id); return userName(id) + (d ? ' (' + d + ')' : ''); }
  // Options for person dropdowns; keeps the current value even if that person is inactive.
  function peopleOptions(current) {
    var list = activeUsers();
    if (current && !list.some(function (u) { return u.id === current; })) list = list.concat([{ id: current }]);
    return list.map(function (u) { return { id: u.id, name: userLabel(u.id) }; });
  }

  function projects() {
    var p = state.store.projects;
    return Object.keys(p).map(function (k) { return p[k]; })
      .sort(function (a, b) { return a.key.localeCompare(b.key); });
  }
  function allTasks() {
    var t = state.store.tasks;
    return Object.keys(t).map(function (k) { return t[k]; });
  }
  // Completed projects are hidden: their tasks only show when that project
  // is chosen explicitly in the project menu, and they are read-only.
  function isProjectCompleted(key) { var p = state.store.projects[key]; return !!(p && p.status === 'completed'); }
  function activeProjects() { return projects().filter(function (p) { return p.status !== 'completed'; }); }
  function scopedTasks() {
    return allTasks().filter(function (t) { return state.project ? t.projectKey === state.project : !isProjectCompleted(t.projectKey); });
  }
  // "+ New task" is offered when there is an active project to add to.
  function canAddHere() {
    if (!can.edit() || !activeProjects().length) return false;
    return !(state.project && isProjectCompleted(state.project));
  }
  function projectName(t) { var p = state.store.projects[t.projectKey]; return p ? p.name : t.projectKey; }
  // Shown next to a task title whenever tasks from several projects are listed.
  function projectTagHtml(t, always) {
    if (state.project && !always) return '';
    return '<span class="proj-tag" title="Project ' + esc(t.projectKey) + '">' + esc(projectName(t)) + '</span>';
  }
  function byKey(a, b) {
    return a.projectKey === b.projectKey ? a.number - b.number : a.projectKey.localeCompare(b.projectKey);
  }
  function byDue(a, b) { return (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || byKey(a, b); }
  function childrenOf(id) { return allTasks().filter(function (t) { return t.parentId === id; }).sort(byKey); }
  function descendantIds(id) {
    var out = {};
    (function walk(pid) { childrenOf(pid).forEach(function (c) { out[c.id] = 1; walk(c.id); }); })(id);
    return out;
  }
  function live(list) { return (list || []).filter(function (e) { return !e.removed; }); }

  // Progress of a task. Without sub-tasks it is the task's own progress.
  // With sub-tasks it combines the sub-tasks' average with the task's own
  // work, weighted by "Own work share" (ownWeight, 0-100%): 0 = only the
  // sub-tasks, 100 = set by hand. Cancelled sub-tasks are ignored; a task set
  // to Done is always 100%.
  function clampPct(v) { return Math.max(0, Math.min(100, parseInt(v, 10) || 0)); }
  function subProgressOf(t) {
    var kids = childrenOf(t.id).filter(function (c) { return c.status !== 'cancelled'; });
    return kids.length ? Math.round(kids.reduce(function (s, c) { return s + progressOf(c); }, 0) / kids.length) : null;
  }
  function progressOf(t) {
    if (t.status === 'done') return 100;
    var sub = subProgressOf(t);
    if (sub == null) return isDone(t) ? 100 : clampPct(t.progress);
    var w = clampPct(t.ownWeight) / 100;
    return Math.round(sub * (1 - w) + clampPct(t.progress) * w);
  }
  function progressBar(p) { return '<span class="progress" title="' + p + '%"><span style="width:' + p + '%"></span></span> <span class="small muted">' + p + '%</span>'; }
  function isOverdue(t) { return t.dueDate && !isDone(t) && t.dueDate < today(); }
  // Days the delivery date has moved since it was first set (positive = later).
  function slipDays(t) {
    if (!t.originalDueDate || !t.dueDate) return 0;
    return daysBetween(fmtDate(t.originalDueDate), fmtDate(t.dueDate));
  }
  function dueHtml(t) {
    var s = slipDays(t);
    return '<span class="' + (isOverdue(t) ? 'overdue' : '') + '">' + esc(fmtDate(t.dueDate)) + '</span>' +
      (s ? ' <span class="slip" title="Original delivery date ' + esc(fmtDate(t.originalDueDate)) + '">' + (s > 0 ? '+' : '') + s + 'd</span>' : '');
  }

  // ---------- action point / external ID ----------

  function normRef(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  // Other tasks that use the same external reference.
  function sameRefTasks(ref, exceptId) {
    var n = normRef(ref);
    if (!n) return [];
    return allTasks().filter(function (t) { return t.id !== exceptId && normRef(t.externalRef) === n; }).sort(byKey);
  }
  function extRefHtml(t) {
    return t.externalRef ? '<div class="ext-ref" title="Action point / external ID">' + esc(t.externalRef) + '</div>' : '';
  }
  function showExtRefHint(ref, taskId) {
    var el = $('#extref-hint');
    if (!el) return;
    var dup = sameRefTasks(ref, taskId);
    el.innerHTML = dup.length ? '<span class="slip">Also used on ' + dup.map(function (d) {
      return '<a href="#/task/' + encodeURIComponent(d.id) + '">' + esc(d.id) + '</a>';
    }).join(', ') + '</span>' : '';
  }

  // ---------- WBS codes (1, 1.2, 1.2.3) from the task tree ----------

  function wbsMap() {
    if (state.wbs && state.wbsVersion === state.store.version) return state.wbs;
    var tasks = state.store.tasks;
    var groups = {};
    allTasks().forEach(function (t) {
      var parent = t.parentId && tasks[t.parentId] ? t.parentId : '';
      var k = t.projectKey + '|' + parent;
      (groups[k] = groups[k] || []).push(t);
    });
    var map = {};
    function walk(pk, pid, prefix) {
      (groups[pk + '|' + pid] || []).sort(function (a, b) { return a.number - b.number; }).forEach(function (t, i) {
        map[t.id] = prefix + (i + 1);
        walk(pk, t.id, prefix + (i + 1) + '.');
      });
    }
    var keys = {};
    allTasks().forEach(function (t) { keys[t.projectKey] = 1; });
    Object.keys(keys).forEach(function (k) { walk(k, '', ''); });
    state.wbs = map;
    state.wbsVersion = state.store.version;
    return map;
  }
  function wbsOf(t) { return wbsMap()[t.id] || ''; }
  function compareWbs(a, b) {
    var x = wbsOf(a).split('.'), y = wbsOf(b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d;
    }
    return 0;
  }

  // ---------- roles and locking ----------

  function hasAdmin() { return users().some(function (u) { return u.role === 'admin' && u.active !== false; }); }
  // Until someone is made admin, everyone is treated as admin.
  function roleOf(id) {
    var u = userById(id);
    if (!u) return 'viewer';
    if (!hasAdmin()) return 'admin';
    return u.role || 'member';
  }
  function myRole() { return roleOf(state.me); }

  // A finished task (Done or Cancelled, and reviewed if a review is needed)
  // is locked until someone reopens it.
  function isLocked(t) {
    if (t.id && isProjectCompleted(t.projectKey)) return true;
    return !!t.id && isDone(t) && (t.status === 'cancelled' || !t.reviewRequired || t.reviewStatus === 'approved');
  }

  var can = {
    edit: function () { return myRole() !== 'viewer'; },
    admin: function () { return myRole() === 'admin'; },
    editTask: function (t) { return can.edit() && !isLocked(t); },
    setReview: function (t) { return can.admin() || (can.edit() && !!t.reviewer && t.reviewer === state.me); },
    reopen: function (t) {
      var p = state.store.projects[t.projectKey];
      if (isProjectCompleted(t.projectKey)) return false;
      return can.admin() || (can.edit() && (t.assignee === state.me || t.reporter === state.me || (p && p.owner === state.me)));
    },
    // Adding tasks, sub-tasks and log notes: not in completed projects.
    addTo: function (projectKey) { return can.edit() && !isProjectCompleted(projectKey); },
    createProject: function () { return can.admin(); },
    editProject: function (p) { return can.admin() || (can.edit() && p && p.owner === state.me); },
    // Assigning unassigned tasks on the Allocation page: admins (managers) and the project's owner.
    allocate: function (projectKey) {
      var p = state.store.projects[projectKey];
      if (!p || p.status === 'completed') return false;
      return can.admin() || (can.edit() && p.owner === state.me);
    }
  };

  // ---------- "changed since my last visit" ----------

  function loadSeen() {
    try { state.seen = JSON.parse(lsGet('to.seen.' + state.me) || 'null'); } catch (e) { state.seen = null; }
    if (!state.seen) {
      state.seen = {};
      allTasks().forEach(function (t) { state.seen[t.id] = t.rev || 0; });
      saveSeen();
    }
  }
  function saveSeen() { lsSet('to.seen.' + state.me, JSON.stringify(state.seen)); }
  function markSeen(t) {
    if (state.seen && state.seen[t.id] !== t.rev) { state.seen[t.id] = t.rev; saveSeen(); }
  }
  function isChanged(t) {
    return !!(state.seen && t.updatedBy && t.updatedBy !== state.me && (state.seen[t.id] || 0) < (t.rev || 0));
  }
  function changedDot(t) { return isChanged(t) ? '<span class="dot" title="Changed by ' + esc(userName(t.updatedBy)) + ' since you last looked"></span>' : ''; }

  // ---------- links to documents ----------

  // Turns a typed path or address into something the browser can open.
  function linkHref(url) {
    url = String(url || '').trim();
    if (/^(https?|file|mailto):/i.test(url)) return url;
    if (/^\\\\/.test(url)) return encodeURI('file:' + url.replace(/\\/g, '/'));
    if (/^[a-zA-Z]:[\\\/]/.test(url)) return encodeURI('file:///' + url.replace(/\\/g, '/'));
    return 'https://' + url;
  }
  function fileNameOf(url) { return String(url || '').replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || url; }
  function copyText(text) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback); else fallback();
    toast('Copied: ' + text);
  }

  // All task-to-task links of a task, both the ones stored on it and the ones
  // other tasks point at it with. Returns [{ entry, owner, other, label }].
  function taskLinks(t) {
    var out = [];
    live(t.links).forEach(function (l) {
      out.push({ entry: l, owner: t.id, other: l.target, label: linkTypeOf(l.type).name });
    });
    allTasks().forEach(function (o) {
      if (o.id === t.id) return;
      live(o.links).forEach(function (l) {
        if (l.target === t.id) out.push({ entry: l, owner: o.id, other: o.id, label: linkTypeOf(l.type).inverse });
      });
    });
    return out;
  }

  function options(list, selected, emptyLabel) {
    var html = emptyLabel != null ? '<option value="">' + esc(emptyLabel) + '</option>' : '';
    return html + list.map(function (o) {
      return '<option value="' + esc(o.id) + '"' + (o.id === selected ? ' selected' : '') + '>' + esc(o.name) + '</option>';
    }).join('');
  }

  // ---------- remembering the data folder (IndexedDB) ----------

  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('taskorganizer', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  async function kvGet(k) {
    try {
      var db = await idb();
      return await new Promise(function (res) {
        var q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { res(undefined); };
      });
    } catch (e) { return undefined; }
  }
  async function kvSet(k, v) {
    try {
      var db = await idb();
      await new Promise(function (res) {
        var tx = db.transaction('kv', 'readwrite');
        if (v === undefined) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put(v, k);
        tx.oncomplete = res; tx.onerror = res;
      });
    } catch (e) { /* ignore */ }
  }

  // ---------- connecting ----------

  async function boot() {
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('beforeunload', function (e) {
      if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && state.view === 'task' && state.edit) {
        e.preventDefault();
        if ($('#btn-save') && !$('#btn-save').hidden) saveTask(false);
      }
    });
    document.getElementById('btn-refresh').addEventListener('click', function () { refresh(true); });
    document.getElementById('project-select').addEventListener('change', function (e) {
      state.project = e.target.value;
      lsSet('to.project', state.project || null);
      if (['tasks', 'home', 'board', 'overview', 'wbs', 'allocation'].indexOf(state.view) >= 0) route(true); else location.hash = '#/tasks';
    });

    if (lsGet('to.mode') === 'demo' && navigator.storage && navigator.storage.getDirectory) {
      return connectDemo();
    }
    if (!window.showDirectoryPicker) return renderUnsupported();

    var saved = await kvGet('dataDir');
    if (saved) {
      var perm = 'prompt';
      try { perm = await saved.queryPermission({ mode: 'readwrite' }); } catch (e) { /* ignore */ }
      if (perm === 'granted') return connect(saved);
      return renderReconnect(saved);
    }
    renderConnect();
  }

  function renderUnsupported() {
    main.innerHTML = '<div class="panel center-card">' + HERO + '<h1>Please use Edge or Chrome</h1>' +
      '<p>This app saves its data in a shared folder on the network drive. Only Microsoft Edge and Google Chrome ' +
      'allow a web page to do that.</p><p>Open this same file in Edge or Chrome.</p></div>';
  }

  function renderConnect(errorMsg) {
    var demoOk = !!(navigator.storage && navigator.storage.getDirectory);
    main.innerHTML = '<div class="panel center-card">' + HERO + '<h1>Connect to the data folder</h1>' +
      '<p>All tasks are stored as files in a shared <b>data folder</b> on the network drive, so everyone sees the same tasks.</p>' +
      '<p>Click the button and choose the data folder (for example <code>TaskOrganizer\\data</code> next to this app). ' +
      'If you are the first user, choose an <b>empty</b> folder and it will be set up for you. ' +
      'When the browser asks, allow it to <b>view and edit</b> files.</p>' +
      (errorMsg ? '<p class="error">' + esc(errorMsg) + '</p>' : '') +
      '<div class="toolbar"><button class="btn btn-primary" id="btn-pick">Choose data folder</button>' +
      (demoOk ? '<button class="btn" id="btn-demo">Try a demo (data stays in this browser only)</button>' : '') +
      '</div></div>';
    $('#btn-pick').onclick = pickFolder;
    if (demoOk) $('#btn-demo').onclick = function () { lsSet('to.mode', 'demo'); connectDemo(); };
  }

  function renderReconnect(handle) {
    main.innerHTML = '<div class="panel center-card">' + HERO + '<h1>Welcome back</h1>' +
      '<p>The browser needs your permission again to use the data folder <b>' + esc(handle.name) + '</b>.</p>' +
      '<div class="toolbar"><button class="btn btn-primary" id="btn-reconnect">Continue to ' + esc(handle.name) + '</button>' +
      '<button class="btn" id="btn-other">Choose another folder</button></div></div>';
    $('#btn-reconnect').onclick = async function () {
      try {
        var perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') connect(handle); else renderConnect('Permission was not given. The app needs to view and edit files in the data folder.');
      } catch (e) { renderConnect(e.message); }
    };
    $('#btn-other').onclick = pickFolder;
  }

  async function pickFolder() {
    var handle;
    try { handle = await window.showDirectoryPicker({ id: 'taskorganizer-data', mode: 'readwrite' }); }
    catch (e) { if (e.name !== 'AbortError') renderConnect(e.message); return; }
    lsSet('to.mode', null);
    connect(handle);
  }

  async function connectDemo() {
    try {
      var root = await navigator.storage.getDirectory();
      var dir = await root.getDirectoryHandle('demo-data', { create: true });
      state.demo = true;
      await connect(dir, true);
    } catch (e) {
      lsSet('to.mode', null);
      renderConnect('Demo could not start: ' + e.message);
    }
  }

  async function connect(handle, isDemo) {
    main.innerHTML = '<div class="empty">Loading tasks...</div>';
    try {
      var store = new TO.Store(handle, { user: state.me });
      var kind = await store.inspect();
      // The browser may clear demo storage; just set it up again.
      if (kind === 'other' && isDemo) kind = 'empty';
      if (kind === 'other') {
        var ok = confirm('The folder "' + handle.name + '" already contains other files and is not a task data folder.\n\n' +
          'Create a new subfolder "TaskOrganizerData" inside it and store the data there?');
        if (!ok) return renderConnect();
        handle = await handle.getDirectoryHandle('TaskOrganizerData', { create: true });
        store = new TO.Store(handle, { user: state.me });
        kind = await store.inspect();
      }
      if (kind === 'empty') await store.initialize();
      if (!isDemo) await kvSet('dataDir', handle);
      await store.loadAll();
      state.store = store;
      state.wbs = null;
      state.lastRefresh = new Date();
      afterConnect();
    } catch (e) {
      console.error(e);
      renderConnect('Could not open the data folder: ' + e.message);
    }
  }

  function afterConnect() {
    if (!userById(state.me)) return renderWhoAmI();
    state.store.user = state.me;
    loadSeen();
    document.getElementById('sidebar').hidden = false;
    document.getElementById('btn-refresh').hidden = false;
    renderChrome();
    clearInterval(state.timer);
    state.timer = setInterval(function () {
      if (document.visibilityState === 'visible') refresh(false);
    }, C.refreshSeconds * 1000);
    if (!location.hash || location.hash === '#') location.hash = '#/home'; else route();
  }

  function renderWhoAmI() {
    var list = activeUsers();
    main.innerHTML = '<div class="panel center-card">' + HERO + '<h1>Who are you?</h1>' +
      '<p>Your name is shown on tasks you create, change and log. It is remembered in this browser.</p>' +
      (list.length ? '<div class="field"><label class="field-label">Pick your name</label><select id="who-select">' +
        options(peopleOptions(), '', '— choose —') + '</select></div><p class="muted">Not in the list? Add yourself:</p>' : '') +
      '<div class="form-grid"><div class="field"><label class="field-label">Full name</label><input type="text" id="who-name"></div>' +
      '<div class="field"><label class="field-label">Department</label><input type="text" id="who-dept"></div>' +
      '<div class="field"><label class="field-label">Email (used for notifications)</label><input type="email" id="who-email"></div></div>' +
      (list.length ? '' : '<p class="muted">You are the first user, so you become the <b>admin</b>.</p>') +
      '<button class="btn btn-primary" id="who-go">Continue</button></div>';
    $('#who-go').onclick = async function () {
      var sel = $('#who-select');
      var name = $('#who-name').value.trim();
      try {
        if (name) {
          var u = { id: 'u_' + uid(), name: name, department: $('#who-dept').value.trim(), email: $('#who-email').value.trim(),
            role: users().length ? 'member' : 'admin', active: true };
          state.store.user = u.id;
          await state.store.upsertUser(u);
          state.me = u.id;
        } else if (sel && sel.value) {
          state.me = sel.value;
        } else { return toast('Choose your name or type it in.', true); }
        lsSet('to.me', state.me);
        afterConnect();
      } catch (e) { toast('Could not save: ' + e.message, true); }
    };
  }

  // ---------- refresh / sync ----------

  async function refresh(manual) {
    if (!state.store || state.refreshing) return;
    state.refreshing = true;
    setSync('Checking for changes...');
    try {
      var changed = await state.store.refresh();
      state.lastRefresh = new Date();
      if (changed) onDataChanged();
      if (manual) toast(changed ? 'Updated with the latest changes.' : 'Everything is up to date.');
    } catch (e) {
      console.error(e);
      setSync('Cannot reach the data folder', true);
      if (manual) toast('Could not read the data folder: ' + e.message, true);
      state.refreshing = false;
      return;
    }
    state.refreshing = false;
    renderSync();
  }

  function onDataChanged() {
    renderChrome();
    if ($('dialog[open]') || state.dragging) return;
    if (state.view === 'task' && state.edit && !state.edit.isNew) {
      var latest = state.store.tasks[state.edit.base.id];
      if (!latest) return;
      if (isDirty()) {
        if (latest.rev === state.edit.base.rev) return;
        var n = $('#remote-notice');
        if (n) {
          n.hidden = false;
          n.innerHTML = 'This task was just changed by <b>' + esc(userName(latest.updatedBy)) + '</b>. ' +
            'Your edits will be merged with theirs when you save.';
        }
      } else {
        // Re-render also when only linked tasks changed.
        renderTask(latest.id, true);
      }
      return;
    }
    if (isDirty()) return;
    // Keep the search box and scroll position when only the list needs updating.
    if (state.view === 'tasks' && $('#task-table')) return renderTaskTable();
    route(true);
  }

  function setSync(text, isError) {
    var el = document.getElementById('sync-status');
    el.textContent = text;
    el.style.color = isError ? '#ffbdad' : '';
  }
  function renderSync() {
    if (!state.lastRefresh) return;
    setSync((state.demo ? 'Demo data · ' : '') + 'Up to date ' + pad(state.lastRefresh.getHours()) + ':' + pad(state.lastRefresh.getMinutes()));
  }

  function renderChrome() {
    var sel = document.getElementById('project-select');
    var opt = function (p) {
      return '<option value="' + esc(p.key) + '"' + (p.key === state.project ? ' selected' : '') + '>' + esc(p.key + ' – ' + p.name) + '</option>';
    };
    var done = projects().filter(function (p) { return p.status === 'completed'; });
    sel.innerHTML = '<option value="">All active projects</option>' + activeProjects().map(opt).join('') +
      (done.length ? '<optgroup label="Completed projects">' + done.map(opt).join('') + '</optgroup>' : '');
    if (state.project && !state.store.projects[state.project]) { state.project = ''; sel.value = ''; }
    var role = myRole();
    document.getElementById('current-user').innerHTML = '<a href="#/people" title="Your role: ' + esc(roleName(role)) + '">' + esc(userName(state.me)) +
      (role !== 'member' ? ' <span class="role-tag">' + esc(role === 'admin' ? 'Admin' : 'Read only') + '</span>' : '') + '</a>';
    if (TO.alloc) TO.alloc.updateBadge();
    renderSync();
  }

  // ---------- routing ----------

  function isDirty() {
    var e = state.edit;
    // Unsaved assignments on the Allocation page count as unsaved changes too.
    if (state.view === 'allocation' && TO.alloc && TO.alloc.pendingCount()) return true;
    return !!(e && (Object.keys(e.dirty).length || (e.logDraft && e.logDraft.trim())));
  }

  var lastHash = '';
  function onHashChange() {
    if (isDirty() && !confirm('You have unsaved changes. Leave this page and lose them?')) {
      history.replaceState(null, '', lastHash || '#/home');
      return;
    }
    route();
  }

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = {};
    var qi = h.indexOf('?');
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      h = h.slice(0, qi);
    }
    return { parts: h.split('/').map(decodeURIComponent), query: q };
  }

  function route(keepScroll) {
    if (!state.store) return;
    lastHash = location.hash;
    state.edit = null;
    var r = parseHash();
    var view = r.parts[0] || 'home';
    if (view !== 'allocation' && TO.alloc) TO.alloc.discard();
    $all('.sidebar a').forEach(function (a) {
      var nav = a.getAttribute('data-nav');
      a.classList.toggle('active', nav === view || (nav === 'tasks' && (view === 'task' || view === 'new')) || (nav === 'projects' && view === 'project'));
    });
    state.view = view;
    var y = window.scrollY;
    if (view === 'task') renderTask(r.parts[1]);
    else if (view === 'new') renderNewTask(r.query);
    else if (view === 'tasks') renderTasks();
    else if (view === 'board') renderBoard();
    else if (view === 'projects') renderProjects();
    else if (view === 'project') renderProjectForm(r.parts[1]);
    else if (view === 'people') renderPeople();
    else if (view === 'settings') renderSettings();
    else if (TO.views && TO.views[view]) TO.views[view](r);
    else { state.view = 'home'; renderHome(); }
    window.scrollTo(0, keepScroll ? y : 0);
  }

  // ---------- My work ----------

  function miniTable(list, opts) {
    opts = opts || {};
    if (!list.length) return '<p class="muted small" style="margin:0">' + esc(opts.empty || 'Nothing here.') + '</p>';
    // Fixed column widths so several small tables line up under each other.
    var cols = '<col style="width:92px"><col style="width:58px"><col><col style="width:116px">' +
      (opts.changed ? '<col style="width:210px">' : (opts.mine ? '' : '<col style="width:130px">') + '<col style="width:120px">');
    return '<table class="list compact mini"><colgroup>' + cols + '</colgroup><tbody>' + list.map(function (t) {
      return '<tr data-id="' + esc(t.id) + '"><td class="key">' + esc(t.id) + '</td><td class="wbs">' + esc(wbsOf(t)) + '</td>' +
        '<td>' + changedDot(t) + esc(t.title) + projectTagHtml(t) + '</td>' +
        '<td>' + badge(statusOf(t.status)) + '</td>' +
        (opts.changed
          ? '<td class="nowrap small muted">' + esc(userName(t.updatedBy)) + ', ' + esc(fmtDateTime(t.updatedAt)) + '</td>'
          : (opts.mine ? '' : '<td class="nowrap small">' + esc(userName(t.assignee)) + '</td>') + '<td class="nowrap">' + dueHtml(t) + '</td>') +
        '</tr>';
    }).join('') + '</tbody></table>';
  }

  function bindRows(root) {
    $all('tr[data-id]', root).forEach(function (tr) {
      tr.onclick = function (ev) {
        if (ev.target.closest('a, button')) return;
        location.hash = '#/task/' + encodeURIComponent(tr.getAttribute('data-id'));
      };
    });
  }

  // My work answers "What do I need to do?" and shows only tasks the
  // current user is involved in. Project-wide figures live on Overview.
  function involvesMe(t) {
    return t.assignee === state.me || t.reporter === state.me || t.createdBy === state.me || (t.reviewRequired && t.reviewer === state.me);
  }

  // For admins and project owners: unassigned tasks they can hand out.
  function allocTile() {
    if (!TO.alloc || !activeProjects().some(function (p) { return can.allocate(p.key); })) return '';
    var n = TO.alloc.queue().filter(function (t) { return can.allocate(t.projectKey); }).length;
    return '<a class="tile' + (n ? ' warn' : '') + '" href="#/allocation" data-go="1"><b>' + n + '</b><span>Unassigned in my projects</span></a>';
  }

  function renderHome() {
    var scope = scopedTasks();
    var mine = scope.filter(function (t) { return !isDone(t) && t.assignee === state.me; }).sort(byDue);
    var weekEnd = addDays(today(), C.dueSoonDays);
    var groups = [
      { id: 'overdue', name: 'Overdue', warn: true, list: mine.filter(isOverdue) },
      { id: 'week', name: 'Due in the next ' + C.dueSoonDays + ' days', list: mine.filter(function (t) { return t.dueDate && t.dueDate >= today() && t.dueDate <= weekEnd; }) },
      { id: 'later', name: 'Later', list: mine.filter(function (t) { return t.dueDate && t.dueDate > weekEnd; }) },
      { id: 'nodate', name: 'No delivery date', list: mine.filter(function (t) { return !t.dueDate; }) }
    ];
    var toReview = scope.filter(function (t) {
      return t.reviewRequired && t.reviewer === state.me && t.status !== 'cancelled' && t.reviewStatus !== 'approved';
    }).sort(function (a, b) { return (a.status === 'review' ? 0 : 1) - (b.status === 'review' ? 0 : 1) || byDue(a, b); });
    var readyForReview = toReview.filter(function (t) { return t.status === 'review'; });
    var changed = scope.filter(function (t) { return isChanged(t) && involvesMe(t); })
      .sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
    var proj = state.project ? state.store.projects[state.project] : null;

    function tile(n, label, target, warn) {
      return '<a class="tile' + (warn && n ? ' warn' : '') + '" href="#' + target + '"><b>' + n + '</b><span>' + esc(label) + '</span></a>';
    }
    function section(id, title, sub, html, extra) {
      return '<div class="panel home-section" id="' + id + '"><div class="section-head"><div><h2>' + esc(title) + '</h2>' +
        (sub ? '<div class="small muted">' + esc(sub) + '</div>' : '') + '</div>' + (extra || '') + '</div>' + html + '</div>';
    }

    var myTasks = mine.length ? groups.filter(function (g) { return g.list.length; }).map(function (g) {
      return '<div class="task-group' + (g.warn ? ' warn' : '') + '"><h3>' + esc(g.name) + ' <span class="muted">' + g.list.length + '</span></h3>' +
        miniTable(g.list, { mine: true }) + '</div>';
    }).join('') : '<p class="muted small" style="margin:0">No open tasks are assigned to you.</p>';

    main.innerHTML = '<div class="page-head"><h1>My work' + (proj ? ' <span class="muted">· ' + esc(proj.name) + '</span>' : '') + '</h1>' +
      (canAddHere() ? '<a class="btn btn-primary" href="#/new' + (state.project ? '?project=' + encodeURIComponent(state.project) : '') + '">+ New task</a>' : '') + '</div>' +
      (projects().length ? '' : '<div class="notice">There are no projects yet. ' + (can.createProject() ? '<a href="#/project/new">Create the first project</a>.' : 'Ask an admin to create one.') + '</div>') +
      '<div class="tiles">' +
      tile(mine.length, 'My open tasks', 'sec-mine') +
      tile(groups[0].list.length, 'My overdue tasks', 'sec-mine', true) +
      tile(readyForReview.length, 'Ready for my review', 'sec-review', true) +
      tile(changed.length, 'Changed since I looked', 'sec-changed') +
      allocTile() +
      '</div>' +
      section('sec-mine', 'My tasks', 'Open tasks where you are responsible, by delivery date', myTasks) +
      '<div class="home-grid" style="margin-top:16px">' +
      section('sec-review', 'Waiting for my review', 'Tasks where you are the reviewer. "In Review" ones are ready now.',
        miniTable(toReview, { empty: 'Nothing to review.' })) +
      section('sec-changed', 'Changed since I looked', 'Your tasks, ones you reported or review, changed by someone else',
        miniTable(changed.slice(0, 30), { changed: true, empty: 'No new changes.' }),
        changed.length ? '<button class="btn btn-small" id="btn-seen-all">Mark all as seen</button>' : '') +
      '</div>';

    $all('.tile:not([data-go])', main).forEach(function (a) {
      a.onclick = function (ev) { ev.preventDefault(); var s = document.getElementById(a.getAttribute('href').slice(1)); if (s) s.scrollIntoView({ behavior: 'smooth' }); };
    });
    bindRows(main);
    var b = $('#btn-seen-all');
    if (b) b.onclick = function () { changed.forEach(markSeen); renderHome(); };
  }


  // ---------- task list ----------

  function filteredTasks() {
    var f = state.filters;
    var q = f.q.trim().toLowerCase();
    return scopedTasks().filter(function (t) {
      if (f.status === 'open' && isDone(t)) return false;
      if (f.status && f.status !== 'open' && t.status !== f.status) return false;
      if (f.assignee === '__me' && t.assignee !== state.me) return false;
      if (f.assignee === '__review' && !(t.reviewRequired && t.reviewer === state.me && t.reviewStatus !== 'approved')) return false;
      if (f.assignee === '__changed' && !isChanged(t)) return false;
      if (f.assignee === '__none' && t.assignee) return false;
      if (f.assignee && f.assignee.indexOf('__') !== 0 && t.assignee !== f.assignee) return false;
      if (f.severity && t.severity !== f.severity) return false;
      if (q) {
        var hay = [t.id, wbsOf(t), t.title, t.externalRef, t.description, t.deliverable, t.sourceRef, t.solution, t.reviewComment,
          userName(t.assignee), userDept(t.assignee)].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  var SORTERS = {
    key: byKey,
    wbs: compareWbs,
    title: function (a, b) { return (a.title || '').localeCompare(b.title || ''); },
    status: function (a, b) { return idx(C.statuses, a.status) - idx(C.statuses, b.status); },
    severity: function (a, b) { return idx(C.severities, a.severity) - idx(C.severities, b.severity); },
    assignee: function (a, b) { return userName(a.assignee).localeCompare(userName(b.assignee)); },
    due: function (a, b) { return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : (a.dueDate || '9999') > (b.dueDate || '9999') ? 1 : 0; },
    progress: function (a, b) { return progressOf(a) - progressOf(b); },
    review: function (a, b) { return (a.reviewRequired ? idx(C.reviewStatuses, a.reviewStatus) : 99) - (b.reviewRequired ? idx(C.reviewStatuses, b.reviewStatus) : 99); },
    updated: function (a, b) { return (a.updatedAt || '') < (b.updatedAt || '') ? -1 : 1; }
  };
  function idx(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return i; return 99; }

  // Orders tasks so sub-tasks follow their parent. Returns [{ task, depth }].
  function hierarchical(list) {
    var inList = {};
    list.forEach(function (t) { inList[t.id] = 1; });
    var cmp = function (a, b) { return (SORTERS[state.sort.col] || byKey)(a, b) * state.sort.dir || byKey(a, b); };
    var out = [];
    function add(t, depth) {
      out.push({ task: t, depth: depth });
      list.filter(function (c) { return c.parentId === t.id; }).sort(cmp).forEach(function (c) { add(c, depth + 1); });
    }
    list.filter(function (t) { return !t.parentId || !inList[t.parentId]; }).sort(cmp).forEach(function (t) { add(t, 0); });
    return out;
  }

  function renderTasks() {
    var f = state.filters;
    var proj = state.project ? state.store.projects[state.project] : null;
    var assigneeOpts = [{ id: '__me', name: 'Assigned to me' }, { id: '__review', name: 'Waiting for my review' },
      { id: '__changed', name: 'Changed since I looked' }, { id: '__none', name: 'Unassigned' }].concat(peopleOptions());
    var statusOpts = [{ id: 'open', name: 'All open' }].concat(C.statuses);

    main.innerHTML =
      '<div class="page-head"><h1>' + (proj ? esc(proj.name) + ' – tasks' : 'All tasks') + '</h1>' +
      '<div class="toolbar" style="margin:0"><button class="btn" id="btn-xlsx">Export to Excel</button>' +
      '<button class="btn" id="btn-csv">Export CSV</button>' +
      '<button class="btn" id="btn-word" title="Word report of the completed tasks in this list">Completed → Word</button>' +
      (activeProjects().some(function (p) { return can.allocate(p.key); })
        ? '<button class="btn" id="btn-task-import" title="Create tasks from an Excel list, e.g. action points from minutes">Import tasks…</button>' : '') +
      (canAddHere() ? '<a class="btn btn-primary" href="#/new' + (state.project ? '?project=' + encodeURIComponent(state.project) : '') + '">+ New task</a>' : '') + '</div></div>' +
      '<div class="toolbar">' +
      '<input type="text" id="f-q" placeholder="Search tasks..." value="' + esc(f.q) + '" class="grow">' +
      '<select id="f-status">' + options(statusOpts, f.status, 'Any status') + '</select>' +
      '<select id="f-assignee">' + options(assigneeOpts, f.assignee, 'Anyone') + '</select>' +
      '<select id="f-severity">' + options(C.severities, f.severity, 'Any severity') + '</select>' +
      '</div><div id="task-table"></div>';

    $('#f-q').addEventListener('input', function (e) { f.q = e.target.value; renderTaskTable(); });
    $('#f-status').onchange = function (e) { f.status = e.target.value; renderTaskTable(); };
    $('#f-assignee').onchange = function (e) { f.assignee = e.target.value; renderTaskTable(); };
    $('#f-severity').onchange = function (e) { f.severity = e.target.value; renderTaskTable(); };
    $('#btn-xlsx').onclick = function () { exportTasks('xlsx'); };
    $('#btn-csv').onclick = function () { exportTasks('csv'); };
    var imp = $('#btn-task-import');
    if (imp) imp.onclick = function () { TO.taskImport.open(); };
    $('#btn-word').onclick = function () {
      // Same filters as the list, except status: only completed tasks.
      var keep = f.status;
      f.status = '';
      var list = filteredTasks().filter(function (t) { return t.status === 'done'; });
      f.status = keep;
      TO.reports.openWordDialog(list);
    };
    renderTaskTable();
  }

  function renderTaskTable() {
    var wrap = $('#task-table');
    if (!projects().length) {
      wrap.innerHTML = '<div class="panel empty">There are no projects yet. ' + (can.createProject() ? '<a href="#/project/new">Create the first project</a> to start adding tasks.' : 'Ask an admin to create one.') + '</div>';
      return;
    }
    var rows = hierarchical(filteredTasks());
    if (!rows.length) {
      wrap.innerHTML = '<div class="panel empty">No tasks match. Change the filters or create a new task.</div>';
      return;
    }
    var cols = [['key', 'Key'], ['wbs', 'WBS'], ['title', 'Title'], ['status', 'Status'], ['severity', 'Severity'],
      ['assignee', 'Responsible'], ['due', 'Due'], ['progress', 'Progress'], ['review', 'Review'], ['updated', 'Updated']];
    var head = cols.map(function (c) {
      var arrow = state.sort.col === c[0] ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '';
      return '<th data-sort="' + c[0] + '">' + c[1] + arrow + '</th>';
    }).join('');
    var body = rows.map(function (r) {
      var t = r.task;
      var dept = userDept(t.assignee);
      return '<tr data-id="' + esc(t.id) + '"' + (r.depth ? ' class="sub"' : '') + '>' +
        '<td class="key">' + esc(t.id) + (isLocked(t) ? ' <span title="Finished and locked">🔒</span>' : '') + '</td>' +
        '<td class="wbs">' + esc(wbsOf(t)) + '</td>' +
        '<td class="title-cell" style="padding-left:' + (10 + r.depth * 22) + 'px">' + (r.depth ? '<span class="muted">↳ </span>' : '') + changedDot(t) +
        '<span' + (isChanged(t) ? ' class="changed"' : '') + '>' + esc(t.title) + '</span>' + projectTagHtml(t) + extRefHtml(t) + '</td>' +
        '<td>' + badge(statusOf(t.status)) + '</td>' +
        '<td>' + badge(severityOf(t.severity)) + '</td>' +
        '<td class="nowrap">' + esc(userName(t.assignee)) + (dept ? '<div class="small muted">' + esc(dept) + '</div>' : '') + '</td>' +
        '<td class="nowrap">' + dueHtml(t) + '</td>' +
        '<td class="nowrap">' + progressBar(progressOf(t)) + '</td>' +
        '<td>' + reviewBadge(t) + '</td>' +
        '<td class="nowrap small muted">' + esc(fmtDate(t.updatedAt)) + '</td></tr>';
    }).join('');
    wrap.innerHTML = '<div class="table-wrap"><table class="list"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="small muted">' + rows.length + ' task(s). Overdue dates are red; "+5d" means the delivery date has moved 5 days from the original. ' +
      '<span class="dot"></span> = changed by someone else since you last opened it. 🔒 = finished and locked.</p>';
    $all('th[data-sort]', wrap).forEach(function (th) {
      th.onclick = function () {
        var c = th.getAttribute('data-sort');
        state.sort = { col: c, dir: state.sort.col === c ? -state.sort.dir : 1 };
        renderTaskTable();
      };
    });
    bindRows(wrap);
  }

  // ---------- board ----------

  function renderBoard() {
    var scope = scopedTasks().filter(function (t) { return !state.boardMine || t.assignee === state.me; });
    var proj = state.project ? state.store.projects[state.project] : null;
    var cols = C.statuses.map(function (s) {
      var list = scope.filter(function (t) { return t.status === s.id; }).sort(function (a, b) { return byDue(a, b); });
      return '<div class="board-col" data-status="' + s.id + '"><div class="board-head" style="border-top-color:' + s.color + '">' + esc(s.name) +
        ' <span class="muted">' + list.length + '</span>' + (s.auto ? '<div class="small muted">set automatically</div>' : '') + '</div>' +
        '<div class="board-body">' + list.map(cardHtml).join('') + '</div></div>';
    }).join('');
    main.innerHTML = '<div class="page-head"><h1>Board' + (proj ? ' <span class="muted">· ' + esc(proj.name) + '</span>' : '') + '</h1>' +
      '<div class="toolbar" style="margin:0"><label class="check"><input type="checkbox" id="board-mine"' + (state.boardMine ? ' checked' : '') + '> Only my tasks</label>' +
      (canAddHere() ? '<a class="btn btn-primary" href="#/new' + (state.project ? '?project=' + encodeURIComponent(state.project) : '') + '">+ New task</a>' : '') +
      '</div></div>' +
      '<div id="board-notice" class="notice notice-ok" hidden></div>' +
      (can.edit() ? '<p class="small muted" style="margin-top:0">Drag a card to another column to change its status. Finished tasks are locked (🔒) and must be reopened first.</p>' : '') +
      '<div class="board">' + cols + '</div>';

    $('#board-mine').onchange = function (e) { state.boardMine = e.target.checked; renderBoard(); };
    $all('.card', main).forEach(function (c) {
      c.onclick = function () { location.hash = '#/task/' + encodeURIComponent(c.getAttribute('data-id')); };
      c.addEventListener('dragstart', function (e) {
        state.dragging = true;
        e.dataTransfer.setData('text/plain', c.getAttribute('data-id'));
        e.dataTransfer.effectAllowed = 'move';
        c.classList.add('dragging');
      });
      c.addEventListener('dragend', function () { state.dragging = false; c.classList.remove('dragging'); });
    });
    $all('.board-col', main).forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', function () { col.classList.remove('drop'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('drop');
        state.dragging = false;
        moveTask(e.dataTransfer.getData('text/plain'), col.getAttribute('data-status'));
      });
    });
  }

  function cardHtml(t) {
    var sev = severityOf(t.severity);
    var drag = can.editTask(t);
    return '<div class="card' + (isChanged(t) ? ' card-changed' : '') + '" data-id="' + esc(t.id) + '" draggable="' + drag + '" style="border-left-color:' + sev.color + '">' +
      '<div class="card-top"><span class="key">' + esc(t.id) + '</span><span class="wbs">' + esc(wbsOf(t)) + '</span>' +
      (isLocked(t) ? '<span title="Finished and locked">🔒</span>' : '') + changedDot(t) + '</div>' +
      '<div class="card-title">' + esc(t.title) + '</div>' + (state.project ? '' : '<div>' + projectTagHtml(t) + '</div>') + extRefHtml(t) +
      '<div class="card-meta"><span>' + esc(userName(t.assignee) || 'Unassigned') + '</span>' + (t.dueDate ? '<span>' + dueHtml(t) + '</span>' : '') + '</div>' +
      (t.reviewRequired ? '<div style="margin-top:6px">' + reviewBadge(t) + '</div>' : '') + '</div>';
  }

  async function moveTask(id, status) {
    var t = state.store.tasks[id];
    if (!t || t.status === status) return;
    if (!can.edit()) return toast('You have read-only access.', true);
    if (isLocked(t)) return toast(t.id + ' is finished and locked. Open it and click Reopen first.', true);
    if (statusOf(status).auto) {
      return toast('"' + statusOf(status).name + '" is set automatically: move the task to Done and it goes to review if a review is needed.', true);
    }
    var mine = clone(t);
    mine.status = status;
    var r = prepareSave(t, mine, ['status'], false);
    try {
      var saved = await state.store.saveTask(mine, t);
      markSeen(saved);
      renderBoard();
      var s = suggestNotify(saved, { changes: r.notes, dirty: ['status'], sentForReview: r.sentForReview });
      var n = $('#board-notice');
      n.hidden = false;
      n.innerHTML = esc(saved.id) + ' is now <b>' + esc(statusOf(saved.status).name) + '</b>.' +
        (r.sentForReview ? ' It was sent for review to ' + esc(userName(saved.reviewer)) + '.' : '') +
        (s.to.length ? ' Let ' + esc(s.to.map(userName).join(', ')) + ' know?' : '') +
        ' <button class="btn" id="btn-board-notify">✉ Notify…</button> <button class="btn btn-ghost" id="btn-board-dismiss">No thanks</button>';
      $('#btn-board-notify').onclick = function () { n.hidden = true; openNotify(saved.id, s); };
      $('#btn-board-dismiss').onclick = function () { n.hidden = true; };
    } catch (err) {
      console.error(err);
      toast('Could not move ' + id + ': ' + err.message + '. Refreshing.', true);
      refresh(false);
    }
  }

  // ---------- export ----------

  function exportTasks(kind) {
    var rows = hierarchical(filteredTasks());
    if (!rows.length) return toast('There are no tasks to export with the current filters.', true);
    var cols = [
      ['Key', 10], ['WBS', 8], ['Project', 10], ['Parent', 10], ['Level', 6], ['Title', 40], ['Action point / external ID', 18], ['Status', 12], ['Severity', 10],
      ['Responsible', 18], ['Department', 16], ['Reporter', 18], ['Source', 10],
      ['Start date', 12], ['Due date', 12], ['Original due date', 12], ['Days moved', 8], ['Progress %', 10], ['Overdue', 9],
      ['Description', 50], ['Deliverable', 40], ['Solution', 50], ['Document links', 40],
      ['Review required', 10], ['Reviewer', 18], ['Review result', 16], ['Reviewed by', 18], ['Reviewed date', 12], ["Reviewer's comment", 40],
      ['Linked tasks', 30], ['Completed', 12], ['Created', 12], ['Created by', 18], ['Updated', 12], ['Updated by', 18], ['Log and history', 60]
    ];
    var data = rows.map(function (r) {
      var t = r.task;
      var log = live(t.log).map(function (e) { return fmtDateTime(e.at) + ' ' + userName(e.by) + ': ' + e.text; }).join('\n');
      var links = taskLinks(t).map(function (l) { return l.label + ' ' + l.other; }).join('\n');
      var docs = live(t.docLinks).map(function (d) { return (SECTION_NAMES[d.section] || d.section) + ': ' + (d.title ? d.title + ' – ' : '') + d.url; }).join('\n');
      return [t.id, wbsOf(t), t.projectKey, t.parentId || '', r.depth + 1, t.title, t.externalRef || '', statusOf(t.status).name, severityOf(t.severity).name,
        userName(t.assignee), userDept(t.assignee), userName(t.reporter), t.source || '',
        fmtDate(t.startDate), fmtDate(t.dueDate), fmtDate(t.originalDueDate), slipDays(t) || '', progressOf(t), isOverdue(t) ? 'Yes' : '',
        t.description || '', t.deliverable || '', t.solution || '', docs,
        t.reviewRequired ? 'Yes' : '', t.reviewRequired ? userName(t.reviewer) : '', t.reviewRequired ? reviewOf(t.reviewStatus).name : '',
        userName(t.reviewedBy), fmtDate(t.reviewedAt), t.reviewComment || '',
        links, fmtDate(t.completedAt), fmtDate(t.createdAt), userName(t.createdBy), fmtDate(t.updatedAt), userName(t.updatedBy), log];
    });
    var base = 'Tasks_' + (state.project || 'All') + '_' + today();
    if (kind === 'xlsx') {
      download(TO.xlsx.makeXlsx({
        sheetName: state.project || 'Tasks',
        columns: cols.map(function (c) { return { header: c[0], width: c[1] }; }),
        rows: data
      }), base + '.xlsx');
    } else {
      // Semicolon-separated with BOM so Excel with European settings opens it correctly.
      var csv = [cols.map(function (c) { return c[0]; })].concat(data).map(function (r) {
        return r.map(function (v) {
          var s = String(v == null ? '' : v);
          return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(';');
      }).join('\r\n');
      download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), base + '.csv');
    }
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Downloaded ' + name);
  }

  // ---------- task page (view / edit / new) ----------

  var SECTION_NAMES = { description: 'Description', solution: 'Solution', review: 'Review' };

  function newTaskDoc(q) {
    var src = q.copy ? state.store.tasks[q.copy] : null;
    var parent = q.parent ? state.store.tasks[q.parent] : (src && src.parentId ? state.store.tasks[src.parentId] : null);
    var doc = {
      id: '', number: 0,
      projectKey: src ? src.projectKey : parent ? parent.projectKey : (q.project || state.project || (projects()[0] || {}).key || ''),
      parentId: parent ? parent.id : '',
      title: '', externalRef: '', description: '', deliverable: '',
      source: 'Internal', sourceRef: '',
      status: 'todo', severity: 'medium',
      assignee: '', reporter: state.me,
      startDate: '', dueDate: parent ? (parent.dueDate || '') : '', originalDueDate: '',
      progress: 0, solution: '', completedAt: '',
      reviewRequired: false, reviewer: '', reviewStatus: 'pending', reviewNote: '', reviewComment: '', reviewedAt: '', reviewedBy: '',
      log: [], links: [], docLinks: []
    };
    if (src) {
      ['title', 'description', 'deliverable', 'source', 'severity', 'assignee', 'reviewRequired', 'reviewer', 'reviewNote']
        .forEach(function (k) { if (src[k] != null) doc[k] = clone(src[k]); });
      doc.title = src.title + ' (copy)';
      doc.docLinks = live(src.docLinks).map(function (d) {
        return { id: uid(), section: d.section, title: d.title, url: d.url, by: state.me, at: new Date().toISOString() };
      });
    }
    return doc;
  }

  function renderNewTask(q) {
    if (!can.edit()) { main.innerHTML = '<div class="panel empty">You have read-only access and cannot create tasks.</div>'; return; }
    if (!activeProjects().length) {
      main.innerHTML = '<div class="panel empty">There is no active project. <a href="#/project/new">Create a project</a> or reopen a completed one on the Projects page.</div>';
      return;
    }
    var doc = newTaskDoc(q);
    if (isProjectCompleted(doc.projectKey)) { doc.projectKey = activeProjects()[0].key; doc.parentId = ''; }
    state.edit = { base: doc, isNew: true, dirty: {}, logDraft: '', copyOf: q.copy || '' };
    renderTaskForm(doc);
  }

  function renderTask(id, keepScroll) {
    var t = state.store.tasks[id];
    if (!t) {
      main.innerHTML = '<div class="panel empty">Task ' + esc(id) + ' was not found. It may have been moved or the data folder changed. <a href="#/tasks">Back to tasks</a></div>';
      return;
    }
    var y = window.scrollY;
    state.view = 'task';
    state.edit = { base: clone(t), isNew: false, dirty: {}, logDraft: '' };
    renderTaskForm(t);
    markSeen(t);
    if (keepScroll) window.scrollTo(0, y);
  }

  function parentOptions(doc) {
    var exclude = doc.id ? descendantIds(doc.id) : {};
    if (doc.id) exclude[doc.id] = 1;
    var list = allTasks().filter(function (t) { return t.projectKey === doc.projectKey && !exclude[t.id]; })
      .sort(compareWbs).map(function (t) { return { id: t.id, name: wbsOf(t) + '  ' + t.id + ' – ' + t.title }; });
    return options(list, doc.parentId || '', '— none (top-level task) —');
  }

  function statusOptions(t) {
    var list = C.statuses.filter(function (s) { return !s.auto || s.id === t.status; });
    return options(list, t.status);
  }

  function field(name, label, inputHtml, cls) {
    return '<div class="field' + (cls ? ' ' + cls : '') + '" data-field="' + name + '"><label class="field-label" for="fld-' + name + '">' + label + '</label>' + inputHtml + '</div>';
  }
  function textInput(name, value, extra) { return '<input type="text" id="fld-' + name + '" name="' + name + '" value="' + esc(value) + '"' + (extra || '') + '>'; }
  function textArea(name, value, rows) { return '<textarea id="fld-' + name + '" name="' + name + '" rows="' + (rows || 3) + '">' + esc(value) + '</textarea>'; }
  function select(name, html) { return '<select id="fld-' + name + '" name="' + name + '">' + html + '</select>'; }
  function dateInput(name, value) { return '<input type="date" id="fld-' + name + '" name="' + name + '" value="' + esc(fmtDate(value)) + '">'; }

  function formValue(el) { return el.type === 'checkbox' ? el.checked : el.value; }
  function baseValue(name, base) {
    if (name === 'progress') return String(base.progress || 0);
    if (name === 'ownWeight') return String(base.ownWeight || 0);
    if (name === 'startDate' || name === 'dueDate') return fmtDate(base[name]);
    if (name === 'reviewRequired') return !!base.reviewRequired;
    if (name === 'reviewStatus') return base.reviewStatus || 'pending';
    return base[name] == null ? '' : base[name];
  }

  // Progress for a task with sub-tasks: total, how it is made up, and the
  // "own work" share for integration work done on the task itself.
  var OWN_WEIGHTS = [0, 10, 20, 25, 30, 40, 50, 75, 100];
  function ownWeightOptions(cur) {
    return options(OWN_WEIGHTS.map(function (n) {
      return { id: String(n), name: n === 0 ? '0% – progress only from sub-tasks' : n === 100 ? '100% – set by hand, sub-tasks not counted'
        : n + '% own work, ' + (100 - n) + '% sub-tasks' };
    }), String(cur || 0));
  }
  function progressPartsText(sub, w, own, done) {
    if (done) return 'Done, so 100%.';
    if (!w) return 'Average of the sub-tasks (' + sub + '%).';
    if (w === 100) return 'Set by hand. Sub-tasks are at ' + sub + '% (not counted).';
    return 'Sub-tasks ' + sub + '% × ' + (100 - w) + '% + own work ' + own + '% × ' + w + '%.';
  }
  function parentProgressHtml(t) {
    var w = clampPct(t.ownWeight);
    return '<div class="progress-box"><span class="field-label">Progress</span>' +
      '<div id="prog-total">' + progressBar(progressOf(t)) + '</div>' +
      '<div class="small muted" id="prog-parts">' + esc(progressPartsText(subProgressOf(t), w, clampPct(t.progress), t.status === 'done')) + '</div>' +
      field('ownWeight', 'Own work in this task (e.g. integration, final check)', select('ownWeight', ownWeightOptions(w))) +
      '<div id="own-progress-wrap"' + (w ? '' : ' hidden') + '>' +
      field('progress', 'Own work done %', '<input type="number" min="0" max="100" step="5" id="fld-progress" name="progress" value="' + esc(clampPct(t.progress)) + '">') +
      '</div></div>';
  }
  function updateParentProgress(t) {
    var wEl = $('#fld-ownWeight'), pEl = $('#fld-progress');
    if (!wEl) return;
    var w = clampPct(wEl.value), own = clampPct(pEl && pEl.value), sub = subProgressOf(t);
    var total = t.status === 'done' ? 100 : Math.round(sub * (1 - w / 100) + own * w / 100);
    $('#prog-total').innerHTML = progressBar(total);
    $('#prog-parts').textContent = progressPartsText(sub, w, own, t.status === 'done');
    $('#own-progress-wrap').hidden = !w;
  }

  function renderTaskForm(t) {
    var e = state.edit;
    var isNew = e.isNew;
    var editable = isNew ? can.edit() : can.editTask(t);
    var locked = !isNew && isLocked(t);
    var parent = t.parentId ? state.store.tasks[t.parentId] : null;
    var kids = isNew ? [] : childrenOf(t.id);
    var projOpts = activeProjects().map(function (p) { return { id: p.key, name: p.key + ' – ' + p.name }; });
    var reviewEditable = editable && (isNew || can.setReview(t));
    var moreOpen = lsGet('to.more') === '1';
    var proj = state.store.projects[t.projectKey];

    var crumbs = '<div class="breadcrumb"><a href="#/tasks">Tasks</a> / ' + esc(t.projectKey + (proj ? ' – ' + proj.name : '')) +
      (parent ? ' / <a href="#/task/' + encodeURIComponent(parent.id) + '">' + esc(parent.id) + '</a>' : '') +
      (isNew ? ' / New task' : ' / ' + esc(t.id) + (wbsOf(t) ? ' <span class="muted">(WBS ' + esc(wbsOf(t)) + ')</span>' : '')) + '</div>';

    var notices = '<div id="saved-notice" class="notice notice-ok" hidden></div>' +
      '<div id="remote-notice" class="notice" hidden></div><div id="conflict-notice" class="notice" hidden></div>';
    if (isNew && e.copyOf) notices += '<div class="notice">Copied from <b>' + esc(e.copyOf) + '</b>. Check the fields and press <b>Create task</b>.</div>';
    if (!isNew && isProjectCompleted(t.projectKey)) {
      notices += '<div class="notice notice-lock" id="lock-notice">🔒 The project <b>' + esc(proj.name) + '</b> is completed, so its tasks are read-only. ' +
        'An admin or the project owner can reopen the project on the <a href="#/project/' + encodeURIComponent(t.projectKey) + '">project page</a>.</div>';
    } else if (locked) {
      notices += '<div class="notice notice-lock" id="lock-notice">🔒 This task is <b>' + esc(statusOf(t.status).name.toLowerCase()) + '</b>' +
        (t.completedAt ? ' (' + esc(fmtDate(t.completedAt)) + ')' : '') + ' and locked against changes. ' +
        (can.reopen(t) ? '<button class="btn" id="btn-reopen">Reopen…</button>' +
          '<span id="reopen-form" hidden> <input type="text" id="reopen-reason" placeholder="Why is it reopened?" style="width:260px"> ' +
          '<button class="btn btn-primary" id="btn-reopen-go">Reopen task</button></span>'
          : '<span class="small">Only an admin, the project owner, the responsible person or the reporter can reopen it.</span>') + '</div>';
    } else if (!isNew && !can.edit()) {
      notices += '<div class="notice">You have read-only access.</div>';
    }

    var left =
      '<div class="panel">' +
      field('title', isNew ? 'Title *' : esc(t.id), textInput('title', t.title, ' class="title-input" placeholder="Short summary of the task"')) +
      (isNew ? '' : '<div class="task-project">Project <b>' + esc(t.projectKey) + ' – ' + esc(proj ? proj.name : '') + '</b>' +
        (proj && proj.status === 'completed' ? ' <span class="badge" style="background:#6b7280">Completed</span>' : '') + '</div>') +
      '<div class="form-grid">' +
      (isNew ? field('projectKey', 'Project *', select('projectKey', options(projOpts, t.projectKey))) : '') +
      field('externalRef', 'Action point / external ID',
        textInput('externalRef', t.externalRef, ' placeholder="e.g. AP 4.2 in MoM-045, or supplier ref. 4500-778"') + '<div class="small" id="extref-hint"></div>') +
      field('parentId', 'Parent task (makes this a sub-task)', select('parentId', parentOptions(t))) +
      '</div>' +
      field('description', 'Description', textArea('description', t.description, 6)) +
      '<div class="doclinks" id="doclinks-description"></div>' +
      field('deliverable', 'Deliverable (what will be delivered)', textArea('deliverable', t.deliverable, 3)) +
      field('solution', 'Solution (how it was solved / what was delivered)', textArea('solution', t.solution, 4)) +
      '<div class="doclinks" id="doclinks-solution"></div>' +
      '</div>';

    left += '<h2>Review</h2><div class="panel">' +
      '<label class="check"><input type="checkbox" id="fld-reviewRequired" name="reviewRequired"' + (t.reviewRequired ? ' checked' : '') + '> This task needs a review</label>' +
      '<div id="review-body"' + (t.reviewRequired ? '' : ' hidden') + ' style="margin-top:14px">' +
      '<div class="form-grid">' +
      field('reviewer', 'Reviewer', select('reviewer', options(peopleOptions(t.reviewer), t.reviewer, '— choose —'))) +
      (isNew ? '' : field('reviewStatus', 'Review result', select('reviewStatus', options(C.reviewStatuses, t.reviewStatus || 'pending')), reviewEditable ? '' : 'review-locked')) +
      '</div>' +
      field('reviewNote', 'Note to the reviewer (what to check)', textArea('reviewNote', t.reviewNote, 2)) +
      (isNew ? '' : field('reviewComment', "Reviewer's comment", textArea('reviewComment', t.reviewComment, 3), reviewEditable ? '' : 'review-locked')) +
      (!isNew && !reviewEditable && editable ? '<p class="small muted">Only the reviewer (' + esc(userName(t.reviewer) || 'not chosen') + ') or an admin can set the result and comment.</p>' : '') +
      (t.reviewedAt ? '<p class="small muted">Result "' + esc(reviewOf(t.reviewStatus).name) + '" set by ' + esc(userName(t.reviewedBy)) + ' on ' + esc(fmtDateTime(t.reviewedAt)) + '.</p>' : '') +
      '<p class="small muted">When the task is set to Done it goes to <b>In Review</b>. Approving the review sets it to Done; "Changes requested" sets it back to In Progress.</p>' +
      '<span class="field-label">Review documents</span><div class="doclinks" id="doclinks-review"></div>' +
      '</div></div>';

    if (!isNew) {
      left += '<h2>Sub-tasks (' + kids.length + ')</h2><div class="panel">' +
        (kids.length ? '<table class="list compact"><tbody>' + kids.map(function (c) {
          return '<tr data-id="' + esc(c.id) + '"><td class="key">' + esc(c.id) + '</td><td class="wbs">' + esc(wbsOf(c)) + '</td><td>' + esc(c.title) + '</td><td>' +
            badge(statusOf(c.status)) + '</td><td class="nowrap">' + esc(userName(c.assignee)) + '</td><td class="nowrap">' + progressBar(progressOf(c)) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="muted" style="margin-top:0">No sub-tasks. Split the task up if it has several parts or people.</p>') +
        (can.addTo(t.projectKey) ? '<p style="margin-bottom:0"><a class="btn" href="#/new?parent=' + encodeURIComponent(t.id) + '">+ Add sub-task</a></p>' : '') + '</div>';

      left += '<h2>Linked tasks</h2><div class="panel" id="links-box"></div>';

      left += '<h2>Log and history</h2><div class="panel">' +
        (can.addTo(t.projectKey) ? '<div class="field"><textarea id="log-text" rows="3" placeholder="Add information, decisions, progress notes...">' + esc(e.logDraft) + '</textarea></div>' +
          '<button class="btn btn-primary" id="btn-log">Add log entry</button>' : '') +
        '<div class="seg" id="log-filter">' + [['all', 'All'], ['note', 'Notes'], ['change', 'Changes']].map(function (f) {
          return '<button class="' + (state.logFilter === f[0] ? 'on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>';
        }).join('') + '</div>' +
        '<div id="log-list"></div></div>';
    }

    var slip = slipDays(t);
    var side =
      '<div class="panel">' +
      (t.reviewRequired && !isNew ? '<div class="field">' + reviewBadge(t) + (t.reviewer ? ' <span class="small muted">reviewer ' + esc(userName(t.reviewer)) + '</span>' : '') + '</div>' : '') +
      field('status', 'Status', select('status', statusOptions(t))) +
      field('severity', 'Severity', select('severity', options(C.severities, t.severity))) +
      field('assignee', 'Responsible (assignee)', select('assignee', options(peopleOptions(t.assignee), t.assignee, '— unassigned —'))) +
      field('dueDate', 'Delivery date', dateInput('dueDate', t.dueDate)) +
      (t.originalDueDate && fmtDate(t.originalDueDate) !== fmtDate(t.dueDate)
        ? '<p class="small muted" style="margin-top:-8px">Original: ' + esc(fmtDate(t.originalDueDate)) + (slip ? ' <span class="slip">(' + (slip > 0 ? '+' : '') + slip + ' days)</span>' : '') + '</p>' : '') +
      (kids.length ? parentProgressHtml(t) : '') +
      '<details id="more-details"' + (moreOpen ? ' open' : '') + '><summary>More details</summary>' +
      field('source', 'Source', select('source', options(C.sources.map(function (s) { return { id: s, name: s }; }), t.source))) +
      field('reporter', 'Reporter', select('reporter', options(peopleOptions(t.reporter), t.reporter, '—'))) +
      field('startDate', 'Start date', dateInput('startDate', t.startDate)) +
      (kids.length ? '' : field('progress', 'Progress %', '<input type="number" min="0" max="100" step="5" id="fld-progress" name="progress" value="' + esc(t.progress || 0) + '">')) +
      '</details>' +
      (editable ? '<div class="sticky-actions"><button class="btn btn-primary" id="btn-save" title="Ctrl+S">' + (isNew ? 'Create task' : 'Save changes') + '</button>' +
        '<button class="btn" id="btn-cancel">' + (isNew ? 'Cancel' : 'Discard changes') + '</button></div>' : '') +
      (isNew ? '' : '<div class="sticky-actions"><button class="btn" id="btn-notify">✉ Notify by email…</button>' +
        (can.addTo(t.projectKey) ? '<a class="btn" href="#/new?copy=' + encodeURIComponent(t.id) + '">Copy task</a>' : '') + '</div>' +
        '<div class="sticky-actions"><button class="btn" id="btn-task-word">Export to Word</button></div>') +
      (isNew ? '' : '<p class="small muted" style="margin-bottom:0">Created ' + esc(fmtDateTime(t.createdAt)) + ' by ' + esc(userName(t.createdBy)) +
        '<br>Updated ' + esc(fmtDateTime(t.updatedAt)) + ' by ' + esc(userName(t.updatedBy)) +
        (t.completedAt ? '<br>Completed ' + esc(fmtDate(t.completedAt)) : '') + '</p>') +
      '</div>';

    main.innerHTML = crumbs + notices + '<div class="detail"><div>' + left + '</div><div class="detail-side">' + side + '</div></div>';

    // Read-only: locked task, viewer, or review fields for non-reviewers.
    $all('[name]', main).forEach(function (el) {
      if (!editable) el.disabled = true;
      else if (!reviewEditable && (el.name === 'reviewStatus' || el.name === 'reviewComment')) el.disabled = true;
    });

    // Track which fields the user changed, so only those are saved and merged.
    $all('[name]', main).forEach(function (el) {
      var handler = function () {
        var name = el.name;
        if (String(formValue(el)) !== String(baseValue(name, e.base))) e.dirty[name] = true; else delete e.dirty[name];
        var f = el.closest('.field');
        if (f && !isNew) f.classList.toggle('dirty', !!e.dirty[name]);
        if (name === 'projectKey') {
          e.base.projectKey = el.value;
          e.base.parentId = '';
          $('#fld-parentId').innerHTML = parentOptions(e.base);
        }
        if (name === 'reviewRequired') $('#review-body').hidden = !el.checked;
        if (name === 'externalRef') showExtRefHint(el.value, t.id);
        if ((name === 'ownWeight' || name === 'progress') && kids.length) updateParentProgress(t);
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

    $('#more-details').addEventListener('toggle', function (ev) { lsSet('to.more', ev.target.open ? '1' : '0'); });
    showExtRefHint(t.externalRef, t.id);
    bindRows($('.detail', main));
    if (editable) {
      $('#btn-save').onclick = function () { saveTask(false); };
      $('#btn-cancel').onclick = function () {
        if (isNew) {
          state.edit = null;
          location.hash = t.parentId ? '#/task/' + encodeURIComponent(t.parentId) : '#/tasks';
          return;
        }
        state.edit.dirty = {};
        renderTask(t.id);
      };
    }
    if (locked && can.reopen(t)) {
      $('#btn-reopen').onclick = function () { $('#reopen-form').hidden = false; $('#btn-reopen').hidden = true; $('#reopen-reason').focus(); };
      $('#btn-reopen-go').onclick = function () { reopenTask(t.id, $('#reopen-reason').value.trim()); };
    }
    if (!isNew) {
      if ($('#log-text')) {
        $('#log-text').addEventListener('input', function (ev) { e.logDraft = ev.target.value; });
        $('#btn-log').onclick = addLog;
      }
      $all('#log-filter button').forEach(function (b) {
        b.onclick = function () {
          state.logFilter = b.getAttribute('data-f');
          $all('#log-filter button').forEach(function (x) { x.classList.toggle('on', x === b); });
          renderLog(state.store.tasks[t.id] || t);
        };
      });
      $('#btn-notify').onclick = function () { openNotify(t.id, {}); };
      $('#btn-task-word').onclick = function () { TO.reports.exportWord([state.store.tasks[t.id] || t], { single: true }); };
      showSavedNotice(t);
    } else {
      $('#fld-title').focus();
    }
    renderTaskSections(t);
  }

  // Parts of the task page that are saved immediately (log, links, document
  // links) and re-rendered on their own.
  function renderTaskSections(t) {
    var e = state.edit;
    var isNew = e && e.isNew;
    var editable = isNew ? can.edit() : can.editTask(t);
    var docSource = isNew ? e.base : t;
    ['description', 'solution', 'review'].forEach(function (s) {
      renderDocLinks(docSource, s, s === 'review' ? editable && (isNew || can.setReview(t) || t.assignee === state.me || can.admin()) : editable);
    });
    if (isNew) return;
    renderLog(t);
    renderLinks(t, editable);
  }

  function refreshTaskSections(taskId) {
    var t = state.store.tasks[taskId];
    if (t && state.edit && !state.edit.isNew && state.edit.base.id === taskId) renderTaskSections(t);
  }

  // ---------- log and history ----------

  var TEXT_FIELDS = { description: 1, deliverable: 1, solution: 1, reviewNote: 1, reviewComment: 1 };

  function renderLog(t) {
    var box = $('#log-list');
    if (!box) return;
    var editable = can.editTask(t);
    var f = state.logFilter;
    var log = live(t.log).filter(function (l) {
      if (f === 'note') return l.kind === 'note';
      if (f === 'change') return l.kind !== 'note';
      return true;
    }).slice().reverse();
    if (!log.length) { box.innerHTML = '<p class="muted">Nothing here yet.</p>'; return; }
    box.innerHTML = log.map(function (l) {
      var details = '';
      if (l.kind === 'change' && TEXT_FIELDS[l.field]) {
        details = '<details class="diff"><summary>Show before and after</summary><div class="diff-label">Before</div><pre>' + esc(l.from || '(empty)') +
          '</pre><div class="diff-label">After</div><pre>' + esc(l.to || '(empty)') + '</pre></details>';
      }
      var restore = editable && l.kind === 'change' && $('[name="' + l.field + '"]', main) && !$('[name="' + l.field + '"]', main).disabled
        ? ' <button class="btn btn-ghost btn-small" data-restore="' + esc(l.id) + '" title="Put the previous value back in the form">Restore previous</button>' : '';
      return '<div class="log-entry ' + (l.kind === 'note' ? 'note' : 'system') + '"><div class="meta">' +
        esc(fmtDateTime(l.at)) + ' · ' + esc(userName(l.by)) + restore + '</div><div class="text">' + esc(l.text) + '</div>' + details + '</div>';
    }).join('');
    $all('[data-restore]', box).forEach(function (b) {
      b.onclick = function () {
        var entry = live(t.log).filter(function (x) { return x.id === b.getAttribute('data-restore'); })[0];
        var el = $('[name="' + entry.field + '"]', main);
        if (el.closest('details')) el.closest('details').open = true;
        if (el.type === 'checkbox') el.checked = !!entry.from;
        else el.value = entry.field === 'startDate' || entry.field === 'dueDate' ? fmtDate(entry.from) : (entry.from == null ? '' : entry.from);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        toast('Previous value put back. Press Save to keep it.');
      };
    });
  }

  function logEntry(text, kind) { return { id: uid(), at: new Date().toISOString(), by: state.me, kind: kind || 'system', text: text }; }

  var FIELD_LABELS = {
    title: 'Title', externalRef: 'Action point / external ID', parentId: 'Parent task', source: 'Source', ownWeight: 'Own work share', description: 'Description',
    deliverable: 'Deliverable', solution: 'Solution', status: 'Status', severity: 'Severity',
    assignee: 'Responsible', reporter: 'Reporter', startDate: 'Start date', dueDate: 'Delivery date', progress: 'Progress',
    reviewRequired: 'Review required', reviewer: 'Reviewer', reviewStatus: 'Review result',
    reviewNote: 'Note to reviewer', reviewComment: "Reviewer's comment",
    completedAt: 'Completed date', reviewedAt: 'Review date', reviewedBy: 'Reviewed by', originalDueDate: 'Original delivery date'
  };
  // Fields recorded in the change history (bookkeeping fields are left out).
  var HISTORY_FIELDS = ['title', 'externalRef', 'parentId', 'status', 'severity', 'assignee', 'dueDate', 'reviewRequired', 'reviewer', 'reviewStatus',
    'description', 'deliverable', 'solution', 'reviewNote', 'reviewComment', 'source', 'reporter', 'startDate', 'progress', 'ownWeight'];

  function displayValue(k, v) {
    if (v === '' || v == null) return '(empty)';
    if (k === 'status') return statusOf(v).name;
    if (k === 'severity') return severityOf(v).name;
    if (k === 'reviewStatus') return reviewOf(v).name;
    if (k === 'assignee' || k === 'reporter' || k === 'reviewer') return userName(v);
    if (k === 'reviewRequired') return v ? 'Yes' : 'No';
    if (k === 'startDate' || k === 'dueDate') return fmtDate(v);
    if (k === 'progress' || k === 'ownWeight') return v + '%';
    return truncate(v, 80);
  }

  function changeEntry(k, from, to) {
    var e = logEntry(TEXT_FIELDS[k] ? FIELD_LABELS[k] + ' changed' : FIELD_LABELS[k] + ': ' + displayValue(k, from) + ' → ' + displayValue(k, to), 'change');
    e.field = k;
    e.from = from == null ? '' : from;
    e.to = to == null ? '' : to;
    return e;
  }

  // Workflow rules applied on every save (form, board, reopen).
  function applyRules(base, mine, changed, isNew) {
    var now = new Date().toISOString();
    var auto = [];
    var sentForReview = false;
    var has = function (k) { return isNew || changed.indexOf(k) >= 0; };
    mine.reviewStatus = mine.reviewStatus || 'pending';
    if (!mine.reviewRequired) {
      if (mine.status === 'review') { mine.status = 'done'; auto.push('Review no longer required – status set to Done'); }
    } else {
      if (has('reviewStatus') && mine.reviewStatus !== (base.reviewStatus || 'pending') && mine.status === 'review') {
        if (mine.reviewStatus === 'approved') { mine.status = 'done'; auto.push('Review approved – status set to Done'); }
        if (mine.reviewStatus === 'changes') { mine.status = 'inprogress'; auto.push('Changes requested – status set back to In Progress'); }
      }
      if (mine.status === 'done' && mine.reviewStatus !== 'approved') {
        if (mine.reviewStatus === 'changes') mine.reviewStatus = 'pending';
        mine.status = 'review';
        sentForReview = true;
        auto.push('Marked as done – sent for review to ' + (userName(mine.reviewer) || 'the reviewer'));
      }
    }
    if (isNew || mine.reviewStatus !== (base.reviewStatus || 'pending') || mine.reviewRequired !== !!base.reviewRequired) {
      if (!mine.reviewRequired || mine.reviewStatus === 'pending') { mine.reviewedAt = ''; mine.reviewedBy = ''; }
      else if (mine.reviewStatus !== (base.reviewStatus || 'pending')) { mine.reviewedAt = now; mine.reviewedBy = state.me; }
    }
    if (isDone(mine) && (isNew || !isDone(base))) { mine.completedAt = now; if (mine.status === 'done') mine.progress = 100; }
    if (!isDone(mine)) mine.completedAt = '';
    if (!mine.originalDueDate) {
      var orig = (!isNew && base.dueDate) || mine.dueDate || '';
      if (orig) mine.originalDueDate = fmtDate(orig);
    }
    return { auto: auto, sentForReview: sentForReview };
  }

  // Applies the rules and writes history entries into mine.log.
  // Returns { notes: [text for email], sentForReview }.
  function prepareSave(base, mine, changed, isNew) {
    var r = applyRules(base, mine, changed, isNew);
    var entries = [];
    if (isNew) entries.push(logEntry('Task created'));
    else HISTORY_FIELDS.forEach(function (k) { if (!same(base[k], mine[k])) entries.push(changeEntry(k, base[k], mine[k])); });
    r.auto.forEach(function (a) { entries.push(logEntry(a)); });
    mine.log = (mine.log || []).concat(entries);
    return {
      notes: entries.filter(function (x) { return x.kind === 'change'; }).map(function (x) { return x.text; }).concat(r.auto),
      sentForReview: r.sentForReview
    };
  }

  // Saves a change to one of the task's lists (log, links, document links)
  // right away, on top of the latest version, without touching unsaved form edits.
  async function updateTaskNow(taskId, mutate) {
    var latest = state.store.tasks[taskId];
    var mine = clone(latest);
    mutate(mine);
    var saved = await state.store.saveTask(mine, latest);
    markSeen(saved);
    var e = state.edit;
    if (e && !e.isNew && e.base.id === taskId && !Object.keys(e.dirty).length) e.base = clone(saved);
    return saved;
  }

  async function addLog() {
    var e = state.edit;
    var text = ($('#log-text').value || '').trim();
    if (!text) return toast('Write something in the log first.', true);
    $('#btn-log').disabled = true;
    try {
      var saved = await updateTaskNow(e.base.id, function (m) { m.log = (m.log || []).concat([logEntry(text, 'note')]); });
      e.logDraft = '';
      $('#log-text').value = '';
      renderLog(saved);
      toast('Log entry added');
    } catch (err) {
      console.error(err);
      toast('Could not add log entry: ' + err.message, true);
    }
    $('#btn-log').disabled = false;
  }

  async function reopenTask(id, reason) {
    if (!reason) { toast('Write why the task is reopened.', true); $('#reopen-reason').focus(); return; }
    var t = state.store.tasks[id];
    var mine = clone(t);
    mine.status = 'inprogress';
    var changed = ['status'];
    if (mine.reviewRequired) { mine.reviewStatus = 'pending'; changed.push('reviewStatus'); }
    prepareSave(t, mine, changed, false);
    mine.log.push(logEntry('Reopened: ' + reason, 'note'));
    try {
      var saved = await state.store.saveTask(mine, t);
      toast(saved.id + ' reopened');
      renderTask(saved.id);
    } catch (err) {
      console.error(err);
      toast('Could not reopen: ' + err.message, true);
    }
  }

  // ---------- links between tasks ----------

  function renderLinks(t, editable) {
    var box = $('#links-box');
    if (!box) return;
    var links = taskLinks(t);
    var targets = allTasks().filter(function (o) { return o.id !== t.id; }).sort(byKey)
      .map(function (o) { return { id: o.id, name: o.id + ' – ' + truncate(o.title, 60) }; });
    box.innerHTML =
      (links.length ? '<table class="list compact"><tbody>' + links.map(function (l, i) {
        var o = state.store.tasks[l.other];
        return '<tr><td class="nowrap muted">' + esc(l.label) + '</td>' +
          '<td class="key"><a href="#/task/' + encodeURIComponent(l.other) + '">' + esc(l.other) + '</a></td>' +
          '<td>' + (o ? esc(o.title) : '<span class="muted">(task not found)</span>') + '</td>' +
          '<td>' + (o ? badge(statusOf(o.status)) : '') + '</td>' +
          (editable ? '<td class="nowrap"><button class="btn btn-ghost btn-small" data-unlink="' + i + '" title="Remove link">✕</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<p class="muted" style="margin-top:0">No linked tasks.</p>') +
      (editable && targets.length ? '<div class="toolbar" style="margin:12px 0 0">' +
        '<select id="link-type" style="width:auto">' + options(C.linkTypes, 'relates') + '</select>' +
        '<select id="link-target" class="grow">' + options(targets, '', '— choose a task —') + '</select>' +
        '<button class="btn" id="btn-link">Add link</button></div>' : '');

    $all('[data-unlink]', box).forEach(function (b) {
      b.onclick = async function () {
        var l = links[parseInt(b.getAttribute('data-unlink'), 10)];
        try {
          await updateTaskNow(l.owner, function (m) {
            (m.links || []).forEach(function (x) { if (x.id === l.entry.id) x.removed = true; });
            m.log = (m.log || []).concat([logEntry('Removed link: ' + linkTypeOf(l.entry.type).name + ' ' + l.entry.target)]);
          });
          refreshTaskSections(t.id);
          toast('Link removed');
        } catch (err) { toast('Could not remove link: ' + err.message, true); }
      };
    });
    var btn = $('#btn-link', box);
    if (btn) btn.onclick = async function () {
      var type = $('#link-type').value;
      var target = $('#link-target').value;
      if (!target) return toast('Choose the task to link to.', true);
      if (links.some(function (l) { return l.other === target && l.label === linkTypeOf(type).name; })) return toast('That link already exists.', true);
      try {
        await updateTaskNow(t.id, function (m) {
          m.links = (m.links || []).concat([{ id: uid(), type: type, target: target, by: state.me, at: new Date().toISOString() }]);
          m.log = (m.log || []).concat([logEntry('Linked: ' + linkTypeOf(type).name + ' ' + target)]);
        });
        refreshTaskSections(t.id);
        toast('Link added');
      } catch (err) { toast('Could not add link: ' + err.message, true); }
    };
  }

  // ---------- links to documents (description, solution, review) ----------

  function renderDocLinks(t, section, editable) {
    var box = $('#doclinks-' + section);
    if (!box) return;
    var list = live(t.docLinks).filter(function (d) { return d.section === section; });
    box.innerHTML = list.map(function (d) {
      return '<div class="doclink"><span class="doc-icon">📄</span><a href="' + esc(linkHref(d.url)) + '" target="_blank" rel="noopener">' + esc(d.title || fileNameOf(d.url)) + '</a>' +
        '<span class="small muted path" title="' + esc(d.url) + '">' + esc(d.url) + '</span>' +
        '<button class="btn btn-ghost btn-small" data-copy="' + esc(d.id) + '" title="Copy the path to paste into Explorer">Copy path</button>' +
        (editable ? '<button class="btn btn-ghost btn-small" data-undoc="' + esc(d.id) + '" title="Remove link">✕</button>' : '') + '</div>';
    }).join('') +
      (editable ? '<div class="doclink-add" hidden><input type="text" class="doc-url" placeholder="Path or address, e.g. S:\\Projects\\Report.docx or https://...">' +
        '<input type="text" class="doc-title" placeholder="Name (optional)"><button class="btn btn-primary btn-small doc-save">Add</button>' +
        '<button class="btn btn-ghost btn-small doc-cancel">Cancel</button></div>' +
        '<button class="btn btn-ghost btn-small doc-open">+ Add link to document</button>' : '');

    $all('[data-copy]', box).forEach(function (b) {
      b.onclick = function () { copyText(list.filter(function (d) { return d.id === b.getAttribute('data-copy'); })[0].url); };
    });
    if (!editable) return;
    var form = $('.doclink-add', box);
    $('.doc-open', box).onclick = function () { form.hidden = false; this.hidden = true; $('.doc-url', box).focus(); };
    $('.doc-cancel', box).onclick = function () { renderDocLinks(t, section, editable); };
    $('.doc-url', box).addEventListener('keydown', function (ev) { if (ev.key === 'Enter') $('.doc-save', box).click(); });
    $('.doc-save', box).onclick = async function () {
      var url = $('.doc-url', box).value.trim().replace(/^"(.*)"$/, '$1');
      if (!url) return toast('Paste the path or address of the document.', true);
      var entry = { id: uid(), section: section, url: url, title: $('.doc-title', box).value.trim(), by: state.me, at: new Date().toISOString() };
      var e = state.edit;
      if (e && e.isNew) {
        e.base.docLinks = (e.base.docLinks || []).concat([entry]);
        return renderDocLinks(e.base, section, editable);
      }
      try {
        await updateTaskNow(t.id, function (m) {
          m.docLinks = (m.docLinks || []).concat([entry]);
          m.log = (m.log || []).concat([logEntry('Document linked to ' + SECTION_NAMES[section] + ': ' + (entry.title || fileNameOf(url)))]);
        });
        refreshTaskSections(t.id);
        toast('Link added');
      } catch (err) { toast('Could not add link: ' + err.message, true); }
    };
    $all('[data-undoc]', box).forEach(function (b) {
      b.onclick = async function () {
        var id = b.getAttribute('data-undoc');
        var d = list.filter(function (x) { return x.id === id; })[0];
        var e = state.edit;
        if (e && e.isNew) {
          e.base.docLinks = e.base.docLinks.filter(function (x) { return x.id !== id; });
          return renderDocLinks(e.base, section, editable);
        }
        try {
          await updateTaskNow(t.id, function (m) {
            (m.docLinks || []).forEach(function (x) { if (x.id === id) x.removed = true; });
            m.log = (m.log || []).concat([logEntry('Document link removed from ' + SECTION_NAMES[section] + ': ' + (d.title || fileNameOf(d.url)))]);
          });
          refreshTaskSections(t.id);
        } catch (err) { toast('Could not remove: ' + err.message, true); }
      };
    });
  }

  // ---------- saving ----------

  function readForm() {
    var vals = {};
    $all('[name]', main).forEach(function (el) { if (!el.disabled) vals[el.name] = formValue(el); });
    if (vals.progress != null) vals.progress = Math.max(0, Math.min(100, parseInt(vals.progress, 10) || 0));
    if (vals.ownWeight != null) vals.ownWeight = Math.max(0, Math.min(100, parseInt(vals.ownWeight, 10) || 0));
    return vals;
  }

  async function saveTask(force) {
    var e = state.edit;
    var vals = readForm();
    if (!vals.title || !vals.title.trim()) { toast('The task needs a title.', true); $('#fld-title').focus(); return; }
    if (e.isNew && !vals.projectKey) { toast('Choose a project.', true); return; }

    var mine = clone(e.base);
    var changed = e.isNew ? Object.keys(vals) : Object.keys(e.dirty);
    if (!changed.length) return toast('Nothing to save.');
    changed.forEach(function (k) { if (k in vals) mine[k] = typeof vals[k] === 'string' ? vals[k].trim() : vals[k]; });
    if (mine.reviewRequired && !mine.reviewer) { toast('Choose a reviewer, or untick "This task needs a review".', true); return; }

    var r = prepareSave(e.base, mine, changed, e.isNew);

    var btn = $('#btn-save');
    btn.disabled = true;
    try {
      var saved;
      if (e.isNew) {
        saved = await state.store.createTask(mine);
        markSeen(saved);
        state.edit = null;
        state.pendingNotify = { taskId: saved.id, isNew: true, changes: [] };
        location.hash = '#/task/' + encodeURIComponent(saved.id);
      } else {
        saved = await state.store.saveTask(mine, e.base, { force: force });
        state.edit = null;
        state.pendingNotify = { taskId: saved.id, isNew: false, changes: r.notes, dirty: changed, sentForReview: r.sentForReview };
        renderTask(saved.id);
        if (r.sentForReview) toast('Sent for review to ' + userName(saved.reviewer));
      }
      renderChrome();
    } catch (err) {
      btn.disabled = false;
      if (err instanceof TO.Store.ConflictError) return showConflict(err);
      console.error(err);
      toast('Could not save: ' + err.message, true);
    }
  }

  function showConflict(err) {
    var n = $('#conflict-notice');
    var who = userName(err.theirs.updatedBy) || 'someone else';
    n.hidden = false;
    n.innerHTML = '<b>' + esc(who) + '</b> changed the same field(s) while you were editing: <b>' +
      esc(err.fields.map(function (f) { return FIELD_LABELS[f] || f; }).join(', ')) + '</b>. ' +
      '<button class="btn" id="btn-force">Keep my values</button>' +
      '<button class="btn" id="btn-theirs">Discard mine and show theirs</button>';
    window.scrollTo(0, 0);
    $('#btn-force').onclick = function () { saveTask(true); };
    $('#btn-theirs').onclick = function () {
      state.store.tasks[err.theirs.id] = err.theirs;
      state.edit = null;
      renderTask(err.theirs.id);
    };
  }

  // ---------- email notifications ----------

  // Who to suggest notifying after a change, and with which message.
  function suggestNotify(t, p) {
    var to = [];
    var type = 'updated';
    var add = function (id) { if (id && id !== state.me && to.indexOf(id) < 0) to.push(id); };
    var dirty = p.dirty || [];
    var has = function (k) { return dirty.indexOf(k) >= 0; };
    if (p.isNew) {
      type = t.assignee ? 'assigned' : 'info';
      add(t.assignee);
      if (t.reviewRequired) add(t.reviewer);
    } else if (p.sentForReview) {
      type = 'review';
      add(t.reviewer);
    } else if (has('assignee') && t.assignee) {
      type = 'assigned';
      add(t.assignee);
    } else if ((has('reviewRequired') || has('reviewer')) && t.reviewRequired) {
      type = 'review';
      add(t.reviewer);
    } else {
      add(t.assignee);
      if (t.reviewRequired) add(t.reviewer);
      add(t.reporter);
    }
    return { type: type, to: to, changes: p.changes || [] };
  }

  function showSavedNotice(t) {
    var p = state.pendingNotify;
    if (!p || p.taskId !== t.id) return;
    state.pendingNotify = null;
    var s = suggestNotify(t, p);
    var n = $('#saved-notice');
    n.hidden = false;
    n.innerHTML = (p.isNew ? 'Task <b>' + esc(t.id) + '</b> created.' : p.sentForReview ? 'Saved and <b>sent for review</b>.' : 'Changes saved.') +
      (s.to.length ? ' Let ' + esc(s.to.map(userName).join(', ')) + ' know?' : ' Let someone know?') +
      ' <button class="btn" id="btn-notify-suggest">✉ Notify…</button>' +
      ' <button class="btn btn-ghost" id="btn-notify-dismiss">No thanks</button>';
    $('#btn-notify-suggest').onclick = function () { n.hidden = true; openNotify(t.id, s); };
    $('#btn-notify-dismiss').onclick = function () { n.hidden = true; };
  }

  function taskUrl(id) { return location.href.split('#')[0] + '#/task/' + encodeURIComponent(id); }

  function buildEmail(t, typeId, message, changes) {
    var p = state.store.projects[t.projectKey];
    var typeName = notifyTypeOf(typeId).name;
    var lines = [];
    lines.push('Hi,', '');
    if (message) lines.push(message, '');
    lines.push(typeName + ': ' + t.id + ' – ' + t.title, '');
    if (changes && changes.length) {
      lines.push('Changes:');
      changes.forEach(function (c) { lines.push('- ' + c); });
      lines.push('');
    }
    if (t.externalRef) lines.push('Action point / external ID: ' + t.externalRef);
    lines.push('Project: ' + t.projectKey + (p ? ' – ' + p.name : '') + (wbsOf(t) ? '    WBS: ' + wbsOf(t) : ''));
    lines.push('Status: ' + statusOf(t.status).name + '    Severity: ' + severityOf(t.severity).name);
    lines.push('Responsible: ' + (userLabel(t.assignee) || 'unassigned'));
    if (t.dueDate) lines.push('Delivery date: ' + fmtDate(t.dueDate) + (isOverdue(t) ? ' (OVERDUE)' : '') +
      (slipDays(t) ? ' (originally ' + fmtDate(t.originalDueDate) + ')' : ''));
    if (t.reviewRequired) {
      lines.push('Reviewer: ' + userName(t.reviewer) + '    Review: ' + reviewOf(t.reviewStatus).name);
      if (typeId === 'review' && t.reviewNote) lines.push('Note to reviewer: ' + truncate(t.reviewNote, 300));
    }
    if (t.description) lines.push('', 'Description:', truncate(t.description, 400));
    if (t.deliverable) lines.push('', 'Deliverable:', truncate(t.deliverable, 250));
    var docs = live(t.docLinks);
    if (docs.length) {
      lines.push('', 'Documents:');
      docs.slice(0, 5).forEach(function (d) { lines.push('- ' + (d.title ? d.title + ': ' : '') + d.url); });
    }
    lines.push('', 'Open the task: ' + taskUrl(t.id));
    lines.push('', 'Regards,', userName(state.me));
    return {
      subject: '[' + t.id + '] ' + typeName + ': ' + t.title,
      body: lines.join('\r\n')
    };
  }

  function openNotify(taskId, preset) {
    var t = state.store.tasks[taskId];
    var p = state.store.projects[t.projectKey];
    var s = preset.type ? preset : suggestNotify(t, { changes: preset.changes });
    var roles = {};
    var addRole = function (id, r) { if (id) (roles[id] = roles[id] || []).push(r); };
    addRole(t.assignee, 'Responsible');
    addRole(t.reporter, 'Reporter');
    if (t.reviewRequired) addRole(t.reviewer, 'Reviewer');
    if (p) addRole(p.owner, 'Project owner');
    var people = users().filter(function (u) { return u.active !== false || roles[u.id]; }).sort(function (a, b) {
      var ra = roles[a.id] ? 0 : 1, rb = roles[b.id] ? 0 : 1;
      return ra - rb || a.name.localeCompare(b.name);
    });

    var dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = '<h2 style="margin-top:0">Notify about ' + esc(t.id) + '</h2>' +
      '<p class="small muted" style="margin-top:0">Opens a ready-made email in Outlook. Check it and press Send.</p>' +
      '<div class="field"><label class="field-label" for="n-type">Message</label><select id="n-type">' + options(C.notifyTypes, s.type) + '</select></div>' +
      '<span class="field-label">Send to</span><div class="recipients">' + people.map(function (u) {
        var r = roles[u.id] ? '<span class="small muted"> – ' + esc(roles[u.id].join(', ')) + '</span>' : '';
        var dis = u.email ? '' : ' disabled';
        var chk = u.email && s.to.indexOf(u.id) >= 0 ? ' checked' : '';
        return '<label class="check"><input type="checkbox" value="' + esc(u.id) + '"' + chk + dis + '> ' + esc(userLabel(u.id)) + r +
          (u.email ? '' : ' <span class="small error">(no email registered)</span>') + '</label>';
      }).join('') + '</div>' +
      '<div class="field"><label class="field-label" for="n-msg">Personal message (optional)</label><textarea id="n-msg" rows="3"></textarea></div>' +
      (s.changes && s.changes.length ? '<p class="small muted">The email will list the changes: ' + esc(s.changes.join('; ')) + '</p>' : '') +
      '<div class="toolbar" style="margin:0"><button class="btn btn-primary" id="n-send">Open email</button>' +
      '<button class="btn" id="n-cancel">Cancel</button></div>';
    document.body.appendChild(dlg);
    dlg.showModal();
    var close = function () { dlg.close(); dlg.remove(); };
    $('#n-cancel', dlg).onclick = close;
    dlg.addEventListener('cancel', function () { setTimeout(function () { dlg.remove(); }, 0); });
    $('#n-send', dlg).onclick = async function () {
      var ids = $all('.recipients input:checked', dlg).map(function (c) { return c.value; });
      if (!ids.length) return toast('Choose at least one person with an email address.', true);
      var typeId = $('#n-type', dlg).value;
      var mail = buildEmail(t, typeId, $('#n-msg', dlg).value.trim(), s.changes);
      var to = ids.map(function (id) { return userById(id).email; });
      var href = 'mailto:' + to.map(encodeURIComponent).join(C.mailSeparator) +
        '?subject=' + encodeURIComponent(mail.subject) + '&body=' + encodeURIComponent(mail.body);
      var a = document.createElement('a');
      a.href = href;
      a.click();
      close();
      if (!can.edit()) return;
      try {
        await updateTaskNow(t.id, function (m) {
          m.log = (m.log || []).concat([logEntry('Email prepared (' + notifyTypeOf(typeId).name + ') to: ' + ids.map(userName).join(', '))]);
        });
        refreshTaskSections(t.id);
      } catch (err) { console.warn(err); }
    };
  }

  // ---------- projects ----------

  function renderProjects() {
    // Active projects first, completed ones greyed out at the bottom.
    var list = activeProjects().concat(projects().filter(function (p) { return p.status === 'completed'; }));
    var tasks = allTasks();
    main.innerHTML = '<div class="page-head"><h1>Projects</h1>' + (can.createProject() ? '<a class="btn btn-primary" href="#/project/new">+ New project</a>' : '') + '</div>' +
      (list.length ? '<div class="table-wrap"><table class="list"><thead><tr><th>Key</th><th>Name</th><th>Status</th><th>Owner</th><th>Open</th><th>Total</th><th>Overdue</th><th>Progress</th><th>End date</th></tr></thead><tbody>' +
        list.map(function (p) {
          var completed = p.status === 'completed';
          var pt = tasks.filter(function (t) { return t.projectKey === p.key; });
          var open = pt.filter(function (t) { return !isDone(t); }).length;
          var overdue = pt.filter(isOverdue).length;
          var top = pt.filter(function (t) { return !t.parentId && t.status !== 'cancelled'; });
          var prog = top.length ? Math.round(top.reduce(function (s, t) { return s + progressOf(t); }, 0) / top.length) : 0;
          return '<tr data-key="' + esc(p.key) + '"' + (completed ? ' class="project-completed"' : '') + '><td class="key">' + esc(p.key) + '</td><td>' + esc(p.name) + '</td>' +
            '<td>' + (completed ? '<span class="badge" style="background:#6b7280" title="Completed ' + esc(fmtDate(p.completedAt)) + '">Completed</span>' : '<span class="badge" style="background:#16a34a">Active</span>') + '</td>' +
            '<td>' + esc(userName(p.owner)) +
            '</td><td>' + open + '</td><td>' + pt.length + '</td><td' + (overdue ? ' class="overdue"' : '') + '>' + overdue + '</td><td class="nowrap">' + progressBar(prog) +
            '</td><td class="nowrap">' + esc(fmtDate(p.endDate)) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="small muted">Click a project to see or edit it. Progress is the average of its top-level tasks. ' +
        'Completed projects are hidden from My work, Tasks, Board, Allocation and Overview; choose one in the project menu to look at its tasks.</p>'
        : '<div class="panel empty">No projects yet.' + (can.createProject() ? '' : ' Ask an admin to create one.') + '</div>');
    $all('tbody tr').forEach(function (tr) {
      tr.onclick = function () { location.hash = '#/project/' + encodeURIComponent(tr.getAttribute('data-key')); };
    });
  }

  var PROJECT_FIELDS = { name: 'Name', owner: 'Owner', startDate: 'Start date', endDate: 'End date', description: 'Description' };

  // Completing a project hides it and its tasks; reopening brings them back.
  function projectStatusHtml(p, editable) {
    var completed = p.status === 'completed';
    var open = allTasks().filter(function (t) { return t.projectKey === p.key && !isDone(t); }).length;
    return '<div class="panel project-status" style="max-width:720px;margin-top:16px">' +
      '<h2 style="margin-top:0">Project status: ' + (completed ? 'Completed' : 'Active') + '</h2>' +
      (completed
        ? '<p>Completed ' + esc(fmtDate(p.completedAt)) + ' by ' + esc(userName(p.completedBy)) + '. Its tasks are hidden from the overview pages and are read-only.</p>' +
          (editable ? '<button class="btn" id="btn-proj-reopen">Reopen project</button>' : '')
        : '<p class="muted" style="margin-top:0">When the project is finished, mark it as completed. Its tasks are then hidden from My work, Tasks, Board, Allocation and Overview, and become read-only. You can reopen it at any time.</p>' +
          (editable ? '<button class="btn" id="btn-proj-complete">Mark project as completed…</button>' +
            '<div id="proj-complete-confirm" class="notice" hidden style="margin-top:10px">' +
            (open ? '<b>' + open + ' task(s) are still open.</b> They will be hidden with the project. ' : 'All tasks are finished. ') +
            '<button class="btn btn-primary" id="btn-proj-complete-go">Complete project</button> <button class="btn" id="btn-proj-complete-cancel">Cancel</button></div>' : '')) +
      '</div>';
  }

  function bindProjectStatus(p) {
    var setStatus = async function (completed) {
      var mine = clone(p);
      var now = new Date().toISOString();
      mine.status = completed ? 'completed' : 'active';
      mine.completedAt = completed ? now : '';
      mine.completedBy = completed ? state.me : '';
      mine.history = (mine.history || []).concat([{ id: uid(), at: now, by: state.me, text: completed ? 'Project marked as completed' : 'Project reopened' }]);
      try {
        await state.store.saveProject(mine, p, { force: true });
        toast(completed ? p.name + ' is completed and hidden.' : p.name + ' is active again.');
        if (completed && state.project === p.key) { state.project = ''; lsSet('to.project', null); }
        renderChrome();
        renderProjectForm(p.key);
      } catch (e) { toast('Could not save: ' + e.message, true); }
    };
    var c = $('#btn-proj-complete');
    if (c) c.onclick = function () { $('#proj-complete-confirm').hidden = false; c.hidden = true; };
    var go = $('#btn-proj-complete-go');
    if (go) go.onclick = function () { setStatus(true); };
    var cancel = $('#btn-proj-complete-cancel');
    if (cancel) cancel.onclick = function () { $('#proj-complete-confirm').hidden = true; c.hidden = false; };
    var r = $('#btn-proj-reopen');
    if (r) r.onclick = function () { setStatus(false); };
  }

  function renderProjectForm(key) {
    var isNew = key === 'new';
    if (isNew && !can.createProject()) { main.innerHTML = '<div class="panel empty">Only an admin can create projects.</div>'; return; }
    var p = isNew ? { key: '', name: '', description: '', owner: state.me, startDate: '', endDate: '' } : state.store.projects[key];
    if (!p) { main.innerHTML = '<div class="panel empty">Project not found. <a href="#/projects">Back</a></div>'; return; }
    var editable = isNew || can.editProject(p);
    var hist = live(p.history).slice().reverse();
    main.innerHTML = '<div class="breadcrumb"><a href="#/projects">Projects</a> / ' + (isNew ? 'New project' : esc(p.key)) + '</div>' +
      '<div class="panel" style="max-width:720px"><h1>' + (isNew ? 'New project' : esc(p.name)) + '</h1>' +
      (editable ? '' : '<div class="notice">Only an admin or the project owner can change this project.</div>') +
      '<div class="form-grid">' +
      field('key', 'Project key * (2–10 letters/digits, used in task numbers like ABC-12)',
        '<input type="text" id="fld-key" value="' + esc(p.key) + '" maxlength="10"' + (isNew ? '' : ' disabled') + ' style="text-transform:uppercase">') +
      field('name', 'Project name *', '<input type="text" id="fld-name" value="' + esc(p.name) + '">') +
      field('owner', 'Project owner', '<select id="fld-owner">' + options(peopleOptions(p.owner), p.owner, '—') + '</select>') +
      '<div></div>' +
      field('startDate', 'Start date', '<input type="date" id="fld-startDate" value="' + esc(p.startDate || '') + '">') +
      field('endDate', 'End date', '<input type="date" id="fld-endDate" value="' + esc(p.endDate || '') + '">') +
      '</div>' +
      field('description', 'Description', '<textarea id="fld-description" rows="4">' + esc(p.description) + '</textarea>') +
      (editable ? '<div class="toolbar"><button class="btn btn-primary" id="btn-psave">' + (isNew ? 'Create project' : 'Save') + '</button>' +
        '<a class="btn" href="#/projects">Cancel</a></div>' : '') + '</div>' +
      (isNew ? '' : projectStatusHtml(p, editable)) +
      (isNew ? '' : '<h2>History</h2><div class="panel" style="max-width:720px">' + (hist.length ? hist.map(function (h) {
        return '<div class="log-entry system"><div class="meta">' + esc(fmtDateTime(h.at)) + ' · ' + esc(userName(h.by)) + '</div><div class="text">' + esc(h.text) + '</div></div>';
      }).join('') : '<p class="muted" style="margin:0">No changes recorded yet.</p>') + '</div>');
    if (!editable) { $all('input, select, textarea', main).forEach(function (el) { el.disabled = true; }); return; }
    if (isNew) $('#fld-key').focus();
    else bindProjectStatus(p);

    $('#btn-psave').onclick = async function () {
      var mine = clone(p);
      mine.key = $('#fld-key').value.trim().toUpperCase();
      mine.name = $('#fld-name').value.trim();
      mine.owner = $('#fld-owner').value;
      mine.startDate = $('#fld-startDate').value;
      mine.endDate = $('#fld-endDate').value;
      mine.description = $('#fld-description').value.trim();
      if (!/^[A-Z][A-Z0-9]{1,9}$/.test(mine.key)) return toast('The key must be 2–10 letters or digits and start with a letter.', true);
      if (!mine.name) return toast('The project needs a name.', true);
      var now = new Date().toISOString();
      mine.history = (mine.history || []).slice();
      if (isNew) {
        mine.createdAt = now; mine.createdBy = state.me;
        mine.history.push({ id: uid(), at: now, by: state.me, text: 'Project created' });
      } else {
        Object.keys(PROJECT_FIELDS).forEach(function (k) {
          if (same(p[k], mine[k])) return;
          var show = function (v) { return k === 'owner' ? userName(v) || '(none)' : k === 'description' ? '' : (v || '(empty)'); };
          mine.history.push({ id: uid(), at: now, by: state.me,
            text: k === 'description' ? 'Description changed' : PROJECT_FIELDS[k] + ': ' + show(p[k]) + ' → ' + show(mine[k]) });
        });
      }
      try {
        var saved = await state.store.saveProject(mine, isNew ? null : p, { force: true });
        toast((isNew ? 'Created ' : 'Saved ') + saved.key);
        if (isNew) { state.project = saved.key; lsSet('to.project', saved.key); }
        renderChrome();
        location.hash = isNew ? '#/tasks' : '#/projects';
      } catch (e) {
        toast(e.code === 'EXISTS' ? 'A project with key ' + mine.key + ' already exists.' : 'Could not save: ' + e.message, true);
      }
    };
  }

  // ---------- people and roles ----------

  function renderPeople() {
    var list = users();
    var tasks = allTasks();
    var admin = can.admin();
    main.innerHTML = '<div class="page-head"><h1>People</h1>' +
      (admin ? '<div class="toolbar" style="margin:0"><button class="btn" id="btn-people-export">Export to Excel</button>' +
        '<label class="btn" title="Add or update people from an Excel (.xlsx) or CSV file">Import from Excel…<input type="file" id="people-import" accept=".xlsx,.csv" hidden></label></div>' : '') +
      '</div>' +
      (hasAdmin() ? '' : '<div class="notice">No admin has been chosen yet, so <b>everyone can change everything</b>. Set at least one person to <b>Admin</b> below.</div>') +
      '<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Department</th><th>Email</th><th>Role</th><th>Open tasks</th><th>To review</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.map(function (u) {
        var open = tasks.filter(function (t) { return t.assignee === u.id && !isDone(t); }).length;
        var rev = tasks.filter(function (t) { return t.reviewRequired && t.reviewer === u.id && t.reviewStatus !== 'approved' && t.status !== 'cancelled'; }).length;
        var role = hasAdmin() ? (u.role || 'member') : (u.role || 'member');
        return '<tr style="cursor:default"><td>' + esc(u.name) + (u.id === state.me ? ' <span class="muted">(you)</span>' : '') + '</td>' +
          '<td>' + esc(u.department || '') + '</td><td>' + (u.email ? esc(u.email) : '<span class="small error">missing – needed for notifications</span>') + '</td>' +
          '<td>' + (admin ? '<select data-role="' + esc(u.id) + '" style="width:auto">' + options(C.roles, role) + '</select>' : esc(roleName(roleOf(u.id)))) + '</td>' +
          '<td>' + open + '</td><td>' + rev + '</td><td>' + (u.active === false ? 'Inactive' : 'Active') + '</td><td class="nowrap">' +
          (admin || u.id === state.me ? '<button class="btn" data-edit="' + esc(u.id) + '">Edit</button> ' : '') +
          (admin && u.id !== state.me ? '<button class="btn" data-me="' + esc(u.id) + '" title="Work as this person on this PC">This is me</button> ' : '') +
          (admin && u.id !== state.me ? '<button class="btn" data-toggle="' + esc(u.id) + '">' + (u.active === false ? 'Activate' : 'Deactivate') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div id="person-form"' + (admin ? '' : ' hidden') + '>' +
      '<h2 id="p-title">Add a person</h2><div class="panel" style="max-width:720px"><input type="hidden" id="p-id"><div class="form-grid">' +
      field('pname', 'Full name *', '<input type="text" id="p-name">') +
      field('pdept', 'Department', '<input type="text" id="p-dept" list="dept-list">') +
      field('pemail', 'Email (needed for notifications)', '<input type="email" id="p-email">') + '</div>' +
      '<datalist id="dept-list">' + uniqueDepartments().map(function (d) { return '<option value="' + esc(d) + '">'; }).join('') + '</datalist>' +
      '<div class="toolbar" style="margin:0"><button class="btn btn-primary" id="btn-psave">Add person</button>' +
      '<button class="btn" id="btn-pcancel" hidden>Cancel editing</button></div></div></div>' +
      '<p class="small muted"><b>Admin</b>: everything, incl. people, roles and projects. <b>Member</b>: create and edit tasks; only the chosen reviewer can set a review result. ' +
      '<b>Viewer</b>: read only. Roles prevent mistakes but are not a security barrier – anyone with access to the data folder could still change the files. ' +
      'Inactive people are hidden from the dropdown lists but kept on their old tasks.</p>';

    $all('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var u = userById(b.getAttribute('data-edit'));
        $('#person-form').hidden = false;
        $('#p-id').value = u.id;
        $('#p-name').value = u.name;
        $('#p-dept').value = u.department || '';
        $('#p-email').value = u.email || '';
        $('#p-title').textContent = 'Edit ' + u.name;
        $('#btn-psave').textContent = 'Save';
        $('#btn-pcancel').hidden = false;
        $('#p-name').focus();
      };
    });
    $('#btn-pcancel').onclick = renderPeople;
    $all('[data-role]').forEach(function (s) {
      s.onchange = async function () {
        var u = clone(userById(s.getAttribute('data-role')));
        var newRole = s.value;
        var otherAdmins = users().filter(function (x) { return x.id !== u.id && x.role === 'admin' && x.active !== false; });
        if (u.role === 'admin' && newRole !== 'admin' && !otherAdmins.length) {
          toast('There must be at least one admin. Make someone else admin first.', true);
          s.value = 'admin';
          return;
        }
        u.role = newRole;
        try { await state.store.upsertUser(u); toast(u.name + ' is now ' + roleName(newRole)); renderChrome(); renderPeople(); }
        catch (e) { toast('Could not save: ' + e.message, true); }
      };
    });
    $all('[data-me]').forEach(function (b) {
      b.onclick = function () {
        state.me = b.getAttribute('data-me');
        lsSet('to.me', state.me);
        state.store.user = state.me;
        loadSeen();
        renderChrome();
        renderPeople();
        toast('You are now working as ' + userName(state.me));
      };
    });
    $all('[data-toggle]').forEach(function (b) {
      b.onclick = async function () {
        var u = clone(userById(b.getAttribute('data-toggle')));
        u.active = u.active === false;
        try { await state.store.upsertUser(u); renderPeople(); } catch (e) { toast('Could not save: ' + e.message, true); }
      };
    });
    $('#btn-psave').onclick = async function () {
      var name = $('#p-name').value.trim();
      if (!name) return toast('Type a name.', true);
      var id = $('#p-id').value;
      var u = id ? clone(userById(id)) : { id: 'u_' + uid(), active: true, role: 'member' };
      u.name = name;
      u.department = $('#p-dept').value.trim();
      u.email = $('#p-email').value.trim();
      try {
        await state.store.upsertUser(u);
        toast((id ? 'Saved ' : 'Added ') + name);
        renderChrome();
        renderPeople();
      } catch (e) { toast('Could not save: ' + e.message, true); }
    };
    var ex = $('#btn-people-export');
    if (ex) ex.onclick = exportPeople;
    var im = $('#people-import');
    if (im) im.onchange = function () {
      var f = im.files && im.files[0];
      im.value = '';
      if (f) importPeople(f);
    };
  }

  function uniqueDepartments() {
    var seen = {};
    users().forEach(function (u) { if (u.department) seen[u.department] = 1; });
    return Object.keys(seen).sort();
  }

  // ---------- people: Excel export and import (admins only) ----------
  // The exported file is also the template for import: Name, Department,
  // Email, Role, Active. People are matched on email, or on name when the
  // row has no email. Nobody is removed; set Active to "No" instead.

  var PEOPLE_COLS = ['Name', 'Department', 'Email', 'Role', 'Active'];

  function exportPeople() {
    if (!can.admin()) return toast('Only admins can export people.', true);
    var list = users().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var rows = list.map(function (u) {
      var r = u.role || 'member';
      return [u.name, u.department || '', u.email || '', r.charAt(0).toUpperCase() + r.slice(1), u.active === false ? 'No' : 'Yes'];
    });
    download(TO.xlsx.makeXlsx({ sheetName: 'People', rows: rows,
      columns: [{ header: 'Name', width: 26 }, { header: 'Department', width: 20 }, { header: 'Email', width: 32 }, { header: 'Role', width: 12 }, { header: 'Active', width: 9 }] }),
      'People_' + today() + '.xlsx');
  }

  function parseRole(v) {
    v = v.toLowerCase();
    if (!v) return { ok: true, value: null };
    if (/^(admin|administrator|manager)$/.test(v)) return { ok: true, value: 'admin' };
    if (/^(member|medlem)$/.test(v)) return { ok: true, value: 'member' };
    if (/^(viewer|viewer \(read only\)|read only|leser)$/.test(v)) return { ok: true, value: 'viewer' };
    return { ok: false };
  }
  function parseActive(v) {
    v = v.toLowerCase();
    if (!v) return { ok: true, value: null };
    if (/^(yes|y|true|1|active|ja|aktiv)$/.test(v)) return { ok: true, value: true };
    if (/^(no|n|false|0|inactive|nei|inaktiv)$/.test(v)) return { ok: true, value: false };
    return { ok: false };
  }

  // Works out what an import would do, without saving anything.
  function planPeopleImport(rows) {
    var norm = function (s) { return String(s || '').trim().toLowerCase(); };
    var h = -1, col = {};
    for (var i = 0; i < Math.min(rows.length, 10) && h < 0; i++) {
      rows[i].forEach(function (c, j) {
        var n = norm(c);
        if (/^(full )?name$|^navn$/.test(n)) { col.name = j; h = i; }
        else if (/^(department|dept|avdeling)$/.test(n)) col.department = j;
        else if (/^(e-?mail|e-?post)$/.test(n)) col.email = j;
        else if (/^(role|rolle)$/.test(n)) col.role = j;
        else if (/^(active|aktiv|status)$/.test(n)) col.active = j;
      });
    }
    if (h < 0) throw new Error('Could not find a "Name" column. Use the file from "Export to Excel" as a template.');

    var existing = users();
    var byEmail = {}, byName = {};
    existing.forEach(function (u) { if (u.email) byEmail[norm(u.email)] = u; byName[norm(u.name)] = u; });
    var seen = {};
    var get = function (r, k) { return col[k] == null ? '' : String(r[col[k]] || '').trim(); };
    var items = rows.slice(h + 1).map(function (r, k) {
      var it = { row: h + k + 2, name: get(r, 'name'), department: get(r, 'department'), email: get(r, 'email'), errors: [], changes: [] };
      var role = parseRole(get(r, 'role')), active = parseActive(get(r, 'active'));
      if (!it.name) it.errors.push('Name is missing');
      if (it.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(it.email)) it.errors.push('Email "' + it.email + '" is not valid');
      if (!role.ok) it.errors.push('Role "' + get(r, 'role') + '" is unknown (use Admin, Member or Viewer)');
      if (!active.ok) it.errors.push('Active "' + get(r, 'active') + '" is unknown (use Yes or No)');
      var dupKey = it.email ? 'e:' + norm(it.email) : 'n:' + norm(it.name);
      if (it.name && seen[dupKey]) it.errors.push('Same person as row ' + seen[dupKey]);
      if (it.name) seen[dupKey] = it.row;
      if (it.errors.length) { it.kind = 'error'; return it; }

      var match = (it.email && byEmail[norm(it.email)]) || byName[norm(it.name)];
      if (match && it.email && match.email && norm(match.email) !== norm(it.email) && !byEmail[norm(it.email)]) match = null;
      if (!match) {
        it.kind = 'new';
        it.user = { id: 'u_' + uid(), name: it.name, department: it.department, email: it.email, role: role.value || 'member', active: active.value !== false };
        return it;
      }
      var u = clone(match);
      var setField = function (k, label, v, show) {
        if (v == null || String(u[k] == null ? '' : u[k]) === String(v)) return;
        it.changes.push(label + ': ' + (show ? show(u[k]) : (u[k] || '(empty)')) + ' → ' + (show ? show(v) : (v || '(empty)')));
        u[k] = v;
      };
      setField('name', 'Name', it.name);
      if (col.department != null) setField('department', 'Department', it.department);
      if (col.email != null && it.email) setField('email', 'Email', it.email);
      setField('role', 'Role', role.value, function (x) { return roleName(x || 'member'); });
      setField('active', 'Active', active.value == null ? null : active.value, function (x) { return x === false ? 'No' : 'Yes'; });
      it.user = u;
      it.kind = it.changes.length ? 'update' : 'same';
      return it;
    });

    // Never leave the app without an active admin (when there is one today).
    var final = {};
    existing.forEach(function (u) { final[u.id] = u; });
    items.forEach(function (it) { if (it.kind === 'new' || it.kind === 'update') final[it.user.id] = it.user; });
    var adminsLeft = Object.keys(final).some(function (id) { return final[id].role === 'admin' && final[id].active !== false; });
    return { items: items, blocked: hasAdmin() && !adminsLeft ? 'This import would leave nobody as an active Admin. Keep at least one Admin.' : '' };
  }

  async function importPeople(file) {
    if (!can.admin()) return toast('Only admins can import people.', true);
    var plan;
    try { plan = planPeopleImport(await TO.xlsxread.readTable(file)); }
    catch (e) { console.error(e); return toast('Could not read the file: ' + e.message, true); }
    var count = function (k) { return plan.items.filter(function (it) { return it.kind === k; }).length; };
    var nNew = count('new'), nUpd = count('update'), nSame = count('same'), nErr = count('error');
    var label = { 'new': 'New', update: 'Update', same: 'Unchanged', error: 'Error' };
    var shown = plan.items.filter(function (it) { return it.kind !== 'same'; });

    var dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    dlg.innerHTML = '<h2 style="margin-top:0">Import people from ' + esc(file.name) + '</h2>' +
      '<div class="import-counts"><span><b>' + nNew + '</b> new</span><span><b>' + nUpd + '</b> to update</span><span><b>' + nSame + '</b> unchanged</span>' +
      '<span' + (nErr ? ' class="error"' : '') + '><b>' + nErr + '</b> with errors</span></div>' +
      (plan.blocked ? '<p class="error">' + esc(plan.blocked) + '</p>' : '') +
      (nErr ? '<p class="small muted">Rows with errors are skipped. Fix them in the file and import again.</p>' : '') +
      (shown.length ? '<div class="table-scroll import-preview"><table class="list compact"><thead><tr><th>Row</th><th>Name</th><th>What happens</th></tr></thead><tbody>' +
        shown.map(function (it) {
          var what = it.kind === 'new' ? 'Added' + (it.user.department ? ', ' + it.user.department : '') + (it.user.email ? ', ' + it.user.email : '') + ', ' + roleName(it.user.role)
            : it.kind === 'update' ? it.changes.join('; ') : it.errors.join('; ');
          return '<tr class="imp-' + it.kind + '"><td>' + it.row + '</td><td>' + esc(it.name || '—') + '</td><td><span class="imp-tag">' + label[it.kind] + '</span> ' + esc(what) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">Everyone in the file is already up to date.</p>') +
      '<p class="small muted">People who are not in the file are left as they are. To remove someone, set Active to "No".</p>' +
      '<div class="toolbar" style="margin:12px 0 0"><button class="btn btn-primary" id="imp-go"' + (plan.blocked || !(nNew + nUpd) ? ' disabled' : '') + '>Import ' + (nNew + nUpd) + ' change(s)</button>' +
      '<button class="btn" id="imp-cancel">Cancel</button></div>';
    document.body.appendChild(dlg);
    dlg.showModal();
    var close = function () { dlg.close(); dlg.remove(); };
    $('#imp-cancel', dlg).onclick = close;
    dlg.addEventListener('cancel', function () { setTimeout(function () { dlg.remove(); }, 0); });
    $('#imp-go', dlg).onclick = async function () {
      var changed = plan.items.filter(function (it) { return it.kind === 'new' || it.kind === 'update'; }).map(function (it) { return it.user; });
      try {
        await state.store.upsertUsers(changed);
        close();
        toast('Imported: ' + nNew + ' added, ' + nUpd + ' updated.');
        renderChrome();
        renderPeople();
      } catch (e) { toast('Could not save: ' + e.message, true); }
    };
  }

  // ---------- data folder ----------

  function renderSettings() {
    var s = state.store;
    main.innerHTML = '<h1>Data folder</h1><div class="panel" style="max-width:720px">' +
      '<p>' + (state.demo
        ? '<b>Demo mode.</b> Data is stored only in this browser on this PC. Nobody else can see it.'
        : 'Connected to the data folder <b>' + esc(s.root.name) + '</b> on the shared drive.') + '</p>' +
      '<p>' + projects().length + ' project(s), ' + allTasks().length + ' task(s), ' + users().length + ' people.</p>' +
      '<p class="muted">The app checks for changes from other users every ' + C.refreshSeconds + ' seconds while this tab is open. ' +
      'Each task is a separate file, so the folder can be backed up like any other folder on the drive.</p>' +
      '<button class="btn" id="btn-switch">' + (state.demo ? 'Leave demo and choose a real data folder' : 'Switch to another data folder') + '</button></div>';
    $('#btn-switch').onclick = async function () {
      lsSet('to.mode', null);
      await kvSet('dataDir', undefined);
      clearInterval(state.timer);
      state.store = null;
      state.demo = false;
      document.getElementById('sidebar').hidden = true;
      document.getElementById('btn-refresh').hidden = true;
      setSync('');
      document.getElementById('current-user').textContent = '';
      if (!window.showDirectoryPicker) return renderUnsupported();
      renderConnect();
    };
  }

  // Shared with reports.js (dashboard, progress, WBS diagram, Word export).
  TO.ui = {
    state: state, C: C, main: main, can: can,
    esc: esc, $: $, $all: $all, toast: toast, options: options, download: download, bindRows: bindRows,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, today: today, addDays: addDays, daysBetween: daysBetween, truncate: truncate,
    statusOf: statusOf, severityOf: severityOf, reviewOf: reviewOf, linkTypeOf: linkTypeOf, isDone: isDone, isLocked: isLocked,
    badge: badge, reviewBadge: reviewBadge, progressOf: progressOf, progressBar: progressBar, isOverdue: isOverdue,
    slipDays: slipDays, dueHtml: dueHtml, wbsOf: wbsOf, compareWbs: compareWbs, byKey: byKey, byDue: byDue,
    users: users, userName: userName, userDept: userDept, userLabel: userLabel,
    projects: projects, allTasks: allTasks, scopedTasks: scopedTasks, childrenOf: childrenOf, live: live,
    taskLinks: taskLinks, linkHref: linkHref, fileNameOf: fileNameOf, SECTION_NAMES: SECTION_NAMES,
    renderChrome: renderChrome, route: route,
    activeUsers: activeUsers, userById: userById, extRefHtml: extRefHtml, taskUrl: taskUrl,
    prepareSave: prepareSave, markSeen: markSeen, logEntry: logEntry, refresh: refresh,
    activeProjects: activeProjects, isProjectCompleted: isProjectCompleted, projectTagHtml: projectTagHtml,
    newTaskDoc: newTaskDoc, uid: uid, clone: clone
  };

  // Wait until all scripts (incl. reports.js) are loaded.
  document.addEventListener('DOMContentLoaded', boot);
})();
