// Reads the first worksheet of an Excel .xlsx file (or a .csv file) into
// rows of strings, without any library. .xlsx files are ZIP archives with
// compressed XML inside; Edge and Chrome unpack them with the built-in
// DecompressionStream.
window.TO = window.TO || {};

(function () {
  // ---------- ZIP ----------

  async function inflateRaw(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Returns { 'path/in/zip': Uint8Array } for every file in the archive.
  async function unzip(buffer) {
    var dv = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder();
    var out = {};
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged.');
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      var start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      var data = bytes.subarray(start, start + compSize);
      if (method === 0) out[name] = data;
      else if (method === 8) out[name] = await inflateRaw(data);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  // ---------- XLSX ----------

  function xml(bytes) { return new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml'); }
  function byTag(node, tag) { return Array.prototype.slice.call(node.getElementsByTagNameNS('*', tag)); }
  function text(node) { return byTag(node, 't').map(function (t) { return t.textContent; }).join(''); }
  function colIndex(ref) {
    var letters = (ref || '').replace(/[0-9]/g, '');
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  async function readXlsx(buffer) {
    var files = await unzip(buffer);
    var shared = files['xl/sharedStrings.xml'] ? byTag(xml(files['xl/sharedStrings.xml']), 'si').map(text) : [];
    // First sheet in the workbook's order.
    var sheetPath = null;
    if (files['xl/workbook.xml'] && files['xl/_rels/workbook.xml.rels']) {
      var first = byTag(xml(files['xl/workbook.xml']), 'sheet')[0];
      var rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      byTag(xml(files['xl/_rels/workbook.xml.rels']), 'Relationship').forEach(function (r) {
        if (r.getAttribute('Id') === rid) {
          var target = r.getAttribute('Target').replace(/^\//, '');
          sheetPath = target.indexOf('xl/') === 0 ? target : 'xl/' + target;
        }
      });
    }
    if (!sheetPath || !files[sheetPath]) {
      sheetPath = Object.keys(files).filter(function (f) { return /^xl\/worksheets\/[^/]+\.xml$/.test(f); }).sort()[0];
    }
    if (!sheetPath) throw new Error('No worksheet found in the Excel file.');
    var rows = [];
    byTag(xml(files[sheetPath]), 'row').forEach(function (row) {
      var r = [];
      byTag(row, 'c').forEach(function (c, i) {
        var idx = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : i;
        var t = c.getAttribute('t');
        var v = byTag(c, 'v')[0];
        var val = '';
        if (t === 's') val = shared[parseInt(v && v.textContent, 10)] || '';
        else if (t === 'inlineStr') val = text(c);
        else if (t === 'b') val = v && v.textContent === '1' ? 'TRUE' : 'FALSE';
        else val = v ? v.textContent : '';
        r[idx] = val;
      });
      for (var k = 0; k < r.length; k++) if (r[k] == null) r[k] = '';
      rows.push(r);
    });
    return rows;
  }

  // ---------- CSV ----------

  function readCsv(textContent) {
    textContent = textContent.replace(/^﻿/, '');
    var firstLine = textContent.split(/\r?\n/)[0] || '';
    var sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < textContent.length; i++) {
      var ch = textContent[i];
      if (q) {
        if (ch === '"' && textContent[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && textContent[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // File (from an <input type=file>) -> rows of trimmed strings, empty rows removed.
  async function readTable(file) {
    var rows;
    if (/\.csv$/i.test(file.name)) rows = readCsv(await file.text());
    else if (/\.xlsx$/i.test(file.name)) rows = await readXlsx(await file.arrayBuffer());
    else throw new Error('Choose an Excel (.xlsx) or CSV file. Older .xls files must be saved as .xlsx first.');
    return rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c; }); });
  }

  TO.xlsxread = { readTable: readTable, readXlsx: readXlsx, readCsv: readCsv };
})();
