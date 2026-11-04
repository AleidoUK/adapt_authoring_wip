// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Light Course Bank Asset content plugin - a separate join collection from `courseasset`, so
 * full-course asset-usage logic in lib/assetmanager.js (ASSET_USAGE_CONTENT_TYPES/assetUses())
 * is never silently affected by light-course rows. Light courses get their own "used in this
 * course" indicator sourced from this collection instead (Phase 4 decision, see
 * docs/LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md).
 *
 * Attach/detach are just create/destroy on this collection - no delete-from-bank route exists
 * here, that stays on the real `asset` collection via the existing lib/assetmanager.js delete
 * path, gated by role (the Light Editor role deliberately omits `delete` on `/api/asset/*`).
 *
 * See docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md ("4. plugins/content/lightcoursebankasset/").
 */

var contentmanager = require('../../../lib/contentmanager'),
    ContentPlugin = contentmanager.ContentPlugin,
    permissions = require('../../../lib/permissions'),
    permissionAction = require('../../../lib/lightcourse/permissionAction'),
    util = require('util');

function LightCourseBankAssetContent () {
}

util.inherits(LightCourseBankAssetContent, ContentPlugin);

/**
 * overrides base implementation of hasPermission
 *
 * @param {string} action
 * @param {objectid} userId
 * @param {objectid} tenantId
 * @param {object} contentItem
 * @param {callback} next (function (err, isAllowed))
 */
LightCourseBankAssetContent.prototype.hasPermission = function (action, userId, tenantId, contentItem, next) {
  if (contentItem && contentItem._tenantId && contentItem._tenantId.toString() !== tenantId.toString()) {
    return next(null, false);
  }
  var resource = permissions.buildResourceString(tenantId, '/api/content/lightcoursebankasset/' + ((contentItem && contentItem._id) || '*'));
  permissions.hasPermission(userId, permissionAction.normalize(action), resource, next);
};

/**
 * implements ContentObject#getModelName
 *
 * @return {string}
 */
LightCourseBankAssetContent.prototype.getModelName = function () {
  return 'lightcoursebankasset';
};

exports = module.exports = LightCourseBankAssetContent;
