// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Light Component Default content plugin - a library of reusable component-level field-value
 * presets, one level below course templates (plugins/content/lightcoursetemplate/) and below the
 * tenant-wide course-level defaults (plugins/content/lightcourseconfig/). Multiple presets can
 * exist per `componentType`, but at most one per `componentType` may be flagged `isDefault` at
 * any time - enforced server-side below, the same "fill gaps only, explicit always wins"
 * precedence family as lightcourseconfig's course-level defaults, applied one level down.
 */

var contentmanager = require('../../../lib/contentmanager'),
    ContentPlugin = contentmanager.ContentPlugin,
    database = require('../../../lib/database'),
    permissions = require('../../../lib/permissions'),
    permissionAction = require('../../../lib/lightcourse/permissionAction'),
    usermanager = require('../../../lib/usermanager'),
    util = require('util');

function LightComponentDefaultContent () {
}

util.inherits(LightComponentDefaultContent, ContentPlugin);

/**
 * overrides base implementation of hasPermission
 *
 * Deliberately no special-case admin-only logic here: the Light Editor role (lib/role/
 * LightEditor.json) only grants "read" on this resource, so delegating straight to the standard
 * role/policy check already gives light editors read-only access while full-admin roles (which
 * grant create/update/delete via their wildcard statements) can manage presets - no extra code
 * needed.
 *
 * @param {string} action
 * @param {objectid} userId
 * @param {objectid} tenantId
 * @param {object} contentItem
 * @param {callback} next (function (err, isAllowed))
 */
LightComponentDefaultContent.prototype.hasPermission = function (action, userId, tenantId, contentItem, next) {
  if (contentItem && contentItem._tenantId && contentItem._tenantId.toString() !== tenantId.toString()) {
    return next(null, false);
  }
  var resource = permissions.buildResourceString(tenantId, '/api/content/lightcomponentdefault/' + ((contentItem && contentItem._id) || '*'));
  permissions.hasPermission(userId, permissionAction.normalize(action), resource, next);
};

/**
 * implements ContentObject#getModelName
 *
 * @return {string}
 */
LightComponentDefaultContent.prototype.getModelName = function () {
  return 'lightcomponentdefault';
};

/**
 * overrides base implementation of create - enforces the "only one isDefault per componentType
 * per tenant" singleton rule: clearing any existing default for this componentType before the
 * new record is written, so a newly-flagged default always wins over whatever was previously
 * flagged, without ever leaving two records flagged default for the same componentType.
 */
LightComponentDefaultContent.prototype.create = function (data, next) {
  if (data.isDefault !== true) {
    return ContentPlugin.prototype.create.call(this, data, next);
  }
  var self = this;
  var user = usermanager.getCurrentUser();
  database.getDatabase(function (error, db) {
    if (error) {
      return next(error);
    }
    db.update('lightcomponentdefault', {
      _tenantId: user.tenant._id,
      componentType: data.componentType,
      isDefault: true
    }, { isDefault: false }, function (updateError) {
      if (updateError) {
        return next(updateError);
      }
      ContentPlugin.prototype.create.call(self, data, next);
    });
  });
};

/**
 * overrides base implementation of update - same singleton rule as create(), above. Retrieves
 * the existing record first (same pattern lightcoursetemplate's update override already uses to
 * merge contentSnapshot) so the effective componentType is known even when the delta itself
 * doesn't carry one, and so the record being updated can be excluded from the "clear other
 * defaults" sweep by its own `_id`.
 */
LightComponentDefaultContent.prototype.update = function (search, delta, next) {
  if (delta.isDefault !== true) {
    return ContentPlugin.prototype.update.call(this, search, delta, next);
  }
  var self = this;
  this.retrieve(search, {}, function (err, results) {
    if (err) {
      return next(err);
    }
    var existing = results && results[0];
    var componentType = delta.componentType || (existing && existing.componentType);
    var ownId = (existing && existing._id) || search._id;

    database.getDatabase(function (error, db) {
      if (error) {
        return next(error);
      }
      db.update('lightcomponentdefault', {
        _tenantId: existing && existing._tenantId,
        componentType: componentType,
        isDefault: true,
        _id: { $ne: ownId }
      }, { isDefault: false }, function (updateError) {
        if (updateError) {
          return next(updateError);
        }
        ContentPlugin.prototype.update.call(self, search, delta, next);
      });
    });
  });
};

exports = module.exports = LightComponentDefaultContent;
