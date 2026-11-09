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
    '../../../lib/lightcoursewordcount': { computeWordCount: function(snapshot, database, next) {
      next(null, { total: 0, screens: 0 });
    } },
    '../../../lib/lightcourse/versionDiff': {},
    '../../../lib/lightcourse/iconClasses': {},
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
  ['auditlog', 'lightcomponentdefault', 'lightcoursetemplate', 'lightcourseconfig', 'lightcourseasset', 'lightcourse'].forEach(function(type) {
    var Plugin = loadCommonJS('plugins/content/' + type + '/index.js', mocks);
    app.contentmanager._contentTypes[type] = new Plugin();
  });
  app.emit('serverStarted');
  return {
    manager: app.contentmanager,
    ContentPlugin: managerModule.ContentPlugin,
    db: db,
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

  it('stamps course creation and editing with the active audit version', async function() {
    var course = await harness.create('lightcourse', {
      title: 'Course', currentVersionNumber: '1.2', revision: 0,
      contentTree: { children: [] }, pluginSelections: {}
    });
    harness.db.getModel = function() { return { populate: function(record) { return Promise.resolve(record); }, findOneAndUpdate: function(search, delta, options, next) {
      harness.db.update('lightcourse', search, Object.assign({}, delta.$set, { revision: course.revision + delta.$inc.revision }), next);
    } }; };
    await harness.update('lightcourse', { _id: course._id }, { title: 'Edited course', revision: course.revision });
    var logs = harness.records.auditlog.filter(function(log) { return log.contentType === 'lightcourse'; });
    assert.strictEqual(logs.length, 2);
    logs.forEach(function(log) {
      assert.strictEqual(log.metadata.lightCourseId, course._id);
      assert.strictEqual(log.metadata.lightCourseVersion, '1.2');
    });
  });

  it('ignores tag ordering and populated-versus-reference changes in course audits', async function() {
    var tags = [{ _id: 'first', title: 'First tag' }, { _id: 'second', title: 'Second tag' }];
    var course = await harness.create('lightcourse', { title: 'Course', tags: tags, revision: 0 });
    var revision = course.revision;
    harness.db.getModel = function() { return {
      populate: function(record) { return Promise.resolve(record); },
      findOneAndUpdate: function(search, delta, options, next) {
        revision += delta.$inc.revision;
        harness.db.update('lightcourse', search, Object.assign({}, delta.$set, { revision: revision }), next);
      }
    }; };
    for (var selection of [['second', 'first'], tags]) {
      await harness.update('lightcourse', { _id: course._id }, { tags: selection, revision: revision });
    }
    var changes = harness.records.auditlog.filter(function(log) { return log.action === 'update'; })
      .reduce(function(all, log) { return all.concat(log.changes); }, []);
    assert(!changes.some(function(change) { return change.field === 'tags'; }));
  });

  it('stores tag references and audits genuine changes with populated tag titles', async function() {
    var tags = [{ _id: 'first', title: 'First tag' }, { _id: 'second', title: 'Second tag' },
      { _id: 'third', title: 'Third tag' }];
    var course = await harness.create('lightcourse', { title: 'Course', tags: tags.slice(0, 2), revision: 0 });
    harness.db.getModel = function() { return {
      populate: function(record, options) {
        assert.strictEqual(options.path, 'tags');
        assert.strictEqual(options.select, '_id title');
        return Promise.resolve(Object.assign({}, record, {
          tags: record.tags.map(function(id) { return tags.find(function(tag) { return tag._id === id; }); })
        }));
      },
      findOneAndUpdate: function(search, delta, options, next) {
        harness.db.update('lightcourse', search, Object.assign({}, delta.$set, {
          revision: course.revision + delta.$inc.revision
        }), next);
      }
    }; };
    await harness.update('lightcourse', { _id: course._id }, { tags: ['first', 'third'], revision: course.revision });
    assert.deepStrictEqual(harness.records.lightcourse[0].tags, ['first', 'third']);
    var log = harness.records.auditlog.find(function(record) { return record.action === 'update'; });
    var change = log.changes.find(function(record) { return record.field === 'tags'; });
    assert.deepStrictEqual(change.oldValue, tags.slice(0, 2));
    assert.deepStrictEqual(change.newValue, [tags[0], tags[2]]);
  });

  it('records course title and body in manually published version snapshots', async function() {
    var course = await harness.create('lightcourse', {
      title: 'Recorded title', body: '<p>Recorded body</p>', revision: 0,
      tags: [{ _id: 'core-tag', title: 'Shared core tag' }],
      contentTree: { children: [] }, pluginSelections: {}
    });
    harness.db.getModel = function() { return { findOneAndUpdate: function(search, delta, options, next) {
      harness.db.update('lightcourse', search, Object.assign({}, delta.$set, { revision: course.revision + delta.$inc.revision }), next);
    } }; };
    var versionPlugin = new harness.ContentPlugin();
    versionPlugin.getModelName = function() { return 'lightcourseversion'; };
    versionPlugin.hasPermission = function(action, userId, tenantId, item, next) { next(null, true); };
    harness.manager._contentTypes.lightcourseversion = versionPlugin;
    var version = await callRoute(harness, 'post /content/lightcourse/:id/versions', {
      params: { id: course._id }, body: { revision: course.revision, bump: 'minor' }
    });
    assert.strictEqual(version.contentSnapshot.title, course.title);
    assert.strictEqual(version.contentSnapshot.body, course.body);
    assert.deepStrictEqual(version.contentSnapshot.tags, course.tags);
    var log = harness.records.auditlog.find(function(log) { return log.contentType === 'lightcourseversion'; });
    assert.strictEqual(log.metadata.lightCourseVersion, '0.1');
    assert.strictEqual(log.metadata.lightCourseId, course._id);
  });

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

describe('new template starting settings (isolated)', function() {
  var harness;
  var config;
  var selections = { menu: 'tileMenu', theme: 'aleido', extensions: ['help', 'menuButton'] };
  var icons = { menuButton: 'menu', help: 'question' };
  var Backbone = loadCommonJS('frontend/src/libraries/backbone.js', { underscore: _ });
  var Model = loadAMD('frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js', { backbone: Backbone });

  beforeEach(async function() {
    harness = createHarness();
    config = await harness.create('lightcourseconfig', {
      defaultPluginSelections: selections, iconDefaults: icons
    });
  });

  it('copies the current tenant settings once and audits the seeded snapshot', async function() {
    harness.records.lightcourseconfig.unshift({
      _id: 'other-config', _tenantId: 'other-tenant',
      defaultPluginSelections: { menu: 'other-menu' }, iconDefaults: { help: 'info' }
    });
    var template = await harness.create('lightcoursetemplate', { name: 'New template' });
    assert.deepStrictEqual(template.contentSnapshot.pluginSelections, selections);
    assert.deepStrictEqual(template.contentSnapshot.headerData.iconChoices, icons);
    var log = harness.records.auditlog.find(function(log) { return log.contentId === template._id; });
    assert.deepStrictEqual(log.snapshot.contentSnapshot, template.contentSnapshot);
    await harness.update('lightcourseconfig', { _id: config._id }, {
      defaultPluginSelections: { menu: 'changed-menu' }, iconDefaults: { help: 'info' }
    });
    assert.deepStrictEqual(harness.records.lightcoursetemplate[0].contentSnapshot, template.contentSnapshot);
    template.contentSnapshot.pluginSelections.extensions.push('edited');
    assert.deepStrictEqual(harness.records.lightcourseconfig.find(function(item) { return item._id === config._id; }).defaultPluginSelections, { menu: 'changed-menu' });
  });

  it('preserves explicitly empty configured selections', async function() {
    await harness.update('lightcourseconfig', { _id: config._id }, {
      defaultPluginSelections: { menu: '', theme: '', extensions: [] }, iconDefaults: {}
    });
    var template = await harness.create('lightcoursetemplate', { name: 'No plugins' });
    assert.deepStrictEqual(template.contentSnapshot.pluginSelections, { menu: '', theme: '', extensions: [] });
    assert.deepStrictEqual(template.contentSnapshot.headerData.iconChoices, {});
  });

  it('starts with empty settings when the tenant has no config record', async function() {
    harness.records.lightcourseconfig = [];
    var template = await harness.create('lightcoursetemplate', { name: 'No settings yet' });
    assert.deepStrictEqual(template.contentSnapshot, { pluginSelections: {}, headerData: { iconChoices: {} } });
    assert.strictEqual(harness.records.lightcourseconfig.length, 0);
  });

  [{}, { pluginSelections: { menu: '', theme: '', extensions: [] }, headerData: { iconChoices: {} } }].forEach(function(snapshot) {
    it('does not seed an explicitly supplied snapshot: ' + JSON.stringify(snapshot), async function() {
      var template = await harness.create('lightcoursetemplate', { name: 'Explicit template', contentSnapshot: copy(snapshot) });
      assert.deepStrictEqual(template.contentSnapshot, snapshot);
    });
  });

  it('preserves copied icons and plugin selections across editor save, clone, and new course creation', async function() {
    var template = await harness.create('lightcoursetemplate', { name: 'Starting template' });
    var model = new Model(template, { parse: true });
    assert.deepStrictEqual(copy(model.get('headerData').iconChoices), icons);
    model.set({ name: 'Edited template', contentTree: { children: [] } });
    await harness.update('lightcoursetemplate', { _id: template._id }, copy(model.toJSON()));
    await harness.update('lightcourseconfig', { _id: config._id }, {
      defaultPluginSelections: { extensions: ['reflection'] }, iconDefaults: { help: 'info' }
    });
    var clone = await harness.create('lightcoursetemplate', Object.assign(
      {}, copy(_.omit(model.toJSON(), '_id', 'createdAt', 'updatedAt')), { name: 'Clone' }
    ));
    assert.deepStrictEqual(clone.contentSnapshot.pluginSelections, selections);
    assert.deepStrictEqual(clone.contentSnapshot.headerData.iconChoices, icons);
    var course = await harness.create('lightcourse', { title: 'From template', _templateId: clone._id });
    assert.deepStrictEqual(course.pluginSelections, selections);
    assert.deepStrictEqual(course.headerData.iconChoices, icons);
  });

  it('uses the copied settings when creating a course directly from a new blank template', async function() {
    var template = await harness.create('lightcoursetemplate', { name: 'Blank template' });
    var course = await harness.create('lightcourse', { title: 'New course', _templateId: template._id });
    assert.deepStrictEqual(course.pluginSelections, selections);
    assert.deepStrictEqual(course.headerData.iconChoices, icons);
  });

  it('does not seed templates promoted from a version with current settings', async function() {
    var sourceSnapshot = { pluginSelections: { menu: 'source-menu', extensions: [] } };
    harness.records.lightcourseversion = [{ _id: 'version', versionNumber: 1, contentSnapshot: sourceSnapshot }];
    var template = await callRoute(harness, 'post /content/lightcoursetemplate/from-version/:versionId', {
      params: { versionId: 'version' }, body: { name: 'Promoted template' }
    });
    assert.deepStrictEqual(template.contentSnapshot.pluginSelections, sourceSnapshot.pluginSelections);
    assert.strictEqual(template.contentSnapshot.headerData, undefined);
  });

  it('reports settings read failures instead of silently creating an unseeded template', async function() {
    harness.db.retrieve = function(type, search, options, next) { next(new Error('Settings read failed')); };
    await assert.rejects(harness.create('lightcoursetemplate', { name: 'Should not be saved' }), /Settings read failed/);
    assert.strictEqual(harness.records.lightcoursetemplate, undefined);
  });

  it('sends only name and description from the blank-template create modal', function() {
    var modalOptions;
    var origin = {
      trigger: function(event, View, options) { modalOptions = options; },
      l10n: { t: function(key) { return key; } }
    };
    var view = loadAMD('frontend/src/modules/lightCourseAdmin/views/lightCourseTemplateListView.js', {
      './lightCourseAdminListView': { extend: function(proto) { return proto; }, prototype: { events: {} } },
      'core/origin': origin,
      'core/views/originView': { extend: function(proto) { return proto; } },
      '../models/lightCourseTemplateModel': Model
    });
    var request;
    var originalAjax = Backbone.ajax;
    Backbone.ajax = function(options) { request = options; return {}; };
    try {
      view.onCreateClicked();
      modalOptions.onUpdate({ name: 'New template', description: 'Description' });
    } finally {
      Backbone.ajax = originalAjax;
    }
    assert.strictEqual(request.type, 'POST');
    assert.deepStrictEqual(JSON.parse(request.data), { name: 'New template', description: 'Description' });
  });
});

describe('template tags across creation and promotion (isolated)', function() {
  it('copies template tag references to a new course while respecting an explicit empty selection', async function() {
    var harness = createHarness();
    var template = await harness.create('lightcoursetemplate', {
      name: 'Tagged template', tags: ['red', 'blue'], contentSnapshot: { contentTree: { children: [] } }
    });
    var course = await harness.create('lightcourse', { title: 'From template', _templateId: template._id });
    assert.deepStrictEqual(course.tags, ['red', 'blue']);
    var empty = await harness.create('lightcourse', { title: 'No tags', _templateId: template._id, tags: [] });
    assert.deepStrictEqual(empty.tags, []);
    course.tags.push('other');
    assert.deepStrictEqual(template.tags, ['red', 'blue']);
  });
  it('copies saved-version tags to a promoted template and onward to a new independent course', async function() {
    var harness = createHarness();
    harness.records.lightcourseversion = [{
      _id: 'version', versionNumber: 1,
      contentSnapshot: { tags: [{ _id: 'red', title: 'Red' }], contentTree: { children: [] } }
    }];
    var promoted = await callRoute(harness, 'post /content/lightcoursetemplate/from-version/:versionId', {
      params: { versionId: 'version' }, body: { name: 'Promoted' }
    });
    assert.deepStrictEqual(promoted.tags, ['red']);
    var Backbone = loadCommonJS('frontend/src/libraries/backbone.js', { underscore: _ });
    var Model = loadAMD('frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js', { backbone: Backbone });
    var model = new Model(copy(promoted), { parse: true });
    var clone = await harness.create('lightcoursetemplate', Object.assign({}, copy(_.omit(model.toJSON(), '_id')), { name: 'Clone' }));
    assert.deepStrictEqual(clone.tags, ['red']);
    var course = await harness.create('lightcourse', { title: 'From clone', _templateId: clone._id });
    assert.deepStrictEqual(course.tags, ['red']);
    assert.strictEqual(harness.records.lightcourseversion[0].contentSnapshot.tags[0].title, 'Red');
  });
});

describe('saving templates without leaving the editor (isolated)', function() {
  function harness() {
    var Backbone = loadCommonJS('frontend/src/libraries/backbone.js', { underscore: _ });
    var Model = loadAMD('frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js', { backbone: Backbone });
    var alerts = [];
    var navigations = [];
    var requests = [];
    var proto = loadAMD('frontend/src/modules/lightCourseAdmin/views/lightCourseTemplateEditorView.js', {
      '../../lightCourseEditor/tagEditor': loadAMD('frontend/src/modules/lightCourseEditor/tagEditor.js', {}),
      'core/origin': {
        l10n: { t: function(key) { return key; } },
        Notify: { alert: function(data) { alerts.push(data); } },
        router: { navigateTo: function(route) { navigations.push(route); } }
      },
      'core/views/originView': { extend: function(proto) { return proto; } },
      '../itemHistory': function() { return function() {}; }
    });
    var tree = { children: [{ _id: 'page', type: 'page', title: 'Page title', children: [] }] };
    var model = new Model({
      _id: 'template', name: 'Original',
      contentTree: tree,
      pluginSelections: { menu: 'menu', theme: 'theme', extensions: ['help'] },
      headerData: { iconChoices: { help: 'fa-question' } },
      glossaryItems: [{ _id: 'term', term: 'Word' }],
      resourceItems: [{ _id: 'resource', title: 'Reference' }],
      helpContent: { popup: { title: 'Help' } }
    });
    model.sync = function(method, model, options) {
      requests.push({ method: method, data: copy(model.toJSON()), options: options });
      return {};
    };
    var fields = {
      '.light-course-template-editor-name': 'Edited template',
      '.light-course-template-editor-description': 'Description',
      '.light-course-template-editor-menu-title': 'Menu title',
      '.light-course-template-editor-menu-body': 'Menu body'
    };
    var view = Object.assign(Object.create(proto), {
      model: model,
      treeView: { getContentTree: function() { return tree; } },
      $: function(selector) { return { val: function() { return fields[selector]; } }; }
    });
    return { view: view, model: model, fields: fields, alerts: alerts, navigations: navigations, requests: requests };
  }

  it('stays in the editor and preserves content and settings across two acknowledged saves', function() {
    var h = harness();
    h.view.onSaveClicked();
    assert.strictEqual(h.requests[0].method, 'update');
    h.requests[0].options.success({ success: true });
    assert.strictEqual(h.model.get('name'), 'Edited template');
    assert.strictEqual(h.navigations.length, 0);
    assert.strictEqual(h.alerts[0].type, 'success');
    h.fields['.light-course-template-editor-name'] = 'Second edit';
    h.view.onSaveClicked();
    assert.deepStrictEqual(h.requests[1].data.contentSnapshot, h.requests[0].data.contentSnapshot);
    h.requests[1].options.success({ success: true });
    assert.strictEqual(h.model.get('name'), 'Second edit');
    assert.strictEqual(h.model.get('headerData').iconChoices.help, 'fa-question');
    assert.strictEqual(h.model.get('pluginSelections').theme, 'theme');
    assert.strictEqual(h.navigations.length, 0);
    assert.strictEqual(h.alerts.length, 2);
  });

  it('keeps explicit Back to list navigation', function() {
    var h = harness();
    h.view.onBackToListClicked();
    assert.deepStrictEqual(h.navigations, ['lightCourseTemplates']);
  });

  it('continues to report validation and server errors without navigating', function() {
    var h = harness();
    h.fields['.light-course-template-editor-name'] = ' ';
    h.view.onSaveClicked();
    assert.strictEqual(h.requests.length, 0);
    assert.strictEqual(h.alerts[0].text, 'app.lightcoursetemplatenamerequired');
    h.fields['.light-course-template-editor-name'] = 'Template';
    h.view.onSaveClicked();
    h.requests[0].options.error({ responseJSON: { message: 'Save failed' } });
    assert.strictEqual(h.alerts[1].type, 'error');
    assert.strictEqual(h.alerts[1].text, 'Save failed');
    assert.strictEqual(h.navigations.length, 0);
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
