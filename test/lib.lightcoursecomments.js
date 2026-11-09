var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var unzipper = require('unzipper');
var archiver = require('archiver');
var XMLParser = require('fast-xml-parser').XMLParser;
var XMLBuilder = require('fast-xml-parser').XMLBuilder;
var comments = require('../lib/lightcourse/comments');
var validation = require('../lib/lightcourse/validation');
var generator = require('../lib/lightcourse/documentGenerator');
var importer = require('../lib/lightcourse/documentImport');
var regenerate = require('../lib/lightcourse/idRegeneration');

var user = { _id: 'alice', firstName: 'Alice', lastName: 'Author', email: 'alice@example.test' };
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function comment(number, extra) {
  return Object.assign({
    _id: String(number).padStart(32, '0'), parentId: null, text: 'Comment ' + number,
    authorId: 'alice', authorName: 'Alice Author', createdAt: '2025-01-01T10:00:00.000Z',
    updatedAt: '2025-01-01T10:00:00.000Z', resolved: false, deleted: false
  }, extra);
}
function tree(items) { return { children: [{ _id: 'component', type: 'component', _comments: items }] }; }
function fixture(items) {
  return { _lightCourseId: 'course', title: 'Review course', pluginSelections: {},
    contentTree: { children: [{ _id: 'page', type: 'page', title: 'Page', children: [
      { _id: 'article', type: 'article', children: [{ _id: 'block', type: 'block', children: [
        { _id: 'component', type: 'component', _component: 'text', title: 'Text',
          body: '<p>Editable content</p>', _comments: items }
      ] }] }
    ] }] } };
}
function component(snapshot) { return snapshot.contentTree.children[0].children[0].children[0].children[0]; }
var db = { retrieve: function(type, query, options, callback) {
  callback(null, [{ component: 'text', properties: {} }]);
} };
function generate(snapshot) {
  return new Promise(function(resolve, reject) {
    generator.generateDocx(snapshot, db, function(error, result) { if (error) reject(error); else resolve(result); });
  });
}
function parse(buffer) {
  return new Promise(function(resolve, reject) {
    generator.parseDocx(buffer, function(error, result) { if (error) reject(error); else resolve(result); });
  });
}
function apply(parsed, snapshot) {
  return new Promise(function(resolve, reject) {
    importer.importDocument(parsed, snapshot, db, function(error, result) { if (error) reject(error); else resolve(result); });
  });
}
async function parts(buffer) {
  var zip = await unzipper.Open.buffer(buffer), result = {};
  for (var file of zip.files) result[file.path] = (await file.buffer()).toString();
  return result;
}
async function rewrite(buffer, changes) {
  var zip = await unzipper.Open.buffer(buffer), archive = archiver('zip'), chunks = [];
  var output = new Promise(function(resolve, reject) {
    archive.on('data', function(chunk) { chunks.push(chunk); });
    archive.on('error', reject);
    archive.on('end', function() { resolve(Buffer.concat(chunks)); });
  });
  for (var file of zip.files) {
    if (changes[file.path] === null) continue;
    var data = await file.buffer();
    archive.append(changes[file.path] ? changes[file.path](data.toString()) : data, { name: file.path });
  }
  Object.keys(changes).forEach(function(name) {
    if (changes[name] && !zip.files.some(function(file) { return file.path === name; })) {
      archive.append(changes[name](''), { name: name });
    }
  });
  await archive.finalize();
  return output;
}
function newWordComment(xml, id, paraId, text, author) {
  if (!xml) xml = '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"/>';
  var entry = '<w:comment w:id="' + id + '" w:author="' + (author || 'External Reviewer') +
    '" w:date="2025-02-01T10:00:00Z"><w:p w14:paraId="' + paraId +
    '"><w:r><w:t>' + text + '</w:t></w:r></w:p></w:comment>';
  return xml.includes('</w:comments>') ? xml.replace('</w:comments>', entry + '</w:comments>') :
    xml.replace(/<w:comments\b([^>]*?)\/>/, '<w:comments$1>' + entry + '</w:comments>');
}
function anchorText(xml, text, id) {
  var position = xml.indexOf('>' + text + '</w:t>');
  assert(position !== -1, 'Expected comment anchor text in the generated document');
  var start = xml.lastIndexOf('<w:r>', position), end = xml.indexOf('</w:r>', position) + '</w:r>'.length;
  assert(start !== -1 && end > start);
  return xml.slice(0, start) + '<w:commentRangeStart w:id="' + id + '"/>' + xml.slice(start, end) +
    '<w:commentRangeEnd w:id="' + id + '"/><w:r><w:commentReference w:id="' + id + '"/></w:r>' + xml.slice(end);
}
function editMetadata(xml, edit) {
  var properties = new XMLParser({ ignoreAttributes: false }).parse(xml);
  var metadata = JSON.parse(properties.Properties.property['vt:lpwstr']);
  edit(metadata);
  properties.Properties.property['vt:lpwstr'] = JSON.stringify(metadata);
  return new XMLBuilder({ ignoreAttributes: false }).build(properties);
}
function legacyCommentMetadata(xml) {
  return editMetadata(xml, function(metadata) {
    metadata.comments.forEach(function(item) { delete item.paraId; delete item.text; delete item.parentId; });
  });
}

describe('Light course component comment ownership', function() {
  it('uses server-owned authors and dates for new comments', function() {
    var next = tree([comment(1, { authorId: 'forged', authorName: 'Forged' })]);
    assert.strictEqual(comments.prepareChanges({}, next, user), null);
    var saved = next.children[0]._comments[0];
    assert.strictEqual(saved.authorId, 'alice');
    assert.strictEqual(saved.authorName, 'Alice Author');
    assert.notStrictEqual(saved.createdAt, '2025-01-01T10:00:00.000Z');
    assert.strictEqual(saved.createdAt, saved.updatedAt);
  });
  it('rejects editing or deleting another author, but permits resolving and reopening', function() {
    var original = tree([comment(1, { authorId: 'bob' })]), next = copy(original);
    next.children[0]._comments[0].text = 'Changed';
    assert.match(comments.prepareChanges(original, next, user), /own comments/);
    next = copy(original);
    next.children[0]._comments[0].deleted = true;
    assert.match(comments.prepareChanges(original, next, user), /own comments/);
    next = copy(original);
    next.children[0]._comments[0].resolved = true;
    assert.strictEqual(comments.prepareChanges(original, next, user), null);
    var reopened = copy(next);
    reopened.children[0]._comments[0].resolved = false;
    assert.strictEqual(comments.prepareChanges(next, reopened, user), null);
  });
  it('keeps authors and parents immutable, and refuses omitted active comments', function() {
    var original = tree([comment(1)]), next = copy(original);
    next.children[0]._comments[0].authorId = 'bob';
    assert.match(comments.prepareChanges(original, next, user), /author or parent/);
    next = copy(original);
    next.children[0]._comments[0].parentId = comment(2)._id;
    assert.match(comments.prepareChanges(original, next, user), /author or parent/);
    assert.match(comments.prepareChanges(original, tree([]), user), /removing discussion/);
  });
  it('requires replies to be deleted first and retains deletion tombstones', function() {
    var original = tree([comment(1), comment(2, { parentId: comment(1)._id })]), next = copy(original);
    next.children[0]._comments[0].deleted = true;
    assert.match(comments.prepareChanges(original, next, user), /replies before/);
    next.children[0]._comments[1].deleted = true;
    assert.strictEqual(comments.prepareChanges(original, next, user), null);
    assert(next.children[0]._comments.every(function(item) { return item.deleted && item.text === ''; }));
    var omitted = tree([]);
    assert.strictEqual(comments.prepareChanges(next, omitted, user), null);
    assert.strictEqual(omitted.children[0]._comments.length, 2);
    var restored = copy(next);
    restored.children[0]._comments[0].deleted = false;
    restored.children[0]._comments[0].text = 'Resurrected';
    assert.match(comments.prepareChanges(next, restored, user), /cannot be restored/);
  });
  it('allows deleting a new comment before its first save', function() {
    var next = tree([comment(1, { deleted: true, text: '' })]);
    assert.strictEqual(comments.prepareChanges({}, next, user), null);
    assert.deepStrictEqual(next.children[0]._comments, []);
  });
  it('strips discussions when regenerating template or new-course IDs, without mutating the source', function() {
    var snapshot = fixture([comment(1)]), cloned = regenerate.regenerateSnapshotIds(snapshot);
    assert.strictEqual(component(cloned)._comments, undefined);
    assert.strictEqual(component(snapshot)._comments.length, 1);
    assert.notStrictEqual(component(cloned)._id, component(snapshot)._id);
  });
  it('rejects invalid status, dates, duplicate IDs and circular or missing parents', function() {
    assert.match(comments.validate([comment(1, { resolved: 'yes' })]), /status/);
    assert.match(comments.validate([comment(1, { createdAt: 1 })]), /date/);
    assert.match(comments.validate([comment(1), comment(1)]), /unique/);
    assert.match(comments.validate([comment(1, { parentId: comment(2)._id })]), /missing or circular/);
    assert.match(comments.validate([comment(1, { parentId: comment(2)._id }),
      comment(2, { parentId: comment(1)._id })]), /missing or circular/);
    assert.match(comments.validate([comment(1), comment(2, { parentId: comment(1)._id, resolved: true })]), /Only a comment thread/);
    assert.match(validation.validate(fixture([comment(1, { text: '' })])), /contain text/);
    assert.doesNotThrow(function() { comments.prepareChanges({}, { children: [null] }, user); });
  });
  it('matches unique names or emails, retaining ambiguous and external reviewer names', function() {
    var value = tree([
      comment(1, { source: 'word', authorId: null, authorName: 'ALICE AUTHOR' }),
      comment(2, { source: 'word', authorId: null, authorName: 'alice@example.test' }),
      comment(3, { source: 'word', authorId: null, authorName: 'Unknown Reviewer' }),
      comment(4, { source: 'word', authorId: null, authorName: 'Shared Name' })
    ]);
    comments.resolveAuthors(value, [user, { _id: 'bob', firstName: 'Shared', lastName: 'Name' },
      { _id: 'carol', firstName: 'Shared', lastName: 'Name' }]);
    assert.deepStrictEqual(value.children[0]._comments.map(function(item) { return item.authorId; }), ['alice', 'alice', null, null]);
    assert.strictEqual(value.children[0]._comments[2].authorName, 'Unknown Reviewer');
  });
});

describe('Native Word component comments', function() {
  it('uses Heading 2 visually for components while retaining their logical import level', async function() {
    var buffer = await generate(fixture([])), files = await parts(buffer);
    var xml = new XMLParser({ ignoreAttributes: false }).parse(files['word/document.xml']);
    var headings = xml['w:document']['w:body']['w:p'].filter(function(paragraph) {
      return paragraph['w:bookmarkStart'] && paragraph['w:bookmarkStart']['@_w:name'] === 'lcnode_3';
    });
    assert.strictEqual(headings.length, 1);
    assert.strictEqual(headings[0]['w:pPr']['w:pStyle']['@_w:val'], 'Heading2');
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.blocks.find(function(block) { return block.id === 'component'; }).level, 4);
    var changed = await rewrite(buffer, { 'word/document.xml': function(xml) {
      return xml.replace('w:val="Heading2"', 'w:val="Heading4"');
    } });
    assert((await parse(changed)).errors.some(function(error) { return error.includes('heading style'); }));
    var legacy = await rewrite(changed, { 'docProps/custom.xml': function(xml) {
      return editMetadata(xml, function(metadata) { metadata.nodes.forEach(function(node) { delete node.headingLevel; }); });
    } });
    assert.deepStrictEqual((await parse(legacy)).errors, []);
  });
  it('anchors every reply in document.xml, not only the thread root', async function() {
    var files = await parts(await generate(fixture([comment(1), comment(2, { parentId: comment(1)._id }),
      comment(3, { parentId: comment(2)._id })])));
    ['0', '1', '2'].forEach(function(id) {
      assert(files['word/document.xml'].includes('<w:commentRangeStart w:id="' + id + '"/>'));
      assert(files['word/document.xml'].includes('<w:commentRangeEnd w:id="' + id + '"/>'));
      assert(files['word/document.xml'].includes('<w:commentReference w:id="' + id + '"/>'));
    });
    var metadata = JSON.parse(new XMLParser().parse(files['docProps/custom.xml']).Properties.property['vt:lpwstr']);
    assert(metadata.comments.every(function(item) { return /^[0-9A-F]{8}$/.test(item.paraId); }));
    assert.strictEqual(metadata.comments[1].parentId, comment(1)._id);
  });
  it('writes complete threads parent-first in definitions and document references', async function() {
    var snapshot = fixture([
      comment(3, { parentId: comment(2)._id }),
      comment(4),
      comment(2, { parentId: comment(1)._id }),
      comment(1)
    ]);
    var files = await parts(await generate(snapshot));
    var metadata = JSON.parse(new XMLParser().parse(files['docProps/custom.xml']).Properties.property['vt:lpwstr']);
    var references = Array.from(files['word/document.xml'].matchAll(/<w:commentReference w:id="(\d+)"\/>/g),
      function(match) { return metadata.comments.find(function(item) { return item.wordId === match[1]; }).toolId; });
    assert.deepStrictEqual(references, [comment(4)._id, comment(1)._id, comment(2)._id, comment(3)._id]);
    assert.deepStrictEqual(metadata.comments.map(function(item) { return item.toolId; }), references);
    var parsed = await parse(await generate(snapshot));
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments.find(function(item) { return item.toolId === comment(3)._id; }).parentId, comment(2)._id);
  });
  it('recognises original comments when Word changes durable IDs and timestamps', async function() {
    var snapshot = fixture([comment(1), comment(2, { parentId: comment(1)._id })]);
    var buffer = await rewrite(await generate(snapshot), {
      'word/commentsIds.xml': function(xml) {
        var index = 0;
        return xml.replace(/durableId="[^"]+"/g, function() { return 'durableId="BAD0000' + (++index) + '"'; });
      },
      'word/comments.xml': function(xml) { return xml.replace(/w:date="[^"]+"/g, 'w:date="2026-01-01T10:00:00Z"').replace('Comment 1', 'Edited root'); }
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments[0].toolId, comment(1)._id);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments.length, 2);
    assert.strictEqual(component(snapshot)._comments[0].text, 'Edited root');
  });
  it('uses unambiguous export snapshots when Word rewrites all comment identities', async function() {
    var snapshot = fixture([comment(1), comment(2, { parentId: comment(1)._id })]);
    var original = await generate(snapshot), files = await parts(original);
    var metadata = JSON.parse(new XMLParser().parse(files['docProps/custom.xml']).Properties.property['vt:lpwstr']);
    function rewriteIds(xml) {
      metadata.comments.forEach(function(item, index) {
        xml = xml.split('="' + item.paraId + '"').join('="ABC0000' + (index + 1) + '"')
          .split('="' + item.durableId + '"').join('="BAD0000' + (index + 1) + '"');
      });
      return xml.replace(/w:id="0"/g, 'w:id="90"').replace(/w:id="1"/g, 'w:id="91"')
        .replace(/w:date="[^"]+"/g, 'w:date="2026-01-01T10:00:00Z"');
    }
    var buffer = await rewrite(original, { 'word/comments.xml': rewriteIds, 'word/document.xml': rewriteIds,
      'word/commentsIds.xml': rewriteIds, 'word/commentsExtended.xml': rewriteIds });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments[0].toolId, comment(1)._id);
    assert.strictEqual(parsed.comments[1].toolId, comment(2)._id);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments.length, 2);
  });
  it('combines a legacy duplicate root and its Word reply with the original discussion', async function() {
    var snapshot = fixture([comment(1), comment(2, { parentId: comment(1)._id })]);
    var original = await generate(snapshot), files = await parts(original);
    var parent = /paraId="([^"]+)"/.exec(files['word/commentsExtended.xml'])[1];
    var buffer = await rewrite(original, {
      'docProps/custom.xml': legacyCommentMetadata,
      'word/comments.xml': function(xml) {
        xml = xml.replace(/<w:comment w:id="1"[\s\S]*?<\/w:comment>/, '')
          .replace(/w:date="[^"]+"/g, 'w:date="2026-01-01T10:00:00Z"');
        return newWordComment(xml, '42', 'ABCD1234', 'New Word reply');
      },
      'word/commentsIds.xml': function(xml) { return xml.replace(/durableId="[^"]+"/g, 'durableId="BAD00001"'); },
      'word/commentsExtended.xml': function(xml) {
        return xml.replace('</w15:commentsEx>', '<w15:commentEx w15:paraId="ABCD1234" w15:paraIdParent="' + parent + '" w15:done="0"/></w15:commentsEx>');
      },
      'word/document.xml': function(xml) {
        return xml.replace(/<w:comment(?:RangeStart|RangeEnd|Reference) w:id="1"\/>/g, '');
      }
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments[0].toolId, undefined);
    var root = parsed.comments[0], reply = parsed.comments[1];
    component(snapshot)._comments.push(comment(3, {
      _id: root.id, source: 'word', wordKeys: [root.wordKey], text: root.text, createdAt: root.createdAt
    }), comment(4, {
      _id: reply.id, source: 'word', wordKeys: [reply.wordKey], text: reply.text, parentId: root.id
    }));
    for (var attempt = 0; attempt < 2; attempt++) {
      assert.strictEqual((await apply(parsed, snapshot)).success, true);
      var active = component(snapshot)._comments.filter(function(item) { return !item.deleted; });
      assert.strictEqual(active.length, 3);
      assert.strictEqual(active.filter(function(item) { return !item.parentId; }).length, 1);
      assert(active.filter(function(item) { return item.parentId; }).every(function(item) { return item.parentId === comment(1)._id; }));
    }
    var duplicate = component(snapshot)._comments.find(function(item) { return item._id === root.id; });
    assert.strictEqual(duplicate.mergedInto, comment(1)._id);
    assert.strictEqual(duplicate.deleted, true);
    assert.strictEqual((await parse(await generate(snapshot))).comments.length, 3);
  });
  it('does not combine an intentional new identical comment when the original is still present', async function() {
    var snapshot = fixture([comment(1)]), buffer = await rewrite(await generate(snapshot), {
      'word/comments.xml': function(xml) { return newWordComment(xml, '42', 'ABCD1234', 'Comment 1', 'Alice Author'); },
      'word/document.xml': function(xml) { return anchorText(xml, 'Editable content', '42'); }
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments.filter(function(item) { return !item.deleted; }).length, 2);
  });
  it('rejects ambiguous legacy matches rather than merging separate discussions', function() {
    var target = { type: 'component', _comments: [comment(1), comment(2, { text: 'Comment 1' })] };
    var before = copy(target);
    var result = comments.planImport([{ id: comment(3)._id, nodeId: 'component', parentId: null,
      text: 'Comment 1', authorName: 'Alice Author', wordKey: 'legacy:42',
      exportedIds: [comment(1)._id, comment(2)._id] }], { component: target });
    assert(result.errors.some(function(error) { return error.includes('More than one'); }));
    assert.deepStrictEqual(target, before);
  });
  it('accepts the first reviewer comment on an export with no existing discussion', async function() {
    var snapshot = fixture([]), buffer = await rewrite(await generate(snapshot), {
      'word/comments.xml': function(xml) { return newWordComment(xml, '42', 'ABCD1234', 'First reviewer comment'); },
      'word/document.xml': function(xml) { return anchorText(xml, 'Editable content', '42'); },
      '[Content_Types].xml': function(xml) {
        return xml.replace('</Types>', '<Override PartName="/word/comments.xml" ' +
          'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>');
      },
      'word/_rels/document.xml.rels': function(xml) {
        return xml.replace('</Relationships>', '<Relationship Id="reviewComments" ' +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>');
      }
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments.length, 1);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments[0].authorName, 'External Reviewer');
  });
  it('preserves multiline thread text and durable identities after Word renumbers comments', async function() {
    var snapshot = fixture([comment(1, { text: 'First line\n\nLast line' }),
      comment(2, { parentId: comment(1)._id, text: 'Reply\nSecond line' })]);
    var renumber = function(xml) { return xml.replace(/w:id="0"/g, 'w:id="99"').replace(/w:id="1"/g, 'w:id="100"'); };
    var buffer = await rewrite(await generate(snapshot), { 'word/comments.xml': renumber, 'word/document.xml': renumber,
      'word/commentsIds.xml': function(xml) { return xml.replace(/durableId="([^"]+)"/g, function(match, id) {
        return 'durableId="' + id.toLowerCase() + '"';
      }); }
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments[0].text, 'First line\n\nLast line');
    assert.strictEqual(parsed.comments[1].parentId, comment(1)._id);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments.length, 2);
  });
  it('exports and round-trips a resolved standalone thread, with valid package parts', async function() {
    var snapshot = fixture([comment(1, { resolved: true })]), buffer = await generate(snapshot), files = await parts(buffer);
    assert.match(files['word/comments.xml'], /Alice Author/);
    assert.match(files['word/commentsExtended.xml'], /w15:done="1"/);
    assert.match(files['word/commentsIds.xml'], /durableId/);
    assert.match(files['[Content_Types].xml'], /commentsExtended/);
    assert.match(files['word/_rels/document.xml.rels'], /relationships\/commentsExtended/);
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments.length, 1);
    assert.strictEqual(parsed.comments[0].toolId, comment(1)._id);
    assert.strictEqual(parsed.comments[0].resolved, true);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments.length, 1);
  });
  it('exports nested replies and updates Word text and resolved status without duplicates', async function() {
    var snapshot = fixture([comment(1), comment(2, { parentId: comment(1)._id }),
      comment(3, { parentId: comment(2)._id, authorId: 'bob', authorName: 'Bob' })]);
    var buffer = await rewrite(await generate(snapshot), {
      'word/comments.xml': function(xml) { return xml.replace('Comment 2', 'Edited reply'); },
      'word/commentsExtended.xml': function(xml) { return xml.replace('w15:done="0"', 'w15:done="1"'); }
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments.length, 3);
    assert.strictEqual(parsed.comments[2].parentId, comment(2)._id);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments.length, 3);
    assert.strictEqual(component(snapshot)._comments[1].text, 'Edited reply');
    assert.strictEqual(component(snapshot)._comments[0].resolved, true);
  });
  it('imports new external replies, deduplicates repeated imports and re-exports them', async function() {
    var snapshot = fixture([comment(1)]), buffer = await generate(snapshot), files = await parts(buffer);
    var parent = /paraId="([^"]+)"/.exec(files['word/commentsExtended.xml'])[1];
    buffer = await rewrite(buffer, {
      'word/comments.xml': function(xml) { return newWordComment(xml, '42', 'ABCD1234', 'External reply'); },
      'word/commentsExtended.xml': function(xml) {
        return xml.replace('</w15:commentsEx>', '<w15:commentEx w15:paraId="ABCD1234" w15:paraIdParent="' + parent + '" w15:done="0"/></w15:commentsEx>');
      },
      'word/commentsIds.xml': function(xml) {
        return xml.replace('</w16cid:commentsIds>', '<w16cid:commentId w16cid:paraId="ABCD1234" w16cid:durableId="AABB1234"/></w16cid:commentsIds>');
      }
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
    var imported = component(snapshot)._comments[1];
    assert.strictEqual(imported.authorName, 'External Reviewer');
    assert.strictEqual(imported.authorId, null);
    assert.strictEqual(imported.parentId, comment(1)._id);
    assert.strictEqual(component(snapshot)._comments.length, 2);
    var exported = await parse(await generate(snapshot));
    assert.strictEqual(exported.comments[1].toolId, imported._id);
    assert.strictEqual((await apply(exported, snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments.length, 2);
  });
  it('imports a new root anchored within a component field and preserves numeric text', async function() {
    var snapshot = fixture([comment(1)]), buffer = await rewrite(await generate(snapshot), {
      'word/comments.xml': function(xml) { return newWordComment(xml, '42', 'ABCD1234', '0'); },
      'word/document.xml': function(xml) {
        return anchorText(xml, 'Editable content', '42');
      }
    });
    var parsed = await parse(buffer);
    assert.deepStrictEqual(parsed.errors, []);
    assert.strictEqual(parsed.comments.length, 2);
    assert.strictEqual(parsed.comments[1].text, '0');
    assert.strictEqual((await apply(parsed, snapshot)).success, true);
  });
  it('does not delete comments removed from Word or resurrect tool-deleted comments', async function() {
    var snapshot = fixture([comment(1)]), buffer = await generate(snapshot);
    var removed = await rewrite(buffer, { 'word/comments.xml': function(xml) {
      return xml.replace(/<w:comment [\s\S]*?<\/w:comment>/g, '');
    } });
    assert.strictEqual((await apply(await parse(removed), snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments.length, 1);
    component(snapshot)._comments[0].deleted = true;
    component(snapshot)._comments[0].text = '';
    assert.strictEqual((await apply(await parse(buffer), snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments[0].text, '');
    assert.strictEqual(component(snapshot)._comments[0].deleted, true);
  });
  it('preserves resolved status when the Word processor omits extended status', async function() {
    var snapshot = fixture([comment(1, { resolved: true })]);
    var buffer = await rewrite(await generate(snapshot), { 'word/commentsExtended.xml': null });
    assert.strictEqual((await apply(await parse(buffer), snapshot)).success, true);
    assert.strictEqual(component(snapshot)._comments[0].resolved, true);
  });
  it('rejects comments anchored to a page, unsupported content, invalid dates and missing parents', async function() {
    var buffer = await generate(fixture([comment(1)]));
    var cases = [
      { 'word/document.xml': function(xml) {
        return anchorText(xml, 'Section 1', '42');
      }, 'word/comments.xml': function(xml) { return newWordComment(xml, '42', 'ABCD1234', 'Wrong location'); } },
      { 'word/comments.xml': function(xml) { return xml.replace('Comment 1', '</w:t></w:r><w:drawing/><w:r><w:t>Image'); } },
      { 'word/comments.xml': function(xml) { return xml.replace(/w:date="[^"]+"/, 'w:date="invalid"'); } },
      { 'word/comments.xml': function(xml) { return xml.replace(/w:date="[^"]+"/, 'w:date=""'); } },
      { 'word/comments.xml': function(xml) { return xml.replace('w:id="0"', 'w:id="invalid"'); } },
      { 'word/commentsExtended.xml': function(xml) { return xml.replace('w15:done="0"', 'w15:paraIdParent="DEADBEEF"'); } },
      { 'word/commentsExtended.xml': function(xml) { return xml.replace('w15:done="0"', 'w15:done="invalid"'); } }
    ];
    for (var change of cases) assert((await parse(await rewrite(buffer, change))).errors.length > 0);
  });
  it('rejects a comment range spanning two components', async function() {
    var snapshot = fixture([comment(1)]);
    snapshot.contentTree.children[0].children[0].children[0].children.push({
      _id: 'second-component', type: 'component', _component: 'text', title: 'Other', body: '<p>Other content</p>'
    });
    var buffer = await rewrite(await generate(snapshot), { 'word/document.xml': function(xml) {
      xml = xml.replace('<w:commentRangeEnd w:id="0"/>', '').replace('<w:commentReference w:id="0"/>', '');
      var position = xml.indexOf('>Other content</w:t>');
      assert(position !== -1);
      var end = xml.indexOf('</w:r>', position) + '</w:r>'.length;
      return xml.slice(0, end) + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>' + xml.slice(end);
    } });
    assert((await parse(buffer)).errors.some(function(error) { return error.includes('multiple components'); }));
  });
  it('plans comment and content writes atomically, rejecting moved existing threads', async function() {
    var snapshot = fixture([comment(1)]), before = copy(snapshot), parsed = await parse(await generate(snapshot));
    parsed.comments[0].text = 'Edited';
    parsed.comments[0].parentId = comment(2)._id;
    var result = await apply(parsed, snapshot);
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(snapshot, before);
  });
});

function uiHarness(items, readOnly) {
  var exported, context, text = '', alerts = [], confirmation, renders = [], removed = false;
  var origin = { sessionModel: { get: function(key) { return key === 'id' ? 'alice' : user.email; } },
    l10n: { t: function(key) { return key; } },
    Notify: { alert: function(value) { alerts.push(value); }, confirm: function(value) { confirmation = value; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../frontend/src/modules/lightCourseEditor/views/lightCourseCommentsView.js'), 'utf8'), {
    crypto: require('crypto').webcrypto, Uint8Array: Uint8Array,
    $: function(element) { return { closest: function() { return { data: function() { return element.id; } }; } }; },
    Handlebars: { templates: { lightCourseComments: function(data) { context = data; renders.push(data); return ''; } } },
    define: function(factory) {
      exported = factory(function(name) {
        if (name === 'core/origin') return origin;
        if (name === 'core/views/originView') return { extend: function(proto) { return proto; },
          prototype: { remove: function() { removed = true; } } };
        throw new Error(name);
      });
    }
  });
  var node = { _comments: copy(items) }, view = Object.assign(Object.create(exported), {
    cid: 'comments-test', $el: { html: function() { text = context.composerText; } },
    $: function() { return { val: function() { return text; }, trigger: function() {} }; }
  });
  view.preRender({ node: node, readOnly: readOnly });
  view.postRender();
  function event(id) { return { currentTarget: { id: id }, preventDefault: function() {} }; }
  return {
    view: view, node: node, alerts: alerts, rows: function() { return context.rows; }, context: function() { return context; },
    text: function(value) { text = value; view.onTextChanged(); },
    click: function(method, id) { view[method](event(id)); },
    confirm: function() { confirmation.callback(true); },
    removed: function() { return removed; }
  };
}
describe('Light course comment controls', function() {
  it('starts replies collapsed and expands nested discussions independently without changing saved data', function() {
    var h = uiHarness([comment(1), comment(2, { parentId: comment(1)._id }),
      comment(3, { parentId: comment(2)._id }), comment(4)]);
    var before = copy(h.node);
    assert.strictEqual(h.rows()[0].hidden, false);
    assert.strictEqual(h.rows()[1].hidden, true);
    assert.strictEqual(h.rows()[2].hidden, true);
    assert.strictEqual(h.rows()[3].hidden, false);
    assert.strictEqual(h.rows()[0].replyCount, 1);
    h.text('Keep unfinished comment');
    h.click('onToggleReplies', comment(1)._id);
    assert.strictEqual(h.rows()[0].expanded, true);
    assert.strictEqual(h.rows()[1].hidden, false);
    assert.strictEqual(h.rows()[2].hidden, true);
    h.click('onToggleReplies', comment(2)._id);
    assert.strictEqual(h.rows()[2].hidden, false);
    h.click('onToggleReplies', comment(1)._id);
    assert.strictEqual(h.rows()[1].hidden, true);
    assert.strictEqual(h.rows()[2].hidden, true);
    h.click('onToggleReplies', comment(1)._id);
    assert.strictEqual(h.rows()[2].hidden, false);
    assert.strictEqual(h.view.composerText, 'Keep unfinished comment');
    assert.deepStrictEqual(h.node, before);
  });
  it('automatically reveals new replies and does not count deleted replies', function() {
    var h = uiHarness([comment(1), comment(2, { parentId: comment(1)._id, deleted: true, text: '' })]);
    assert.strictEqual(h.rows()[0].replyCount, 0);
    h.click('onReply', comment(1)._id);
    h.text('New reply');
    h.click('onSave');
    assert.strictEqual(h.rows()[0].expanded, true);
    assert.strictEqual(h.rows()[0].replyCount, 1);
    assert.strictEqual(h.rows()[1].hidden, false);
  });
  it('allows read-only users to expand discussions without exposing editing controls', function() {
    var h = uiHarness([comment(1), comment(2, { parentId: comment(1)._id })], true);
    h.click('onToggleReplies', comment(1)._id);
    assert.strictEqual(h.rows()[1].hidden, false);
    assert.strictEqual(h.rows()[1].canReply, false);
    assert.strictEqual(h.rows()[1].canEdit, false);
  });
  it('renders accessible toggle controls and resolved styling for the entire thread', function() {
    var h = uiHarness([comment(1, { resolved: true }), comment(2, { parentId: comment(1)._id })]);
    var handlebars = require('handlebars').create();
    handlebars.registerHelper('t', function(key) { return key; });
    handlebars.registerHelper('momentFormat', function(value) { return value; });
    var render = handlebars.compile(fs.readFileSync(path.join(__dirname,
      '../frontend/src/modules/lightCourseEditor/templates/lightCourseComments.hbs'), 'utf8'));
    var html = render(h.context());
    assert(html.includes('aria-expanded="false"'));
    assert(html.includes('aria-controls="' + h.rows()[1].commentId + '"'));
    assert(html.includes('id="' + h.rows()[1].commentId + '"'));
    assert(html.includes('hidden>'));
    assert.strictEqual((html.match(/light-course-comment is-resolved/g) || []).length, 2);
    h.click('onToggleReplies', comment(1)._id);
    html = render(h.context());
    assert(html.includes('aria-expanded="true"'));
    assert(!html.includes('hidden>'));
    h.click('onResolve', comment(1)._id);
    assert(!render(h.context()).includes('is-resolved'));
  });
  it('adds roots and nested replies to the component draft as plain text', function() {
    var h = uiHarness([]);
    h.text('<script>Plain comment</script>');
    h.click('onSave');
    var root = h.node._comments[0];
    assert.match(root._id, /^[a-f0-9]{32}$/);
    assert.strictEqual(root.text, '<script>Plain comment</script>');
    h.click('onReply', root._id);
    h.text('Reply');
    h.click('onSave');
    h.click('onReply', h.node._comments[1]._id);
    h.text('Nested');
    h.click('onSave');
    assert.strictEqual(h.node._comments[2].parentId, h.node._comments[1]._id);
    assert.strictEqual(h.rows()[2].indent, 32);
  });
  it('enforces author controls and deletion of replies first', function() {
    var h = uiHarness([comment(1), comment(2, { parentId: comment(1)._id }), comment(3, { authorId: 'bob' })]);
    assert.strictEqual(h.rows()[0].canDelete, false);
    assert.strictEqual(h.rows()[2].canEdit, false);
    h.click('onDelete', comment(1)._id);
    assert.strictEqual(h.alerts.length, 1);
    h.click('onDelete', comment(2)._id);
    h.confirm();
    assert.strictEqual(h.rows()[0].canDelete, true);
    h.click('onEdit', comment(1)._id);
    h.text('Updated own comment');
    h.click('onSave');
    assert.strictEqual(h.node._comments[0].text, 'Updated own comment');
  });
  it('resolves and reopens threads, retaining an unsaved composer while changing status', function() {
    var h = uiHarness([comment(1, { authorId: 'bob' })]);
    h.text('Unsent new comment');
    h.click('onResolve', comment(1)._id);
    assert.strictEqual(h.node._comments[0].resolved, true);
    assert.strictEqual(h.rows()[0].canReply, false);
    assert.strictEqual(h.view.composerText, 'Unsent new comment');
    h.click('onResolve', comment(1)._id);
    assert.strictEqual(h.rows()[0].canReply, true);
  });
  it('rejects empty comments and makes converted courses read-only', function() {
    var h = uiHarness([]);
    h.text('  ');
    h.click('onSave');
    assert.strictEqual(h.alerts.length, 1);
    assert.strictEqual(h.node._comments.length, 0);
    h = uiHarness([comment(1)], true);
    assert.strictEqual(h.rows()[0].canEdit, false);
    assert.strictEqual(h.rows()[0].canResolve, false);
    h.text('Not allowed');
    h.click('onSave');
    assert.strictEqual(h.node._comments.length, 1);
    h.view.remove();
    assert.strictEqual(h.removed(), true);
  });
  it('escapes reviewer names and text in the rendered template', function() {
    var handlebars = require('handlebars').create();
    handlebars.registerHelper('t', function(key) { return key; });
    handlebars.registerHelper('momentFormat', function(value) { return value; });
    var render = handlebars.compile(fs.readFileSync(path.join(__dirname,
      '../frontend/src/modules/lightCourseEditor/templates/lightCourseComments.hbs'), 'utf8'));
    var html = render({ rows: [comment(1, { text: '<img src=x onerror=alert(1)>', authorName: '<script>Reviewer</script>' })] });
    assert(!html.includes('<img'));
    assert(!html.includes('<script>'));
    assert(html.includes('&lt;img'));
    assert(html.includes('&lt;script&gt;'));
  });
});
