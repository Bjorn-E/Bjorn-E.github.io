// Small chart toolkit for the dashboard and progress pages. No library.
// Colours follow a validated colour-blind-safe palette: categorical slots in
// fixed order, status colours only where the colour means good/bad, and every
// chart has a table view and hover tooltips.
window.TO = window.TO || {};

(function () {
  var COLORS = {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    critical: '#d03b3b', warning: '#fab219', good: '#0ca30c',
    ordinal: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
    track: '#cde2fb', grid: '#e1e0d9', axis: '#c3c2b7', muted: '#898781', ink2: '#52514e', surface: '#ffffff'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  // ---------- tooltip ----------

  var tip;
  function tipEl() {
    if (!tip) { tip = document.createElement('div'); tip.className = 'viz-tip'; tip.hidden = true; document.body.appendChild(tip); }
    return tip;
  }
  function showTip(html, x, y) {
    var t = tipEl();
    t.innerHTML = html;
    t.hidden = false;
    var left = Math.min(x + 14, window.innerWidth - t.offsetWidth - 8);
    var top = y - t.offsetHeight - 12;
    if (top < 4) top = y + 18;
    t.style.left = Math.max(4, left) + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  // Elements with data-tip show it on hover and keyboard focus.
  function bindTips(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-tip]'), function (el) {
      el.addEventListener('mousemove', function (e) { showTip(el.getAttribute('data-tip'), e.clientX, e.clientY); });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('focus', function () { var r = el.getBoundingClientRect(); showTip(el.getAttribute('data-tip'), r.left + r.width / 2, r.top); });
      el.addEventListener('blur', hideTip);
    });
  }

  function tipHtml(title, rows) {
    return '<div class="viz-tip-title">' + esc(title) + '</div>' + rows.map(function (r) {
      return '<div class="viz-tip-row">' + (r.color ? '<span class="key-dot" style="background:' + r.color + '"></span>' : '') +
        '<span>' + esc(r.label) + '</span><b>' + esc(r.value) + '</b></div>';
    }).join('');
  }

  function legend(series) {
    if (series.length < 2) return '';
    return '<div class="viz-legend">' + series.map(function (s) {
      return '<span><span class="key-' + (s.line ? 'line' : 'dot') + '" style="background:' + s.color + '"></span>' + esc(s.name) + '</span>';
    }).join('') + '</div>';
  }

  // ---------- card with chart / table toggle ----------

  // opts: { title, subtitle, chart (html), table: { header, rows }, wide }
  function card(opts) {
    var t = opts.table;
    var table = t ? '<div class="table-wrap viz-table" hidden><table class="list compact"><thead><tr>' +
      t.header.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (t.rows.length ? t.rows.map(function (r) { return '<tr style="cursor:default">' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('')
        : '<tr><td colspan="' + t.header.length + '" class="muted">No data</td></tr>') + '</tbody></table></div>' : '';
    return '<div class="panel viz-card' + (opts.wide ? ' wide' : '') + '"><div class="section-head"><div><h2>' + esc(opts.title) + '</h2>' +
      (opts.subtitle ? '<div class="small muted">' + esc(opts.subtitle) + '</div>' : '') + '</div>' +
      (t ? '<button class="btn btn-ghost btn-small viz-toggle">Show table</button>' : '') + '</div>' +
      '<div class="viz-chart">' + opts.chart + '</div>' + table + '</div>';
  }

  function bindCards(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.viz-toggle'), function (b) {
      b.onclick = function () {
        var c = b.closest('.viz-card');
        var tbl = c.querySelector('.viz-table');
        var showTable = tbl.hidden;
        tbl.hidden = !showTable;
        c.querySelector('.viz-chart').hidden = showTable;
        b.textContent = showTable ? 'Show chart' : 'Show table';
      };
    });
    bindTips(root);
  }

  // ---------- horizontal bars (optionally stacked) ----------

  // opts: { series: [{ name, color }], rows: [{ label, values: [..], href }], empty }
  function hbars(opts) {
    var rows = opts.rows;
    if (!rows.length) return '<p class="muted small">' + esc(opts.empty || 'No data.') + '</p>';
    var max = Math.max.apply(null, rows.map(function (r) { return r.values.reduce(function (a, b) { return a + b; }, 0); })) || 1;
    return legend(opts.series) + '<div class="hbars">' + rows.map(function (r) {
      var total = r.values.reduce(function (a, b) { return a + b; }, 0);
      var segs = r.values.map(function (v, i) {
        if (!v) return '';
        var s = opts.series[i];
        return '<span class="hseg" style="width:' + (v / max * 100) + '%;background:' + (r.colors ? r.colors[i] : s.color) + '"></span>';
      }).join('');
      var tip = tipHtml(r.label, r.values.map(function (v, i) {
        return { label: opts.series[i].name, value: fmt(v), color: r.colors ? r.colors[i] : opts.series[i].color };
      }).concat(opts.series.length > 1 ? [{ label: 'Total', value: fmt(total) }] : []));
      var label = r.href ? '<a href="' + r.href + '">' + esc(r.label) + '</a>' : esc(r.label);
      return '<div class="hbar-row" tabindex="0" data-tip="' + esc(tip) + '"><div class="hbar-label" title="' + esc(r.label) + '">' + label + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill">' + segs + '</div><span class="hbar-value">' + fmt(total) + '</span></div></div>';
    }).join('') + '</div>';
  }

  // ---------- columns ----------

  // opts: { cols: [{ label, value, color, note }], height }
  function columns(opts) {
    var cols = opts.cols;
    var max = Math.max.apply(null, cols.map(function (c) { return c.value; })) || 1;
    var h = opts.height || 150;
    return '<div class="vcols" style="--plot-h:' + h + 'px">' + cols.map(function (c) {
      var px = c.value ? Math.max(3, Math.round(c.value / max * h)) : 0;
      return '<div class="vcol" tabindex="0" data-tip="' + esc(tipHtml(c.label, [{ label: c.note || 'Tasks', value: fmt(c.value), color: c.color }])) + '">' +
        '<div class="vcol-plot"><span class="vcol-value">' + (c.value ? fmt(c.value) : '') + '</span>' +
        '<span class="vcol-bar" style="height:' + px + 'px;background:' + c.color + '"></span></div>' +
        '<div class="vcol-label">' + esc(c.label) + '</div></div>';
    }).join('') + '</div>';
  }

  // ---------- meter (progress bar) ----------

  function meter(pct, color) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    return '<span class="meter" title="' + pct + '%"><span style="width:' + pct + '%;background:' + (color || COLORS.series[0]) + '"></span></span>';
  }

  // ---------- line chart (SVG, sized to its container) ----------

  function niceMax(v) {
    if (v <= 5) return 5;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  var lineCharts = [];

  // el: container. opts: { labels: [x labels], series: [{ name, color, values: [n|null] }], markerIndex, markerLabel }
  function lines(el, opts) {
    lineCharts = lineCharts.filter(function (c) { return document.body.contains(c.el); });
    if (!lineCharts.some(function (c) { return c.el === el; })) lineCharts.push({ el: el, opts: opts });
    drawLines(el, opts);
  }

  function drawLines(el, opts) {
    var W = Math.max(320, el.clientWidth || 600), H = opts.height || 260;
    var m = { l: 36, r: 120, t: 12, b: 28 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var n = opts.labels.length;
    var maxV = 0;
    opts.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && v > maxV) maxV = v; }); });
    var top = niceMax(maxV || 1);
    var x = function (i) { return m.l + (n <= 1 ? pw / 2 : i / (n - 1) * pw); };
    var y = function (v) { return m.t + ph - v / top * ph; };
    var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(opts.ariaLabel || 'Line chart') + '">';
    // grid + y ticks
    for (var k = 0; k <= 4; k++) {
      var v = top / 4 * k, yy = y(v);
      svg += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + (k ? COLORS.grid : COLORS.axis) + '" stroke-width="1"/>' +
        '<text x="' + (m.l - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="viz-axis">' + fmt(v) + '</text>';
    }
    // x labels (at most ~6)
    var every = Math.max(1, Math.ceil(n / 6));
    opts.labels.forEach(function (l, i) {
      if (i % every && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every / 2) return;
      svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" class="viz-axis">' + esc(l) + '</text>';
    });
    // today marker
    if (opts.markerIndex != null && opts.markerIndex >= 0 && opts.markerIndex < n) {
      var mx = x(opts.markerIndex);
      svg += '<line x1="' + mx + '" x2="' + mx + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + COLORS.axis + '" stroke-width="1"/>' +
        '<text x="' + (mx + 4) + '" y="' + (m.t + 10) + '" class="viz-axis">' + esc(opts.markerLabel || 'Today') + '</text>';
    }
    // series
    var ends = [];
    opts.series.forEach(function (s) {
      var d = '', last = -1;
      s.values.forEach(function (v, i) {
        if (v == null) return;
        d += (d ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
        last = i;
      });
      if (!d) return;
      svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      svg += '<circle cx="' + x(last) + '" cy="' + y(s.values[last]) + '" r="4" fill="' + s.color + '" stroke="' + COLORS.surface + '" stroke-width="2"/>';
      ends.push({ s: s, x: x(last), y: y(s.values[last]), v: s.values[last] });
    });
    // end labels, only when they don't collide (otherwise the legend carries identity)
    ends.sort(function (a, b) { return a.y - b.y; });
    var collide = ends.some(function (e, i) { return i && Math.abs(e.y - ends[i - 1].y) < 15 && Math.abs(e.x - ends[i - 1].x) < 90; });
    if (!collide) {
      ends.forEach(function (e) {
        svg += '<text x="' + (e.x + 8) + '" y="' + (e.y + 4) + '" class="viz-endlabel">' + esc(e.s.name) + ' ' + fmt(e.v) + '</text>';
      });
    }
    svg += '<line class="viz-cross" x1="0" x2="0" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + COLORS.muted + '" stroke-width="1" visibility="hidden"/>';
    svg += '<rect class="viz-hit" x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '" fill="transparent"/>';
    svg += '</svg>';
    el.innerHTML = legend(opts.series.map(function (s) { return { name: s.name, color: s.color, line: true }; })) + svg;

    var hit = el.querySelector('.viz-hit'), cross = el.querySelector('.viz-cross'), svgEl = el.querySelector('svg');
    hit.addEventListener('mousemove', function (e) {
      var r = svgEl.getBoundingClientRect();
      var px = e.clientX - r.left;
      var i = n <= 1 ? 0 : Math.round((px - m.l) / pw * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      showTip(tipHtml(opts.labels[i], opts.series.filter(function (s) { return s.values[i] != null; }).map(function (s) {
        return { label: s.name, value: fmt(s.values[i]), color: s.color };
      })), e.clientX, e.clientY);
    });
    hit.addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      lineCharts = lineCharts.filter(function (c) { return document.body.contains(c.el); });
      lineCharts.forEach(function (c) { drawLines(c.el, c.opts); });
    }, 150);
  });

  TO.charts = {
    COLORS: COLORS, card: card, bindCards: bindCards, bindTips: bindTips, hbars: hbars, columns: columns,
    meter: meter, lines: lines, tipHtml: tipHtml, hideTip: hideTip
  };
})();
