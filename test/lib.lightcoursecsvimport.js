var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var createRequire = require('module').createRequire;
var ROOT = path.join(__dirname, '..');

function load(file, mocks, globals) {
  var filename = path.join(ROOT, file), module = { exports: {} }, nativeRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), Object.assign({
    module: module, exports: module.exports,
    require: function(name) { return Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : nativeRequire(name); }
  }, globals), { filename: filename });
  return module.exports;
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
var helpers = load('lib/helpers.js', {
  './configuration': {}, './database': {}, './logger': {}, './permissions': {}, './rolemanager': {}
});
var csv = load('lib/extensionCsv.js', { './helpers': helpers });

function routeHarness(options) {
  options = options || {};
  var state = { parsed: false, removed: false };
  var course = { _id: 'course', pluginSelections: { extensions: ['glossary', 'resources'] } };
  if (options.disabled) course.pluginSelections.extensions = [];
  var plugin = { hasPermission: function(action, id, tenant, draft, next) {
    assert.strictEqual(action, 'update');
    next(null, !options.denied);
  } };
  var handler = load('lib/lightcourse/dataImport.js', {
    fs: {
      readFile: function(file, encoding, next) { next(options.readError ? new Error('read') : null, options.csv || 'term,description\nTerm,Definition'); },
      unlink: function(file, next) { state.removed = true; next(null); }
    },
    formidable: { IncomingForm: function() {
      this.parse = function(req, next) {
        state.parsed = true;
        next(null, {}, options.noFile ? {} : { file: { path: 'temporary-upload' } });
      };
    } },
    '../database': { getDatabase: function(next, tenant) {
      assert.strictEqual(tenant, 'tenant');
      next(null, { retrieve: function(type, query, options, callback) { callback(null, [course]); } });
    } },
    '../usermanager': { getCurrentUser: function() { return options.loggedOut ? null : { _id: 'editor', tenant: { _id: 'tenant' } }; } },
    '../configuration': { getMaxFileUploadSize: function() { return 100000; } },
    '../logger': { log: function() {} }, '../extensionCsv': csv
  });
  var res = {
    status: function(status) { state.status = status; return this; },
    set: function(headers) { state.headers = headers; return this; },
    json: function(body) { state.body = copy(body); },
    send: function(body) { state.body = body; }
  };
  handler(plugin, options.template)({ params: { id: 'course', extension: options.extension || 'glossary' } }, res);
  return state;
}

function viewHarness(options) {
  options = options || {};
  var definition, state = { saved: 0, renders: 0, html: '', fieldAttributes: {}, fieldProperties: {}, alerts: [], forms: [] };
  var extension = options.extension || 'glossary';
  var itemKey = extension === 'glossary' ? 'glossaryItems' : 'resourceItems';
  var attributes = { _id: 'course' };
  attributes[itemKey] = copy(options.items || []);
  var model = {
    id: 'course',
    isLocked: function() { return !!options.locked; },
    get: function(key) { return attributes[key]; },
    set: function(key, value) { attributes[key] = value; }
  };
  var chain = {
    0: { files: ['file'] },
    prop: function(key, value) { state.fieldProperties[key] = value; return this; }, text: function() { return this; },
    attr: function(key, value) { state.fieldAttributes[key] = value; return this; },
    each: function(callback) { state.readonlyUpdated = true; attributes[itemKey].forEach(function(item, index) { callback.call({}, index); }); return this; },
    closest: function() { return this; },
    data: function(key) { return key === 'index' ? 0 : state.fieldKey || '_id'; },
    is: function() { return !!options.focused; },
    toggleClass: function() { return this; },
    html: function(html) { state.html = html; return this; },
    append: function(html) { state.html += html; return this; },
    ajaxSubmit: function(settings) { state.request = settings; },
    val: function(value) { if (arguments.length) { state.fieldValue = value; return this; } return state.inputValue === undefined ? 'replace' : state.inputValue; }
  };
  var Origin = {
    l10n: { t: function(key, params) { return key + (params ? JSON.stringify(params) : ''); } },
    Notify: {
      confirm: function(settings) { state.confirmation = settings; },
      alert: function(settings) { state.alerts.push(settings); }
    },
    trigger: function(event, callback) { view.saveImport(callback || function() {}); }
  };
  load('frontend/src/modules/lightCourseEditor/views/lightCourseItemListView.js', {}, {
    define: function(factory) {
      factory(function(name) {
        if (name === 'core/origin') return Origin;
        if (name === '../alphabetical') return require('../frontend/src/modules/lightCourseEditor/alphabetical');
        return { extend: function(value) { definition = value; }, prototype: { remove: function() {} } };
      });
    },
    $: function() { return chain; }, Set: Set,
    Backbone: { Form: function(settings) {
      this.schema = settings.schema;
      this.values = copy(settings.data);
      this.render = function() { return this; };
      this.getValue = function() { return this.values; };
      this.remove = function() { this.removed = true; };
      state.forms.push(this);
    } }
  });
  var view = Object.assign({}, definition, {
    $: function(selector) { state.selector = selector; return chain; }, $el: chain,
    listenTo: function(form, event, callback) { form.changed = callback; },
    stopListening: function(form) { delete form.changed; },
    renderItems: function() { state.renders++; },
    importFeedback: function(message, error) { state.message = message; state.error = error; }
  });
  view.preRender({
    items: attributes[itemKey], fields: [], isEnabled: !options.disabled,
    importExtension: extension, courseModel: model,
    saveImport: function(next) {
      state.saved++;
      if (options.saveError === state.saved) return next(new Error('Conflict'));
      attributes[itemKey] = copy(view.items).map(function(item, index) {
        if (!item._id) item._id = 'generated-' + index;
        return item;
      });
      next();
    }
  });
  state.view = view;
  state.definition = definition;
  state.attributes = attributes;
  return state;
}

function configuredListFields(extension) {
  var editor, fields;
  load('frontend/src/modules/lightCourseEditor/views/lightCourseEditorView.js', {}, {
    define: function(factory) {
      factory(function(name) {
        if (name === 'core/origin') return { l10n: { t: function(key) { return key; } } };
        if (name === 'core/views/originView') return { extend: function(value) { editor = value; } };
        return function(options) {
          if (options && options.importExtension === extension) fields = options.fields;
        };
      });
    }
  });
  editor.renderGlossaryResourcesHelp.call({
    model: { get: function() { return []; } },
    autosave: function() {},
    isExtensionSelected: function() { return true; },
    $: function() { return { empty: function() { return this; }, append: function() { return this; } }; }
  });
  return fields;
}

describe('Shared extension CSV mapping', function() {
  it('preserves rich glossary HTML with quoted attributes, commas and line breaks alongside plain descriptions', function() {
    var html = '<p>A <strong>formatted, definition</strong>.</p>\n<p><a href="https://example.com">Read more</a></p>';
    var result = csv.parse('glossary', 'term,description\nRich,"' + html.replace(/"/g, '""') +
      '"\nPlain,Plain definition');
    assert.deepStrictEqual(copy(result.items), [
      { term: 'Rich', description: html }, { term: 'Plain', description: 'Plain definition' }
    ]);
    assert.deepStrictEqual(copy(result.errors), []);
  });
  it('handles BOM, quoted commas, newlines and skipped incomplete rows', function() {
    var result = csv.parse('glossary', '\uFEFFterm,description\r\n"One, two","Line one\nLine two"\r\nMissing,\r\n');
    assert.deepStrictEqual(copy(result.items), [{ term: 'One, two', description: 'Line one\nLine two' }]);
    assert.strictEqual(result.errors[0].row, 3);
  });
  it('preserves resource IDs, filenames and boolean semantics used by Full Course', function() {
    var result = csv.parse('resources', '_type,title,filename,_isGlobal,_forceDownload,_id\nlink,Example,file.pdf,yes,0,my-id');
    assert.deepStrictEqual(copy(result.items[0]), {
      _type: 'link', title: 'Example', description: '', _link: '', filename: 'file.pdf',
      _isGlobal: true, _forceDownload: false, _id: 'my-id'
    });
  });
  it('leaves absent resource IDs for normal save to assign', function() {
    assert.strictEqual(csv.parse('resources', '_type\nmedia').items[0]._id, undefined);
  });
});

describe('Light Course CSV parse routes', function() {
  it('returns rows without writing the course and removes the upload', function() {
    var result = routeHarness();
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.items[0].term, 'Term');
    assert.strictEqual(result.removed, true);
  });
  it('reports skipped rows', function() {
    var result = routeHarness({ csv: 'term,description\nGood,Definition\nBad,' });
    assert.strictEqual(result.body.skipped, 1);
    assert.strictEqual(result.body.errors[0].row, 3);
  });
  it('rejects empty or invalid CSV without changing the course', function() {
    assert.strictEqual(routeHarness({ csv: 'term,description\nBad,' }).status, 400);
    assert.strictEqual(routeHarness({ csv: 'wrong,headers\nBad,Data' }).status, 400);
  });
  it('rejects missing uploads and read failures', function() {
    assert.strictEqual(routeHarness({ noFile: true }).status, 400);
    var failed = routeHarness({ readError: true });
    assert.strictEqual(failed.status, 500);
    assert.strictEqual(failed.removed, true);
  });
  it('requires authentication and update permission before parsing', function() {
    assert.strictEqual(routeHarness({ loggedOut: true }).status, 401);
    var denied = routeHarness({ denied: true });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.parsed, false);
  });
  it('requires the selected extension and rejects unsupported imports', function() {
    assert.strictEqual(routeHarness({ disabled: true }).status, 400);
    assert.strictEqual(routeHarness({ extension: 'help' }).status, 400);
    assert.strictEqual(routeHarness({ extension: 'toString' }).status, 400);
  });
  ['glossary', 'resources'].forEach(function(extension) {
    it('serves a usable ' + extension + ' template under Light Editor permissions', function() {
      var result = routeHarness({ template: true, extension: extension });
      assert.strictEqual(result.status, 200);
      assert.strictEqual(csv.parse(extension, result.body).items.length, 1);
      assert.ok(result.headers['Content-Disposition'].includes(extension + '-import-template.csv'));
    });
  });
});

describe('Light Course CSV editor integration', function() {
  it('renders glossary descriptions using the shared rich-text editor and saves without rebuilding it', function() {
    var html = '<p>Definition with <strong>formatting</strong>.</p>';
    var state = viewHarness({ items: [{ _id: 'g1', term: 'Term', description: html }] });
    state.view.fields = configuredListFields('glossary');
    state.view.renderRow(state.view.items[0], 0);
    var form = state.forms[0];
    assert.strictEqual(form.schema.description.type, 'TextArea');
    assert.strictEqual(form.values.description, html);
    form.values.description = '<p>Edited <em>definition</em>.</p>';
    form.changed();
    assert.strictEqual(state.attributes.glossaryItems[0].description, form.values.description);
    assert.strictEqual(state.saved, 1);
    assert.strictEqual(state.renders, 0);
    assert.strictEqual(form.removed, undefined);
  });
  it('flushes toolbar edits on leaving the rich-text editor and preserves focused edits across server ID refreshes', function() {
    var state = viewHarness({ items: [{ _id: 'g1', term: 'Term', description: 'Definition' }] });
    state.view.fields = configuredListFields('glossary');
    state.view.renderRow(state.view.items[0], 0);
    var form = state.forms[0];
    state.view.onAddClicked();
    form.values.description = '<p><strong>Toolbar formatting</strong></p>';
    state.view.onRichTextBlur({ relatedTarget: {}, currentTarget: { contains: function() { return true; } } });
    assert.strictEqual(state.saved, 1);
    state.view.onRichTextBlur({ relatedTarget: null });
    assert.strictEqual(state.saved, 2);
    assert.strictEqual(state.attributes.glossaryItems[0].description, form.values.description);
    form.values.description = '<p>Unblurred text</p>';
    assert.strictEqual(state.view.getItems()[0].description, '<p>Unblurred text</p>');
  });
  it('rebuilds imported rich descriptions and removes old editors without overwriting replacement content', function() {
    var state = viewHarness({ items: [{ _id: 'g1', term: 'Term', description: 'Old' }] });
    state.view.fields = configuredListFields('glossary');
    state.definition.renderItems.call(state.view);
    var old = state.forms[0];
    var imported = { _id: 'g2', term: 'Imported', description: '<p>CSV <strong>definition</strong></p>' };
    state.view.items.splice(0, 1, imported);
    state.definition.renderItems.call(state.view);
    assert.strictEqual(old.removed, true);
    assert.strictEqual(state.forms[1].values.description, imported.description);
    state.view.remove();
    assert.strictEqual(state.forms[1].removed, true);
  });
  it('does not create editable rich-text forms on locked courses', function() {
    var state = viewHarness({ locked: true, items: [{ _id: 'g1', term: 'Term', description: '<p>Definition</p>' }] });
    state.view.fields = configuredListFields('glossary').filter(function(field) { return field.key === 'description'; });
    state.view.renderRow(state.view.items[0], 0);
    assert.strictEqual(state.forms.length, 0);
    assert.strictEqual(state.fieldProperties.readOnly, true);
  });
  it('sorts glossary entries by term and resource entries by title while retaining IDs and editable row indices', function() {
    ['glossary', 'resources'].forEach(function(extension) {
      var key = extension === 'glossary' ? 'term' : 'title';
      var z = { _id: 'z' }, a = { _id: 'a' };
      z[key] = 'Zebra';
      a[key] = 'alpha';
      var state = viewHarness({ extension: extension, items: [z, a] });
      var rows = [];
      state.view.renderRow = function(item, index) { rows.push([item._id, index]); return ''; };
      state.definition.renderItems.call(state.view);
      assert.deepStrictEqual(rows, [['a', 0], ['z', 1]]);
      assert.deepStrictEqual(state.view.getItems().map(function(item) { return item._id; }), ['a', 'z']);
    });
  });
  it('wires the resource Unique ID as an editable field in the shared editor', function() {
    var state = viewHarness({ extension: 'resources' });
    state.view.fields = configuredListFields('resources').filter(function(field) { return field.key === '_id'; });
    state.view.renderRow({ _id: 'r01' }, 0);
    assert.strictEqual(state.fieldValue, 'r01');
    assert.strictEqual(state.fieldProperties.readOnly, undefined);
    assert.strictEqual(state.fieldAttributes['data-item-readonly-field'], undefined);
    assert.strictEqual(state.fieldAttributes['data-item-field'], '_id');
    assert.strictEqual(state.fieldAttributes['aria-label'], 'app.lightcoursefielduniqueid');
  });
  it('saves an edited resource ID and warns that existing references need manual updates', function() {
    var state = viewHarness({ extension: 'resources', items: [{ _id: 'r01', title: 'Document' }] });
    state.inputValue = ' custom-resource ';
    state.view.onFieldChanged({ currentTarget: {} });
    assert.strictEqual(state.view.items[0]._id, 'custom-resource');
    assert.strictEqual(state.attributes.resourceItems[0]._id, 'custom-resource');
    assert.strictEqual(state.saved, 1);
    assert.strictEqual(state.alerts[0].type, 'warning');
    assert(state.alerts[0].text.includes('app.lightcourseresourceidwarning'));
    assert(state.alerts[0].text.includes('"previousId":"r01"'));
    assert(state.alerts[0].text.includes('"newId":"custom-resource"'));
  });
  it('rejects blank and duplicate resource IDs without saving or changing the existing ID', function() {
    ['', '   ', 'r02'].forEach(function(value) {
      var state = viewHarness({ extension: 'resources', items: [{ _id: 'r01' }, { _id: 'r02' }] });
      state.inputValue = value;
      state.view.onFieldChanged({ currentTarget: {} });
      assert.strictEqual(state.saved, 0);
      assert.strictEqual(state.view.items[0]._id, 'r01');
      assert.strictEqual(state.fieldValue, 'r01');
      assert.strictEqual(state.alerts[0].type, 'error');
    });
  });
  it('does not save or warn when the resource ID is unchanged', function() {
    var state = viewHarness({ extension: 'resources', items: [{ _id: 'r01' }] });
    state.inputValue = ' r01 ';
    state.view.onFieldChanged({ currentTarget: {} });
    assert.strictEqual(state.saved, 0);
    assert.strictEqual(state.alerts.length, 0);
    assert.strictEqual(state.fieldValue, 'r01');
  });
  it('keeps ordinary resource edits unchanged without an ID warning', function() {
    var state = viewHarness({ extension: 'resources', items: [{ _id: 'r01', title: 'Document' }] });
    state.fieldKey = 'title';
    state.inputValue = 'New title';
    state.view.onFieldChanged({ currentTarget: {} });
    assert.strictEqual(state.attributes.resourceItems[0].title, 'New title');
    assert.strictEqual(state.saved, 1);
    assert.strictEqual(state.alerts.length, 0);
  });
  it('shows the server-generated ID after adding and saving a new resource', function() {
    var state = viewHarness({ extension: 'resources' });
    state.view.onAddClicked({ preventDefault: function() {} });
    assert.strictEqual(state.saved, 1);
    assert.strictEqual(state.view.items[0]._id, 'generated-0');
    assert(state.selector.includes('[data-item-field="_id"]'));
    assert.strictEqual(state.readonlyUpdated, true);
    assert.strictEqual(state.fieldValue, 'generated-0');
  });
  it('does not overwrite an ID being typed while a new resource saves', function() {
    var state = viewHarness({ extension: 'resources', focused: true });
    state.view.onAddClicked({ preventDefault: function() {} });
    assert.strictEqual(state.view.items[0]._id, 'generated-0');
    assert.strictEqual(state.fieldValue, undefined);
  });
  it('appends, retains unsaved entries and picks up server-assigned IDs', function() {
    var state = viewHarness({ items: [{ term: 'Existing', description: 'Keep' }] });
    var original = state.view.items;
    state.view.performImport('append');
    state.request.success({ items: [{ term: 'New', description: 'Added' }], skipped: 0 });
    assert.strictEqual(state.saved, 2);
    assert.strictEqual(state.view.items, original);
    assert.strictEqual(original.length, 2);
    assert.strictEqual(original[0]._id, 'generated-0');
    assert.strictEqual(original[1]._id, 'generated-1');
    assert.strictEqual(state.error, false);
  });
  it('replaces only after destructive confirmation', function() {
    var state = viewHarness({ items: [{ _id: 'old', term: 'Old' }] });
    state.view.onImportClicked({ preventDefault: function() {} });
    assert.strictEqual(state.confirmation.destructive, true);
    assert.strictEqual(state.saved, 0);
    state.confirmation.callback(true);
    state.request.success({ items: [{ term: 'New', description: 'Definition' }], skipped: 0 });
    assert.strictEqual(state.view.items.length, 1);
    assert.strictEqual(state.view.items[0].term, 'New');
  });
  it('imports all resource fields into the resource list without touching glossary items', function() {
    var state = viewHarness({ extension: 'resources' });
    state.view.renderImport();
    assert.ok(state.html.includes('/data-import/resources/template'));
    var resource = csv.parse('resources', '_type,title,filename,_isGlobal,_forceDownload,_id\nlink,Example,file.pdf,yes,1,my-id').items[0];
    state.view.performImport('replace');
    state.request.success({ items: [resource], skipped: 0 });
    assert.deepStrictEqual(copy(state.attributes.resourceItems), [copy(resource)]);
    assert.strictEqual(state.attributes.glossaryItems, undefined);
  });
  it('rejects collisions with existing or repeated resource IDs', function() {
    [{ items: [{ _id: 'same' }], incoming: [{ _id: 'same' }] },
      { items: [], incoming: [{ _id: 'same' }, { _id: 'same' }] }].forEach(function(example) {
      var state = viewHarness({ extension: 'resources', items: example.items });
      state.view.performImport('append');
      state.request.success({ items: example.incoming });
      assert.strictEqual(state.saved, 1);
      assert.strictEqual(state.error, true);
      assert.strictEqual(state.view.items.length, example.items.length);
    });
  });
  it('reports save conflicts and does not claim success', function() {
    var state = viewHarness({ saveError: 2 });
    state.view.performImport('append');
    state.request.success({ items: [{ term: 'New', description: 'Definition' }] });
    assert.strictEqual(state.error, true);
    assert.ok(state.message.includes('savefailed'));
    assert.strictEqual(state.view.items.length, 1);
  });
  it('does not upload when saving the current edits fails', function() {
    var state = viewHarness({ saveError: 1 });
    state.view.performImport('append');
    assert.strictEqual(state.request, undefined);
    assert.strictEqual(state.error, true);
  });
  it('reports server errors and skipped row details', function() {
    var state = viewHarness();
    state.view.performImport('append');
    state.request.error({ responseJSON: { message: 'No valid rows', errors: [{ row: 2, message: 'Missing term' }] } });
    assert.ok(state.message.includes('2: Missing term'));
    state.view.performImport('append');
    state.request.success({ items: [{ term: 'Good', description: 'Valid' }], skipped: 1, errors: [{ row: 3, message: 'Missing term' }] });
    assert.ok(state.message.includes('3: Missing term'));
  });
  it('hides controls for disabled extensions and converted courses', function() {
    var disabled = viewHarness({ disabled: true });
    disabled.definition.renderItems.call(disabled.view);
    assert.ok(!disabled.html.includes('light-course-csv'));
    var locked = viewHarness({ locked: true });
    locked.definition.renderItems.call(locked.view);
    assert.ok(!locked.html.includes('light-course-csv'));
    locked.view.onImportClicked({ preventDefault: function() {} });
    assert.strictEqual(locked.confirmation, undefined);
  });
  it('renders Light Course template URLs and ignores responses after disposal', function() {
    var state = viewHarness();
    state.view.renderImport();
    assert.ok(state.html.includes('api/content/lightcourse/course/data-import/glossary/template'));
    state.view.performImport('append');
    state.view.remove();
    state.request.success({ items: [{ term: 'Ignored' }] });
    assert.strictEqual(state.view.items.length, 0);
    assert.strictEqual(state.saved, 1);
  });
});
