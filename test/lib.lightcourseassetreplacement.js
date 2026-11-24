var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var EventEmitter = require('events');
var createRequire = require('module').createRequire;
var usage = require('../lib/lightcourse/assetUsage');
var ID = '1234567890abcdef12345678';
var ROOT = path.join(__dirname, '..');

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function load(file, mocks, globals) {
  var filename = path.join(ROOT, file), module = { exports: {} }, nativeRequire = createRequire(filename);
  function resolve(name) { return Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : nativeRequire(name); }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), Object.assign({
    module: module, exports: module.exports, require: resolve,
    define: function(factory) { module.exports = factory(resolve); }
  }, globals), { filename: filename });
  return module.exports;
}

function harness() {
  var h = { user: { _id: 'admin', tenant: { _id: 'tenant' } }, allowed: true, deletes: [], uploads: [],
    temporary: [], logs: [], updates: 0, parses: 0, limit: 100, file: { path: '/tmp/test-upload', name: 'new.png', type: 'image/png', size: 20 } };
  h.records = {
    lightcourseasset: [{ _id: ID, _tenantId: 'tenant', title: 'Original', description: 'Keep', assetType: 'image',
      path: 'old/shared.png', thumbnailPath: 'old/shared-thumb.png', filename: 'original.png', repository: 'localfs' }],
    lightcourse: [{ _id: 'course', _tenantId: 'tenant', contentTree: { src: ID,
      body: '<img src="api/content/lightcourseasset/' + ID + '/serve">' } }],
    lightcoursetemplate: [{ _id: 'template', _tenantId: 'tenant', contentSnapshot: { contentTree: { src: ID } } }],
    lightcomponentdefault: [{ _id: 'preset', _tenantId: 'tenant', values: { src: ID } }],
    lightcourseconfig: [{ _id: 'config', _tenantId: 'tenant', conversionDefaults: { 'component:graphic': { src: ID } } }]
  };
  function matches(record, query) {
    return Object.keys(query).every(function(key) {
      if (key === '$or') return query[key].some(function(part) { return matches(record, part); });
      return String(record[key]) === String(query[key]);
    });
  }
  var db = { retrieve: function(type, query, options, next) {
    if (h.cleanupError) return next(new Error('Cleanup lookup failed'));
    next(null, copy((h.records[type] || []).filter(function(record) { return matches(record, query); })));
  } };
  h.db = db;
  function ContentPlugin() {}
  ContentPlugin.prototype.retrieve = function(query, options, next) {
    next(h.retrieveError, copy(h.records.lightcourseasset.filter(function(record) { return matches(record, query); })));
  };
  ContentPlugin.prototype.update = function(query, data, next) {
    h.updates++;
    if (h.updateError) return next(h.updateError);
    Object.assign(h.records.lightcourseasset.find(function(record) { return matches(record, query); }), data);
    next(null, {});
  };
  function IncomingForm() { this.on = function(event, callback) { this.fileEvent = callback; }; }
  IncomingForm.prototype.parse = function(req, next) {
    h.parses++;
    if (h.file && this.fileEvent) this.fileEvent('file', h.file);
    this.bytesExpected = h.expected || 20;
    next(h.parseError, h.fields || {}, h.file ? { file: h.file } : {});
  };
  var storage = {
    processFileUpload: function(file, destination, options, next) {
      h.uploads.push({ file: file, destination: destination, options: options });
      next(h.uploadError, { path: destination, size: file.size, mimeType: file.type,
        thumbnailPath: h.noThumbnail ? false : destination + '-thumb.png' });
    },
    deleteFile: function(file, next) { h.deletes.push(file); next(h.deleteError); }
  };
  var app = new EventEmitter(), routes = {};
  app.contentmanager = { create: function(type, data, next) {
    next(null, { _id: ID, filename: data.filename });
  }, update: function(type, query, delta, next) {
    assert.strictEqual(type, 'lightcourseasset');
    ContentPlugin.prototype.update(query, delta, next);
  } };
  app.polyglot = { t: function(key) { return key; } };
  load('plugins/content/lightcourseasset/index.js', {
    '../../../lib/contentmanager': { ContentPlugin: ContentPlugin },
    '../../../lib/database': { getDatabase: function(next, tenant) { assert.strictEqual(tenant, 'tenant'); next(null, db); } },
    '../../../lib/permissions': {
      buildResourceString: function(tenant, resource) { return tenant + resource; },
      hasPermission: function(user, action, resource, next) {
        assert.strictEqual(action, 'update');
        assert(resource.endsWith('/' + ID));
        next(h.permissionError, h.allowed);
      }
    },
    '../../../lib/usermanager': { getCurrentUser: function() { return h.user; } },
    '../../../lib/configuration': { getMaxFileUploadSize: function() { return h.limit; }, getConfig: function() { return 'localfs'; } },
    '../../../lib/filestorage': { getStorage: function(repository, next) { next(h.storageError, storage); } },
    '../../../lib/logger': { log: function() { h.logs.push(Array.from(arguments)); } },
    '../../../lib/rest': { post: function(route, handler) { routes[route] = handler; }, get: function() {} },
    '../../../': function() { return app; },
    formidable: { IncomingForm: IncomingForm },
    fs: { createReadStream: function() {
      var stream = new EventEmitter();
      process.nextTick(function() { stream.emit('data', Buffer.from('file')); stream.emit('close'); });
      return stream;
    } },
    'fs-extra': { remove: async function(file) { h.temporary.push(file); } }
  });
  app.emit('serverStarted');
  h.request = function() {
    return new Promise(function(resolve, reject) {
      var res = { code: 200, status: function(code) { this.code = code; return this; },
        json: function(body) { resolve({ status: this.code, body: body }); } };
      routes['/content/lightcourseasset/:id/replace']({ params: { id: ID } }, res, reject);
    });
  };
  h.upload = function() {
    return new Promise(function(resolve, reject) {
      var res = { code: 200, status: function(code) { this.code = code; return this; },
        json: function(body) { resolve({ status: this.code, body: body }); } };
      routes['/content/lightcourseasset/upload']({}, res, reject);
    });
  };
  return h;
}

describe('Light Course placeholder asset replacement', function() {
  it('applies the 500 KB image limit to new uploads and keeps other configured limits', async function() {
    var h = harness();
    h.limit = 1024 * 1024;
    h.file.size = 500 * 1024;
    assert.strictEqual((await h.upload()).status, 200);
    h = harness();
    h.limit = 1024 * 1024;
    h.file.size = 500 * 1024 + 1;
    assert.strictEqual((await h.upload()).status, 400);
    assert.strictEqual(h.uploads.length, 0);
    h = harness();
    h.limit = 1024 * 1024;
    h.file.type = 'application/octet-stream';
    h.file.size = 500 * 1024 + 1;
    assert.strictEqual((await h.upload()).status, 400);
    h = harness();
    h.limit = 1024 * 1024;
    h.file.type = 'audio/mpeg';
    h.file.size = 500 * 1024 + 1;
    h.fields = { assetType: 'audio' };
    assert.strictEqual((await h.upload()).status, 200);
  });
  it('updates the same record, preserves metadata and all content links/uses, and removes only old files', async function() {
    var h = harness(), before = await usage.collect(h.db, 'tenant');
    var source = JSON.stringify([h.records.lightcourse, h.records.lightcoursetemplate, h.records.lightcomponentdefault, h.records.lightcourseconfig]);
    var response = await h.request(), asset = h.records.lightcourseasset[0];
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body._id, ID);
    assert.strictEqual(asset._id, ID);
    assert.strictEqual(asset.title, 'Original');
    assert.strictEqual(asset.description, 'Keep');
    assert.strictEqual(asset.assetType, 'image');
    assert(asset.path.startsWith('lightcourseassets/replacements/' + ID + '/'));
    assert.strictEqual(h.uploads[0].options.createThumbnail, true);
    assert.deepStrictEqual(h.deletes, ['old/shared.png', 'old/shared-thumb.png']);
    assert.deepStrictEqual(h.temporary, ['/tmp/test-upload']);
    assert.strictEqual(JSON.stringify([h.records.lightcourse, h.records.lightcoursetemplate, h.records.lightcomponentdefault, h.records.lightcourseconfig]), source);
    assert.deepStrictEqual(await usage.collect(h.db, 'tenant'), before);
  });
  it('retains shared old files belonging to another placeholder', async function() {
    var h = harness();
    h.records.lightcourseasset.push(Object.assign({}, h.records.lightcourseasset[0], { _id: 'other' }));
    assert.strictEqual((await h.request()).status, 200);
    assert.deepStrictEqual(h.deletes, []);
  });
  it('uses a fresh destination for repeated replacements and deletes the previous replacement only after commit', async function() {
    var h = harness();
    assert.strictEqual((await h.request()).status, 200);
    var previous = copy(h.records.lightcourseasset[0]);
    h.deletes = [];
    assert.strictEqual((await h.request()).status, 200);
    assert.notStrictEqual(h.records.lightcourseasset[0].path, previous.path);
    assert.deepStrictEqual(h.deletes, [previous.path, previous.thumbnailPath]);
    assert.strictEqual(h.records.lightcourseasset[0]._id, ID);
  });
  it('replaces video/audio without generating an image thumbnail or retaining a stale thumbnail', async function() {
    for (var type of ['video', 'audio']) {
      var h = harness();
      h.records.lightcourseasset[0].assetType = type;
      h.file.type = type + '/mpeg';
      h.file.name = 'new.' + (type === 'video' ? 'mp4' : 'mp3');
      h.noThumbnail = true;
      h.fields = { title: 'Renamed', description: '' };
      assert.strictEqual((await h.request()).status, 200);
      assert.strictEqual(h.uploads[0].options.createThumbnail, false);
      assert.strictEqual(h.records.lightcourseasset[0].thumbnailPath, '');
      assert.strictEqual(h.records.lightcourseasset[0].title, 'Renamed');
      assert.strictEqual(h.records.lightcourseasset[0].description, '');
    }
  });
  it('limits replacement images to 500 KB while retaining configured limits for other media', async function() {
    var h = harness();
    h.limit = 1024 * 1024;
    h.file.size = 500 * 1024;
    assert.strictEqual((await h.request()).status, 200);
    h = harness();
    h.limit = 1024 * 1024;
    h.file.size = 500 * 1024 + 1;
    assert.strictEqual((await h.request()).status, 400);
    assert.strictEqual(h.uploads.length, 0);
    h = harness();
    h.limit = 1024 * 1024;
    h.records.lightcourseasset[0].assetType = 'audio';
    h.file.type = 'audio/mpeg';
    h.file.size = 500 * 1024 + 1;
    assert.strictEqual((await h.request()).status, 200);
  });
  it('requires authentication, update permission and a same-tenant existing record before parsing uploads', async function() {
    var h = harness(); h.user = null;
    assert.strictEqual((await h.request()).status, 401);
    assert.strictEqual(h.parses, 0);
    h = harness(); h.allowed = false;
    assert.strictEqual((await h.request()).status, 403);
    assert.strictEqual(h.parses, 0);
    h = harness(); h.records.lightcourseasset[0]._tenantId = 'other';
    assert.strictEqual((await h.request()).status, 404);
    assert.strictEqual(h.parses, 0);
    h = harness(); h.permissionError = new Error('Permission lookup failed');
    await assert.rejects(h.request(), /Permission lookup failed/);
  });
  it('rejects missing/wrong-type/oversized or unparseable files without modifying the record', async function() {
    for (var change of [
      function(h) { h.file = null; }, function(h) { h.file.type = 'video/mp4'; },
      function(h) { h.file.size = 101; }, function(h) { h.parseError = new Error('Bad multipart'); }
    ]) {
      var h = harness(), before = copy(h.records.lightcourseasset);
      change(h);
      assert.strictEqual((await h.request()).status, 400);
      assert.deepStrictEqual(h.records.lightcourseasset, before);
      assert.strictEqual(h.uploads.length, 0);
      assert.strictEqual(h.updates, 0);
    }
  });
  it('keeps the previous file usable when storage or metadata updates fail, cleaning up new uploads', async function() {
    for (var failure of ['storageError', 'uploadError', 'updateError']) {
      var h = harness(), before = copy(h.records.lightcourseasset);
      h[failure] = new Error('Failed operation');
      assert.strictEqual((await h.request()).status, 500);
      assert.deepStrictEqual(h.records.lightcourseasset, before);
      assert(!h.deletes.includes('old/shared.png'));
      assert(!h.deletes.includes('old/shared-thumb.png'));
      assert.deepStrictEqual(h.temporary, ['/tmp/test-upload']);
      if (failure === 'updateError') assert.strictEqual(h.deletes.length, 2);
      assert(h.logs.length);
    }
  });
  it('logs cleanup errors explicitly without undoing an already committed replacement', async function() {
    var h = harness();
    h.cleanupError = true;
    assert.strictEqual((await h.request()).status, 200);
    assert(h.records.lightcourseasset[0].path.startsWith('lightcourseassets/replacements/'));
    assert.strictEqual(h.logs.length, 1);
    assert.deepStrictEqual(h.deletes, []);
  });
  it('logs missing old files without blocking replacement of a broken asset', async function() {
    var h = harness();
    h.deleteError = new Error('Old file missing');
    assert.strictEqual((await h.request()).status, 200);
    assert.strictEqual(h.logs.length, 2);
    assert(h.records.lightcourseasset[0].path.startsWith('lightcourseassets/replacements/'));
  });
});

describe('Light Course placeholder replacement UI', function() {
  it('uses the replacement filename to request a fresh list preview for the same asset ID', function() {
    var handlebars = require('handlebars').create();
    handlebars.registerHelper('t', function(key) { return key; });
    handlebars.registerHelper('momentFormat', function() { return ''; });
    var render = handlebars.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseAdmin/templates/lightCourseAssetListItem.hbs'), 'utf8'));
    var before = render({ _id: ID, filename: 'old.png' });
    var after = render({ _id: ID, filename: 'new.png' });
    assert(before.includes('src="api/content/lightcourseasset/' + ID + '/thumb?v=old.png"'));
    assert(after.includes('src="api/content/lightcourseasset/' + ID + '/thumb?v=new.png"'));
  });
  it('includes a replacement file only when selected, preserving metadata-only edits', function() {
    var proto = load('frontend/src/modules/lightCourseAdmin/views/lightCourseAssetEditView.js', {
      'core/views/originView': { extend: function(proto) { return proto; } }
    });
    var file = { name: 'new.mp4' }, input = { files: [] };
    var view = Object.assign({}, proto, { $: function(selector) {
      if (selector.endsWith('-file')) return [input];
      return { val: function() { return selector.endsWith('-title') ? ' Title ' : 'Description'; } };
    } });
    assert.deepStrictEqual(copy(view.getData()), { title: 'Title', description: 'Description' });
    input.files = [file];
    assert.strictEqual(view.getData().replacementFile, file);
  });
  it('uploads replacement files to the existing ID and refreshes the same model', function() {
    var update, request, refreshed = false, alert;
    var model = {
      id: ID, save: function() { assert.fail('Replacement must not create/patch file data as JSON'); },
      fetch: function(options) { refreshed = true; options.success(); }
    };
    function FormData() { this.values = {}; }
    FormData.prototype.append = function(key, value) { this.values[key] = value; };
    var proto = load('frontend/src/modules/lightCourseAdmin/views/lightCourseAssetListItemView.js', {
      'core/origin': {
        l10n: { t: function(key) { return key; } },
        trigger: function(event, View, options) { update = options.onUpdate; },
        Notify: { alert: function(value) { alert = value; } }
      },
      'core/views/originView': { extend: function(proto) { return proto; } },
      '../itemHistory': function() {},
      './lightCourseAssetEditView': {}
    }, { FormData: FormData, $: { ajax: function(options) {
      request = options;
      return { done: function(callback) { callback(); return this; }, fail: function() { return this; } };
    } } });
    proto.onEditClicked.call({ model: model });
    var file = { name: 'new.png' };
    update({ title: 'New', description: '', replacementFile: file });
    assert.strictEqual(request.url, 'api/content/lightcourseasset/' + ID + '/replace');
    assert.strictEqual(request.data.values.file, file);
    assert.strictEqual(request.processData, false);
    assert.strictEqual(request.contentType, false);
    assert.strictEqual(refreshed, true);
    assert.strictEqual(alert.type, 'success');
  });
  it('still saves metadata without a file and surfaces replacement failures', function() {
    var update, saved, failure, alert;
    var proto = load('frontend/src/modules/lightCourseAdmin/views/lightCourseAssetListItemView.js', {
      'core/origin': {
        l10n: { t: function(key) { return key; } },
        trigger: function(event, View, options) { update = options.onUpdate; },
        Notify: { alert: function(value) { alert = value; } }
      },
      'core/views/originView': { extend: function(proto) { return proto; } },
      '../itemHistory': function() {}, './lightCourseAssetEditView': {}
    }, { FormData: function() { this.append = function() {}; }, $: { ajax: function() {
      return { done: function() { return this; }, fail: function(callback) { failure = callback; return this; } };
    } } });
    proto.onEditClicked.call({ model: { id: ID, save: function(data, options) { saved = { data: data, options: options }; } } });
    update({ title: 'Title', description: '' });
    assert.strictEqual(saved.data.title, 'Title');
    assert.strictEqual(saved.options.patch, true);
    assert.strictEqual(saved.options.wait, true);
    update({ title: 'Title', description: '', replacementFile: {} });
    failure({ responseJSON: { message: 'Video file required' } });
    assert.strictEqual(alert.type, 'error');
    assert.strictEqual(alert.text, 'Video file required');
  });
});
