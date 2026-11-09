var crypto = require('crypto');

function components(tree) {
  var result = new Map(), pending = [tree || {}];
  while (pending.length) {
    var node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'component') result.set(node._id, node);
    if (Array.isArray(node.children)) pending.push.apply(pending, node.children);
  }
  return result;
}

function authorName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
}

function validate(comments) {
  if (comments === undefined) return null;
  if (!Array.isArray(comments)) return 'Component comments must be an array.';
  var byId = new Map();
  for (var comment of comments) {
    if (!comment || typeof comment._id !== 'string' || !/^[a-f0-9]{32}$/.test(comment._id) || byId.has(comment._id)) {
      return 'Component comments must have unique, stable IDs.';
    }
    if (typeof comment.text !== 'string' || !comment.deleted && !comment.text.trim()) return 'A comment must contain text.';
    if (typeof comment.authorName !== 'string' || !comment.authorName.trim()) return 'A comment must have an author name.';
    if (comment.authorId !== null && typeof comment.authorId !== 'string') return 'Invalid comment author.';
    if (comment.parentId !== null && typeof comment.parentId !== 'string') return 'Invalid comment parent.';
    if (typeof comment.resolved !== 'boolean' || comment.deleted !== undefined && typeof comment.deleted !== 'boolean') {
      return 'Invalid comment status.';
    }
    if (typeof comment.createdAt !== 'string' || typeof comment.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(comment.createdAt)) || !Number.isFinite(Date.parse(comment.updatedAt))) return 'Invalid comment date.';
    if (comment.wordKeys !== undefined && (!Array.isArray(comment.wordKeys) || comment.wordKeys.some(function(key) {
      return typeof key !== 'string';
    }))) return 'Invalid Word comment identity.';
    byId.set(comment._id, comment);
  }
  for (var item of comments) {
    if (item.mergedInto !== undefined && (!item.deleted || !byId.has(item.mergedInto) || item.mergedInto === item._id)) {
      return 'Invalid merged comment identity.';
    }
    var visited = new Set([item._id]), parent = item.parentId;
    while (parent) {
      var ancestor = byId.get(parent);
      if (!ancestor || visited.has(parent)) return 'Comments contain a missing or circular parent.';
      if (!item.deleted && ancestor.deleted) return 'A comment cannot reply to a deleted comment.';
      visited.add(parent);
      parent = ancestor.parentId;
    }
    if (item.parentId && item.resolved) return 'Only a comment thread can be resolved.';
  }
  return null;
}

function prepareChanges(previousTree, nextTree, user) {
  var previous = components(previousTree), id = String(user._id), now = new Date().toISOString();
  for (var entry of components(nextTree)) {
    var node = entry[1], before = previous.get(entry[0]);
    var stored = new Map(((before && before._comments) || []).map(function(comment) { return [comment._id, comment]; }));
    if (node._comments !== undefined && !Array.isArray(node._comments)) return 'Component comments must be an array.';
    var proposed = (node._comments || []).slice(), ids = new Set(proposed.map(function(comment) { return comment && comment._id; }));
    for (var old of stored.values()) {
      if (!ids.has(old._id)) {
        if (!old.deleted) return 'Delete comments using their comment controls, not by removing discussion data.';
        proposed.push(Object.assign({}, old));
      }
    }
    var normalized = [];
    for (var comment of proposed) {
      if (!comment || typeof comment.text !== 'string') return 'A comment must contain text.';
      if (comment.resolved !== undefined && typeof comment.resolved !== 'boolean' ||
        comment.deleted !== undefined && typeof comment.deleted !== 'boolean') return 'Invalid comment status.';
      var original = stored.get(comment._id);
      if (!original) {
        if (comment.deleted) continue;
        normalized.push({
          _id: comment._id, text: comment.text.trim(), parentId: comment.parentId || null,
          authorId: id, authorName: authorName(user), createdAt: now, updatedAt: now,
          resolved: comment.resolved === true, deleted: false
        });
        continue;
      }
      if (comment.parentId !== original.parentId || comment.authorId !== original.authorId) return 'A comment author or parent cannot be changed.';
      var changed = comment.text !== original.text || !!comment.deleted !== !!original.deleted;
      if (original.deleted && changed) return 'A deleted comment cannot be restored.';
      if (changed && original.authorId !== id) return 'You may only edit or delete your own comments.';
      if (comment.deleted && !original.deleted && proposed.some(function(reply) {
        return reply && reply.parentId === comment._id && !reply.deleted;
      })) return 'Delete the replies before deleting their parent comment.';
      normalized.push(Object.assign({}, original, {
        text: comment.deleted ? '' : comment.text.trim(), deleted: !!comment.deleted,
        resolved: comment.resolved === true, updatedAt: changed || comment.resolved !== original.resolved ? now : original.updatedAt
      }));
    }
    var error = validate(normalized);
    if (error) return error;
    if (node._comments !== undefined || normalized.length) node._comments = normalized;
  }
  return null;
}

function planImport(imported, targets) {
  var writes = [], errors = [], grouped = new Map();
  (imported || []).forEach(function(comment) {
    if (!grouped.has(comment.nodeId)) grouped.set(comment.nodeId, []);
    grouped.get(comment.nodeId).push(comment);
  });
  grouped.forEach(function(items, nodeId) {
    var target = targets[nodeId];
    if (!target || target.type !== 'component') {
      errors.push('A Word comment is not attached to a component. Place it within a component heading or field.');
      return;
    }
    var comments = (target._comments || []).map(function(comment) { return Object.assign({}, comment); }), aliases = new Map();
    comments.forEach(function(comment) { if (comment.mergedInto) aliases.set(comment._id, comment.mergedInto); });
    function canonical(id) {
      var seen = new Set();
      while (aliases.has(id) && !seen.has(id)) { seen.add(id); id = aliases.get(id); }
      return id;
    }
    items.forEach(function(item) {
      var parentId = canonical(item.parentId) || null;
      var existing = comments.find(function(comment) {
        return comment._id === canonical(item.toolId);
      });
      if (!existing && !item.toolId) {
        var matches = comments.filter(function(comment) {
          return !comment.deleted && (item.exportedIds || []).indexOf(comment._id) !== -1 &&
            comment.parentId === parentId && comment.text === item.text &&
            comment.authorName.trim().toLowerCase() === item.authorName.trim().toLowerCase() &&
            !items.some(function(other) { return other !== item && other.toolId === comment._id; });
        });
        if (matches.length > 1) {
          errors.push('More than one original comment matches a Word comment. Re-export rather than guessing which discussion to update.');
          return;
        }
        existing = matches[0];
      }
      if (!existing) existing = comments.find(function(comment) {
        return item.wordKey && (comment.wordKeys || []).indexOf(item.wordKey) !== -1;
      });
      if (existing && existing.deleted || item.toolId && !existing) return;
      var now = new Date().toISOString();
      if (existing) {
        if (item.id) aliases.set(item.id, existing._id);
        if (existing.parentId !== parentId) {
          errors.push('A Word comment was moved to a different thread. Keep existing replies in their original threads.');
          return;
        }
        comments.forEach(function(duplicate) {
          if (duplicate === existing || duplicate.deleted || duplicate.source !== 'word' ||
            (item.exportedIds || []).indexOf(duplicate._id) !== -1 ||
            duplicate.parentId !== parentId || duplicate.text !== item.text ||
            duplicate.authorName.trim().toLowerCase() !== item.authorName.trim().toLowerCase() ||
            !(duplicate.wordKeys || []).includes(item.wordKey)) return;
          aliases.set(duplicate._id, existing._id);
          existing.wordKeys = Array.from(new Set((existing.wordKeys || []).concat(duplicate.wordKeys || [])));
          comments.forEach(function(reply) { if (reply.parentId === duplicate._id) reply.parentId = existing._id; });
          duplicate.deleted = true;
          duplicate.text = '';
          duplicate.mergedInto = existing._id;
          duplicate.updatedAt = now;
        });
        if (existing.text !== item.text || item.resolved !== undefined && existing.resolved !== item.resolved) {
          existing.text = item.text;
          existing.updatedAt = now;
        }
        if (item.resolved !== undefined) existing.resolved = item.resolved;
        existing.wordKeys = Array.from(new Set((existing.wordKeys || []).concat(item.wordKey || [])));
      } else {
        comments.push({
          _id: item.id, parentId: parentId, text: item.text,
          authorId: null, authorName: item.authorName, createdAt: item.createdAt || now, updatedAt: now,
          resolved: item.resolved === true, deleted: false, wordKeys: [item.wordKey], source: 'word'
        });
      }
    });
    var error = validate(comments);
    if (error) errors.push('Component "' + nodeId + '": ' + error + ' Re-export if a parent thread was deleted in the editor.');
    else writes.push({ target: target, path: '_comments', value: comments });
  });
  return { writes: writes, errors: errors };
}

function resolveAuthors(tree, users) {
  var names = new Map();
  users.forEach(function(user) {
    [authorName(user), user.email].filter(Boolean).forEach(function(name) {
      var key = name.trim().toLowerCase(), id = String(user._id);
      names.set(key, names.has(key) && names.get(key) !== id ? null : id);
    });
  });
  components(tree).forEach(function(node) {
    (node._comments || []).forEach(function(comment) {
      if (comment.source === 'word' && !comment.authorId) comment.authorId = names.get(comment.authorName.trim().toLowerCase()) || null;
    });
  });
}

function stableId(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

module.exports = {
  components: components, authorName: authorName, validate: validate, prepareChanges: prepareChanges,
  planImport: planImport, resolveAuthors: resolveAuthors, stableId: stableId
};
