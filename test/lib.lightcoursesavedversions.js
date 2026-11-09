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
