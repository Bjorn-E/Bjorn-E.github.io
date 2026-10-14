// Builds a Word .docx file from a simple list of blocks, without any library.
//
// Blocks:
//   { type: 'title', text }            { type: 'subtitle', text }
//   { type: 'h1', text }               { type: 'h2', text }
//   { type: 'p', text, small, italic } (text may contain line breaks)
//   { type: 'links', items: [{ text, url }] }
//   { type: 'table', header: [..], rows: [[..]], widths: [twips..] }
//   { type: 'kv', rows: [[label, value]] }   two-column detail table
//   { type: 'pagebreak' }
// A table cell is a string or { text, url }.
window.TO = window.TO || {};

(function () {
  var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  var TEXT_WIDTH = 9638; // A4 with 2 cm margins, in twips
  var BRAND = '21507A';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function run(text, rPr) {
    return '<w:r>' + (rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
  }

  // One paragraph per line of text.
  function paras(text, style, rPr) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    return lines.map(function (line) {
      return '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + (line ? run(line, rPr) : '') + '</w:p>';
    }).join('');
  }

  function Builder() { this.rels = []; }

  Builder.prototype.linkRun = function (text, url) {
    var id = 'rIdL' + (this.rels.length + 1);
    this.rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' +
      esc(url) + '" TargetMode="External"/>');
    return '<w:hyperlink r:id="' + id + '" w:history="1">' + run(text, '<w:rStyle w:val="Hyperlink"/>') + '</w:hyperlink>';
  };

  Builder.prototype.cell = function (content, width, opts) {
    opts = opts || {};
    var tcPr = '<w:tcW w:w="' + width + '" w:type="dxa"/>' + (opts.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + opts.fill + '"/>' : '');
    var body;
    if (content && typeof content === 'object' && content.url) {
      body = '<w:p>' + this.linkRun(content.text || content.url, content.url) + '</w:p>';
    } else {
      body = paras(content && typeof content === 'object' ? content.text : content, null, opts.rPr);
    }
    return '<w:tc><w:tcPr>' + tcPr + '</w:tcPr>' + body + '</w:tc>';
  };

  Builder.prototype.table = function (header, rows, widths, kv) {
    var self = this;
    var n = (header || rows[0] || []).length;
    if (!widths) { widths = []; for (var i = 0; i < n; i++) widths.push(Math.floor(TEXT_WIDTH / n)); }
    var xml = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="' + TEXT_WIDTH + '" w:type="dxa"/>' +
      '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>';
    if (header) {
      xml += '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + header.map(function (h, i) {
        return self.cell(h, widths[i], { fill: BRAND, rPr: '<w:b/><w:color w:val="FFFFFF"/>' });
      }).join('') + '</w:tr>';
    }
    rows.forEach(function (r) {
      xml += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + r.map(function (c, i) {
        return kv && i === 0 ? self.cell(c, widths[i], { fill: 'F4F5F7', rPr: '<w:b/>' }) : self.cell(c, widths[i]);
      }).join('') + '</w:tr>';
    });
    return xml + '</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
  };

  Builder.prototype.block = function (b) {
    var self = this;
    switch (b.type) {
      case 'title': return paras(b.text, 'Title');
      case 'subtitle': return paras(b.text, 'Subtitle');
      case 'h1': return paras(b.text, 'Heading1');
      case 'h2': return paras(b.text, 'Heading2');
      case 'p': return paras(b.text, b.small ? 'Small' : null, b.italic ? '<w:i/>' : null);
      case 'links':
        return b.items.map(function (l) { return '<w:p>' + run('• ') + self.linkRun(l.text || l.url, l.url) + '</w:p>'; }).join('');
      case 'table': return this.table(b.header, b.rows, b.widths, false);
      case 'kv': return this.table(null, b.rows, [2600, TEXT_WIDTH - 2600], true);
      case 'pagebreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
    return '';
  };

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles ' + W_NS + '>' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="' + BRAND + '"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="6B778C"/><w:sz w:val="22"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    // Child order inside w:pPr is fixed by the Word schema (pBdr before spacing).
    '<w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="' + BRAND + '"/></w:pBdr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>' +
    '<w:rPr><w:b/><w:color w:val="' + BRAND + '"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr>' +
    '<w:rPr><w:b/><w:color w:val="172B4D"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:rPr><w:color w:val="6B778C"/><w:sz w:val="18"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:pPr><w:spacing w:after="0"/></w:pPr>' +
    '<w:tblPr><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
      return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="C9CED6"/>';
    }).join('') + '</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>' +
    '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>';

  function footerXml(text) {
    var fld = function (instr) {
      return '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + instr + ' </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    };
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + W_NS + '>' +
      '<w:p><w:pPr><w:pStyle w:val="Small"/><w:tabs><w:tab w:val="right" w:pos="' + TEXT_WIDTH + '"/></w:tabs></w:pPr>' +
      run(text) + '<w:r><w:tab/></w:r>' + run('Page ') + fld('PAGE') + run(' of ') + fld('NUMPAGES') + '</w:p></w:ftr>';
  }

  // opts: { title, author, footer }
  function build(blocks, opts) {
    opts = opts || {};
    var b = new Builder();
    var body = blocks.map(function (x) { return b.block(x); }).join('');
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + '><w:body>' + body +
      '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>' +
      '</w:sectPr></w:body></w:document>';
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    var files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + esc(opts.title || '') + '</dc:title><dc:creator>' + esc(opts.author || '') + '</dc:creator>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
        '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>' },
      { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: STYLES },
      { name: 'word/footer1.xml', data: footerXml(opts.footer || '') },
      // Without this Word opens the file in "Compatibility mode".
      { name: 'word/settings.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ' + W_NS + '>' +
        '<w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>' },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
        '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
        b.rels.join('') + '</Relationships>' }
    ];
    return TO.zip.makeZip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  TO.docx = { build: build, TEXT_WIDTH: TEXT_WIDTH };
})();
