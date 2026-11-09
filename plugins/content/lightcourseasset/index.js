// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Light Course Asset content plugin - a dedicated image/audio asset pool for the Light Course
 * Editor's own "bank" field (frontend/src/modules/lightCourseEditor/views/
 * lightCourseBankAssetFieldView.js), entirely separate from the main Asset Management area's own
 * `asset` collection/library - per direct user request, so picking or uploading a placeholder
 * image from within a light course never shows (or lets an author accidentally reuse) anything
 * from the full course editor's asset library, and nothing uploaded here ever appears there.
 *
 * Deliberately a plain ContentPlugin (not a lib/assetmanager.js-style preload module with its own
 * hand-wired Express routes bootstrapped in lib/application.js) - metadata CRUD (create/retrieve/
 * destroy) reuses the exact same generic REST mechanism every other lightcourse* content type
 * already relies on; only the upload/serve/thumbnail endpoints below need bespoke routes (the
 * generic route can't accept multipart form data or stream a file back), registered the same way
 * plugins/content/lightcourse/index.js's own icon-font routes already are.
 *
 * File handling (hash the upload, store it, generate a thumbnail) deliberately mirrors
 * lib/assetmanager.js's own _createAssetFromFile()/postAsset() almost line for line - that's the
 * one part of this plugin that *is* duplicated rather than shared, since assetmanager.js's own
 * implementation is tightly bound to the main `asset` collection (not reusable as-is), and
 * refactoring it to be generic was judged too risky to the heavily-used main asset library for
 * what's otherwise a self-contained, independent feature.
 */

var contentmanager = require('../../../lib/contentmanager'),
    ContentPlugin = contentmanager.ContentPlugin,
    database = require('../../../lib/database'),
    permissions = require('../../../lib/permissions'),
    usermanager = require('../../../lib/usermanager'),
    logger = require('../../../lib/logger'),
    filestorage = require('../../../lib/filestorage'),
    configuration = require('../../../lib/configuration'),
    rest = require('../../../lib/rest'),
    origin = require('../../../'),
    permissionAction = require('../../../lib/lightcourse/permissionAction'),
    assetUsage = require('../../../lib/lightcourse/assetUsage'),
    formidable = require('formidable'),
    IncomingForm = formidable.IncomingForm,
    bytes = require('bytes'),
    crypto = require('crypto'),
    path = require('path'),
    util = require('util');

var STREAM_BUFFER_SIZE = 64 * 1024;
// Same tiny built-in placeholder lib/assetmanager.js's own assetThumb() falls back to when an
// asset has no generated thumbnail (e.g. an audio file) - reused as-is, it's just a neutral grey
// square, not anything specific to the main asset library.
var DEFAULT_THUMBNAIL_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAGcAAAB5CAMAAAATQ88gAAABL1BMVEU+SWA/SmFBS2JBTGNCTWNETmVET2VFUGZGUWdIU2lJU2pMV21NWG5OWW9RXHJTXnNUX3VWYHZXYndYYnhaZHlbZnpcZ3tdaHxgan5ibIBibYFjboJlcINncoVpcodqdIhrdYlsdopueIxveYxweY1xe45yfZB0fZF2gJN6hJZ6hZZ8hph9h5iBiZuDjJ6FjqCGj6CGkKGHkKKIkqSKk6WLlKWQmaqTnK2Una2Vna6Xn6+YobGZorKcpbSep7efqLihqrqkrLylrr2qssGwuca1vMq6ws+8xdLAyNXBydbFzdrHz9zI0N3K0t/L0t/M1ODN1ODQ2OPS2uXS2+bV3OjW3ejY3+ra4u3c5O/e5fDf5vHg6PPh6fTj6/bk6/bl7Pfm7ffm7vjn7vno7/np8PoQVD/gAAACnklEQVR4Ae3WbVMSURjG8bNUbmaY1EZqkgpYJhlFUWRkQhKgaQ+JmQ/hw/39P0MzNbfT5l4ehGv3Re3/9XXm9+rM3Ebky6sHXqr/vNnF5S2xZaR21QzexMqBxXljOI3Wuuc6Vwyryc55DrGRVjSOcZvYiQgybMji3MhdPAxhpyT20NvswmUAcZ2SbHoAIjvyLQ0grgMgugMgugMgugMgugMgugMgugMgvgMgvgMgvgMgvgMgvgMgugOgFtsB0EiH7QBoskt1MFSjOhgaPaA6GFoJx1HI08FEqI5sXtLFVqiOLOhimeLcKYGyulikOPZmB3ISPTveQM7tnp3UQE4hIqftRONIOSLnR9lhO6BWIZ0YzFmvZMZcdyxTWZf+y9mc9pQ5baodlnNYNL6Kh6E4u9Pmr6Z3Q3COsuZM2SOqg39Fme5sOEGOs8F25kxgc2Rn24C2uU4dOXWuU0BOgevMIGeG66SRk+Y648gZ5zp55OS5ThE5Ra7TQE6D6+wNBTNDexLQx2fHfTn4uCgHMtfNIwBZnZ3hIGZ4J5gxALI7shrkrCIGQXZHKmeZCmYQZHek6vgVp4oZDNkdaST/ZJINwFgguyP7S8lTZWkfMwiyO9rJWvXp/PyT12snghkMYQcGGAAxHMAoxHMAoxDPAYxCPAcwCvEcwCjEciCjEMdBDIB6dJpNzGDowk7TdZt2BkJ2RxljfNAnxADI7iijEGYwhJ0ARiHAgJ7bHT+jEGJAOcEOYBRShusoo5AyRMfHKFRXhuAARqM6gOE7gOE7gOE7t0w0Tip2Yid2Yuffc/jFTuz8H07mbRh5fie8InZuRuTkI3JeROMkPoh5GIHzUsR8vx8687grYkTe3XVDRK7dey/yyxE5/vo5rDryu5+fSKzliGdNYwAAAABJRU5ErkJggg==';

function LightCourseAssetContent () {
}

util.inherits(LightCourseAssetContent, ContentPlugin);

/**
 * overrides base implementation of hasPermission - same tenant-isolation pattern as every other
 * lightcourse* content plugin.
 */
LightCourseAssetContent.prototype.hasPermission = function (action, userId, tenantId, contentItem, next) {
  if (contentItem && contentItem._tenantId && contentItem._tenantId.toString() !== tenantId.toString()) {
    return next(null, false);
  }
  var resource = permissions.buildResourceString(tenantId, '/api/content/lightcourseasset/' + ((contentItem && contentItem._id) || '*'));
  permissions.hasPermission(userId, permissionAction.normalize(action), resource, next);
};

/**
 * implements ContentObject#getModelName
 */
LightCourseAssetContent.prototype.getModelName = function () {
  return 'lightcourseasset';
};

/**
 * overrides base destroy - the base implementation only removes the database record; admin
 * deletion from the new "Light Course Placeholder Assets" admin screen should also remove the
 * actual stored file (and thumbnail, if any), same as lib/assetmanager.js's own destroyAsset()
 * does for the main asset library.
 */
LightCourseAssetContent.prototype.destroy = function (search, force, next) {
  if ('function' === typeof force) {
    next = force;
    force = false;
  }
  var self = this;
  this.retrieve(search, {}, function(retrieveError, results) {
    // a file-removal problem shouldn't block the DB delete, and there may be nothing to remove
    // anyway (matches the base class's own "nothing found" no-op) - just proceed either way.
    var assetRec = results && results[0];
    ContentPlugin.prototype.destroy.call(self, search, force, function(destroyError, result) {
      if (destroyError || !assetRec) {
        return next(destroyError, result);
      }
      filestorage.getStorage(assetRec.repository, function(storageError, storage) {
        if (storageError) {
          logger.log('error', 'Failed to retrieve filestorage repository to remove light course asset file', storageError);
          return next(destroyError, result);
        }
        storage.deleteFile(assetRec.path, function(deleteFileError) {
          if (deleteFileError) {
            logger.log('error', 'Failed to remove light course asset file', deleteFileError);
          }
          if (!assetRec.thumbnailPath || assetRec.thumbnailPath === 'false') {
            return next(destroyError, result);
          }
          storage.deleteFile(assetRec.thumbnailPath, function(deleteThumbError) {
            if (deleteThumbError) {
              logger.log('error', 'Failed to remove light course asset thumbnail', deleteThumbError);
            }
            next(destroyError, result);
          });
        });
      });
    });
  });
};

/**
 * POST /content/lightcourseasset/upload - multipart upload. Hashes the file content (so
 * identical uploads collapse to the same stored path, same convention the main asset library
 * uses) and generates a thumbnail for images, then creates the metadata record via the normal
 * ContentPlugin.create() path (tenant-scoped, permission-checked, same as every other
 * lightcourse* content type).
 */
function uploadAsset(req, res, next) {
  var form = new IncomingForm();
  form.maxFileSize = configuration.getMaxFileUploadSize('zip');

  form.parse(req, function (error, fields, files) {
    if (error) {
      if (form.bytesExpected > form.maxFileSize) {
        return res.status(400).json({ success: false, message: origin().polyglot.t('app.uploadsizeerror', {
          max: bytes.format(form.maxFileSize),
          size: bytes.format(form.bytesExpected)
        }) });
      }
      return res.status(500).json({ success: false, message: error.message });
    }

    var file = files.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file was uploaded' });
    }
    var maxSizeForType = configuration.getMaxFileUploadSize(file.type);
    if (file.size > maxSizeForType) {
      return res.status(400).json({ success: false, message: origin().polyglot.t('app.uploadsizeerror', {
        max: bytes.format(maxSizeForType),
        size: bytes.format(file.size)
      }) });
    }

    var repository = configuration.getConfig('filestorage') || 'localfs';
    var assetType = fields.assetType || 'image';

    filestorage.getStorage(repository, function (storageError, storage) {
      if (storageError) {
        return res.status(500).json({ success: false, message: storageError.message });
      }

      var hash = crypto.createHash('sha1');
      var rs = require('fs').createReadStream(file.path);

      rs.on('error', function(readError) { logger.log('error', readError); });
      rs.on('data', function onReadData(data) { hash.update(data, 'utf8'); });
      rs.on('close', function onReadClose() {
        var filehash = hash.digest('hex');
        var directory = path.join('lightcourseassets', filehash.substr(0, 2), filehash.substr(2, 2));
        var fileExt = path.extname(file.name);
        var filepath = path.join(directory, filehash) + fileExt;

        var fileOptions = {
          createMetadata: true,
          createThumbnail: assetType === 'image',
          thumbnailOptions: { width: '?', height: '200' }
        };

        storage.processFileUpload(file, filepath, fileOptions, function (uploadError, storedFile) {
          if (uploadError) {
            return res.status(500).json({ success: false, message: uploadError.message });
          }

          var user = usermanager.getCurrentUser();
          var data = Object.assign({
            title: fields.title || file.name,
            description: fields.description || '',
            assetType: assetType,
            filename: filehash + fileExt,
            directory: directory,
            repository: repository
          }, storedFile);

          origin().contentmanager.create('lightcourseasset', data, function (createError, assetRec) {
            if (createError) {
              return storage.deleteFile(storedFile.path, function() {
                res.status(500).json({ success: false, message: createError.message });
              });
            }
            res.status(200).json({ _id: assetRec._id, filename: assetRec.filename });
          });
        });
      });
    });
  });
}

/**
 * GET /content/lightcourseasset/:id/serve - streams the actual stored file (audio preview/full
 * resolution image).
 */
function serveAsset(req, res, next) {
  var contentPlugin = new LightCourseAssetContent();
  contentPlugin.retrieve({ _id: req.params.id }, {}, function (error, results) {
    if (error) {
      return next(error);
    }
    if (!results || !results.length) {
      return res.status(404).json({ success: false, message: 'light course asset not found' });
    }
    var assetRec = results[0];
    filestorage.getStorage(assetRec.repository, function (storageError, storage) {
      if (storageError) {
        return next(storageError);
      }
      storage.createReadStream(assetRec.path, { bufferSize: STREAM_BUFFER_SIZE }, function (stream) {
        res.writeHead(200, {
          'Content-Type': assetRec.mimeType,
          'Content-Length': assetRec.size,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        stream.pipe(res);
        stream.on('end', function () { res.end(); });
      });
    });
  });
}

/**
 * GET /content/lightcourseasset/:id/thumb - streams the generated thumbnail, or a small built-in
 * placeholder image if none exists (e.g. an audio asset).
 */
function assetThumb(req, res, next) {
  var contentPlugin = new LightCourseAssetContent();
  contentPlugin.retrieve({ _id: req.params.id }, {}, function (error, results) {
    if (error) {
      return next(error);
    }
    if (!results || !results.length) {
      return res.status(404).json({ success: false, message: 'light course asset not found' });
    }
    var assetRec = results[0];
    if (!assetRec.thumbnailPath || assetRec.thumbnailPath === 'false') {
      var img = Buffer.from(DEFAULT_THUMBNAIL_BASE64, 'base64');
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': img.length,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return res.end(img);
    }
    filestorage.getStorage(assetRec.repository, function (storageError, storage) {
      if (storageError) {
        return next(storageError);
      }
      storage.createReadStream(assetRec.thumbnailPath, { bufferSize: STREAM_BUFFER_SIZE }, function (stream) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        stream.pipe(res);
        stream.on('end', function () { res.end(); });
      });
    });
  });
}

function getUses(req, res, next) {
  var user = usermanager.getCurrentUser();
  if (!user || !user.tenant) return res.status(401).json({ success: false, message: 'Authentication required' });
  // Asset readers include light editors; this tenant-wide report is for asset administrators.
  new LightCourseAssetContent().hasPermission('update', user._id, user.tenant._id, {}, function(error, allowed) {
    if (error) return next(error);
    if (!allowed) return res.status(403).json({ success: false, message: 'You are not permitted to do that' });
    database.getDatabase(function(error, db) {
      if (error) return next(error);
      assetUsage.collect(db, user.tenant._id).then(function(usage) { res.json(usage); }, next);
    }, user.tenant._id);
  });
}

function initialize() {
  origin().once('serverStarted', function () {
    rest.post('/content/lightcourseasset/upload', uploadAsset);
    // NOTE: must be at least 2 path segments after "lightcourseasset" (not just "/content/
    // lightcourseasset/:id") - lib/contentmanager.js registers the generic `GET /content/:type/
    // :id` route well before this plugin's own serverStarted-triggered routes below, so a
    // 1-segment path here would always be matched by that route first and never reached (same
    // gotcha plugins/content/lightcourse/index.js's own icon routes ran into).
    rest.get('/content/lightcourseasset/:id/serve', serveAsset);
    rest.get('/content/lightcourseasset/:id/thumb', assetThumb);
    rest.get('/content/lightcourseasset/uses/all', getUses);
  });
}

initialize();

exports = module.exports = LightCourseAssetContent;
