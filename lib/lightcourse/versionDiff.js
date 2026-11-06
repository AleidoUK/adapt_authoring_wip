// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * ID-keyed snapshot comparison for the Light Course Editor, per
 * docs/LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md. No existing diff/comparison utility was
 * found elsewhere in this codebase to reuse - this is new code, but is possible as a simple
 * ID-keyed diff (rather than a text-similarity diff) specifically because
 * docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md deliberately keeps stable per-node IDs, generated
 * once at node-creation time and never regenerated across saves/versions.
 *
 * Shared by two callers:
 *  - `GET .../versions/compare?a=&b=` (plugins/content/lightcourse/index.js) - diffs two
 *    published version snapshots.
 *  - `POST /document-import/...` (routes/document-import/index.js) - diffs the current draft
 *    against its latest published version, to detect unsaved changes before an import would
 *    overwrite them (the "never silently discard it" rule from the main plan).
 *
 * Structural text uses the shared Word field definitions. Component fields are compared
 * directly so additions, clearing, nested settings, presets and assets are not missed.
 */

var async = require('async');
var wordFields = require('./wordFields');
var equal = require('util').isDeepStrictEqual;

// Same fixed internal shapes lib/lightcoursewordcount.js's FIXED_ITEM_FIELDS uses - these are the
// Light Course Editor's own data structures, not installed-plugin schemas, so no schema
// resolution is needed to diff them.
var FIXED_ITEM_FIELDS = {
  glossaryItems: ['term', 'description'],
  resourceItems: ['title', 'description', 'instruction', '_type', '_link', '_assetId']
};

function fieldDifferences(a, b, keys) {
  return keys.filter(function(key) { return !equal(a[key], b[key]); })
    .map(function(key) { return { path: key, from: a[key], to: b[key] }; });
}

/**
 * Flattens a contentTree into an ID -> { node, parentId, index } map, walking depth-first.
 * `parentId`/`index` are what let a node "present in both but with a different parent/index" be
 * reported as moved, per the main plan.
 */
function buildNodeMap(contentTree) {
  var map = {};
  function walk(nodes, parentId) {
    (nodes || []).forEach(function (node, index) {
      if (!node || !node._id) {
        return;
      }
      map[node._id] = { node: node, parentId: parentId, index: index };
      walk(node.children, node._id);
    });
  }
  walk((contentTree && contentTree.children) || [], null);
  return map;
}

/**
 * Diffs two contentTrees by stable node ID: added/deleted/moved/changed (text) nodes. Component
 * text changes are resolved against the component's real installed schema (async, one DB lookup
 * per unique `_component` across the whole diff, cached, matching
 * lib/lightcoursewordcount.js#computeWordCount's existing caching approach).
 *
 * @param {object} treeA
 * @param {object} treeB
 * @param {object} db
 * @param {function} callback - function(error, { added, deleted, moved, changed })
 */
function diffContentTree(treeA, treeB, db, callback) {
  var mapA = buildNodeMap(treeA);
  var mapB = buildNodeMap(treeB);
  var added = [];
  var deleted = [];
  var moved = [];
  var changed = [];

  Object.keys(mapB).forEach(function (id) {
    if (!mapA[id]) {
      added.push(id);
    }
  });
  Object.keys(mapA).forEach(function (id) {
    if (!mapB[id]) {
      deleted.push(id);
    }
  });

  var commonIds = Object.keys(mapA).filter(function (id) { return mapB[id]; });

  async.eachSeries(commonIds, function (id, next) {
    var entryA = mapA[id];
    var entryB = mapB[id];

    if (entryA.parentId !== entryB.parentId || entryA.index !== entryB.index) {
      moved.push({ id: id, from: { parentId: entryA.parentId, index: entryA.index }, to: { parentId: entryB.parentId, index: entryB.index } });
    }

    var isComponent = entryA.node.type === 'component' || entryB.node.type === 'component';
    var keys = isComponent ? Object.keys(Object.assign({}, entryA.node, entryB.node))
      .filter(function(key) { return ['_id', 'children', '_componentSchemaSnapshot'].indexOf(key) === -1; })
      : Array.from(new Set(wordFields.structuralFields(entryA.node).concat(wordFields.structuralFields(entryB.node))
        .map(function(field) { return field.path; })));
    var changes = fieldDifferences(entryA.node, entryB.node, keys);
    if (changes.length) changed.push({ id: id, fieldChanges: changes });
    next();
  }, function (err) {
    callback(err, { added: added, deleted: deleted, moved: moved, changed: changed });
  });
}

/**
 * Diffs two flat `_id`-keyed item lists (glossaryItems/resourceItems/helpContent.items) by their
 * fixed, known field set - no schema resolution needed, matching
 * lib/lightcoursewordcount.js#countFixedItemsWords's treatment of these same lists.
 */
function diffFixedItems(itemsA, itemsB, fields) {
  var mapA = {};
  (itemsA || []).forEach(function (item) { if (item && item._id) { mapA[item._id] = item; } });
  var mapB = {};
  (itemsB || []).forEach(function (item) { if (item && item._id) { mapB[item._id] = item; } });

  var added = [];
  var deleted = [];
  var changed = [];

  Object.keys(mapB).forEach(function (id) { if (!mapA[id]) { added.push(id); } });
  Object.keys(mapA).forEach(function (id) { if (!mapB[id]) { deleted.push(id); } });

  Object.keys(mapA).forEach(function (id) {
    if (!mapB[id]) {
      return;
    }
    var fieldChanges = fieldDifferences(mapA[id], mapB[id], fields);
    if (fieldChanges.length) {
      changed.push({ id: id, fieldChanges: fieldChanges });
    }
  });

  return { added: added, deleted: deleted, changed: changed };
}

function diffHelpContent(helpA, helpB) {
  var itemsA = ((helpA && helpA.items) || []).slice();
  var itemsB = ((helpB && helpB.items) || []).slice();
  if (helpA && helpA.popup && Object.keys(helpA.popup).length) {
    itemsA.unshift({ _id: 'help-popup', title: helpA.popup.title, body: helpA.popup.body, instruction: helpA.popup.instruction });
  }
  if (helpB && helpB.popup && Object.keys(helpB.popup).length) {
    itemsB.unshift({ _id: 'help-popup', title: helpB.popup.title, body: helpB.popup.body, instruction: helpB.popup.instruction });
  }
  return diffFixedItems(itemsA, itemsB, ['title', 'body', 'instruction']);
}

function diffPluginSelections(a, b) {
  a = a || {};
  b = b || {};
  return {
    menu: (a.menu || null) !== (b.menu || null),
    theme: (a.theme || null) !== (b.theme || null),
    extensions: JSON.stringify((a.extensions || []).slice().sort()) !== JSON.stringify((b.extensions || []).slice().sort())
  };
}

function hasAnyChanges(result) {
  return result.courseFields.length > 0 || result.headerChanges.length > 0 || result.listOrderChanges.length > 0 ||
    result.contentTree.added.length > 0 ||
    result.contentTree.deleted.length > 0 ||
    result.contentTree.moved.length > 0 ||
    result.contentTree.changed.length > 0 ||
    result.glossaryItems.added.length > 0 || result.glossaryItems.deleted.length > 0 || result.glossaryItems.changed.length > 0 ||
    result.resourceItems.added.length > 0 || result.resourceItems.deleted.length > 0 || result.resourceItems.changed.length > 0 ||
    result.helpContent.added.length > 0 || result.helpContent.deleted.length > 0 || result.helpContent.changed.length > 0 ||
    result.pluginSelectionsChanged.menu || result.pluginSelectionsChanged.theme || result.pluginSelectionsChanged.extensions;
}

/**
 * Full ID-keyed diff between two light-course content snapshots (a draft, a version's
 * `contentSnapshot`, or anything else carrying `{ contentTree, pluginSelections, glossaryItems,
 * resourceItems, helpContent }`).
 *
 * @param {object} snapshotA
 * @param {object} snapshotB
 * @param {object} db - retained for compatibility with existing callers
 * @param {function} callback - function(error, result) - result.hasChanges is a convenience flag
 */
function diffSnapshots(snapshotA, snapshotB, db, callback) {
  diffContentTree(snapshotA.contentTree, snapshotB.contentTree, db, function (err, contentTreeDiff) {
    if (err) {
      return callback(err);
    }
    var result = {
      courseFields: fieldDifferences(snapshotA, snapshotB, ['title', 'body']),
      headerChanges: fieldDifferences(snapshotA.headerData || {}, snapshotB.headerData || {},
        Object.keys(Object.assign({}, snapshotA.headerData, snapshotB.headerData)).filter(function(key) { return key !== 'versionHistory'; })),
      listOrderChanges: ['glossaryItems', 'resourceItems', 'helpContent.items'].filter(function(key) {
        function items(snapshot) {
          return key.split('.').reduce(function(value, part) { return value && value[part]; }, snapshot) || [];
        }
        var before = items(snapshotA).map(function(item) { return item._id; });
        var after = items(snapshotB).map(function(item) { return item._id; });
        return !equal(before, after) && equal(before.slice().sort(), after.slice().sort());
      }),
      contentTree: contentTreeDiff,
      glossaryItems: diffFixedItems(snapshotA.glossaryItems, snapshotB.glossaryItems, FIXED_ITEM_FIELDS.glossaryItems),
      resourceItems: diffFixedItems(snapshotA.resourceItems, snapshotB.resourceItems, FIXED_ITEM_FIELDS.resourceItems),
      helpContent: diffHelpContent(snapshotA.helpContent, snapshotB.helpContent),
      pluginSelectionsChanged: diffPluginSelections(snapshotA.pluginSelections, snapshotB.pluginSelections)
    };
    result.hasChanges = hasAnyChanges(result);
    callback(null, result);
  });
}

module.exports = {
  buildNodeMap: buildNodeMap,
  diffContentTree: diffContentTree,
  diffFixedItems: diffFixedItems,
  diffHelpContent: diffHelpContent,
  diffPluginSelections: diffPluginSelections,
  diffSnapshots: diffSnapshots
};
