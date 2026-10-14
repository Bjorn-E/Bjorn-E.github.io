// Import of tasks from Excel (or CSV), e.g. an action-point list from
// minutes of meeting or a supplier's list. Admins and project owners only.
// One row per task; see COLS for the format. Shows a preview first, then
// creates the tasks one by one (parents before their sub-tasks).
window.TO = window.TO || {};

(function () {
  var U = TO.ui, C = TO.config;
  var esc = U.esc, $ = U.$;

  var COLS = [
    { key: 'project', header: 'Project', re: /^(project|prosjekt)( ?key| ?nr\.?)?$/,
      help: 'Project key (e.g. AB1234) or name. Can be left empty when one project is chosen in the project menu.' },
    { key: 'title', header: 'Title', re: /^(title|tittel|task|oppgave)$/, help: 'Short summary of the task. Required.' },
    { key: 'ref', header: 'Action point / external ID', re: /^(action point( \/ external id)?|external id|ap|ref|reference|aksjonspunkt|referanse)$/,
      help: 'The action point in the minutes, a supplier ID or similar.' },
    { key: 'parent', header: 'Parent', re: /^(parent|parent task|overordnet( oppgave)?)$/,
      help: 'Makes the row a sub-task: an existing task number (AB1234-3) or the action point of a row higher up in this file.' },
    { key: 'responsible', header: 'Responsible', re: /^(responsible|assignee|ansvarlig)$/,
      help: 'Name or email of a person on the People page. Empty = unassigned, to be handed out on the Allocation page.' },
    { key: 'severity', header: 'Severity', re: /^(severity|priority|alvorlighet|prioritet)$/, help: 'Critical, High, Medium or Low. Empty = Medium.' },
    { key: 'due', header: 'Delivery date', re: /^(delivery date|due|due date|frist|leveringsdato)$/, help: 'For example 2026-11-30 or 30.11.2026. Optional.' },
    { key: 'description', header: 'Description', re: /^(description|beskrivelse)$/, help: 'Optional.' },
    { key: 'deliverable', header: 'Deliverable', re: /^(deliverable|leveranse)$/, help: 'Optional.' },
    { key: 'source', header: 'Source', re: /^(source|kilde)$/, help: 'Internal or External. Empty = External when an action point is given, otherwise Internal.' }
  ];

  var SEVERITY_WORDS = { critical: 'critical', kritisk: 'critical', high: 'high', 'høy': 'high', hoy: 'high',
    medium: 'medium', middels: 'medium', normal: 'medium', low: 'low', lav: 'low' };

  function store() { return U.state.store; }
  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Excel date serial, 2026-11-30, 30.11.2026 or 30/11/2026 -> yyyy-mm-dd.
  function parseDate(v) {
    v = String(v || '').trim();
    if (!v) return { ok: true, value: '' };
    var m;
    if (/^\d{5}(\.\d+)?$/.test(v)) {
      var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(v)) * 86400000);
      return { ok: true, value: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) };
    }
    if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return check(+m[1], +m[2], +m[3]);
    if ((m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) return check(+m[3], +m[2], +m[1]);
    return { ok: false };
    function check(y, mo, da) {
      var dt = new Date(Date.UTC(y, mo - 1, da));
      if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return { ok: false };
      return { ok: true, value: y + '-' + pad(mo) + '-' + pad(da) };
    }
  }

  function findProject(raw) {
    var n = norm(raw);
    return U.projects().filter(function (p) { return norm(p.key) === n || norm(p.name) === n; })[0];
  }
  function findPerson(raw) {
    var n = norm(raw);
    return U.activeUsers().filter(function (u) { return norm(u.email) === n || norm(u.name) === n; })[0];
  }

  // Works out what the import would do, without saving anything.
  function plan(rows) {
    var h = -1, col = {};
    for (var i = 0; i < Math.min(rows.length, 10) && h < 0; i++) {
      var c = {};
      rows[i].forEach(function (cell, j) { COLS.forEach(function (k) { if (k.re.test(norm(cell))) c[k.key] = j; }); });
      if (c.title != null) { h = i; col = c; }
    }
    if (h < 0) throw new Error('Could not find a "Title" column. Use "Download template" to get the right format.');
    var get = function (r, k) { return col[k] == null ? '' : String(r[col[k]] == null ? '' : r[col[k]]).trim(); };
    var items = [];

    rows.slice(h + 1).forEach(function (r, k) {
      var it = { row: h + k + 2, errors: [], warnings: [] };
      items.push(it);
      it.title = get(r, 'title');
      it.ref = get(r, 'ref');
      it.description = get(r, 'description');
      it.deliverable = get(r, 'deliverable');
      if (!it.title) it.errors.push('Title is missing');

      var projRaw = get(r, 'project');
      var p = projRaw ? findProject(projRaw) : (U.state.project ? store().projects[U.state.project] : null);
      if (!p) it.errors.push(projRaw ? 'Project "' + projRaw + '" not found' : 'No project given (fill in the Project column or choose a project in the menu)');
      else if (p.status === 'completed') it.errors.push('Project ' + p.key + ' is completed');
      else if (!U.can.allocate(p.key)) it.errors.push('You can only import into projects you own (or as admin)');
      it.projectKey = p ? p.key : '';

      var sevRaw = get(r, 'severity');
      it.severity = sevRaw ? SEVERITY_WORDS[norm(sevRaw)] : 'medium';
      if (!it.severity) it.errors.push('Severity "' + sevRaw + '" is unknown (use Critical, High, Medium or Low)');

      var due = parseDate(get(r, 'due'));
      if (!due.ok) it.errors.push('Delivery date "' + get(r, 'due') + '" is not a date');
      it.dueDate = due.value || '';

      var srcRaw = norm(get(r, 'source'));
      it.source = !srcRaw ? (it.ref ? 'External' : 'Internal') : /^(external|ekstern)$/.test(srcRaw) ? 'External' : /^(internal|intern)$/.test(srcRaw) ? 'Internal' : '';
      if (!it.source) it.errors.push('Source "' + get(r, 'source') + '" is unknown (use Internal or External)');

      var who = get(r, 'responsible');
      if (who) {
        var u = findPerson(who);
        if (u) it.assignee = u.id;
        else it.warnings.push('Responsible "' + who + '" not found on the People page; left unassigned');
      }

      // Same action point twice: in the file (error) or already in the project (skipped).
      if (it.ref && it.projectKey) {
        var dupRow = items.filter(function (o) { return o !== it && o.projectKey === it.projectKey && o.ref && norm(o.ref) === norm(it.ref); })[0];
        if (dupRow) it.errors.push('Same action point as row ' + dupRow.row);
        var existing = U.allTasks().filter(function (t) { return t.projectKey === it.projectKey && norm(t.externalRef) === norm(it.ref); })[0];
        if (existing) it.existing = existing.id;
      }

      // Parent: existing task number, or the action point of a row above / an existing task.
      var parRaw = get(r, 'parent');
      if (parRaw && it.projectKey) {
        var byId = store().tasks[parRaw.toUpperCase()];
        if (byId && byId.projectKey === it.projectKey) it.parentId = byId.id;
        else {
          var above = items.filter(function (o) { return o !== it && o.projectKey === it.projectKey && o.ref && norm(o.ref) === norm(parRaw); })[0];
          if (above) {
            if (above.errors.length) it.errors.push('Its parent (row ' + above.row + ') has errors');
            else if (above.existing) it.parentId = above.existing;
            else it.parentRow = above;
          } else {
            var exParent = U.allTasks().filter(function (t) { return t.projectKey === it.projectKey && norm(t.externalRef) === norm(parRaw); })[0];
            if (exParent) it.parentId = exParent.id;
            else it.errors.push('Parent "' + parRaw + '" not found (use an existing task number or the action point of a row higher up)');
          }
        }
      }
      it.kind = it.errors.length ? 'error' : it.existing ? 'skip' : 'new';
    });
    return items;
  }

  // ---------- dialog ----------

  var dlg = null;

  function open() {
    if (!U.activeProjects().some(function (p) { return U.can.allocate(p.key); })) {
      return U.toast('Only admins and project owners can import tasks.', true);
    }
    dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    document.body.appendChild(dlg);
    dlg.addEventListener('cancel', function () { setTimeout(function () { if (dlg) { dlg.remove(); dlg = null; } }, 0); });
    showFormat();
    dlg.showModal();
  }

  function close() { if (dlg) { dlg.close(); dlg.remove(); dlg = null; } }

  function showFormat() {
    var p = U.state.project ? store().projects[U.state.project] : null;
    dlg.innerHTML = '<h2 style="margin-top:0">Import tasks from Excel</h2>' +
      '<p class="small muted" style="margin-top:0">One row per task, with column names in the first row. Only <b>Title</b> is required. ' +
      (p ? 'Rows without a project go into <b>' + esc(p.key + ' – ' + p.name) + '</b>.' : 'Choose a project in the menu first, or fill in the Project column.') + '</p>' +
      '<div class="table-scroll import-preview"><table class="list compact"><thead><tr><th>Column</th><th>What to put in it</th></tr></thead><tbody>' +
      COLS.map(function (c) { return '<tr><td class="nowrap"><b>' + esc(c.header) + '</b></td><td class="small">' + esc(c.help) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<p class="small muted">New tasks start as To Do with you as reporter. Rows whose action point already exists in the project are skipped, so the same list can be imported again after it is updated.</p>' +
      '<div class="toolbar" style="margin:12px 0 0"><button class="btn" id="ti-template">Download template</button>' +
      '<label class="btn btn-primary">Choose Excel file…<input type="file" id="ti-file" accept=".xlsx,.csv" hidden></label>' +
      '<button class="btn" id="ti-cancel">Cancel</button></div>';
    $('#ti-cancel', dlg).onclick = close;
    $('#ti-template', dlg).onclick = downloadTemplate;
    $('#ti-file', dlg).onchange = async function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      try { showPreview(f.name, plan(await TO.xlsxread.readTable(f))); }
      catch (err) { console.error(err); U.toast('Could not read the file: ' + err.message, true); }
    };
  }

  function downloadTemplate() {
    U.download(TO.xlsx.makeXlsx({ sheetName: 'Tasks', rows: [],
      columns: COLS.map(function (c) { return { header: c.header, width: c.key === 'title' || c.key === 'description' ? 40 : c.key === 'ref' ? 26 : 16 }; }) }),
      'Task_import_template.xlsx');
  }

  function showPreview(fileName, items) {
    var n = function (k) { return items.filter(function (it) { return it.kind === k; }).length; };
    var nNew = n('new'), nSkip = n('skip'), nErr = n('error');
    var label = { 'new': 'New', skip: 'Skipped', error: 'Error' };
    var refOf = function (it) { return it.parentRow ? 'row ' + it.parentRow.row : (it.parentId || ''); };
    dlg.innerHTML = '<h2 style="margin-top:0">Import tasks from ' + esc(fileName) + '</h2>' +
      '<div class="import-counts"><span><b>' + nNew + '</b> new</span><span><b>' + nSkip + '</b> already exist</span>' +
      '<span' + (nErr ? ' class="error"' : '') + '><b>' + nErr + '</b> with errors</span></div>' +
      (nErr ? '<p class="small muted">Rows with errors are not imported. Fix them in the file and import again; rows that were imported will then be skipped.</p>' : '') +
      '<div class="table-scroll import-preview"><table class="list compact"><thead><tr><th>Row</th><th>Task</th><th>Project</th><th>Parent</th><th>Responsible</th><th>Severity</th><th>Delivery</th></tr></thead><tbody>' +
      items.map(function (it) {
        var notes = it.kind === 'error' ? it.errors : it.kind === 'skip' ? ['Already exists as ' + it.existing] : it.warnings;
        return '<tr class="imp-' + (it.kind === 'skip' ? 'same' : it.kind) + '"><td>' + it.row + '</td>' +
          '<td><span class="imp-tag">' + label[it.kind] + '</span> ' + esc(it.title || '—') + (it.ref ? '<div class="ext-ref">' + esc(it.ref) + '</div>' : '') +
          (notes.length ? '<div class="small' + (it.kind === 'error' ? '' : ' muted') + '">' + esc(notes.join('; ')) + '</div>' : '') + '</td>' +
          '<td class="nowrap">' + esc(it.projectKey) + '</td><td class="nowrap">' + esc(refOf(it)) + '</td>' +
          '<td class="nowrap">' + esc(it.assignee ? U.userName(it.assignee) : '—') + '</td>' +
          '<td>' + esc(it.severity ? U.severityOf(it.severity).name : '') + '</td><td class="nowrap">' + esc(it.dueDate) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="toolbar" style="margin:12px 0 0"><button class="btn btn-primary" id="ti-go"' + (nNew ? '' : ' disabled') + '>Import ' + nNew + ' task(s)</button>' +
      '<button class="btn" id="ti-back">Back</button><button class="btn" id="ti-cancel">Cancel</button>' +
      '<span class="small muted" id="ti-progress"></span></div>';
    $('#ti-cancel', dlg).onclick = close;
    $('#ti-back', dlg).onclick = showFormat;
    $('#ti-go', dlg).onclick = function () { run(fileName, items); };
  }

  async function run(fileName, items) {
    var go = $('#ti-go', dlg);
    go.disabled = true;
    $('#ti-back', dlg).disabled = true;
    var todo = items.filter(function (it) { return it.kind === 'new'; });
    var done = 0, failed = [];
    for (var i = 0; i < todo.length; i++) {
      var it = todo[i];
      $('#ti-progress', dlg).textContent = 'Importing ' + (i + 1) + ' of ' + todo.length + '…';
      var parentId = it.parentRow ? it.parentRow.createdId : it.parentId;
      if (it.parentRow && !parentId) { failed.push(it.row + ' (parent not created)'); continue; }
      var base = U.newTaskDoc({ project: it.projectKey });
      var mine = U.clone(base);
      mine.title = it.title;
      mine.externalRef = it.ref;
      mine.parentId = parentId || '';
      mine.assignee = it.assignee || '';
      mine.severity = it.severity;
      mine.dueDate = it.dueDate;
      mine.description = it.description;
      mine.deliverable = it.deliverable;
      mine.source = it.source;
      U.prepareSave(base, mine, Object.keys(mine), true);
      mine.log.push(U.logEntry('Imported from Excel (' + fileName + ', row ' + it.row + ')'));
      try {
        var saved = await store().createTask(mine);
        U.markSeen(saved);
        it.createdId = saved.id;
        done++;
      } catch (err) {
        console.error(err);
        failed.push(it.row);
      }
    }
    close();
    U.renderChrome();
    U.route(true);
    U.toast(done + ' task(s) imported.' + (failed.length ? ' Could not import row(s) ' + failed.join(', ') + '.' : ''), !!failed.length);
  }

  TO.taskImport = { open: open, plan: plan, COLS: COLS, parseDate: parseDate };
})();
