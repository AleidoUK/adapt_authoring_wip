// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Light Course Version content plugin - immutable published snapshots.
 * See docs/LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md ("2. plugins/content/lightcourseversion/").
 */

var contentmanager = require('../../../lib/contentmanager'),
    ContentPlugin = contentmanager.ContentPlugin,
    permissions = require('../../../lib/permissions'),
    permissionAction = require('../../../lib/lightcourse/permissionAction'),
    database = require('../../../lib/database'),
    usermanager = require('../../../lib/usermanager'),
    rest = require('../../../lib/rest'),
    origin = require('../../../'),
    wordcount = require('../../../lib/lightcoursewordcount'),
    util = require('util');

function LightCourseVersionContent () {
}

util.inherits(LightCourseVersionContent, ContentPlugin);

/**
 * overrides base implementation of hasPermission
 *
 * Immutability is enforced here, not just by convention: update/delete are always denied once a
 * version has been created, regardless of role (not even a tenant admin can edit/delete a
 * published version - a new version must be published instead).
 *
 * @param {string} action
 * @param {objectid} userId
 * @param {objectid} tenantId
 * @param {object} contentItem
 * @param {callback} next (function (err, isAllowed))
 */
LightCourseVersionContent.prototype.hasPermission = function (action, userId, tenantId, contentItem, next) {
  if ('update' === action || 'delete' === action) {
    return next(null, false);
  }
  if (contentItem && contentItem._tenantId && contentItem._tenantId.toString() !== tenantId.toString()) {
    return next(null, false);
  }
  var resource = permissions.buildResourceString(tenantId, '/api/content/lightcourseversion/' + ((contentItem && contentItem._id) || '*'));
  permissions.hasPermission(userId, permissionAction.normalize(action), resource, next);
};

/**
 * implements ContentObject#getModelName
 *
 * @return {string}
 */
LightCourseVersionContent.prototype.getModelName = function () {
  return 'lightcourseversion';
};

/**
 * GET /api/content/lightcourseversion/:id/wordcount - same shape/service as the draft
 * equivalent on plugins/content/lightcourse/index.js, run against the immutable
 * `contentSnapshot` instead of the live `contentTree` (per
 * docs/LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md).
 */
function getWordCount(req, res) {
  var user = usermanager.getCurrentUser();
  var id = req.params.id;

  database.getDatabase(function (error, db) {
    if (error) {
      res.statusCode = 500;
      return res.json({ success: false, message: error.message });
    }
    db.retrieve('lightcourseversion', { _id: id }, { jsonOnly: true }, function (err, results) {
      if (err) {
        res.statusCode = 500;
        return res.json({ success: false, message: err.message });
      }
      if (!results || !results.length) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'Version not found' });
      }
      var version = results[0];

      new LightCourseVersionContent().hasPermission('retrieve', user._id, user.tenant._id, version, function (permError, isAllowed) {
        if (permError) {
          res.statusCode = 500;
          return res.json({ success: false, message: permError.message });
        }
        if (!isAllowed) {
          res.statusCode = 403;
          return res.json({ success: false, message: 'You are not permitted to do that' });
        }

        var snapshot = version.contentSnapshot || {};
        wordcount.computeWordCount(snapshot, db, function (err, result) {
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
    rest.get('/content/lightcourseversion/:id/wordcount', getWordCount);
  });
}

initialize();

exports = module.exports = LightCourseVersionContent;
