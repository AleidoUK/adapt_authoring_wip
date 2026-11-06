var assert = require('assert');
var unzipper = require('unzipper');
var archiver = require('archiver');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var EventEmitter = require('events');
var _ = require('underscore');
var generator = require('../lib/lightcourse/documentGenerator');
var importer = require('../lib/lightcourse/documentImport');
var wordFields = require('../lib/lightcourse/wordFields');
var wordcount = require('../lib/lightcoursewordcount');
var docx = require('docx');
var XMLParser = require('fast-xml-parser').XMLParser;

var db = { retrieve: function(type, query, options, callback) {
  callback(null, [{ component: 'text', displayName: 'Text', properties: {
    _graphic: { type: 'object', properties: { alt: { type: 'string', translatable: true } } },
    _items: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string', translatable: true },
      body: { type: 'string', translatable: true }
    } } }
  } }]);
} };
function fixture() {
  return {
    _lightCourseId: 'course-1', title: 'Course title', body: '<p>Course introduction</p>',
    pluginSelections: { menu: 'boxmenu', extensions: ['glossary'] },
    contentTree: { children: [{ _id: 'page-long-id-1', type: 'page', title: 'First page', children: [
      { _id: 'article-1', type: 'article', instruction: 'Article instruction', children: [
        { _id: 'block-1', type: 'block', children: [
          { _id: 'component-1', type: 'component', _component: 'text', _componentPresetId: 'preset-1',
            uniqueId: 'author-1', title: 'Component title', body: '<p>Original <strong>body</strong>.</p><p>Second paragraph.</p>',
            instruction: '', graphicsNotes: 'Illustration notes',
            _graphic: { src: 'image.png', alt: 'Image description' },
            _items: [{ _id: 'item-1', title: 'Item title', body: '' }] }
        ] }
      ] }
    ] }] },
    glossaryItems: [{ _id: 'glossary-1', term: 'Term', description: 'Definition' }],
    resourceItems: [{ _id: 'resource-1', title: 'Resource', description: 'Description', _link: 'https://example.com' }],
    helpContent: { popup: { title: 'Help', body: '<p>Help body</p>', instruction: 'Help instruction' }, items: [] }
  };
}
function component(snapshot) { return snapshot.contentTree.children[0].children[0].children[0].children[0]; }
function generate(snapshot) {
  return new Promise(function(resolve, reject) {
    generator.generateDocx(snapshot, db, function(error, value) { if (error) reject(error); else resolve(value); });
  });

}
function parse(buffer) {
  return new Promise(function(resolve, reject) {
    generator.parseDocx(buffer, function(error, value) { if (error) reject(error); else resolve(value); });
  });
}
function apply(parsed, snapshot) {
  return new Promise(function(resolve, reject) {
    importer.importDocument(parsed, snapshot, db, function(error, value) { if (error) reject(error); else resolve(value); });
  });
}
async function edited(snapshot, edit) {
  var zip = await unzipper.Open.buffer(await generate(snapshot));
  var archive = archiver('zip');
  var chunks = [];
  var buffer = new Promise(function(resolve, reject) {
    archive.on('data', function(chunk) { chunks.push(chunk); });
    archive.on('end', function() { resolve(Buffer.concat(chunks)); });
    archive.on('error', reject);
  });
  for (var file of zip.files) {
    var data = await file.buffer();
    archive.append(file.path === 'word/document.xml' ? edit(data.toString('utf8')) : data, { name: file.path });
  }
  archive.finalize();
  return parse(await buffer);
}
function replaceField(xml, fieldName, text) {
  var label = xml.indexOf('>' + fieldName + '</w:t>');
  if (label === -1) label = xml.indexOf('>' + fieldName + ': </w:t>');
  if (label === -1 && fieldName === 'Unique Id') {
    var paragraph = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g).find(function(paragraph) {
      return paragraph.includes('w:val="LightCourseFieldLabel"') && / \| \d+ words<\/w:t>/.test(paragraph);
    });
    if (paragraph) label = xml.indexOf(paragraph);
  }
  assert(label !== -1, fieldName);
  var start = xml.indexOf('<w:bookmarkStart', label);
  var textStart = xml.indexOf('<w:t', start);
  var contentStart = xml.indexOf('>', textStart) + 1;
  var end = xml.indexOf('</w:t>', contentStart);
  return xml.slice(0, contentStart) + text + xml.slice(end);
}

describe('mapped Word text round-trip', function() {
  it('matches Aleido green for all heading styles and opening-page headings without recolouring field labels', async function() {
    var colours = fs.readFileSync(path.join(__dirname, '../frontend/src/core/less/colours.less'), 'utf8');
    var match = /^@aleido-green:\s*#([0-9a-f]{6})\s*;/im.exec(colours);
    assert(match, '@aleido-green must define the Word heading colour');
    var colour = match[1].toUpperCase();
    var snapshot = fixture(), original = JSON.stringify(snapshot);
    var buffer = await generate(snapshot);
    var zip = await unzipper.Open.buffer(buffer);
    var stylesXml = (await zip.files.find(function(file) { return file.path === 'word/styles.xml'; }).buffer()).toString('utf8');
    var styles = new XMLParser({ ignoreAttributes: false }).parse(stylesXml)['w:styles']['w:style'];
    ['Title', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5'].forEach(function(id) {
      var heading = styles.find(function(style) { return style['@_w:styleId'] === id; });
      assert.strictEqual(heading['w:rPr']['w:color']['@_w:val'], colour, id);
    });
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    var paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g);
    ['Version history', 'Instructions for reviewing this document', 'Developer information', 'Terminology', 'Tags']
      .forEach(function(title) {
        var paragraph = paragraphs.find(function(paragraph) { return paragraph.includes('>' + title + '</w:t>'); });
        assert(paragraph && paragraph.includes('w:color w:val="' + colour + '"'), title);
      });
    ['Title', 'Body'].forEach(function(label) {
      var paragraph = paragraphs.find(function(paragraph) { return paragraph.includes('>' + label + '</w:t>'); });
      assert(paragraph.includes('w:color w:val="777777"'), label);
      assert(!paragraph.includes('w:color w:val="' + colour + '"'), label);
    });
    assert.strictEqual((await apply(await parse(buffer), snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('uses Calibri at 12 pt for document text and 8 pt for field labels, retaining heading sizes', async function() {
    var zip = await unzipper.Open.buffer(await generate(fixture()));
    var xml = (await zip.files.find(function(file) { return file.path === 'word/styles.xml'; }).buffer()).toString('utf8');
    var styles = new XMLParser({ ignoreAttributes: false }).parse(xml)['w:styles'];
    var defaults = styles['w:docDefaults']['w:rPrDefault']['w:rPr'];
    assert.strictEqual(defaults['w:rFonts']['@_w:ascii'], 'Calibri');
    assert.strictEqual(defaults['w:sz']['@_w:val'], '24');
    var labels = styles['w:style'].find(function(style) { return style['@_w:styleId'] === 'LightCourseFieldLabel'; });
    assert.strictEqual(labels['w:rPr']['w:rFonts']['@_w:ascii'], 'Calibri');
    assert.strictEqual(labels['w:rPr']['w:sz']['@_w:val'], '16');
    ['Title', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5'].forEach(function(id) {
      var heading = styles['w:style'].find(function(style) { return style['@_w:styleId'] === id; });
      assert.strictEqual(heading['w:rPr']['w:rFonts']['@_w:ascii'], 'Calibri');
    });
    ['Title', 'Heading1'].forEach(function(id) {
      var heading = styles['w:style'].find(function(style) { return style['@_w:styleId'] === id; });
      assert(Number(heading['w:rPr']['w:sz']['@_w:val']) > 24);
    });
  });

  it('puts retained settings and a read-only version-history table before editable content', async function() {
    var snapshot = fixture();
    snapshot.headerData = {
      versionHistory: [{ version: '1.2', date: '2026-11-06', author: 'Author', screens: 0, words: 123,
        notes: 'Version notes\nSecond line', duration: '10 minutes' }],
      reviewingInstructions: '<p>Review this course</p>',
      developerInfo: { navigationLinearity: 'nonlinear', layout: 'standard', tracking: 'both', reflectionNeeded: false },
      terminology: { section: 'Topic', course: 'Module', assessment: 'Quiz' },
      iconChoices: { menuButton: 'fa-bars', reflection: 'fa-pencil', help: 'fa-question', drawer: 'fa-info' }
    };
    snapshot.tags = [{ _id: 'shared-tag', title: 'Shared course tag' }];
    var original = JSON.stringify(snapshot);
    var buffer = await generate(snapshot);
    var zip = await unzipper.Open.buffer(buffer);
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    var contentStart = xml.indexOf('<w:bookmarkStart');
    var openingParagraphs = xml.slice(0, contentStart).match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g);
    ['Version history', 'Instructions for reviewing this document', 'Developer information', 'Terminology', 'Tags']
      .forEach(function(title) {
        var paragraph = openingParagraphs.find(function(paragraph) { return paragraph.includes('>' + title + '</w:t>'); });
        assert(paragraph && paragraph.includes('w:before="240"'), title);
      });
    ['Version history', 'Version notes', 'Second line', '10 minutes',
      'Review this course', 'nonlinear', 'standard', 'both', 'No', 'Topic', 'Module', 'Quiz', 'Shared course tag'].forEach(function(text) {
      assert(xml.indexOf(text) !== -1 && xml.indexOf(text) < contentStart, text);
    });
    ['Course details and settings (read-only)', 'The information in this section is for reference only',
      'Editable course content', 'Edit text within the labelled fields below', 'Buttons and icons',
      'Menu content', 'Plugin selections', 'fa-bars', 'Course introduction', 'boxmenu'].forEach(function(text) {
        assert(!xml.includes(text), text);
      });
    var tables = new XMLParser({ ignoreAttributes: false }).parse(xml)['w:document']['w:body']['w:tbl'];
    assert.strictEqual(tables.length, 3);
    var table = tables[0];
    assert.strictEqual(table['w:tr'].length, 2);
    table['w:tr'].forEach(function(row) { assert.strictEqual(row['w:tc'].length, 7); });
    assert(table['w:tr'][0]['w:trPr']['w:tblHeader'] !== undefined);
    assert.strictEqual(tables[1]['w:tr'].length, 5);
    assert.strictEqual(tables[2]['w:tr'].length, 4);
    tables.slice(1).forEach(function(settings) {
      settings['w:tr'].forEach(function(row) { assert.strictEqual(row['w:tc'].length, 2); });
    });
    assert(!xml.slice(0, contentStart).includes('<w:bookmarkStart'));
    assert(xml.slice(0, contentStart).includes('>0</w:t>'));
    var parsed = await parse(buffer);
    assert.strictEqual(parsed.courseDetailsReadOnly, true);
    assert.deepStrictEqual(parsed.courseFields, []);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('exports the effective editor defaults when developer information and terminology are unset', async function() {
    var snapshot = fixture();
    var original = JSON.stringify(snapshot);
    var zip = await unzipper.Open.buffer(await generate(snapshot));
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    var developer = xml.slice(xml.indexOf('Developer information'), xml.indexOf('>Tags</w:t>'));
    ['Navigation Linearity', 'linear', 'Layout', 'full', 'Tracking', 'assessment',
      'Reflection Needed', 'No', 'Terminology', 'Section', 'Course', 'Assessment'].forEach(function(text) {
        assert(developer.includes(text), text);
      });
    assert(!developer.includes('(not set)'));
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('uses terminology for page headings and installed component names without adding editable titles', async function() {
    var snapshot = fixture();
    snapshot.headerData = { terminology: { section: 'Topic' } };
    var block = snapshot.contentTree.children[0].children[0].children[0];
    block.children.push(Object.assign({}, component(snapshot), { _id: 'another-text', title: 'Another editable title' }));
    block.children.push(Object.assign({}, component(snapshot), { _id: 'splash', _component: 'splash', title: 'Splash editable title' }));
    snapshot.contentTree.children.push({ _id: 'another-page', type: 'page', title: 'Another page title', children: [] });
    var lookups = [];
    var namedDb = { retrieve: function(type, query, options, callback) {
      lookups.push(query.component);
      db.retrieve(type, query, options, function(error, results) {
        if (error) return callback(error);
        results[0].displayName = query.component === 'text' ? 'Rich Text' : 'Splash';
        callback(null, results);
      });
    } };
    var buffer = await new Promise(function(resolve, reject) {
      generator.generateDocx(snapshot, namedDb, function(error, value) { if (error) reject(error); else resolve(value); });
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.deepStrictEqual(parsed.blocks.filter(function(block) { return block.level === 1; })
      .map(function(block) { return block.heading; }), ['Topic 1', 'Topic 2']);
    assert.deepStrictEqual(parsed.blocks.filter(function(block) { return block.level === 4; })
      .map(function(block) { return block.heading; }), ['Rich Text', 'Rich Text', 'Splash']);
    assert.deepStrictEqual(lookups, ['text', 'splash']);
    assert.strictEqual(parsed.blocks[0].fields[0].value, 'First page');
    assert.strictEqual(parsed.blocks.find(function(block) { return block.id === 'splash'; }).fields
      .find(function(field) { return field.path === 'title'; }).value, 'Splash editable title');
    var original = JSON.stringify(snapshot);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('preserves empty fields when placeholders are untouched and imports reviewer replacements, including nested fields', async function() {
    var snapshot = fixture();
    snapshot.contentTree.children[0].title = '';
    snapshot.contentTree.children[0].instruction = '<p><br></p>';
    var node = component(snapshot);
    node.uniqueId = ' \t '; node.body = '<p>&nbsp;</p>'; node.instruction = ''; node._graphic.alt = '';
    snapshot.glossaryItems[0].description = '';
    var original = JSON.stringify(snapshot);
    var buffer = await generate(snapshot);
    var zip = await unzipper.Open.buffer(buffer);
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    ['Add title here', 'Add unique id here', 'Add body here', 'Add instruction here',
      'Add graphic alt here', 'Add items[0] body here', 'Add description here'].forEach(function(text) {
        assert(xml.includes(text), text);
      });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
    parsed = await edited(snapshot, function(xml) {
      xml = replaceField(xml, 'Title', 'Reviewer page title');
      xml = replaceField(xml, 'Unique Id', 'reviewer-1');
      xml = replaceField(xml, 'Body', 'Reviewer body');
      xml = replaceField(xml, 'Instruction', 'Reviewer instruction');
      xml = replaceField(xml, 'Graphic alt', 'Reviewer alt text');
      xml = replaceField(xml, 'Items[0] body', 'Reviewer nested body');
      return replaceField(xml, 'Description', 'Reviewer definition');
    });
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(snapshot.contentTree.children[0].title, 'Reviewer page title');
    assert.strictEqual(node.uniqueId, 'reviewer-1');
    assert.strictEqual(node.body, '<p>Reviewer body</p>');
    assert.strictEqual(snapshot.contentTree.children[0].instruction, '<p>Reviewer instruction</p>');
    assert.strictEqual(node._graphic.alt, 'Reviewer alt text');
    assert.strictEqual(node._items[0].body, '<p>Reviewer nested body</p>');
    assert.strictEqual(snapshot.glossaryItems[0].description, 'Reviewer definition');
    node.body = 'Add body here';
    assert.strictEqual((await apply(await parse(await generate(snapshot)), snapshot)).success, true);
    assert.strictEqual(node.body, 'Add body here');
  });

  it('imports inline unique IDs after collapsed bookmarks or appended text without importing their word count', async function() {
    for (var collapsed of [true, false]) {
      var snapshot = fixture();
      var parsed = await edited(snapshot, function(xml) {
        return xml.replace(/(<w:bookmarkStart[^>]*w:name="lcfield_1"[^>]*\/>)([\s\S]*?)(<w:bookmarkEnd[^>]*\/>)/,
          function(match, start, value, end) {
            return collapsed ? start + end + '<w:r><w:t>reviewer-1</w:t></w:r>' :
              match + '<w:r><w:t>-reviewed</w:t></w:r>';
          });
      });
      assert.deepStrictEqual(parsed.errors, []);
      assert.strictEqual((await apply(parsed, snapshot)).success, true);
      assert.strictEqual(component(snapshot).uniqueId, collapsed ? 'reviewer-1' : 'author-1-reviewed');
    }
    var snapshot = fixture(), original = JSON.stringify(snapshot);
    var parsed = await edited(snapshot, function(xml) { return xml.replace(/ \| \d+ words<\/w:t>/, ' | 999 words</w:t>'); });
    assert(parsed.errors.some(function(error) { return error.includes('component word count'); }));
    assert.strictEqual((await apply(parsed, snapshot)).success, false);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('ignores reviewer edits to developer and terminology table values', async function() {
    var snapshot = fixture();
    snapshot.headerData = { developerInfo: { navigationLinearity: 'nonlinear', reflectionNeeded: true },
      terminology: { section: 'Topic', course: 'Module' } };
    var original = JSON.stringify(snapshot);
    var parsed = await edited(snapshot, function(xml) {
      return xml.replace('>nonlinear</w:t>', '>linear</w:t>').replace('>Topic</w:t>', '>Section</w:t>')
        .replace('>Module</w:t>', '>Course</w:t>').replace('>Yes</w:t>', '>No</w:t>');
    });
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('still imports older review documents with one history table, standalone IDs and note-only placeholders', async function() {
    var snapshot = fixture();
    snapshot.glossaryItems = []; snapshot.resourceItems = []; snapshot.helpContent = {};
    var original = JSON.stringify(snapshot);
    var blocks = await new Promise(function(resolve, reject) {
      generator.collectDocumentBlocks(snapshot.contentTree, db, function(error, blocks) {
        if (error) reject(error); else resolve(blocks);
      }, { word: true, reviewLayout: true });
    });
    var metadata = { version: 2, sourceId: 'course-1', compactStructure: true, courseDetailsReadOnly: true,
      reviewLayout: true, versionHistoryTable: true, nodes: [], fields: [] };
    var paragraphs = [new docx.Paragraph({ heading: docx.HeadingLevel.TITLE, text: snapshot.title }),
      new docx.Table({ rows: [new docx.TableRow({ children: [new docx.TableCell({
        children: [new docx.Paragraph({ style: 'LightCourseReadOnly', text: 'Legacy history' })]
      })] })] })];
    var levels = [docx.HeadingLevel.HEADING_1, docx.HeadingLevel.HEADING_2,
      docx.HeadingLevel.HEADING_3, docx.HeadingLevel.HEADING_4];
    var uniqueParagraphIndex;
    blocks.forEach(function(block) {
      var name = 'lcnode_' + metadata.nodes.length;
      var hidden = block.level === 2 || block.level === 3;
      var heading = block.level === 1 ? 'Page 1: First page' : block.level === 4 ? 'text: Component title' : block.heading;
      metadata.nodes.push({ bookmark: name, id: block.id, level: block.level, heading: heading, hidden: hidden });
      if (hidden) return;
      paragraphs.push(new docx.Paragraph({ heading: levels[block.level - 1],
        children: [new docx.Bookmark({ id: name, children: [new docx.TextRun(heading)] })] }));
      block.fields.forEach(function(field) {
        var name = 'lcfield_' + metadata.fields.length;
        var placeholder = ['graphicsNotes', 'developerNotes'].indexOf(field.path) !== -1 && !field.text;
        metadata.fields.push({ bookmark: name, nodeId: block.id, path: field.path, placeholder: placeholder });
        if (field.path === 'uniqueId') uniqueParagraphIndex = paragraphs.length;
        paragraphs.push(new docx.Paragraph({ children: [new docx.Bookmark({ id: name,
          children: [new docx.TextRun(placeholder ? 'Add developer notes here' : wordFields.plainText(field.text))] })] }));
      });
    });
    var document = new docx.Document({ customProperties: [{ name: 'LightCourseWord', value: JSON.stringify(metadata) }],
      sections: [{ children: paragraphs }] });
    var parsed = await parse(await docx.Packer.toBuffer(document));
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
    var unique = metadata.fields.find(function(field) { return field.path === 'uniqueId'; });
    unique.inline = true;
    paragraphs[uniqueParagraphIndex] = new docx.Paragraph({ style: 'LightCourseFieldLabel', children: [
      new docx.TextRun('Unique Id: '),
      new docx.Bookmark({ id: unique.bookmark, children: [new docx.TextRun(component(snapshot).uniqueId)] })
    ] });
    var labelledDocument = new docx.Document({ customProperties: [{ name: 'LightCourseWord', value: JSON.stringify(metadata) }],
      sections: [{ children: paragraphs }] });
    parsed = await parse(await docx.Packer.toBuffer(labelledDocument));
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('starts editable content and each topic on a new page, without double breaks on the first topic', async function() {
    var snapshot = fixture();
    snapshot.contentTree.children.push({ _id: 'second-page', type: 'page', title: 'Second page', children: [] });
    var zip = await unzipper.Open.buffer(await generate(snapshot));
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    var paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g);
    var topics = paragraphs.filter(function(paragraph) { return paragraph.includes('w:val="Heading1"'); });
    assert.strictEqual(topics.length, 2);
    topics.forEach(function(paragraph) { assert(paragraph.includes('<w:pageBreakBefore')); });
    assert.strictEqual((xml.match(/<w:pageBreakBefore/g) || []).length, 2);
    assert.deepStrictEqual((await parse(await generate(snapshot))).errors, []);
    snapshot.contentTree.children = [];
    var fixedZip = await unzipper.Open.buffer(await generate(snapshot));
    var fixedXml = (await fixedZip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    assert(fixedXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
      .some(function(paragraph) { return paragraph.includes('>Glossary</w:t>') && paragraph.includes('<w:pageBreakBefore'); }));
  });

  it('puts component unique IDs above editable titles, spaces fields and italicises notes and empty placeholders', async function() {
    var snapshot = fixture();
    var original = JSON.stringify(snapshot);
    var zip = await unzipper.Open.buffer(await generate(snapshot));
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    var section = xml.slice(xml.indexOf('>Text</w:t>'));
    assert(section.indexOf('author-1') < section.indexOf('>Title</w:t>'));
    var paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g);
    var unique = paragraphs.find(function(paragraph) { return paragraph.includes('>author-1</w:t>'); });
    assert(unique.includes('>author-1</w:t>'));
    assert(unique.includes('w:val="LightCourseFieldLabel"'));
    var runs = unique.match(/<w:r>[\s\S]*?<\/w:r>/g);
    assert.strictEqual(runs.length, 2);
    runs.forEach(function(run) {
      assert(run.includes('w:ascii="Calibri"'));
      assert(run.includes('w:sz w:val="16"'));
      assert(run.includes('w:color w:val="777777"'));
      assert(run.includes('<w:b/>'));
    });
    ['Illustration notes', 'Add developer notes here'].forEach(function(text) {
      var paragraph = paragraphs.find(function(item) { return item.includes(text); });
      assert(paragraph.includes('<w:i/>'), text);
    });
    paragraphs.filter(function(paragraph) { return paragraph.includes('w:name="lcfield_'); })
      .forEach(function(paragraph) { assert(paragraph.includes('w:after="240"')); });
    assert.strictEqual((await apply(await parse(await generate(snapshot)), snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
    var parsed = await edited(snapshot, function(xml) {
      return replaceField(xml, 'Developer Notes', 'Reviewer developer notes');
    });
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot).developerNotes, '<p>Reviewer developer notes</p>');
    component(snapshot).graphicsNotes = '';
    parsed = await edited(snapshot, function(xml) {
      return replaceField(xml, 'Graphics Notes', 'Reviewer graphics notes');
    });
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot).graphicsNotes, '<p>Reviewer graphics notes</p>');
  });

  it('displays the exact core component word count beside its ID without counting notes, IDs or placeholders', async function() {
    var snapshot = fixture(), node = component(snapshot);
    node.uniqueId = 'c-01_01_010'; node.title = ''; node.body = 'word '.repeat(100);
    node._items = []; node._graphic.alt = ''; node.developerNotes = 'Not course content';
    var counts = await new Promise(function(resolve, reject) {
      wordcount.computeWordCount(snapshot, db, function(error, counts) { if (error) reject(error); else resolve(counts); });
    });
    assert.strictEqual(counts.componentWords, 100);
    var original = JSON.stringify(snapshot);
    var zip = await unzipper.Open.buffer(await generate(snapshot));
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    var paragraph = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
      .find(function(paragraph) { return paragraph.includes('>c-01_01_010</w:t>'); });
    assert(paragraph.includes('> | 100 words</w:t>'));
    assert(!xml.includes('Unique Id: '));
    assert.strictEqual((await apply(await parse(await generate(snapshot)), snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
    var parsed = await edited(snapshot, function(xml) {
      return replaceField(xml.replace(' | 100 words', ' | 999 words'), 'Body', 'Do not partially import');
    });
    assert(parsed.errors.some(function(error) { return error.includes('component word count'); }));
    assert.strictEqual((await apply(parsed, snapshot)).success, false);
    assert.strictEqual(JSON.stringify(snapshot), original);
    node._component = '';
    zip = await unzipper.Open.buffer(await generate(snapshot));
    xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    assert(xml.includes('> | 0 words</w:t>'));
    assert.strictEqual((await apply(await parse(await generate(snapshot)), snapshot)).success, true);
  });

  it('enables Track Changes by default while allowing clean imports and rejecting unaccepted revisions', async function() {
    var snapshot = fixture(), original = JSON.stringify(snapshot);
    var buffer = await generate(snapshot);
    var zip = await unzipper.Open.buffer(buffer);
    var settings = (await zip.files.find(function(file) { return file.path === 'word/settings.xml'; }).buffer()).toString('utf8');
    assert(/<w:trackRevisions(?:\s+w:val="(?:true|1)")?\s*\/>/.test(settings));
    assert.strictEqual((await apply(await parse(buffer), snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
    var parsed = await edited(snapshot, function(xml) {
      var text = xml.indexOf('>Original body.</w:t>');
      assert(text !== -1);
      var start = xml.lastIndexOf('<w:r>', text), end = xml.indexOf('</w:r>', text) + 6;
      return xml.slice(0, start) + '<w:ins w:id="999" w:author="Reviewer">' +
        xml.slice(start, end) + '</w:ins>' + xml.slice(end);
    });
    assert(parsed.errors.some(function(error) { return error.includes('Accept or reject tracked changes'); }));
    assert.strictEqual((await apply(parsed, snapshot)).success, false);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('ignores edited read-only table values and rejects editable tables or bookmarks hidden in the history table', async function() {
    var snapshot = fixture();
    snapshot.headerData = { versionHistory: [{ version: '1.0', notes: 'Original version notes' }] };
    var original = JSON.stringify(snapshot);
    var parsed = await edited(snapshot, function(xml) { return xml.replace('Original version notes', 'Edited read-only notes'); });
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
    parsed = await edited(snapshot, function(xml) {
      return xml.replace('Original version notes',
        'Original version notes</w:t></w:r><w:bookmarkStart w:name="_GoBack" w:id="999"/><w:bookmarkEnd w:id="999"/><w:r><w:t>');
    });
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
    parsed = await edited(snapshot, function(xml) {
      return xml.replace('<w:tbl>', '<w:tbl><w:ins w:id="999"/>');
    });
    assert(parsed.errors.some(function(error) { return error.includes('tracked changes'); }));
    assert.strictEqual((await apply(parsed, snapshot)).success, false);
    assert.strictEqual(JSON.stringify(snapshot), original);
    for (var edit of [
      function(xml) { return xml.replace('</w:body>', '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>New table</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>'); },
      function(xml) { return xml.replace('Original version notes', 'Original version notes</w:t></w:r><w:bookmarkStart w:name="lcfield_999" w:id="999"/><w:r><w:t>'); }
    ]) {
      assert.strictEqual((await apply(await edited(snapshot, edit), snapshot)).success, false);
      assert.strictEqual(JSON.stringify(snapshot), original);
    }
  });

  ['Section 1', 'Text'].forEach(function(heading) {
    it('rejects an edited contextual heading without changing any content: ' + heading, async function() {
      var snapshot = fixture();
      var original = JSON.stringify(snapshot);
      var parsed = await edited(snapshot, function(xml) {
        return replaceField(xml.replace(heading, 'Changed contextual heading'), 'Body', 'Do not partially import this');
      });
      var result = await apply(parsed, snapshot);
      assert.strictEqual(result.success, false);
      assert(result.errors.some(function(error) { return error.includes('labelled title field'); }));
      assert.strictEqual(JSON.stringify(snapshot), original);
    });
  });

  it('ignores changes to read-only details while importing editable component text and retaining live settings', async function() {
    var snapshot = fixture();
    snapshot.tags = [{ _id: 'shared-tag', title: 'Shared course tag' }];
    snapshot.headerData = { reviewingInstructions: 'Original review', developerInfo: { reflectionNeeded: true } };
    var parsed = await edited(snapshot, function(xml) {
      return replaceField(xml.replace(/Course title/g, 'Changed read-only title')
        .replace('Course introduction', 'Changed menu body').replace('Original review', 'Changed review')
        .replace('boxmenu', 'Different menu').replace('Shared course tag', 'Do not import tag edits')
        .replace('>Yes</w:t>', '>No</w:t>'), 'Body', 'Changed component');
    });
    snapshot.title = 'Live course title';
    snapshot.body = '<p>Live menu body</p>';
    snapshot.headerData.reviewingInstructions = 'Live review';
    snapshot.pluginSelections.theme = 'Live theme';
    snapshot.tags = [{ _id: 'live-tag', title: 'Live course tag' }];
    var header = JSON.stringify(snapshot.headerData), plugins = JSON.stringify(snapshot.pluginSelections);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(snapshot.title, 'Live course title');
    assert.strictEqual(snapshot.body, '<p>Live menu body</p>');
    assert.strictEqual(JSON.stringify(snapshot.headerData), header);
    assert.strictEqual(JSON.stringify(snapshot.pluginSelections), plugins);
    assert.deepStrictEqual(snapshot.tags, [{ _id: 'live-tag', title: 'Live course tag' }]);
    assert.strictEqual(component(snapshot).body, '<p>Changed component</p><p>Second paragraph.</p>');
  });

  it('continues importing older mapped documents that contain article and block fields', async function() {
    var snapshot = {
      title: 'Course', body: 'Course introduction', contentTree: { children: [{ _id: 'p', type: 'page', title: 'Page', children: [
        { _id: 'a', type: 'article', title: 'Article', children: [
          { _id: 'b', type: 'block', title: 'Block', children: [
            { _id: 'c', type: 'component', _component: 'text', title: 'Component', body: 'Body' }
          ] }
        ] }
      ] }] }, glossaryItems: [], resourceItems: [], helpContent: {}
    };
    var blocks = await new Promise(function(resolve, reject) {
      generator.collectDocumentBlocks(snapshot.contentTree, db, function(error, blocks) {
        if (error) reject(error); else resolve(blocks);
      }, { word: true });
    });
    var metadata = { version: 2, sourceId: 'course-1', nodes: [], fields: [] };
    var paragraphs = [];
    function field(nodeId, field, heading) {
      var name = 'lcfield_' + metadata.fields.length;
      metadata.fields.push({ bookmark: name, nodeId: nodeId, path: field.path });
      paragraphs.push(new docx.Paragraph({ heading: heading,
        children: [new docx.Bookmark({ id: name, children: [new docx.TextRun(field.text)] })] }));
    }
    field(null, { path: 'title', text: snapshot.title }, docx.HeadingLevel.TITLE);
    field(null, { path: 'body', text: snapshot.body });
    var levels = [docx.HeadingLevel.HEADING_1, docx.HeadingLevel.HEADING_2,
      docx.HeadingLevel.HEADING_3, docx.HeadingLevel.HEADING_4];
    blocks.forEach(function(block) {
      var name = 'lcnode_' + metadata.nodes.length;
      metadata.nodes.push({ bookmark: name, id: block.id, level: block.level, heading: block.heading });
      paragraphs.push(new docx.Paragraph({ heading: levels[block.level - 1],
        children: [new docx.Bookmark({ id: name, children: [new docx.TextRun(block.heading)] })] }));
      block.fields.forEach(function(item) { field(block.id, item); });
    });
    var document = new docx.Document({
      customProperties: [{ name: 'LightCourseWord', value: JSON.stringify(metadata) }],
      sections: [{ children: paragraphs }]
    });
    var parsed = await parse(await docx.Packer.toBuffer(document));
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.compactStructure, false);
    parsed.courseFields[0].value = 'Ignored old-format course title';
    parsed.courseFields[1].value = 'Ignored old-format menu body';
    parsed.blocks.find(function(block) { return block.id === 'a'; }).fields[0].value = 'Edited article';
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(snapshot.contentTree.children[0].children[0].title, 'Edited article');
    assert.strictEqual(snapshot.title, 'Course');
    assert.strictEqual(snapshot.body, 'Course introduction');
  });

  it('preserves numeric-looking text, zero, false and leading zeros exactly', async function() {
    var snapshot = fixture();
    snapshot.title = '0';
    component(snapshot).title = 'false';
    component(snapshot).body = '<p>000</p>';
    var original = JSON.stringify(snapshot);
    var parsed = await parse(await generate(snapshot));
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('omits article/block sections and styles labels grey without losing underlying structure or values', async function() {
    var snapshot = fixture();
    snapshot.contentTree.children[0].children[0].title = 'Hidden article title';
    snapshot.contentTree.children[0].children[0].children[0].title = 'Hidden block title';
    var original = JSON.stringify(snapshot);
    var buffer = await generate(snapshot);
    var zip = await unzipper.Open.buffer(buffer);
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
    assert(!xml.includes('Article 1.1'));
    assert(!xml.includes('Block 1.1.1'));
    assert(!xml.includes('Hidden article title'));
    assert(!xml.includes('Hidden block title'));
    assert(!xml.includes('Article instruction'));
    assert(xml.includes('w:color w:val="777777"'));
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  [['page', 'lcfield_0', 'Renamed page']].forEach(function(test) {
    it('accepts a replaced ' + test[0] + ' title when Word collapses its bookmark', async function() {
      var snapshot = fixture();
      var parsed = await edited(snapshot, function(xml) {
        var pattern = new RegExp('(<w:bookmarkStart[^>]*w:name="' + test[1] + '"[^>]*/>)([\\s\\S]*?)(<w:bookmarkEnd[^>]*/>)');
        assert(pattern.test(xml));
        return xml.replace(pattern, function(match, start, content, end) {
          return start + end + '<w:r><w:t>' + test[2] + '</w:t></w:r>';
        });
      });
      assert.deepStrictEqual(parsed.errors, []);
      assert.strictEqual((await apply(parsed, snapshot)).success, true);
      assert.strictEqual(test[0] === 'page' ? snapshot.contentTree.children[0].title : snapshot.title, test[2]);
    });
  });

  it('accepts text appended just after a title bookmark within the same editable paragraph', async function() {
    var snapshot = fixture();
    var parsed = await edited(snapshot, function(xml) {
      var pattern = /(<w:bookmarkStart[^>]*w:name="lcfield_0"[^>]*\/>[\s\S]*?<w:bookmarkEnd[^>]*\/>)/;
      return xml.replace(pattern, '$1<w:r><w:t> - updated</w:t></w:r>');
    });
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(snapshot.contentTree.children[0].title, 'First page - updated');
  });

  it('keeps the complete snapshot unchanged, including HTML, empty values, media, IDs and presets', async function() {
    var snapshot = fixture();
    var original = JSON.stringify(snapshot);
    var parsed = await parse(await generate(snapshot));
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.sourceId, 'course-1');
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  function amd(filename, origin, globals, dependencies) {
    var exported;
    var base = { extend: function(methods) {
      function View() {}
      View.prototype = methods;
      return View;
    }, prototype: { remove: function() {} } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/src/modules/lightCourseEditor/views/', filename), 'utf8'),
      Object.assign({
        define: function(factory) {
          exported = factory(function(name) {
            return dependencies && dependencies[name] || (name === 'core/origin' ? origin : base);
          });
        }, _: _
      }, globals));
    return exported;
  }
  function wordUI() {
    var state = { status: '', requests: [], confirms: [], downloads: [], events: [], bump: 'minor' };
    var origin = {
      sessionModel: { get: function() { return 'tenant-1'; } },
      l10n: { t: function(key) { return key; } },
      trigger: function(event) { state.events.push(event); },
      Notify: { confirm: function(options) { state.confirms.push(options); }, alert: function() {} }
    };
    var globals = {
      XMLHttpRequest: function() {
        state.requests.push(this);
        this.open = function(method, url) { this.url = url; };
        this.getResponseHeader = function() { return state.disposition || null; };
        this.send = function() {};
        this.abort = function() {};
      },
      FileReader: function() {
        this.readAsText = function(value) { this.result = value; this.onload(); };
      },
      FormData: function() {
        this.values = {};
        this.append = function(key, value) { this.values[key] = value; };
      },
      URL: { createObjectURL: function() { return 'blob:word'; }, revokeObjectURL: function() {} },
      document: {
        createElement: function() { return { click: function() { state.downloads.push(this); } }; },
        body: { appendChild: function() {}, removeChild: function() {} }
      },
      setTimeout: function(callback) { callback(); },
      $: { ajax: function(options) {
        var request = { options: options,
          done: function(callback) { this.success = callback; return this; },
          fail: function(callback) { this.failure = callback; return this; },
          abort: function() {} };
        state.requests.push(request);
        return request;
      } }
    };
    var exportWord = amd('../wordExport.js', origin, globals);
    var View = amd('lightCourseWordView.js', origin, globals, { '../wordExport': exportWord });
    var view = Object.create(View.prototype);
    view.$el = { attr: function() {} };
    var attributes = { _id: 'course-1', title: 'Course', revision: 7 };
    view.model = { get: function(key) { return attributes[key]; }, isLocked: function() { return false; },
      fetch: function(options) { state.fetch = options; } };
    view.$ = function(selector) {
      if (selector === '.light-course-word-file') return [{ files: [state.file || { name: 'course.docx' }] }];
      var element = {
        prop: function(key, value) { if (key === 'hidden') state.errorHidden = value; return element; },
        val: function() { return state.bump; },
        text: function(text) { state.status = text; return element; }
      };
      return element;
    };
    view.prepare = function(callback) { state.prepared = callback; };
    view.onImported = function() { state.imported = true; };
    state.view = view;
    return state;
  }
  var click = { preventDefault: function() {} };

  describe('Word editor controls (isolated)', function() {
    it('requires an explicit version choice and retains a major choice through confirmation', function() {
      var state = wordUI();
      state.bump = '';
      state.view.confirmImport(click);
      assert.strictEqual(state.confirms.length, 0);
      assert.strictEqual(state.status, 'app.lightcoursewordchooseversion');
      state.bump = 'major';
      state.view.confirmImport(click);
      state.confirms[0].callback(true);
      state.prepared();
      assert.strictEqual(state.requests[0].options.data.values.bump, 'major');
      state.requests[0].failure({ status: 409, responseJSON: { requiresConfirmation: true, message: 'Confirm' } });
      state.confirms[1].callback(true);
      assert.strictEqual(state.requests[1].options.data.values.bump, 'major');
    });

    it('waits for saving, uses the session tenant, downloads DOCX and surfaces export failures', function() {
      var state = wordUI();
      state.view.exportWord(click);
      assert.strictEqual(state.requests.length, 0);
      assert.strictEqual(state.status, '');
      assert.strictEqual(state.errorHidden, true);
      state.prepared();
      var request = state.requests[0];
      assert.strictEqual(request.url, 'document-export/tenant-1/course-1?format=docx');
      request.status = 200;
      request.response = 'word blob';
      request.onload();
      assert.strictEqual(state.downloads[0].download, 'Course_vdraft.docx');
      assert.strictEqual(state.view.busy, false);
      assert(state.events.includes('modal:onCancel'));
      state.events = [];
      state.view.exportWord(click);
      state.prepared();
      request = state.requests[1];
      request.status = 403;
      request.response = '{"message":"Not permitted"}';
      request.onload();
      assert.strictEqual(state.status, 'Not permitted');
      assert.strictEqual(state.errorHidden, false);
      assert(!state.events.includes('modal:onCancel'));
      assert.strictEqual(state.downloads.length, 1);
    });

    it('uses server-provided versioned filenames for historical exports, including Unicode course names', function() {
      var state = wordUI();
      state.disposition = 'attachment; filename="Old course_v0.1.docx"';
      state.view.exportWord(click);
      state.prepared();
      state.requests[0].status = 200;
      state.requests[0].onload();
      assert.strictEqual(state.downloads[0].download, 'Old course_v0.1.docx');
      state.disposition = "attachment; filename=\"-ld course_v1.0.docx\"; filename*=UTF-8''%C3%96ld%20course_v1.0.docx";
      state.view.exportWord(click);
      state.prepared();
      state.requests[1].status = 200;
      state.requests[1].onload();
      assert.strictEqual(state.downloads[1].download, '\u00d6ld course_v1.0.docx');
    });

    it('prefixes fallback filenames with tag titles, preserving underscores and sanitising unsafe characters', function() {
      [
        [[], 'Course_v1.2.docx'],
        [[{ title: 'Safety' }, { title: 'Induction' }], 'Safety_Induction_Course_v1.2.docx'],
        [[{ title: ' /tag? ' }, { title: '\u00d6ld_tag' }, { title: ' ' }], '-tag-_\u00d6ld_tag_Course_v1.2.docx']
      ].forEach(function(test) {
        var state = wordUI(), get = state.view.model.get;
        state.view.model.get = function(key) {
          return key === 'tags' ? test[0] : key === 'currentVersionNumber' ? '1.2' : get(key);
        };
        state.view.exportWord(click);
        state.prepared();
        state.requests[0].status = 200;
        state.requests[0].onload();
        assert.strictEqual(state.downloads[0].download, test[1]);
      });
    });

    it('shows an export error rather than leaving the modal busy when the filename header is malformed', function() {
      var state = wordUI();
      state.disposition = "attachment; filename*=UTF-8''%broken";
      state.view.exportWord(click);
      state.prepared();
      state.requests[0].status = 200;
      state.requests[0].onload();
      assert.strictEqual(state.downloads.length, 0);
      assert.strictEqual(state.status, 'app.errorgeneric');
      assert.strictEqual(state.view.busy, false);
      assert(!state.events.includes('modal:onCancel'));
    });

    it('requires a DOCX and confirmation; sends revision and refreshes only after successful import', function() {
      var state = wordUI();
      state.file = { name: 'wrong.pdf' };
      state.view.confirmImport(click);
      assert.strictEqual(state.confirms.length, 0);
      state.file = { name: 'course.docx' };
      state.view.confirmImport(click);
      state.confirms[0].callback(false);
      assert.strictEqual(state.requests.length, 0);
      state.view.confirmImport(click);
      state.confirms[1].callback(true);
      state.prepared();
      var request = state.requests[0];
      assert.strictEqual(request.options.data.values.revision, 7);
      assert.strictEqual(request.options.data.values.bump, 'minor');
      assert.strictEqual(request.options.contentType, false);
      request.failure({ status: 409, responseJSON: { requiresConfirmation: true, message: 'Overwrite draft?' } });
      state.confirms[2].callback(true);
      request = state.requests[1];
      assert.strictEqual(request.options.data.values.confirmed, 'true');
      assert.strictEqual(request.options.data.values.bump, 'minor');
      request.success({ version: { versionNumber: '1.3' } });
      assert.strictEqual(state.imported, undefined);
      state.fetch.success();
      assert.strictEqual(state.imported, true);
      assert(state.events.includes('modal:onCancel'));
    });

    it('shows all structural errors and does not start work after disposal or failed saving', function() {
      var state = wordUI();
      state.view.upload({ name: 'course.docx' }, true);
      state.requests[0].failure({ status: 422, responseJSON: { errors: ['Missing field', 'Changed section'] } });
      assert.strictEqual(state.status, 'Missing field\nChanged section');
      assert.strictEqual(state.errorHidden, false);
      assert(!state.events.includes('modal:onCancel'));
      assert.strictEqual(state.imported, undefined);
      state.view.exportWord(click);
      state.prepared({ responseJSON: { message: 'Save failed' } });
      assert.strictEqual(state.requests.length, 1);
      assert.strictEqual(state.status, 'Save failed');
      state.view.exportWord(click);
      state.view.remove();
      state.prepared();
      assert.strictEqual(state.requests.length, 1);
    });
  });

  describe('saving before Word operations (isolated)', function() {
    function editor() {
      var origin = { l10n: { t: function(key) { return key; } } };
      var View = amd('lightCourseEditorView.js', origin);
      var view = Object.create(View.prototype);
      var attrs = { title: 'First', revision: 0 };
      var state = { saves: [], fetches: [], view: view, attrs: attrs };
      view.model = {
        get: function(key) { return attrs[key]; },
        set: function(data) { Object.assign(attrs, data); },
        save: function(data, options) { state.saves.push({ data: data, options: options }); },
        fetch: function(options) { state.fetches.push(options); }
      };
      view.assembleSaveData = function() { return Object.assign({}, attrs); };
      view.setSaveStatus = view.hideConflictBanner = function() {};
      view.onSaveError = function() { state.failed = true; };
      return state;
    }

    it('waits for trailing saves and keeps edits made during the first save/fetch', function() {
      var state = editor();
      var finished = 0;
      state.view.autosave();
      state.attrs.title = 'Second';
      state.view.autosave(function(error) { assert(!error); finished++; });
      Object.assign(state.attrs, state.saves[0].data);
      state.saves[0].options.success();
      Object.assign(state.attrs, { title: 'First', revision: 1 });
      state.fetches[0].success();
      assert.strictEqual(finished, 0);
      assert.strictEqual(state.saves[1].data.title, 'Second');
      assert.strictEqual(state.saves[1].data.revision, 1);
      state.saves[1].options.success();
      state.attrs.revision = 2;
      state.fetches[1].success();
      assert.strictEqual(finished, 1);
    });

    it('fails the waiting operation when revision refresh fails', function() {
      var state = editor();
      var error = { status: 500 };
      var received;
      state.view.autosave(function(value) { received = value; });
      state.saves[0].options.success();
      state.fetches[0].error(state.view.model, error);
      assert.strictEqual(received, error);
      assert.strictEqual(state.failed, true);
      assert.strictEqual(state.view._autosaveInFlight, false);
    });
  });

  function importRoute(fields, parsed) {
    fields = Object.assign({ bump: 'minor' }, fields);
    return new Promise(function(resolve) {
      var state = { cleaned: [], updates: [], imports: [] };
      var draft = Object.assign(fixture(), { revision: 7 });
      var route;
      var app = { contentmanager: {
        getContentPlugin: function(type, callback) {
          callback(null, {
            hasPermission: function(action, user, tenant, record, next) { next(null, true); },
            importVersion: function(db, draft, snapshot, bump, next) {
              state.imports.push({ revision: draft.revision, snapshot: snapshot, bump: bump });
              next(null, { versionNumber: bump === 'minor' ? '0.1' : '1.0' });
            }
          });
        },
        update: function(type, search, delta, callback) { state.updates.push(delta); callback(null, delta); }
      }, polyglot: { t: function(key) { return key; } } };
      var mocks = {
        fs: { readFileSync: function() { return Buffer.from('upload'); },
          unlink: function(filename, callback) { state.cleaned.push(filename); callback(); } },
        formidable: { IncomingForm: function() {
          this.on = function(event, callback) { this.fileBegin = callback; };
          this.parse = function(req, callback) {
            var file = { path: '/temporary/word-upload', name: 'course.docx' };
            this.fileBegin('file', file);
            callback(null, fields, { file: file });
          };
        } },
        express: function() { return { post: function(pattern, handler) { route = handler; } }; },
        '../../lib/permissions': { ignoreRoute: function() {} },
        '../../lib/configuration': { getMaxFileUploadSize: function() { return 1024; } },
        '../../lib/logger': { log: function() {} },
        '../../lib/usermanager': { getCurrentUser: function() { return { _id: 'user', tenant: { _id: 'tenant-1' } }; } },
        '../../lib/database': { getDatabase: function(callback) {
          callback(null, { retrieve: function(type, search, options, next) { next(null, type === 'lightcourse' ? [draft] : []); } });
        } },
        '../../': function() { return app; },
        '../../lib/contentmanager': { errors: {} },
        '../../lib/lightcourse/documentGenerator': { parseDocx: function(buffer, callback) { callback(null, parsed); } },
        '../../lib/lightcourse/documentImport': { importDocument: function(value, snapshot, db, callback) {
          component(snapshot).body = '<p>Imported component text</p>';
          callback(null, { success: true, snapshot: snapshot });
        } },
        '../../lib/lightcourse/versionDiff': {}
      };
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/document-import/index.js'), 'utf8'), {
        module: { exports: {} }, require: function(name) { assert(name in mocks, name); return mocks[name]; }, Buffer: Buffer
      });
      var response = new EventEmitter();
      response.status = function(code) { state.status = code; return this; };
      response.json = function(body) { state.body = body; this.emit('finish'); resolve(state); };
      route({ params: { tenant: 'tenant-1', lightCourseId: 'course-1' } }, response);
    });
  }

  describe('Word import route (isolated)', function() {
    it('rejects stale revisions and wrong-course mappings before updating, and cleans both uploads', async function() {
      var stale = await importRoute({ format: 'docx', revision: '6', confirmed: 'true' }, { formatVersion: 2, sourceId: 'course-1' });
      assert.strictEqual(stale.status, 409);
      assert.strictEqual(stale.updates.length, 0);
      assert.deepStrictEqual(stale.cleaned, ['/temporary/word-upload']);
      var wrong = await importRoute({ format: 'docx', revision: '7', confirmed: 'true' }, { formatVersion: 2, sourceId: 'another-course' });
      assert.strictEqual(wrong.status, 422);
      assert.strictEqual(wrong.updates.length, 0);
      assert.strictEqual(wrong.cleaned.length, 1);
    });

    it('creates the chosen version from editable component text while retaining course details', async function() {
      var result = await importRoute({ format: 'docx', revision: '7', confirmed: 'true' }, { formatVersion: 2, sourceId: 'course-1' });
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.updates.length, 0);
      assert.strictEqual(result.imports[0].snapshot.title, 'Course title');
      assert.strictEqual(result.imports[0].snapshot.body, '<p>Course introduction</p>');
      assert.strictEqual(component(result.imports[0].snapshot).body, '<p>Imported component text</p>');
      assert.strictEqual(result.imports[0].revision, 7);
      assert.strictEqual(result.imports[0].bump, 'minor');
      assert.strictEqual(result.body.version.versionNumber, '0.1');
      assert.strictEqual(result.cleaned.length, 1);
    });

    it('accepts a major version and rejects a missing or invalid version choice', async function() {
      var major = await importRoute({ format: 'docx', revision: '7', confirmed: 'true', bump: 'major' }, { formatVersion: 2, sourceId: 'course-1' });
      assert.strictEqual(major.body.version.versionNumber, '1.0');
      for (var bump of [undefined, 'invalid']) {
        var result = await importRoute({ format: 'docx', revision: '7', confirmed: 'true', bump: bump }, {});
        assert.strictEqual(result.status, 400);
        assert.strictEqual(result.imports.length, 0);
        assert.strictEqual(result.cleaned.length, 1);
      }
    });

    it('requires explicit draft confirmation before applying a Word import', async function() {
      var result = await importRoute({ format: 'docx', revision: '7' }, { formatVersion: 2, sourceId: 'course-1' });
      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.body.requiresConfirmation, true);
      assert.strictEqual(result.updates.length, 0);
      assert.strictEqual(result.cleaned.length, 1);
    });
  });

  it('maps multiline paragraphs, blank clears, page titles, nested items and popup instructions without changing course details', async function() {
    var snapshot = fixture();
    var parsed = await edited(snapshot, function(xml) {
      xml = replaceField(xml, 'Body', 'Changed &lt;literal&gt;</w:t></w:r></w:p><w:p><w:r><w:t>New paragraph');
      return xml;
    });
    assert.deepStrictEqual(parsed.errors, []);
    var fields = parsed.blocks.find(function(block) { return block.id === 'component-1'; }).fields;
    assert.strictEqual(fields.find(function(field) { return field.path === 'body'; }).value,
      'Changed <literal>\nNew paragraph\nSecond paragraph.');
    fields.find(function(field) { return field.path === 'body'; }).value = '';
    fields.find(function(field) { return field.path === '_items[0].body'; }).value = 'First line\nSecond line';
    parsed.blocks[0].fields.find(function(field) { return field.path === 'title'; }).value = 'Renamed page';
    parsed.blocks.find(function(block) { return block.id === 'help-popup'; }).fields
      .find(function(field) { return field.path === 'instruction'; }).value = 'Revised help';
    var result = await apply(parsed, snapshot);
    assert.deepStrictEqual(result.errors || [], []);
    assert.strictEqual(snapshot.body, '<p>Course introduction</p>');
    assert.strictEqual(snapshot.title, 'Course title');
    assert.strictEqual(snapshot.contentTree.children[0].title, 'Renamed page');
    assert.strictEqual(snapshot.contentTree.children[0].children[0].instruction, 'Article instruction');
    assert.strictEqual(component(snapshot).instruction, '');
    assert.strictEqual(component(snapshot).body, '');
    assert.strictEqual(component(snapshot)._items[0].body, '<p>First line</p><p>Second line</p>');
    assert.strictEqual(snapshot.helpContent.popup.instruction, '<p>Revised help</p>');
    assert.strictEqual(component(snapshot)._componentPresetId, 'preset-1');
  });

  [
    ['missing field', function(xml) { return xml.replace(/w:name="lcfield_0"/, 'w:name="removed"'); }],
    ['duplicate field', function(xml) { return xml.replace(/w:name="lcfield_1"/, 'w:name="lcfield_0"'); }],
    ['unknown marker', function(xml) { return xml.replace(/w:name="lcfield_0"/, 'w:name="lcfield_unknown"'); }],
    ['missing section', function(xml) { return xml.replace(/w:name="lcnode_0"/, 'w:name="removed"'); }],
    ['changed level', function(xml) { return xml.replace('w:val="Heading1"', 'w:val="Heading2"'); }],
    ['edited read-only heading', function(xml) { return xml.replace('Section 1', 'Section 1: Different heading'); }],
    ['malformed XML', function(xml) { return xml.replace('</w:body>', '</w:broken>'); }],
    ['tracked changes', function(xml) { return xml.replace('<w:t xml:space="preserve">Course title</w:t>', '<w:ins><w:t>Changed title</w:t></w:ins>'); }],
    ['text outside fields', function(xml) { return xml.replace('</w:body>', '<w:p><w:r><w:t>Outside</w:t></w:r></w:p></w:body>'); }]
  ].forEach(function(test) {
    it('rejects ' + test[0] + ' without partially applying changes', async function() {
      var snapshot = fixture();
      var original = JSON.stringify(snapshot);
      var result = await apply(await edited(snapshot, test[1]), snapshot);
      assert.strictEqual(result.success, false, test[0]);
      assert(result.errors.length);
      assert.strictEqual(JSON.stringify(snapshot), original);
    });
  });

  it('rejects reordered sections and uploaded arbitrary field paths atomically', async function() {
    var snapshot = fixture();
    var original = JSON.stringify(snapshot);
    var parsed = await parse(await generate(snapshot));
    parsed.blocks.reverse();
    assert.strictEqual((await apply(parsed, snapshot)).success, false);
    parsed.blocks.reverse();
    parsed.blocks[0].fields[0].path = '__proto__.polluted';
    assert.strictEqual((await apply(parsed, snapshot)).success, false);
    assert.strictEqual(JSON.stringify(snapshot), original);
    assert.strictEqual({}.polluted, undefined);
  });

  it('rejects attempts to import course settings as editable fields atomically', async function() {
    var snapshot = fixture();
    var parsed = await parse(await generate(snapshot));
    parsed.courseFields.push({ path: 'headerData.reviewingInstructions', value: 'Override' });
    component(snapshot).body = 'Original current body';
    var original = JSON.stringify(snapshot);
    assert.strictEqual((await apply(parsed, snapshot)).success, false);
    assert.strictEqual(JSON.stringify(snapshot), original);
  });

  it('exports draft and historical settings through the route without mixing the two snapshots', async function() {
    var draft = Object.assign(fixture(), { _id: 'course-1', currentVersionNumber: '2.0',
      tags: [{ _id: 'current-tag', title: 'Current course tag' }, { _id: 'review-tag', title: 'Review / "tag"' }],
      headerData: { reviewingInstructions: 'Current review' }, pluginSelections: { theme: 'Current theme' } });
    var oldSnapshot = Object.assign(fixture(), { title: 'Old course',
      tags: [{ _id: 'old-tag', title: 'Old course tag' }, { _id: 'unicode-tag', title: '\u00d6ld tag' }],
      pluginSelections: { theme: 'Old theme' } });
    var saved = { _id: 'version-1', _lightCourseId: draft._id, versionNumber: '0.1',
      contentSnapshot: oldSnapshot, headerSnapshot: { reviewingInstructions: 'Old review' } };
    var legacy = Object.assign({}, saved, { _id: 'legacy-version', contentSnapshot: _.omit(oldSnapshot, 'title') });
    var unicode = Object.assign({}, saved, { _id: 'unicode-version', versionNumber: '1.2',
      contentSnapshot: Object.assign({}, oldSnapshot, { title: '\u00d6ld / course' }) });
    var orphan = Object.assign({}, legacy, { _id: 'orphan-version', _lightCourseId: 'missing-course' });
    var untagged = Object.assign({}, saved, { _id: 'untagged-version', contentSnapshot: _.omit(oldSnapshot, 'tags') });
    var unpublished = Object.assign({}, draft, { _id: 'unpublished', currentVersionNumber: undefined });
    for (var id of ['course-1', 'version-1', 'legacy-version', 'unicode-version', 'unpublished', 'untagged-version', 'orphan-version']) {
      var route, persisted = undefined, headers = {};
      var routeDb = { retrieve: function(type, query, options, callback) {
        if (type === 'componenttype') return db.retrieve(type, query, options, callback);
        var records = type === 'lightcourse' ? [draft, unpublished] : [saved, legacy, unicode, untagged, orphan];
        callback(null, records.filter(function(record) { return record._id === query._id; }));
      } };
      var app = { contentmanager: {
        getContentPlugin: function(type, callback) { callback(null, {
          hasPermission: function(action, user, tenant, record, next) { next(null, true); }
        }); },
        create: function(type, data, callback) { persisted = data; callback(null, data); }
      } };
      var mocks = {
        express: function() { return { get: function(pattern, callback) { route = callback; } }; },
        '../../lib/database': { getDatabase: function(callback) { callback(null, routeDb); } },
        '../../lib/permissions': { ignoreRoute: function() {} },
        '../../lib/usermanager': { getCurrentUser: function() { return { _id: 'user', tenant: { _id: 'tenant-1' } }; } },
        '../../lib/logger': { log: function() {} },
        '../../': function() { return app; },
        '../../lib/lightcourse/documentGenerator': generator
      };
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/document-export/index.js'), 'utf8'), {
        module: { exports: {} }, require: function(name) { assert(name in mocks, name); return mocks[name]; }
      });
      var download = new Promise(function(resolve, reject) {
        route({ params: { tenant: 'tenant-1', id: id }, query: { format: 'docx' } }, {
          setHeader: function(key, value) { headers[key] = value; }, send: resolve, status: function() { return this; },
          json: function(body) { reject(new Error(body.message)); }
        });
      });
      if (id === 'orphan-version') {
        await assert.rejects(download, /course title is unavailable/);
        assert.strictEqual(persisted, undefined);
        continue;
      }
      var buffer = await download;
      var zip = await unzipper.Open.buffer(buffer);
      var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString('utf8');
      var historical = id !== 'course-1' && id !== 'unpublished';
      assert(xml.includes(historical ? 'Old review' : 'Current review'));
      assert(!xml.includes('Old theme'));
      assert(!xml.includes('Current theme'));
      var title = id === 'unicode-version' ? unicode.contentSnapshot.title :
        id === 'version-1' || id === 'untagged-version' ? 'Old course' : 'Course title';
      assert(xml.includes('>' + title + '</w:t>'));
      assert(!xml.includes('Untitled light course'));
      var version = id === 'unpublished' ? 'draft' : id === 'unicode-version' ? '1.2' : historical ? '0.1' : '2.0';
      var tagTitles = id === 'untagged-version' ? [] :
        historical ? ['Old course tag', '\u00d6ld tag'] : ['Current course tag', 'Review / "tag"'];
      var filename = tagTitles.concat(title).join('_').replace(/[\\/:*?"<>|]/g, '-') + '_v' + version + '.docx';
      assert(headers['Content-Disposition'].includes('filename="' + filename.replace(/[^\x20-\x7e]/g, '-') + '"'));
      assert(headers['Content-Disposition'].includes("filename*=UTF-8''" + encodeURIComponent(filename)));
      if (id !== 'untagged-version') assert(xml.includes(historical ? 'Old course tag' : 'Current course tag'));
      assert(!xml.includes(historical ? 'Current course tag' : 'Old course tag'));
      assert.strictEqual(persisted.versionNumber, version);
      assert.strictEqual(persisted.renderedText, buffer.toString('base64'));
      assert.deepStrictEqual((await parse(buffer)).errors, []);
    }
  });

  it('preserves embedded rich media and rejects text changes that would remove it', async function() {
    var snapshot = fixture();
    component(snapshot).body = '<p>Image caption<img src="embedded.png"></p>';
    var parsed = await parse(await generate(snapshot));
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    parsed.blocks.find(function(block) { return block.id === 'component-1'; }).fields
      .find(function(field) { return field.path === 'body'; }).value = 'Changed caption';
    assert.strictEqual((await apply(parsed, snapshot)).success, false);
    assert(component(snapshot).body.includes('embedded.png'));
  });
});
