// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
var ContentPlugin = require('../../../lib/contentmanager').ContentPlugin,
    configuration = require('../../../lib/configuration'),
    permissions = require('../../../lib/permissions'),
    async = require('async'),
    util = require('util'),
    path = require('path');

function AuditLog() {
}

util.inherits(AuditLog, ContentPlugin);

/**
 * implements ContentPlugin#getModelName
 *
 * @return {string}
 */
AuditLog.prototype.getModelName = function() {
  return 'auditlog';
};

/**
 * Overrides base.hasPermission - audit logs should be read-only for most users
 *
 * @param {string} action
 * @param {objectid} userId
 * @param {objectid} tenantId
 * @param {object} contentItem
 * @param {callback} next
 */
AuditLog.prototype.hasPermission = function(action, userId, tenantId, contentItem, next) {
  // Only admins can delete audit logs
  if (action === 'delete') {
    return permissions.hasPermissions(userId, ['*'], function(err, hasPermission) {
      return next(null, hasPermission);
    });
  }
  
  // Everyone can read audit logs (for their own content)
  if (action === 'retrieve') {
    return next(null, true);
  }
  
  // Only system can create audit logs
  if (action === 'create') {
    return next(null, true);
  }
  
  // No one can update audit logs
  if (action === 'update') {
    return next(null, false);
  }
  
  return next(null, false);
};

/**
 * essential setup
 *
 * @api private
 */
function initialize() {
  var app = require('../../../')();
  var rest = require('../../../lib/rest');

  // Defer until the server (and rest/contentmanager) is fully up, same as other content plugins.
  app.once('serverStarted', function () {
    if (app.contentmanager) {
      app.contentmanager.addContentHook('create', '*', { when: 'post' }, auditCreate);
      app.contentmanager.addContentHook('update', '*', { when: 'pre' }, auditCaptureOriginal);
      app.contentmanager.addContentHook('update', '*', { when: 'post' }, auditUpdate);
      app.contentmanager.addContentHook('destroy', '*', { when: 'pre' }, auditDestroy);
    }

    // Permissions are enforced in AuditLog#hasPermission, not the generic policy checker (matches /api/content and /api/asset).
    permissions.ignoreRoute(/^\/api\/auditlog\/?.*$/);

    // Add custom routes for audit log retrieval
    rest.get('/auditlog/course/:courseId', getAuditLogsByCourse);
    rest.get('/auditlog/content/:contentType/:contentId', getAuditLogsByContent);
  });
}

/**
 * Hook for create operations
 */
function auditCreate(data, callback, contentType) {
  // create/update hooks receive a single saved document, not an array - normalize either way.
  var items = data ? [].concat(data) : [];
  if (!items.length) {
    return callback(null, data);
  }
  
  // Don't log audit log creation (infinite loop!)
  if (items[0] && items[0]._type === 'auditlog') {
    return callback(null, data);
  }
  
  var app = require('../../../')();
  var usermanager = require('../../../lib/usermanager');
  var user = usermanager.getCurrentUser();
  
  items.forEach(function(item) {
    if (item && item._id) {
      // some schemas (e.g. config) don't inherit _type, so fall back to the type the hook fired for.
      var itemType = item._type || contentType || 'unknown';
      var logEntry = {
        action: 'create',
        contentType: itemType,
        contentId: item._id,
        contentTitle: getContentTitle(item),
        // courses aren't tagged with their own _courseId, so self-reference for the Change History lookup.
        courseId: item._courseId || (itemType === 'course' ? item._id : null),
        parentId: item._parentId || null,
        userId: user._id,
        userName: user.email,
        userEmail: user.email,
        timestamp: new Date().toISOString(),
        changes: [],
        snapshot: item.toJSON ? item.toJSON() : item,
        _tenantId: user.tenant._id
      };
      
      app.contentmanager.create('auditlog', logEntry, function(err) {
        if (err) {
          console.error('Failed to create audit log:', err);
        }
      });
    }
  });
  
  callback(null, data);
}

/**
 * Hook for update operations
 */

// Transient store of pre-update snapshots, keyed by content _id, populated by the
// 'pre' update hook and consumed by the 'post' update hook below. By the time the
// 'post' hook runs, the write has already been committed, so the original document
// must be captured *before* the update happens.
var pendingUpdateOriginals = {};

function auditCaptureOriginal(data, callback, contentType) {
  var search = data && data[0];
  if (!search || !search._id) {
    return callback(null, data);
  }

  var app = require('../../../')();
  app.contentmanager.retrieve(contentType, { _id: search._id }, {}, function(err, results) {
    if (!err && results && results.length > 0) {
      var original = results[0].toJSON ? results[0].toJSON() : results[0];
      if (original._type !== 'auditlog') {
        pendingUpdateOriginals[String(search._id)] = original;
      }
    }
    callback(null, data);
  });
}

function auditUpdate(data, callback, hookContentType) {
  // create/update hooks receive a single saved document, not an array - normalize either way.
  var items = data ? [].concat(data) : [];
  if (!items.length) {
    return callback(null, data);
  }
  
  // Don't log audit log updates
  if (items[0] && items[0]._type === 'auditlog') {
    return callback(null, data);
  }
  
  var app = require('../../../')();
  var usermanager = require('../../../lib/usermanager');
  var user = usermanager.getCurrentUser();
  
  items.forEach(function(item) {
    if (item && item._id) {
      // some schemas (e.g. config) don't inherit _type, so fall back to the type the hook fired for.
      var contentType = item._type || item.constructor.modelName || hookContentType;
      var key = String(item._id);
      var original = pendingUpdateOriginals[key];
      delete pendingUpdateOriginals[key];

      if (!original) {
        return;
      }

      var updated = item.toJSON ? item.toJSON() : item;
      var changes = detectChanges(original, updated);
        
      if (changes.length > 0) {
        var logEntry = {
          action: 'update',
          contentType: contentType,
          contentId: item._id,
          contentTitle: getContentTitle(updated),
          // courses aren't tagged with their own _courseId, so self-reference for the Change History lookup.
          courseId: item._courseId || original._courseId || (contentType === 'course' ? item._id : null),
          parentId: item._parentId || original._parentId || null,
          userId: user._id,
          userName: user.email,
          userEmail: user.email,
          timestamp: new Date().toISOString(),
          changes: changes,
          snapshot: updated,
          _tenantId: user.tenant._id
        };
          
        app.contentmanager.create('auditlog', logEntry, function(err) {
          if (err) {
            console.error('Failed to create audit log:', err);
          }
        });
      }
    }
  });
  
  callback(null, data);
}

/**
 * Hook for destroy operations
 */
function auditDestroy(data, callback, contentType) {
  // Don't log audit log deletions
  if (data && data[0] && data[0]._type === 'auditlog') {
    return callback(null, data);
  }
  
  var app = require('../../../')();
  var usermanager = require('../../../lib/usermanager');
  var user = usermanager.getCurrentUser();
  
  // Data contains the search criteria, we need to retrieve before delete
  var searchCriteria = data[0];
  
  if (searchCriteria && searchCriteria._id) {
    app.contentmanager.retrieve(contentType, searchCriteria, {}, function(err, results) {
      if (err || !results || results.length === 0) {
        return callback(null, data);
      }
      
      async.eachSeries(results, function(item, itemDone) {
        var snapshot = item.toJSON ? item.toJSON() : item;
        
        var logEntry = {
          action: 'delete',
          contentType: contentType,
          contentId: item._id,
          contentTitle: getContentTitle(snapshot),
          // courses aren't tagged with their own _courseId, so self-reference for the Change History lookup.
          courseId: item._courseId || (contentType === 'course' ? item._id : null),
          parentId: item._parentId || null,
          userId: user._id,
          userName: user.email,
          userEmail: user.email,
          timestamp: new Date().toISOString(),
          changes: [],
          snapshot: snapshot,
          _tenantId: user.tenant._id
        };
        
        app.contentmanager.create('auditlog', logEntry, function(err) {
          if (err) {
            console.error('Failed to create audit log:', err);
          }
          // cascading delete (destroyChildren) calls child plugins directly, bypassing the
          // hook pipeline, so walk + log descendants (e.g. a block's components) ourselves here,
          // before the cascade actually removes them.
          logDescendantDeletes(app, user, contentType, item._id, itemDone);
        });
      }, function() {
        callback(null, data);
      });
    });
  } else {
    callback(null, data);
  }
}

/**
 * Recursively finds and logs the deletion of a content item's descendants (e.g. a block's
 * components, a page's articles/blocks/components). Needed because ContentPlugin#destroyChildren
 * calls each child plugin's destroy() directly, which bypasses the contentmanager hook pipeline
 * that auditDestroy itself relies on.
 */
function logDescendantDeletes(app, user, contentType, parentId, callback) {
  app.contentmanager.getContentPlugin(contentType, function(err, plugin) {
    if (err || !plugin) {
      return callback();
    }
    var childTypes = plugin.getChildType();
    if (!childTypes) {
      return callback();
    }
    childTypes = [].concat(childTypes);
    // courses tag their children via _courseId; everything else nests via _parentId.
    var parentAttribute = contentType === 'course' ? '_courseId' : '_parentId';
    var search = {};
    search[parentAttribute] = parentId;

    async.eachSeries(childTypes, function(childType, typeDone) {
      app.contentmanager.retrieve(childType, search, {}, function(err, children) {
        if (err || !children || !children.length) {
          return typeDone();
        }

        async.eachSeries(children, function(child, childDone) {
          var snapshot = child.toJSON ? child.toJSON() : child;
          var logEntry = {
            action: 'delete',
            contentType: childType,
            contentId: child._id,
            contentTitle: getContentTitle(snapshot),
            courseId: child._courseId || null,
            parentId: child._parentId || null,
            userId: user._id,
            userName: user.email,
            userEmail: user.email,
            timestamp: new Date().toISOString(),
            changes: [],
            snapshot: snapshot,
            _tenantId: user.tenant._id
          };

          app.contentmanager.create('auditlog', logEntry, function(err) {
            if (err) {
              console.error('Failed to create audit log:', err);
            }
            // recurse in case this child itself has children (e.g. article -> block -> component)
            logDescendantDeletes(app, user, childType, child._id, childDone);
          });
        }, typeDone);
      });
    }, callback);
  });
}

/**
 * Best-effort human-readable label for a content item (schemas vary - not all have a title).
 */
function getContentTitle(item) {
  if (!item) {
    return '';
  }
  return item.title || item.name || item.displayTitle || item.heading || item._component || '';
}

/**
 * Detect changes between old and new objects
 */
function detectChanges(oldObj, newObj) {
  var changes = [];
  var ignoredFields = ['updatedAt', '__v', '_id', 'createdAt', 'createdBy'];
  
  // Check for modified and new fields
  Object.keys(newObj).forEach(function(key) {
    if (ignoredFields.indexOf(key) !== -1) {
      return;
    }
    
    var oldValue = oldObj[key];
    var newValue = newObj[key];
    
    // Skip if values are the same
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      return;
    }
    
    var changeType = detectChangeType(key, newValue);
    
    changes.push({
      field: key,
      oldValue: oldValue,
      newValue: newValue,
      changeType: changeType
    });
  });
  
  // Check for deleted fields
  Object.keys(oldObj).forEach(function(key) {
    if (ignoredFields.indexOf(key) !== -1) {
      return;
    }
    
    if (!newObj.hasOwnProperty(key)) {
      changes.push({
        field: key,
        oldValue: oldObj[key],
        newValue: null,
        changeType: 'deleted'
      });
    }
  });
  
  return changes;
}

/**
 * Detect the type of change based on field name and value
 */
function detectChangeType(fieldName, value) {
  var imageFields = ['_graphic', 'image', 'thumbnail', 'src', '_backgroundImage'];
  var videoFields = ['_media', 'video', 'mp4', 'webm'];
  var audioFields = ['audio', 'mp3', 'ogg'];
  
  if (imageFields.some(function(f) { return fieldName.indexOf(f) !== -1; })) {
    return 'image';
  }
  
  if (videoFields.some(function(f) { return fieldName.indexOf(f) !== -1; })) {
    return 'video';
  }
  
  if (audioFields.some(function(f) { return fieldName.indexOf(f) !== -1; })) {
    return 'audio';
  }
  
  if (typeof value === 'string') {
    return 'text';
  }
  
  if (typeof value === 'number') {
    return 'number';
  }
  
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  
  if (Array.isArray(value)) {
    return 'array';
  }
  
  if (typeof value === 'object') {
    return 'object';
  }
  
  return 'unknown';
}

/**
 * Get audit logs by course
 */
function getAuditLogsByCourse(req, res, next) {
  var app = require('../../../')();
  var courseId = req.params.courseId;
  
  var options = {
    operators: {
      sort: { timestamp: -1 },
      limit: parseInt(req.query.limit) || 100,
      skip: parseInt(req.query.skip) || 0
    }
  };
  
  app.contentmanager.retrieve('auditlog', { courseId: courseId }, options, function(err, results) {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    
    res.status(200).json(results);
  });
}

/**
 * Get audit logs by content
 */
function getAuditLogsByContent(req, res, next) {
  var app = require('../../../')();
  var user = require('../../../lib/usermanager').getCurrentUser();
  var contentType = req.params.contentType;
  var contentId = req.params.contentId;
  
  var options = {
    operators: {
      sort: { timestamp: -1 }
    }
  };
  
  app.contentmanager.retrieve('auditlog', { 
    _tenantId: user.tenant._id,
    contentType: contentType,
    contentId: contentId 
  }, options, function(err, results) {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    
    res.status(200).json(results);
  });
}

/**
 * Module exports
 */
exports = module.exports = AuditLog;

// Initialize hooks when module is loaded
initialize();
