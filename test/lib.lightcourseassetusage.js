var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var EventEmitter = require('events');
var createRequire = require('module').createRequire;
var Backbone = require('../frontend/src/libraries/backbone');
var Handlebars = require('handlebars');
var usage = require('../lib/lightcourse/assetUsage');
var ROOT = path.join(__dirname, '..');
var ID = '1234567890abcdef12345678';
var AUDIO = '2234567890abcdef12345678';
var UNUSED = '3234567890abcdef12345678';

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function load(file, dependencies, globals) {
  var filename = path.join(ROOT, file), module = { exports: {} }, nativeRequire = createRequire(filename);
  function resolve(name) { return Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : nativeRequire(name); }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), Object.assign({
    module: module, exports: module.exports, require: resolve,
    define: function(factory) { module.exports = factory(resolve); }
  }, globals), { filename: filename });
  return module.exports;
}

function database() {
  var records = {
    lightcourseasset: [ID, AUDIO, UNUSED].map(function(id) { return { _id: id, _tenantId: 'tenant' }; }),
    lightcourse: [
      { _id: 'course', _tenantId: 'tenant', title: 'Course',
        contentTree: { children: [{ _id: ID, screenshotAssetId: ID, _graphic: { src: ID },
          _items: [{ _graphic: { src: ID }, audioSrc: AUDIO }],
          body: '<p><img src="/api/content/lightcourseasset/' + ID + '/serve"><img src="api/content/lightcourseasset/' + ID + '/serve"></p>',
          _componentSchemaSnapshot: { default: UNUSED }, _componentPresetId: UNUSED }] },
        resourceItems: [{ _id: UNUSED, _assetId: UNUSED }],
        helpContent: { popup: { body: '<audio src="api/content/lightcourseasset/' + AUDIO + '/serve"></audio>' } } },
      { _id: 'other', _tenantId: 'other-tenant', title: 'Private course', contentTree: { screenshotAssetId: ID } }
    ],
    lightcoursetemplate: [{ _id: 'template', _tenantId: 'tenant', name: 'Template',
      contentSnapshot: { contentTree: { children: [{ screenshotAssetId: ID }] } } }],
    lightcomponentdefault: [{ _id: 'default', _tenantId: 'tenant', name: 'Default',
      values: { screenshotAssetId: ID, nested: { _src: AUDIO }, empty: null } }],
    lightcoursebankasset: [{ _assetId: UNUSED }],
    lightcourseversion: [{ contentSnapshot: { screenshotAssetId: UNUSED } }],
    lightcourseexport: [{ renderedText: UNUSED }]
  };
  var queries = [];
  return {
    records: records, queries: queries,
    retrieve: function(type, query, options, callback) {
      queries.push({ type: type, query: query, options: options });
      callback(null, copy((records[type] || []).filter(function(record) { return record._tenantId === query._tenantId; })));
    }
  };
}

describe('saved light course asset usage', function() {
  it('counts saved fields across courses, templates and defaults, including screenshots, nested items, audio and HTML', async function() {
    var db = database(), original = JSON.stringify(db.records);
    var result = await usage.collect(db, 'tenant');
    assert.strictEqual(result[ID].count, 6);
    assert.deepStrictEqual(result[ID].uses.map(function(use) { return [use.type, use.title, use.paths.length]; }), [
      ['lightcourse', 'Course', 4], ['lightcoursetemplate', 'Template', 1], ['lightcomponentdefault', 'Default', 1]
    ]);
    assert(result[ID].uses[0].paths.includes('contentTree.children[0]._items[0]._graphic.src'));
    assert.strictEqual(result[AUDIO].count, 3);
    assert.deepStrictEqual(result[UNUSED], { count: 0, uses: [] });
    assert.strictEqual(db.queries.length, 4);
    db.queries.forEach(function(query) {
      assert.deepStrictEqual(query.query, { _tenantId: 'tenant' });
      assert.strictEqual(query.options.jsonOnly, true);
      assert(query.options.fields);
    });
    assert.strictEqual(JSON.stringify(db.records), original);
  });

  it('recomputes uses when references are replaced or removed rather than trusting stale bank selections', async function() {
    var db = database();
    var first = await usage.collect(db, 'tenant');
    db.records.lightcourse[0].contentTree = {};
    db.records.lightcoursetemplate[0].contentSnapshot = {};
    db.records.lightcomponentdefault[0].values.screenshotAssetId = AUDIO;
    var second = await usage.collect(db, 'tenant');
    assert.strictEqual(first[ID].count, 6);
    assert.deepStrictEqual(second[ID], { count: 0, uses: [] });
    assert.strictEqual(second[AUDIO].count, 3);
  });

  it('matches whole IDs and managed media/link URLs, never filename substrings or metadata-only IDs', async function() {
    var db = database();
    db.records.lightcourse = [];
    db.records.lightcoursetemplate = [];
    db.records.lightcomponentdefault[0].values = {
      _id: UNUSED, _componentSchemaSnapshot: { src: UNUSED }, text: 'prefix-' + UNUSED,
      image: 'api/content/lightcourseasset/' + ID + '/serve',
      body: '<a href="/api/content/lightcourseasset/' + AUDIO + '/serve?download=1">Audio</a>',
      script: '<script>api/content/lightcourseasset/' + UNUSED + '/serve</script>'
    };
    var result = await usage.collect(db, 'tenant');
    assert.strictEqual(result[ID].count, 1);
    assert.strictEqual(result[AUDIO].count, 1);
    assert.strictEqual(result[UNUSED].count, 0);
  });

  ['lightcourseasset', 'lightcourse', 'lightcoursetemplate', 'lightcomponentdefault'].forEach(function(type) {
    it('propagates ' + type + ' retrieval errors instead of reporting zero uses', async function() {
      var db = database(), retrieve = db.retrieve;
      db.retrieve = function(name, query, options, callback) {
        if (name === type) return callback(new Error('Read failed'));
        retrieve(name, query, options, callback);
      };
      await assert.rejects(usage.collect(db, 'tenant'), /Read failed/);
    });
  });
});

function routeHarness() {
  var app = new EventEmitter(), routes = {}, db = database();
  var h = { db: db, user: { _id: 'admin', tenant: { _id: 'tenant' } }, allowed: true, checks: 0 };
  load('plugins/content/lightcourseasset/index.js', {
    '../../../lib/contentmanager': { ContentPlugin: function() {} },
    '../../../lib/database': { getDatabase: function(callback, tenant) {
      assert.strictEqual(tenant, 'tenant');
      if (h.dbError) return callback(h.dbError);
      callback(null, db);
    } },
    '../../../lib/permissions': {
      buildResourceString: function(tenant, resource) { return tenant + resource; },
      hasPermission: function(user, action, resource, callback) {
        h.checks++;
        assert.strictEqual(action, 'update');
        callback(h.permissionError, h.allowed);
      }
    },
    '../../../lib/usermanager': { getCurrentUser: function() { return h.user; } },
    '../../../lib/rest': {
      get: function(route, handler) { routes[route] = handler; }, post: function() {}
    },
    '../../../': function() { return app; }
  });
  app.emit('serverStarted');
  h.request = function() {
    return new Promise(function(resolve, reject) {
      var res = {
        code: 200, status: function(code) { this.code = code; return this; },
        json: function(body) { resolve({ status: this.code, body: body }); }
      };
      routes['/content/lightcourseasset/uses/all']({}, res, reject);
    });
  };
  return h;
}

describe('placeholder asset usage route', function() {
  it('returns tenant-scoped usage for asset administrators', async function() {
    var h = routeHarness(), result = await h.request();
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body[ID].count, 6);
    assert.strictEqual(h.checks, 1);
  });
  it('rejects anonymous and read-only users without scanning content', async function() {
    var h = routeHarness();
    h.user = null;
    assert.strictEqual((await h.request()).status, 401);
    assert.strictEqual(h.checks, 0);
    h.user = { _id: 'reader', tenant: { _id: 'tenant' } };
    h.allowed = false;
    assert.strictEqual((await h.request()).status, 403);
    assert.strictEqual(h.db.queries.length, 0);
  });
  it('forwards permission and database errors explicitly', async function() {
    var h = routeHarness();
    h.permissionError = new Error('Permission failed');
    await assert.rejects(h.request(), /Permission failed/);
    h.permissionError = null;
    h.dbError = new Error('Database failed');
    await assert.rejects(h.request(), /Database failed/);
  });
});

function uiHarness() {
  var h = { requests: [], alerts: [], elements: {}, rows: [] };
  h.$ = function(selector) {
    if (!h.elements[selector]) h.elements[selector] = {
      text: function(text) { this.value = text; return this; },
      html: function(html) { this.value = html; return this; },
      empty: function() { this.value = ''; return this; },
      append: function() {}, addClass: function() {}, removeClass: function() {}
    };
    return h.elements[selector];
  };
  h.$.get = function(url) {
    assert.strictEqual(url, 'api/content/lightcourseasset/uses/all');
    var req = {
      done: function(callback) { this.success = callback; return this; },
      fail: function(callback) { this.failure = callback; return this; },
      abort: function() { this.aborted = true; if (this.failure) this.failure({}, 'abort'); }
    };
    h.requests.push(req);
    return req;
  };
  var parent = { extend: function(proto) { return proto; }, prototype: { remove: function() { h.removed = true; } } };
  h.origin = { l10n: { t: function(key) { return key; } }, Notify: { alert: function(alert) { h.alerts.push(alert); } } };
  var proto = load('frontend/src/modules/lightCourseAdmin/views/lightCourseAssetListView.js', {
    'core/origin': h.origin, 'core/views/originView': parent,
    './lightCourseAssetListItemView': function(options) {
      this.options = options; this.$el = 'row';
      this.remove = function() { this.removed = true; };
      h.rows.push(this);
    }
  }, { $: h.$ });
  var Model = Backbone.Model.extend({ idAttribute: '_id' });
  h.collection = new Backbone.Collection([{ _id: ID }, { _id: AUDIO }], { model: Model });
  h.view = Object.assign(Object.create(proto), {
    collection: h.collection, $: h.$,
    listenTo: function(collection, event, callback) { collection.on(event, callback, this); }
  });
  h.view.preRender();
  h.rowProto = load('frontend/src/modules/lightCourseAdmin/views/lightCourseAssetListItemView.js', {
    'core/origin': h.origin, 'core/views/originView': parent, '../itemHistory': function() {},
    './lightCourseAssetEditView': function() {}
  }, { Handlebars: { templates: { lightCourseAssetUses: function(data) { return h.template(data); } } } });
  return h;
}

describe('placeholder Uses column (isolated)', function() {
  it('loads one report per sync, refreshes rows and ignores superseded and disposed requests', function() {
    var h = uiHarness();
    h.collection.trigger('sync');
    assert.strictEqual(h.requests.length, 1);
    assert(h.rows.every(function(row) { return row.options.usageState === 'loading'; }));
    var report = {}; report[ID] = { count: 1, uses: [] }; report[AUDIO] = { count: 0, uses: [] };
    h.requests[0].success(report);
    assert.strictEqual(h.rows[2].options.usage.count, 1);
    assert(h.rows.slice(0, 2).every(function(row) { return row.removed; }));
    assert.strictEqual(h.collection.at(0).get('usage'), undefined);
    h.collection.trigger('sync');
    h.collection.trigger('sync');
    assert(h.requests[1].aborted);
    h.requests[1].success(report);
    assert.strictEqual(h.view.usageState, 'loading');
    h.view.remove();
    assert(h.requests[2].aborted);
    var rows = h.rows.length;
    h.requests[2].success(report);
    assert.strictEqual(h.rows.length, rows);
    assert.strictEqual(h.alerts.length, 0);
  });
  it('shows usage errors rather than zero and permits retrying on the next refresh', function() {
    var h = uiHarness();
    h.collection.trigger('sync');
    h.requests[0].failure({}, 'error');
    assert.strictEqual(h.view.usageState, 'error');
    assert.strictEqual(h.alerts.length, 1);
    h.collection.trigger('sync');
    assert.strictEqual(h.view.usageState, 'loading');
    assert.strictEqual(h.requests.length, 2);
  });
  it('renders escaped, linked owner details and distinct zero/loading/error states', function() {
    var h = uiHarness(), hb = Handlebars.create();
    h.template = hb.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseAdmin/templates/lightCourseAssetUses.hbs'), 'utf8'));
    var row = Object.assign(Object.create(h.rowProto), {
      model: new Backbone.Model({ assetType: 'image', size: 10 }), $: h.$
    });
    row.preRender({ usageState: 'loading' }); row.postRender();
    var cell = h.elements['.light-course-asset-list-item-uses'];
    assert.strictEqual(cell.value, 'app.lightcourseassetusesloading');
    row.preRender({ usageState: 'error' }); row.postRender();
    assert.strictEqual(cell.value, 'app.lightcourseassetuseserror');
    row.preRender({ usageState: 'ready', usage: { count: 0, uses: [] } }); row.postRender();
    assert(cell.value.includes('<span>0</span>'));
    row.preRender({ usageState: 'ready', usage: { count: 3, uses: [
      { type: 'lightcourse', id: 'course', title: '<script>Course</script>', paths: ['screenshotAssetId'] },
      { type: 'lightcoursetemplate', id: 'template', title: 'Template', paths: ['_graphic.src'] },
      { type: 'lightcomponentdefault', id: 'default', title: 'Default', paths: ['audioSrc'] }
    ] } }); row.postRender();
    ['#lightCourseEditor/course', '#lightCourseTemplates/template', '#lightCourseComponentDefaults/default']
      .forEach(function(href) { assert(cell.value.includes('href="' + href + '"')); });
    assert(cell.value.includes('<summary>3</summary>'));
    assert(cell.value.includes('&lt;script&gt;Course&lt;/script&gt;'));
    assert(!cell.value.includes('<script>'));
    row.preRender({ usageState: 'ready' }); row.postRender();
    assert.strictEqual(cell.value, 'app.lightcourseassetuseserror');
  });
});
