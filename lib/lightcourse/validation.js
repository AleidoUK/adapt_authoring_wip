// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Pure (no DB access) server-side validation helpers for the Light Course Editor's
 * create/update overrides, per docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md's "Validation"
 * section. Asset tenant-ownership checks live alongside the DB access in
 * plugins/content/lightcourse/index.js instead, since they need a live `db` connection.
 *
 * `contentTree` shape (a Phase 2 decision, not yet pinned down elsewhere - Phase 3/4 should
 * follow this shape when building the editor): `{ children: [] }` at the root - a plain
 * container, not itself a node, since a course contains *multiple* pages (per the main plan) -
 * each entry in the root `children` array is a `{ _id, type, children: [] }` node, where `type`
 * is one of `page`/`article`/`block`/`component`, nested strictly in that order, and a `block`
 * may have at most two `component` children, per the main plan's "page -> article -> block -> up
 * to two components" hierarchy rule. An empty/missing `contentTree` (a brand new draft) is valid.
 *
 * `headerData.iconChoices` convention (also a Phase 2 decision): `{ menuButton, reflection,
 * help, drawer }`, each a string value checked against lib/lightcourse/iconOptions.js. Any key
 * omitted is treated as "not yet chosen" and is not validated.
 */

var iconOptions = require('./iconOptions');
var componentLayout = require('../../frontend/src/modules/lightCourseEditor/componentLayout');
var comments = require('./comments');

var HIERARCHY = { page: 'article', article: 'block', block: 'component' };

function validateContentTree(contentTree) {
  if (!contentTree || typeof contentTree !== 'object' || Object.keys(contentTree).length === 0) {
    return null; // a brand new draft has no tree yet
  }
  if (!Array.isArray(contentTree.children)) {
    return 'contentTree root must have a "children" array of page nodes';
  }
  for (var i = 0; i < contentTree.children.length; i++) {
    var error = walkNode(contentTree.children[i], 'page');
    if (error) {
      return error;
    }
  }
  return null;
}

function walkNode(node, expectedType) {
  if (!node || typeof node !== 'object') {
    return 'contentTree node must be an object';
  }
  if (node.type !== expectedType) {
    return 'Expected a "' + expectedType + '" node but found "' + node.type + '"';
  }
  var children = node.children || [];
  if (!Array.isArray(children)) {
    return 'node "' + node._id + '" children must be an array';
  }
  var childType = HIERARCHY[node.type];
  if (node.type === 'component') {
    if (children.length > 0) {
      return 'node "' + node._id + '" is a component and cannot have children';
    }
    return comments.validate(node._comments);
  }
  if (node.type === 'block' && children.length > 2) {
    return 'block "' + node._id + '" has ' + children.length + ' components - at most two are allowed';
  }
  for (var i = 0; i < children.length; i++) {
    var error = walkNode(children[i], childType);
    if (error) {
      return error;
    }
  }
  if (node.type === 'block') {
    var layoutError = componentLayout.validate(children);
    if (layoutError) return 'block "' + node._id + '": ' + layoutError;
  }
  return null;
}

function validatePluginSelections(pluginSelections) {
  if (!pluginSelections || typeof pluginSelections !== 'object' || Object.keys(pluginSelections).length === 0) {
    return null; // not chosen yet
  }
  if (pluginSelections.menu !== undefined && typeof pluginSelections.menu !== 'string') {
    return 'pluginSelections.menu must be a single menu identifier string';
  }
  if (pluginSelections.theme !== undefined && typeof pluginSelections.theme !== 'string') {
    return 'pluginSelections.theme must be a single theme identifier string';
  }
  if (pluginSelections.extensions !== undefined && !Array.isArray(pluginSelections.extensions)) {
    return 'pluginSelections.extensions must be an array';
  }
  return null;
}

function validateItemIds(items, label) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    var id = items[i] && items[i]._id;
    if (!id || typeof id !== 'string') {
      return label + '[' + i + '] is missing a stable _id';
    }
    if (seen[id]) {
      return label + ' contains a duplicate _id "' + id + '"';
    }
    seen[id] = true;
  }
  return null;
}

function validateIconChoices(iconChoices) {
  if (!iconChoices || typeof iconChoices !== 'object') {
    return null; // not chosen yet
  }
  for (var control in iconChoices) {
    if (!Object.prototype.hasOwnProperty.call(iconChoices, control)) {
      continue;
    }
    if (iconChoices[control] === null || iconChoices[control] === undefined || iconChoices[control] === '') {
      continue; // treated the same as an omitted key - "not yet chosen", not an invalid choice
    }
    var result = iconOptions.validateIcon(control, iconChoices[control]);
    if (!result.valid) {
      return result.reason;
    }
  }
  return null;
}

/**
 * Runs every pure (non-DB) check against a lightcourse create/update payload.
 *
 * @param {object} data - the create/update payload (a full or partial lightcourse document)
 * @return {string|null} the first validation error found, or null if everything checked out
 */
function validate(data) {
  return validateContentTree(data.contentTree) ||
    validatePluginSelections(data.pluginSelections) ||
    validateItemIds(data.glossaryItems, 'glossaryItems') ||
    validateItemIds(data.resourceItems, 'resourceItems') ||
    validateItemIds(data.helpContent && data.helpContent.items, 'helpContent.items') ||
    validateIconChoices(data.headerData && data.headerData.iconChoices) ||
    null;
}

module.exports = {
  validate: validate,
  validateContentTree: validateContentTree,
  validatePluginSelections: validatePluginSelections,
  validateItemIds: validateItemIds,
  validateIconChoices: validateIconChoices
};
