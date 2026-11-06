var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var EventEmitter = require('events');
var createRequire = require('module').createRequire;
var promisify = require('util').promisify;
var _ = require('underscore');

var ROOT = path.join(__dirname, '..');

function loadCommonJS(relativePath, mocks, globals) {
  var filename = path.join(ROOT, relativePath);
  var nativeRequire = createRequire(filename);
  var module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), Object.assign({
    module: module,
    exports: module.exports,
    require: function(name) {
      return Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : nativeRequire(name);
    },
    console: console,
    process: process,
    Buffer: Buffer
  }, globals), { filename: filename });
  return module.exports;
}

function loadAMD(relativePath, dependencies) {
  var exported;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), {
    define: function(factory) {
      exported = factory(function(name) { return dependencies[name]; });
    },
    _: _,
    Backbone: dependencies.backbone
  }, { filename: relativePath });
  return exported;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function matches(record, search) {
  return Object.keys(search).every(function(key) {
    if (search[key] === undefined) return true;
    if (search[key] && search[key].$ne !== undefined) return record[key] !== search[key].$ne;
    return record[key] === search[key];
  });
}

function createHarness() {
  var app = new EventEmitter();
  var records = {};
  var routes = {};
  var user = { _id: 'admin', email: 'admin@example.test', tenant: { _id: 'tenant' } };
  var db = {
    retrieve: function(type, search, options, next) {
      next(null, copy((records[type] || []).filter(function(record) { return matches(record, search); })));
    },
    create: function(type, data, next) {
      var record = Object.assign({ _id: type + '-' + (records[type] || []).length }, copy(data));
      records[type] = records[type] || [];
      records[type].push(record);
      next(null, copy(record));
    },
    update: function(type, search, delta, next) {
      var record = records[type].find(function(record) { return matches(record, search); });
      Object.assign(record, copy(delta));
      next(null, copy(record));
    },
    destroy: function(type, search, next) {
      records[type] = records[type].filter(function(record) { return !matches(record, search); });
      next(null);
    }
  };
  var database = { getDatabase: function(next) { next(null, db); } };
  var permissions = {
    ignoreRoute: function() {},
    buildResourceString: function(tenant, resource) { return resource; },
    hasPermission: function(id, action, resource, next) { next(null, true); },
    hasPermissions: function(id, actions, next) { next(null, true); }
  };
  var rest = {};
  ['get', 'post'].forEach(function(method) {
    rest[method] = function(route, handler) { routes[method + ' ' + route] = handler; };
  });
  var configuration = {
    getConfig: function() { return ''; },
    getMaxFileUploadSize: function() { return 1024; }
  };
  var usermanager = { getCurrentUser: function() { return user; } };
  app.usermanager = usermanager;
  var managerModule = loadCommonJS('lib/contentmanager.js', {
    './database': database,
    './configuration': configuration,
    './permissions': permissions,
    './logger': { log: function() {} },
    './rest': rest,
    './pluginmanager': {},
    './usermanager': usermanager,
    './helpers': {},
    '../': function() { return app; }
  }, { app: app });
  app.contentmanager = new managerModule.ContentManager();
  var mocks = {
    '../../../lib/contentmanager': managerModule,
    '../../../lib/database': database,
    '../../../lib/configuration': configuration,
    '../../../lib/permissions': permissions,
    '../../../lib/usermanager': usermanager,
    '../../../lib/logger': { log: function() {} },
    '../../../lib/rest': rest,
    '../../../': function() { return app; },
    formidable: {
      IncomingForm: function() {
        this.parse = function(req, next) {
          next(null, { title: 'Uploaded placeholder' }, { file: { name: 'test.png', path: 'fixture', size: 10 } });
        };
      }
    },
    fs: {
      createReadStream: function() {
        var stream = new EventEmitter();
        process.nextTick(function() {
          stream.emit('data', Buffer.from('image'));
          stream.emit('close');
        });
        return stream;
      }
    },
    '../../../lib/filestorage': {
      getStorage: function(repository, next) {
        next(null, {
          processFileUpload: function(file, filepath, options, done) { done(null, { path: filepath }); },
          deleteFile: function(filepath, done) { done(null); }
        });
      }
    }
  };
  ['auditlog', 'lightcomponentdefault', 'lightcoursetemplate', 'lightcourseconfig', 'lightcourseasset'].forEach(function(type) {
    var Plugin = loadCommonJS('plugins/content/' + type + '/index.js', mocks);
    app.contentmanager._contentTypes[type] = new Plugin();
  });
  app.emit('serverStarted');
  return {
    manager: app.contentmanager,
    permissions: permissions,
    records: records,
    routes: routes,
    create: promisify(app.contentmanager.create.bind(app.contentmanager)),
    update: promisify(app.contentmanager.update.bind(app.contentmanager)),
    destroy: promisify(app.contentmanager.destroy.bind(app.contentmanager))
  };
}

function callRoute(harness, name, req) {
  return new Promise(function(resolve, reject) {
    var response = {
      statusCode: 200,
      status: function(code) { this.statusCode = code; return this; },
      json: function(body) {
        if (this.statusCode !== 200) return reject(new Error(body.message));
        resolve(body);
      }
    };
    harness.routes[name](req, response);
  });
}

describe('light editor timestamps and item audit history (isolated)', function() {
  var harness;
  beforeEach(function() { harness = createHarness(); });

  it('replaces a submitted stale timestamp and audits the changed preset fields', async function() {
    var preset = await harness.create('lightcomponentdefault', {
      name: 'Preset', componentType: 'text', values: { body: 'Before' }, updatedAt: '2000-01-01T00:00:00.000Z'
    });
    var saved = await harness.update('lightcomponentdefault', { _id: preset._id }, {
      updatedAt: preset.updatedAt, values: { body: 'After' }
    });
    assert(new Date(saved.updatedAt).getTime() > new Date(preset.updatedAt).getTime());
    var log = harness.records.auditlog.find(function(log) { return log.action === 'update'; });
    assert.strictEqual(log.contentTitle, 'Preset');
    assert.deepStrictEqual(log.changes.map(function(change) { return change.field; }), ['values']);
    assert.deepStrictEqual(log.changes[0].oldValue, { body: 'Before' });
    assert.deepStrictEqual(log.changes[0].newValue, { body: 'After' });
  });

  ['create', 'update'].forEach(function(action) {
    it('audits both presets when switching the default via ' + action, async function() {
      var old = await harness.create('lightcomponentdefault', {
        name: 'Old default', componentType: 'text', isDefault: true, updatedAt: '2000-01-01T00:00:00.000Z'
      });
      var next;
      if (action === 'create') {
        next = await harness.create('lightcomponentdefault', { name: 'New default', componentType: 'text', isDefault: true });
      } else {
        next = await harness.create('lightcomponentdefault', { name: 'New default', componentType: 'text', isDefault: false });
        await harness.update('lightcomponentdefault', { _id: next._id }, { isDefault: true });
      }
      var oldSaved = harness.records.lightcomponentdefault.find(function(record) { return record._id === old._id; });
      assert.strictEqual(oldSaved.isDefault, false);
      assert(new Date(oldSaved.updatedAt) > new Date(old.updatedAt));
      assert.strictEqual(harness.records.lightcomponentdefault.filter(function(record) { return record.isDefault; }).length, 1);
      var log = harness.records.auditlog.find(function(log) { return log.contentId === old._id && log.action === 'update'; });
      assert.deepStrictEqual(log.changes[0], { field: 'isDefault', oldValue: true, newValue: false, changeType: 'boolean' });
      assert(harness.records.auditlog.some(function(log) { return log.contentId === next._id && log.action === action; }));
    });
  });

  it('does not clear defaults when the target preset does not exist', async function() {
    await harness.create('lightcomponentdefault', { name: 'Keep', componentType: 'text', isDefault: true });
    await assert.rejects(harness.update('lightcomponentdefault', { _id: 'missing' }, { componentType: 'text', isDefault: true }), /not found/);
    assert.strictEqual(harness.records.lightcomponentdefault[0].isDefault, true);
  });

  it('propagates errors clearing the old default instead of creating another', async function() {
    await harness.create('lightcomponentdefault', { name: 'Keep', componentType: 'text', isDefault: true });
    harness.manager.update = function(type, search, delta, next) { next(new Error('Write failed')); };
    await assert.rejects(harness.create('lightcomponentdefault', {
      name: 'New', componentType: 'text', isDefault: true
    }), /Write failed/);
    assert.strictEqual(harness.records.lightcomponentdefault.length, 1);
    assert.strictEqual(harness.records.lightcomponentdefault[0].isDefault, true);
  });

  [
    ['lightcourseconfig', { defaultPluginSelections: {} }, { defaultPluginSelections: { extensions: ['help'] } }],
    ['lightcoursetemplate', { name: 'Template', contentSnapshot: {} }, { name: 'Renamed template' }],
    ['lightcourseasset', { title: 'Asset' }, { title: 'Renamed asset' }]
  ].forEach(function(item) {
    it('advances same-day timestamps and audits metadata saves for ' + item[0], async function() {
      var oldTime = new Date(Date.now() - 60000).toISOString();
      var record = await harness.create(item[0], Object.assign({ updatedAt: oldTime }, item[1]));
      var saved = await harness.update(item[0], { _id: record._id }, Object.assign({ updatedAt: oldTime }, item[2]));
      assert(new Date(saved.updatedAt).getTime() - new Date(oldTime).getTime() >= 60000);
      var log = harness.records.auditlog.find(function(log) { return log.action === 'update'; });
      assert.strictEqual(log.contentId, record._id);
      assert.strictEqual(log.contentType, item[0]);
      assert.deepStrictEqual(log.changes.map(function(change) { return change.field; }), Object.keys(item[2]));
    });
  });

  it('does not log a timestamp-only save as a content change', async function() {
    var record = await harness.create('lightcomponentdefault', { name: 'Unchanged', componentType: 'text' });
    await harness.update('lightcomponentdefault', { _id: record._id }, { name: 'Unchanged' });
    assert.strictEqual(harness.records.auditlog.filter(function(log) { return log.action === 'update'; }).length, 0);
  });

  it('audits initial tenant config creation without creating duplicate records', async function() {
    harness.permissions.hasPermission = function(id, action, resource, next) {
      next(null, action === 'read');
    };
    var first = await callRoute(harness, 'get /lightcourseconfig/mine', {});
    var second = await callRoute(harness, 'get /lightcourseconfig/mine', {});
    assert.strictEqual(first._id, second._id);
    assert.deepStrictEqual(copy(first.iconDefaults), {});
    assert.strictEqual(harness.records.auditlog.filter(function(log) { return log.contentType === 'lightcourseconfig'; }).length, 1);
  });

  it('audits promotion from a version into a named course template', async function() {
    harness.records.lightcourseversion = [{ _id: 'version', versionNumber: 1, contentSnapshot: {} }];
    var template = await callRoute(harness, 'post /content/lightcoursetemplate/from-version/:versionId', {
      params: { versionId: 'version' }, body: { name: 'Promoted template' }
    });
    assert(harness.records.auditlog.some(function(log) {
      return log.contentId === template._id && log.contentTitle === 'Promoted template' && log.action === 'create';
    }));
  });

  it('audits placeholder asset uploads', async function() {
    var asset = await callRoute(harness, 'post /content/lightcourseasset/upload', {});
    assert(harness.records.auditlog.some(function(log) {
      return log.contentType === 'lightcourseasset' && log.contentId === asset._id && log.action === 'create';
    }));
  });

  it('retrieves only the selected item and tenant, including its deletion history', async function() {
    var first = await harness.create('lightcomponentdefault', { name: 'First', componentType: 'text' });
    await harness.create('lightcomponentdefault', { name: 'Second', componentType: 'text' });
    await harness.destroy('lightcomponentdefault', { _id: first._id });
    harness.records.auditlog.push({ contentType: 'lightcomponentdefault', contentId: first._id, _tenantId: 'other-tenant' });
    var logs = await callRoute(harness, 'get /auditlog/content/:contentType/:contentId', {
      params: { contentType: 'lightcomponentdefault', contentId: first._id }
    });
    assert.deepStrictEqual(logs.map(function(log) { return log.action; }), ['create', 'delete']);
  });
});

describe('light editor history controls (isolated)', function() {
  var Backbone = loadCommonJS('frontend/src/libraries/backbone.js', { underscore: _ });
  var modal;
  var origin = {
    l10n: { t: function(key) { return key; } },
    trigger: function(event, View, options) { modal = { event: event, View: View, options: options }; }
  };
  var View = { extend: function(proto) { return proto; } };
  var history = loadAMD('frontend/src/modules/lightCourseAdmin/itemHistory.js', {
    'core/origin': origin,
    '../auditLog/views/auditLogView': View
  });

  [
    ['lightCourseComponentDefaultEditorView', 'lightcomponentdefault'],
    ['lightCourseComponentDefaultListItemView', 'lightcomponentdefault'],
    ['lightCourseTemplateEditorView', 'lightcoursetemplate'],
    ['lightCourseTemplateListItemView', 'lightcoursetemplate'],
    ['lightCourseConfigView', 'lightcourseconfig'],
    ['lightCourseAssetListItemView', 'lightcourseasset']
  ].forEach(function(surface) {
    it('wires item-specific history for ' + surface[0], function() {
      var view = loadAMD('frontend/src/modules/lightCourseAdmin/views/' + surface[0] + '.js', {
        'core/origin': origin, 'core/views/originView': View, '../itemHistory': history
      });
      var prevented = false;
      view.events['click .light-course-item-history'].call({
        model: new Backbone.Model({ _id: 'selected-item', name: 'Selected item' })
      }, { preventDefault: function() { prevented = true; } });
      assert(prevented);
      assert.strictEqual(modal.event, 'modal:open');
      assert.strictEqual(modal.options.contentType, surface[1]);
      assert.strictEqual(modal.options.contentId, 'selected-item');
      assert.strictEqual(modal.options._shouldShowDoneButton, false);
      assert.deepStrictEqual(copy(modal.View.getData()), {});
      var templateName = surface[0].replace('View', '');
      var template = fs.readFileSync(path.join(ROOT, 'frontend/src/modules/lightCourseAdmin/templates/' + templateName + '.hbs'), 'utf8');
      assert(template.includes('light-course-item-history'));
    });
  });

  it('retains template timestamps for display but removes identity and timestamps when cloning', function() {
    var Model = loadAMD('frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js', { backbone: Backbone });
    var model = new Model({
      _id: 'original', name: 'Template', createdAt: '2000-01-01', updatedAt: '2026-01-01', contentSnapshot: {}
    }, { parse: true });
    assert.strictEqual(model.toJSON().updatedAt, '2026-01-01');
    var cloned;
    function CloneModel() {}
    CloneModel.prototype.save = function(data) { cloned = data; };
    var view = loadAMD('frontend/src/modules/lightCourseAdmin/views/lightCourseTemplateListItemView.js', {
      'core/origin': origin, 'core/views/originView': View, '../itemHistory': history,
      '../models/lightCourseTemplateModel': CloneModel
    });
    view.onCloneClicked.call({ model: model });
    assert(!Object.prototype.hasOwnProperty.call(cloned, '_id'));
    assert(!Object.prototype.hasOwnProperty.call(cloned, 'createdAt'));
    assert(!Object.prototype.hasOwnProperty.call(cloned, 'updatedAt'));
    assert.deepStrictEqual(copy(cloned.contentSnapshot), copy(model.toJSON().contentSnapshot));
  });
});
