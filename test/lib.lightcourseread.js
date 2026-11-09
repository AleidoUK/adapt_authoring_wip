var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var unzipper = require('unzipper');
var Handlebars = require('handlebars');
var generator = require('../lib/lightcourse/documentGenerator');
var filestorage = require('../lib/filestorage');

var assetId = '1234567890abcdef12345678';
var string = { type: 'string', translatable: true };
var graphic = { type: 'object', properties: {
  src: { type: 'string', inputType: 'Asset:image' }, alt: string
} };
var properties = {
  instruction: string, _graphic: graphic,
  _ariaLabels: { type: 'object', properties: { title: string } },
  _feedback: { type: 'object', properties: { _isEnabled: { type: 'boolean', default: false }, body: string, _graphic: graphic } },
  _items: { type: 'array', items: { type: 'object', properties: {
    title: string, displayTitle: string, body: string, instruction: string, _graphic: graphic,
    _subitems: { type: 'array', items: { type: 'object', properties: { title: string, body: string, _graphic: graphic } } }
  } } }
};
function fixture() {
  return {
    title: 'Reading course', body: '<p>Welcome &amp; enjoy.</p>',
    pluginSelections: { extensions: ['glossary', 'resources', 'help'] },
    headerData: { reviewingInstructions: 'Reviewer-only instructions' },
    contentTree: { children: [{ _id: 'page', title: 'Page heading', body: 'Page introduction', children: [
      { _id: 'article', title: 'Editorial article', children: [{ _id: 'block', title: 'Editorial block', children: [
        { _id: 'component', _component: 'text', title: 'Component heading', body: '<p>First paragraph.</p><p>Second paragraph.</p>',
          instruction: 'Learner instructions', uniqueId: 'Hidden unique ID',
          graphicsNotes: 'Graphics-only notes', developerNotes: 'Developer-only notes',
          _comments: [{ text: 'Private discussion' }], _ariaLabels: { title: 'Accessibility-only label' },
          _feedback: { body: 'Disabled feedback', _graphic: { src: assetId } },
          _items: [{ title: 'Item heading', body: 'Item content', instruction: 'Item instruction' },
            { title: '', body: '<p>&nbsp;</p>' }] }
      ] }] }
    ] }] },
    glossaryItems: [{ term: 'Glossary term', description: 'Glossary description' }],
    resourceItems: [{ title: 'Resource heading', description: 'Resource content', _link: 'https://example.com/resource' }],
    helpContent: { popup: { title: 'Help heading', body: 'Help content', instruction: 'Help instruction' },
      items: [{ title: 'Help item', body: 'Help item content' }] }
  };
}
function component(data) { return data.contentTree.children[0].children[0].children[0].children[0]; }
function database() {
  return { queries: [], retrieve: function(type, query, options, callback) {
    this.queries.push(type);
    if (type === 'componenttype') return callback(null, [{ displayName: 'Text component', properties: properties }]);
    assert.strictEqual(type, 'lightcourseasset');
    callback(null, [{ mimeType: 'image/bmp', repository: 'test', path: 'image.bmp' }]);
  } };
}
function read(data, options, db, word) {
  return new Promise(function(resolve, reject) {
    generator[word ? 'generateReadDocx' : 'generateRead'](data, db || database(), function(error, output) {
      if (error) reject(error); else resolve(output);
    }, options);
  });
}
async function part(buffer, name) {
  var zip = await unzipper.Open.buffer(buffer);
  var file = zip.files.find(function(entry) { return entry.path === name; });
  return file ? (await file.buffer()).toString() : '';
}

describe('Light course reading content', function() {
  it('places the component display type before its title, including untitled components', async function() {
    var data = fixture(), content = await read(data);
    var index = content.entries.findIndex(function(entry) { return entry.type === 'componentType'; });
    assert.deepStrictEqual(content.entries[index], { type: 'componentType', text: 'Text component' });
    assert.strictEqual(content.entries[index + 1].text, 'Component heading');
    component(data).title = '';
    content = await read(data);
    index = content.entries.findIndex(function(entry) { return entry.type === 'componentType'; });
    assert.strictEqual(content.entries[index].text, 'Text component');
    assert.strictEqual(content.entries[index + 1].type, 'text');
    var xml = await part(await read(data, {}, null, true), 'word/document.xml');
    assert(!xml.includes('Text component'));
  });

  it('uses learner-facing headings and text without labels or editorial metadata, preserving the snapshot', async function() {
    var data = fixture(), original = JSON.stringify(data);
    var content = await read(data), texts = content.entries.map(function(entry) { return entry.text; });
    assert.strictEqual(content.title, data.title);
    assert(texts.includes('Welcome & enjoy.'));
    assert(texts.includes('First paragraph.\nSecond paragraph.'));
    assert(texts.includes('Learner instructions'));
    assert(texts.includes('Item instruction'));
    assert.deepStrictEqual(content.entries.filter(function(entry) { return entry.type === 'heading'; }).slice(0, 3), [
      { type: 'heading', text: 'Page heading', level: 1 },
      { type: 'heading', text: 'Component heading', level: 2 },
      { type: 'heading', text: 'Item heading', level: 3 }
    ]);
    ['Reviewer-only instructions', 'Editorial article', 'Editorial block', 'Hidden unique ID', 'Graphics-only notes',
      'Developer-only notes', 'Private discussion', 'Accessibility-only label', 'Disabled feedback', '\u00a0'].forEach(function(value) {
      assert(!texts.includes(value), value);
    });
    assert(!content.entries.some(function(entry) { return entry.text === ''; }));
    assert.strictEqual(JSON.stringify(data), original);
  });

  it('includes only enabled glossary, resources and help, including resource targets', async function() {
    var data = fixture(), content = await read(data);
    ['Glossary', 'Glossary term', 'Resource content', 'https://example.com/resource', 'Help instruction', 'Help item content']
      .forEach(function(value) { assert(content.entries.some(function(entry) { return entry.text === value; }), value); });
    data.pluginSelections.extensions = [];
    var disabled = JSON.stringify(await read(data));
    ['Glossary', 'Resource', 'https://example.com', 'Help'].forEach(function(value) { assert(!disabled.includes(value), value); });
    data.pluginSelections.extensions = ['help'];
    data.helpContent.popup.title = '';
    assert(JSON.stringify(await read(data)).includes('Help content'));
  });

  it('honours nested enablement and visible titles without losing learner feedback', async function() {
    var data = fixture(), node = component(data);
    node.displayTitle = 'Visible component title';
    node._items[0].displayTitle = 'Visible item title';
    node._feedback._isEnabled = true;
    node._feedback.body = 'Enabled feedback';
    var content = await read(data), json = JSON.stringify(content);
    assert(json.includes('Enabled feedback'));
    assert(!json.includes('Component heading'));
    assert(!json.includes('Item heading'));
    assert(json.includes('Visible component title'));
    assert(json.includes('Visible item title'));
    node._feedback._isEnabled = false;
    assert(!JSON.stringify(await read(data)).includes('Enabled feedback'));
  });

  it('does not render scripts/styles or require valid links when displaying ordinary text', async function() {
    var data = fixture();
    component(data).body = '<p>Safe <strong>content</strong> &lt;literal&gt;</p><script>hiddenScript()</script><style>hiddenStyle</style>' +
      '<p><a href="tel:+1234">Call us</a> <a href="javascript:alert()">Link text</a></p>';
    var json = JSON.stringify(await read(data));
    assert(json.includes('Safe content <literal>'));
    assert(!json.includes('hiddenScript'));
    assert(!json.includes('hiddenStyle'));
    assert(json.includes('Call us Link text'));
    assert(!json.includes('javascript:'));
  });

  it('does not load or emit any images with the toggle off', async function() {
    var data = fixture(), node = component(data), db = database();
    node.screenshotAssetId = assetId;
    node._graphic = { src: assetId };
    node._items[0]._graphic = { src: assetId };
    node.body += '<p><img src="/api/content/lightcourseasset/' + assetId + '/serve"></p>';
    var content = await read(data, { images: false }, db);
    assert(!content.entries.some(function(entry) { return entry.type === 'image' || entry.type === 'notice'; }));
    assert(!db.queries.includes('lightcourseasset'));
    assert(!(await part(await read(data, { images: false }, db, true), 'word/document.xml')).includes('<w:drawing>'));
  });

  it('shares managed, half-width images with Word, including screenshots, image-only content and item placement', async function() {
    var data = fixture(), node = component(data), db = database(), originalStorage = filestorage.getStorage;
    node.screenshotAssetId = assetId;
    node._items[0]._graphic = { src: assetId, alt: 'Item image' };
    node._items[0]._subitems = [{ title: 'Nested item', body: 'Nested content', _graphic: { src: assetId, alt: 'Nested image' } }];
    node._items.push({ _graphic: { src: assetId, alt: 'Image-only item' } });
    node._items.push({ title: 'Next item', body: 'Next item content' });
    node.body = '<p><img src="/api/content/lightcourseasset/' + assetId + '/serve" alt="Image-only body"></p>';
    var width = 1000, height = 400, stride = width * 3, bmp = Buffer.alloc(54 + stride * height);
    bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(width, 18); bmp.writeInt32LE(height, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
    filestorage.getStorage = function(repository, callback) {
      callback(null, { getFileContents: function(file, callback) { callback(null, bmp); } });
    };
    try {
      var content = await read(data, { images: true, screenshots: true }, db);
      var images = content.entries.filter(function(entry) { return entry.type === 'image'; });
      assert.strictEqual(images.length, 5);
      images.forEach(function(image) {
        assert.strictEqual(image.width, 300);
        assert.strictEqual(image.height, 120);
        assert.strictEqual(image.src, 'data:image/bmp;base64,' + bmp.toString('base64'));
      });
      var firstImage = content.entries.indexOf(images[0]);
      assert.strictEqual(content.entries[firstImage - 1].text, 'Component heading');
      var itemImage = content.entries.indexOf(images.find(function(image) { return image.alt === 'Item image'; }));
      assert.strictEqual(content.entries[itemImage - 1].alt, 'Nested image');
      assert.strictEqual(content.entries[itemImage + 1].alt, 'Image-only item');
      assert.strictEqual(content.entries[itemImage + 2].text, 'Next item');
      assert(content.entries.some(function(entry) { return entry.text === 'Nested item' && entry.level === 4; }));
      var xml = await part(await read(data, { images: true, screenshots: true }, db, true), 'word/document.xml');
      assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, 5);
      assert.strictEqual((xml.match(/<wp:extent cx="2857500" cy="1143000"/g) || []).length, 5);
      assert(!xml.includes('Disabled feedback'));
      for (var settings of [
        { images: false, screenshots: false, count: 0 },
        { images: true, screenshots: false, count: 4 },
        { images: false, screenshots: true, count: 1 }
      ]) {
        var selected = await read(data, settings, db);
        var selectedImages = selected.entries.filter(function(entry) { return entry.type === 'image'; });
        assert.strictEqual(selectedImages.length, settings.count);
        assert.strictEqual(selectedImages.some(function(entry) { return entry.alt === 'Component screenshot'; }), settings.screenshots);
        assert.strictEqual(selectedImages.some(function(entry) { return entry.alt === 'Item image'; }), settings.images);
        var selectedXml = await part(await read(data, settings, db, true), 'word/document.xml');
        assert.strictEqual((selectedXml.match(/<w:drawing>/g) || []).length, settings.count);
        assert.strictEqual(selectedXml.includes('descr="Component screenshot"'), settings.screenshots);
      }
    } finally { filestorage.getStorage = originalStorage; }
  });

  it('makes unavailable image errors visible without fetching arbitrary URLs', async function() {
    var data = fixture(), db = database();
    component(data)._graphic = { src: 'https://example.com/unsafe.png' };
    var content = await read(data, { images: true }, db);
    assert(content.entries.some(function(entry) { return entry.type === 'notice' && /not a managed/.test(entry.text); }));
    assert(!db.queries.includes('lightcourseasset'));
  });

  it('creates a separate content-only Word document, with bold hierarchy and no import mappings or comments', async function() {
    var data = fixture(), buffer = await read(data, {}, null, true);
    var xml = await part(buffer, 'word/document.xml'), styles = await part(buffer, 'word/styles.xml');
    assert(/w:pStyle w:val="Heading2"/.test(xml));
    assert(/w:pStyle w:val="Heading3"/.test(xml));
    assert(xml.includes('Component heading'));
    assert(xml.includes('<w:b/>'));
    assert(styles.includes('<w:sz w:val="36"/>'));
    ['bookmarkStart', 'commentReference', 'uniqueId', 'graphicsNotes', 'developerNotes', 'Word count', 'Draft (unpublished)']
      .forEach(function(value) { assert(!xml.includes(value), value); });
    assert(!(await part(buffer, 'docProps/custom.xml')).includes('LightCourse'));
    var parsed = await new Promise(function(resolve, reject) {
      generator.parseDocx(buffer, function(error, result) { if (error) reject(error); else resolve(result); });
    });
    assert(parsed.errors.length > 0);
  });

  it('propagates schema lookup failures instead of returning incomplete content', async function() {
    await assert.rejects(read(fixture(), {}, { retrieve: function(type, query, options, callback) {
      callback(new Error('Schema unavailable'));
    } }), /Schema unavailable/);
  });
});

function routeHarness(settings) {
  settings = settings || {};
  var state = { exports: [], routes: {}, headers: {}, lookups: 0 };
  var record = Object.assign(fixture(), { _id: 'course', revision: 3 });
  if (settings.screenshot) component(record).screenshotAssetId = 'unmanaged-screenshot';
  var db = database(), retrieve = db.retrieve;
  db.retrieve = function(type, query, options, callback) {
    if (type === 'lightcourse') return callback(settings.dbError, settings.missing ? [] : [record]);
    if (type === 'lightcourseversion') return callback(null, []);
    retrieve.call(db, type, query, options, callback);
  };
  var mocks = {
    express: function() { return { get: function(pattern, callback) { state.routes[pattern] = callback; } }; },
    '../../lib/database': { getDatabase: function(callback, tenant) {
      assert.strictEqual(tenant, 'tenant'); state.lookups++; callback(null, db);
    } },
    '../../lib/permissions': { ignoreRoute: function() {} },
    '../../lib/usermanager': { getCurrentUser: function() {
      return settings.noUser ? null : { _id: 'user', tenant: { _id: settings.otherTenant ? 'other' : 'tenant' } };
    } },
    '../../lib/logger': { log: function() {} },
    '../../': function() { return { contentmanager: {
      getContentPlugin: function(type, callback) { callback(null, {
        hasPermission: function(action, user, tenant, source, next) {
          assert.strictEqual(action, 'retrieve'); assert.strictEqual(source._id, 'course');
          next(settings.permissionError, !settings.denied);
        }
      }); },
      create: function(type, value, callback) {
        assert.strictEqual(type, 'lightcourseexport'); state.exports.push(value); callback(settings.persistError);
      }
    } }; },
    '../../lib/lightcourse/documentGenerator': generator,
    '../../lib/storyboard': {}, '../../lib/configuration': {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/document-export/index.js'), 'utf8'), {
    module: { exports: {} }, require: function(name) { assert(name in mocks, name); return mocks[name]; }
  });
  state.request = function(query) {
    return new Promise(function(resolve) {
      var status = 200;
      state.routes['/document-export/:tenant/:id/read']({ params: { tenant: 'tenant', id: 'course' }, query: query || {} }, {
        status: function(value) { status = value; return this; },
        setHeader: function(key, value) { state.headers[key] = value; },
        json: function(body) { resolve({ status: status, body: body }); },
        send: function(body) { resolve({ status: status, body: body }); }
      });
    });
  };
  return state;
}

describe('Authorized Read endpoints', function() {
  it('passes the independent screenshot setting through preview and Word export', async function() {
    var state = routeHarness({ screenshot: true });
    for (var screenshots of ['false', 'true']) {
      var preview = await state.request({ images: 'false', screenshots: screenshots });
      assert.strictEqual(preview.status, 200);
      assert.strictEqual(preview.body.entries.some(function(entry) { return entry.type === 'notice'; }), screenshots === 'true');
      var word = await state.request({ format: 'docx', images: 'false', screenshots: screenshots });
      assert.strictEqual(word.status, 200);
      assert.strictEqual((await part(word.body, 'word/document.xml')).includes('Image unavailable:'), screenshots === 'true');
    }
  });

  it('returns an uncached JSON preview without persisting an export', async function() {
    var state = routeHarness(), response = await state.request({ format: 'json', images: 'false', revision: '3' });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.title, 'Reading course');
    assert.strictEqual(state.headers['Cache-Control'], 'no-store');
    assert.strictEqual(state.exports.length, 0);
  });

  it('persists and downloads the separate content-only Word export', async function() {
    var state = routeHarness(), response = await state.request({ format: 'docx', images: 'false', revision: '3' });
    assert.strictEqual(response.status, 200);
    assert(Buffer.isBuffer(response.body));
    assert(state.headers['Content-Disposition'].includes('_read.docx'));
    assert.strictEqual(state.exports.length, 1);
    assert.strictEqual(state.exports[0].renderedText, response.body.toString('base64'));
  });

  it('rejects invalid formats, image settings and changed revisions explicitly', async function() {
    for (var query of [{ format: 'markdown' }, { images: 'yes' }, { images: ['true', 'false'] },
      { screenshots: 'yes' }, { screenshots: ['true', 'false'] }]) {
      var invalid = routeHarness();
      assert.strictEqual((await invalid.request(query)).status, 400);
      assert.strictEqual(invalid.lookups, 0);
    }
    var changed = routeHarness();
    assert.strictEqual((await changed.request({ format: 'docx', revision: '2' })).status, 409);
    assert.strictEqual(changed.exports.length, 0);
  });

  it('enforces login, tenant, existence and retrieve permissions', async function() {
    for (var test of [
      { settings: { noUser: true }, status: 401 }, { settings: { otherTenant: true }, status: 401 },
      { settings: { missing: true }, status: 404 }, { settings: { denied: true }, status: 403 }
    ]) {
      var state = routeHarness(test.settings);
      assert.strictEqual((await state.request()).status, test.status);
      assert.strictEqual(state.exports.length, 0);
    }
  });

  it('reports database, permission and export-persistence failures', async function() {
    for (var key of ['dbError', 'permissionError', 'persistError']) {
      var settings = {}; settings[key] = new Error(key);
      var response = await routeHarness(settings).request({ format: 'docx' });
      assert.strictEqual(response.status, 500);
      assert.strictEqual(response.body.message, key);
    }
  });
});

function readUI(options) {
  var state = { requests: [], downloads: [], controls: {}, prints: 0, frames: [], events: [] };
  function control(selector) {
    return state.controls[selector] || (state.controls[selector] = {
      props: {}, value: '', prop: function(key, value) {
        if (arguments.length === 1) return this.props[key];
        this.props[key] = value; return this;
      }, text: function(value) { this.value = value; return this; },
      html: function(value) { if (!arguments.length) return this.value; this.value = value; return this; },
      empty: function() { this.value = ''; return this; }
    });
  }
  var origin = {
    l10n: { t: function(key) { return key; } },
    sessionModel: { get: function() { return 'tenant'; } },
    trigger: function() { state.events.push(Array.from(arguments)); }
  };
  var base = { prototype: { remove: function() { state.removed = true; } }, extend: function(methods) { return methods; } };
  var document = {
    createElement: function() {
      var printDocument = {
        images: state.printImages || [], open: function() {}, close: function() {},
        write: function(value) { this.html = value; }
      };
      var frame = {
        style: {}, contentDocument: printDocument,
        contentWindow: { focus: function() {}, print: function() {
          if (state.printError) throw state.printError;
          state.prints++;
        } },
        remove: function() { this.removed = true; }
      };
      state.frames.push(frame);
      return frame;
    },
    body: { appendChild: function() {} }
  };
  var dependencies = {
    'core/origin': origin, 'core/views/originView': base,
    '../wordExport': function(model, options) {
      var request = { options: options, abort: function() { this.aborted = true; } };
      state.downloads.push(request); return request;
    }
  };
  var proto;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../frontend/src/modules/lightCourseEditor/views/lightCourseReadView.js'), 'utf8'), {
    define: function(factory) { proto = factory(function(name) { return dependencies[name]; }); },
    Handlebars: { templates: { lightCourseReadContent: function(content) { return '<h1>' + content.title + '</h1>'; } } },
    document: document, $: { ajax: function(options) {
      var request = { options: options, done: function(callback) { this.success = callback; return this; },
        fail: function(callback) { this.failure = callback; return this; }, abort: function() { this.aborted = true; } };
      state.requests.push(request); return request;
    } }
  });
  state.view = Object.assign(Object.create(proto), {
    model: { get: function(key) { return key === '_id' ? 'course' : 3; } },
    $: control, $el: { attr: function() {} }, setViewToReady: function() {}
  });
  var template = fs.readFileSync(path.join(__dirname,
    '../frontend/src/modules/lightCourseEditor/templates/lightCourseRead.hbs'), 'utf8');
  ['images', 'screenshots'].forEach(function(name) {
    var input = new RegExp('<input\\b[^>]*class="light-course-read-' + name + '"[^>]*>').exec(template);
    assert(input, name + ' checkbox is present');
    control('.light-course-read-' + name).prop('checked', /\schecked(?:\s|=|>)/.test(input[0]));
  });
  state.view.preRender(Object.assign({ prepare: function(callback) { state.prepared = callback; } }, options));
  state.view.postRender();
  state.control = control;
  return state;
}

describe('Read overlay lifecycle and controls', function() {
  var click = { preventDefault: function() {} };
  it('reuses the full-course endpoint for preview and Word without using light-course routes', function() {
    var state = readUI({ sourceUrl: 'document-export/tenant/course/content-preview' }), view = state.view;
    state.prepared();
    assert(state.requests[0].options.url.startsWith('document-export/tenant/course/content-preview?images=true&screenshots=false'));
    state.requests[0].success({ title: 'Full course', entries: [] });
    view.exportWord(click);
    assert(state.downloads[0].options.url.startsWith('document-export/tenant/course/content-preview?'));
    assert(state.downloads[0].options.url.endsWith('&format=docx'));
  });

  it('waits for autosave, then defaults to images without screenshots and honours toggling images off for Word', function() {
    var state = readUI(), view = state.view;
    assert.strictEqual(state.requests.length, 0);
    state.prepared();
    assert(state.requests[0].options.url.includes('/read?images=true&screenshots=false'));
    state.requests[0].success({ title: 'With images', entries: [] });
    view.exportWord(click);
    assert(state.downloads[0].options.url.includes('images=true&screenshots=false&revision=3&format=docx'));
    state.downloads[0].options.success();
    state.control('.light-course-read-images').prop('checked', false);
    view.loadContent();
    assert(state.requests[1].options.url.includes('images=false&screenshots=false&revision=3&format=json'));
    assert.strictEqual(state.control('.light-course-read-export, .light-course-read-print').props.disabled, true);
    state.requests[1].success({ title: 'Text only', entries: [] });
    view.exportWord(click);
    assert(state.downloads[1].options.url.includes('images=false&screenshots=false&revision=3&format=docx'));
    state.downloads[1].options.success();
    assert.strictEqual(view.busy, false);
    assert.strictEqual(state.events.length, 0);
  });

  it('shows preparation/load/export errors and does not offer stale content after a failed toggle', function() {
    var failed = readUI();
    failed.prepared({ responseJSON: { message: 'Save failed' } });
    assert.strictEqual(failed.requests.length, 0);
    assert.strictEqual(failed.control('.light-course-read-images, .light-course-read-screenshots').props.disabled, true);
    var state = readUI(), view = state.view;
    state.prepared(); state.requests[0].success({ title: 'Original', entries: [] });
    view.exportWord(click); state.downloads[0].options.error({ responseJSON: { message: 'Course changed' } });
    assert.strictEqual(state.control('.light-course-read-status').value, 'Course changed');
    view.loadContent(); state.requests[1].failure({ responseJSON: { message: 'Load failed' } });
    assert.strictEqual(view.content, null);
    assert.strictEqual(state.control('.light-course-read-output').value, '');
    assert.strictEqual(state.control('.light-course-read-export, .light-course-read-print').props.disabled, true);
  });

  it('allows screenshots alone or together with content images and sends both settings to Word', function() {
    var state = readUI(), view = state.view;
    state.prepared(); state.requests[0].success({ title: 'Text', entries: [] });
    assert.strictEqual(view.events['change .light-course-read-screenshots'], 'loadContent');
    state.control('.light-course-read-screenshots').prop('checked', true);
    for (var images of [false, true]) {
      state.control('.light-course-read-images').prop('checked', images);
      view.loadContent();
      var request = state.requests[state.requests.length - 1];
      assert(request.options.url.includes('images=' + images + '&screenshots=true'));
      assert.strictEqual(state.control('.light-course-read-images, .light-course-read-screenshots').props.disabled, true);
      request.success({ title: 'Selected images', entries: [] });
      assert.strictEqual(state.control('.light-course-read-images, .light-course-read-screenshots').props.disabled, false);
      view.exportWord(click);
      var download = state.downloads[state.downloads.length - 1];
      assert(download.options.url.includes('images=' + images + '&screenshots=true&revision=3&format=docx'));
      download.options.success();
    }
  });

  it('prints only the rendered content with hierarchy, not the toolbar or editor, and removes the frame', async function() {
    var state = readUI(), view = state.view;
    state.prepared(); state.requests[0].success({ title: 'Print title', entries: [] });
    view.printContent(click);
    await new Promise(function(resolve) { setImmediate(resolve); });
    assert.strictEqual(state.prints, 1);
    var frame = state.frames[0];
    assert(frame.contentDocument.html.includes('<body><h1>Print title</h1></body>'));
    assert(!frame.contentDocument.html.includes('light-course-read-toolbar'));
    assert(frame.contentDocument.html.includes('max-width:50%'));
    assert.strictEqual(frame.contentDocument.title, 'Print title');
    frame.contentWindow.onafterprint();
    assert.strictEqual(frame.removed, true);
  });

  it('aborts requests and ignores responses or save callbacks after closing', function() {
    var state = readUI(); state.view.remove(); state.prepared();
    assert.strictEqual(state.requests.length, 0);
    state = readUI(); state.prepared(); state.view.remove();
    assert.strictEqual(state.requests[0].aborted, true);
    state.requests[0].success({ title: 'Ignored', entries: [] });
    assert.strictEqual(state.view.content, null);
  });

  it('waits for print images and surfaces image or browser print failures', async function() {
    var state = readUI();
    state.prepared(); state.requests[0].success({ title: 'Images', entries: [] });
    state.printImages = [{ complete: false }];
    state.view.printContent(click);
    await new Promise(function(resolve) { setImmediate(resolve); });
    assert.strictEqual(state.prints, 0);
    state.printImages[0].onload();
    await new Promise(function(resolve) { setImmediate(resolve); });
    assert.strictEqual(state.prints, 1);
    state.view.removePrintFrame();
    state.printImages = [{ complete: true, naturalWidth: 0 }];
    state.view.printContent(click);
    await new Promise(function(resolve) { setImmediate(resolve); });
    assert.strictEqual(state.prints, 1);
    assert.strictEqual(state.frames[1].removed, true);
    assert.strictEqual(state.control('.light-course-read-status').value, 'app.lightcoursereadprintfailed');
    state.printImages = [];
    state.printError = new Error('Printing blocked');
    state.view.printContent(click);
    await new Promise(function(resolve) { setImmediate(resolve); });
    assert.strictEqual(state.frames[2].removed, true);
    assert.strictEqual(state.view.busy, false);
  });

  it('aborts an in-progress Word download and cleans up a pending print when closed', async function() {
    var state = readUI();
    state.prepared(); state.requests[0].success({ title: 'Content', entries: [] });
    state.view.exportWord(click); state.view.remove();
    assert.strictEqual(state.downloads[0].aborted, true);
    assert.strictEqual(state.downloads[0].options.isDisposed(), true);
    state = readUI();
    state.prepared(); state.requests[0].success({ title: 'Content', entries: [] });
    state.printImages = [{ complete: false }];
    state.view.printContent(click); state.view.remove();
    state.printImages[0].onload();
    await new Promise(function(resolve) { setImmediate(resolve); });
    assert.strictEqual(state.frames[0].removed, true);
    assert.strictEqual(state.prints, 0);
  });

  it('opens Read in editable and locked editors without flushing component drafts', function() {
    var proto, events = [], saves = 0, waits = 0;
    var readView = {};
    var origin = { l10n: { t: function(key) { return key; } },
      trigger: function() { events.push(Array.from(arguments)); } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,
      '../frontend/src/modules/lightCourseEditor/views/lightCourseEditorView.js'), 'utf8'), {
      define: function(factory) {
        proto = factory(function(name) {
          if (name === 'core/origin') return origin;
          if (name === 'core/views/originView') return { extend: function(methods) { return methods; } };
          if (name === './lightCourseReadView') return readView;
        });
      }
    });
    var locked = false;
    var view = Object.assign(Object.create(proto), {
      model: { isLocked: function() { return locked; } },
      autosave: function(callback) { saves++; callback(); },
      afterPendingSave: function(callback) { waits++; callback(); },
      treeView: { flushComponent: function() { throw new Error('Do not flush an unfinished component'); } }
    });
    view.onReadClicked(click);
    assert.strictEqual(events[0][0], 'modal:open');
    assert.strictEqual(events[0][1], readView);
    events[0][2].prepare(function() {});
    assert.strictEqual(saves, 1);
    locked = true;
    view.onReadClicked(click); events[1][2].prepare(function() {});
    assert.strictEqual(saves, 1);
    assert.strictEqual(waits, 1);
  });

  it('escapes content and attributes in the real preview/print template', function() {
    var handlebars = Handlebars.create();
    handlebars.registerHelper('ifValueEquals', function(left, right, options) {
      return left === right ? options.fn(this) : options.inverse(this);
    });
    var render = handlebars.compile(fs.readFileSync(path.join(__dirname,
      '../frontend/src/modules/lightCourseEditor/templates/lightCourseReadContent.hbs'), 'utf8'));
    var html = render({ title: '<script>title()</script>', entries: [
      { type: 'componentType', text: '<script>type()</script>' },
      { type: 'heading', level: 2, text: '<img src=x onerror=alert()>' },
      { type: 'heading', level: 5, text: 'Full-course item' },
      { type: 'text', text: '<script>body()</script>' },
      { type: 'image', src: 'data:image/png;base64,abc', alt: '" onerror="alert()', width: 10, height: 10 }
    ] });
    assert(!html.includes('<script>'));
    assert(html.includes('class="light-course-read-component-type">&lt;script&gt;type()&lt;/script&gt;</p>'));
    assert(!html.includes('<img src=x'));
    assert(html.includes('<h3>&lt;img'));
    assert(html.includes('<h6>Full-course item</h6>'));
    assert(html.includes('alt="&quot; onerror&#x3D;&quot;alert()"'));
  });
});
