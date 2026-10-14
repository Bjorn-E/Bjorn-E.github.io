// Allocation: the place where project or manager meetings hand out
// unassigned tasks. Shows the open tasks nobody is responsible for, lets
// admins and project owners assign them (one by one, in bulk or by dragging
// onto a person), keeps the assignments pending until "Save and notify",
// then offers one email per person listing what they received.
window.TO = window.TO || {};

(function () {
  var U = TO.ui, C = TO.config;
  var esc = U.esc, $ = U.$, $all = U.$all;

  var pending = {};    // task id -> user id (not saved yet)
  var selected = {};   // task id -> true (ticked rows)
  var since = '';      // optional "created since" filter
  var lastSaved = null; // { byPerson: { userId: [task ids] } } for the email step

  function store() { return U.state.store; }
  function sevIndex(t) { for (var i = 0; i < C.severities.length; i++) if (C.severities[i].id === t.severity) return i; return 99; }
  function waitingDays(t) { return Math.max(0, U.daysBetween(U.fmtDate(t.createdAt) || U.today(), U.today())); }

  // Open tasks with nobody responsible, in the chosen project.
  function queue() {
    return U.scopedTasks().filter(function (t) { return !U.isDone(t) && !t.assignee; })
      .sort(function (a, b) {
        return sevIndex(a) - sevIndex(b) || (a.createdAt || '').localeCompare(b.createdAt || '') || U.byKey(a, b);
      });
  }

  function pendingCount() { return Object.keys(pending).length; }

  function updateBadge() {
    var a = document.querySelector('.sidebar a[data-nav="allocation"]');
    if (!a || !store()) return;
    var n = queue().length;
    var b = a.querySelector('.nav-badge');
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; a.appendChild(b); }
    b.textContent = n;
    b.hidden = !n;
    b.title = n + ' unassigned task(s)';
  }

  function openCount(userId) {
    return U.allTasks().filter(function (t) { return !U.isDone(t) && t.assignee === userId; }).length;
  }

  function render() {
    var p = U.state.project ? store().projects[U.state.project] : null;
    var all = queue();
    var list = all.filter(function (t) { return !since || U.fmtDate(t.createdAt) >= since; });
    var canAny = list.some(function (t) { return U.can.allocate(t.projectKey); }) || (p ? U.can.allocate(p.key) : U.can.admin());
    // Drop selections and pending changes for tasks that are no longer in the queue.
    Object.keys(selected).forEach(function (id) { if (!all.some(function (t) { return t.id === id; })) delete selected[id]; });
    var people = U.activeUsers().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var personOpts = people.map(function (u) { return { id: u.id, name: U.userLabel(u.id) }; });

    var rows = list.map(function (t) {
      var editable = U.can.allocate(t.projectKey);
      var pend = pending[t.id] || '';
      var w = waitingDays(t);
      var parent = t.parentId ? store().tasks[t.parentId] : null;
      return '<tr data-id="' + esc(t.id) + '" class="' + (pend ? 'pending' : '') + '"' + (editable ? ' draggable="true"' : '') + '>' +
        '<td class="nowrap">' + (editable ? '<input type="checkbox" class="al-pick" aria-label="Select ' + esc(t.id) + '"' + (selected[t.id] ? ' checked' : '') + '>' : '') + '</td>' +
        '<td><a href="#/task/' + encodeURIComponent(t.id) + '" class="key">' + esc(t.id) + '</a> <span class="wbs">' + esc(U.wbsOf(t)) + '</span>' +
        '<div class="al-title">' + esc(t.title) + U.projectTagHtml(t) + '</div>' + U.extRefHtml(t) +
        (parent ? '<div class="small muted">Under ' + esc(parent.id) + ' ' + esc(U.truncate(parent.title, 40)) + '</div>' : '') + '</td>' +
        '<td>' + U.badge(U.severityOf(t.severity)) + '</td>' +
        '<td class="nowrap">' + (t.dueDate ? U.dueHtml(t) : '<span class="muted small">No date</span>') + '</td>' +
        '<td class="nowrap' + (w >= 7 ? ' overdue' : '') + '">' + w + (w === 1 ? ' day' : ' days') + '</td>' +
        '<td>' + (editable
          ? '<select class="al-person" aria-label="Responsible for ' + esc(t.id) + '">' + U.options(personOpts, pend, '— choose —') + '</select>'
          : '<span class="muted small">Project owner or admin assigns</span>') + '</td></tr>';
    }).join('');

    var peopleHtml = people.map(function (u) {
      var add = Object.keys(pending).filter(function (id) { return pending[id] === u.id; }).length;
      return '<li class="al-person-row" data-user="' + esc(u.id) + '"><span><b>' + esc(u.name) + '</b>' +
        (u.department ? ' <span class="muted small">' + esc(u.department) + '</span>' : '') + '</span>' +
        '<span class="small"><span title="Open tasks now">' + openCount(u.id) + ' open</span>' +
        (add ? ' <span class="al-add" title="Pending, not saved yet">+' + add + '</span>' : '') + '</span></li>';
    }).join('');

    var pc = pendingCount();
    var summary = {};
    Object.keys(pending).forEach(function (id) { (summary[pending[id]] = summary[pending[id]] || []).push(id); });
    var pendingText = Object.keys(summary).map(function (uid) { return U.userName(uid) + ': ' + summary[uid].join(', '); }).join(' · ');
    var nSel = Object.keys(selected).length;

    U.main.innerHTML = '<div class="page-head"><h1>Allocation <span class="muted">· ' + (p ? esc(p.name) : 'all projects') + '</span></h1>' +
      '<div class="toolbar" style="margin:0"><label class="small muted" for="al-since">Created since</label>' +
      '<input type="date" id="al-since" value="' + esc(since) + '" style="width:auto;min-width:0">' +
      (since ? '<button class="btn btn-small" id="al-since-clear">Show all</button>' : '') + '</div></div>' +
      '<p class="muted small" style="margin-top:-8px">Open tasks without a responsible person, most severe and longest waiting first. ' +
      (canAny ? 'Choose a person per task, tick several and use <b>Assign to…</b>, or drag a task onto a person. Nothing is saved until you press <b>Save and notify</b>.'
        : 'Only admins and the project owner can assign tasks here.') + '</p>' +
      (lastSaved ? emailHtml() : '') +
      '<div class="al-grid">' +
      '<div class="panel al-queue">' +
      '<div class="section-head"><h2>Unassigned <span class="muted">' + list.length + (since ? ' of ' + all.length : '') + '</span></h2></div>' +
      (list.length
        ? (canAny ? '<div class="toolbar al-bulk"><label class="check small"><input type="checkbox" id="al-all"' + (nSel && nSel === list.filter(function (t) { return U.can.allocate(t.projectKey); }).length ? ' checked' : '') + '> Select all</label>' +
            '<span class="small muted">' + nSel + ' selected</span>' +
            '<select id="al-bulk-person" style="width:auto"' + (nSel ? '' : ' disabled') + '>' + U.options(personOpts, '', 'Assign to…') + '</select></div>' : '') +
          '<div class="table-scroll"><table class="list compact al-table"><thead><tr><th></th><th class="al-task-col">Task</th><th>Severity</th><th>Delivery</th><th>Waiting</th><th>Responsible</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">' + (all.length ? 'No unassigned tasks were created since ' + esc(since) + '.' : 'Every open task has someone responsible. Nothing to allocate.') + '</div>') +
      '</div>' +
      '<div class="panel al-people"><div class="section-head"><h2>People</h2></div>' +
      '<p class="small muted" style="margin-top:0">Open tasks per person, for information.' + (canAny ? ' Drop a task here to assign it.' : '') + '</p>' +
      '<ul class="al-people-list">' + peopleHtml + '</ul></div>' +
      '</div>' +
      (pc ? '<div class="al-pending"><span><b>' + pc + ' pending assignment' + (pc > 1 ? 's' : '') + '</b> · ' + esc(pendingText) + '</span>' +
        '<span class="al-pending-actions"><button class="btn" id="al-undo">Undo all</button><button class="btn btn-primary" id="al-save">Save and notify</button></span></div>' : '');

    bind();
  }

  function bind() {
    $('#al-since').onchange = function (e) { since = e.target.value; render(); };
    var clr = $('#al-since-clear');
    if (clr) clr.onclick = function () { since = ''; render(); };
    $all('.al-person').forEach(function (s) {
      s.onchange = function () {
        var id = s.closest('tr').getAttribute('data-id');
        if (s.value) pending[id] = s.value; else delete pending[id];
        render();
      };
    });
    $all('.al-pick').forEach(function (c) {
      c.onchange = function () {
        var id = c.closest('tr').getAttribute('data-id');
        if (c.checked) selected[id] = true; else delete selected[id];
        render();
      };
    });
    var all = $('#al-all');
    if (all) all.onchange = function () {
      selected = {};
      if (all.checked) $all('tr[data-id] .al-pick').forEach(function (c) { selected[c.closest('tr').getAttribute('data-id')] = true; });
      render();
    };
    var bulk = $('#al-bulk-person');
    if (bulk) bulk.onchange = function () {
      if (!bulk.value) return;
      Object.keys(selected).forEach(function (id) { pending[id] = bulk.value; });
      selected = {};
      render();
    };
    // Drag a task row onto a person.
    $all('.al-table tr[draggable="true"]').forEach(function (tr) {
      tr.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', tr.getAttribute('data-id'));
        e.dataTransfer.effectAllowed = 'move';
        tr.classList.add('dragging');
      });
      tr.addEventListener('dragend', function () { tr.classList.remove('dragging'); });
    });
    $all('.al-person-row').forEach(function (li) {
      li.addEventListener('dragover', function (e) { e.preventDefault(); li.classList.add('drop'); });
      li.addEventListener('dragleave', function () { li.classList.remove('drop'); });
      li.addEventListener('drop', function (e) {
        e.preventDefault();
        li.classList.remove('drop');
        var id = e.dataTransfer.getData('text/plain');
        var t = store().tasks[id];
        if (!t || !U.can.allocate(t.projectKey)) return;
        pending[id] = li.getAttribute('data-user');
        render();
      });
    });
    var undo = $('#al-undo');
    if (undo) undo.onclick = function () { pending = {}; render(); };
    var save = $('#al-save');
    if (save) save.onclick = saveAll;
    $all('[data-mail]').forEach(function (b) { b.onclick = function () { openEmail(b.getAttribute('data-mail')); }; });
    var done = $('#al-mail-done');
    if (done) done.onclick = function () { lastSaved = null; render(); };
  }

  // Save every pending assignment on top of the latest version of the task.
  // A task someone else assigned in the meantime is skipped and reported.
  async function saveAll() {
    var btn = $('#al-save');
    btn.disabled = true;
    var byPerson = {}, skipped = [], failed = [];
    var ids = Object.keys(pending);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], who = pending[id];
      var latest = store().tasks[id];
      if (!latest || latest.assignee || U.isDone(latest) || !U.can.allocate(latest.projectKey)) { skipped.push(id); delete pending[id]; continue; }
      var mine = JSON.parse(JSON.stringify(latest));
      mine.assignee = who;
      U.prepareSave(latest, mine, ['assignee'], false);
      mine.log.push(U.logEntry('Assigned to ' + U.userName(who) + ' on the Allocation page'));
      try {
        var saved = await store().saveTask(mine, latest);
        U.markSeen(saved);
        (byPerson[who] = byPerson[who] || []).push(saved.id);
        delete pending[id];
      } catch (err) {
        console.error(err);
        if (err instanceof TO.Store.ConflictError) { skipped.push(id); delete pending[id]; }
        else failed.push(id);
      }
    }
    var n = Object.keys(byPerson).reduce(function (s, k) { return s + byPerson[k].length; }, 0);
    lastSaved = n ? { byPerson: byPerson } : null;
    U.renderChrome();
    render();
    var msg = n + ' task(s) assigned.';
    if (skipped.length) msg += ' Skipped ' + skipped.join(', ') + ': someone else assigned or closed them in the meantime.';
    if (failed.length) msg += ' Could not save ' + failed.join(', ') + '. They are still pending; try again.';
    U.toast(msg, !!(skipped.length || failed.length));
  }

  function emailHtml() {
    var b = lastSaved.byPerson;
    return '<div class="notice notice-ok al-mail">Saved. Let people know what they received: ' +
      Object.keys(b).map(function (uid) {
        var u = U.userById(uid);
        var label = esc(U.userName(uid)) + ' (' + b[uid].length + ')';
        return u && u.email ? '<button class="btn" data-mail="' + esc(uid) + '">✉ ' + label + '</button>'
          : '<span class="small muted">' + label + ': no email registered</span>';
      }).join(' ') + ' <button class="btn btn-ghost" id="al-mail-done">Done</button></div>';
  }

  // One ready-made email per person, listing all tasks they received.
  function openEmail(uid) {
    var ids = lastSaved.byPerson[uid] || [];
    var u = U.userById(uid);
    var tasks = ids.map(function (id) { return store().tasks[id]; }).filter(Boolean);
    var keys = tasks.map(function (t) { return t.projectKey; }).filter(function (k, i, a) { return a.indexOf(k) === i; });
    var lines = ['Hi ' + (u.name.split(' ')[0] || u.name) + ',', '',
      'You have been given ' + tasks.length + ' new task' + (tasks.length > 1 ? 's' : '') + ':', ''];
    tasks.forEach(function (t) {
      lines.push('- ' + t.id + ' – ' + t.title);
      var d = [];
      if (t.externalRef) d.push('Ref: ' + t.externalRef);
      d.push('Severity: ' + U.severityOf(t.severity).name);
      d.push('Delivery: ' + (t.dueDate ? U.fmtDate(t.dueDate) : 'not set'));
      lines.push('  ' + d.join('    '));
      lines.push('  ' + U.taskUrl(t.id));
    });
    lines.push('', 'Regards,', U.userName(U.state.me));
    var subject = '[' + keys.join(', ') + '] ' + tasks.length + ' new task' + (tasks.length > 1 ? 's' : '') + ' assigned to you';
    var a = document.createElement('a');
    a.href = 'mailto:' + encodeURIComponent(u.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\r\n'));
    a.click();
    var btn = document.querySelector('[data-mail="' + uid + '"]');
    if (btn) { btn.disabled = true; btn.textContent = '✓ ' + btn.textContent.replace('✉ ', ''); }
  }

  TO.views = TO.views || {};
  TO.views.allocation = render;
  // Called when the user leaves the page (after confirming): pending changes are dropped.
  function discard() { pending = {}; selected = {}; lastSaved = null; }

  TO.alloc = { pendingCount: pendingCount, updateBadge: updateBadge, queue: queue, discard: discard };
})();
