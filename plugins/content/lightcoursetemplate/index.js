// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Light Course Template content plugin.
 * See docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md ("5. plugins/content/lightcoursetemplate/").
 */

var contentmanager = require('../../../lib/contentmanager'),
    ContentPlugin = contentmanager.ContentPlugin,
    database = require('../../../lib/database'),
    permissions = require('../../../lib/permissions'),
    permissionAction = require('../../../lib/lightcourse/permissionAction'),
    usermanager = require('../../../lib/usermanager'),
    rest = require('../../../lib/rest'),
    origin = require('../../../'),
    util = require('util'),
    idRegeneration = require('../../../lib/lightcourse/idRegeneration'),
    lightcourseValidation = require('../../../lib/lightcourse/validation');

function LightCourseTemplateContent () {
}

util.inherits(LightCourseTemplateContent, ContentPlugin);

/**
 * Fills in any missing `_id` on glossary/resource/help items in a template's contentSnapshot, in
 * place - mirrors plugins/content/lightcourse/index.js's own assignMissingItemIds() exactly
 * (small enough, and specific enough to this one job, that sharing the ID-*generation* itself via
 * lib/lightcourse/idRegeneration.js's generateStableId() is enough to avoid real duplication).
 */
function assignMissingItemIds(items) {
  (items || []).forEach(function (item) {
    if (item && !item._id) {
      item._id = idRegeneration.generateStableId();
    }
  });
}

/**
 * Validates and ID-assigns a template's contentSnapshot before it's written - reuses
 * lib/lightcourse/validation.js exactly as light course drafts do, since a template's
 * contentSnapshot is the same `{ contentTree, pluginSelections, glossaryItems, resourceItems,
 * helpContent }` shape (confirmed: it's copied wholesale into a new draft's own top-level fields
 * when creating a light course from a template).
 *
 * @return {string|null} the first validation error found, or null if everything checked out
 */
function validateContentSnapshot(contentSnapshot) {
  if (!contentSnapshot || typeof contentSnapshot !== 'object') {
    return null; // an empty/not-yet-built template is valid
  }
  assignMissingItemIds(contentSnapshot.glossaryItems);
  assignMissingItemIds(contentSnapshot.resourceItems);
  assignMissingItemIds(contentSnapshot.helpContent && contentSnapshot.helpContent.items);
  return lightcourseValidation.validate(contentSnapshot);
}

/**
 * overrides base implementation of hasPermission
 *
 * Deliberately no special-case admin-only logic here: the Light Editor role (lib/role/
 * LightEditor.json) only grants "read" (needed for the create-from-template picker), so
 * delegating straight to the standard role/policy check already gives light editors read-only
 * access while full-admin roles (which grant create/update/delete via their wildcard
 * statements) can manage templates - no extra code needed.
 *
 * @param {string} action
 * @param {objectid} userId
 * @param {objectid} tenantId
 * @param {object} contentItem
 * @param {callback} next (function (err, isAllowed))
 */
LightCourseTemplateContent.prototype.hasPermission = function (action, userId, tenantId, contentItem, next) {
  if (contentItem && contentItem._tenantId && contentItem._tenantId.toString() !== tenantId.toString()) {
    return next(null, false);
  }
  var resource = permissions.buildResourceString(tenantId, '/api/content/lightcoursetemplate/' + ((contentItem && contentItem._id) || '*'));
  permissions.hasPermission(userId, permissionAction.normalize(action), resource, next);
};

/**
 * implements ContentObject#getModelName
 *
 * @return {string}
 */
LightCourseTemplateContent.prototype.getModelName = function () {
  return 'lightcoursetemplate';
};

/**
 * overrides base implementation of create - validates/ID-assigns contentSnapshot the same way
 * light course drafts are, now that the admin template editor (not just "promote from version")
 * can write arbitrary content directly.
 */
LightCourseTemplateContent.prototype.create = function (data, next) {
  var self = this;
  function save() {
    var validationError = validateContentSnapshot(data.contentSnapshot);
    if (validationError) {
      return next(new Error(validationError));
    }
    ContentPlugin.prototype.create.call(self, data, next);
  }
  // A supplied snapshot (including an intentionally empty one) belongs to a clone/import.
  if (data.contentSnapshot !== undefined) {
    return save();
  }
  var user = usermanager.getCurrentUser();
  database.getDatabase(function(error, db) {
    if (error) {
      return next(error);
    }
    db.retrieve('lightcourseconfig', { _tenantId: user.tenant._id }, { jsonOnly: true }, function(error, results) {
      if (error) {
        return next(error);
      }
      var config = (results && results[0]) || {};
      data.contentSnapshot = {
        pluginSelections: JSON.parse(JSON.stringify(config.defaultPluginSelections || {})),
        headerData: { iconChoices: JSON.parse(JSON.stringify(config.iconDefaults || {})) }
      };
      save();
    });
  });
};

/**
 * overrides base implementation of update - same validation/ID-assignment as create(), run
 * against whatever the delta's contentSnapshot would become (merged with the existing record,
 * since a PUT payload may only be touching part of it, e.g. just the `name`/`description`).
 */
LightCourseTemplateContent.prototype.update = function (search, delta, next) {
  if (!delta.contentSnapshot) {
    return ContentPlugin.prototype.update.call(this, search, delta, next);
  }
  var self = this;
  this.retrieve(search, {}, function (err, results) {
    if (err) {
      return next(err);
    }
    var existing = results && results[0];
    var merged = Object.assign({}, existing && existing.contentSnapshot, delta.contentSnapshot);
    var validationError = validateContentSnapshot(merged);
    if (validationError) {
      return next(new Error(validationError));
    }
    delta.contentSnapshot = merged;
    ContentPlugin.prototype.update.call(self, search, delta, next);
  });
};

/**
 * "Promote an existing light course version into a template" - copies a lightcourseversion's
 * contentSnapshot into a new template record with freshly generated stable node IDs, reusing
 * the same regeneration helper needed when creating a light course from a template.
 */
function fromVersion(req, res) {
  var versionId = req.params.versionId;
  // see the matching comment in plugins/content/lightcourse/index.js's publishVersion - req.user
  // doesn't carry a populated `tenant`, usermanager.getCurrentUser() does.
  var user = usermanager.getCurrentUser();

  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }

    db.retrieve('lightcourseversion', { _id: versionId }, { jsonOnly: true }, function (err, results) {
      if (err) {
        res.statusCode = 500;
        return res.json({ success: false, message: err.message });
      }
      if (!results || !results.length) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'Version not found' });
      }
      var version = results[0];

      new LightCourseTemplateContent().hasPermission('create', user._id, user.tenant._id, {}, function (permError, isAllowed) {
        if (permError) {
          res.statusCode = 500;
          return res.json({ success: false, message: permError.message });
        }
        if (!isAllowed) {
          res.statusCode = 403;
          return res.json({ success: false, message: 'You are not permitted to do that' });
        }

        origin().contentmanager.create('lightcoursetemplate', {
          _tenantId: user.tenant._id,
          name: req.body.name || ('Template from version ' + version.versionNumber),
          description: req.body.description || '',
          tags: (version.contentSnapshot.tags || []).map(function(tag) { return typeof tag === 'string' ? tag : tag._id; }),
          contentSnapshot: idRegeneration.regenerateSnapshotIds(version.contentSnapshot),
          createdBy: user._id
        }, function (err, template) {
          if (err) {
            res.statusCode = 500;
            return res.json({ success: false, message: err.message });
          }
          res.statusCode = 200;
          return res.json(template);
        });
      });
    });
  }, user.tenant._id);
}

function initialize() {
  origin().once('serverStarted', function () {
    rest.post('/content/lightcoursetemplate/from-version/:versionId', fromVersion);
  });
}

initialize();

exports = module.exports = LightCourseTemplateContent;
