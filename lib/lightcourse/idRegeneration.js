// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Shared stable-ID regeneration helper, used both directions per
 * docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md ("5. plugins/content/lightcoursetemplate/"):
 * promoting a lightcourseversion snapshot into a template, and (in a later phase) creating a new
 * light course draft from a template. Both need a fresh, non-shared set of node IDs so editing
 * one copy never mutates another that happened to be created from the same source snapshot.
 *
 * Regenerates `_id` on every contentTree node (recursing into `children`, matching the node
 * shape agreed in lib/lightcourse/validation.js) and on every glossaryItems/resourceItems entry.
 * contentTree node shape isn't finalized until Phase 3/4 build the editor - revisit this if that
 * shape changes to include cross-references that would also need remapping.
 */

var crypto = require('crypto');

function generateStableId() {
  return crypto.randomBytes(12).toString('hex');
}

function regenerateContentTreeIds(node) {
  if (!node || typeof node !== 'object') {
    return node;
  }
  var clone = Object.assign({}, node);
  clone._id = generateStableId();
  if (Array.isArray(clone.children)) {
    clone.children = clone.children.map(regenerateContentTreeIds);
  }
  return clone;
}

/**
 * Regenerates IDs starting from the contentTree *root*, which is a plain `{ children: [] }`
 * container (not itself a node - see lib/lightcourse/validation.js) - its own top-level page
 * children get regenerated, but the root container itself has no `_id` to replace.
 */
function regenerateContentTree(root) {
  if (!root || typeof root !== 'object') {
    return root;
  }
  return Object.assign({}, root, {
    children: Array.isArray(root.children) ? root.children.map(regenerateContentTreeIds) : root.children
  });
}

function regenerateItemListIds(items) {
  if (!Array.isArray(items)) {
    return items;
  }
  return items.map(function (item) {
    if (!item || typeof item !== 'object') {
      return item;
    }
    return Object.assign({}, item, { _id: generateStableId() });
  });
}

/**
 * @param {object} contentSnapshot - `{ contentTree, pluginSelections, glossaryItems,
 *   resourceItems, helpContent }`, as stored on lightcourseversion.contentSnapshot/
 *   lightcoursetemplate.contentSnapshot
 * @return {object} a deep copy with every stable ID replaced
 */
function regenerateSnapshotIds(contentSnapshot) {
  if (!contentSnapshot || typeof contentSnapshot !== 'object') {
    return contentSnapshot;
  }
  var result = Object.assign({}, contentSnapshot, {
    contentTree: regenerateContentTree(contentSnapshot.contentTree),
    glossaryItems: regenerateItemListIds(contentSnapshot.glossaryItems),
    resourceItems: regenerateItemListIds(contentSnapshot.resourceItems)
  });
  if (contentSnapshot.helpContent) {
    result.helpContent = Object.assign({}, contentSnapshot.helpContent, {
      items: regenerateItemListIds(contentSnapshot.helpContent.items)
    });
  }
  return result;
}

module.exports = {
  generateStableId: generateStableId,
  regenerateSnapshotIds: regenerateSnapshotIds
};
