// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Light Course content plugin - the editable draft.
 * See docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md ("1. plugins/content/lightcourse/").
 */

var contentmanager = require('../../../lib/contentmanager'),
    ContentPlugin = contentmanager.ContentPlugin,
    ContentPermissionError = contentmanager.errors.ContentPermissionError,
    ContentConflictError = contentmanager.errors.ContentConflictError,
    database = require('../../../lib/database'),
    permissions = require('../../../lib/permissions'),
    usermanager = require('../../../lib/usermanager'),
    logger = require('../../../lib/logger'),
    rest = require('../../../lib/rest'),
    origin = require('../../../'),
    async = require('async'),
    crypto = require('crypto'),
    util = require('util'),
    lightcourseValidation = require('../../../lib/lightcourse/validation'),
    idRegeneration = require('../../../lib/lightcourse/idRegeneration'),
    permissionAction = require('../../../lib/lightcourse/permissionAction'),
    wordcount = require('../../../lib/lightcoursewordcount'),
    versionDiff = require('../../../lib/lightcourse/versionDiff');

function LightCourseContent () {
}

util.inherits(LightCourseContent, ContentPlugin);

// Fallback extensions pre-selected for a newly created light course (no template) when the
// tenant hasn't configured its own defaultPluginSelections.extensions yet via the admin "Light
// Course Defaults" config screen (plugins/content/lightcourseconfig/) - per explicit product
// request, confirmed these match real installed extensiontype.extension values on this instance
// (Unique ID/Footer/Styling/Trickle/Spoor/Hero), not the mismatched adapt-aleido-*/adapt-contrib-*
// names an earlier phase incorrectly assumed (see the live-DB fix from the Menu/Reflection/Help
// icon dropdown bug). A course created *from a template* keeps the template's own extension
// selection untouched - these defaults only fill in a blank course.
var DEFAULT_NEW_COURSE_EXTENSIONS = ['uniqueId', 'footer', 'styling', 'trickle', 'spoor', 'hero'];

/**
 * Mints a stable, non-Mongo-ObjectId string identifier - used for content-tree nodes and
 * glossary/resource items so they keep the same ID across versions/conversion, independent of
 * whatever a given Mongo document's own _id happens to be (see Phase 1/2 for why an ObjectId
 * can't be reused as the stable per-node ID).
 */
function generateStableId() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Fills in any missing `_id` on glossary/resource items in place, so editors never have to mint
 * their own IDs client-side.
 */
function assignMissingItemIds(items) {
  if (!Array.isArray(items)) {
    return;
  }
  items.forEach(function (item) {
    if (item && !item._id) {
      item._id = generateStableId();
    }
  });
}

/**
 * Checks every `_assetId` referenced by resourceItems exists and belongs to the given tenant,
 * per the main plan's "referenced asset IDs exist and belong to the current tenant" requirement.
 */
function validateAssetOwnership(db, data, tenantId, next) {
  var assetIds = (data.resourceItems || [])
    .map(function (item) { return item && item._assetId; })
    .filter(function (id) { return !!id; });

  if (!assetIds.length) {
    return next(null);
  }
  db.retrieve('asset', { _id: { $in: assetIds } }, { jsonOnly: true }, function (err, results) {
    if (err) {
      return next(err);
    }
    var found = {};
    (results || []).forEach(function (asset) {
      if (asset._tenantId && asset._tenantId.toString() === tenantId) {
        found[asset._id.toString()] = true;
      }
    });
    var missing = assetIds.filter(function (id) { return !found[id.toString()]; });
    if (missing.length) {
      return next('Referenced asset(s) not found for this tenant: ' + missing.join(', '));
    }
    next(null);
  });
}

/**
 * Runs all server-side validation (pure + asset-ownership) against a create/update payload.
 */
function validatePayload(db, data, tenantId, next) {
  var pureError = lightcourseValidation.validate(data);
  if (pureError) {
    return next(pureError);
  }
  validateAssetOwnership(db, data, tenantId, next);
}

/**
 * overrides base implementation of hasPermission
 *
 * Tenant isolation first (a lightcourse belonging to another tenant is never visible, regardless
 * of role - in practice this is backstopped by each tenant having its own database, but this is
 * an explicit defence-in-depth check), then delegate to the standard role/policy mechanism
 * scoped to the light-editor resource - NOT helpers.hasCoursePermission, which is tied to
 * full-course sharing rules the Light Editor role should not inherit.
 *
 * @param {string} action
 * @param {objectid} userId
 * @param {objectid} tenantId
 * @param {object} contentItem
 * @param {callback} next (function (err, isAllowed))
 */
LightCourseContent.prototype.hasPermission = function (action, userId, tenantId, contentItem, next) {
  if (contentItem && contentItem._tenantId && contentItem._tenantId.toString() !== tenantId.toString()) {
    return next(null, false);
  }
  if (('update' === action || 'delete' === action) && contentItem && contentItem.conversionStatus === 'converted') {
    return next(null, false); // converted drafts are locked against further mutation
  }
  var resource = permissions.buildResourceString(tenantId, '/api/content/lightcourse/' + ((contentItem && contentItem._id) || '*'));
  permissions.hasPermission(userId, permissionAction.normalize(action), resource, next);
};

/**
 * implements ContentObject#getModelName
 *
 * @return {string}
 */
LightCourseContent.prototype.getModelName = function () {
  return 'lightcourse';
};

/**
 * overrides base implementation of create - optionally applies a template's content (with
 * freshly regenerated stable IDs, reusing the same lib/lightcourse/idRegeneration.js helper used
 * by lightcoursetemplate's "promote version to template" route, per the main plan's "one shared
 * helper used both directions"), mints missing glossary/resource item IDs, and runs server-side
 * validation before delegating to the base implementation.
 */
LightCourseContent.prototype.create = function (data, next) {
  var user = usermanager.getCurrentUser();
  var self = this;
  var templateId = data._templateId;
  delete data._templateId; // not a lightcourse model field

  database.getDatabase(function (error, db) {
    if (error) {
      return next(error);
    }

    function proceed() {
      assignMissingItemIds(data.glossaryItems);
      assignMissingItemIds(data.resourceItems);
      assignMissingItemIds(data.helpContent && data.helpContent.items);

      validatePayload(db, data, user.tenant._id.toString(), function (validationError) {
        if (validationError) {
          return next(new Error(validationError));
        }
        ContentPlugin.prototype.create.call(self, data, next);
      });
    }

    if (!templateId) {
      // only a blank (no-template) course gets admin-configured defaults - a template represents
      // a deliberate, specific configuration that shouldn't be silently augmented.
      db.retrieve('lightcourseconfig', { _tenantId: user.tenant._id }, { jsonOnly: true }, function (configError, configResults) {
        if (configError) {
          return next(configError);
        }
        var config = (configResults && configResults[0]) || {};
        var defaultSelections = config.defaultPluginSelections || {};
        data.pluginSelections = data.pluginSelections || {};
        if (data.pluginSelections.menu === undefined && defaultSelections.menu !== undefined) {
          data.pluginSelections.menu = defaultSelections.menu;
        }
        if (data.pluginSelections.theme === undefined && defaultSelections.theme !== undefined) {
          data.pluginSelections.theme = defaultSelections.theme;
        }
        if (data.pluginSelections.extensions === undefined) {
          // admin-configured extensions take priority; DEFAULT_NEW_COURSE_EXTENSIONS is only a
          // sensible out-of-the-box fallback for a tenant that hasn't configured any yet.
          data.pluginSelections.extensions = (defaultSelections.extensions && defaultSelections.extensions.length)
            ? defaultSelections.extensions.slice()
            : DEFAULT_NEW_COURSE_EXTENSIONS.slice();
        }

        // same "admin default, only for a blank course, only filling in what wasn't already
        // explicitly supplied" approach as pluginSelections above - the editor itself (see
        // lightCourseHeaderView.js) is still entirely free to change these afterwards.
        var iconDefaults = config.iconDefaults || {};
        if (Object.keys(iconDefaults).length) {
          data.headerData = data.headerData || {};
          data.headerData.iconChoices = Object.assign({}, iconDefaults, data.headerData.iconChoices || {});
        }
        proceed();
      });
      return;
    }

    db.retrieve('lightcoursetemplate', { _id: templateId }, { jsonOnly: true }, function (err, results) {
      if (err) {
        return next(err);
      }
      if (!results || !results.length) {
        return next(new Error('Template not found'));
      }
      var template = results[0];
      if (template._tenantId && template._tenantId.toString() !== user.tenant._id.toString()) {
        return next(new ContentPermissionError());
      }
      var snapshot = idRegeneration.regenerateSnapshotIds(template.contentSnapshot) || {};
      data.contentTree = snapshot.contentTree || {};
      data.pluginSelections = snapshot.pluginSelections || {};
      data.glossaryItems = snapshot.glossaryItems || [];
      data.resourceItems = snapshot.resourceItems || [];
      data.helpContent = snapshot.helpContent || {};
      proceed();
    });
  });
};

/**
 * overrides base implementation of destroy - deleting a light course would otherwise leave
 * orphaned `lightcourseversion`/`lightcourseexport`/`lightcoursebankasset` records behind it
 * (none of those are cascaded automatically, since they're keyed by `_lightCourseId`, not the
 * generic `_parentId` ContentPlugin#destroyChildren expects). Cascade them first, then let the
 * base implementation remove the light course itself (still runs the normal permission check,
 * including the "converted courses are locked" rule in #hasPermission above).
 */
LightCourseContent.prototype.destroy = function (search, force, next) {
  if ('function' === typeof force) {
    next = force;
    force = false;
  }
  var self = this;

  self.retrieve(search, {}, function (err, results) {
    if (err) {
      return next(err);
    }
    if (!results || !results.length) {
      return next(null); // nothing to remove - matches the base implementation's own no-op
    }
    var lightCourseId = results[0]._id;

    async.eachSeries(['lightcourseversion', 'lightcourseexport', 'lightcoursebankasset'], function (type, cb) {
      origin().contentmanager.getContentPlugin(type, function (pluginError, plugin) {
        if (pluginError) {
          return cb(pluginError);
        }
        // force: true - cascaded children should never be blocked by their own immutability
        // rules (lightcourseversion/lightcourseexport normally deny delete outright) once their
        // parent light course is itself being removed.
        plugin.destroy({ _lightCourseId: lightCourseId }, true, cb);
      });
    }, function (cascadeError) {
      if (cascadeError) {
        return next(cascadeError);
      }
      ContentPlugin.prototype.destroy.call(self, search, force, next);
    });
  });
};

/**
 * overrides base implementation of update - implements the optimistic-concurrency `revision`
 * check (atomic conditional update, 409 on mismatch) and re-runs validation, per the
 * "Concurrency" and "Validation" sections of docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md.
 */
LightCourseContent.prototype.update = function (search, delta, next) {
  var user = usermanager.getCurrentUser();
  var self = this;

  if ('number' !== typeof delta.revision) {
    return next(new Error('a client-known "revision" value is required to save a light course'));
  }

  assignMissingItemIds(delta.glossaryItems);
  assignMissingItemIds(delta.resourceItems);
  assignMissingItemIds(delta.helpContent && delta.helpContent.items);

  database.getDatabase(function (error, db) {
    if (error) {
      return next(error);
    }

    db.retrieve('lightcourse', search, { jsonOnly: true }, function (err, existingResults) {
      if (err) {
        return next(err);
      }
      if (!existingResults || !existingResults.length) {
        return next(new ContentConflictError('Light course not found'));
      }
      var existing = existingResults[0];

      self.hasPermission('update', user._id, user.tenant._id, existing, function (permError, isAllowed) {
        if (permError) {
          return next(permError);
        }
        if (!isAllowed) {
          return next(new ContentPermissionError());
        }

        validatePayload(db, Object.assign({}, existing, delta), user.tenant._id.toString(), function (validationError) {
          if (validationError) {
            return next(new Error(validationError));
          }

          var merged = Object.assign({}, existing, delta);

          // Auto-append a Version History row on every successful draft save, per the main plan
          // ("A new row is added automatically whenever an exported document is re-imported, or
          // an editor can add one manually") - extended on direct user request to also cover
          // every Save Draft, replacing the old manual "Add row" button (still available
          // server-side via headerData.versionHistory being a plain array the client can push
          // onto, but the frontend no longer exposes a button for it).
          wordcount.computeWordCount(merged, db, function (wcError, wordCountResult) {
            if (wcError) {
              return next(wcError);
            }

            var clientRevision = delta.revision;
            var setDelta = Object.assign({}, delta);
            delete setDelta.revision; // revision itself is managed exclusively via $inc below
            setDelta.updatedAt = new Date();
            setDelta.updatedBy = user._id;

            var headerData = Object.assign({}, delta.headerData || existing.headerData || {});
            headerData.versionHistory = (headerData.versionHistory || []).concat([{
              version: existing.currentVersionNumber || '-',
              date: new Date().toISOString().slice(0, 10),
              author: user.email || '',
              notes: '',
              screens: wordCountResult.screens,
              words: wordCountResult.total,
              duration: ''
            }]);
            setDelta.headerData = headerData;

            var Model = db.getModel('lightcourse');
            Model.findOneAndUpdate(
              { _id: existing._id, revision: clientRevision },
              { $set: setDelta, $inc: { revision: 1 } },
              { new: true },
              function (err, updated) {
                if (err) {
                  return next(err);
                }
                if (!updated) {
                  // somebody else saved first - the client's revision is stale
                  return next(new ContentConflictError('This light course has changed since it was last loaded - please reload and try again'));
                }
                return next(null, updated);
              }
            );
          });
        });
      });
    });
  }, (search && search._tenantId) || undefined);
};

/**
 * Computes the next version number following the main plan's rule: first version is "1.0";
 * minor increments the second number; major increments the first and resets the second to 0.
 */
function nextVersionNumber(draft, bump) {
  if (!draft.versionMajor) { // no version published yet
    return { versionMajor: 1, versionMinor: 0 };
  }
  if (bump === 'major') {
    return { versionMajor: draft.versionMajor + 1, versionMinor: 0 };
  }
  return { versionMajor: draft.versionMajor, versionMinor: (draft.versionMinor || 0) + 1 };
}

/**
 * Publishes a new immutable lightcourseversion snapshot of the given draft.
 *
 * The `revision`-guarded findOneAndUpdate below is the single serialization point: only one
 * concurrent publish request can match a given draft's current `revision` value, so whichever
 * request "wins" that atomic update has an exclusive claim to compute and persist the next
 * version number - no separate locking is needed for that part.
 */
function publishVersion(req, res) {
  var id = req.params.id;
  var clientRevision = req.body.revision;
  var bump = req.body.bump === 'major' ? 'major' : 'minor';
  // NOTE: req.user (set by passport's deserializeUser) only carries the raw user record, not a
  // populated `tenant` object - usermanager.getCurrentUser() reads the session-serialized form
  // which does include it, matching how ContentPlugin.prototype.create/update/retrieve/destroy
  // resolve the current user internally.
  var user = usermanager.getCurrentUser();

  if ('number' !== typeof clientRevision) {
    res.statusCode = 400;
    return res.json({ success: false, message: 'a client-known "revision" value is required to publish a version' });
  }

  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }

    db.retrieve('lightcourse', { _id: id }, { jsonOnly: true }, function (err, results) {
      if (err) {
        res.statusCode = 500;
        return res.json({ success: false, message: err.message });
      }
      if (!results || !results.length) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'Light course not found' });
      }
      var draft = results[0];

      new LightCourseContent().hasPermission('update', user._id, user.tenant._id, draft, function (permError, isAllowed) {
        if (permError) {
          res.statusCode = 500;
          return res.json({ success: false, message: permError.message });
        }
        if (!isAllowed) {
          res.statusCode = 403;
          return res.json({ success: false, message: 'You are not permitted to do that' });
        }

        var versionInfo = nextVersionNumber(draft, bump);
        var currentVersionNumber = versionInfo.versionMajor + '.' + versionInfo.versionMinor;

        var Model = db.getModel('lightcourse');
        Model.findOneAndUpdate(
          { _id: id, revision: clientRevision },
          {
            $set: {
              versionMajor: versionInfo.versionMajor,
              versionMinor: versionInfo.versionMinor,
              currentVersionNumber: currentVersionNumber,
              updatedAt: new Date(),
              updatedBy: user._id
            },
            $inc: { revision: 1 }
          },
          { new: true },
          function (err, updatedDraft) {
            if (err) {
              res.statusCode = 500;
              return res.json({ success: false, message: err.message });
            }
            if (!updatedDraft) {
              res.statusCode = 409;
              return res.json({ success: false, message: 'This light course has changed since it was last loaded - please reload and try again' });
            }

            // Routed through app.contentmanager.create() (not a raw db.create()) so the generic
            // wildcard audit-log hook (plugins/content/auditlog/index.js) fires for this too -
            // confirmed its base ContentPlugin#create has no other side effects beyond what
            // db.create() already did (schema validation, createdAt/_type defaults).
            origin().contentmanager.create('lightcourseversion', {
              _tenantId: user.tenant._id,
              _lightCourseId: id,
              versionNumber: currentVersionNumber,
              contentSnapshot: {
                contentTree: updatedDraft.contentTree,
                pluginSelections: updatedDraft.pluginSelections,
                glossaryItems: updatedDraft.glossaryItems,
                resourceItems: updatedDraft.resourceItems,
                helpContent: updatedDraft.helpContent
              },
              headerSnapshot: updatedDraft.headerData,
              schemaFormatVersion: 1,
              createdBy: user._id
            }, function (err, version) {
              if (err) {
                res.statusCode = 500;
                return res.json({ success: false, message: err.message });
              }
              res.statusCode = 200;
              return res.json(version);
            });
          }
        );
      });
    });
  }, user.tenant._id);
}

function listVersions(req, res) {
  var user = usermanager.getCurrentUser();
  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }
    db.retrieve('lightcourseversion', { _lightCourseId: req.params.id }, { jsonOnly: true }, function (err, results) {
      if (err) {
        res.statusCode = 500;
        return res.json({ success: false, message: err.message });
      }
      res.statusCode = 200;
      return res.json(results || []);
    });
  }, user.tenant._id);
}

function getVersion(req, res) {
  var user = usermanager.getCurrentUser();
  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }
    db.retrieve('lightcourseversion', { _id: req.params.versionId, _lightCourseId: req.params.id }, { jsonOnly: true }, function (err, results) {
      if (err) {
        res.statusCode = 500;
        return res.json({ success: false, message: err.message });
      }
      if (!results || !results.length) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'Version not found' });
      }
      res.statusCode = 200;
      return res.json(results[0]);
    });
  }, user.tenant._id);
}

/**
 * Diffs two version snapshots, keyed by stable node ID, per
 * docs/LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md: added/deleted/moved/changed content-tree
 * nodes, glossary/resource/help item changes, and a pluginSelections set comparison - all via the
 * shared lib/lightcourse/versionDiff.js service (also used by the document-import route to detect
 * unsaved draft changes before an import would overwrite them).
 */
function compareVersions(req, res) {
  var user = usermanager.getCurrentUser();
  var ids = [req.query.a, req.query.b];
  if (!ids[0] || !ids[1]) {
    res.statusCode = 400;
    return res.json({ success: false, message: 'both "a" and "b" version ids are required' });
  }
  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }
    db.retrieve('lightcourseversion', { _id: { $in: ids }, _lightCourseId: req.params.id }, { jsonOnly: true }, function (err, results) {
      if (err) {
        res.statusCode = 500;
        return res.json({ success: false, message: err.message });
      }
      // a===b is a valid "compare a version against itself" request (e.g. to confirm "no
      // changes") - $in naturally de-duplicates a repeated id to a single matching document, so
      // the usual "exactly 2 results" check doesn't apply in that case.
      var expectedCount = ids[0] === ids[1] ? 1 : 2;
      if (!results || results.length !== expectedCount) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'One or both versions were not found' });
      }
      var a = results.find(function (v) { return v._id.toString() === ids[0]; });
      var b = results.find(function (v) { return v._id.toString() === ids[1]; });

      versionDiff.diffSnapshots(a.contentSnapshot, b.contentSnapshot, db, function (diffError, diff) {
        if (diffError) {
          res.statusCode = 500;
          return res.json({ success: false, message: diffError.message });
        }
        res.statusCode = 200;
        return res.json({
          a: a.versionNumber,
          b: b.versionNumber,
          contentTree: diff.contentTree,
          glossaryItems: diff.glossaryItems,
          resourceItems: diff.resourceItems,
          helpContent: diff.helpContent,
          pluginSelectionsChanged: diff.pluginSelectionsChanged,
          hasChanges: diff.hasChanges
        });
      });
    });
  }, user.tenant._id);
}

/**
 * GET /api/content/lightcourse/:id/wordcount - per-component ("screen") and course-level
 * translatable word counts, per docs/LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md. Reuses the same
 * lib/lightcoursewordcount.js service the full-course equivalent on plugins/content/course/
 * index.js calls, so counting logic never diverges between the two.
 */
function getWordCount(req, res) {
  var user = usermanager.getCurrentUser();
  var id = req.params.id;

  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }
    db.retrieve('lightcourse', { _id: id }, { jsonOnly: true }, function (err, results) {
      if (err) {
        res.statusCode = 500;
        return res.json({ success: false, message: err.message });
      }
      if (!results || !results.length) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'Light course not found' });
      }
      var draft = results[0];

      new LightCourseContent().hasPermission('retrieve', user._id, user.tenant._id, draft, function (permError, isAllowed) {
        if (permError) {
          res.statusCode = 500;
          return res.json({ success: false, message: permError.message });
        }
        if (!isAllowed) {
          res.statusCode = 403;
          return res.json({ success: false, message: 'You are not permitted to do that' });
        }

        wordcount.computeWordCount(draft, db, function (err, result) {
          if (err) {
            res.statusCode = 500;
            return res.json({ success: false, message: err.message });
          }
          res.statusCode = 200;
          return res.json(result);
        });
      });
    });
  }, user.tenant._id);
}

function initialize() {
  origin().once('serverStarted', function () {
    rest.post('/content/lightcourse/:id/versions', publishVersion);
    rest.get('/content/lightcourse/:id/versions', listVersions);
    // NOTE: "compare" must be registered before the ":versionId" param route below, otherwise
    // Express would match "compare" as a versionId value and this route would never be reached.
    rest.get('/content/lightcourse/:id/versions/compare', compareVersions);
    rest.get('/content/lightcourse/:id/versions/:versionId', getVersion);
    rest.get('/content/lightcourse/:id/wordcount', getWordCount);
  });
}

initialize();

exports = module.exports = LightCourseContent;
