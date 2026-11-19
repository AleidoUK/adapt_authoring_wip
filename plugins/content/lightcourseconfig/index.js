// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Light Course Config content plugin - one tenant-scoped admin configuration record per tenant.
 * See docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md ("3. plugins/content/lightcourseconfig/").
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
    lightcourseValidation = require('../../../lib/lightcourse/validation');

function LightCourseConfigContent () {
}

util.inherits(LightCourseConfigContent, ContentPlugin);

/**
 * Reuses lib/lightcourse/validation.js's existing per-field checks (rather than duplicating
 * icon/plugin-selection rules here) by handing it a payload shaped the way IT expects - only the
 * two fields with a real fixed shape to check against (iconDefaults' values must be one of
 * lib/lightcourse/iconOptions.js's per-control options; defaultPluginSelections.extensions must
 * be an array, etc) - the other two config fields (graphicPlaceholders/requiredDefaults) are
 * deliberately freeform admin data entry with nothing to validate against yet.
 *
 * @return {string|null} the first validation error found, or null if everything checked out
 */
function validateConfig(delta) {
  if (delta.conversionDefaults !== undefined) {
    var conversionError = require('../../../lib/lightcourse/conversionSchema').validateDefaults(delta.conversionDefaults);
    if (conversionError) return conversionError;
  }
  if (delta.defaultPluginSelections !== undefined) {
    var pluginError = lightcourseValidation.validate({ pluginSelections: delta.defaultPluginSelections });
    if (pluginError) {
      return pluginError;
    }
  }
  if (delta.iconDefaults !== undefined) {
    var iconError = lightcourseValidation.validate({ headerData: { iconChoices: delta.iconDefaults } });
    if (iconError) {
      return iconError;
    }
  }
  return null;
}

/**
 * overrides base implementation of hasPermission
 *
 * Deliberately no special-case admin-only logic here: the Light Editor role (lib/role/
 * LightEditor.json) only grants "read" on this resource, so delegating straight to the standard
 * role/policy check already gives light editors read-only access while full-admin roles (which
 * grant create/update via their wildcard statements) can manage it - no extra code needed.
 *
 * @param {string} action
 * @param {objectid} userId
 * @param {objectid} tenantId
 * @param {object} contentItem
 * @param {callback} next (function (err, isAllowed))
 */
LightCourseConfigContent.prototype.hasPermission = function (action, userId, tenantId, contentItem, next) {
  if (contentItem && contentItem._tenantId && contentItem._tenantId.toString() !== tenantId.toString()) {
    return next(null, false);
  }
  var resource = permissions.buildResourceString(tenantId, '/api/content/lightcourseconfig/' + ((contentItem && contentItem._id) || '*'));
  permissions.hasPermission(userId, permissionAction.normalize(action), resource, next);
};

/**
 * implements ContentObject#getModelName
 *
 * @return {string}
 */
LightCourseConfigContent.prototype.getModelName = function () {
  return 'lightcourseconfig';
};

/**
 * overrides base implementation of create - validates defaultPluginSelections/iconDefaults the
 * same way a light course's own pluginSelections/headerData.iconChoices are, now that the admin
 * config screen lets these be set directly (rather than only ever being read, never written, by
 * anything in the codebase before this).
 */
LightCourseConfigContent.prototype.create = function (data, next) {
  var validationError = validateConfig(data);
  if (validationError) {
    return next(new Error(validationError));
  }
  var self = this;
  validateConversionDefaults(data, function(error) {
    if (error) return next(error);
    ContentPlugin.prototype.create.call(self, data, next);
  });
};

/**
 * overrides base implementation of update - same validation as create(), above.
 */
LightCourseConfigContent.prototype.update = function (search, delta, next) {
  var validationError = validateConfig(delta);
  if (validationError) {
    return next(new Error(validationError));
  }
  var self = this;
  validateConversionDefaults(delta, function(error) {
    if (error) return next(error);
    ContentPlugin.prototype.update.call(self, search, delta, next);
  });
};

function validateConversionDefaults(data, next) {
  if (data.conversionDefaults === undefined) return next();
  var user = usermanager.getCurrentUser();
  if (!user || !user.tenant) return next(new Error('Please log in.'));
  database.getDatabase(function(error, db) {
    if (error) return next(error);
    var catalog = require('../../../lib/lightcourse/conversionCatalog');
    var schema = require('../../../lib/lightcourse/conversionSchema');
    catalog.load(db, origin().contentmanager._contentSchemas).then(function(loaded) {
      var groups = catalog.definitions(loaded);
      for (var group of groups) {
        var values = data.conversionDefaults[group.key] || {};
        for (var path of Object.keys(values)) {
          if (!group.fields.some(function(field) { return field.path === path; })) {
            return next(new Error('Not a configurable conversion field: ' + group.label + ' / ' + path));
          }
        }
        for (var field of group.fields) {
          if (Object.prototype.hasOwnProperty.call(values, field.path) && !schema.valid(field.schema, values[field.path])) {
            return next(new Error('Invalid Conversion Default: ' + group.label + ' / ' + field.path));
          }
        }
      }
      next();
    }).catch(next);
  }, user.tenant._id);
}

var CONFIG_OBJECT_FIELDS = ['defaultPluginSelections', 'graphicPlaceholders', 'requiredDefaults', 'iconDefaults', 'conversionDefaults'];

/**
 * An empty plain object `{}` value for a `Mixed`-typed Mongoose path is confirmed (via direct
 * testing against a real connection) to never get persisted/serialized - Mongoose doesn't treat
 * setting an empty object as "real" data to save, unlike a non-empty one, which works fine. Easier
 * to paper over in the response than to fight that persistence-layer quirk: fill in `{}` for
 * whichever of the four config object fields aren't actually present, so API consumers never have
 * to guess between "not chosen yet" and "field missing from the response".
 */
function withConfigDefaults(configDoc) {
  var json = configDoc.toJSON ? configDoc.toJSON() : configDoc;
  CONFIG_OBJECT_FIELDS.forEach(function (field) {
    json[field] = json[field] || {};
  });
  return json;
}

/**
 * GET /api/lightcourseconfig/mine - the admin config screen doesn't know (and shouldn't
 * need to know) its tenant's config record's `_id` up front, since one is only ever created
 * lazily on first use rather than at tenant-creation time. Returns the existing record, or
 * creates (and returns) a brand-new default-valued one if this tenant doesn't have one yet.
 */
function getOrCreateMine(req, res) {
  var user = usermanager.getCurrentUser();

  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }

    new LightCourseConfigContent().hasPermission('read', user._id, user.tenant._id, {}, function (permError, isAllowed) {
      if (permError) {
        res.statusCode = 500;
        return res.json({ success: false, message: permError.message });
      }
      if (!isAllowed) {
        res.statusCode = 403;
        return res.json({ success: false, message: 'You are not permitted to do that' });
      }

      db.retrieve('lightcourseconfig', { _tenantId: user.tenant._id }, { jsonOnly: true }, function (err, results) {
        if (err) {
          res.statusCode = 500;
          return res.json({ success: false, message: err.message });
        }
        if (results && results.length) {
          res.statusCode = 200;
          return res.json(withConfigDefaults(results[0]));
        }

        db.create('lightcourseconfig', {
          _tenantId: user.tenant._id,
          createdBy: user._id
        }, function (createErr, created) {
          if (createErr) {
            res.statusCode = 500;
            return res.json({ success: false, message: createErr.message });
          }
          // Lazy initialization is authorized by the read check above, not config-create access.
          origin().contentmanager.processContentHooks('create', 'lightcourseconfig', created, { when: 'post' }, function(hookError, result) {
            if (hookError) {
              res.statusCode = 500;
              return res.json({ success: false, message: hookError.message });
            }
            res.statusCode = 200;
            return res.json(withConfigDefaults(result));
          });
        });
      });
    });
  }, user.tenant._id);
}

/**
 * Walks every installed component/extension's schema (lib/schemaWalker.js) to find the fields an
 * admin can set a "required default" for - the config screen's third section, directly fulfilling
 * the main plan's "add defaults for templates (values and assets)" item. A type is only included
 * if it actually has at least one qualifying field, so the admin isn't shown a long list of
 * components/extensions with nothing configurable.
 *
 * Component schemas are merged with the shared plugins/content/component/model.schema fields the
 * same way lib/lightcoursewordcount.js#resolveComponentSchema does (that logic isn't exported, so
 * it's duplicated here rather than introducing a dependency the other direction); extensions have
 * no equivalent shared base schema to merge in - their `properties` document is walked as-is.
 */
function getRequiredDefaultSchema(req, res) {
  var user = usermanager.getCurrentUser();
  var schemaWalker = require('../../../lib/schemaWalker');
  var fs = require('fs');
  var componentCommonSchemaPath = require('path').join(__dirname, '..', 'component', 'model.schema');

  function hasQualifyingFields(entry) {
    return entry.requiredTranslatablePaths.length > 0 || entry.requiredAssetPaths.length > 0;
  }

  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }

    new LightCourseConfigContent().hasPermission('read', user._id, user.tenant._id, {}, function (permError, isAllowed) {
      if (permError) {
        res.statusCode = 500;
        return res.json({ success: false, message: permError.message });
      }
      if (!isAllowed) {
        res.statusCode = 403;
        return res.json({ success: false, message: 'You are not permitted to do that' });
      }

      fs.readFile(componentCommonSchemaPath, function (fsErr, commonSchemaRaw) {
        if (fsErr) {
          res.statusCode = 500;
          return res.json({ success: false, message: fsErr.message });
        }
        var commonSchema;
        try {
          commonSchema = JSON.parse(commonSchemaRaw);
        } catch (parseErr) {
          res.statusCode = 500;
          return res.json({ success: false, message: parseErr.message });
        }

        db.retrieve('componenttype', {}, { jsonOnly: true }, function (componentErr, componentTypes) {
          if (componentErr) {
            res.statusCode = 500;
            return res.json({ success: false, message: componentErr.message });
          }
          db.retrieve('extensiontype', {}, { jsonOnly: true }, function (extensionErr, extensionTypes) {
            if (extensionErr) {
              res.statusCode = 500;
              return res.json({ success: false, message: extensionErr.message });
            }

            var components = (componentTypes || []).map(function (componentType) {
              var merged = { properties: Object.assign({}, commonSchema.properties, componentType.properties || {}) };
              var walked = schemaWalker.walkSchema(merged);
              return {
                key: componentType.component,
                displayName: componentType.displayName || componentType.component,
                requiredTranslatablePaths: walked.requiredTranslatablePaths,
                requiredAssetPaths: walked.requiredAssetPaths
              };
            }).filter(hasQualifyingFields);

            var extensions = (extensionTypes || []).map(function (extensionType) {
              var walked = schemaWalker.walkSchema({ properties: extensionType.properties || {} });
              return {
                key: extensionType.extension,
                displayName: extensionType.displayName || extensionType.extension,
                requiredTranslatablePaths: walked.requiredTranslatablePaths,
                requiredAssetPaths: walked.requiredAssetPaths
              };
            }).filter(hasQualifyingFields);

            res.statusCode = 200;
            return res.json({ components: components, extensions: extensions });
          });
        });
      });
    });
  }, user.tenant._id);
}

function initialize() {
  // outside the generic /api/content/:type/:id namespace (and ignored by the generic policy
  // checker below) specifically to avoid colliding with that same generic route pattern - a
  // path of /content/lightcourseconfig/mine would itself match /content/:type/:id (type=
  // "lightcourseconfig", id="mine") and, since the generic route is registered earlier in the
  // boot sequence (during ContentManager's own preload, before any content plugin's own
  // 'serverStarted' hook runs), would shadow this route entirely.
  permissions.ignoreRoute(/^\/api\/lightcourseconfig\/?.*$/);
  origin().once('serverStarted', function () {
    rest.get('/lightcourseconfig/mine', getOrCreateMine);
    rest.get('/lightcourseconfig/requireddefaultschema', getRequiredDefaultSchema);
    rest.get('/lightcourseconfig/conversionschema', function(req, res) {
      var user = usermanager.getCurrentUser();
      if (!user || !user.tenant) return res.status(401).json({ message: 'Please log in.' });
      var resource = permissions.buildResourceString(user.tenant._id, '/*');
      permissions.hasPermission(user._id, 'update', resource, function(error, allowed) {
        if (error) return res.status(500).json({ message: error.message });
        if (!allowed) return res.status(403).json({ message: 'Only administrators can configure conversion defaults.' });
        database.getDatabase(function(error, db) {
          if (error) return res.status(500).json({ message: error.message });
          var catalog = require('../../../lib/lightcourse/conversionCatalog');
          catalog.load(db, origin().contentmanager._contentSchemas).then(function(loaded) {
            res.status(200).json(catalog.definitions(loaded));
          }).catch(function(error) { res.status(500).json({ message: error.message }); });
        }, user.tenant._id);
      });
    });
  });
}

initialize();

exports = module.exports = LightCourseConfigContent;
