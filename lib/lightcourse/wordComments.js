var docx = require('docx');
var crypto = require('crypto');
var comments = require('./comments');

function visit(nodes, callback) {
  (nodes || []).forEach(function(node) {
    Object.keys(node).forEach(function(tag) {
      if (tag === ':@') return;
      callback(tag, node);
      if (Array.isArray(node[tag])) visit(node[tag], callback);
    });
  });
}

function attribute(node, name) {
  var attrs = node && node[':@'] || {};
  var key = Object.keys(attrs).find(function(key) { return key === '@_' + name || key.endsWith(':' + name); });
  return attrs[key];
}

function hexAttribute(node, name) {
  var value = attribute(node, name);
  if (value === undefined) return value;
  if (!/^[a-fA-F0-9]{8}$/.test(value)) throw new Error('Invalid Word comment identity.');
  return value.toUpperCase();
}

function exportComments(blocks, metadata) {
  var children = [], anchors = new Map(), durableIds = new Set();
  metadata.commentSourceId = crypto.randomBytes(16).toString('hex');
  metadata.comments = [];
  blocks.filter(function(block) { return block.level === 4; }).forEach(function(block) {
    var active = (block.comments || []).filter(function(comment) { return !comment.deleted; });
    var error = comments.validate(block.comments);
    if (error) throw new Error(error);
    var replies = new Map(), ordered = [];
    active.forEach(function(comment) {
      if (!replies.has(comment.parentId)) replies.set(comment.parentId, []);
      replies.get(comment.parentId).push(comment);
    });
    var pending = active.filter(function(comment) { return !comment.parentId; }).reverse();
    while (pending.length) {
      var next = pending.pop();
      ordered.push(next);
      pending.push.apply(pending, (replies.get(next._id) || []).slice().reverse());
    }
    active = ordered;
    var ids = new Map(active.map(function(comment, index) { return [comment._id, children.length + index]; }));
    var references = [];
    active.forEach(function(comment) {
      var id = ids.get(comment._id);
      var durableId = comments.stableId(block.id + ':' + comment._id).slice(0, 8).toUpperCase();
      if (durableIds.has(durableId)) throw new Error('Duplicate durable Word comment ID. Re-export after resolving duplicate comment IDs.');
      durableIds.add(durableId);
      metadata.comments.push({ wordId: String(id), durableId: durableId, toolId: comment._id, nodeId: block.id,
        authorName: comment.authorName, createdAt: comment.createdAt, text: comment.text, parentId: comment.parentId });
      children.push({
        id: id, durableId: durableId, parentId: comment.parentId ? ids.get(comment.parentId) : undefined,
        author: comment.authorName, date: new Date(comment.createdAt), resolved: comment.resolved,
        children: comment.text.split('\n').map(function(line) { return new docx.Paragraph({ children: [new docx.TextRun(line)] }); })
      });
      references.push(id);
    });
    anchors.set(block.id, references);
  });
  return {
    children: children,
    anchor: function(nodeId, text) {
      var references = anchors.get(nodeId) || [];
      // Word's thread references must follow their parents, even when their ranges overlap.
      return references.map(function(id) { return new docx.CommentRangeStart(id); }).concat([text],
        references.flatMap(function(id) {
          return [new docx.CommentRangeEnd(id), new docx.TextRun({ children: [new docx.CommentReference(id)] })];
        }));
    },
    overrides: function(document) {
      (document.Comments.CommentIdsData || []).forEach(function(item, index) {
        metadata.comments[index].paraId = item.paraId;
      });
      if (!children.length || document.CommentsExtended) return [];
      // docx emits this part for replies only; single-comment threads also need resolved status.
      document.ContentTypes.addCommentsExtended();
      document.Document.Relationships.addRelationship('lightCourseCommentsExtended',
        'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', 'commentsExtended.xml');
      var data = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
        document.Comments.CommentIdsData.map(function(item, index) {
          return '<w15:commentEx w15:paraId="' + item.paraId + '" w15:done="' + (children[index].resolved ? '1' : '0') + '"/>';
        }).join('') + '</w15:commentsEx>';
      return [{ path: 'word/commentsExtended.xml', data: data }];
    }
  };
}

async function parse(zip, document, metadata, readXml) {
  async function part(path) {
    var file = zip.files.find(function(file) { return file.path === path; });
    if (!file) return [];
    if (file.uncompressedSize > 20 * 1024 * 1024) throw new Error('The Word comments are too large to import.');
    return readXml(await file.buffer());
  }
  var raw = await part('word/comments.xml'), entries = new Map(), paraIds = new Map();
  visit(raw, function(tag, node) {
    if (tag !== 'w:comment') return;
    var id = attribute(node, 'id'), paragraphs = [], paraId;
    if (typeof id !== 'string' || !/^-?\d+$/.test(id) || entries.has(id)) throw new Error('Word comments have missing, invalid or duplicate IDs.');
    visit(node['w:comment'], function(tag, item) {
      if (['w:drawing', 'w:object', 'w:pict', 'w:tbl', 'w:sym', 'm:oMath', 'w:altChunk'].indexOf(tag) !== -1) {
        throw new Error('Only text comments can be imported from Word.');
      }
      if (tag === 'w:p') {
        var paragraph = '';
        visit(item['w:p'], function(tag, content) {
          if (tag === 'w:t') paragraph += (content['w:t'] || []).map(function(value) {
            return value['#text'] === undefined ? '' : value['#text'];
          }).join('');
          if (tag === 'w:br' || tag === 'w:cr') paragraph += '\n';
          if (tag === 'w:tab') paragraph += '\t';
        });
        paragraphs.push(paragraph);
        paraId = hexAttribute(item, 'paraId') || paraId;
      }
    });
    var text = paragraphs.join('\n').trim(), name = attribute(node, 'author');
    if (!text || !name || !name.trim()) throw new Error('Word comments must contain text and an author name.');
    var createdAt = attribute(node, 'date');
    if (createdAt !== undefined) {
      if (!Number.isFinite(Date.parse(createdAt))) throw new Error('A Word comment has an invalid date.');
      createdAt = new Date(createdAt).toISOString();
    }
    var entry = { wordId: id, text: text, authorName: name, createdAt: createdAt, paraId: paraId, anchors: new Set() };
    entries.set(id, entry);
    if (paraId) {
      if (paraIds.has(paraId)) throw new Error('Word comments have duplicate paragraph IDs.');
      paraIds.set(paraId, entry);
    }
  });
  if (!entries.size) return [];
  var durableIds = new Set(), extendedIds = new Set();
  visit(await part('word/commentsIds.xml'), function(tag, node) {
    if (!tag.endsWith(':commentId')) return;
    var entry = paraIds.get(hexAttribute(node, 'paraId'));
    if (!entry) return;
    var durableId = hexAttribute(node, 'durableId');
    if (!durableId || entry.durableId || durableIds.has(durableId)) throw new Error('Missing or duplicate durable Word comment identities.');
    durableIds.add(durableId);
    entry.durableId = durableId;
  });
  visit(await part('word/commentsExtended.xml'), function(tag, node) {
    if (!tag.endsWith(':commentEx')) return;
    var entry = paraIds.get(hexAttribute(node, 'paraId'));
    if (!entry) return;
    if (extendedIds.has(entry.wordId)) throw new Error('Duplicate Word comment thread metadata.');
    extendedIds.add(entry.wordId);
    var parent = hexAttribute(node, 'paraIdParent');
    if (parent) {
      entry.parent = paraIds.get(parent);
      if (!entry.parent) throw new Error('A Word reply has no parent comment.');
    }
    var done = attribute(node, 'done');
    if (done !== undefined) {
      if (['0', '1', 'true', 'false'].indexOf(done) === -1) throw new Error('Invalid Word comment resolved status.');
      entry.resolved = done === '1' || done === 'true';
    }
  });
  var nodes = new Map((metadata.nodes || []).map(function(node) { return [node.bookmark, node]; }));
  var fields = new Map((metadata.fields || []).map(function(field) { return [field.bookmark, field]; }));
  var levels = new Map((metadata.nodes || []).map(function(node) { return [node.id, node.level]; }));
  var owners = new Map(), componentId;
  (metadata.nodes || []).forEach(function(node) {
    if (node.level <= 4) componentId = node.level === 4 ? node.id : null;
    owners.set(node.id, componentId);
  });
  var active = new Set(), current;
  visit(document, function(tag, node) {
    if (tag === 'w:p') {
      visit(node['w:p'], function(tag, item) {
        if (tag !== 'w:bookmarkStart') return;
        var name = attribute(item, 'name'), section = nodes.get(name), field = fields.get(name);
        if (section) current = owners.get(section.id);
        if (field) current = owners.get(field.nodeId);
      });
      active.forEach(function(id) { if (entries.has(id)) entries.get(id).anchors.add(current); });
    }
    if (['w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference'].indexOf(tag) === -1) return;
    var id = attribute(node, 'id'), entry = entries.get(id);
    if (!entry) throw new Error('A Word comment reference has no comment text.');
    entry.anchors.add(current);
    if (tag === 'w:commentRangeStart') active.add(id);
    if (tag === 'w:commentRangeEnd') active.delete(id);
  });
  var mapped = metadata.comments || [], result = [], used = new Set();
  function identityMapping(entry) {
    return mapped.find(function(item) { return entry.durableId && item.durableId === entry.durableId; }) ||
      mapped.find(function(item) { return entry.paraId && item.paraId === entry.paraId; }) ||
      mapped.find(function(item) {
        return item.wordId === entry.wordId && item.authorName === entry.authorName &&
          Math.floor(Date.parse(item.createdAt) / 1000) === Math.floor(Date.parse(entry.createdAt) / 1000);
      });
  }
  function resolve(entry, visiting) {
    if (entry.output) return entry.output;
    if (visiting.has(entry.wordId)) throw new Error('Word comments contain circular replies.');
    visiting.add(entry.wordId);
    var parent = entry.parent && resolve(entry.parent, visiting);
    var nodeId = parent ? parent.nodeId : entry.anchors.values().next().value;
    var mapping = identityMapping(entry);
    if (!mapping) {
      var matches = mapped.filter(function(item) {
        return item.nodeId === nodeId && item.text === entry.text && item.authorName === entry.authorName &&
          item.parentId === (parent ? parent.id : null) && !used.has(item.toolId) &&
          !Array.from(entries.values()).some(function(other) { return other !== entry && identityMapping(other) === item; });
      });
      if (matches.length === 1) mapping = matches[0];
    }
    if (entry.anchors.size > 1 || entry.anchors.size && entry.anchors.values().next().value !== nodeId ||
      !nodeId || levels.get(nodeId) !== 4 || mapping && mapping.nodeId !== nodeId) {
      throw new Error('A Word comment must be attached to exactly one component, not a page or multiple components.');
    }
    var key = (metadata.commentSourceId || metadata.sourceId || '') + ':' +
      (entry.durableId || entry.wordId + ':' + entry.authorName + ':' + (entry.createdAt ? Math.floor(Date.parse(entry.createdAt) / 1000) : ''));
    var id = mapping ? mapping.toolId : comments.stableId(nodeId + ':' + key);
    if (used.has(id)) throw new Error('Word comments contain duplicate stable identities.');
    used.add(id);
    var output = {
      id: id, toolId: mapping && mapping.toolId, nodeId: nodeId, wordKey: key,
      parentId: parent ? parent.id : null, text: entry.text, authorName: entry.authorName,
      createdAt: entry.createdAt, resolved: parent ? false : entry.resolved,
      exportedIds: mapped.filter(function(item) { return item.nodeId === nodeId; }).map(function(item) { return item.toolId; })
    };
    if (mapping && mapped.some(function(item) { return item.toolId === id && item.nodeId !== nodeId; })) {
      throw new Error('A Word comment was moved to another component.');
    }
    entry.output = output;
    result.push(output);
    visiting.delete(entry.wordId);
    return output;
  }
  entries.forEach(function(entry) { resolve(entry, new Set()); });
  return result;
}

module.exports = { exportComments: exportComments, parse: parse };
