var docx = require('docx');
var unzipper = require('unzipper');
var XMLParser = require('fast-xml-parser').XMLParser;
var XMLValidator = require('fast-xml-parser').XMLValidator;
var wordFields = require('./wordFields');

var PROPERTY_NAME = 'LightCourseWord';
var LEVELS = [docx.HeadingLevel.HEADING_1, docx.HeadingLevel.HEADING_2,
  docx.HeadingLevel.HEADING_3, docx.HeadingLevel.HEADING_4, docx.HeadingLevel.HEADING_5];
var LABEL_STYLE = 'LightCourseFieldLabel';
var READONLY_STYLE = 'LightCourseReadOnly';
// Word requires a hex value; keep this aligned with @aleido-green in colours.less.
var HEADING_COLOR = '61C6A2';
var NOTE_PLACEHOLDERS = {
  graphicsNotes: 'Add graphics notes here',
  developerNotes: 'Add developer notes here'
};

function fieldLabel(path) {
  return path.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^_/, '').replace(/\./g, ' ').replace(/^./, function(letter) { return letter.toUpperCase(); });
}

function placeholderText(path) {
  return Object.prototype.hasOwnProperty.call(NOTE_PLACEHOLDERS, path) ? NOTE_PLACEHOLDERS[path] :
    'Add ' + fieldLabel(path).toLowerCase() + ' here';
}

function textRuns(text, options) {
  return wordFields.plainText(text).split('\n').map(function(line, index) {
    return new docx.TextRun(Object.assign({ text: line, break: index ? 1 : 0 }, options));
  });
}

function generate(data, blocks, callback) {
  var metadata = { version: 2, compactStructure: true, courseDetailsReadOnly: true, reviewLayout: true,
    readOnlyTableCount: 0, sourceId: data._lightCourseId || null, nodes: [], fields: [] };
  var paragraphs = [];
  var editableStarted = false;
  function fieldParagraph(nodeId, field, heading, wordCount) {
    var name = 'lcfield_' + metadata.fields.length;
    var note = Object.prototype.hasOwnProperty.call(NOTE_PLACEHOLDERS, field.path);
    var originalText = wordFields.plainText(field.text);
    var placeholder = !originalText.trim();
    var inline = field.path === 'uniqueId';
    var inlineSuffix = inline && wordCount !== undefined ? ' | ' + wordCount + ' words' : undefined;
    var value = placeholder ? placeholderText(field.path) : field.text;
    metadata.fields.push({ bookmark: name, nodeId: nodeId, path: field.path, placeholder: placeholder,
      placeholderValue: placeholder ? originalText : undefined, inline: inline, inlineSuffix: inlineSuffix });
    if (inline) {
      var font = { font: 'Calibri', size: 16, bold: true, color: '777777' };
      var bookmark = new docx.Bookmark({ id: name, children: textRuns(value, font) });
      paragraphs.push(new docx.Paragraph({ style: LABEL_STYLE, spacing: { after: 240 },
        children: inlineSuffix === undefined ? [
          new docx.TextRun(Object.assign({ text: fieldLabel(field.path) + ': ' }, font)), bookmark
        ] : [bookmark, new docx.TextRun(Object.assign({ text: inlineSuffix }, font))] }));
      return;
    }
    if (!heading) {
      paragraphs.push(new docx.Paragraph({ style: LABEL_STYLE,
        children: [new docx.TextRun({ text: fieldLabel(field.path), bold: true, color: '777777', italics: note })] }));
    }
    paragraphs.push(new docx.Paragraph({ heading: heading, spacing: { after: 240 },
      children: [new docx.Bookmark({ id: name,
        children: textRuns(value, { italics: note }) })] }));
  }
  function readOnlyHeading(text, size) {
    paragraphs.push(new docx.Paragraph({ style: READONLY_STYLE, spacing: { before: 240 },
      children: [new docx.TextRun({ text: text, bold: true, size: size, color: HEADING_COLOR })] }));
  }
  function readOnlyValue(value, path) {
    if (value && typeof value === 'object' && Object.keys(value).length) {
      Object.keys(value).forEach(function(key) {
        var label = Array.isArray(value) ? String(Number(key) + 1) : key === 'duration' ? 'Estimated duration' : fieldLabel(key);
        readOnlyValue(value[key], path.concat(label));
      });
      return;
    }
    if (path.length) {
      paragraphs.push(new docx.Paragraph({ style: LABEL_STYLE,
        children: [new docx.TextRun({ text: path.join(' / '), bold: true, color: '777777' })] }));
    }
    paragraphs.push(new docx.Paragraph({ style: READONLY_STYLE, children: textRuns(readOnlyText(value)) }));
  }
  function readOnlyText(value) {
    return value === true ? 'Yes' : value === false ? 'No' :
      value == null ? '(not set)' : typeof value === 'object' ? '(none)' : String(value);
  }
  function tableRow(values, isHeader, size) {
    return new docx.TableRow({ tableHeader: isHeader, children: values.map(function(value) {
      return new docx.TableCell({ children: [new docx.Paragraph({ style: READONLY_STYLE,
        children: textRuns(value, { bold: isHeader, size: size || 24 }) })] });
    }) });
  }
  function readOnlyTable(rows) {
    metadata.readOnlyTableCount++;
    paragraphs.push(new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows: rows }));
  }
  function settingsTable(title, values) {
    readOnlyHeading(title, 26);
    readOnlyTable([tableRow(['Field', 'Value'], true)].concat(Object.keys(values).map(function(key) {
      return tableRow([fieldLabel(key), readOnlyText(values[key])], false);
    })));
  }
  function readOnlySection(title, value) {
    readOnlyHeading(title, 26);
    readOnlyValue(value, []);
  }
  paragraphs.push(new docx.Paragraph({ heading: docx.HeadingLevel.TITLE, text: data.title || 'Untitled light course' }));
  paragraphs.push(new docx.Paragraph({ style: READONLY_STYLE, text: 'Version: ' + (data.isDraft ? 'Draft (unpublished)' : data.versionNumber || '') }));
  var header = data.headerData || {};
  readOnlyHeading('Version history', 26);
  if (Array.isArray(header.versionHistory) && header.versionHistory.length) {
    var columns = ['version', 'date', 'author', 'screens', 'words', 'notes', 'duration'];
    metadata.versionHistoryTable = true;
    readOnlyTable([tableRow(columns.map(function(key) { return key === 'duration' ? 'Estimated duration' : fieldLabel(key); }), true, 18)]
        .concat(header.versionHistory.map(function(row) {
          return tableRow(columns.map(function(key) { return row[key] == null ? '' : row[key]; }), false, 18);
        })));
  } else {
    readOnlyValue([], []);
  }
  readOnlySection('Instructions for reviewing this document', header.reviewingInstructions);
  settingsTable('Developer information', Object.assign({
    navigationLinearity: 'linear', layout: 'full', tracking: 'assessment', reflectionNeeded: false
  }, header.developerInfo));
  settingsTable('Terminology', Object.assign({
    section: 'Section', course: 'Course', assessment: 'Assessment'
  }, header.terminology));
  readOnlySection('Tags', (data.tags || []).map(function(tag) { return tag.title || String(tag._id || tag); }));
  function blockParagraph(block) {
    var name = 'lcnode_' + metadata.nodes.length;
    var hidden = block.level === 2 || block.level === 3;
    metadata.nodes.push({ bookmark: name, id: block.id, level: block.level, heading: block.heading || '', hidden: hidden });
    if (hidden) return;
    paragraphs.push(new docx.Paragraph({ heading: LEVELS[block.level - 1],
      pageBreakBefore: block.level === 1 || !editableStarted,
      children: [new docx.Bookmark({ id: name, children: [new docx.TextRun(block.heading || '')] })] }));
    editableStarted = true;
    (block.fields || []).forEach(function(field) {
      fieldParagraph(block.id, field, undefined, block.level === 4 ? block.wordCount : undefined);
    });
  }
  blocks.forEach(blockParagraph);
  function itemSection(title, items, titlePath, bodyPath) {
    if (!items || !items.length) return;
    paragraphs.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, text: title, pageBreakBefore: !editableStarted }));
    editableStarted = true;
    items.forEach(function(item) {
      blockParagraph({ id: item._id, level: 5, heading: item[titlePath] || '',
        fields: wordFields.fixedFields(item, titlePath, bodyPath) });
    });
  }
  itemSection('Glossary', data.glossaryItems, 'term', 'description');
  itemSection('Resources', data.resourceItems, 'title', 'description');
  var helpItems = (data.helpContent && data.helpContent.items || []).slice();
  if (data.helpContent && data.helpContent.popup && data.helpContent.popup.title) {
    helpItems.unshift(Object.assign({}, data.helpContent.popup, { _id: 'help-popup' }));
  }
  itemSection('Help', helpItems, 'title', 'body');
  var document = new docx.Document({
    customProperties: [{ name: PROPERTY_NAME, value: JSON.stringify(metadata) }],
    features: { trackRevisions: true },
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 24 } },
        title: { run: { font: 'Calibri', size: 56, color: HEADING_COLOR } },
        heading1: { run: { font: 'Calibri', size: 32, color: HEADING_COLOR } },
        heading2: { run: { font: 'Calibri', size: 26, color: HEADING_COLOR } },
        heading3: { run: { font: 'Calibri', size: 24, color: HEADING_COLOR } },
        heading4: { run: { font: 'Calibri', italics: true, color: HEADING_COLOR } },
        heading5: { run: { font: 'Calibri', color: HEADING_COLOR } }
      },
      paragraphStyles: [
        { id: LABEL_STYLE, name: 'Light course field label', basedOn: 'Normal', next: 'Normal',
          run: { font: 'Calibri', size: 16 } },
        { id: READONLY_STYLE, name: 'Light course read-only instructions', basedOn: 'Normal', next: 'Normal' }
      ]
    },
    sections: [{ children: paragraphs }]
  });
  docx.Packer.toBuffer(document).then(function(buffer) { callback(null, buffer); }, callback);
}

function child(nodes, tag) {
  return (nodes || []).find(function(node) { return Object.prototype.hasOwnProperty.call(node, tag); });
}
function attr(node, name) { return node && node[':@'] && node[':@']['@_' + name]; }
function visit(nodes, callback) {
  (nodes || []).forEach(function(node) {
    Object.keys(node).forEach(function(tag) {
      if (tag === ':@') return;
      callback(tag, node);
      if (Array.isArray(node[tag])) visit(node[tag], callback);
    });
  });
}
function textOf(nodes) {
  var text = '';
  visit(nodes, function(tag, node) {
    if (tag === 'w:t' || tag === 'vt:lpwstr') {
      text += (node[tag] || []).map(function(part) { return part['#text'] || ''; }).join('');
    } else if (tag === 'w:br' || tag === 'w:tab') {
      text += tag === 'w:br' ? '\n' : '\t';
    }
  });
  return text;
}
function invalid(message) { return { blocks: [], errors: [message] }; }

async function parseBuffer(buffer) {
  var zip = await unzipper.Open.buffer(buffer);
  var custom = zip.files.find(function(file) { return file.path === 'docProps/custom.xml'; });
  if (!custom) return null;
  var xml = zip.files.find(function(file) { return file.path === 'word/document.xml'; });
  if (!xml) return invalid('Not a valid Word document: word/document.xml is missing.');
  if (custom.uncompressedSize > 1024 * 1024 || xml.uncompressedSize > 20 * 1024 * 1024) {
    return invalid('The Word document is too large to import.');
  }
  function readXml(data) {
    var text = data.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Document XML declarations are not supported.');
    var validation = XMLValidator.validate(text);
    if (validation !== true) throw new Error(validation.err.msg);
    return parser.parse(text);
  }
  var parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false });
  var properties = readXml(await custom.buffer());
  var property;
  visit(properties, function(tag, node) {
    if (tag === 'property' && attr(node, 'name') === PROPERTY_NAME) property = node;
  });
  if (!property) return null;
  var metadata = JSON.parse(textOf(property.property));
  if (metadata.version !== 2 || !Array.isArray(metadata.nodes) || !Array.isArray(metadata.fields)) {
    return invalid('Unsupported light course Word metadata. Re-export the course.');
  }
  var document = readXml(await xml.buffer());
  var body = child(document, 'w:document');
  body = body && child(body['w:document'], 'w:body');
  if (!body) return invalid('The Word document has no document body.');
  var result = { formatVersion: 2, compactStructure: metadata.compactStructure === true,
    courseDetailsReadOnly: metadata.courseDetailsReadOnly === true,
    reviewLayout: metadata.reviewLayout === true,
    sourceId: metadata.sourceId, blocks: [], courseFields: [], errors: [] };
  var currentBlock = null;
  var activeField = null;
  var seenNodes = [];
  var seenFields = [];
  var readOnlyTableCount = Number.isInteger(metadata.readOnlyTableCount) && metadata.readOnlyTableCount >= 0
    ? metadata.readOnlyTableCount : metadata.versionHistoryTable === true ? 1 : 0;
  var seenReadOnlyTables = 0;
  body['w:body'].forEach(function(paragraph, index) {
    if (paragraph['w:tbl']) {
      var readOnlyTable = seenReadOnlyTables < readOnlyTableCount && !seenNodes.length && !activeField;
      var hasParagraph = false;
      var trackedTable = false;
      visit(paragraph['w:tbl'], function(tag, node) {
        if (tag === 'w:p') {
          hasParagraph = true;
          var properties = child(node['w:p'], 'w:pPr');
          var style = properties && child(properties['w:pPr'], 'w:pStyle');
          if (attr(style, 'w:val') !== READONLY_STYLE) readOnlyTable = false;
        }
        if (tag === 'w:bookmarkStart') {
          var name = attr(node, 'w:name');
          if (/^lc(?:node|field)_/.test(name || '') ||
              metadata.nodes.concat(metadata.fields).some(function(marker) { return marker.bookmark === name; })) {
            readOnlyTable = false;
          }
        }
        if (tag === 'w:tbl') readOnlyTable = false;
        if (['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'].indexOf(tag) !== -1) trackedTable = true;
      });
      if (trackedTable) result.errors.push('Accept or reject tracked changes in Word before importing.');
      else if (readOnlyTable && hasParagraph) seenReadOnlyTables++;
      else result.errors.push('Adding tables or changing read-only settings table structure is not supported. Edit the existing text fields instead.');
      return;
    }
    if (!paragraph['w:p']) return;
    var nodes = paragraph['w:p'];
    var properties = child(nodes, 'w:pPr');
    var style = properties && child(properties['w:pPr'], 'w:pStyle');
    style = attr(style, 'w:val');
    var text = textOf(nodes);
    var nodeMarker;
    var nodeMarkerCount = 0;
    var tracked = false;
    visit(nodes, function(tag, node) {
      if (['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'].indexOf(tag) !== -1) tracked = true;
      if (tag === 'w:bookmarkStart') {
        var name = attr(node, 'w:name');
        var match = metadata.nodes.find(function(item) { return item.bookmark === name; });
        if (match) {
          nodeMarker = match;
          nodeMarkerCount++;
        } else if (/^lc(?:node|field)_/.test(name || '') &&
                   !metadata.fields.some(function(item) { return item.bookmark === name; })) {
          result.errors.push('Unknown light course bookmark. Re-export the course.');
        }
      }
    });
    if (tracked) result.errors.push('Accept or reject tracked changes in Word before importing.');
    var startedWithField = !!activeField;
    if (activeField) activeField.value += '\n';
    if (nodeMarker) {
      if (nodeMarkerCount !== 1) result.errors.push('Multiple section bookmarks share a heading.');
      if (activeField) result.errors.push('A field bookmark crosses a section boundary.');
      if (seenNodes.indexOf(nodeMarker.bookmark) !== -1) result.errors.push('Duplicate section bookmark: ' + nodeMarker.id);
      if (text !== nodeMarker.heading) result.errors.push('A section heading was edited. Change its labelled title field instead.');
      seenNodes.push(nodeMarker.bookmark);
      var level = /^Heading([1-5])$/.exec(style || '');
      currentBlock = { id: nodeMarker.id, heading: text, level: level ? Number(level[1]) : 0, fields: [], body: '' };
      result.blocks.push(currentBlock);
    } else if (/^Heading[1-5]$/.test(style || '') && ['Glossary', 'Resources', 'Help'].indexOf(text) === -1) {
      result.errors.push('A heading has no original section bookmark. Re-export rather than changing structure.');
    } else if (style === 'Title' || /^Heading[1-5]$/.test(style || '')) {
      currentBlock = null;
    }
    var outside = '';
    var paragraphHasField = false;
    var paragraphFields = [];
    visit(nodes, function(tag, node) {
      if (tag === 'w:bookmarkStart') {
        var marker = metadata.fields.find(function(item) { return item.bookmark === attr(node, 'w:name'); });
        if (!marker) return;
        paragraphHasField = true;
        if (activeField) result.errors.push('Overlapping field bookmarks are not supported.');
        if (seenFields.indexOf(marker.bookmark) !== -1) result.errors.push('Duplicate field bookmark: ' + marker.path);
        seenFields.push(marker.bookmark);
        if (marker.nodeId !== null && (!currentBlock || currentBlock.id !== marker.nodeId)) {
          result.errors.push('A field was moved outside its original section: ' + marker.path);
        }
        activeField = { path: marker.path, value: '', bookmarkId: attr(node, 'w:id'),
          inline: marker.inline === true && marker.path === 'uniqueId', inlineSuffix: marker.inlineSuffix };
        paragraphFields.push(activeField);
        (marker.nodeId === null ? result.courseFields : currentBlock ? currentBlock.fields : [])
          .push(activeField);
      } else if (tag === 'w:bookmarkEnd' && activeField && attr(node, 'w:id') === activeField.bookmarkId) {
        activeField = null;
      } else if (tag === 'w:t' || tag === 'w:br' || tag === 'w:tab') {
        var value = tag === 'w:br' ? '\n' : tag === 'w:tab' ? '\t' : textOf([node]);
        if (activeField) activeField.value += value;
        else outside += value;
      }
    });
    // Word can collapse a bookmark or place replacement text just outside its ends.
    // A single, closed field marker still identifies this entire editable paragraph.
    if (!startedWithField && !activeField && paragraphFields.length === 1 && paragraphFields[0].inline) {
      var suffix = paragraphFields[0].inlineSuffix;
      if (suffix !== undefined) {
        if (typeof suffix !== 'string' || !/^ \| \d+ words$/.test(suffix) || !text.endsWith(suffix)) {
          result.errors.push('The component word count was edited. Restore it before importing.');
        } else {
          paragraphFields[0].value = text.slice(0, -suffix.length);
        }
      } else {
        var prefix = fieldLabel('uniqueId') + ': ';
        if (text.indexOf(prefix) !== 0) result.errors.push('The Unique Id label was edited. Restore the label and edit only its value.');
        else paragraphFields[0].value = text.slice(prefix.length);
      }
      outside = '';
    } else if (!startedWithField && !activeField && paragraphFields.length === 1 &&
        !nodeMarker && style !== LABEL_STYLE && style !== READONLY_STYLE) {
      paragraphFields[0].value = text;
      outside = '';
    }
    if (activeField && index === body['w:body'].length - 1) result.errors.push('A field bookmark was not closed.');
    if (!nodeMarker && style !== LABEL_STYLE && style !== READONLY_STYLE &&
        !(style === 'Title' && !paragraphHasField) && !/^Heading[1-5]$/.test(style || '') && outside.trim()) {
      result.errors.push('Text is outside an editable field bookmark. Keep edits within the existing fields.');
    }
  });
  if (activeField) result.errors.push('A field bookmark was not closed.');
  result.blocks.forEach(function(block) {
    block.fields.forEach(function(field) {
      var marker = metadata.fields.find(function(item) { return item.nodeId === block.id && item.path === field.path; });
      if (result.reviewLayout && marker && marker.placeholder === true &&
          field.value === placeholderText(field.path)) {
        if (marker.placeholderValue !== undefined &&
            (typeof marker.placeholderValue !== 'string' || marker.placeholderValue.trim())) {
          result.errors.push('Invalid empty-field placeholder metadata. Re-export the course.');
        } else {
          field.value = marker.placeholderValue === undefined ? '' : marker.placeholderValue;
        }
      }
    });
  });
  if (result.compactStructure) {
    var visibleNodes = metadata.nodes.filter(function(node) { return !node.hidden; });
    if (JSON.stringify(visibleNodes.map(function(node) { return node.id; })) !==
        JSON.stringify(result.blocks.map(function(block) { return block.id; }))) {
      result.errors.push('Sections are missing, duplicated or reordered. Keep the original pages and components in order.');
    }
    var visibleBlocks = result.blocks;
    result.blocks = metadata.nodes.map(function(node) {
      if (node.hidden && (node.level === 2 || node.level === 3)) {
        return { id: node.id, heading: node.heading, level: node.level, fields: [], body: '' };
      }
      return visibleBlocks.find(function(block) { return block.id === node.id; });
    }).filter(Boolean);
  }
  result.blocks.forEach(function(block) {
    block.body = block.fields.filter(function(field) {
      return block.level !== 5 || ['title', 'term'].indexOf(field.path) === -1;
    }).map(function(field) { return field.value; }).join('\n');
  });
  return result;
}

function parse(buffer, callback) {
  parseBuffer(buffer).then(function(result) { callback(null, result); }, function(error) {
    callback(null, invalid('Could not read the Word document: ' + error.message));
  });
}

module.exports = { generate: generate, parse: parse };
