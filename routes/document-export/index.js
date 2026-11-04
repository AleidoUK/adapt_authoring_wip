// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Document export route for the Light Course Editor - Markdown/`.docx` export of a draft or an
 * immutable version, per docs/LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md. Follows the confirmed
 * routes/export/index.js convention: own top-level `routes/<name>/index.js` (picked up by
 * lib/router.js's directory scan), `permissions.ignoreRoute(...)`, own tenant/permission check.
 */

var server = module.exports = require('express')();
var database = require('../../lib/database');
var permissions = require('../../lib/permissions');
var usermanager = require('../../lib/usermanager');
var logger = require('../../lib/logger');
var origin = require('../../');
var documentGenerator = require('../../lib/lightcourse/documentGenerator');

permissions.ignoreRoute(/^\/document-export\/?.*$/);

function handleError(res, statusCode, error) {
  logger.log('error', error);
  res.status(statusCode).json({ success: false, message: error.message || error });
}

/**
 * Resolves either a `lightcourse` draft or a `lightcourseversion` by ID - an export can target
 * either, per the main plan ("Allow exporting any immutable version, and the latest draft only
 * if clearly labelled as a draft").
 */
function resolveExportSource(id, db, callback) {
  db.retrieve('lightcourse', { _id: id }, { jsonOnly: true }, function (err, draftResults) {
    if (err) {
      return callback(err);
    }
    if (draftResults && draftResults.length) {
      return callback(null, { isDraft: true, record: draftResults[0] });
    }
    db.retrieve('lightcourseversion', { _id: id }, { jsonOnly: true }, function (err, versionResults) {
      if (err) {
        return callback(err);
      }
      if (versionResults && versionResults.length) {
        return callback(null, { isDraft: false, record: versionResults[0] });
      }
      callback(null, null);
    });
  });
}

function buildGeneratorData(source) {
  if (source.isDraft) {
    var draft = source.record;
    return {
      title: draft.title,
      versionNumber: draft.currentVersionNumber,
      isDraft: true,
      headerData: draft.headerData,
      contentTree: draft.contentTree,
      glossaryItems: draft.glossaryItems,
      resourceItems: draft.resourceItems,
      helpContent: draft.helpContent,
      _lightCourseId: draft._id,
      _versionId: null
    };
  }
  var version = source.record;
  var snapshot = version.contentSnapshot || {};
  return {
    title: snapshot.title,
    versionNumber: version.versionNumber,
    isDraft: false,
    headerData: version.headerSnapshot,
    contentTree: snapshot.contentTree,
    glossaryItems: snapshot.glossaryItems,
    resourceItems: snapshot.resourceItems,
    helpContent: snapshot.helpContent,
    _lightCourseId: version._lightCourseId,
    _versionId: version._id
  };
}

server.get('/document-export/:tenant/:id', function (req, res) {
  var tenantId = req.params.tenant;
  var id = req.params.id;
  var format = req.query.format === 'docx' ? 'docx' : 'markdown';
  var currentUser = usermanager.getCurrentUser();

  if (!currentUser || currentUser.tenant._id.toString() !== tenantId) {
    return res.status(401).json({ success: false, message: 'You are not permitted to do that' });
  }

  database.getDatabase(function (error, db) {
    if (error) {
      return handleError(res, 500, error);
    }
    resolveExportSource(id, db, function (err, source) {
      if (err) {
        return handleError(res, 500, err);
      }
      if (!source) {
        return res.status(404).json({ success: false, message: 'Light course or version not found' });
      }

      origin().contentmanager.getContentPlugin(source.isDraft ? 'lightcourse' : 'lightcourseversion', function (pluginError, plugin) {
        if (pluginError) {
          return handleError(res, 500, pluginError);
        }
        plugin.hasPermission('retrieve', currentUser._id, currentUser.tenant._id, source.record, function (permError, isAllowed) {
          if (permError) {
            return handleError(res, 500, permError);
          }
          if (!isAllowed) {
            return res.status(403).json({ success: false, message: 'You are not permitted to do that' });
          }

          var data = buildGeneratorData(source);
          var generate = format === 'docx' ? documentGenerator.generateDocx : documentGenerator.generateMarkdown;

          generate(data, db, function (err, output) {
            if (err) {
              return handleError(res, 500, err);
            }

            persistExport(db, data, format, output, currentUser, function (persistError) {
              if (persistError) {
                // export persistence failing shouldn't block the editor getting their file -
                // log it and still serve the generated document.
                logger.log('error', 'Failed to persist lightcourseexport record', persistError);
              }

              if (format === 'docx') {
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                res.setHeader('Content-Disposition', 'attachment; filename="' + slugify(data.title) + '.docx"');
                return res.send(output);
              }
              res.setHeader('Content-Type', 'text/markdown');
              res.setHeader('Content-Disposition', 'attachment; filename="' + slugify(data.title) + '.md"');
              return res.send(output);
            });
          });
        });
      });
    });
  }, tenantId);
});

/**
 * Point-in-time copy persistence (Phase 2's `lightcourseexport` collection): "exporting a
 * document must also persist a point-in-time copy of its rendered text ... so earlier exports
 * remain retrievable even after the draft changes further" (main plan). `.docx` output is binary,
 * so it's base64-encoded into the same `renderedText` string field as Markdown, rather than
 * introducing a separate file-storage mechanism for what are typically small text documents.
 */
function persistExport(db, data, format, output, currentUser, callback) {
  var renderedText = format === 'docx' ? output.toString('base64') : output;
  // Routed through app.contentmanager.create() (not db.create() directly) so the generic
  // wildcard audit-log hook fires for this too - every export is now part of the light course's
  // change history, not just draft saves/version publishes.
  origin().contentmanager.create('lightcourseexport', {
    _tenantId: currentUser.tenant._id,
    _lightCourseId: data._lightCourseId,
    _versionId: data._versionId || undefined,
    isDraft: data.isDraft,
    format: format,
    renderedText: renderedText,
    assetSnapshotRefs: [],
    exportedAt: new Date(),
    createdBy: currentUser._id
  }, callback);
}

function slugify(title) {
  return (title || 'light-course').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'light-course';
}
