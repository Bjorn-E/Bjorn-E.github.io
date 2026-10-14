// Dashboard, progress tracking, WBS block diagram and Word export.
// Uses the helpers app.js shares in TO.ui and the chart toolkit in charts.js.
window.TO = window.TO || {};

(function () {
  var U = TO.ui, C = TO.config, CH = TO.charts, COL = TO.charts.COLORS;
  var esc = U.esc, $ = U.$, $all = U.$all;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function state() { return U.state; }
  function store() { return U.state.store; }
  function dmy(d) { var p = d.split('-'); return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1]; }
  function monday(d) {
    var dt = new Date(d + 'T00:00:00');
    var wd = (dt.getDay() + 6) % 7;
    return U.addDays(d, -wd);
  }
  function plannedDate(t) { return U.fmtDate(t.originalDueDate || t.dueDate); }
  function hasKids(t) { return U.childrenOf(t.id).some(function (c) { return c.status !== 'cancelled'; }); }
  // Work packages: the lowest-level tasks (no sub-tasks), not cancelled.
  function leaves(list) { return list.filter(function (t) { return t.status !== 'cancelled' && !hasKids(t); }); }
  function projectProgress(list) {
    var top = list.filter(function (t) { return !t.parentId && t.status !== 'cancelled'; });
    return top.length ? Math.round(top.reduce(function (s, t) { return s + U.progressOf(t); }, 0) / top.length) : 0;
  }
  function pickProject(key) {
    U.state.project = key;
    lsSet('to.project', key);
    U.renderChrome();
    U.route(true);
  }
  function projectPicker(title, intro) {
    var list = U.projects();
    U.main.innerHTML = '<div class="page-head"><h1>' + esc(title) + '</h1></div><p class="muted">' + esc(intro) + '</p>' +
      (list.length ? '<div class="tiles">' + list.map(function (p) {
        return '<a class="tile" href="#" data-key="' + esc(p.key) + '"><b style="font-size:18px">' + esc(p.key) + '</b><span>' + esc(p.name) + '</span></a>';
      }).join('') + '</div>' : '<div class="panel empty">No projects yet.</div>');
    $all('[data-key]', U.main).forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); pickProject(a.getAttribute('data-key')); };
    });
  }

  // Status with icon + label (colour never carries meaning alone).
  function scheduleStatus(actual, expected) {
    if (expected == null) return { id: 'none', icon: '–', label: 'No plan to compare with', color: COL.muted };
    var d = actual - expected;
    if (d >= -5) return { id: 'good', icon: '✓', label: d > 5 ? 'Ahead of plan' : 'On track', color: COL.good };
    if (d >= -15) return { id: 'warning', icon: '!', label: 'Slightly behind', color: COL.warning };
    return { id: 'critical', icon: '⚠', label: 'Behind plan', color: COL.critical };
  }
  function statusChip(s) {
    return '<span class="status-chip"><span class="status-icon" style="background:' + s.color + '">' + s.icon + '</span>' + esc(s.label) + '</span>';
  }

  // Expected progress today: share of work packages planned (original
  // delivery date) to be done by today; otherwise linear between the
  // project's start and end dates.
  function expectedProgress(p, list) {
    var lv = leaves(list);
    var dated = lv.filter(plannedDate);
    var t = U.today();
    if (dated.length) {
      return { pct: Math.round(dated.filter(function (x) { return plannedDate(x) <= t; }).length / dated.length * 100),
        basis: 'Share of ' + dated.length + ' work package(s) planned to be finished by today (original delivery dates).' };
    }
    if (p && p.startDate && p.endDate && p.endDate > p.startDate) {
      var f = U.daysBetween(p.startDate, t) / U.daysBetween(p.startDate, p.endDate);
      return { pct: Math.round(Math.max(0, Math.min(1, f)) * 100), basis: 'Straight line from the project start date to the end date.' };
    }
    return { pct: null, basis: 'Add delivery dates to tasks, or start and end dates to the project, to compare with a plan.' };
  }

  // ---------- Overview: "How is the project doing?" ----------
  // One page in sections: Status now (what is open, where, how severe),
  // Schedule (expected vs actual, burn-up, deliveries ahead, moved dates)
  // and WBS progress. With "All projects" it shows the portfolio instead
  // of the schedule. Each figure appears in one place only.

  var one = function () { return [{ name: 'Tasks', color: COL.series[0] }]; };

  function statTile(n, label, flag, sub) {
    return '<div class="tile stat"><b>' + n + '</b><span>' + (flag ? '<span class="status-icon small-icon" style="background:' + flag.color + '">' + flag.icon + '</span>' : '') + esc(label) + '</span>' +
      (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '</div>';
  }

  function sectionHead(id, title, sub) {
    return '<div class="ov-head" id="' + id + '"><h2>' + esc(title) + '</h2>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '</div>';
  }

  function statusNowHtml(scope) {
    var open = scope.filter(function (t) { return !U.isDone(t); });
    var overdue = open.filter(U.isOverdue);
    var inReview = scope.filter(function (t) { return t.status === 'review'; });
    var since = U.addDays(U.today(), -30);
    var done30 = scope.filter(function (t) { return t.status === 'done' && t.completedAt && U.fmtDate(t.completedAt) >= since; });

    var byStatus = C.statuses.map(function (s) {
      return { label: s.name, values: [scope.filter(function (t) { return t.status === s.id; }).length] };
    });
    var people = {};
    open.forEach(function (t) {
      var k = t.assignee || '';
      people[k] = people[k] || [0, 0];
      people[k][U.isOverdue(t) ? 1 : 0]++;
    });
    var byPerson = Object.keys(people).map(function (k) {
      return { label: k ? U.userName(k) : 'Unassigned', values: people[k] };
    }).sort(function (a, b) { return (b.values[0] + b.values[1]) - (a.values[0] + a.values[1]); }).slice(0, 12);
    var sevs = C.severities.slice();
    var bySeverity = sevs.map(function (s, i) {
      return { label: s.name, values: [open.filter(function (t) { return t.severity === s.id; }).length],
        colors: [COL.ordinal[Math.min(COL.ordinal.length - 1, sevs.length - i)]] };
    });
    var depts = {};
    open.forEach(function (t) { var d = U.userDept(t.assignee) || (t.assignee ? 'No department' : 'Unassigned'); depts[d] = (depts[d] || 0) + 1; });
    var byDept = Object.keys(depts).map(function (d) { return { label: d, values: [depts[d]] }; })
      .sort(function (a, b) { return b.values[0] - a.values[0]; });

    return sectionHead('ov-status', 'Status now', 'What is open, who has it and how severe it is') +
      '<div class="tiles">' +
      statTile(open.length, 'Open tasks', null, 'of ' + scope.length + ' in total') +
      statTile(overdue.length, 'Overdue', overdue.length ? { icon: '!', color: COL.critical } : null) +
      statTile(inReview.length, 'In review') +
      statTile(done30.length, 'Completed last 30 days') + '</div>' +
      '<div class="viz-grid">' +
      CH.card({ title: 'Tasks by status', subtitle: 'All tasks', chart: CH.hbars({ series: one(), rows: byStatus }),
        table: { header: ['Status', 'Tasks'], rows: byStatus.map(function (r) { return [r.label, r.values[0]]; }) } }) +
      CH.card({ title: 'Open tasks per responsible', subtitle: 'Top 12', chart: CH.hbars({
        series: [{ name: 'On time', color: COL.series[0] }, { name: 'Overdue', color: COL.critical }], rows: byPerson, empty: 'No open tasks.' }),
        table: { header: ['Responsible', 'On time', 'Overdue'], rows: byPerson.map(function (r) { return [r.label, r.values[0], r.values[1]]; }) } }) +
      CH.card({ title: 'Open tasks by severity', chart: CH.hbars({ series: one(), rows: bySeverity }),
        table: { header: ['Severity', 'Open tasks'], rows: bySeverity.map(function (r) { return [r.label, r.values[0]]; }) } }) +
      CH.card({ title: 'Open tasks by department', subtitle: 'Department of the responsible person', chart: CH.hbars({ series: one(), rows: byDept, empty: 'No open tasks.' }),
        table: { header: ['Department', 'Open tasks'], rows: byDept.map(function (r) { return [r.label, r.values[0]]; }) } }) +
      '</div>';
  }

  // Open tasks due in each of the next 8 weeks (overdue ones are counted under Status now).
  function deliveriesCard(scope) {
    var open = scope.filter(function (t) { return !U.isDone(t); });
    var wk = monday(U.today());
    var weeks = [];
    for (var i = 0; i < 8; i++) {
      var from = U.addDays(wk, i * 7), to = U.addDays(from, 6);
      weeks.push({ label: dmy(from), value: open.filter(function (t) { return t.dueDate && !U.isOverdue(t) && t.dueDate >= from && t.dueDate <= to; }).length,
        color: COL.series[0], note: 'Due ' + dmy(from) + '–' + dmy(to) });
    }
    return CH.card({ title: 'Deliveries ahead', subtitle: 'Open tasks by week of delivery date, next 8 weeks', chart: CH.columns({ cols: weeks }),
      table: { header: ['Week', 'Tasks'], rows: weeks.map(function (w) { return [w.note, w.value]; }) } });
  }

  function scheduleHtml(p, list) {
    var lv = leaves(list);
    var actual = projectProgress(list);
    var exp = expectedProgress(p, list);
    var st = scheduleStatus(actual, exp.pct);
    var moved = list.filter(function (t) { return U.slipDays(t) !== 0; }).sort(function (a, b) { return U.slipDays(b) - U.slipDays(a); });
    var movedOpen = moved.filter(function (t) { return !U.isDone(t) && U.slipDays(t) > 0; });
    var avgSlip = movedOpen.length ? Math.round(movedOpen.reduce(function (s, t) { return s + U.slipDays(t); }, 0) / movedOpen.length) : 0;
    var doneLeaves = lv.filter(function (t) { return t.status === 'done'; }).length;

    var movedTable = moved.length ? '<div class="table-scroll"><table class="list compact"><thead><tr><th>Key</th><th>WBS</th><th>Task</th><th>Original</th><th>Now</th><th>Moved</th><th>Responsible</th></tr></thead><tbody>' +
      moved.slice(0, 15).map(function (t) {
        var s = U.slipDays(t);
        return '<tr data-id="' + esc(t.id) + '"><td class="key">' + esc(t.id) + '</td><td class="wbs">' + esc(U.wbsOf(t)) + '</td><td>' + esc(t.title) + '</td>' +
          '<td class="nowrap">' + esc(U.fmtDate(t.originalDueDate)) + '</td><td class="nowrap">' + esc(U.fmtDate(t.dueDate)) + '</td>' +
          '<td class="nowrap slip">' + (s > 0 ? '+' : '') + s + ' days</td><td class="nowrap">' + esc(U.userName(t.assignee)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (moved.length > 15 ? '<p class="small muted">Showing 15 of ' + moved.length + '.</p>' : '')
      : '<p class="muted small" style="margin:0">No delivery dates have been moved.</p>';

    return sectionHead('ov-schedule', 'Schedule', p.startDate || p.endDate ? 'Project period ' + (p.startDate || '?') + ' → ' + (p.endDate || '?') : 'Progress against the planned delivery dates') +
      '<div class="dash-top"><div class="panel hero"><div class="hero-figure">' + actual + '%</div><div class="hero-label">Complete</div>' +
      '<div style="margin:8px 0 4px">' + CH.meter(actual) + '</div>' +
      (exp.pct != null ? '<div class="small">Expected by today: <b>' + exp.pct + '%</b></div>' : '') +
      '<div style="margin-top:6px">' + statusChip(st) + '</div>' +
      '<div class="small muted" style="margin-top:6px">' + esc(exp.basis) + '</div></div>' +
      '<div class="tiles dash-tiles">' +
      statTile(doneLeaves + ' / ' + lv.length, 'Work packages done') +
      statTile(movedOpen.length, 'Open with moved deadline') +
      statTile(avgSlip ? '+' + avgSlip + 'd' : '0', 'Average delay of moved') +
      '</div></div>' +
      '<div class="viz-grid">' +
      CH.card({ title: 'Burn-up', subtitle: 'Work packages over time: total scope, planned finished (by original delivery date) and actually finished', wide: true,
        chart: '<div id="burnup" class="line-host"></div>', table: burnupTable(p, list) }) +
      deliveriesCard(list) +
      '<div class="panel viz-card"><div class="section-head"><div><h2>Moved delivery dates</h2><div class="small muted">Delivery date differs from the original</div></div></div>' + movedTable + '</div>' +
      '</div>';
  }

  function wbsProgressHtml(list) {
    var rows = list.filter(function (t) { return t.status !== 'cancelled' && U.wbsOf(t).split('.').length <= 2; }).sort(U.compareWbs);
    var body = rows.length ? '<div class="table-scroll"><table class="list compact wbs-progress"><thead><tr><th>WBS</th><th>Task</th><th>Progress</th><th>Work packages done</th><th>Status</th><th>Due</th></tr></thead><tbody>' +
      rows.map(function (t) {
        var sub = leaves(list.filter(function (x) { return x.id === t.id || U.wbsOf(x).indexOf(U.wbsOf(t) + '.') === 0; }));
        var lvl = U.wbsOf(t).split('.').length;
        var pr = U.progressOf(t);
        return '<tr data-id="' + esc(t.id) + '" class="' + (lvl > 1 ? 'sub' : 'lvl1') + '"><td class="wbs">' + esc(U.wbsOf(t)) + '</td>' +
          '<td style="padding-left:' + (8 + (lvl - 1) * 18) + 'px">' + esc(t.title) + ' <span class="key">' + esc(t.id) + '</span></td>' +
          '<td class="nowrap">' + CH.meter(pr) + ' <span class="small">' + pr + '%</span></td>' +
          '<td class="small">' + sub.filter(function (x) { return x.status === 'done'; }).length + ' / ' + sub.length + '</td>' +
          '<td>' + U.badge(U.statusOf(t.status)) + '</td><td class="nowrap">' + U.dueHtml(t) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted small" style="margin:0">No tasks yet.</p>';
    return sectionHead('ov-wbs', 'WBS progress', 'Levels 1 and 2. Progress rolls up from the sub-tasks. See the WBS diagram for the full structure.') +
      '<div class="panel">' + body + '</div>';
  }

  function portfolioHtml() {
    var rows = U.activeProjects().map(function (p) {
      var list = U.allTasks().filter(function (t) { return t.projectKey === p.key; });
      var actual = projectProgress(list);
      var exp = expectedProgress(p, list);
      return { p: p, list: list, actual: actual, exp: exp, st: scheduleStatus(actual, exp.pct) };
    });
    return sectionHead('ov-projects', 'Projects', 'Click a project to see its schedule and WBS progress') +
      (rows.length ? '<div class="table-wrap"><table class="list"><thead><tr><th>Project</th><th>Progress</th><th>Expected today</th><th>Schedule</th><th>Open</th><th>Moved deadlines</th><th>End date</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var open = r.list.filter(function (t) { return !U.isDone(t); });
          return '<tr data-key="' + esc(r.p.key) + '"><td><span class="key">' + esc(r.p.key) + '</span> ' + esc(r.p.name) + '</td>' +
            '<td class="nowrap">' + CH.meter(r.actual) + ' <span class="small">' + r.actual + '%</span></td>' +
            '<td>' + (r.exp.pct == null ? '<span class="muted">–</span>' : r.exp.pct + '%') + '</td><td>' + statusChip(r.st) + '</td>' +
            '<td>' + open.length + '</td><td>' + open.filter(function (t) { return U.slipDays(t) > 0; }).length + '</td>' +
            '<td class="nowrap">' + esc(r.p.endDate || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="panel empty">No projects yet.</div>');
  }

  function renderOverview() {
    var p = U.state.project ? store().projects[U.state.project] : null;
    var scope = U.scopedTasks();
    var list = p ? U.allTasks().filter(function (t) { return t.projectKey === p.key; }) : scope;
    var done = scope.filter(function (t) { return t.status === 'done'; });
    var jump = p ? '<nav class="ov-jump" aria-label="Sections"><a href="#ov-status">Status now</a><a href="#ov-schedule">Schedule</a><a href="#ov-wbs">WBS progress</a></nav>' : '';

    U.main.innerHTML = '<div class="page-head"><h1>Overview <span class="muted">· ' + (p ? esc(p.name) : 'all projects') + '</span></h1>' +
      '<div class="toolbar" style="margin:0"><button class="btn" id="btn-ov-word">Completion report → Word</button>' +
      (p ? '<button class="btn" id="btn-ov-all">All projects</button>' : '') + '</div></div>' + jump +
      (p ? statusNowHtml(scope) + scheduleHtml(p, list) + wbsProgressHtml(list)
        : portfolioHtml() + statusNowHtml(scope) + '<div class="viz-grid" style="margin-top:16px">' + deliveriesCard(scope) + '</div>');

    if (p) {
      var bu = burnupData(p, list);
      if (bu.labels.length) {
        CH.lines($('#burnup'), { labels: bu.labels, markerIndex: bu.todayIndex, markerLabel: 'Today', ariaLabel: 'Burn-up chart',
          series: [
            { name: 'Scope', color: COL.series[0], values: bu.scope },
            { name: 'Planned', color: COL.series[1], values: bu.planned },
            { name: 'Finished', color: COL.series[2], values: bu.done }
          ] });
      } else {
        $('#burnup').innerHTML = '<p class="muted small">No tasks yet.</p>';
      }
    }
    CH.bindCards(U.main);
    U.bindRows(U.main);
    $all('tr[data-key]', U.main).forEach(function (tr) { tr.onclick = function () { pickProject(tr.getAttribute('data-key')); }; });
    $all('.ov-jump a', U.main).forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); var s = document.getElementById(a.getAttribute('href').slice(1)); if (s) s.scrollIntoView({ behavior: 'smooth' }); };
    });
    $('#btn-ov-word').onclick = function () { openWordDialog(done); };
    if (p) $('#btn-ov-all').onclick = function () { pickProject(''); };
  }

  function burnupData(p, list) {
    var lv = leaves(list);
    if (!lv.length) return { labels: [] };
    var t = U.today();
    var start = lv.map(function (x) { return U.fmtDate(x.createdAt); }).concat(p.startDate ? [p.startDate] : []).filter(Boolean).sort()[0] || t;
    if (start > t) start = t;
    var end = [t, p.endDate || t].concat(lv.map(plannedDate).filter(Boolean)).sort().pop();
    var span = U.daysBetween(start, end);
    var step = span > 42 ? 7 : 1;
    var dates = [];
    var d = step === 7 ? monday(start) : start;
    while (d < end) { dates.push(d); d = U.addDays(d, step); }
    dates.push(end);
    if (dates.indexOf(t) < 0) { dates.push(t); dates.sort(); }
    var out = { labels: [], scope: [], planned: [], done: [], dates: dates, todayIndex: dates.indexOf(t) };
    dates.forEach(function (day) {
      out.labels.push(dmy(day));
      var future = day > t;
      out.scope.push(future ? null : lv.filter(function (x) { return U.fmtDate(x.createdAt) <= day; }).length);
      out.done.push(future ? null : lv.filter(function (x) { return x.status === 'done' && x.completedAt && U.fmtDate(x.completedAt) <= day; }).length);
      out.planned.push(lv.filter(function (x) { return plannedDate(x) && plannedDate(x) <= day; }).length);
    });
    return out;
  }

  function burnupTable(p, list) {
    var b = burnupData(p, list);
    return { header: ['Date', 'Scope', 'Planned', 'Finished'], rows: (b.dates || []).map(function (d, i) {
      return [d, b.scope[i] == null ? '' : b.scope[i], b.planned[i], b.done[i] == null ? '' : b.done[i]];
    }) };
  }

  // ---------- WBS block diagram ----------

  var wbsOpts = { stack: lsGet('to.wbs.stack') !== '0', showCancelled: lsGet('to.wbs.cancelled') !== '0', zoom: parseFloat(lsGet('to.wbs.zoom')) || 1, collapsed: {} };

  function renderWbs() {
    var p = U.state.project ? store().projects[U.state.project] : null;
    if (!p) return projectPicker('WBS diagram', 'The WBS diagram shows one project at a time. Choose a project:');
    var list = U.allTasks().filter(function (t) { return t.projectKey === p.key && (wbsOpts.showCancelled || t.status !== 'cancelled'); });
    var inList = {};
    list.forEach(function (t) { inList[t.id] = 1; });
    var kids = {};
    list.forEach(function (t) {
      var parent = t.parentId && inList[t.parentId] ? t.parentId : '';
      (kids[parent] = kids[parent] || []).push(t);
    });
    Object.keys(kids).forEach(function (k) { kids[k].sort(U.compareWbs); });

    function node(t) {
      var n = (kids[t.id] || []).length;
      var s = U.statusOf(t.status);
      var pr = U.progressOf(t);
      return '<div class="wbs-node' + (t.status === 'cancelled' ? ' cancelled' : '') + '" data-id="' + esc(t.id) + '" tabindex="0" style="border-top-color:' + s.color + '">' +
        '<div class="wbs-node-top"><span class="wbs-code">' + esc(U.wbsOf(t)) + '</span><span class="key">' + esc(t.id) + '</span>' +
        (U.isLocked(t) ? '<span title="Finished and locked">🔒</span>' : '') + '</div>' +
        '<div class="wbs-node-title">' + esc(t.title) + '</div>' +
        '<div class="wbs-node-meta">' + esc(s.name) + (t.assignee ? ' · ' + esc(U.userName(t.assignee)) : '') + '</div>' +
        '<div class="wbs-node-prog">' + CH.meter(pr) + '<span>' + pr + '%</span></div>' +
        (t.dueDate ? '<div class="wbs-node-due">Due ' + U.dueHtml(t) + '</div>' : '') +
        (t.reviewRequired ? '<div style="margin-top:4px">' + U.reviewBadge(t) + '</div>' : '') +
        (n ? '<button class="wbs-toggle" data-toggle="' + esc(t.id) + '" title="' + (wbsOpts.collapsed[t.id] ? 'Show' : 'Hide') + ' sub-tasks">' +
          (wbsOpts.collapsed[t.id] ? '▸ ' : '▾ ') + n + '</button>' : '') + '</div>';
    }
    function branch(pid) {
      var k = kids[pid] || [];
      if (!k.length || wbsOpts.collapsed[pid]) return '';
      var allLeaves = k.every(function (c) { return !(kids[c.id] || []).length; });
      var stack = wbsOpts.stack && pid !== '' && allLeaves && k.length > 1;
      return '<ul' + (stack ? ' class="stack"' : '') + '>' + k.map(function (c) { return '<li>' + node(c) + branch(c.id) + '</li>'; }).join('') + '</ul>';
    }
    var pr = projectProgress(list);
    var root = '<div class="wbs-node wbs-root" tabindex="0"><div class="wbs-node-top"><span class="wbs-code">0</span><span class="key">' + esc(p.key) + '</span></div>' +
      '<div class="wbs-node-title">' + esc(p.name) + '</div>' +
      '<div class="wbs-node-meta">' + list.length + ' task(s)' + (p.owner ? ' · ' + esc(U.userName(p.owner)) : '') + '</div>' +
      '<div class="wbs-node-prog">' + CH.meter(pr) + '<span>' + pr + '%</span></div>' +
      (p.endDate ? '<div class="wbs-node-due">End ' + esc(p.endDate) + '</div>' : '') + '</div>';

    U.main.innerHTML = '<div class="page-head"><h1>WBS diagram <span class="muted">· ' + esc(p.name) + '</span></h1>' +
      '<div class="toolbar wbs-toolbar" style="margin:0">' +
      '<button class="btn btn-small" id="wbs-out" title="Zoom out">−</button><span class="small" id="wbs-zoom">' + Math.round(wbsOpts.zoom * 100) + '%</span>' +
      '<button class="btn btn-small" id="wbs-in" title="Zoom in">+</button><button class="btn btn-small" id="wbs-fit">Fit to width</button>' +
      '<label class="check small"><input type="checkbox" id="wbs-stack"' + (wbsOpts.stack ? ' checked' : '') + '> Lowest level as list</label>' +
      '<label class="check small"><input type="checkbox" id="wbs-cancel"' + (wbsOpts.showCancelled ? ' checked' : '') + '> Show cancelled</label>' +
      '<button class="btn btn-small" id="wbs-expand">Expand all</button><button class="btn btn-small" id="wbs-collapse">Collapse to level 1</button>' +
      '<button class="btn btn-small" id="wbs-print">Print / PDF</button></div></div>' +
      '<div class="wbs-legend small">' + C.statuses.map(function (s) {
        return '<span><span class="key-line" style="background:' + s.color + '"></span>' + esc(s.name) + '</span>';
      }).join('') + '<span class="muted">Top edge colour = status. Click a box to open the task.</span></div>' +
      '<div class="wbs-scroll"><div class="wbs-tree" style="zoom:' + wbsOpts.zoom + '"><ul><li>' + root + branch('') + '</li></ul></div></div>' +
      (list.length ? '' : '<p class="muted">This project has no tasks yet.</p>');

    // Start with the project box in view (wide diagrams scroll sideways).
    var sc = $('.wbs-scroll');
    var rootBox = $('.wbs-root');
    if (sc && rootBox) {
      var rb = rootBox.getBoundingClientRect(), sb = sc.getBoundingClientRect();
      sc.scrollLeft += rb.left - sb.left + rb.width / 2 - sc.clientWidth / 2;
    }

    $all('.wbs-node[data-id]', U.main).forEach(function (n) {
      var open = function () { location.hash = '#/task/' + encodeURIComponent(n.getAttribute('data-id')); };
      n.onclick = function (e) { if (!e.target.closest('.wbs-toggle')) open(); };
      n.onkeydown = function (e) { if (e.key === 'Enter') open(); };
    });
    $all('[data-toggle]', U.main).forEach(function (b) {
      b.onclick = function () { var id = b.getAttribute('data-toggle'); wbsOpts.collapsed[id] = !wbsOpts.collapsed[id]; renderWbs(); };
    });
    var setZoom = function (z) {
      wbsOpts.zoom = Math.max(0.3, Math.min(1.5, Math.round(z * 100) / 100));
      lsSet('to.wbs.zoom', wbsOpts.zoom);
      $('.wbs-tree').style.zoom = wbsOpts.zoom;
      $('#wbs-zoom').textContent = Math.round(wbsOpts.zoom * 100) + '%';
    };
    $('#wbs-in').onclick = function () { setZoom(wbsOpts.zoom + 0.1); };
    $('#wbs-out').onclick = function () { setZoom(wbsOpts.zoom - 0.1); };
    $('#wbs-fit').onclick = function () {
      var tree = $('.wbs-tree');
      tree.style.zoom = 1;
      var natural = tree.scrollWidth;
      setZoom(Math.min(1, ($('.wbs-scroll').clientWidth - 8) / natural));
    };
    $('#wbs-stack').onchange = function (e) { wbsOpts.stack = e.target.checked; lsSet('to.wbs.stack', e.target.checked ? '1' : '0'); renderWbs(); };
    $('#wbs-cancel').onchange = function (e) { wbsOpts.showCancelled = e.target.checked; lsSet('to.wbs.cancelled', e.target.checked ? '1' : '0'); renderWbs(); };
    $('#wbs-expand').onclick = function () { wbsOpts.collapsed = {}; renderWbs(); };
    $('#wbs-collapse').onclick = function () {
      wbsOpts.collapsed = {};
      (kids[''] || []).forEach(function (t) { if ((kids[t.id] || []).length) wbsOpts.collapsed[t.id] = true; });
      renderWbs();
    };
    $('#wbs-print').onclick = function () {
      document.body.classList.add('print-wbs');
      window.print();
      setTimeout(function () { document.body.classList.remove('print-wbs'); }, 500);
    };
  }

  // ---------- Word export ----------

  function openWordDialog(list) {
    if (!list.length) return U.toast('There are no completed (Done) tasks here to export.', true);
    var dates = list.map(function (t) { return U.fmtDate(t.completedAt); }).filter(Boolean).sort();
    var dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = '<h2 style="margin-top:0">Completed tasks to Word</h2>' +
      '<p class="small muted" style="margin-top:0">' + list.length + ' completed task(s) match the current view' +
      (dates.length ? ', finished between ' + dates[0] + ' and ' + dates[dates.length - 1] : '') + '.</p>' +
      '<div class="form-grid"><div class="field"><label class="field-label" for="w-from">Finished from (optional)</label><input type="date" id="w-from"></div>' +
      '<div class="field"><label class="field-label" for="w-to">Finished to (optional)</label><input type="date" id="w-to"></div></div>' +
      '<label class="check"><input type="checkbox" id="w-log" checked> Include the log (notes and status changes)</label>' +
      '<label class="check"><input type="checkbox" id="w-break"> Start each task on a new page</label>' +
      '<div class="toolbar" style="margin:16px 0 0"><button class="btn btn-primary" id="w-go">Create Word document</button><button class="btn" id="w-cancel">Cancel</button></div>';
    document.body.appendChild(dlg);
    dlg.showModal();
    var close = function () { dlg.close(); dlg.remove(); };
    $('#w-cancel', dlg).onclick = close;
    dlg.addEventListener('cancel', function () { setTimeout(function () { dlg.remove(); }, 0); });
    $('#w-go', dlg).onclick = function () {
      var from = $('#w-from', dlg).value, to = $('#w-to', dlg).value;
      var sel = list.filter(function (t) {
        var d = U.fmtDate(t.completedAt);
        return (!from || d >= from) && (!to || d <= to);
      });
      if (!sel.length) return U.toast('No completed tasks in that period.', true);
      exportWord(sel, { includeLog: $('#w-log', dlg).checked, pageBreaks: $('#w-break', dlg).checked, from: from, to: to });
      close();
    };
  }

  var LOG_FIELDS = { status: 1, assignee: 1, dueDate: 1, reviewStatus: 1 };

  function docLinkItems(t, section) {
    return U.live(t.docLinks).filter(function (d) { return d.section === section; }).map(function (d) {
      return { text: (d.title ? d.title + ' – ' : '') + d.url, url: U.linkHref(d.url) };
    });
  }

  function textOrDash(text) { return text ? { type: 'p', text: text } : { type: 'p', text: '—', italic: true }; }

  // Layout follows the owner's template (Template.docx): Description,
  // Deliverable, Solution, then an Information table, then the Log.
  // Review, sub-tasks and document links appear only when the task has them.
  function taskBlocks(t, opts) {
    var p = store().projects[t.projectKey];
    var parent = t.parentId ? store().tasks[t.parentId] : null;
    var blocks = [];
    var dl;
    blocks.push({ type: 'h2', text: 'Description' }, textOrDash(t.description));
    dl = docLinkItems(t, 'description');
    if (dl.length) blocks.push({ type: 'links', items: dl });
    blocks.push({ type: 'h2', text: 'Deliverable' }, textOrDash(t.deliverable));
    blocks.push({ type: 'h2', text: 'Solution' }, textOrDash(t.solution));
    dl = docLinkItems(t, 'solution');
    if (dl.length) blocks.push({ type: 'links', items: dl });
    if (t.reviewRequired) {
      blocks.push({ type: 'h2', text: 'Review' });
      blocks.push({ type: 'kv', rows: [
        ['Reviewer', U.userLabel(t.reviewer) || '—'],
        ['Review result', U.reviewOf(t.reviewStatus).name.replace(' ✓', '') +
          (t.reviewedAt ? ' (' + U.userName(t.reviewedBy) + ', ' + U.fmtDate(t.reviewedAt) + ')' : '')],
        ["Reviewer's comment", t.reviewComment || '—']
      ] });
      dl = docLinkItems(t, 'review');
      if (dl.length) blocks.push({ type: 'links', items: dl });
    }
    blocks.push({ type: 'h2', text: 'Information' });
    blocks.push({ type: 'kv', rows: [
      ['Project', t.projectKey + (p ? ' – ' + p.name : '')],
      ['Action Point', t.externalRef || '—'],
      ['Parent task', parent ? parent.id + ' – ' + parent.title : '—'],
      ['Status', U.statusOf(t.status).name],
      ['Severity', U.severityOf(t.severity).name],
      ['Responsible', U.userLabel(t.assignee) || '—'],
      ['Reporter', U.userName(t.reporter) || '—'],
      ['Completed', U.fmtDate(t.completedAt) || '—'],
      ['Linked tasks', U.taskLinks(t).map(function (l) { var o = store().tasks[l.other]; return l.label + ' ' + l.other + (o ? ' – ' + o.title : ''); }).join('\n') || '—']
    ] });
    var kids = U.childrenOf(t.id);
    if (kids.length) {
      blocks.push({ type: 'h2', text: 'Sub-tasks' });
      blocks.push({ type: 'table', header: ['Key', 'Title', 'Status', 'Responsible'], widths: [1300, 4638, 1600, 2100],
        rows: kids.map(function (c) { return [c.id, c.title, U.statusOf(c.status).name, U.userName(c.assignee)]; }) });
    }
    if (opts.includeLog) {
      var log = U.live(t.log).filter(function (l) { return l.kind !== 'change' || LOG_FIELDS[l.field]; });
      if (log.length) {
        blocks.push({ type: 'h2', text: 'Log' });
        blocks.push({ type: 'table', header: ['Date', 'By', 'Entry'], widths: [1700, 1900, 6038],
          rows: log.map(function (l) { return [U.fmtDateTime(l.at), U.userName(l.by), l.text]; }) });
      }
    }
    return blocks;
  }

  function safeName(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60); }

  // opts: { single, includeLog, pageBreaks, from, to }
  function exportWord(tasks, opts) {
    opts = opts || {};
    if (opts.includeLog == null) opts.includeLog = true;
    tasks = tasks.slice().sort(function (a, b) { return a.projectKey.localeCompare(b.projectKey) || U.compareWbs(a, b); });
    var me = U.userName(U.state.me);
    var keys = tasks.map(function (t) { return t.projectKey; }).filter(function (k, i, a) { return a.indexOf(k) === i; });
    var projNames = keys.map(function (k) { var p = store().projects[k]; return k + (p ? ' – ' + p.name : ''); }).join(', ');
    var blocks = [];
    var title, file;
    if (opts.single) {
      var t = tasks[0];
      title = 'Task report ' + t.id;
      file = safeName(t.id + ' ' + t.title) + '.docx';
      blocks.push({ type: 'title', text: t.title });
      blocks = blocks.concat(taskBlocks(t, opts));
    } else {
      title = 'Completion report';
      file = 'Completion_report_' + (keys.length === 1 ? keys[0] : 'projects') + '_' + U.today() + '.docx';
      blocks.push({ type: 'title', text: 'Completion report' });
      blocks.push({ type: 'subtitle', text: projNames + ' · ' + tasks.length + ' completed task(s)' +
        (opts.from || opts.to ? ' · finished ' + (opts.from || '…') + ' to ' + (opts.to || '…') : '') + ' · created ' + U.today() + ' by ' + me });
      blocks.push({ type: 'h2', text: 'Summary' });
      blocks.push({ type: 'table', header: ['Key', 'Title', 'Action Point', 'Responsible', 'Completed'], widths: [1200, 3700, 1800, 1838, 1100],
        rows: tasks.map(function (x) {
          return [x.id, x.title, x.externalRef || '—', U.userName(x.assignee), U.fmtDate(x.completedAt)];
        }) });
      tasks.forEach(function (x, i) {
        if (opts.pageBreaks || i === 0) blocks.push({ type: 'pagebreak' });
        blocks.push({ type: 'h1', text: x.id + '   ' + x.title });
        blocks = blocks.concat(taskBlocks(x, opts));
      });
    }
    var blob = TO.docx.build(blocks, { title: title, author: me, footer: 'Bear with me · ' + title });
    U.download(blob, file);
  }

  // Old Dashboard / Progress links go to the merged Overview page.
  function toOverview() { location.replace(location.href.split('#')[0] + '#/overview'); }
  TO.views = { overview: renderOverview, wbs: renderWbs, dashboard: toOverview, progress: toOverview };
  TO.reports = { exportWord: exportWord, openWordDialog: openWordDialog };
})();
