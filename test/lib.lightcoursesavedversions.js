var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var EventEmitter = require('events');
var createRequire = require('module').createRequire;
var _ = require('underscore');
var Backbone = require('../frontend/src/libraries/backbone');
var Handlebars = require('handlebars');
var auditVersion = require('../lib/lightcourse/auditVersion');
var versionDiff = require('../lib/lightcourse/versionDiff');
var ROOT = path.join(__dirname, '..');

function loadAMD(file, dependencies, globals) {
  var result;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), Object.assign({
    _: _, Backbone: Backbone,
    define: function(factory) { result = factory(function(name) { return dependencies[name]; }); }
  }, globals));
  return result;
}

function dom() {
  var elements = {}, optionId = 0;
  return function(selector) {
    if (typeof selector === 'object') return { data: function(key) { return selector[key]; } };
    if (selector === '<option></option>') selector += optionId++;
    if (!elements[selector]) {
      elements[selector] = {
        props: {}, options: [],
        val: function(value) { if (!arguments.length) return this.value; this.value = value; return this; },
        text: function(value) { this.valueText = value; return this; },
        html: function(value) { this.rendered = value; return this; },
        prop: function(key, value) { this.props[key] = value; return this; },
        empty: function() { this.options = []; return this; },
        append: function(value) { this.options.push(value); return this; },
        clone: function() { return this; }
      };
    }
    return elements[selector];
  };
}

function uiHarness() {
  var $ = dom();
  var modals = [], navigations = [], audits = [];
  var requests = [], downloads = [], revoked = [], readers = [];
  var origin = {
    sessionModel: { get: function() { return 'tenant-1'; } },
    schemas: { get: function() { return {}; } },
    l10n: { t: function(key) { return key; } },
    trigger: function(event, View, options) { modals.push(options); },
    router: { navigateTo: function(route) { navigations.push(route); } }
  };
  var parent = { extend: function(proto) { return proto; }, prototype: { remove: function() {} } };
  var browser = {
    XMLHttpRequest: function() {
      requests.push(this);
      this.open = function(method, url) { this.method = method; this.url = url; };
      this.send = function() {};
      this.getResponseHeader = function() { return this.disposition || 'attachment; filename="Old title_v0.1.docx"'; };
      this.abort = function() { this.aborted = true; if (this.onabort) this.onabort(); };
    },
    FileReader: function() {
      readers.push(this);
      this.readAsText = function(value) { this.result = value; };
    },
    URL: { createObjectURL: function() { return 'blob:word'; }, revokeObjectURL: function(url) { revoked.push(url); } },
    document: {
      createElement: function() { return { click: function() { downloads.push(this); } }; },
      body: { appendChild: function() {}, removeChild: function() {} }
    },
    setTimeout: function(callback) { callback(); }
  };
  var changes = loadAMD('frontend/src/modules/auditLog/lightFieldChanges.js', {
    'core/origin': origin, '../lightCourseEditor/schemaFilter': { filterComponentSchema: function() { return {}; } }
  });
  var deps = {
    backbone: Backbone, 'core/origin': origin, 'core/views/originView': parent,
    '../fieldPreview': function(node) { return [{ text: node.title }]; },
    '../componentLayout': require('../frontend/src/modules/lightCourseEditor/componentLayout'),
    '../../auditLog/lightFieldChanges': changes,
    '../wordExport': loadAMD('frontend/src/modules/lightCourseEditor/wordExport.js', { 'core/origin': origin }, browser),
    '../../auditLog/views/auditLogView': function(options) {
      this.model = options.model;
      this.remove = function() { this.removed = true; };
      audits.push(this);
    }
  };
  var templates = {};
  ['lightCourseVersionsList', 'lightCourseVersionPreview', 'lightCourseVersionComparison'].forEach(function(key) {
    templates[key] = function(data) { return data; };
  });
  function view(file) {
    var proto = loadAMD('frontend/src/modules/lightCourseEditor/views/' + file + '.js', deps,
      { $: $, Handlebars: { templates: templates } });
    var Model = Backbone.Model.extend({ idAttribute: '_id' });
    return Object.assign(Object.create(proto), { $: $, setViewToReady: function() {}, model: new Model({ _id: 'course', currentVersionNumber: '1.2' }) });
  }
  return { view: view, $: $, modals: modals, navigations: navigations, audits: audits, origin: origin,
    parent: parent, deps: deps, requests: requests, downloads: downloads, revoked: revoked, readers: readers };
}

function event(values) { return { preventDefault: function() {}, currentTarget: values }; }

function compareSnapshots(before, after) {
  var h = uiHarness(), view = h.view('lightCourseVersionsView');
  view.versions = [
    { _id: 'a', versionNumber: '0.1', contentSnapshot: before, headerSnapshot: before.headerData },
    { _id: 'b', versionNumber: '0.2', contentSnapshot: after, headerSnapshot: after.headerData }
  ];
  var original = JSON.stringify(view.versions);
  h.$('.light-course-versions-from').val('a'); h.$('.light-course-versions-to').val('b');
  view.model.compareVersions = function(a, b, options) { options.success(); return { abort: function() {} }; };
  view.onCompare(event());
  assert.strictEqual(JSON.stringify(view.versions), original);
  return h.$('.light-course-version-comparison').rendered;
}

function renderTemplate(name, data) {
  var handlebars = Handlebars.create();
  handlebars.registerHelper('t', function(key) { return key; });
  return handlebars.compile(fs.readFileSync(path.join(ROOT,
    'frontend/src/modules/lightCourseEditor/templates/' + name + '.hbs'), 'utf8'))(data);
}

describe('conversion review dialog', function() {
  function harness() {
    var elements = {}, requests = [], events = [], confirmations = [], alerts = [], routes = [];
    var blobs = [], downloads = [], appended = [], removed = [], timers = [], revoked = [];
    function element(tag) {
      return {
        tag: tag, children: [], props: {},
        empty: function() { this.children = []; return this; },
        append: function(child) { this.children.push(child); return this; },
        text: function(value) { this.value = value; return this; },
        prop: function(key, value) { this.props[key] = value; return this; }
      };
    }
    function $(selector) {
      if (selector.charAt(0) === '<') return element(selector);
      return elements[selector] || (elements[selector] = element(selector));
    }
    $.ajax = function(options) {
      var request = { options: options, done: function(callback) { this.success = callback; return this; },
        fail: function(callback) { this.failure = callback; return this; } };
      requests.push(request);
      return request;
    };
    var origin = {
      l10n: { t: function(key, data) { return key + (data && data.count !== undefined ? ':' + data.count : ''); } },
      Notify: { confirm: function(options) { confirmations.push(options); }, alert: function(options) { alerts.push(options); } },
      trigger: function(event) { events.push(event); },
      router: { navigateTo: function(route) { routes.push(route); } }
    };
    var proto = loadAMD('frontend/src/modules/lightCourseEditor/views/lightCourseConversionView.js', {
      'core/origin': origin,
      'core/views/originView': { extend: function(methods) { return methods; }, prototype: { remove: function() {} } }
    }, {
      $: $,
      Blob: function(parts, options) { this.parts = parts; this.type = options.type; blobs.push(this); },
      URL: { createObjectURL: function() { return 'blob:csv'; }, revokeObjectURL: function(url) { revoked.push(url); } },
      document: {
        createElement: function() { return { click: function() { downloads.push(this); } }; },
        body: {
          appendChild: function(link) { appended.push(link); link.parentNode = this; },
          removeChild: function(link) { removed.push(link); link.parentNode = null; }
        }
      },
      setTimeout: function(callback) { timers.push(callback); }
    });
    var model = new Backbone.Model({ _id: 'course' }); model.id = 'course';
    var view = Object.assign(Object.create(proto), { model: model, $: $ });
    return { view: view, $: $, requests: requests, events: events, confirmations: confirmations, alerts: alerts, routes: routes,
      blobs: blobs, downloads: downloads, appended: appended, removed: removed, timers: timers, revoked: revoked };
  }
  function texts(element) {
    return [element.value || ''].concat.apply([element.value || ''], element.children.map(texts));
  }
  it('shows readable, separate issues and values from the saved version without raw JSON', function() {
    var h = harness();
    h.view.review();
    h.requests[0].success({ versionNumber: '1.0', ready: false, locations: {
      c: [{ type: 'page', title: 'Welcome' }, { type: 'component', title: 'Intro', component: 'text' }]
    }, errors: [{ node: 'c', path: '_items[0].title', message: 'A title is required.' }],
    proposals: [{ node: 'c', path: '_items[0].enabled', value: false, source: 'Installed schema' }] });
    var results = h.$('.light-course-conversion-results');
    var rendered = texts(results).join(' ');
    assert(rendered.includes('app.lightcourseconversionpage: Welcome / app.lightcourseconversioncomponent (text): Intro - Items / Item 1 / Title'));
    assert(rendered.includes('A title is required.'));
    assert(rendered.includes('app.lightcourseconversionno'));
    assert(rendered.includes('app.lightcourseconversionsourceschema'));
    assert(rendered.includes('app.lightcourseconversiondefaultsreview:1'));
    assert(!rendered.includes('"fallback"'));
    assert(results.children[1].children[2].tag.includes('light-course-conversion-issue'));
    assert(!results.children[1].children[2].tag.includes('class="error"'));
    assert.strictEqual(h.$('.light-course-conversion-create').props.disabled, true);
    h.view.review();
    assert.strictEqual(results.children.length, 0);
    h.requests[1].failure({ responseJSON: { message: 'Check failed' } });
    assert.strictEqual(h.$('.light-course-conversion-status').value, 'Check failed');
    assert.strictEqual(h.alerts[0].text, 'Check failed');
    assert.strictEqual(h.alerts[0].type, 'error');
    assert.strictEqual(h.alerts[0].html, false);
    assert.deepStrictEqual(Object.keys(h.view.getData()), []);
  });
  it('exports the current issues as spreadsheet-safe UTF-8 CSV and cleans up the download', function() {
    var h = harness();
    h.view.review();
    h.requests[0].success({ versionNumber: '1.2', ready: false, locations: {
      '=node': [{ type: 'page', title: 'Café, "welcome"' }, { type: 'component', title: 'Intro\nnext', component: 'text' }]
    }, errors: [
      { node: '=node', path: '_items[0].title', message: '  =SUM(1,2)' },
      { node: 'config', path: '+danger', message: '\tunsafe' }
    ], proposals: [{ node: 'course', path: 'secret', value: 'not an issue' }] });
    var issues = h.$('.light-course-conversion-results').children[1];
    assert(issues.children[1].tag.includes('light-course-conversion-export'));
    h.view.exportIssues(event());
    assert.strictEqual(h.blobs[0].type, 'text/csv;charset=utf-8');
    var csv = h.blobs[0].parts[0];
    assert.strictEqual(csv.charAt(0), '\ufeff');
    assert(csv.includes('Café, ""welcome""'));
    var rows = require('../lib/helpers').parseCsv(csv);
    assert.deepStrictEqual(Object.values(rows[0]), ['1.2',
      'app.lightcourseconversionpage: Café, "welcome" / app.lightcourseconversioncomponent (text): Intro\nnext',
      'Items / Item 1 / Title', "'  =SUM(1,2)", "'=node", '_items[0].title']);
    assert.deepStrictEqual(Object.values(rows[1]), ['1.2', 'app.lightcourseconversionconfig', "'+danger",
      "'\tunsafe", 'config', "'+danger"]);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(h.downloads[0].download, 'light-course-conversion-issues-v1.2.csv');
    assert.strictEqual(h.downloads[0].href, 'blob:csv');
    assert.strictEqual(h.appended[0], h.removed[0]);
    assert.deepStrictEqual(h.revoked, []);
    h.timers[0]();
    assert.deepStrictEqual(h.revoked, ['blob:csv']);
  });
  it('does not export without issues or while a new review is pending or has failed', function() {
    var h = harness();
    h.view.exportIssues(event());
    h.view.review();
    h.view.exportIssues(event());
    h.requests[0].success({ versionNumber: '1.0', ready: true, errors: [], proposals: [] });
    assert(!h.$('.light-course-conversion-results').children.some(function(child) {
      return child.tag.includes('light-course-conversion-issues');
    }));
    h.view.exportIssues(event());
    h.view.review();
    h.view.exportIssues(event());
    h.requests[1].success({ versionNumber: '1.1', ready: false, errors: [{ node: 'course', message: 'Fix' }], proposals: [] });
    h.view.review();
    h.view.exportIssues(event());
    h.requests[2].failure({ responseJSON: { message: 'Check failed' } });
    h.view.exportIssues(event());
    assert.strictEqual(h.downloads.length, 0);
  });
  it('closes the modal on success and keeps cancel available after a failed conversion', function() {
    var h = harness();
    h.view.review();
    h.requests[0].success({ versionNumber: '1.0', ready: true, hash: 'reviewed', errors: [], proposals: [] });
    assert.strictEqual(h.$('.light-course-conversion-create').props.disabled, false);
    h.view.confirmConversion(event());
    h.confirmations[0].callback(true);
    assert.strictEqual(h.events[0], 'modal:disableCancelButton');
    assert.deepStrictEqual(JSON.parse(h.requests[1].options.data), { hash: 'reviewed', approved: true });
    h.requests[1].failure({ responseJSON: { message: 'Conversion failed' } });
    assert.strictEqual(h.events[1], 'modal:enableCancelButton');
    h.timers[0]();
    assert.strictEqual(h.alerts[0].text, 'Conversion failed');
    assert.strictEqual(h.alerts[0].html, false);
    assert.strictEqual(h.$('.light-course-conversion-status').value, 'Conversion failed');
    h.view.review();
    h.requests[2].success({ versionNumber: '1.0', ready: true, hash: 'new', errors: [], proposals: [] });
    h.view.confirmConversion(event());
    h.confirmations[1].callback(true);
    h.requests[3].success({ courseId: 'full-course' });
    assert(h.events.includes('modal:onCancel'));
    assert.deepStrictEqual(h.routes, ['editor/full-course/menu']);
  });
  it('uses a generic overlay for missing error details and suppresses alerts after closing', function() {
    var h = harness();
    h.view.review();
    h.requests[0].failure({});
    assert.strictEqual(h.alerts[0].text, 'app.errorgeneric');
    h.view.review();
    h.view.remove();
    h.requests[1].failure({ responseJSON: { message: 'Late failure' } });
    assert.strictEqual(h.alerts.length, 1);
  });
  it('ignores a pending check after the dialog is cancelled and does not approve a different review', function() {
    var h = harness();
    h.view.review();
    h.view.remove();
    h.requests[0].success({ versionNumber: '1.0', ready: true, hash: 'late', errors: [], proposals: [] });
    assert.strictEqual(h.view.plan, null);
    h = harness();
    h.view.review();
    h.requests[0].success({ versionNumber: '1.0', ready: true, hash: 'first', errors: [], proposals: [] });
    h.view.confirmConversion(event());
    h.view.plan = { ready: true, hash: 'different' };
    h.confirmations[0].callback(true);
    assert.strictEqual(h.requests.length, 1);
  });
});

describe('saved light course versions (isolated)', function() {
  it('sorts major/minor versions numerically, handles empty lists and surfaces failures', function() {
    var h = uiHarness(), view = h.view('lightCourseVersionsView'), callbacks;
    view.preRender({});
    view.model.fetchVersions = function(options) { callbacks = options; };
    view.postRender();
    callbacks.success([{ _id: 'a', versionNumber: '0.9' }, { _id: 'b', versionNumber: '0.10' }, { _id: 'c', versionNumber: '1.0' }]);
    assert.deepStrictEqual(Array.from(view.versions, function(v) { return v.versionNumber; }), ['1.0', '0.10', '0.9']);
    callbacks.success([]);
    assert.strictEqual(h.$('.light-course-versions-compare').props.disabled, true);
    callbacks.error({ responseJSON: { message: 'Unavailable' } });
    assert.strictEqual(h.$('.light-course-versions-error').valueText, 'Unavailable');
    assert.strictEqual(h.$('.light-course-versions-error').props.hidden, false);
  });

  it('renders a historical snapshot without mutating it and cancels superseded previews', function() {
    var h = uiHarness(), view = h.view('lightCourseVersionsView'), callbacks, aborted = 0;
    var version = { versionNumber: '0.1', contentSnapshot: { contentTree: { children: [{ _id: 'p', type: 'page', title: 'Past title', children: [] }] } } };
    var original = JSON.stringify(version), draft = JSON.stringify(view.model.toJSON());
    view.model.fetchVersion = function(id, options) { callbacks = options; return { abort: function() { aborted++; } }; };
    view.viewVersion('old');
    callbacks.success(version);
    var preview = h.$('.light-course-version-preview').rendered;
    assert.strictEqual(preview.children[0].title, 'Past title');
    assert.strictEqual(preview.missingTitle, true);
    assert.strictEqual(JSON.stringify(version), original);
    assert.strictEqual(JSON.stringify(view.model.toJSON()), draft);
    view.viewVersion('new');
    assert.strictEqual(aborted, 1);
    view.remove();
    callbacks.success(version);
    assert.strictEqual(h.$('.light-course-version-preview').rendered, preview);
    ['lightCourseVersionPreview.hbs', 'partials/part_lightCourseVersionNode.hbs'].forEach(function(file) {
      assert(!/<(?:input|button|textarea|select)\b|contenteditable/.test(fs.readFileSync(path.join(ROOT, 'frontend/src/modules/lightCourseEditor/templates', file), 'utf8')));
    });
  });

  it('keeps historical Word export but removes View and Change history controls from the list', function() {
    var h = uiHarness(), view = h.view('lightCourseVersionsView');
    view.versions = [{ _id: 'saved', versionNumber: '0.1', contentSnapshot: { title: 'Old title' } }];
    view.model.save = function() { assert.fail('Historical export must not save the draft'); };
    view.model.fetch = view.model.fetchVersion = function() { assert.fail('Historical export must not fetch or replace the draft'); };
    var original = JSON.stringify(view.versions), draft = JSON.stringify(view.model.toJSON());
    view.onExport(event({ 'version-id': 'saved' }));
    assert.strictEqual(h.modals.length, 0);
    assert.strictEqual(h.requests.length, 1);
    assert.strictEqual(h.requests[0].url, 'document-export/tenant-1/saved?format=docx');
    assert.strictEqual(h.requests[0].responseType, 'blob');
    assert.strictEqual(h.$('.light-course-version-export').props.disabled, true);
    view.onExport(event({ 'version-id': 'saved' }));
    assert.strictEqual(h.requests.length, 1);
    h.requests[0].status = 200;
    h.requests[0].response = 'word blob';
    h.requests[0].onload();
    assert.strictEqual(h.downloads[0].download, 'Old title_v0.1.docx');
    assert.strictEqual(h.downloads[0].href, 'blob:word');
    assert.deepStrictEqual(h.revoked, ['blob:word']);
    assert.strictEqual(h.$('.light-course-version-export').props.disabled, false);
    assert.strictEqual(h.modals.length, 0);
    assert.strictEqual(h.navigations.length, 0);
    assert.strictEqual(JSON.stringify(view.versions), original);
    assert.strictEqual(JSON.stringify(view.model.toJSON()), draft);
    var html = renderTemplate('lightCourseVersionsList', { versions: view.versions });
    assert(html.includes('light-course-version-export'));
    assert(!html.includes('light-course-version-view'));
    assert(!html.includes('light-course-version-audit'));
    assert.strictEqual(view.events['click .light-course-version-view'], undefined);
    assert.strictEqual(view.events['click .light-course-version-audit'], undefined);
  });

  it('shows direct-export errors in the list and re-enables exports for retry', function() {
    var h = uiHarness(), view = h.view('lightCourseVersionsView');
    view.versions = [{ _id: 'saved', versionNumber: '0.1', contentSnapshot: {} }];
    view.onExport(event({ 'version-id': 'missing' }));
    assert.strictEqual(h.requests.length, 0);
    assert.strictEqual(h.$('.light-course-versions-error').props.hidden, false);
    view.onExport(event({ 'version-id': 'saved' }));
    assert.strictEqual(h.$('.light-course-versions-error').props.hidden, true);
    h.requests[0].status = 403;
    h.requests[0].response = '{"message":"Export not permitted"}';
    h.requests[0].onload();
    h.readers[0].onload();
    assert.strictEqual(h.$('.light-course-versions-error').valueText, 'Export not permitted');
    assert.strictEqual(h.$('.light-course-versions-error').props.hidden, false);
    assert.strictEqual(h.$('.light-course-version-export').props.disabled, false);
    view.onExport(event({ 'version-id': 'saved' }));
    h.requests[1].onerror();
    assert.strictEqual(h.$('.light-course-versions-error').valueText, 'app.errorgeneric');
    assert.strictEqual(h.$('.light-course-version-export').props.disabled, false);
    view.onExport(event({ 'version-id': 'saved' }));
    h.requests[2].status = 200;
    h.requests[2].onload();
    assert.strictEqual(h.downloads.length, 1);
    assert.strictEqual(h.$('.light-course-versions-error').props.hidden, true);
    assert.strictEqual(h.modals.length, 0);
  });

  it('uses archived tags in fallback filenames and never substitutes the current course tags', function() {
    var h = uiHarness(), view = h.view('lightCourseVersionsView');
    view.model.set({ title: 'Current title', tags: [{ _id: 'live', title: 'Live tag' }] });
    view.versions = [
      { _id: 'tagged', versionNumber: '0.1', contentSnapshot: {
        title: 'Old title', tags: [{ _id: 'archived', title: 'Archived' }, { _id: 'safety', title: 'Safety' }]
      } },
      { _id: 'untagged', versionNumber: '0.2', contentSnapshot: { title: 'Old title' } }
    ];
    ['tagged', 'untagged'].forEach(function(id, index) {
      view.onExport(event({ 'version-id': id }));
      h.requests[index].getResponseHeader = function() { return null; };
      h.requests[index].status = 200;
      h.requests[index].onload();
    });
    assert.strictEqual(h.downloads[0].download, 'Archived_Safety_Old title_v0.1.docx');
    assert.strictEqual(h.downloads[1].download, 'Old title_v0.2.docx');
    assert.strictEqual(h.modals.length, 0);
  });

  it('cancels direct exports on leaving and ignores late responses', function() {
    var h = uiHarness(), view = h.view('lightCourseVersionsView');
    view.versions = [{ _id: 'saved', versionNumber: '0.1', contentSnapshot: {} }];
    view.onExport(event({ 'version-id': 'saved' }));
    view.remove();
    assert.strictEqual(h.requests[0].aborted, true);
    h.requests[0].status = 200;
    h.requests[0].onload();
    h.requests[0].onerror();
    view.onExport(event({ 'version-id': 'saved' }));
    assert.strictEqual(h.requests.length, 1);
    assert.strictEqual(h.downloads.length, 0);
    assert.strictEqual(h.$('.light-course-versions-error').props.hidden, true);
    assert.strictEqual(h.modals.length, 0);
  });

  it('ignores deferred export-error decoding after leaving the saved versions list', function() {
    var h = uiHarness(), view = h.view('lightCourseVersionsView');
    view.versions = [{ _id: 'saved', versionNumber: '0.1', contentSnapshot: {} }];
    view.onExport(event({ 'version-id': 'saved' }));
    h.requests[0].status = 403;
    h.requests[0].response = '{"message":"Export not permitted"}';
    h.requests[0].onload();
    view.remove();
    h.readers[0].onload();
    h.readers[0].onerror();
    assert.strictEqual(h.$('.light-course-versions-error').props.hidden, true);
    assert.strictEqual(h.downloads.length, 0);
    assert.strictEqual(h.modals.length, 0);
  });

  it('compares full before/after text, clearing, nested settings, presets, assets and page titles', function() {
    var h = uiHarness(), view = h.view('lightCourseVersionsView'), callbacks;
    var before = { title: 'Old course', body: 'A'.repeat(5000), contentTree: { children: [
      { _id: 'p', type: 'page', title: 'Old page', children: [
        { _id: 'c', type: 'component', title: 'Old component', body: 'Text', _componentPresetId: 'old', _graphic: { src: 'old.png' } }
      ] }
    ] } };
    var after = JSON.parse(JSON.stringify(before));
    after.title = 'New course'; after.body = ''; after.contentTree.children[0].title = 'New page';
    var node = after.contentTree.children[0].children[0];
    node.title = 'New component'; node.body = ''; node._componentPresetId = 'new'; node._graphic.src = 'new.png'; node.instruction = 'Added';
    view.versions = [
      { _id: 'a', versionNumber: '0.1', contentSnapshot: before, headerSnapshot: { iconChoices: { help: 'old' } } },
      { _id: 'b', versionNumber: '1.0', contentSnapshot: after, headerSnapshot: { iconChoices: { help: 'new' } } }
    ];
    var original = JSON.stringify(view.versions);
    h.$('.light-course-versions-from').val('a'); h.$('.light-course-versions-to').val('b');
    view.model.compareVersions = function(a, b, options) {
      assert.strictEqual(a, 'a'); assert.strictEqual(b, 'b'); callbacks = options; return { abort: function() {} };
    };
    view.onCompare(event());
    callbacks.success({ contentTree: { added: [], deleted: [], moved: [] } });
    var fields = h.$('.light-course-version-comparison').rendered.fields;
    ['Old course', 'Old page', 'Old component', 'old.png', 'A'.repeat(5000)].forEach(function(value) {
      assert(fields.some(function(field) { return field.before === value; }), value.slice(0, 30));
    });
    assert(fields.some(function(field) { return field.before === 'Text' && field.after === 'app.lightcourseversionempty'; }));
    assert(fields.some(function(field) { return field.before === 'app.lightcourseversionnotrecorded' && field.after === 'Added'; }));
    assert(fields.some(function(field) { return field.field.indexOf('Icon') !== -1 && field.after === 'new'; }));
    assert.strictEqual(JSON.stringify(view.versions), original);
  });

  it('ignores reordered tag sets and names genuine tag additions and removals', function() {
    var tags = [{ _id: 'first', title: 'First tag' }, { _id: 'second', title: 'Second tag' }];
    var before = { tags: tags, contentTree: { children: [] } };
    var unchanged = compareSnapshots(before, { tags: tags.slice().reverse(), contentTree: { children: [] } });
    assert.strictEqual(unchanged.hasChanges, false);
    var report = compareSnapshots(before, {
      tags: [tags[0], { _id: 'third', title: 'Third tag' }], contentTree: { children: [] }
    });
    assert.strictEqual(report.moved.length, 0);
    assert(report.added.some(function(item) { return item.element.includes('Third tag'); }));
    assert(report.removed.some(function(item) { return item.element.includes('Second tag'); }));
    assert(report.fields.some(function(field) { return field.before === 'Second tag'; }));
    assert(report.fields.some(function(field) { return field.after === 'Third tag'; }));
    assert(!renderTemplate('lightCourseVersionComparison', report).includes('"_id"'));
  });

  it('names each added/removed element and its content without JSON, schemas, empty defaults or insertion-only moves', function() {
    var before = { contentTree: { children: [{ _id: 'existing', type: 'page', title: 'Existing', children: [] }] } };
    var after = JSON.parse(JSON.stringify(before));
    after.contentTree.children.unshift({ _id: 'new-page', type: 'page', title: 'New page', children: [
      { _id: 'new-article', type: 'article', children: [
        { _id: 'new-block', type: 'block', children: [
          { _id: 'new-component', type: 'component', _component: 'text', title: 'New component', body: 'New content',
            developerNotes: '', items: [], _componentSchemaSnapshot: { title: { type: 'string' }, internal: { default: 'Schema noise' } } }
        ] }
      ] }
    ] });
    var report = compareSnapshots(before, after);
    assert.strictEqual(report.added.length, 4);
    assert.strictEqual(report.removed.length, 0);
    assert.strictEqual(report.moved.length, 0);
    assert(report.added.some(function(item) { return item.element.includes('New component'); }));
    assert(report.fields.some(function(field) { return field.after === 'New content'; }));
    assert(!report.fields.some(function(field) { return field.field.includes('Developer notes'); }));
    var html = renderTemplate('lightCourseVersionComparison', report);
    assert(html.includes('New page')); assert(html.includes('New content'));
    ['Schema noise', '_componentSchemaSnapshot', '"_id"', '<pre>'].forEach(function(text) { assert(!html.includes(text), text); });
    var removed = compareSnapshots(after, before);
    assert.strictEqual(removed.removed.length, 4);
    assert.strictEqual(removed.added.length, 0);
    assert.strictEqual(removed.moved.length, 0);
    assert(removed.fields.some(function(field) { return field.before === 'New content'; }));
  });

  it('shows cross-block moves with before/after locations and only the actual edited fields', function() {
    var before = { contentTree: { children: [{ _id: 'p', type: 'page', title: 'Page', children: [
      { _id: 'a', type: 'article', children: [
        { _id: 'left', type: 'block', title: 'Left block', children: [{ _id: 'c', type: 'component', title: 'Component', body: 'Old text' }] },
        { _id: 'right', type: 'block', title: 'Right block', children: [] }
      ] }
    ] }] } };
    var after = JSON.parse(JSON.stringify(before));
    var blocks = after.contentTree.children[0].children[0].children;
    var component = blocks[0].children.pop();
    component.body = 'New text';
    blocks[1].children.push(component);
    var report = compareSnapshots(before, after);
    assert.strictEqual(report.added.length, 0); assert.strictEqual(report.removed.length, 0);
    assert.strictEqual(report.moved.length, 1);
    assert(report.moved[0].before.includes('Left block'));
    assert(report.moved[0].after.includes('Right block'));
    assert.strictEqual(report.fields.length, 1);
    assert.strictEqual(report.fields[0].before, 'Old text');
    assert.strictEqual(report.fields[0].after, 'New text');
  });

  it('reports sibling reorder-only changes without claiming no changes or repeating field-order rows', function() {
    var before = { contentTree: { children: [
      { _id: 'a', type: 'page', title: 'First', children: [] }, { _id: 'b', type: 'page', title: 'Second', children: [] }
    ] } };
    var after = JSON.parse(JSON.stringify(before));
    after.contentTree.children.reverse();
    var report = compareSnapshots(before, after);
    assert.strictEqual(report.moved.length, 2);
    assert.strictEqual(report.fields.length, 0);
    assert.strictEqual(report.hasChanges, true);
    assert(!renderTemplate('lightCourseVersionComparison', report).includes('app.lightcourseversionnochanges'));
  });

  it('also names resource additions/removals/moves and flattens complex value replacements into readable text', function() {
    var before = { resourceItems: [
      { _id: 'a', title: 'First resource' }, { _id: 'b', title: 'Second resource' }, { _id: 'old', title: 'Removed resource' }
    ], customSetting: { label: 'Previous setting', number: 0 } };
    var after = { resourceItems: [
      { _id: 'b', title: 'Second resource' }, { _id: 'a', title: 'First resource' }, { _id: 'new', title: 'Added resource' }
    ], customSetting: 'New setting' };
    var report = compareSnapshots(before, after);
    assert.strictEqual(report.added.length, 1); assert(report.added[0].element.includes('Added resource'));
    assert.strictEqual(report.removed.length, 1); assert(report.removed[0].element.includes('Removed resource'));
    assert.strictEqual(report.moved.length, 2);
    assert(!report.fields.some(function(field) { return field.field.includes('app.lightcourseauditorder'); }));
    var setting = report.fields.find(function(field) { return field.field === 'Custom Setting'; });
    assert.strictEqual(setting.before, 'Label: Previous setting\nNumber: 0');
    assert.strictEqual(setting.after, 'New setting');
  });

  it('shows no changes for identical content and safely escapes all displayed field values', function() {
    var before = { title: 'Same', headerData: { versionHistory: [{ notes: 'Old notes' }] } };
    var after = { title: 'Same', headerData: { versionHistory: [{ notes: 'New notes' }] } };
    var same = compareSnapshots(before, after);
    assert.strictEqual(same.hasChanges, false);
    assert(renderTemplate('lightCourseVersionComparison', same).includes('app.lightcourseversionnochanges'));
    var changed = compareSnapshots({ body: 'Before' }, { body: '<script>alert("unsafe")</script>' });
    var html = renderTemplate('lightCourseVersionComparison', changed);
    assert(!html.includes('<script>'));
    assert(html.includes('&lt;script&gt;'));
  });

  it('defaults history to the active version, supports explicit/All filters and disposes requests', function() {
    var h = uiHarness(), view = h.view('lightCourseAuditLogView'), callbacks, aborted = false;
    view.preRender({ lightCourseId: 'course' });
    assert.strictEqual(view.selectedVersion, '1.2');
    view.model.fetchVersions = function(options) { callbacks = options; return { abort: function() { aborted = true; } }; };
    view.postRender(); callbacks.success([{ versionNumber: '1.2' }, { versionNumber: '0.1' }]);
    assert.strictEqual(h.audits[0].model.get('auditVersion'), '1.2');
    h.$('.light-course-auditlog-version').val('all'); view.onVersionChanged();
    assert.strictEqual(h.audits[0].removed, true);
    assert.strictEqual(h.audits[1].model.get('auditVersion'), 'all');
    view.preRender({ lightCourseId: 'course', selectedVersion: '0.1' });
    assert.strictEqual(view.selectedVersion, '0.1');
    view.remove(); assert(aborted); assert(h.audits[1].removed);
    view.preRender({ lightCourseId: 'course', selectedVersion: undefined });
    view.model.unset('currentVersionNumber'); view.preRender({ lightCourseId: 'course' });
    assert.strictEqual(view.selectedVersion, 'draft');
  });

  it('waits for queued saves before navigating and stays when saving fails', function() {
    var h = uiHarness(), view = h.view('lightCourseEditorView');
    view._autosaveInFlight = true;
    view.onVersionsClicked(event());
    assert.strictEqual(h.navigations.length, 0);
    view._saveCallbacks.shift()(new Error('Save failed'));
    assert.strictEqual(h.navigations.length, 0);
    view.onAuditLogClicked(event()); view._saveCallbacks.shift()();
    assert.strictEqual(h.navigations[0], 'lightCourseEditor/course/auditlog');
    view._autosaveInFlight = false;
    view.model.save = function() { assert.fail('Viewing must not trigger a new save'); };
    view.onVersionsClicked(event());
    assert.strictEqual(h.navigations[1], 'lightCourseEditor/course/versions');
  });

  it('shows one labelled course title above the tags inside the conversion-locked fieldset', function() {
    var handlebars = Handlebars.create();
    handlebars.registerHelper('t', function(key) { return key; });
    handlebars.registerHelper('ifValueEquals', function(value, expected, options) {
      return value === expected ? options.fn(this) : options.inverse(this);
    });
    var html = handlebars.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseEditor/templates/lightCourseEditor.hbs'), 'utf8'))({
      _id: 'course', title: 'Copy of Original', conversionStatus: 'converted'
    });
    assert.strictEqual((html.match(/class="light-course-editor-menu-title"/g) || []).length, 1);
    assert(html.indexOf('light-course-editor-editable-fields') < html.indexOf('light-course-title-course'));
    assert(html.indexOf('light-course-title-course') < html.indexOf('light-course-editor-tags'));
    assert(html.includes('for="light-course-title-course"'));
    assert(html.includes('value="Copy of Original"'));
  });

  it('autosaves renamed course titles and rejects an empty title without changing the model', function() {
    var h = uiHarness(), alerts = [], saves = 0;
    h.origin.Notify = { alert: function(alert) { alerts.push(alert); } };
    var proto = loadAMD('frontend/src/modules/lightCourseEditor/views/lightCourseEditorView.js', h.deps,
      { $: function(target) { return target; } });
    var view = Object.assign(Object.create(proto), {
      model: new Backbone.Model({ title: 'Copy of Original', body: 'Original body' }),
      autosave: function() { saves++; }
    });
    var input = {
      value: 'New course title',
      hasClass: function(name) { return name === 'light-course-editor-menu-title'; },
      val: function(value) { if (!arguments.length) return this.value; this.value = value; return this; }
    };
    view.onMenuFieldChanged({ currentTarget: input });
    assert.strictEqual(view.model.get('title'), 'New course title');
    assert.strictEqual(saves, 1);
    input.value = '   ';
    view.onMenuFieldChanged({ currentTarget: input });
    assert.strictEqual(input.value, 'New course title');
    assert.strictEqual(view.model.get('title'), 'New course title');
    assert.strictEqual(alerts[0].text, 'app.lightcoursetitlerequired');
    assert.strictEqual(saves, 1);
  });

  it('enables conversion only after a version exists and blocks direct clicks without one', function() {
    var h = uiHarness(), view = h.view('lightCourseEditorView'), opened = 0;
    h.origin.permissions = { hasPermissions: function() { return true; } };
    h.origin.trigger = function() { opened++; };
    view.model.isLocked = function() { return false; };
    view.autosave = function(callback) { callback(); };
    view.model.unset('currentVersionNumber');
    view.updateVersionButtonLabels();
    assert.strictEqual(h.$('.light-course-editor-convert').props.disabled, true);
    assert.strictEqual(h.$('.light-course-editor-convert-help').props.hidden, false);
    view.onConvertClicked(event());
    assert.strictEqual(opened, 0);
    view.model.set('currentVersionNumber', '0.1');
    view.updateVersionButtonLabels();
    assert.strictEqual(h.$('.light-course-editor-convert').props.disabled, false);
    assert.strictEqual(h.$('.light-course-editor-convert-help').props.hidden, true);
    view.onConvertClicked(event());
    assert.strictEqual(opened, 1);
  });

  it('opens the converted Full Course instead of starting another conversion', function() {
    var h = uiHarness(), view = h.view('lightCourseEditorView');
    h.origin.permissions = { hasPermissions: function() { return true; } };
    view.model.set({ conversionStatus: 'converted', _convertedCourseId: 'full-course' });
    view.model.unset('currentVersionNumber');
    view.updateVersionButtonLabels();
    assert.strictEqual(h.$('.light-course-editor-convert').valueText, 'app.lightcoursejumptofullcourse');
    assert.strictEqual(h.$('.light-course-editor-convert').props.disabled, false);
    assert.strictEqual(h.$('.light-course-editor-convert-help').props.hidden, true);
    view.onConvertClicked(event());
    assert.deepStrictEqual(h.navigations, ['editor/full-course/menu']);
    assert.strictEqual(h.modals.length, 0);
  });

  it('reports a missing converted-course link and respects conversion permissions', function() {
    var h = uiHarness(), view = h.view('lightCourseEditorView'), alerts = [];
    h.origin.permissions = { hasPermissions: function() { return true; } };
    h.origin.Notify = { alert: function(alert) { alerts.push(alert); } };
    view.model.set('conversionStatus', 'converted');
    view.onConvertClicked(event());
    assert.strictEqual(alerts[0].text, 'app.lightcourseconvertedlinkmissing');
    view.model.set('_convertedCourseId', 'full-course');
    h.origin.permissions.hasPermissions = function() { return false; };
    view.onConvertClicked(event());
    assert.strictEqual(h.navigations.length, 0);
  });

  it('includes the selected version in audit requests and prevents late rendering after disposal', function() {
    var h = uiHarness(), callbacks, aborted = 0, rendered = 0;
    h.$.ajax = function(options) { callbacks = options; return { abort: function() { aborted++; } }; };
    var proto = loadAMD('frontend/src/modules/auditLog/views/auditLogView.js', h.deps, { $: h.$ });
    var view = Object.assign(Object.create(proto), {
      contentType: 'lightcourse', contentId: 'course', auditVersion: '0.1',
      applyFilters: function() {}, renderLogs: function() { rendered++; }
    });
    view.loadLogs();
    assert(callbacks.url.endsWith('&version=0.1'));
    view.loadLogs(); assert.strictEqual(aborted, 1);
    view.remove(); assert.strictEqual(aborted, 2);
    callbacks.success([]); callbacks.error({ statusText: 'abort' });
    assert.strictEqual(rendered, 0);
  });
});

describe('version attribution and comprehensive backend diffs', function() {
  it('records course, version and export identity without guessing unknown historical versions', function() {
    assert.deepStrictEqual(auditVersion.metadataFor('lightcourse', { _id: 'c' }), { lightCourseId: 'c', lightCourseVersion: 'draft' });
    assert.strictEqual(auditVersion.metadataFor('lightcourseversion', { _lightCourseId: 'c', versionNumber: '1.0' }).lightCourseVersion, '1.0');
    assert.strictEqual(auditVersion.metadataFor('lightcourseexport', { _lightCourseId: 'c', versionNumber: '0.1' }).lightCourseVersion, '0.1');
    assert.strictEqual(auditVersion.metadataFor('course', { _id: 'c' }), undefined);
    assert.strictEqual(auditVersion.versionFor({ metadata: { lightCourseVersion: '0.2' }, snapshot: { currentVersionNumber: '1.0' } }), '0.2');
    assert.strictEqual(auditVersion.versionFor({ snapshot: { currentVersionNumber: '1.0' } }), '1.0');
    assert.strictEqual(auditVersion.versionFor({ snapshot: { versionNumber: '0.3' } }), '0.3');
    assert.strictEqual(auditVersion.versionFor({ snapshot: { _versionId: 'v' } }, [{ _id: 'v', versionNumber: '0.1' }]), '0.1');
    assert.strictEqual(auditVersion.versionFor({ contentType: 'lightcourse', snapshot: { revision: 0 } }), 'draft');
    assert.strictEqual(auditVersion.versionFor({ contentType: 'lightcourse', snapshot: {}, timestamp: new Date() }), 'unknown');
  });

  it('detects title, empty/new fields, nested settings, assets and resource reordering without schema lookup', function(done) {
    var before = { title: 'Course', contentTree: { children: [{ _id: 'p', type: 'page', title: 'Page', children: [
      { _id: 'c', type: 'component', body: '', _items: [{ title: 'First' }], _graphic: { src: 'a' } }
    ] }] }, resourceItems: [{ _id: 'r1' }, { _id: 'r2' }],
      helpContent: { popup: { title: '', body: 'Help' }, items: [{ _id: 'h1' }, { _id: 'h2' }] },
      headerData: { iconChoices: { help: 'a' } } };
    var after = JSON.parse(JSON.stringify(before));
    after.title = ''; after.contentTree.children[0].title = 'New page';
    var node = after.contentTree.children[0].children[0];
    node.body = 'New text'; node.instruction = ''; node._items[0].title = 'Edited'; node._graphic.src = 'b';
    after.resourceItems.reverse(); after.headerData.iconChoices.help = 'b';
    after.helpContent.items.reverse(); after.helpContent.popup.body = '';
    versionDiff.diffSnapshots(before, after, { retrieve: function() { assert.fail('Snapshot comparisons must not require installed schemas'); } }, function(error, diff) {
      assert.ifError(error); assert(diff.hasChanges);
      assert.strictEqual(diff.courseFields[0].to, '');
      assert.strictEqual(diff.headerChanges[0].path, 'iconChoices');
      assert.deepStrictEqual(diff.listOrderChanges, ['resourceItems', 'helpContent.items']);
      assert.strictEqual(diff.helpContent.changed[0].fieldChanges[0].to, '');
      assert.strictEqual(diff.contentTree.changed[0].fieldChanges[0].path, 'title');
      assert.strictEqual(diff.contentTree.changed[1].fieldChanges.length, 4);
      versionDiff.diffSnapshots(before, before, {}, function(error, same) {
        assert.ifError(error); assert.strictEqual(same.hasChanges, false); done();
      });
    });
  });
});

describe('version-filtered audit endpoint (isolated)', function() {
  function harness() {
    var app = new EventEmitter(), routes = {}, queries = [], hooks = {};
    function ContentPlugin() {}
    function ContentPermissionError(message) { this.message = message; }
    var logs = [
      { contentType: 'lightcourse', snapshot: { currentVersionNumber: '1.0' } },
      { contentType: 'lightcourseversion', snapshot: { versionNumber: '1.0' } },
      { contentType: 'lightcourseexport', snapshot: { _versionId: 'v', renderedText: 'binary' } },
      { contentType: 'lightcourse', snapshot: { revision: 0 } },
      { contentType: 'lightcourse', snapshot: {} }
    ];
    var typedId = { toString: function() { return 'c'; } };
    app.contentmanager = {
      addContentHook: function(action, type, options, hook) { hooks[action + options.when] = hook; },
      retrieve: function(type, query, options, next) {
        queries.push({ type: type, query: query });
        if (app.fail === type) return next(app.error || new Error('Unavailable'));
        next(null, type === 'lightcourse' ? (app.missing ? [] : [{ _id: typedId }]) :
          type === 'lightcourseversion' ? [{ _id: 'v', versionNumber: '0.1' }] : logs);
      }
    };
    var file = path.join(ROOT, 'plugins/content/auditlog/index.js'), nativeRequire = createRequire(file);
    var mocks = {
      '../../../': function() { return app; },
      '../../../lib/contentmanager': { ContentPlugin: ContentPlugin, errors: { ContentPermissionError: ContentPermissionError } },
      '../../../lib/usermanager': { getCurrentUser: function() { return { tenant: { _id: 'tenant' } }; } },
      '../../../lib/permissions': { ignoreRoute: function() {} },
      '../../../lib/rest': { get: function(route, callback) { routes[route] = callback; } }
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      exports: {}, module: { exports: {} }, require: function(name) { return mocks[name] || nativeRequire(name); }
    });
    app.emit('serverStarted');
    function request(version) {
      var result;
      routes['/auditlog/content/:contentType/:contentId']({ params: { contentType: 'lightcourse', contentId: 'c' }, query: { version: version } },
        { status: function(code) { this.code = code; return this; }, json: function(body) { result = { code: this.code, body: body }; } });
      return result;
    }
    return { app: app, request: request, queries: queries, logs: logs, PermissionError: ContentPermissionError, typedId: typedId };
  }

  it('aggregates version/export events, filters server-side and omits export payloads without mutating storage', function() {
    var h = harness();
    assert.strictEqual(h.request('1.0').body.length, 2);
    var exported = h.request('0.1').body;
    assert.strictEqual(exported.length, 1); assert.strictEqual(exported[0].snapshot.renderedText, undefined);
    assert.strictEqual(h.logs[2].snapshot.renderedText, 'binary');
    assert.strictEqual(h.request('draft').body.length, 1);
    assert.strictEqual(h.request('unknown').body.length, 1);
    assert.strictEqual(h.request('all').body.length, 5);
    var query = h.queries.find(function(query) { return query.type === 'auditlog'; }).query;
    assert.strictEqual(query._tenantId, 'tenant');
    assert.deepStrictEqual(Array.from(query.contentType.$in), ['lightcourse', 'lightcourseversion', 'lightcourseexport']);
    assert.strictEqual(query.$or[2]['snapshot._lightCourseId'].$in[0], h.typedId);
    assert.strictEqual(query.$or[2]['snapshot._lightCourseId'].$in[1], 'c');
  });

  it('validates filters and course access before reading logs and reports retrieval failures', function() {
    var h = harness();
    assert.strictEqual(h.request('bad').code, 400); assert.strictEqual(h.queries.length, 0);
    h.app.fail = 'lightcourse'; h.app.error = new h.PermissionError('Denied');
    assert.strictEqual(h.request('all').code, 403); assert.strictEqual(h.queries.length, 1);
    h.app.error = new Error('Unavailable'); assert.strictEqual(h.request('all').code, 500);
    h.app.fail = null; h.app.missing = true; assert.strictEqual(h.request('all').code, 404);
    h.app.missing = false;
    ['lightcourseversion', 'auditlog'].forEach(function(type) {
      h.app.fail = type; assert.strictEqual(h.request('all').code, 500);
    });
  });
});
