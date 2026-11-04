// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Light Course Export content plugin - point-in-time copies of rendered document exports.
 * See docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md ("2. plugins/content/lightcourseversion/",
 * final bullet). Fleshed out further by Phase 5 (document generation).
 */

var contentmanager = require('../../../lib/contentmanager'),
    ContentPlugin = contentmanager.ContentPlugin,
    permissions = require('../../../lib/permissions'),
    permissionAction = require('../../../lib/lightcourse/permissionAction'),
    util = require('util');

function LightCourseExportContent () {
}

util.inherits(LightCourseExportContent, ContentPlugin);

/**
 * overrides base implementation of hasPermission
 *
 * Exports are immutable once created - the whole point is to keep earlier exports retrievable
 * even after the draft/version changes further, so update/delete are always denied.
 *
 * @param {string} action
 * @param {objectid} userId
 * @param {objectid} tenantId
 * @param {object} contentItem
 * @param {callback} next (function (err, isAllowed))
 */
LightCourseExportContent.prototype.hasPermission = function (action, userId, tenantId, contentItem, next) {
  if ('update' === action || 'delete' === action) {
    return next(null, false);
  }
  if (contentItem && contentItem._tenantId && contentItem._tenantId.toString() !== tenantId.toString()) {
    return next(null, false);
  }
  var resource = permissions.buildResourceString(tenantId, '/api/content/lightcourseexport/' + ((contentItem && contentItem._id) || '*'));
  permissions.hasPermission(userId, permissionAction.normalize(action), resource, next);
};

/**
 * implements ContentObject#getModelName
 *
 * @return {string}
 */
LightCourseExportContent.prototype.getModelName = function () {
  return 'lightcourseexport';
};

exports = module.exports = LightCourseExportContent;
