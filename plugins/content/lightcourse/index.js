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
    fs = require('fs'),
    util = require('util'),
    lightcourseValidation = require('../../../lib/lightcourse/validation'),
    idRegeneration = require('../../../lib/lightcourse/idRegeneration'),
    permissionAction = require('../../../lib/lightcourse/permissionAction'),
    wordcount = require('../../../lib/lightcoursewordcount'),
    versionDiff = require('../../../lib/lightcourse/versionDiff'),
    iconClasses = require('../../../lib/lightcourse/iconClasses');

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

// Same "sensible out-of-the-box fallback, only used when the tenant hasn't configured its own
// defaultPluginSelections.menu/theme" approach as DEFAULT_NEW_COURSE_EXTENSIONS above - confirmed
// these match real installed menutype.menu / themetype.theme values on this instance (Tile Menu /
// Aleido), per explicit product request.
var DEFAULT_NEW_COURSE_MENU = 'tileMenu';
var DEFAULT_NEW_COURSE_THEME = 'aleido';

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
        if (data.pluginSelections.menu === undefined) {
          // admin-configured menu takes priority; DEFAULT_NEW_COURSE_MENU is only a sensible
          // out-of-the-box fallback for a tenant that hasn't configured one yet.
          data.pluginSelections.menu = (defaultSelections.menu !== undefined)
            ? defaultSelections.menu
            : DEFAULT_NEW_COURSE_MENU;
        }
        if (data.pluginSelections.theme === undefined) {
          // same fallback approach as menu above.
          data.pluginSelections.theme = (defaultSelections.theme !== undefined)
            ? defaultSelections.theme
            : DEFAULT_NEW_COURSE_THEME;
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
      if (data.tags === undefined) {
        data.tags = (template.tags !== undefined ? template.tags : snapshot.tags || []).map(function(tag) {
          return typeof tag === 'string' ? tag : tag._id;
        });
      }
      data.contentTree = snapshot.contentTree || {};
      data.pluginSelections = snapshot.pluginSelections || {};
      if (snapshot.headerData) {
        data.headerData = snapshot.headerData;
      }
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

          wordcount.computeWordCount(merged, db, function (wcError, wordCountResult) {
            if (wcError) {
              return next(wcError);
            }

            var clientRevision = delta.revision;
            var setDelta = Object.assign({}, delta);
            delete setDelta.revision; // revision itself is managed exclusively via $inc below
            setDelta.updatedAt = new Date();
            setDelta.updatedBy = user._id;

            // Refreshes the CURRENT "open" version-history row in place on every ordinary save
            // (autosave or otherwise) - recomputing its words/screens/date/author, but
            // deliberately preserving whatever notes/est. duration are already on it (or whatever
            // the client's own delta is deliberately setting them to, e.g. via the "edit current
            // row" action - both read from the exact same `headerData.versionHistory` array, so
            // a client-submitted notes/duration edit on the last row survives this untouched).
            // Version creation (Create Version or Word import) appends a *new* row - per the main
            // plan's "A new row is added automatically whenever an exported document is
            // re-imported, or an editor can add one manually" direction, extended on direct user
            // request so that a published version always starts a fresh open row, while ordinary
            // in-progress edits (now autosaved on every change rather than only on a manual "Save
            // Draft" click) no longer flood the table with a near-duplicate row per edit.
            var headerData = Object.assign({}, delta.headerData || existing.headerData || {});
            var versionHistory = (headerData.versionHistory || []).slice();
            var openRow = versionHistory.length ? Object.assign({}, versionHistory[versionHistory.length - 1]) : null;
            if (openRow) {
              openRow.date = new Date().toISOString().slice(0, 10);
              openRow.author = user.email || '';
              openRow.screens = wordCountResult.screens;
              openRow.words = wordCountResult.total;
              versionHistory[versionHistory.length - 1] = openRow;
            } else {
              versionHistory.push({
                version: existing.currentVersionNumber || '-',
                date: new Date().toISOString().slice(0, 10),
                author: user.email || '',
                notes: '',
                screens: wordCountResult.screens,
                words: wordCountResult.total,
                duration: ''
              });
            }
            headerData.versionHistory = versionHistory;
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
                Model.populate(updated, { path: 'tags', select: '_id title' }).then(function(populated) {
                  next(null, populated);
                }, next);
              }
            );
          });
        });
      });
    });
  }, (search && search._tenantId) || undefined);
};

/**
 * Computes the next version number. A first-ever *major* publish is "1.0"; a first-ever
 * *minor* publish (before any major has ever been published) is "0.1" instead - confirmed on
 * direct user request, fixing the "Create Version" toolbar's two buttons otherwise always
 * showing the identical "1.0" label pre-first-publish, since both bumps used to collapse to the
 * same result. Checked via `currentVersionNumber` (a string, only ever set at publish time)
 * rather than `!draft.versionMajor`, since a 0.x-only course now has a real `versionMajor` of 0 -
 * which is falsy, and would otherwise be wrongly treated as "never published" forever.
 */
function nextVersionNumber(draft, bump) {
  if (!draft.currentVersionNumber) { // no version published yet
    return bump === 'major' ? { versionMajor: 1, versionMinor: 0 } : { versionMajor: 0, versionMinor: 1 };
  }
  if (bump === 'major') {
    return { versionMajor: draft.versionMajor + 1, versionMinor: 0 };
  }
  return { versionMajor: draft.versionMajor, versionMinor: (draft.versionMinor || 0) + 1 };
}

  LightCourseContent.prototype.importVersion = function(db, draft, snapshot, bump, next) {
    var user = usermanager.getCurrentUser();
    if (bump !== 'minor' && bump !== 'major') return next(new Error('Choose a minor or major version for this import.'));
    snapshot = Object.assign({}, snapshot, { tags: draft.tags || [] });
    var merged = Object.assign({}, draft, snapshot);
    validatePayload(db, merged, user.tenant._id.toString(), function(validationError) {
      if (validationError) return next(new Error(validationError));
      wordcount.computeWordCount(merged, db, function(error, counts) {
        if (error) return next(error);
        var versionInfo = nextVersionNumber(draft, bump);
        var number = versionInfo.versionMajor + '.' + versionInfo.versionMinor;
        var headerData = Object.assign({}, draft.headerData || {});
        headerData.versionHistory = (headerData.versionHistory || []).concat([{
          version: number, date: new Date().toISOString().slice(0, 10),
          author: user.email || '', notes: '', screens: counts.screens, words: counts.total, duration: ''
        }]);
        var Model = db.getModel('lightcourse');
        // Reserve the number before creating the snapshot; do not replace draft content until
        // that immutable snapshot has been persisted successfully.
        Model.findOneAndUpdate(
          { _id: draft._id, revision: draft.revision },
          { $set: Object.assign({}, versionInfo, { currentVersionNumber: number }), $inc: { revision: 1 } },
          { new: true },
          function(error, reserved) {
            if (error) return next(error);
            if (!reserved) return next(new ContentConflictError('This course changed before import. Reload and try again.'));
            origin().contentmanager.create('lightcourseversion', {
              _tenantId: user.tenant._id, _lightCourseId: draft._id, versionNumber: number,
              contentSnapshot: snapshot, headerSnapshot: headerData, schemaFormatVersion: 1, createdBy: user._id
            }, function(createError, version) {
              if (createError) {
                // A post-create hook can fail after the immutable record is already stored.
                return db.retrieve('lightcourseversion', { _lightCourseId: draft._id, versionNumber: number },
                  { jsonOnly: true }, function(lookupError, stored) {
                    if (lookupError) return next(new Error('Could not confirm imported version creation: ' + lookupError.message + '. Reload the editor.'));
                    if (stored && stored.length) {
                      var failure = new Error('Version ' + number + ' was created, but its creation hooks failed: ' + createError.message + '. Reload the editor.');
                      failure.version = stored[0];
                      return next(failure);
                    }
                var restore = { $set: {}, $unset: {}, $inc: { revision: 1 } };
                ['versionMajor', 'versionMinor', 'currentVersionNumber'].forEach(function(field) {
                  if (Object.prototype.hasOwnProperty.call(draft, field)) restore.$set[field] = draft[field];
                  else restore.$unset[field] = 1;
                });
                if (!Object.keys(restore.$set).length) delete restore.$set;
                if (!Object.keys(restore.$unset).length) delete restore.$unset;
                // Ordinary concurrent edits can remain; only restore our reservation, never a
                // newer publisher's version number or another editor's content.
                return Model.findOneAndUpdate({ _id: draft._id, currentVersionNumber: number },
                  restore, { new: true }, function(restoreError) {
                    next(new Error('Could not create the imported version: ' + createError.message +
                      (restoreError ? '. Could not restore its version reservation: ' + restoreError.message : '') +
                      '. Reload the editor before retrying.'));
                  });
              });
              }
              origin().contentmanager.update('lightcourse', { _id: draft._id },
                Object.assign({}, snapshot, { revision: reserved.revision, headerData: headerData }),
                function(activateError) {
                  if (activateError) {
                    var failure = activateError instanceof ContentConflictError ?
                      new ContentConflictError('Version ' + number + ' was created, but the draft changed before it could be activated. Reload the editor.') :
                      new Error('Version ' + number + ' was created, but activating the editable draft could not be confirmed: ' + activateError.message + '. Reload the editor.');
                    failure.version = version;
                    return next(failure);
                  }
                  next(null, version);
                });
            });
          });
      });
    });
  };

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

    db.retrieve('lightcourse', { _id: id }, { jsonOnly: true, populate: { tags: '_id title' } }, function (err, results) {
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

        // Create Version always starts a fresh "open" version-history row (blank notes/est.
        // duration, stamped with the version number just published) - the one and only place
        // that ever appends a new row (see the matching comment on LightCourseContent.prototype.
        // update's own versionHistory handling, which only ever refreshes the existing open row
        // in place, now that ordinary saves are autosaved on every change rather than only via a
        // manual "Save Draft" click).
        wordcount.computeWordCount(draft, db, function (wcError, wordCountResult) {
          if (wcError) {
            res.statusCode = 500;
            return res.json({ success: false, message: wcError.message });
          }

          var headerData = Object.assign({}, draft.headerData || {});
          headerData.versionHistory = (headerData.versionHistory || []).concat([{
            version: currentVersionNumber,
            date: new Date().toISOString().slice(0, 10),
            author: user.email || '',
            notes: '',
            screens: wordCountResult.screens,
            words: wordCountResult.total,
            duration: ''
          }]);

          var Model = db.getModel('lightcourse');
          Model.findOneAndUpdate(
            { _id: id, revision: clientRevision },
            {
              $set: {
                versionMajor: versionInfo.versionMajor,
                versionMinor: versionInfo.versionMinor,
                currentVersionNumber: currentVersionNumber,
                headerData: headerData,
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
                  title: updatedDraft.title,
                  body: updatedDraft.body,
                  tags: draft.tags || [],
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

      versionDiff.diffSnapshots(Object.assign({}, a.contentSnapshot, { headerData: a.headerSnapshot }),
        Object.assign({}, b.contentSnapshot, { headerData: b.headerSnapshot }), db, function (diffError, diff) {
        if (diffError) {
          res.statusCode = 500;
          return res.json({ success: false, message: diffError.message });
        }
        res.statusCode = 200;
        return res.json({
          a: a.versionNumber,
          b: b.versionNumber,
          courseFields: diff.courseFields,
          headerChanges: diff.headerChanges,
          listOrderChanges: diff.listOrderChanges,
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

/**
 * GET /api/content/lightcourse/icons/classes - the Side Drawer icon field's "browse icons" picker
 * (frontend/src/modules/lightCourseEditor/views/lightCourseIconPickerView.js): every class name
 * (plus its font codepoint, so the picker can render the real glyph) parsed from the installed
 * framework's own vanilla icon font definitions - see lib/lightcourse/iconClasses.js. Not tied to
 * any specific lightcourse record, so permission is checked against the general
 * `/api/content/lightcourse/*` resource (same as fromVersion-style actions elsewhere) rather than
 * a particular content item.
 */
function getIconClasses(req, res) {
  var user = usermanager.getCurrentUser();
  new LightCourseContent().hasPermission('read', user._id, user.tenant._id, {}, function (permError, isAllowed) {
    if (permError) {
      res.statusCode = 500;
      return res.json({ success: false, message: permError.message });
    }
    if (!isAllowed) {
      res.statusCode = 403;
      return res.json({ success: false, message: 'You are not permitted to do that' });
    }
    iconClasses.getVanillaIconClasses(function (error, icons) {
      if (error) {
        res.statusCode = 500;
        return res.json({ success: false, message: 'Could not read the installed framework\'s icon font definitions - is the framework installed? (' + error.message + ')' });
      }
      res.statusCode = 200;
      return res.json({
        icons: icons,
        fontUrls: {
          woff2: '/api/content/lightcourse/iconfont/' + iconClasses.FONT_FILES.woff2,
          woff: '/api/content/lightcourse/iconfont/' + iconClasses.FONT_FILES.woff
        }
      });
    });
  });
}

var ICON_FONT_CONTENT_TYPES = { woff2: 'font/woff2', woff: 'font/woff' };

/**
 * GET /api/content/lightcourse/iconfont/:filename - serves the installed framework's own vanilla
 * icon font binaries, so the icon picker above can actually render each glyph rather than just
 * listing class names. :filename is matched against lib/lightcourse/iconClasses.js's own
 * FONT_FILES list (not used as a raw path) so this can never serve anything else from disk.
 */
function getIconFont(req, res) {
  var filename = req.params.filename;
  var key = Object.keys(iconClasses.FONT_FILES).filter(function (candidateKey) {
    return iconClasses.FONT_FILES[candidateKey] === filename;
  })[0];
  if (!key) {
    res.statusCode = 404;
    return res.json({ success: false, message: 'Not found' });
  }

  var user = usermanager.getCurrentUser();
  new LightCourseContent().hasPermission('read', user._id, user.tenant._id, {}, function (permError, isAllowed) {
    if (permError) {
      res.statusCode = 500;
      return res.json({ success: false, message: permError.message });
    }
    if (!isAllowed) {
      res.statusCode = 403;
      return res.json({ success: false, message: 'You are not permitted to do that' });
    }
    var filePath = iconClasses.getFontFilePath(key);
    fs.stat(filePath, function (statError, stat) {
      if (statError) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'Icon font file not found - is the framework installed?' });
      }
      res.writeHead(200, {
        'Content-Type': ICON_FONT_CONTENT_TYPES[key],
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=86400'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });
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
    // NOTE: must be at least 2 path segments after "lightcourse" (not just "/content/
    // lightcourse/iconclasses") - lib/contentmanager.js registers the generic
    // `GET /content/:type/:id` route at content-manager init time, well before this plugin's own
    // serverStarted-triggered routes below, so any 1-segment path here would always be matched by
    // that route first (treating the segment as an _id and failing to cast it) and never reached.
    rest.get('/content/lightcourse/icons/classes', getIconClasses);
    rest.get('/content/lightcourse/iconfont/:filename', getIconFont);
  });
}

initialize();

exports = module.exports = LightCourseContent;
