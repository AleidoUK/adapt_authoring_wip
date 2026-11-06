var docx = require('docx');
var parseDocument = require('htmlparser2').parseDocument;

function escape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function linkTarget(value) {
  value = String(value || '').trim();
  if (!value || /[\u0000-\u0020\u007f]/.test(value) || /^\/\//.test(value) ||
      (/^[^/#?]*:/.test(value) && !/^(?:https?:\/\/|mailto:)/i.test(value))) {
    throw new Error('Only web, email and relative links are supported in editable Word fields.');
  }
  return value;
}

function fromHtml(value, rich, italic) {
  var models = [], current;
  function paragraph(options) {
    if (!current) current = Object.assign({ runs: [] }, options);
    return current;
  }
  function flush() {
    if (current) models.push(current);
    current = null;
  }
  function walk(nodes, options, list) {
    (nodes || []).forEach(function(node) {
      if (node.type === 'text') {
        if (node.data && (current || node.data.trim())) paragraph(list).runs.push(Object.assign({ text: node.data }, options));
        return;
      }
      if (!node.name || ['script', 'style', 'img', 'video', 'audio', 'iframe', 'object', 'embed'].indexOf(node.name) !== -1) return;
      var name = node.name.toLowerCase(), next = Object.assign({}, options);
      var css = node.attribs && node.attribs.style || '';
      if (name === 'strong' || name === 'b' || /font-weight\s*:\s*(?:bold|[7-9]00)/i.test(css)) next.bold = true;
      if (/font-weight\s*:\s*(?:normal|[1-6]00)/i.test(css)) next.bold = false;
      if (name === 'em' || name === 'i' || /font-style\s*:\s*italic/i.test(css)) next.italics = true;
      if (/font-style\s*:\s*normal/i.test(css)) next.italics = false;
      if (name === 'u' || /text-decoration[^;]*underline/i.test(css)) next.underline = true;
      if (name === 's' || name === 'strike' || name === 'del' || /text-decoration[^;]*line-through/i.test(css)) next.strike = true;
      if (/text-decoration\s*:\s*none/i.test(css)) { next.underline = false; next.strike = false; }
      if (name === 'a' && node.attribs.href) next.href = linkTarget(node.attribs.href);
      var alignment = /text-align\s*:\s*(left|center|right|justify)/i.exec(css);
      var align = alignment ? alignment[1].toLowerCase() : node.attribs.align;
      if (!['left', 'center', 'right', 'justify'].includes(align)) align = null;
      var context = Object.assign({}, list, align ? { alignment: align } : {});
      if (name === 'br') {
        paragraph(list).runs.push(Object.assign({ text: '\n' }, next));
      } else if (name === 'ul' || name === 'ol') {
        flush();
        walk(node.children, next, Object.assign({}, context, { list: name, level: list && list.list ? list.level + 1 : 0 }));
        flush();
      } else if (name === 'li' || /^(?:p|div|h[1-6])$/.test(name)) {
        flush();
        var children = (node.children || []).filter(function(child) { return child.type !== 'text' || child.data.trim(); });
        if ((name === 'div' || name === 'li') && children.length &&
            children.every(function(child) { return /^(?:p|div|ul|ol|h[1-6])$/.test(child.name || ''); })) {
          walk(node.children, next, context);
          flush();
          return;
        }
        paragraph(Object.assign({}, context,
          /^h[1-6]$/.test(name) ? { heading: Number(name.slice(1)) } : {}));
        walk(node.children, next, context);
        flush();
      } else {
        walk(node.children, next, list);
      }
    });
  }
  if (rich) walk(parseDocument(String(value || ''), { decodeEntities: true }).children, italic ? { italics: true } : {});
  else paragraph().runs.push({ text: String(value || ''), italics: !!italic });
  flush();
  return models.length ? models : [{ runs: [] }];
}

function inlineHtml(runs) {
  var merged = [];
  runs.forEach(function(run) {
    if (!run.text) return;
    var format = { bold: !!run.bold, italics: !!run.italics, underline: !!run.underline, strike: !!run.strike,
      href: run.href || '' };
    var last = merged[merged.length - 1];
    if (last && JSON.stringify(last.format) === JSON.stringify(format)) last.text += run.text;
    else merged.push({ text: run.text, format: format });
  });
  return merged.map(function(item) {
    var run = Object.assign({ text: item.text }, item.format);
    var text = escape(run.text).replace(/\n/g, '<br>');
    if (run.bold) text = '<strong>' + text + '</strong>';
    if (run.italics) text = '<em>' + text + '</em>';
    if (run.underline) text = '<u>' + text + '</u>';
    if (run.strike) text = '<s>' + text + '</s>';
    if (run.href) text = '<a href="' + escape(linkTarget(run.href)) + '">' + text + '</a>';
    return text;
  }).join('');
}

function html(models) {
  if (!models.some(function(model) { return model.runs.some(function(run) { return run.text; }); })) return '';
  var index = 0;
  function list(level) {
    var type = models[index].list, result = '<' + type + '>';
    while (index < models.length && models[index].list === type && models[index].level === level) {
      var model = models[index++];
      result += '<li' + (model.alignment && model.alignment !== 'left' ? ' style="text-align: ' + model.alignment + ';"' : '') +
        '>' + inlineHtml(model.runs);
      while (index < models.length && models[index].list && models[index].level > level) {
        result += list(models[index].level);
      }
      result += '</li>';
    }
    return result + '</' + type + '>';
  }
  var result = '';
  while (index < models.length) {
    var model = models[index];
    if (model.list) result += list(model.level);
    else {
      var tag = model.heading ? 'h' + model.heading : 'p';
      result += '<' + tag + (model.alignment && model.alignment !== 'left' ? ' style="text-align: ' + model.alignment + ';"' : '') +
        '>' + inlineHtml(model.runs) + '</' + tag + '>';
      index++;
    }
  }
  return result;
}

function runs(models, defaults) {
  return models.flatMap(function(run) {
    var children = run.text.split('\n').map(function(line, index) {
      return new docx.TextRun(Object.assign({}, defaults, { text: line, break: index ? 1 : 0,
        bold: !!run.bold, italics: !!run.italics, strike: !!run.strike,
        underline: run.underline ? { type: docx.UnderlineType.SINGLE } : undefined }));
    });
    return run.href ? [new docx.ExternalHyperlink({ link: linkTarget(run.href), children: children })] : children;
  });
}

function control(name, label, children, color) {
  function element(tag, value, key) {
    return new docx.BuilderElement({ name: tag, attributes: { val: { key: key || 'w:val', value: value } } });
  }
  return new docx.BuilderElement({ name: 'w:sdt', children: [
    new docx.BuilderElement({ name: 'w:sdtPr', children: [
      element('w:alias', label), element('w:tag', name), element('w:lock', 'sdtLocked'),
      element('w:id', Number(name.replace('lcfield_', '')) + 1),
      element('w15:appearance', 'boundingBox', 'w15:val'), element('w15:color', color),
      new docx.BuilderElement({ name: 'w:richText' })
    ] }),
    new docx.BuilderElement({ name: 'w:sdtContent', children: children })
  ] });
}

function child(nodes, tag) { return (nodes || []).find(function(node) { return node[tag]; }); }
function attr(node, name) { return node && node[':@'] && node[':@']['@_' + name]; }
function walk(nodes, callback) {
  (nodes || []).forEach(function(node) {
    Object.keys(node).forEach(function(tag) {
      if (tag === ':@') return;
      callback(tag, node);
      if (Array.isArray(node[tag])) walk(node[tag], callback);
    });
  });
}

function editableParagraphs(nodes) {
  return (nodes || []).filter(function(node) {
    if (node['w:p']) return true;
    // Word can place zero-width range markers beside, rather than inside, paragraphs.
    if (node['w:bookmarkStart'] || node['w:bookmarkEnd'] || node['w:commentRangeStart'] || node['w:commentRangeEnd']) return false;
    throw new Error('Editable Word boxes support text, paragraphs and lists, not tables or embedded objects.');
  });
}

async function reader(zip, readXml, getStyle) {
  async function part(path) {
    var file = zip.files.find(function(file) { return file.path === path; });
    if (!file) return [];
    if (file.uncompressedSize > 20 * 1024 * 1024) throw new Error('The Word formatting information is too large to import.');
    return readXml(await file.buffer());
  }
  var parts = await Promise.all([part('word/numbering.xml'), part('word/_rels/document.xml.rels'), part('word/styles.xml')]);
  var abstract = new Map(), numbering = new Map(), links = new Map(), styles = new Map();
  walk(parts[0], function(tag, node) {
    if (tag === 'w:abstractNum') {
      var levels = new Map();
      (node[tag] || []).forEach(function(level) {
        if (level['w:lvl']) levels.set(attr(level, 'w:ilvl'),
          attr(child(level['w:lvl'], 'w:numFmt'), 'w:val') === 'bullet' ? 'ul' : 'ol');
      });
      abstract.set(attr(node, 'w:abstractNumId'), levels);
    } else if (tag === 'w:num') numbering.set(attr(node, 'w:numId'), attr(child(node[tag], 'w:abstractNumId'), 'w:val'));
  });
  walk(parts[1], function(tag, node) {
    if (tag === 'Relationship' && /\/hyperlink$/.test(attr(node, 'Type') || '') && attr(node, 'TargetMode') === 'External') {
      links.set(attr(node, 'Id'), attr(node, 'Target'));
    }
  });
  walk(parts[2], function(tag, node) {
    if (tag === 'w:style') styles.set(attr(node, 'w:styleId'), node[tag]);
  });
  function runProperties(nodes, base) {
    var result = Object.assign({}, base);
    [['w:b', 'bold'], ['w:i', 'italics'], ['w:u', 'underline'], ['w:strike', 'strike']].forEach(function(pair) {
      var property = child(nodes, pair[0]);
      if (property) result[pair[1]] = !['0', 'false', 'off', 'none'].includes(attr(property, 'w:val'));
    });
    return result;
  }
  function inherited(id, seen) {
    if (!id || seen.has(id)) return {};
    seen.add(id);
    var properties = styles.get(id) || [];
    return runProperties((child(properties, 'w:rPr') || {})['w:rPr'],
      inherited(attr(child(properties, 'w:basedOn'), 'w:val'), seen));
  }
  function paragraphProperty(id, tag, seen) {
    if (!id || seen.has(id)) return null;
    seen.add(id);
    var style = styles.get(id) || [];
    var properties = (child(style, 'w:pPr') || {})['w:pPr'];
    return child(properties, tag) || paragraphProperty(attr(child(style, 'w:basedOn'), 'w:val'), tag, seen);
  }
  return function(nodes, inline) {
    var paragraphs = inline ? [{ 'w:p': nodes }] : editableParagraphs(nodes);
    return paragraphs.map(function(paragraph) {
      if (!paragraph['w:p']) throw new Error('Editable Word boxes support text, paragraphs and lists, not tables or embedded objects.');
      var content = paragraph['w:p'], properties = (child(content, 'w:pPr') || {})['w:pPr'] || [];
      var styleId = attr(child(properties, 'w:pStyle'), 'w:val');
      var base = inherited(styleId, new Set());
      var model = { runs: [] };
      var heading = /^Heading([1-6])$/.exec(getStyle(content) || '');
      if (heading) model.heading = Number(heading[1]);
      var alignment = attr(child(properties, 'w:jc') || paragraphProperty(styleId, 'w:jc', new Set()), 'w:val');
      if (['center', 'right', 'both'].includes(alignment)) model.alignment = alignment === 'both' ? 'justify' : alignment;
      var numPr = (child(properties, 'w:numPr') || paragraphProperty(styleId, 'w:numPr', new Set()) || {})['w:numPr'];
      if (numPr) {
        var id = attr(child(numPr, 'w:numId'), 'w:val');
        if (id && id !== '0') {
          var level = attr(child(numPr, 'w:ilvl'), 'w:val') || '0';
          var levels = abstract.get(numbering.get(id));
          if (!levels || !levels.has(level) || !/^[0-8]$/.test(level)) throw new Error('An editable Word list has unsupported numbering. Use a standard Word list.');
          model.list = levels.get(level);
          model.level = Number(level);
        }
      }
      function read(items, format) {
        (items || []).forEach(function(node) {
          var tag = Object.keys(node).find(function(key) { return key !== ':@'; });
          if (tag === 'w:pPr' || tag === 'w:rPr' || tag === 'w:bookmarkStart' || tag === 'w:bookmarkEnd' ||
              /^w:(?:proofErr|commentRangeStart|commentRangeEnd|commentReference|lastRenderedPageBreak)$/.test(tag)) return;
          if (tag === 'w:r') {
            var runPr = (child(node[tag], 'w:rPr') || {})['w:rPr'] || [];
            var runStyle = attr(child(runPr, 'w:rStyle'), 'w:val');
            read(node[tag], runProperties(runPr, Object.assign({}, format, inherited(runStyle, new Set()))));
          } else if (tag === 'w:t') {
            var value = (node[tag] || []).map(function(part) { return part['#text'] || ''; }).join('');
            var last = model.runs[model.runs.length - 1];
            var next = Object.assign({}, format, { text: value });
            if (last && JSON.stringify(Object.assign({}, last, { text: '' })) === JSON.stringify(Object.assign({}, next, { text: '' }))) last.text += value;
            else model.runs.push(next);
          } else if (tag === 'w:br' || tag === 'w:cr' || tag === 'w:tab') {
            if (tag === 'w:br' && attr(node, 'w:type') && attr(node, 'w:type') !== 'textWrapping') {
              throw new Error('Page and column breaks inside editable Word boxes are not supported. Use paragraphs instead.');
            }
            model.runs.push(Object.assign({}, format, { text: tag === 'w:tab' ? '\t' : '\n' }));
          } else if (tag === 'w:hyperlink') {
            var anchor = attr(node, 'w:anchor'), href = anchor ? '#' + anchor : links.get(attr(node, 'r:id'));
            if (!href) throw new Error('An editable Word hyperlink has no valid target.');
            read(node[tag], Object.assign({}, format, { href: linkTarget(href) }));
          } else {
            throw new Error('Unsupported content in an editable Word box: ' + tag + '. Use text, paragraphs, lists and links.');
          }
        });
      }
      read(content, base);
      return model;
    });
  };
}

module.exports = { fromHtml: fromHtml, html: html, runs: runs, control: control, reader: reader,
  editableParagraphs: editableParagraphs };
