var util = require('util');
var fs = require('fs-extra');
var os = require('os');
var path = require('path');
var mongoose = require('mongoose');
var database = require('../database');
var permissions = require('../permissions');
var usermanager = require('../usermanager');
var filestorage = require('../filestorage');
var configuration = require('../configuration');
var logger = require('../logger');
var origin = require('../../');
var catalogService = require('./conversionCatalog');
var planner = require('./conversionPlan');
var schema = require('./conversionSchema');

function call(target, method) {
  return util.promisify(target[method].bind(target)).apply(null, Array.prototype.slice.call(arguments, 2));
}
function failure(status, message) { var error = new Error(message); error.status = status; return error; }
async function retrieve(db, type, search) { return call(db, 'retrieve', type, search, { jsonOnly: true }); }

function emptyObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(function(key) { return emptyObject(value[key]); });
}

function locations(snapshot) {
  var result = Object.create(null);
  function visit(nodes, parents) {
    if (!Array.isArray(nodes)) return;
    nodes.forEach(function(node) {
      if (!node || typeof node !== 'object') return;
      var label = { type: node.type, title: node.title || node.displayTitle || '', component: node._component || '' };
      var path = parents.concat([label]);
      if (typeof node._id === 'string') result[node._id] = path;
      visit(node.children, path);
    });
  }
  visit(snapshot.contentTree && snapshot.contentTree.children, []);
  return result;
}

async function prepare(db, draft, tenantId) {
  var versions = await retrieve(db, 'lightcourseversion', { _lightCourseId: draft._id });
  versions.sort(function(a, b) {
    var left = a.versionNumber.split('.').map(Number), right = b.versionNumber.split('.').map(Number);
    return right[0] - left[0] || right[1] - left[1];
  });
  if (!versions.length || versions[0].versionNumber !== draft.currentVersionNumber) {
    throw failure(400, 'Create a saved version before converting this Light Course.');
  }
  if (versions[0]._tenantId && String(versions[0]._tenantId) !== String(tenantId)) {
    throw failure(403, 'The saved version does not belong to this tenant.');
  }
  var catalog = await catalogService.load(db, origin().contentmanager._contentSchemas);
  var configs = await retrieve(db, 'lightcourseconfig', { _tenantId: tenantId });
  var defaults = configs[0] && configs[0].conversionDefaults || {};
  var plan = planner.build(draft, versions[0], catalog, defaults);
  var assets = new Map();
  var usedAssets = new Set();
  async function asset(source, pool) {
    var key = pool + ':' + source;
    if (assets.has(key)) return assets.get(key);
    var records = await retrieve(db, pool, { _id: source });
    var record = records[0];
    if (!record || record._tenantId && String(record._tenantId) !== String(tenantId) || record._isDeleted) {
      throw new Error('Referenced asset is unavailable in this tenant: ' + source);
    }
    var storage = await call(filestorage, 'getStorage', record.repository);
    var bytes = await call(storage, 'getFileContents', record.path);
    var entry = { key: key, pool: pool, record: record, checksum: require('crypto').createHash('sha256').update(bytes).digest('hex') };
    assets.set(key, entry);
    return entry;
  }
  async function resolve(source, pool, node, field) {
    try { var entry = await asset(source, pool); usedAssets.add(entry.key); } catch (error) {
      plan.errors.push({ node: node, path: field, message: error.message });
    }
  }
  for (var reference of plan.assets) {
    async function check(value) {
      if (typeof value !== 'string') throw new Error('Select a managed asset or a valid external URL.');
      var bankId = /^(?:\/?api\/content\/lightcourseasset\/)?([a-f0-9]{24})(?:\/serve)?$/i.exec(value);
      var fullId = /^\/?api\/asset\/serve\/([a-f0-9]{24})$/i.exec(value);
      var entry;
      if (bankId) entry = await asset(bankId[1], 'lightcourseasset');
      else if (fullId) entry = await asset(fullId[1], 'asset');
      else if (!/^https?:\/\/[^/\s]+(?:\/|$)/i.test(value)) throw new Error('Select a managed asset or a valid external URL.');
      if (entry && reference.assetType && !['file', 'media'].includes(reference.assetType) &&
          !(entry.record.mimeType || '').startsWith(reference.assetType + '/')) {
        throw new Error('This field needs an asset of type ' + reference.assetType + '.');
      }
      if (entry) usedAssets.add(entry.key);
    }
    try { await check(reference.source); } catch (error) {
      if (reference.required && reference.fallback && reference.fallback !== reference.source) {
        try {
          await check(reference.fallback);
          var record = plan.records.find(function(record) { return record.id === reference.node; });
          schema.set(record.data, reference.path, reference.fallback);
          plan.proposals.push({ node: reference.node, path: reference.path, previous: reference.source,
            value: reference.fallback, source: 'Conversion Defaults / installed schema', reason: error.message });
          continue;
        } catch (fallbackError) {
          error = new Error(error.message + ' The configured fallback is also invalid: ' + fallbackError.message);
        }
      }
      plan.errors.push({ node: reference.node, path: reference.path, message: error.message });
    }
  }
  async function inspect(value, node, field) {
    if (typeof value === 'string') {
      var matches = value.matchAll(/\/?api\/content\/lightcourseasset\/([a-f0-9]{24})\/(?:serve|thumb)/gi);
      for (var match of matches) await resolve(match[1], 'lightcourseasset', node, field);
      var fullMatches = value.matchAll(/\/?api\/asset\/serve\/([a-f0-9]{24})/gi);
      for (var match of fullMatches) await resolve(match[1], 'asset', node, field);
    } else if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) await inspect(value[i], node, field + '[' + i + ']');
    } else if (value && typeof value === 'object') {
      for (var key of Object.keys(value)) {
        if (key === '_assetId') await resolve(String(value[key]), 'asset', node, field + '.' + key);
        else if (key === '_graphicAssetId') await resolve(String(value[key]), 'lightcourseasset', node, field + '.' + key);
        else await inspect(value[key], node, field ? field + '.' + key : key);
      }
    }
  }
  for (var record of plan.records) await inspect(record.data, record.id, '');
  for (var key of assets.keys()) if (!usedAssets.has(key)) assets.delete(key);
  plan.assetState = Array.from(assets.values()).map(function(entry) {
    return { key: entry.key, checksum: entry.checksum, record: entry.record };
  });
  plan.hash = planner.signature(plan);
  return { plan: plan, assets: assets, locations: locations(versions[0].contentSnapshot) };
}

async function write(db, draft, prepared, user) {
  var app = origin(), plan = prepared.plan;
  var token = new mongoose.Types.ObjectId().toString(), ids = { course: new mongoose.Types.ObjectId().toString() };
  plan.records.forEach(function(record) {
    if (record.id !== 'course' && record.id !== 'config') ids[record.id] = new mongoose.Types.ObjectId().toString();
  });
  var Model = db.getModel('lightcourse');
  var reserved = await call(Model, 'findOneAndUpdate',
    { _id: draft._id, revision: plan.revision, conversionStatus: { $nin: ['converted', 'converting'] } },
    { $set: { conversionStatus: 'converting', conversionAttempt: { token: token, courseId: ids.course, idMap: ids } }, $inc: { revision: 1 } },
    { new: true });
  if (!reserved) throw failure(409, 'This Light Course changed or another conversion is running. Reload and review again.');
  var createdAssets = [], assetMap = new Map(), tempFiles = [];
  try {
    for (var entry of prepared.assets.values()) {
      if (entry.pool === 'asset') {
        assetMap.set(entry.key, entry.record);
        continue;
      }
      var original = entry.record;
      var sourceStorage = await call(filestorage, 'getStorage', original.repository);
      var buffer = await call(sourceStorage, 'getFileContents', original.path);
      if (require('crypto').createHash('sha256').update(buffer).digest('hex') !== entry.checksum) {
        throw failure(409, 'An asset changed after preflight. Review the conversion again.');
      }
      var tempFile = path.join(os.tmpdir(), 'light-conversion-' + token + '-' + String(original._id));
      tempFiles.push(tempFile);
      await fs.writeFile(tempFile, buffer, { flag: 'wx' });
      var repository = configuration.getConfig('filestorage') || 'localfs';
      var storage = await call(filestorage, 'getStorage', repository);
      var imported = await new Promise(function(resolve, reject) {
        app.assetmanager._createAssetFromFile(storage,
          { path: tempFile, name: original.filename, type: original.mimeType, size: buffer.length },
          { title: original.title || original.filename, description: original.description || '', tags: [] },
          user, repository, function(error, record, duplicate) {
            if (error) reject(error); else resolve({ record: record, duplicate: duplicate });
          });
      });
      if (!imported.duplicate) createdAssets.push(imported.record);
      assetMap.set(entry.key, imported.record);
    }
    var directPaths = new Set(plan.assets.map(function(reference) { return reference.node + ':' + reference.path; }));
    function rewrite(value, node, fieldPath) {
      if (typeof value === 'string') {
        var direct = /^(?:\/?api\/content\/lightcourseasset\/)?([a-f0-9]{24})(?:\/serve)?$/i.exec(value);
        var asset = direct && assetMap.get('lightcourseasset:' + direct[1]);
        if (asset && directPaths.has(node + ':' + fieldPath)) return 'course/assets/' + asset.filename;
        var full = /^\/?api\/asset\/serve\/([a-f0-9]{24})$/i.exec(value);
        var existing = full && assetMap.get('asset:' + full[1]);
        if (existing) return 'course/assets/' + existing.filename;
        return value.replace(/\/?api\/asset\/serve\/([a-f0-9]{24})/gi, function(match, id) {
          var asset = assetMap.get('asset:' + id);
          if (!asset) throw new Error('Unresolved asset: ' + id);
          return 'course/assets/' + asset.filename;
        }).replace(/\/?api\/content\/lightcourseasset\/([a-f0-9]{24})\/(?:serve|thumb)/gi, function(match, id) {
          var asset = assetMap.get('lightcourseasset:' + id);
          if (!asset) throw new Error('Unresolved placeholder asset: ' + id);
          return 'course/assets/' + asset.filename;
        });
      }
      if (Array.isArray(value)) return value.map(function(item, index) { return rewrite(item, node, fieldPath + '[' + index + ']'); });
      if (value && typeof value === 'object') {
        var out = {};
        Object.keys(value).forEach(function(key) {
          if (key !== '_assetId' && key !== '_graphicAssetId') out[key] = rewrite(value[key], node, fieldPath ? fieldPath + '.' + key : key);
        });
        ['_assetId', '_graphicAssetId'].forEach(function(key) {
          if (value[key]) {
            var asset = assetMap.get((key === '_assetId' ? 'asset:' : 'lightcourseasset:') + value[key]);
            if (!asset) throw new Error('Unresolved asset: ' + value[key]);
            if (key === '_assetId') out._link = 'course/assets/' + asset.filename;
            else out._graphic = { src: 'course/assets/' + asset.filename, alt: asset.title || '' };
          }
        });
        return out;
      }
      return value;
    }
    var written = [];
    for (var record of plan.records) {
      var data = rewrite(record.data, record.id, '');
      if (record.splashTarget) {
        if (!ids[record.splashTarget]) throw new Error('The Splash target page could not be mapped: ' + record.splashTarget);
        data._naviageTo = ids[record.splashTarget];
      }
      if (record.startTarget) {
        if (!ids[record.startTarget]) throw new Error('The Splash start page could not be mapped: ' + record.startTarget);
        data._start._startIds[0]._id = ids[record.startTarget];
      }
      if (record.helpTarget) {
        if (!ids[record.helpTarget]) throw new Error('The Help target page could not be mapped: ' + record.helpTarget);
        schema.set(data, record.helpTargetPath, ids[record.helpTarget]);
      }
      Object.keys(record.footerTargets || {}).forEach(function(button) {
        var target = record.footerTargets[button];
        if (!ids[target]) throw new Error('The Footer target page could not be mapped: ' + target);
        schema.set(data, '_extensions._footer.' + button + '._customLink', ids[target]);
      });
      (record.customFields || []).forEach(function(key) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) return;
        if (!data.properties) data.properties = {};
        data.properties[key] = data[key];
        delete data[key];
      });
      data._id = ids[record.id];
      data.createdBy = user._id;
      if (record.type !== 'config') data._lightCourseConversionId = token;
      if (record.type !== 'course') data._courseId = ids.course;
      if (record.parent) data._parentId = ids[record.parent];
      if (record.type === 'config') {
        var configs = await retrieve(db, 'config', { _courseId: ids.course });
        if (configs.length !== 1) throw new Error('Course creation did not produce exactly one config.');
        ids.config = String(configs[0]._id);
        delete data._id;
        await call(app.contentmanager, 'update', 'config', { _id: ids.config }, data);
      } else {
        await call(app.contentmanager, 'create', record.type, data);
      }
      written.push({ record: record, data: data });
    }
    for (var owner of written) {
      var ownerText = JSON.stringify(owner.data), linked = new Set();
      for (var entry of assetMap.values()) {
        if (linked.has(String(entry._id)) || !ownerText.includes('course/assets/' + entry.filename)) continue;
        linked.add(String(entry._id));
        await call(app.contentmanager, 'create', 'courseasset', {
          _courseId: ids.course, _contentType: owner.record.type, _contentTypeId: ids[owner.record.id],
          _contentTypeParentId: owner.record.parent ? ids[owner.record.parent] : ids.course,
          _assetId: String(entry._id), _fieldName: entry.filename, _lightCourseConversionId: token
        });
      }
    }
    for (var record of plan.records) {
      var records = await retrieve(db, record.type, { _id: ids[record.id] });
      if (records.length !== 1) throw new Error('Converted content could not be verified: ' + record.id);
      var persisted = new (db.getModel(record.type))(records[0]);
      var validationError = persisted.validateSync();
      if (validationError) throw validationError;
      var expected = written.find(function(owner) { return owner.record.id === record.id; }).data;
      var actual = JSON.parse(JSON.stringify(records[0]));
      function verify(expected, actual, field) {
        if (expected === undefined) return;
        if (Array.isArray(expected)) {
          if (!Array.isArray(actual) || expected.length !== actual.length) throw new Error('Converted array changed: ' + field);
          expected.forEach(function(value, index) { verify(value, actual[index], field + '[' + index + ']'); });
        } else if (expected !== null && typeof expected === 'object') {
          // Mongoose minimizes empty objects when saving.
          if (actual === undefined && emptyObject(expected)) return;
          if (!actual || typeof actual !== 'object' || Array.isArray(actual)) throw new Error('Converted object is missing: ' + field);
          Object.keys(expected).forEach(function(key) { verify(expected[key], actual[key], field + '.' + key); });
        } else if (expected !== actual) throw new Error('Converted value was not preserved: ' + field);
      }
      var serialized = JSON.parse(JSON.stringify(expected));
      Object.keys(serialized).filter(function(key) { return record.fields.includes(key); }).forEach(function(key) {
        verify(serialized[key], actual[key], record.id + '.' + key);
      });
    }
    await call(db, 'create', 'auditlog', {
      _id: token, _tenantId: user.tenant._id, action: 'update',
      contentType: 'lightcourse', contentId: draft._id, contentTitle: draft.title,
      courseId: ids.course, userId: user._id,
      userName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Administrator',
      userEmail: user.email || '', timestamp: new Date().toISOString(),
      changes: [{ field: 'conversionStatus', oldValue: 'none', newValue: 'converted', changeType: 'text' }],
      snapshot: { conversionAttempt: { token: token, courseId: ids.course, idMap: ids, versionId: plan.versionId } },
      metadata: { lightCourseId: String(draft._id), lightCourseVersion: plan.versionNumber }
    });
    var completed = await call(Model, 'findOneAndUpdate',
      { _id: draft._id, revision: draft.revision + 1, 'conversionAttempt.token': token, conversionStatus: 'converting' },
      { $set: { conversionStatus: 'converted', _convertedCourseId: ids.course,
        conversionAttempt: { token: token, courseId: ids.course, idMap: ids, versionId: plan.versionId, completedAt: new Date() } },
        $inc: { revision: 1 } }, { new: true });
    if (!completed) throw failure(409, 'Could not lock the converted Light Course.');
    return { courseId: ids.course, idMap: ids };
  } catch (error) {
    var cleanupErrors = [];
    try { await call(db, 'destroy', 'auditlog', { _id: token }); } catch (cleanupError) {
      cleanupErrors.push('audit: ' + cleanupError.message);
    }
    for (var type of ['courseasset', 'component', 'block', 'article', 'contentobject', 'config', 'course']) {
      try {
        await call(db, 'destroy', type, type === 'course' ? { _id: ids.course } : { _courseId: ids.course });
      } catch (cleanupError) { cleanupErrors.push(type + ': ' + cleanupError.message); }
    }
    for (var asset of createdAssets) {
      try {
        var joins = await retrieve(db, 'courseasset', { _assetId: String(asset._id) });
        var used = joins.length > 0;
        if (!used) {
          for (var type of ['course', 'config', 'contentobject', 'article', 'block', 'component', 'clipboard']) {
            var contents = await retrieve(db, type, {});
            if (contents.some(function(content) {
              var text = JSON.stringify(content);
              return [String(asset._id), asset.filename, asset.path].filter(Boolean).some(function(reference) {
                return text.includes(reference);
              });
            })) { used = true; break; }
          }
        }
        if (!used) await call(app.assetmanager, 'destroyAsset', asset._id);
      } catch (cleanupError) { cleanupErrors.push('asset: ' + cleanupError.message); }
    }
    if (!cleanupErrors.length) {
      try {
        var unlocked = await call(Model, 'findOneAndUpdate', { _id: draft._id, 'conversionAttempt.token': token, conversionStatus: 'converting' },
          { $set: { conversionStatus: 'none' }, $unset: { conversionAttempt: 1 }, $inc: { revision: 1 } }, { new: true });
        if (!unlocked) cleanupErrors.push('unlock: the conversion reservation changed');
      } catch (cleanupError) { cleanupErrors.push('unlock: ' + cleanupError.message); }
    }
    if (cleanupErrors.length) throw new Error(error.message + ' Cleanup requires administrator attention for attempt ' +
      token + ': ' + cleanupErrors.join('; '));
    throw error;
  } finally {
    for (var file of tempFiles) {
      try { await fs.remove(file); } catch (error) { logger.log('error', 'Failed to remove conversion upload: ' + error.message); }
    }
  }
}

function route(convert) {
  return function(req, res) {
    (async function() {
      var user = usermanager.getCurrentUser();
      if (!user || !user.tenant) throw failure(401, 'Please log in.');
      var allowed = await call(permissions, 'hasPermission', user._id, 'update',
        permissions.buildResourceString(user.tenant._id, '/*'));
      if (!allowed) throw failure(403, 'Only administrators can convert Light Courses.');
      var db = await new Promise(function(resolve, reject) {
        database.getDatabase(function(error, db) { if (error) reject(error); else resolve(db); }, user.tenant._id);
      });
      var drafts = await retrieve(db, 'lightcourse', { _id: req.params.id, _tenantId: user.tenant._id });
      if (!drafts.length) throw failure(404, 'Light Course not found.');
      var draft = drafts[0];
      if (draft.conversionStatus === 'converted') return res.status(200).json({ courseId: String(draft._convertedCourseId), converted: true });
      if (draft.conversionStatus === 'converting') throw failure(409, 'A conversion is already running. If interrupted, ask an administrator to inspect conversionAttempt before retrying.');
      var prepared = await prepare(db, draft, user.tenant._id);
      if (!convert) {
        var plan = prepared.plan;
        return res.status(200).json({ hash: plan.hash, versionNumber: plan.versionNumber,
          proposals: plan.proposals, errors: plan.errors, locations: prepared.locations, ready: !plan.errors.length });
      }
      if (prepared.plan.errors.length) throw failure(400, 'Resolve all preflight errors before converting.');
      if (!req.body || req.body.hash !== prepared.plan.hash || req.body.approved !== true) {
        throw failure(409, 'The conversion review is missing or out of date. Run preflight and approve it again.');
      }
      var result = await write(db, draft, prepared, user);
      res.status(200).json(result);
    })().catch(function(error) {
      if (!error.status || error.status >= 500) logger.log('error', 'Light Course conversion failed: ' + error.message);
      res.status(error.status || (error.name === 'ContentPermissionError' ? 403 : 500))
        .json({ success: false, message: error.message });
    });
  };
}
module.exports = { prepare: prepare, write: write, route: route };
