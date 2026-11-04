// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Asset Managment module
 */

var path = require('path'),
    fs = require('fs-extra'),
    _ = require('underscore'),
    async = require('async'),
    util = require('util'),
    async = require('async'),
    crypto = require('crypto'),
    database = require('./database'),
    logger = require('./logger'),
    rest = require('./rest'),
    usermanager = require('./usermanager'),
    filestorage = require('./filestorage'),
    configuration = require('./configuration'),
    permissions = require('./permissions'),
    helpers = require('./helpers'),
    formidable = require('formidable'),
    IncomingForm = formidable.IncomingForm,
    bytes = require('bytes'),
    mime = require('mime'),
    glob = require('glob'),
    unzip = require('unzipper');

/**
 * CONSTANTS
 */

var MODNAME = 'assetmanager',
    WAITFOR = 'contentmanager',
    STREAM_BUFFER_SIZE = 64 * 1024,
    THUMBNAIL_WIDTH = '?',
    THUMBNAIL_HEIGHT = '200',
    DEFAULT_THUMBNAIL_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAGcAAAB5CAMAAAATQ88gAAABL1BMVEU+SWA/SmFBS2JBTGNCTWNETmVET2VFUGZGUWdIU2lJU2pMV21NWG5OWW9RXHJTXnNUX3VWYHZXYndYYnhaZHlbZnpcZ3tdaHxgan5ibIBibYFjboJlcINncoVpcodqdIhrdYlsdopueIxveYxweY1xe45yfZB0fZF2gJN6hJZ6hZZ8hph9h5iBiZuDjJ6FjqCGj6CGkKGHkKKIkqSKk6WLlKWQmaqTnK2Una2Vna6Xn6+YobGZorKcpbSep7efqLihqrqkrLylrr2qssGwuca1vMq6ws+8xdLAyNXBydbFzdrHz9zI0N3K0t/L0t/M1ODN1ODQ2OPS2uXS2+bV3OjW3ejY3+ra4u3c5O/e5fDf5vHg6PPh6fTj6/bk6/bl7Pfm7ffm7vjn7vno7/np8PoQVD/gAAACnklEQVR4Ae3WbVMSURjG8bNUbmaY1EZqkgpYJhlFUWRkQhKgaQ+JmQ/hw/39P0MzNbfT5l4ehGv3Re3/9XXm9+rM3Ebky6sHXqr/vNnF5S2xZaR21QzexMqBxXljOI3Wuuc6Vwyryc55DrGRVjSOcZvYiQgybMji3MhdPAxhpyT20NvswmUAcZ2SbHoAIjvyLQ0grgMgugMgugMgugMgugMgugMgugMgugMgvgMgvgMgvgMgvgMgvgMgugOgFtsB0EiH7QBoskt1MFSjOhgaPaA6GFoJx1HI08FEqI5sXtLFVqiOLOhimeLcKYGyulikOPZmB3ISPTveQM7tnp3UQE4hIqftRONIOSLnR9lhO6BWIZ0YzFmvZMZcdyxTWZf+y9mc9pQ5baodlnNYNL6Kh6E4u9Pmr6Z3Q3COsuZM2SOqg39Fme5sOEGOs8F25kxgc2Rn24C2uU4dOXWuU0BOgevMIGeG66SRk+Y648gZ5zp55OS5ThE5Ra7TQE6D6+wNBTNDexLQx2fHfTn4uCgHMtfNIwBZnZ3hIGZ4J5gxALI7shrkrCIGQXZHKmeZCmYQZHek6vgVp4oZDNkdaST/ZJINwFgguyP7S8lTZWkfMwiyO9rJWvXp/PyT12snghkMYQcGGAAxHMAoxHMAoxDPAYxCPAcwCvEcwCjEciCjEMdBDIB6dJpNzGDowk7TdZt2BkJ2RxljfNAnxADI7iijEGYwhJ0ARiHAgJ7bHT+jEGJAOcEOYBRShusoo5AyRMfHKFRXhuAARqM6gOE7gOE7gOE7t0w0Tip2Yid2Yuffc/jFTuz8H07mbRh5fie8InZuRuTkI3JeROMkPoh5GIHzUsR8vx8687grYkTe3XVDRK7dey/yyxE5/vo5rDryu5+fSKzliGdNYwAAAABJRU5ErkJggg==';

// errors
function AssetNotFoundError (message, assetID) {
  this.name = 'AssetNotFoundError';
  this.message = (message || 'Asset was not found') + (assetID && (' assetID: ' + assetID));
};

util.inherits(AssetNotFoundError, Error);

function AssetPermissionError (message, assetID) {
  this.name = 'AssetPermissionError';
  this.message = (message || 'You are not allowed to do that.') + (assetID && (' assetID: ' + assetID));
};

util.inherits(AssetPermissionError, Error);

var ASSET_IMPORT_CSV_COLUMNS = ['filename', 'title', 'description', 'tags'];
var ASSET_IMPORT_CSV_SAMPLE_ROW = ['example.jpg', 'Example asset', 'Example description', 'tag1,tag2'];

// content types that can hold a reference to an asset - scanned when checking whether an
// asset is "used" anywhere (eg. page/menu graphics, heroes, extension data embedded on the
// course document, components, cut-but-not-pasted clipboard content, etc.). Menus are stored
// as 'contentobject' docs (_type: 'menu'), not a separate collection, so there's no
// standalone 'menu' model to query.
var ASSET_USAGE_CONTENT_TYPES = ['component', 'article', 'block', 'contentobject', 'course', 'config', 'clipboard'];

// in-memory store of in-progress/recently-completed bulk asset import jobs, keyed by jobId
var importJobs = {};
var IMPORT_JOB_TTL = 5 * 60 * 1000;

function csvEscape(value) {
  var str = (value === null || typeof value === 'undefined') ? '' : String(value);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function csvRow(values) {
  return values.map(csvEscape).join(',');
}

exports = module.exports = {

  /**
   * preload function sets up event listener for startup events
   *
   * @param {object} app - the Origin instance
   * @return {object} preloader - a ModulePreloader
   */

  preload : function (app) {
    var preloader = new app.ModulePreloader(app, MODNAME, { events:this.preloadHandle(app,this) });
    return preloader;
  },

  /**
   * Event handler for preload events
   *
   * @param {object} app - Server instance
   * @param {object} instance - Instance of this module
   * @return {object} hash map of events and handlers
   */

  preloadHandle : function (app, instance) {
    return {

      preload : function () {
        var preloader = this;
        preloader.emit('preloadChange', MODNAME, app.preloadConstants.WAITING);
      },

      moduleLoaded : function (modloaded) {
        var preloader = this;

        // is the module that loaded this modules requirement
        if(modloaded === WAITFOR){
          preloader.emit('preloadChange', MODNAME, app.preloadConstants.LOADING);

          // asset manager handles it's own routes
          permissions.ignoreRoute(/^\/api\/asset\/?.*$/);

          app.assetmanager = instance;
          // set up routes
          rest.post('/asset', instance.postAsset.bind(instance)); 
          rest.post('/asset/replace', instance.replaceAsset.bind(instance));
          rest.post('/asset/import', instance.importAssets.bind(instance));
          // rest.post('/replace', instance.replaceAsset.bind(instance));
          rest.put('/asset/restore/:id', instance.restoreAssetByID.bind(instance));
          rest.put('/asset/trash/:id', instance.trashAssetByID.bind(instance));
          rest.put('/asset/bulkdelete', instance.bulkDeleteAssets.bind(instance));
          rest.put('/asset/:id', instance.putAsset.bind(instance));
          rest.put('/asset/delete/:id', instance.deleteAsset.bind(instance));
          // rest.put('/asset/replace/:id', instance.replaceAsset.bind(instance));
          // Commented out as assets are now queried
          /*rest.get('/asset', instance.getAssets.bind(instance));*/
          rest.get('/asset/query', instance.queryAssets.bind(instance));
          rest.get('/asset/import/template', instance.downloadAssetCsvTemplate.bind(instance));
          rest.get('/asset/import/:jobId/status', instance.getAssetImportStatus.bind(instance));
          rest.get('/asset/unused', instance.getUnusedAssets.bind(instance));
          rest.get('/asset/:id', instance.getAsset.bind(instance));
          rest.get('/asset/serve/:id', instance.serveAsset.bind(instance));
          rest.get('/asset/thumb/:id', instance.assetThumb.bind(instance));
          rest.get('/shared/asset/:id', instance.serveSharedAsset.bind(instance));
          rest.delete('/asset/:id', instance.deleteAsset.bind(instance));
          rest.get('/asset/uses/:id', instance.assetUses.bind(instance));
         

          preloader.emit('preloadChange', MODNAME, app.preloadConstants.COMPLETE);
        }
      }
    };
  },

  /**
   * checks if a user is permitted the action on the resource
   *
   * @param {string} action
   * @param {objectid} userId
   * @param {objectid} tenantId
   * @param {object} a content item
   * @param {callback} next (function (err, isAllowed))
   */

  hasPermission: function (action, userId, tenantId, contentItem, next) {
    var resource = permissions.buildResourceString(tenantId, '/api/asset/' + contentItem._id);
    permissions.hasPermission(userId, action, resource, next);
  },

  /**
   * creates a new asset
   *
   * @param {object} data - the attributes for the asset
   * @param {object} [options]
   * @param {callback} next - function (err, asset)
   */

  createAsset: function (data, options, next) {
    // shuffle params
    if ('function' === typeof options) {
      next = options;
      options = {};
    }

    var user = options.user || usermanager.getCurrentUser();
    var tenantId = user.tenant && user.tenant._id;
    var self = this;

    database.getDatabase(function (error, db) {
      if (error) {
        return next(error);
      }

      // set creation date
      if (!data.createdAt) {
        data.createdAt = new Date();
      }

      db.create('asset', data, function (err, doc) {
        if (err) {
          return next(err);
        }

        permissions.createPolicy(user._id, function (err, policy) {
          if (err) {
            logger.log('error', 'there was an error granting editing permissions', err);
          }

          var resource = permissions.buildResourceString(tenantId, '/api/asset/' + doc._id);
          permissions.addStatement(policy, ['create', 'read', 'update', 'delete'], resource, 'allow', function (err) {
            if (err) {
              logger.log('error', 'there was an error granting editing permissions', err);
            }
            return next(null, doc);
          });
        });
      });

    });
  },

  /**
   * retrieves an/multiple asset record(s)
   *
   * @param {object} search - fields to search on
   * @param {object} [options] - optional query param
   * @param {callback} next - function (err, asset)
   */

  retrieveAsset: function (search, options, next) {
    var __this = this;
    // shuffle params
    if ('function' === typeof options) {
      next = options;
      options = {};
    }
    // Ensure the tags are populated
    var pop = { tags: '_id title' };
    if (!options.populate) {
      options.populate = pop;
    } else {
      options.populate = _.extend(pop, options.populate);
    }
    database.getDatabase(function (error, db) {
      if (error) {
        return next(error);
      }
      var user = usermanager.getCurrentUser();
      // only return deleted assets if user has correct permissions
      __this.hasPermission('delete', user._id, user.tenant._id, '*', function(error, isAllowed) {
        if (error) {
          return next(error);
        }
        if(!isAllowed) {
          search = _.extend(search, { _isDeleted: false });
        }
        db.retrieve('asset', search, options, next);
      });
    });
  },

  /**
   * updates an asset
   *
   * @param {object} search - fields to search on
   * @param {object} delta - the attributes that need updated
   * @param {callback} next - function (err)
   */

  updateAsset: function (search, delta, next) {
    var user = usermanager.getCurrentUser();
    var tenantId = user.tenant && user.tenant._id;
    var self = this;

    self.hasPermission('update', user._id, user.tenant._id, search, function (err, isAllowed) {
      if (!isAllowed) {
        return next(new AssetPermissionError());
      }

      database.getDatabase(function (error, db) {
        if (error) {
          return next(error);
        }

        // set update date!
        if (!delta.updatedAt) {
          delta.updatedAt = new Date();
        }

        db.update('asset', search, delta, next);
      });
    });
  },

  /**
   * deletes an asset
   *
   * @param {string} id - deleting requires that the asset be identified by id
   * @param {callback} next - function (err)
   */

  destroyAsset: function (id, next) {
    var user = usermanager.getCurrentUser();
    var tenantId = user.tenant && user.tenant._id;
    var self = this;

    self.hasPermission('delete', user._id, tenantId, { _id: id}, function (err, isAllowed) {
      if (!isAllowed) {
        return next(new AssetPermissionError());
      }

      database.getDatabase(function (error, db) {
        if (error) {
          return next(error);
        }

        self.retrieveAsset({ _id: id }, function (error, assetRecs) {
          if (error) {
            return next(error);
          }

          if (!assetRecs || assetRecs.length !== 1) {
            return next(new AssetNotFoundError(null, id));
          }

          var assetRec = assetRecs[0];
          db.destroy('asset', { _id: id }, function (error) {
            // if db delete succeeds, we need to remove from repository
            filestorage.getStorage(assetRec.repository, function (error, storage) {
              if (error) {
                // argh. we've destroyed the asset record, but we can't touch the file ...
                logger.log('error', 'Failed to retrieve filestorage repository', assetRec.repository);
                return next(error);
              }

              storage.deleteFile(assetRec.path, next);
            });
          });
        })
      });
    });
  },

  trashAsset: function(id, next) {
    var user = usermanager.getCurrentUser();
    var tenantId = user.tenant && user.tenant._id;
    var self = this;

    self.hasPermission('delete', user._id, tenantId, { _id: id}, function (err, isAllowed) {
      if (!isAllowed) {
        return next(new AssetPermissionError());
      }

      database.getDatabase(function (error, db) {
        if (error) {
          return next(error);
        }

        self.retrieveAsset({ _id: id }, function (error, assetRecs) {
          if (error) {
            return next(error);
          }

          if (!assetRecs || assetRecs.length !== 1) {
            return next(new AssetNotFoundError(null, id));
          }

          db.update('asset', { _id: id }, {
            _isDeleted: true,
            deletedAt: new Date(),
            deletedBy: user._id
          }, function (error) {
            if (error) {
              return next(error);
            }
            next();
          });

        })
      });
    });
  },

  restoreAsset: function(id, next) {
    var user = usermanager.getCurrentUser();
    var tenantId = user.tenant && user.tenant._id;
    var self = this;

    self.hasPermission('delete', user._id, tenantId, { _id: id}, function (err, isAllowed) {
      if (!isAllowed) {
        return next(new AssetPermissionError());
      }

      database.getDatabase(function (error, db) {
        if (error) {
          return next(error);
        }

        self.retrieveAsset({ _id: id }, function (error, assetRecs) {
          if (error) {
            return next(error);
          }

          if (!assetRecs || assetRecs.length !== 1) {
            return next(new AssetNotFoundError(null, id));
          }

          db.update('asset', { _id: id }, {
            _isDeleted: false
          }, function (error) {
            if (error) {
              return next(error);
            }
            next();
          });

        })
      });
    });
  },

  /**
   * processes an uploaded asset
   *
   * @param {object} res
   * @param {object} req
   * @param {callback} next
   */

  postAsset: function (req, res, next) {
    const _respondError = (message, code = 500) => {
      res.status(code).json({ success: false, message: message })
    };
    var form = new IncomingForm();
    // Set to maximum possible size initially, we'll check specific limits after parsing
    form.maxFileSize = configuration.getMaxFileUploadSize('zip');

    var self = this;

    form.parse(req, function (error, fields, files) {
      if (error) {
        if (form.bytesExpected > form.maxFileSize) {
          return _respondError(app.polyglot.t('app.uploadsizeerror', {
            max: bytes.format(form.maxFileSize),
            size: bytes.format(form.bytesExpected)
          }), 400);
        }
        return _respondError(error.message);
      }

      var repository = configuration.getConfig('filestorage') || 'localfs';
      var file = files.file;
      
      // Check file size based on mime type
      if (file && file.type) {
        var maxSizeForType = configuration.getMaxFileUploadSize(file.type);
        if (file.size > maxSizeForType) {
          return _respondError(app.polyglot.t('app.uploadsizeerror', {
            max: bytes.format(maxSizeForType),
            size: bytes.format(file.size)
          }), 400);
        }
      }

      // write the file to some file storage
      filestorage.getStorage(repository, function (error, storage) {
        if (error) {
          return _respondError(error.message);
        }

        // all asset uploads are stored by date
        var user = usermanager.getCurrentUser();
        var metadata = {
          title: fields.title,
          description: fields.description,
          tags: (fields.tags && fields.tags.length) ? fields.tags.split(',') : []
        };

        self._createAssetFromFile(storage, file, metadata, user, repository, function (error, assetRec) {
          if (error) {
            logger.log('error', error);
            return _respondError("An error occured during upload, please contact an Administrator.");
          }
          res.status(200).json({ _id: assetRec._id });
        });
      });
    });
  },

  /**
   * hashes an uploaded/extracted file, stores it and creates its asset record.
   * shared by postAsset (single upload) and importAssets (bulk zip+CSV upload)
   *
   * @param {object} storage
   * @param {object} file - formidable-like file object: { path, name, type, size }
   * @param {object} metadata - { title, description, tags (array of tag ids) }
   * @param {object} user - the uploading user
   * @param {string} repository - the filestorage repository name
   * @param {callback} cb - function (error, assetRec)
   */
  _createAssetFromFile: function (storage, file, metadata, user, repository, cb) {
    var self = this;
    var hash = crypto.createHash('sha1');
    var rs = fs.createReadStream(file.path, {flags: 'r', autoClose: true});

    // feed into hasher
    rs.on('data', data => hash.update(data, 'utf8'));
    rs.on('error', cb);

    // when finished, get the computed has and use to locate file
    rs.on('close', function () {
      var filehash = hash.digest('hex');
      var directory = path.join('assets', filehash.substr(0,2), filehash.substr(2,2));
      var fileExt = path.extname(file.name);
      var filepath = path.join(directory, filehash) + fileExt;
      var uploadedFilePath = file.path;

      var fileOptions = {
        createMetadata: true,
        createThumbnail: true,
        thumbnailOptions: {
          width: THUMBNAIL_WIDTH,
          height: THUMBNAIL_HEIGHT
        }
      };

      // the repository should move the file to a suitable location
      storage.processFileUpload(file, filepath, fileOptions, function (error, storedFile) {
        if (error) {
          return cb(error);
        }

        fs.remove(uploadedFilePath, function(error) {
          if (error) {
            logger.log('error', error);
          }

          var asset = _.extend({
              title: metadata.title,
              description: metadata.description,
              repository: repository,
              filename: filehash + fileExt,
              directory: directory,
              isDirectory: false,
              tags: metadata.tags || [],
              createdBy: user._id,
              dateCreated: new Date()
            },
            storedFile
          );

          self.createAsset(asset, function (createError, assetRec) {
            if (createError) { // if the record creation fails, remove the file that was uploaded
              return storage.deleteFile(storedFile.path, function (delErr) {
                if (delErr) logger.log('error', 'Failed to delete stored file in assetmanager', storedFile.path);
                cb(createError);
              });
            }
            cb(null, assetRec);
          });
        });
      });
    });
  },

  /**
   * handles GET /api/asset/import/template - serves a blank CSV (headers + an example row)
   * matching the columns expected by importAssets.
   */
  downloadAssetCsvTemplate: function (req, res) {
    var lines = [csvRow(ASSET_IMPORT_CSV_COLUMNS), csvRow(ASSET_IMPORT_CSV_SAMPLE_ROW)];

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="asset-import-template.csv"'
    });
    res.status(200).send(lines.join('\r\n') + '\r\n');
  },

  /**
   * handles GET /api/asset/import/:jobId/status - reports the progress of a bulk asset import job.
   */
  getAssetImportStatus: function (req, res) {
    logger.log('info', '[bulkUpload] status poll for job', req.params.jobId);
    var job = importJobs[req.params.jobId];
    if (!job) {
      logger.log('info', '[bulkUpload] job not found', req.params.jobId);
      return res.status(404).json({ success: false, message: 'Import job not found' });
    }
    res.status(200).json(job);
  },

  /**
   * handles a bulk asset upload: a zip file containing asset files plus a CSV (columns:
   * filename, title, description, tags) mapping each file to its asset metadata.
   */
  importAssets: function (req, res, next) {
    logger.log('info', '[bulkUpload] importAssets route hit');
    const _respondError = (message, code = 500) => {
      res.status(code).json({ success: false, message: message })
    };
    var form = new IncomingForm();
    form.maxFileSize = configuration.getMaxFileUploadSize('zip');

    var self = this;

    form.parse(req, function (error, fields, files) {
      if (error) {
        if (form.bytesExpected > form.maxFileSize) {
          return _respondError(app.polyglot.t('app.uploadsizeerror', {
            max: bytes.format(form.maxFileSize),
            size: bytes.format(form.bytesExpected)
          }), 400);
        }
        return _respondError(error.message);
      }

      var zipFile = files.file;
      if (!zipFile || !zipFile.path) {
        return _respondError(app.polyglot.t('app.fileuploaderror'), 400);
      }

      var repository = configuration.getConfig('filestorage') || 'localfs';
      var outputPath = zipFile.path + '_unzipped';

      var _cleanup = function (done) {
        async.parallel([
          function (next) { fs.remove(zipFile.path, function () { next(); }); },
          function (next) { fs.remove(outputPath, function () { next(); }); }
        ], done);
      };

      var rs = fs.createReadStream(zipFile.path);
      var ws = unzip.Extract({ path: outputPath });

      rs.on('error', function (error) {
        _cleanup(function () { _respondError(error.message); });
      });
      ws.on('error', function (error) {
        _cleanup(function () { _respondError(error.message); });
      });

      rs.pipe(ws);

      ws.on('close', function () {
        var extractedFiles = glob.sync(path.join(outputPath, '**', '*'), { nodir: true });
        var csvPath = extractedFiles.filter(function (f) { return /\.csv$/i.test(f); })[0];

        if (!csvPath) {
          return _cleanup(function () {
            _respondError(app.polyglot.t('app.assetimportnocsv'), 400);
          });
        }

        var filesByName = {};
        extractedFiles.forEach(function (f) {
          if (f !== csvPath) {
            filesByName[path.basename(f)] = f;
          }
        });

        fs.readFile(csvPath, 'utf8', function (error, content) {
          if (error) {
            return _cleanup(function () { _respondError(error.message); });
          }

          var rows = helpers.parseCsv(content);

          filestorage.getStorage(repository, function (error, storage) {
            if (error) {
              return _cleanup(function () { _respondError(error.message); });
            }

            app.contentmanager.getContentPlugin('tag', function (error, tagPlugin) {
              if (error) {
                return _cleanup(function () { _respondError(error.message); });
              }

              var user = usermanager.getCurrentUser();
              var tagCache = {};

              var jobId = crypto.randomBytes(8).toString('hex');
              var job = {
                status: 'processing',
                total: rows.length,
                imported: 0,
                errors: [],
                rows: rows.map(function (row) {
                  return {
                    filename: (row.filename || '').trim(),
                    title: row.title || row.filename || '',
                    status: 'pending'
                  };
                })
              };
              importJobs[jobId] = job;

              // respond immediately so the client can start polling for per-asset progress;
              // the rows are then processed asynchronously below
              logger.log('info', '[bulkUpload] job created, responding to client', jobId, 'rows:', rows.length);
              res.status(200).json({ jobId: jobId, total: rows.length, rows: job.rows });

              var resolveTags = function (tagsField, done) {
                var names = (tagsField || '').split(',')
                  .map(function (name) { return name.trim(); })
                  .filter(Boolean);

                async.mapSeries(names, function (name, next) {
                  var key = name.toLowerCase();
                  if (tagCache[key]) {
                    return next(null, tagCache[key]);
                  }
                  tagPlugin.create({ title: name }, function (error, tag) {
                    if (error) {
                      return next(error);
                    }
                    tagCache[key] = tag._id;
                    next(null, tag._id);
                  });
                }, done);
              };

              async.eachOfSeries(rows, function (row, index, rowDone) {
                var rowNum = index + 2; // +1 for header row, +1 for 0-based index
                var filename = row.filename && row.filename.trim();
                var jobRow = job.rows[index];

                jobRow.status = 'uploading';

                var fail = function (message) {
                  jobRow.status = 'error';
                  jobRow.message = message;
                  job.errors.push({ row: rowNum, message: message });
                  rowDone();
                };

                if (!filename) {
                  return fail('Missing required field: filename');
                }

                var matchedPath = filesByName[filename];
                if (!matchedPath) {
                  return fail('No file found in zip matching filename "' + filename + '"');
                }

                var stat;
                try {
                  stat = fs.statSync(matchedPath);
                } catch (statError) {
                  return fail('Could not read file "' + filename + '"');
                }

                var mimeType = mime.getType(matchedPath) || 'application/octet-stream';
                var maxSizeForType = configuration.getMaxFileUploadSize(mimeType);
                if (stat.size > maxSizeForType) {
                  return fail('File "' + filename + '" exceeds the maximum allowed size (' + bytes.format(maxSizeForType) + ')');
                }

                resolveTags(row.tags, function (error, tagIds) {
                  if (error) {
                    return fail('Could not resolve tags for "' + filename + '"');
                  }

                  var fileInfo = { path: matchedPath, name: filename, type: mimeType, size: stat.size };
                  var metadata = {
                    title: row.title || filename,
                    description: row.description || '',
                    tags: tagIds
                  };

                  self._createAssetFromFile(storage, fileInfo, metadata, user, repository, function (error) {
                    if (error) {
                      logger.log('error', error);
                      return fail('Failed to import "' + filename + '"');
                    }
                    jobRow.status = 'done';
                    job.imported++;
                    rowDone();
                  });
                });
              }, function () {
                job.status = 'complete';
                logger.log('info', '[bulkUpload] job complete', jobId, 'imported:', job.imported, 'errors:', job.errors.length);
                _cleanup(function () {});
                setTimeout(function () { delete importJobs[jobId]; }, IMPORT_JOB_TTL);
              });
            });
          });
        });
      });
    });
  },

/**
   * processes an uploaded asset to replace an existing asset
   *
   * @param {object} res
   * @param {object} req
   * @param {callback} next
   */

replaceAsset: function (req, res, next) {
  const _respondError = (message, code = 500) => {
    res.status(code).json({ success: false, message: message })
  };
  var form = new IncomingForm();
  // Set to maximum possible size initially, we'll check specific limits after parsing
  form.maxFileSize = configuration.getMaxFileUploadSize('zip');

  var self = this;

  form.parse(req, function (error, fields, files) {
    if (error) {
      if (form.bytesExpected > form.maxFileSize) {
        return _respondError(app.polyglot.t('app.uploadsizeerror', {
          max: bytes.format(form.maxFileSize),
          size: bytes.format(form.bytesExpected)
        }), 400);
      }
      return _respondError(error.message);
    }

    var repository = configuration.getConfig('filestorage') || 'localfs';
    var file = files.file;
    
    // Check file size based on mime type
    if (file && file.type) {
      var maxSizeForType = configuration.getMaxFileUploadSize(file.type);
      if (file.size > maxSizeForType) {
        return _respondError(app.polyglot.t('app.uploadsizeerror', {
          max: bytes.format(maxSizeForType),
          size: bytes.format(file.size)
        }), 400);
      }
    }

    // Get the asset ID from the fields
    var assetId = fields._id;
    if (!assetId) {
      return _respondError('Asset ID is required for replacement', 400);
    }

    // First, retrieve the existing asset
    self.retrieveAsset({ _id: assetId }, function (error, assetRecs) {
      if (error) {
        return _respondError(error.message);
      }

      if (!assetRecs || assetRecs.length !== 1) {
        return _respondError('Asset not found', 404);
      }

      var existingAsset = assetRecs[0];

      // Get file storage
      filestorage.getStorage(repository, function (error, storage) {
        if (error) {
          return _respondError(error.message);
        }

        var user = usermanager.getCurrentUser();
        var date = new Date();

        // Delete the old file first
        if (existingAsset.path) {
          storage.deleteFile(existingAsset.path, function (delErr) {
            if (delErr) {
              logger.log('warn', 'Could not delete old asset file:', existingAsset.path, delErr);
            }
          });
        }

        // Delete old thumbnail if it exists
        if (existingAsset.thumbnailPath) {
          storage.deleteFile(existingAsset.thumbnailPath, function (delErr) {
            if (delErr) {
              logger.log('warn', 'Could not delete old thumbnail:', existingAsset.thumbnailPath, delErr);
            }
          });
        }

        // Process the new file upload
        var hash = crypto.createHash('sha1');
        var rs = fs.createReadStream(file.path, {flags: 'r', autoClose: true});

        rs.on('data', data => hash.update(data, 'utf8'));

        rs.on('close', function () {
          var filehash = hash.digest('hex');
          var directory = path.join('assets', filehash.substr(0,2), filehash.substr(2,2));
          var fileExt = path.extname(file.name);
          var filepath = path.join(directory, filehash) + fileExt;
          var uploadedFilePath = file.path;

          // Only rename if the file type actually changed - keeps the common case (same type) a no-op.
          var extensionChanged = fileExt.toLowerCase() !== path.extname(existingAsset.filename || '').toLowerCase();
          var newFilename = extensionChanged ? (filehash + fileExt) : existingAsset.filename;

          var fileOptions = {
            createMetadata: true,
            createThumbnail: true,
            thumbnailOptions: {
              width: THUMBNAIL_WIDTH,
              height: THUMBNAIL_HEIGHT
            }
          };

          storage.processFileUpload(file, filepath, fileOptions, function (error, storedFile) {
            if (error) {
              return _respondError(error.message);
            }

            fs.remove(uploadedFilePath, function(error) {
              if (error) {
                logger.log('error', error);
              }

              // Update the existing asset with new file information
              var updateData = {
                title: fields.title || existingAsset.title,
                description: fields.description || existingAsset.description,
                // Course content refers to assets by filename - keep it stable unless the file type changed.
                filename: newFilename,
                directory: directory,
                path: storedFile.path,
                size: storedFile.size,
                mimeType: storedFile.mimeType,
                assetType: storedFile.assetType,
                metadata: storedFile.metadata,
                updatedAt: date
              };

              // Update thumbnail path if available
              if (storedFile.thumbnailPath) {
                updateData.thumbnailPath = storedFile.thumbnailPath;
              }

              // Update tags if provided
              if (fields.tags && fields.tags.length) {
                updateData.tags = fields.tags.split(',');
              }

              // Update the asset record
              self.updateAsset({ _id: assetId }, updateData, function (updateError) {
                if (updateError) {
                  logger.log('error', 'Failed to update asset record:', updateError);
                  // Try to clean up the uploaded file
                  storage.deleteFile(storedFile.path, function (delErr) {
                    if (delErr) logger.log('error', 'Failed to delete uploaded file after update error', storedFile.path);
                  });
                  return _respondError('Failed to update asset record');
                }

                if (!extensionChanged) {
                  return res.status(200).json({
                    success: true,
                    _id: assetId,
                    message: 'Asset replaced successfully'
                  });
                }

                // The filename (and its extension) changed, so bring content/courseasset references in line with it.
                self.updateAssetFilenameReferences(assetId, existingAsset.filename, newFilename, function (refError) {
                  if (refError) {
                    logger.log('error', 'Failed to update content references after asset rename:', refError);
                  }

                  res.status(200).json({
                    success: true,
                    _id: assetId,
                    message: 'Asset replaced successfully'
                  });
                });
              });
            });
          });
        });
      });
    });
  });
},

/**
 * keeps content/courseasset records in sync when a replace changes an asset's filename
 *
 * @param {string} assetId
 * @param {string} oldFilename
 * @param {string} newFilename
 * @param {callback} next - function(error)
 */
updateAssetFilenameReferences: function (assetId, oldFilename, newFilename, next) {
  database.getDatabase(function (error, db) {
    if (error) {
      return next(error);
    }

    db.retrieve('courseasset', { _assetId: assetId }, function (error, refs) {
      if (error) {
        return next(error);
      }
      if (!refs || !refs.length) {
        return next();
      }

      var oldRef = 'course/assets/' + oldFilename;
      var newRef = 'course/assets/' + newFilename;
      var escapedOldRef = oldRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var replaceRegex = new RegExp(escapedOldRef, 'g');

      async.each(refs, function (ref, cb) {
        async.series([
          // rewrite the embedded 'course/assets/<filename>' reference on the content document itself
          function (seriesCb) {
            db.retrieve(ref._contentType, { _id: ref._contentTypeId }, function (error, docs) {
              if (error || !docs || !docs.length) {
                return seriesCb(error);
              }
              var original = docs[0].toObject ? docs[0].toObject() : docs[0];
              var modified;
              try {
                modified = JSON.parse(JSON.stringify(original).replace(replaceRegex, newRef));
              } catch (parseError) {
                return seriesCb(parseError);
              }

              // Only include fields that actually changed, so untouched (eg. ObjectId) fields are left alone.
              var delta = {};
              Object.keys(modified).forEach(function (key) {
                if (JSON.stringify(modified[key]) !== JSON.stringify(original[key])) {
                  delta[key] = modified[key];
                }
              });

              if (!Object.keys(delta).length) {
                return seriesCb();
              }
              db.update(ref._contentType, { _id: ref._contentTypeId }, delta, seriesCb);
            });
          },
          // keep the courseasset's own filename lookup (used by the editor's asset picker) in sync
          function (seriesCb) {
            if (ref._fieldName !== oldFilename) {
              return seriesCb();
            }
            db.update('courseasset', { _id: ref._id }, { _fieldName: newFilename }, seriesCb);
          }
        ], cb);
      }, next);
    });
  });
},

  /**
   * responder for post requests
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */

  putAsset: function (req, res, next) {

    //var form = new IncomingForm();
    var self = this;
    var fields = req.body;

    var asset = {
      title: fields.title,
      description: fields.description,
      tags: _.pluck(fields.tags, '_id')
    };

    self.updateAsset({ _id: req.body._id }, asset, function (error, assetRec) {

      if (error) {
        return next(error);
      }

      res.statusCode = 200;
      return res.json({success: true});

    });

    // Not sure we need all this just yet!
    /*form.parse(req, function (error, fields, files) {
      if (error) {
        return next(error);
      }

      // first, ensure we can retrieve the original asset
      self.retrieveAsset({ _id: req.params.id }, function (error, assetRecs) {
        if (error) {
          return next(error);
        }

        if (!assetRecs || assetRecs.length !== 1) {
          res.statusCode = 404;
          return res.json({ success: false, message: 'asset not found' });
        }

        var assetRec = assetRecs[0];
        // write the file to some file storage
        // NB. we don't allow the repository to be changed when updating an asset
        filestorage.getStorage(assetRec.repository, function (error, storage) {
          if (error) {
            return next(error);
          }

          // all asset uploads are stored by date
          var file = files.file;
          var date = new Date();
          var filepath = assetRec.path;
          var delta = fields;

          // set modified date
          delta.dateModified = date;

          // don't overwrite the file unless a new one is provided
          if (file) {
            // the repository should move the file to a suitable location
            storage.processFileUpload(file, filepath, function (error, storedFile) {
              if (error) {
                return next(error);
              }

              // update the delta info
              delta.size = storedFile.size;
              delta.mimeType = storedFile.type;

              // update the asset record
              self.updateAsset({ _id: assetRec._id }, delta, function (error, assetRec) {
                if (error) {
                  return next(error);
                }

                res.statusCode = 200;
                return res.json({success: true});
              });
            });
          } else {
            // just update the fields
            self.updateAsset({ _id: assetRec._id }, delta, function (error, assetRec) {
              if (error) {
                return next(error);
              }

              res.statusCode = 200;
              return res.json({success: true});
            });
          }
        });
      });
    });*/
  },

  /**
   * query asset collections
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */

  queryAssets: function (req, res, next) {
    var options = _.keys(req.body).length
      ? req.body
      : req.query;
    var search = options.search || {};
    var self = this;
    var orList = [];
    var andList = [];

    if (search.hasOwnProperty('_isDeleted')) {
      if (search._isDeleted == 'false') {
        search._isDeleted = false;
      } else {
        search._isDeleted = true;
      }
    }

    // convert searches to regex
    async.each(
      Object.keys(search),
      function (key, nextKey) {
        var exp = {};
        // convert strings to regex for likey goodness
        if ('string' === typeof search[key]) {
          exp[key] = new RegExp(search[key], 'i');
          orList.push(exp);
        } else {
          exp[key] = search[key];
          andList.push(exp);
        }
        nextKey();
      },
      function () {
        var query = {};
        if (orList.length) {
          query.$or = orList;
        }

        if (andList.length) {
          query.$and = andList;
        }

        self.retrieveAsset(query, options, function (error, assetRecs) {
          if (error) {
            return next(error);
          }

          // record was not found
          if (!assetRecs) {
            res.statusCode = 404;
            return res.json({ success: false, message: 'assets not found' });
          }

          res.statusCode = 200;
          return res.json(assetRecs);
        });
      }
    );
  },

  /**
   * responder for asset collections
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */
   // Commented out as assets are now queried
  /*getAssets: function (req, res, next) {
    var search = req.query;
    var options = req.query.operators || {};

    var pop = { tags: '_id title' };
    if (!options.populate) {
      options.populate = pop;
    } else {
      options.populate = _.extend(pop, options.populate);
    }

    this.retrieveAsset(search, options, function (error, assetRecs) {
      if (error) {
        return next(error);
      }

      // record was not found
      if (!assetRecs) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'asset not found' });
      }

      res.statusCode = 200;
      return res.json(assetRecs);
    });
  },*/

  /**
   * responder for get requests
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */

  getAsset: function (req, res, next) {
    var options = req.query.operators || {};
    var pop = { tags: '_id title' };
    if (!options.populate) {
      options.populate = pop;
    } else {
      options.populate = _.extend(pop, options.populate);
    }

    this.retrieveAsset({ _id: req.params.id }, options, function (error, assetRecs) {
      if (error) {
        return next(error);
      }

      // record was not found
      if (!assetRecs || !assetRecs.length) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'asset not found' });
      }

      res.statusCode = 200;
      return res.json(assetRecs[0]);
    });
  },

  /**
   * serves the file for an asset - one at a time!
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */

  serveAsset: function (req, res, next) {
    // Remove any trailing extension (if it's been passed in).
    var assetId = req.params.id.indexOf('.') > -1
      ? req.params.id.split('.')[0]
      : req.params.id;

    this.retrieveAsset({ _id:  assetId}, function (error, assetRecs) {
      if (error) {
        return next(error);
      }

      // record was not found
      if (!assetRecs || assetRecs.length !== 1) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'asset not found' });
      }

      var assetRec = assetRecs[0];
      filestorage.getStorage(assetRec.repository, function (error, storage) {
        if (error) {
          return next(error);
        }

        storage.createReadStream(assetRec.path, { bufferSize: STREAM_BUFFER_SIZE }, function (stream) {
          res.writeHead(200, {
            'Content-Type': assetRec.mimeType,
            'Content-Length': assetRec.size,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          stream.pipe(res);
          stream.on('end', function () {
            return res.end();
          });
        });
      });
    });
  },

  /**
   * serves the thumb for an asset - one at a time!
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */

  assetThumb: function (req, res, next) {
    this.retrieveAsset({ _id: req.params.id }, function (error, assetRecs) {
      if (error) {
        return next(error);
      }
      // record was not found
      if (!assetRecs || assetRecs.length !== 1) {
        res.statusCode = 404;
        return res.json({ success: false, message: 'asset not found' });
      }
      var assetRec = assetRecs[0];
      // Return a generic image when no thumnail exists
      if (!assetRec.thumbnailPath || assetRec.thumbnailPath === 'false') {
        // TODO -- Refactor and use a disk-based image (#850)
        var img = Buffer.from(DEFAULT_THUMBNAIL_BASE64, 'base64');
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': img.length,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(img);
      }
      filestorage.getStorage(assetRec.repository, function (error, storage) {
        if (error) {
          return next(error);
        }
        storage.createReadStream(assetRec.thumbnailPath, { bufferSize: STREAM_BUFFER_SIZE }, function (stream) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          stream.pipe(res);
          stream.on('end', () => res.end());
        });
      });
    });
  },

  /**
   * serves a shared asset from master tenant
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */

   serveSharedAsset: function (req, res, next) {
    database.getDatabase(function (error, db) {
      if (error) {
        return next(error);
      }
      var options = req.query.operators || {};

      db.retrieve('asset', { _id: req.params.id }, options, function (error, assetRecs) {
        if (error) {
          return next(error);
        }

        // record was not found
        if (!assetRecs || assetRecs.length !== 1) {
          res.statusCode = 404;
          return res.json({ success: false, message: 'asset not found' });
        }

        var assetRec = assetRecs[0];
        filestorage.getStorage(assetRec.repository, function (error, storage) {
          if (error) {
            return next(error);
          }

          storage.createReadStream(assetRec.path, { bufferSize: STREAM_BUFFER_SIZE, forceMaster: true }, function (stream) {
            res.writeHead(200, {
            'Content-Type': assetRec.mimeType,
            'Content-Length': assetRec.size
          });

          stream.pipe(res);
          stream.on('end', function () {
            return res.end();
          });
        });
      });
    });
  // db will be the master database ...
  }, configuration.getConfig('dbName'));
},

/**
   * gets uses of an asset from master tenant
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */

assetUses: async function (req, res, next) {
  try {
    const db = await new Promise((resolve, reject) => {
      database.getDatabase((err, db) => err ? reject(err) : resolve(db));
    });

    const retrieve = util.promisify(db.retrieve.bind(db));

    // Get asset
    const assetRecs = await retrieve('asset', {_id: req.params.id});
    if (!assetRecs.length) {
      return res.status(404).json({ courses: [], components: [] });
    }
    const asset = assetRecs[0];
    const assetIdStr = asset._id.toString();

    // Assets can be referenced by filename, by repository path, or (eg. 'heroImage'
    // fields on pages/menus/courses) by the asset's raw _id stored directly on the document
    const filename = asset.filename;
    const repository = asset.repository || '';

    logger.log('info', `Checking usage for asset - filename: ${filename}, repository: ${repository}`);

    // retrieve the structured 'courseasset' tracking records for this asset (covers most
    // asset-picker fields), plus every document from every content type that can hold an
    // asset reference, so page graphics/heroes/menus/extensions etc. are all considered
    const [courseAssetRefs, contentDocs] = await Promise.all([
      retrieve('courseasset', { _assetId: assetIdStr }),
      Promise.all(ASSET_USAGE_CONTENT_TYPES.map(type => retrieve(type, {}).then(docs => {
        return docs.map(doc => ({ type: type, doc: doc }));
      }))).then(results => [].concat.apply([], results))
    ]);

    const trackedIds = new Set(courseAssetRefs.map(ref => String(ref._contentTypeId)));

    // Filter content docs that use this asset
    const usedDocs = contentDocs.filter(entry => {
      const doc = entry.doc;
      if (trackedIds.has(String(doc._id))) {
        logger.log('info', `Asset found in ${entry.type} ${doc._id} (by courseasset record)`);
        return true;
      }
      const docStr = JSON.stringify(doc);
      const foundByFilename = filename && docStr.includes(filename);
      const foundByRepository = repository && docStr.includes(repository);
      const foundById = docStr.includes(assetIdStr);

      const found = foundByFilename || foundByRepository || foundById;

      if (found) {
        logger.log('info', `Asset found in ${entry.type} ${doc._id} (by ${foundByFilename ? 'filename' : foundByRepository ? 'repository' : 'id'})`);
      }
      return found;
    });

    logger.log('info', `Content items using this asset: ${usedDocs.length}`);

    // If nothing uses this asset, return early
    if (usedDocs.length === 0) {
      return res.status(200).json({ courses: [], components: [] });
    }

    // Get unique course IDs from the matched content (the course document's own _id is
    // its course ID; everything else carries a _courseId field)
    const courseIds = [...new Set(usedDocs.map(entry => {
      return String(entry.type === 'course' ? entry.doc._id : entry.doc._courseId);
    }).filter(Boolean))];

    // Retrieve only the courses that actually use this asset
    const courses = await retrieve('course', {
      _id: { $in: courseIds }
    });

    // Build course lookup map for quick access
    const courseMap = {};
    courses.forEach(course => {
      const courseId = course._id.toString();
      courseMap[courseId] = {
        id: course._uniqueId || course._id,
        title: course.displayTitle || course.title
      };
    });

    // Build response objects
    const componentList = usedDocs.map(entry => {
      const doc = entry.doc;
      const courseIdStr = String(entry.type === 'course' ? doc._id : doc._courseId);
      const courseEntry = courseMap[courseIdStr];
      return {
        courseId: courseEntry ? courseEntry.id : doc._courseId,
        id: doc._uniqueId || doc._id,
        title: doc.displayTitle || doc.title || ('(' + entry.type + ')')
      };
    });

    const courseList = Object.values(courseMap);

    res.status(200).json({
      courses: courseList,
      components: componentList
    });

  } catch (err) {
    logger.log('error', 'Error in assetUses:', err);
    return next(err);
  }
},

/**
 * lists non-deleted assets that aren't referenced anywhere in any course content, so they
 * can be reviewed and permanently deleted in bulk via the asset cleanup tool.
 *
 * @param {object} req
 * @param {object} res
 * @param {callback} next
 */

getUnusedAssets: async function (req, res, next) {
  var self = this;
  try {
    const retrieveAsset = util.promisify(self.retrieveAsset.bind(self));
    const db = await new Promise((resolve, reject) => {
      database.getDatabase((err, db) => err ? reject(err) : resolve(db));
    });
    const retrieve = util.promisify(db.retrieve.bind(db));

    const [assets, courseAssetRefs, contentDocsByType] = await Promise.all([
      retrieveAsset({ _isDeleted: false }, {}),
      retrieve('courseasset', {}),
      Promise.all(ASSET_USAGE_CONTENT_TYPES.map(type => retrieve(type, {})))
    ]);

    // structured tracking records (covers most asset-picker fields)
    const trackedAssetIds = new Set(courseAssetRefs.map(ref => String(ref._assetId)));

    // same filename/repository/id matching heuristic as assetUses, but computed once
    // across every content document so we don't re-query per-asset. This catches
    // references that bypass 'courseasset' tracking (eg. 'heroImage' fields store the
    // asset's raw _id directly on the page/menu/course document)
    const contentStrings = [].concat.apply([], contentDocsByType).map(doc => JSON.stringify(doc));

    const isUsed = asset => {
      const idStr = asset._id.toString();
      if (trackedAssetIds.has(idStr)) {
        return true;
      }
      const filename = asset.filename;
      const repository = asset.repository || '';
      return contentStrings.some(str => {
        return (filename && str.includes(filename)) ||
          (repository && str.includes(repository)) ||
          str.includes(idStr);
      });
    };

    const unused = (assets || []).filter(asset => !isUsed(asset));

    res.status(200).json({
      assets: unused.map(asset => ({
        _id: asset._id,
        title: asset.title,
        filename: asset.filename,
        assetType: asset.assetType,
        mimeType: asset.mimeType,
        size: asset.size,
        metadata: asset.metadata,
        updatedAt: asset.updatedAt,
        usageCount: 0
      }))
    });
  } catch (err) {
    logger.log('error', 'Error in getUnusedAssets:', err);
    return next(err);
  }
},

/**
 * permanently deletes multiple assets at once, used by the asset cleanup tool
 *
 * @param {object} req
 * @param {object} res
 * @param {callback} next
 */

bulkDeleteAssets: function (req, res, next) {
  var self = this;
  var ids = (req.body && req.body.ids) || [];

  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, message: 'No asset ids provided' });
  }

  var deleted = [];
  var errors = [];

  async.eachSeries(ids, function (id, cb) {
    self.destroyAsset(id, function (error) {
      if (error) {
        logger.log('error', 'Failed to delete asset', id, error);
        errors.push({ id: id, message: error.message });
      } else {
        deleted.push(id);
      }
      cb();
    });
  }, function () {
    res.status(200).json({ success: true, deleted: deleted, errors: errors });
  });
},

  /**
   * responder for delete requests
   *
   * @param {object} req
   * @param {object} res
   * @param {callback} next
   */

  deleteAsset: function (req, res, next) {

    this.destroyAsset(req.params.id, function (error) {
      if (error) {
        return next(error);
      }

      res.statusCode = 200;
      return res.json({success: true});
    });
  },

  trashAssetByID: function(req, res, next) {
    this.trashAsset(req.params.id, function(error) {
      if (error) {
        return next(error);
      }

      res.statusCode = 200;
      return res.json({success: true});
    })
  },

  restoreAssetByID: function (req, res, next) {
    this.restoreAsset(req.params.id, function(error) {
      if (error) {
        return next(error);
      }

      res.statusCode = 200;
      return res.json({success: true});
    })
    /*this.destroyAsset(req.params.id, function (error) {
      if (error) {
        return next(error);
      }

      res.statusCode = 200;
      return res.json({success: true});
    });*/
  }
};




