// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Document import route for the Light Course Editor - the inverse of
 * routes/document-export/index.js, per docs/LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md.
 * Mirrors routes/import/index.js's shape (own top-level directory, `permissions.ignoreRoute`,
 * typed-error-based translated messages) but is Light-Course-specific, so it lives separately
 * rather than inside that generic full-course import route.
 *
 * Two explicit product decisions this route implements (confirmed before building):
 *   - **Unsaved draft handling: confirm, don't silently discard.** If the draft differs from its
 *     latest published version (or, if nothing has ever been published, the draft has any real
 *     content at all), the request must include `confirmed=true` to proceed - otherwise it's
 *     rejected with a 409 and a message explaining why, never silently overwritten.
 *   - **Strict per-component field mapping** on the actual text re-application - see
 *     lib/lightcourse/documentImport.js's header comment for the detail; this route only owns
 *     the upload/permission/concurrency/version-history plumbing around that shared logic.
 *
 * Word imports require a minor/major choice, create a new immutable version and activate its
 * content as the draft. Markdown retains the original draft-only import behaviour.
 */

var fs = require('fs');
var formidable = require('formidable');
var IncomingForm = formidable.IncomingForm;

var server = module.exports = require('express')();
var database = require('../../lib/database');
var permissions = require('../../lib/permissions');
var usermanager = require('../../lib/usermanager');
var configuration = require('../../lib/configuration');
var logger = require('../../lib/logger');
var origin = require('../../');
var contentmanager = require('../../lib/contentmanager');
var documentGenerator = require('../../lib/lightcourse/documentGenerator');
var documentImport = require('../../lib/lightcourse/documentImport');
var versionDiff = require('../../lib/lightcourse/versionDiff');
var comments = require('../../lib/lightcourse/comments');

permissions.ignoreRoute(/^\/document-import\/?.*$/);

function handleError(res, statusCode, error) {
  logger.log('error', error);
  res.status(statusCode).json({ success: false, message: error.message || error });
}

function snapshotOf(record) {
  return {
    title: record.title,
    body: record.body,
    tags: record.tags || [],
    contentTree: record.contentTree,
    pluginSelections: record.pluginSelections,
    glossaryItems: record.glossaryItems,
    resourceItems: record.resourceItems,
    helpContent: record.helpContent
  };
}

function draftHasAnyContent(draft, includeCourseText) {
  return !!(
    (includeCourseText && (draft.title || draft.body)) ||
    (draft.contentTree && draft.contentTree.children && draft.contentTree.children.length) ||
    (draft.glossaryItems && draft.glossaryItems.length) ||
    (draft.resourceItems && draft.resourceItems.length) ||
    (draft.helpContent && (
      (draft.helpContent.items && draft.helpContent.items.length) ||
      (draft.helpContent.popup && draft.helpContent.popup.title)
    ))
  );
}

/**
 * Finds the most recently published version for a light course (highest versionMajor.versionMinor)
 * - "based on the latest version" per the main plan.
 */
function findLatestVersion(db, lightCourseId, callback) {
  db.retrieve('lightcourseversion', { _lightCourseId: lightCourseId }, { jsonOnly: true }, function (err, versions) {
    if (err) {
      return callback(err);
    }
    if (!versions || !versions.length) {
      return callback(null, null);
    }
    function parts(v) {
      var bits = (v.versionNumber || '0.0').split('.').map(Number);
      return { major: bits[0] || 0, minor: bits[1] || 0 };
    }
    var latest = versions.reduce(function (best, current) {
      var bestParts = parts(best);
      var currentParts = parts(current);
      if (currentParts.major > bestParts.major || (currentParts.major === bestParts.major && currentParts.minor > bestParts.minor)) {
        return current;
      }
      return best;
    });
    callback(null, latest);
  });
}

function detectFormat(fields, fileName) {
  if (fields.format === 'docx' || fields.format === 'markdown') {
    return fields.format;
  }
  return /\.docx$/i.test(fileName || '') ? 'docx' : 'markdown';
}

server.post('/document-import/:tenant/:lightCourseId', function (req, res) {
  var tenantId = req.params.tenant;
  var lightCourseId = req.params.lightCourseId;
  var currentUser = usermanager.getCurrentUser();

  if (!currentUser || currentUser.tenant._id.toString() !== tenantId) {
    return res.status(401).json({ success: false, message: 'You are not permitted to do that' });
  }

  var form = new IncomingForm();
  form.maxFileSize = configuration.getMaxFileUploadSize();
  var uploadPaths = [];
  var cleaned = false;
  form.on('fileBegin', function(name, file) { uploadPaths.push(file.path); });
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    uploadPaths.forEach(function(path) {
      fs.unlink(path, function(error) {
        if (error && error.code !== 'ENOENT') logger.log('error', 'Could not remove document import upload', error);
      });
    });
  }
  res.once('finish', cleanup);
  res.once('close', cleanup);

  form.parse(req, function (formError, fields, files) {
    if (formError) {
      return handleError(res, 400, formError);
    }
    var uploaded = files.file;
    if (!uploaded) {
      return res.status(400).json({ success: false, message: 'No file was uploaded - expected a "file" field' });
    }
    if (fields.format === 'docx' && !/\.docx$/i.test(uploaded.name || '')) {
      return res.status(400).json({ success: false, message: 'Please upload a .docx Word document.' });
    }
    var format = detectFormat(fields, uploaded.name);
    var confirmed = fields.confirmed === 'true' || fields.confirmed === true;
    if (format === 'docx' && fields.bump !== 'minor' && fields.bump !== 'major') {
      return res.status(400).json({ success: false, message: 'Choose a minor (part) or major (full) version for this import.' });
    }
    if (format === 'docx' && fields.revision === undefined) {
      return res.status(400).json({ success: false, message: 'A valid course revision is required.' });
    }

    database.getDatabase(function (error, db) {
      if (error) {
        return handleError(res, 500, error);
      }

      db.retrieve('lightcourse', { _id: lightCourseId }, { jsonOnly: true, populate: { tags: '_id title' } }, function (err, draftResults) {
        if (err) {
          return handleError(res, 500, err);
        }
        if (!draftResults || !draftResults.length) {
          return res.status(404).json({ success: false, message: 'Light course not found' });
        }
        var draft = draftResults[0];
        if (fields.revision !== undefined && !/^\d+$/.test(String(fields.revision))) {
          return res.status(400).json({ success: false, message: 'A valid course revision is required.' });
        }
        if (fields.revision !== undefined && Number(fields.revision) !== draft.revision) {
          return res.status(409).json({ success: false, message: 'The course changed before import. Reload and try again.' });
        }

        origin().contentmanager.getContentPlugin('lightcourse', function (pluginError, plugin) {
          if (pluginError) {
            return handleError(res, 500, pluginError);
          }
          plugin.hasPermission('update', currentUser._id, currentUser.tenant._id, draft, function (permError, isAllowed) {
            if (permError) {
              return handleError(res, 500, permError);
            }
            if (!isAllowed) {
              return res.status(403).json({ success: false, message: 'You are not permitted to do that' });
            }

            findLatestVersion(db, lightCourseId, function (versionError, latestVersion) {
              if (versionError) {
                return handleError(res, 500, versionError);
              }

              function proceedWithImport() {
                var fileBuffer;
                try {
                  fileBuffer = fs.readFileSync(uploaded.path);
                } catch (readError) {
                  return handleError(res, 500, readError);
                }

                function withParsedResult(parseError, parsedResult) {
                  if (parseError) {
                    return handleError(res, 500, parseError);
                  }
                  if (parsedResult.formatVersion === 2 && String(parsedResult.sourceId) !== String(lightCourseId)) {
                    return res.status(422).json({ success: false, errors: ['This Word document was exported from a different course. Export a document from this course first.'] });
                  }
                  var snapshot = JSON.parse(JSON.stringify(snapshotOf(draft)));
                  documentImport.importDocument(parsedResult, snapshot, db, function (importError, result) {
                    if (importError) {
                      return handleError(res, 500, importError);
                    }
                    if (!result.success) {
                      return res.status(422).json({ success: false, title: origin().polyglot.t('app.documentimportstructuretitle'), errors: result.errors });
                    }
                    if (format === 'docx') {
                      function saveVersion() {
                        plugin.importVersion(db, draft, snapshot, fields.bump, function(versionError, version) {
                          if (versionError) {
                            logger.log('error', versionError);
                            return res.status(versionError instanceof contentmanager.errors.ContentConflictError ? 409 : 500)
                              .json({ success: false, message: versionError.message, version: versionError.version });
                          }
                          res.status(200).json({ success: true, version: version, message: origin().polyglot.t('app.documentimportsuccess') });
                        });
                      }
                      if (!(parsedResult.comments || []).length) return saveVersion();
                      return usermanager.retrieveUsers({ _tenantId: currentUser.tenant._id }, { jsonOnly: true }, function(error, users) {
                        if (error) return handleError(res, 500, error);
                        comments.resolveAuthors(snapshot.contentTree, users);
                        saveVersion();
                      });
                    }

                    // Routed through app.contentmanager.update() (not plugin.update() directly)
                    // so the generic wildcard audit-log hook fires for this save too - it ends up
                    // calling the exact same LightCourseContent.prototype.update() either way,
                    // which auto-appends a version-history row on every successful save
                    // (including this one - no need to build one here too).
                    origin().contentmanager.update('lightcourse', { _id: lightCourseId }, {
                      revision: draft.revision,
                      title: snapshot.title,
                      body: snapshot.body,
                      contentTree: snapshot.contentTree,
                      glossaryItems: snapshot.glossaryItems,
                      resourceItems: snapshot.resourceItems,
                      helpContent: snapshot.helpContent,
                      headerData: draft.headerData
                    }, function (updateError, updated) {
                      if (updateError) {
                        if (updateError instanceof contentmanager.errors.ContentConflictError) {
                          return res.status(409).json({ success: false, message: updateError.message });
                        }
                        if (updateError instanceof contentmanager.errors.ContentPermissionError) {
                          return res.status(403).json({ success: false, message: updateError.message });
                        }
                        return handleError(res, 500, updateError);
                      }
                      return res.status(200).json({ success: true, message: origin().polyglot.t('app.documentimportsuccess') });
                    });
                  });
                }

                if (format === 'docx') {
                  documentGenerator.parseDocx(fileBuffer, withParsedResult);
                } else {
                  withParsedResult(null, documentGenerator.parseMarkdown(fileBuffer.toString('utf8')));
                }
              }

              if (confirmed) {
                return proceedWithImport();
              }

              var baselineSnapshot = latestVersion ? Object.assign({}, latestVersion.contentSnapshot, { headerData: latestVersion.headerSnapshot }) :
                { contentTree: { children: [] }, pluginSelections: {}, glossaryItems: [], resourceItems: [], helpContent: {} };
              var draftSnapshot = Object.assign(snapshotOf(draft), { headerData: draft.headerData });

              function respondConfirmNeeded() {
                res.status(409).json({
                  success: false,
                  requiresConfirmation: true,
                  title: origin().polyglot.t('app.documentimportconfirmtitle'),
                  message: origin().polyglot.t('app.documentimportconfirmbody')
                });
              }

              if (!latestVersion) {
                if (draftHasAnyContent(draft, format === 'docx')) {
                  return respondConfirmNeeded();
                }
                return proceedWithImport();
              }
              if (format === 'docx' && ['title', 'body'].some(function(field) {
                return baselineSnapshot[field] !== draftSnapshot[field];
              })) {
                return respondConfirmNeeded();
              }

              versionDiff.diffSnapshots(baselineSnapshot, draftSnapshot, db, function (diffError, diff) {
                if (diffError) {
                  return handleError(res, 500, diffError);
                }
                if (diff.hasChanges) {
                  return respondConfirmNeeded();
                }
                proceedWithImport();
              });
            });
          });
        });
      });
    }, tenantId);
  });
});
