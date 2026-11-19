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
  var definition, state = { saved: 0, renders: 0, html: '', fieldAttributes: {}, fieldProperties: {} };
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
    toggleClass: function() { return this; },
    html: function(html) { state.html = html; return this; },
    append: function(html) { state.html += html; return this; },
    ajaxSubmit: function(settings) { state.request = settings; },
    val: function(value) { if (arguments.length) { state.fieldValue = value; return this; } return 'replace'; }
  };
  var Origin = {
    l10n: { t: function(key, params) { return key + (params ? JSON.stringify(params) : ''); } },
    Notify: { confirm: function(settings) { state.confirmation = settings; } },
    trigger: function(event, callback) { view.saveImport(callback); }
  };
  load('frontend/src/modules/lightCourseEditor/views/lightCourseItemListView.js', {}, {
    define: function(factory) {
      factory(function(name) {
        if (name === 'core/origin') return Origin;
        return { extend: function(value) { definition = value; }, prototype: { remove: function() {} } };
      });
    },
    $: function() { return chain; }, Set: Set
  });
  var view = Object.assign({}, definition, {
    $: function() { return chain; }, $el: chain,
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

describe('Shared extension CSV mapping', function() {
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
  it('displays resource IDs in copyable read-only fields outside change handlers', function() {
    var state = viewHarness({ extension: 'resources' });
    state.view.fields = [{ key: '_id', label: 'Unique ID', type: 'text', readOnly: true }];
    state.view.renderRow({ _id: 'r01' }, 0);
    assert.strictEqual(state.fieldValue, 'r01');
    assert.strictEqual(state.fieldProperties.readOnly, true);
    assert.strictEqual(state.fieldAttributes['data-item-readonly-field'], '_id');
    assert.strictEqual(state.fieldAttributes['data-item-field'], undefined);
    assert.strictEqual(state.fieldAttributes['aria-label'], 'Unique ID');
  });
  it('shows the server-generated ID after adding and saving a new resource', function() {
    var state = viewHarness({ extension: 'resources' });
    state.view.onAddClicked({ preventDefault: function() {} });
    assert.strictEqual(state.saved, 1);
    assert.strictEqual(state.view.items[0]._id, 'generated-0');
    assert.strictEqual(state.readonlyUpdated, true);
    assert.strictEqual(state.fieldValue, 'generated-0');
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
