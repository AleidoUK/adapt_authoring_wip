var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var createRequire = require('module').createRequire;
var unzipper = require('unzipper');
var Backbone = require('../frontend/src/libraries/backbone');
var filestorage = require('../lib/filestorage');
var storyboard = require('../lib/storyboard');
var generator = require('../lib/lightcourse/documentGenerator');
var documentImport = require('../lib/lightcourse/documentImport');
var wordImages = require('../lib/lightcourse/wordImages');
var ROOT = path.join(__dirname, '..');
var IMAGE = '1234567890abcdef12345678';
var png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=', 'base64');
var text = { type: 'string', translatable: true };
var graphic = { type: 'object', properties: {
  src: { type: 'string', inputType: 'Asset:image' }, alt: text
} };

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
function fixture() {
  var h = { queries: [], schemaQueries: [] };
  h.course = { _id: 'course', _tenantId: 'tenant', title: 'E-bikes', displayTitle: 'Bicycle training',
    body: '<p>Course introduction</p>', heroImage: IMAGE,
    _extensions: { _help: { body: '<p>Help text</p>' }, _disabled: { body: 'Do not export disabled text' } } };
  h.records = {
    contentobject: [
      { _id: 'page-2', _parentId: 'course', _type: 'page', _sortOrder: 20, title: 'Last page' },
      { _id: 'page-1', _parentId: 'course', _type: 'page', _sortOrder: 10, title: 'First page', pageBody: '<p>Page text</p>' },
      { _id: 'menu', _parentId: 'course', _type: 'menu', _sortOrder: 0, title: 'Submenu' },
      { _id: 'nested-page', _parentId: 'menu', _type: 'page', _sortOrder: 1, title: 'Nested page' }
    ],
    article: [{ _id: 'article', _parentId: 'page-1', title: 'Article title', body: '<p>Article body</p>' }],
    block: [{ _id: 'block', _parentId: 'article', title: 'Block title', body: '<p>Block body</p>' }],
    component: [
      { _id: 'right', _parentId: 'block', _sortOrder: 2, _component: 'text', _layout: 'right', title: 'Right component', body: '<p>Right body</p>' },
      { _id: 'left', _parentId: 'block', _sortOrder: 1, _component: 'text', _layout: 'left', title: 'Left component',
        body: '<p>Left body<img src="course/assets/example.png" alt="Inline image"></p>',
        _extensions: { _uniqueId: { _id: 'c-01' } },
        _graphic: { src: 'course/assets/example.png', alt: 'Component image' },
        properties: { _items: [{ title: 'Item title', body: '<p>Item body</p>', _graphic: { src: 'course/assets/example.png', alt: 'Item image' } }] } }
    ],
    config: [{ _courseId: 'course', _enabledExtensions: { help: { targetAttribute: '_help' }, id: { targetAttribute: '_uniqueId' } } }],
    asset: [{ _id: IMAGE, filename: 'example.png', path: 'stored/image.png', repository: 'test', mimeType: 'image/png' }]
  };
  h.plugins = {
    componenttype: [{ component: 'text', displayName: 'Text', properties: { _items: { type: 'array', items: { type: 'object',
      properties: { title: text, body: text, _graphic: graphic } } } } }],
    extensiontype: [
      { extension: 'help', properties: { pluginLocations: { properties: {
        course: { properties: { _help: { type: 'object', properties: { body: text } } } }
      } } } },
      { extension: 'disabled', properties: { pluginLocations: { properties: {
        course: { properties: { _disabled: { type: 'object', properties: { body: text } } } }
      } } } }
    ],
    menutype: [], themetype: []
  };
  h.schemas = {};
  ['course', 'contentobject', 'article', 'block', 'component'].forEach(function(type) {
    h.schemas[type] = { properties: { title: text, displayTitle: text, body: text, pageBody: text, _graphic: graphic } };
  });
  h.schemas.course.properties.heroImage = { type: 'string', inputType: 'Asset:image' };
  h.db = { retrieve: function(type, query, options, callback) {
    h.queries.push({ type: type, query: query });
    if (h.readError === type) return callback(new Error('Read failed'));
    if (type !== 'asset') assert.deepStrictEqual(copy(query), { _courseId: 'course' });
    else {
      assert.deepStrictEqual(copy(query), {});
      assert(options.fields.includes('_id'));
    }
    callback(null, copy(h.records[type].filter(function(record) {
      return Object.keys(query).every(function(key) { return record[key] === query[key] || key === '_courseId'; });
    })));
  } };
  h.schemaDb = { retrieve: function(type, query, options, callback) {
    h.schemaQueries.push(type);
    callback(null, copy(h.plugins[type]));
  } };
  return h;
}
function generate(h, implementation) {
  return new Promise(function(resolve, reject) {
    (implementation || storyboard).generate(h.course, h.db, h.schemaDb, h.schemas, function(error, result) {
      if (error) reject(error); else resolve(result);
    });
  });
}

function preview(h, options, word) {
  return new Promise(function(resolve, reject) {
    storyboard[word ? 'generateReadDocx' : 'generateRead'](h.course, h.db, h.schemaDb, h.schemas, function(error, result) {
      if (error) reject(error); else resolve(result);
    }, options);
  });
}

describe('full-course content preview', function() {
  it('includes the whole saved course with structural hierarchy and component types, without metadata or mutations', async function() {
    var h = fixture();
    h.records.component[1].graphicsNotes = 'Review graphics notes';
    h.records.component[1].developerNotes = 'Review developer notes';
    var source = JSON.stringify([h.course, h.records, h.plugins, h.schemas]);
    var content = await preview(h), values = content.entries.map(function(entry) { return entry.text; });
    assert.strictEqual(content.title, 'Bicycle training');
    ['Course introduction', 'Page text', 'Article body', 'Block body', 'Left body', 'Right body', 'Item body', 'Help text']
      .forEach(function(value) { assert(values.includes(value), value); });
    var headings = content.entries.filter(function(entry) { return entry.type === 'heading'; });
    assert(headings.findIndex(function(entry) { return entry.text === 'Nested page'; }) <
      headings.findIndex(function(entry) { return entry.text === 'First page'; }));
    [
      ['First page', 1], ['Article title', 2], ['Block title', 3], ['Left component', 4], ['Item title', 5], ['Last page', 1]
    ].forEach(function(expected) {
      assert(headings.some(function(entry) { return entry.text === expected[0] && entry.level === expected[1]; }), expected[0]);
    });
    var index = content.entries.findIndex(function(entry) { return entry.text === 'Left component'; });
    assert.deepStrictEqual(content.entries[index - 1], { type: 'componentType', text: 'Text' });
    ['c-01', 'Review graphics notes', 'Review developer notes', 'Do not export disabled text']
      .forEach(function(value) { assert(!values.includes(value), value); });
    assert.strictEqual(JSON.stringify([h.course, h.records, h.plugins, h.schemas]), source);
  });

  it('filters empty, disabled and accessibility fields using actual selected schemas', async function() {
    var h = fixture(), node = h.records.component[1];
    h.schemas.component.properties._popup = { type: 'object', properties: {
      _isEnabled: { type: 'boolean', default: false }, title: text, body: text, _graphic: graphic
    } };
    h.schemas.component.properties.ariaLabel = text;
    node.ariaLabel = 'Accessibility-only label';
    node._popup = { title: 'Disabled popup', body: 'Disabled popup body', _graphic: { src: IMAGE } };
    var content = JSON.stringify(await preview(h, { images: false }));
    assert(!content.includes('Disabled popup'));
    assert(!content.includes('Accessibility-only label'));
    assert(!content.includes('Image unavailable'));
    node._popup._isEnabled = true;
    assert(JSON.stringify(await preview(h)).includes('Disabled popup body'));
  });

  it('includes only enabled glossary, resource and help content, with nested enablement respected', async function() {
    var h = fixture(), config = h.records.config[0], help = h.course._extensions._help;
    config._enabledExtensions.resources = { targetAttribute: '_resources' };
    config._enabledExtensions.glossary = { targetAttribute: '_glossary' };
    h.course._extensions._resources = { title: 'Useful resources',
      _resourcesItems: [{ title: 'Resource title', description: 'Resource description', _link: 'https://example.com' }] };
    h.course._extensions._glossary = { _glossaryItems: [{ term: 'Torque', description: 'Turning force' }] };
    Object.assign(h.plugins.extensiontype[0].properties.pluginLocations.properties.course.properties._help.properties, {
      _popup: { type: 'object', properties: {
        _isEnabled: { type: 'boolean', default: false }, title: text, body: text, instruction: text
      } },
      _items: { type: 'array', items: { type: 'object', properties: {
        _isEnabled: { type: 'boolean', default: true }, title: text, body: text
      } } }
    });
    help._popup = { title: 'Help popup', body: 'Help popup body', instruction: 'Help instruction' };
    help._items = [{ title: 'Help item', body: 'Help item body' },
      { _isEnabled: false, title: 'Hidden help item', body: 'Hidden help content' }];
    var content = JSON.stringify(await preview(h));
    ['Useful resources', 'Resource description', 'https://example.com', 'Torque', 'Turning force', 'Help item body']
      .forEach(function(value) { assert(content.includes(value), value); });
    assert(!content.includes('Help popup'));
    assert(!content.includes('Hidden help'));
    help._popup._isEnabled = true;
    assert(JSON.stringify(await preview(h)).includes('Help instruction'));
    h.course._extensions._resources._isEnabled = false;
    delete config._enabledExtensions.glossary;
    help._isEnabled = false;
    content = JSON.stringify(await preview(h));
    ['Useful resources', 'Torque', 'Help item body', 'Help text'].forEach(function(value) { assert(!content.includes(value), value); });
  });

  it('shares independently selected tenant images and screenshots with the Word export', async function() {
    var h = fixture(), getStorage = filestorage.getStorage, reads = 0;
    h.records.component[1].properties.screenshotAssetId = IMAGE;
    filestorage.getStorage = function(repository, callback) {
      assert.strictEqual(repository, 'test'); reads++;
      callback(null, { getFileContents: function(file, callback) {
        assert.strictEqual(file, 'stored/image.png'); callback(null, png);
      } });
    };
    try {
      for (var settings of [
        { images: false, screenshots: false, count: 0 },
        { images: true, screenshots: false, count: 3 },
        { images: false, screenshots: true, count: 1 },
        { images: true, screenshots: true, count: 4 }
      ]) {
        reads = 0;
        var content = await preview(h, settings);
        var images = content.entries.filter(function(entry) { return entry.type === 'image'; });
        assert.strictEqual(images.length, settings.count);
        assert.strictEqual(reads, Number(settings.images) + Number(settings.screenshots));
        assert.strictEqual(images.some(function(entry) { return entry.alt === 'Component screenshot'; }), settings.screenshots);
        assert(!content.entries.some(function(entry) { return entry.type === 'notice'; }));
        images.forEach(function(entry) { assert.strictEqual(entry.src, 'data:image/png;base64,' + png.toString('base64')); });
        var buffer = await preview(h, settings, true), zip = await unzipper.Open.buffer(buffer);
        var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
        assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, settings.count);
        assert(!xml.includes('Total word count'));
        assert(!xml.includes('bookmarkStart'));
        assert(!xml.includes('commentReference'));
        var parsed = await new Promise(function(resolve, reject) {
          generator.parseDocx(buffer, function(error, value) { if (error) reject(error); else resolve(value); });
        });
        assert(parsed.errors.length > 0);
      }
    } finally { filestorage.getStorage = getStorage; }
  });

  it('reports incomplete course structures and schema/database failures explicitly', async function() {
    for (var change of [
      function(h) { h.records.component[0]._parentId = 'missing'; },
      function(h) { h.plugins.componenttype = []; },
      function(h) { h.readError = 'component'; }
    ]) {
      var h = fixture(); change(h);
      await assert.rejects(preview(h), /detached|schema|Read failed/);
    }
  });
});

describe('full-course storyboard generation', function() {
  it('preserves course order and nested fields while omitting article/block information and course settings without modifying stored content', async function() {
    var h = fixture(), before = JSON.stringify([h.course, h.records, h.plugins, h.schemas]);
    var implementation = load('lib/storyboard.js', {
      './lightcourse/wordDocument': { generate: function(data, blocks, callback) { callback(null, { data: data, blocks: blocks }); } }
    });
    var result = await generate(h, implementation);
    assert.deepStrictEqual(Array.from(result.blocks, function(block) { return block.id; }),
      ['course', 'menu', 'nested-page', 'page-1', 'left', 'right', 'page-2']);
    var fields = result.blocks.find(function(block) { return block.id === 'left'; }).fields;
    assert.strictEqual(fields[0].path, 'uniqueId');
    assert.strictEqual(fields[0].text, 'c-01');
    assert(fields.some(function(field) { return field.path === '_items[0].body' && field.text === '<p>Item body</p>'; }));
    assert.deepStrictEqual(Array.from(result.blocks[0].fields, function(field) { return field.path; }), ['title', 'displayTitle']);
    assert.strictEqual(result.blocks.find(function(block) { return block.id === 'left'; }).heading, 'Text');
    assert.strictEqual(result.blocks.find(function(block) { return block.id === 'page-1'; }).heading, 'Page 2');
    assert.strictEqual(result.blocks.find(function(block) { return block.id === 'nested-page'; }).heading, 'Page 1.1');
    assert.strictEqual(result.blocks.find(function(block) { return block.id === 'menu'; }).heading, 'Menu 1');
    assert.strictEqual(result.blocks.find(function(block) { return block.id === 'left'; }).headingLevel, 2);
    assert(!result.blocks.find(function(block) { return block.id === 'right'; }).fields.some(function(field) {
      return field.path === 'uniqueId';
    }));
    assert(!JSON.stringify(result.blocks).includes('Help text'));
    assert(!JSON.stringify(result.blocks).includes('Do not export disabled text'));
    assert.strictEqual(result.data.storyboard, true);
    assert.strictEqual(result.data.totalWordCount, 28);
    assert.strictEqual(result.data._lightCourseId, undefined);
    assert.strictEqual(h.queries.length, 6);
    assert.strictEqual(h.schemaQueries.length, 4);
    assert.strictEqual(JSON.stringify([h.course, h.records, h.plugins, h.schemas]), before);
  });

  it('embeds tenant-library image bytes and uses light-course component layout without article/block details or import mapping', async function() {
    this.timeout(10000);
    var h = fixture(), getStorage = filestorage.getStorage;
    filestorage.getStorage = function(repository, callback) {
      assert.strictEqual(repository, 'test');
      callback(null, { getFileContents: function(file, callback) {
        assert.strictEqual(file, 'stored/image.png'); callback(null, png);
      } });
    };
    try {
      var buffer = await generate(h), zip = await unzipper.Open.buffer(buffer);
      var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
      var paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g);
      var titleIndex = paragraphs.findIndex(function(paragraph) { return paragraph.includes('<w:pStyle w:val="Title"/>'); });
      assert(titleIndex !== -1);
      assert(paragraphs[titleIndex + 1].includes('>Total word count: 28<'));
      ['Bicycle training', 'Page text', 'Left body', 'Right body', 'Item body', 'c-01', '| 12 words | left', '>4 words | right<']
        .forEach(function(value) { assert(xml.includes(value), value); });
      ['Course introduction', 'Article title', 'Article body', 'Block title', 'Block body', 'Help text', 'Hero image', '>Tags<']
        .forEach(function(value) { assert(!xml.includes(value), value); });
      var headings = paragraphs.filter(function(paragraph) {
        return paragraph.includes('<w:pStyle w:val="Heading2"/>');
      });
      assert.strictEqual(headings.length, 2);
      headings.forEach(function(heading) {
        assert(heading.includes('>Text<'));
        assert(!heading.includes('Left component'));
        assert(!heading.includes('Right component'));
      });
      assert(!xml.includes('<w:pStyle w:val="Heading4"/>'));
      assert(!xml.includes('<w:pStyle w:val="Heading5"/>'));
      assert(xml.includes('>Page 2<'));
      assert(!xml.includes('Page 2: First page'));
      assert(xml.includes('>First page<'));
      assert(xml.indexOf('Left body') < xml.indexOf('Right body'));
      assert(!xml.includes('Storyboard (export only)'));
      assert(!xml.includes('Developer information'));
      ['Add unique id here', 'Add graphics notes here', 'Add developer notes here'].forEach(function(value) {
        assert(!xml.includes(value), value);
      });
      assert(!xml.includes('Image unavailable:'));
      assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, 3);
      assert(xml.indexOf('descr="Component image"') < xml.indexOf('>Left body'));
      assert(xml.indexOf('>Item body') < xml.indexOf('descr="Item image"'));
      var media = zip.files.filter(function(file) { return file.path.startsWith('word/media/') && !file.path.endsWith('/'); });
      assert.strictEqual(media.length, 1);
      assert((await media[0].buffer()).equals(png));
      var custom = zip.files.find(function(file) { return file.path === 'docProps/custom.xml'; });
      if (custom) assert(!(await custom.buffer()).toString().includes('LightCourseWord'));
      var parsed = await new Promise(function(resolve, reject) {
        generator.parseDocx(buffer, function(error, parsed) { if (error) reject(error); else resolve(parsed); });
      });
      assert.notStrictEqual(parsed.formatVersion, 2);
      assert(documentImport.validateStructure(parsed, ['light-course-page']).length > 0);
    } finally { filestorage.getStorage = getStorage; }
  });

  it('shows a zero total for an empty course without counting document furniture or excluded course text', async function() {
    var h = fixture();
    h.course.title = '';
    h.course.displayTitle = '';
    ['contentobject', 'article', 'block', 'component'].forEach(function(type) { h.records[type] = []; });
    var zip = await unzipper.Open.buffer(await generate(h));
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
    assert(xml.includes('>Total word count: 0<'));
    assert(xml.indexOf('Untitled course') < xml.indexOf('Total word count: 0'));
    assert(!xml.includes('Storyboard (export only)'));
    assert(xml.indexOf('Total word count: 0') < xml.indexOf('Course content'));
  });

  it('omits empty component fields including nested items, but keeps configured text, zero strings and review notes', async function() {
    var h = fixture();
    var component = h.records.component[1];
    component.displayTitle = '<p>&nbsp;<br></p>';
    component.graphicsNotes = ' \n ';
    component.developerNotes = '<p>Keep this note</p>';
    component.properties._items.push({ title: '', body: '<p><br></p>' });
    h.schemas.component.properties.instruction = text;
    component.instruction = '0';
    var implementation = load('lib/storyboard.js', {
      './lightcourse/wordDocument': { generate: function(data, blocks, callback) { callback(null, blocks); } }
    });
    var blocks = await generate(h, implementation);
    var fields = blocks.find(function(block) { return block.id === 'left'; }).fields;
    ['displayTitle', 'graphicsNotes', '_items[1].title', '_items[1].body'].forEach(function(path) {
      assert(!fields.some(function(field) { return field.path === path; }), path);
    });
    assert(fields.some(function(field) { return field.path === 'instruction' && field.text === '0'; }));
    assert(fields.some(function(field) { return field.path === 'developerNotes' && field.text === '<p>Keep this note</p>'; }));
  });

  it('keeps image-only component content without empty field boxes or unique-ID placeholders', async function() {
    var h = fixture(), getStorage = filestorage.getStorage;
    h.records.component = [{
      _id: 'image-only', _parentId: 'block', _component: 'text', title: '', displayTitle: ' ',
      body: '<p><img src="course/assets/example.png" alt="Image-only content"></p>'
    }];
    filestorage.getStorage = function(repository, callback) {
      callback(null, { getFileContents: function(file, callback) { callback(null, png); } });
    };
    try {
      var zip = await unzipper.Open.buffer(await generate(h));
      var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
      assert(xml.includes('>0 words | full<'));
      assert(xml.includes('descr="Image-only content"'));
      assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, 1);
      ['Add title here', 'Add display title here', 'Add body here', 'Add unique id here',
        'Add graphics notes here', 'Add developer notes here'].forEach(function(value) {
        assert(!xml.includes(value), value);
      });
    } finally { filestorage.getStorage = getStorage; }
  });

  function collectBlocks(h) {
    return generate(h, load('lib/storyboard.js', {
      './lightcourse/wordDocument': { generate: function(data, blocks, callback) { callback(null, blocks); } }
    }));
  }

  function optionSchema(defaultEnabled) {
    return { type: 'object', properties: {
      _isEnabled: { type: 'boolean', default: defaultEnabled },
      title: text, body: text, ariaLabel: text, _graphic: graphic
    } };
  }

  ['text', 'graphic', 'simulation'].forEach(function(type) {
    [
      { name: 'disabled', stored: false, defaultValue: true, visible: false },
      { name: 'disabled by default', defaultValue: false, visible: false },
      { name: 'enabled', stored: true, defaultValue: false, visible: true },
      { name: 'enabled by default', defaultValue: true, visible: true }
    ].forEach(function(state) {
      it('respects ' + state.name + ' option groups for ' + type + ' components without changing saved content', async function() {
        var h = fixture(), component = h.records.component[1];
        if (type !== 'text') {
          var plugin = copy(h.plugins.componenttype[0]);
          plugin.component = type;
          h.plugins.componenttype.push(plugin);
          component._component = type;
        }
        h.schemas.component.properties._popup = optionSchema(state.defaultValue);
        component._popup = { title: 'Popup title', body: '<p>Popup body</p>', ariaLabel: 'Popup aria label',
          _graphic: { src: 'course/assets/example.png', alt: 'Popup image' } };
        if (state.stored !== undefined) component._popup._isEnabled = state.stored;
        var before = JSON.stringify([h.course, h.records, h.plugins, h.schemas]);
        var blocks = await collectBlocks(h);
        var block = blocks.find(function(block) { return block.id === 'left'; });
        assert.strictEqual(block.fields.some(function(field) { return field.path === '_popup.ariaLabel'; }), state.visible);
        assert.strictEqual(block.fields.some(function(field) { return field.path === '_popup.body'; }), state.visible);
        assert.strictEqual(block.images.some(function(image) { return image.path === '_popup._graphic.src'; }), state.visible);
        assert.strictEqual(block.wordCount, state.visible ? 21 : 12);
        assert(block.fields.some(function(field) { return field.path === 'body'; }));
        assert.strictEqual(JSON.stringify([h.course, h.records, h.plugins, h.schemas]), before);
      });
    });
  });

  it('recursively filters disabled ancestors and individual item options, including extensions and theme settings', async function() {
    var h = fixture(), component = h.records.component[1];
    h.schemas.component.properties._navigation = optionSchema(false);
    h.schemas.component.properties._navigation.properties._popup = optionSchema(true);
    component._navigation = { _isEnabled: false, ariaLabel: 'Hidden navigation',
      _popup: { _isEnabled: true, body: 'Hidden descendant' } };
    h.plugins.componenttype[0].properties._items.items.properties._tooltip = optionSchema(false);
    component.properties._items[0]._tooltip = { _isEnabled: false, ariaLabel: 'Hidden tooltip' };
    component.properties._items.push({ title: 'Second item', _tooltip: { _isEnabled: true, body: 'Visible tooltip' } });
    h.schemas.component.properties._extensions = { type: 'object', properties: { _option: optionSchema(false) } };
    component._extensions._option = { _isEnabled: false, ariaLabel: 'Hidden extension' };
    h.schemas.component.properties.themeSettings = { type: 'object', properties: { _option: optionSchema(false) } };
    component.themeSettings = { _option: { _isEnabled: false, body: 'Hidden theme text' } };
    var blocks = await collectBlocks(h);
    var block = blocks.find(function(block) { return block.id === 'left'; });
    assert(!JSON.stringify(block).includes('Hidden'));
    assert(block.fields.some(function(field) { return field.path === '_items[1]._tooltip.body' && field.text === 'Visible tooltip'; }));
    assert.strictEqual(block.wordCount, 16);
  });

  it('omits media labels and descriptions when no asset source is configured, without dropping other content', async function() {
    var h = fixture(), component = h.records.component[1];
    h.schemas.component.properties._graphic = copy(graphic);
    Object.assign(h.schemas.component.properties._graphic.properties, {
      ariaLabel: text, longdescription: text, attribution: text, description: text
    });
    component._graphic = { src: '', alt: 'Unused alternative text', ariaLabel: 'Unused aria label',
      longdescription: 'Unused long description', attribution: 'Unused attribution', description: 'Other configured text' };
    var block = (await collectBlocks(h)).find(function(block) { return block.id === 'left'; });
    assert(!JSON.stringify(block).includes('Unused'));
    assert(block.fields.some(function(field) { return field.path === '_graphic.description' && field.text === 'Other configured text'; }));
    assert(!block.images.some(function(image) { return image.path === '_graphic.src'; }));
    assert.strictEqual(block.wordCount, 13);
  });

  it('does not render or load disabled content/images and excludes them from the exported word count', async function() {
    var h = fixture(), getStorage = filestorage.getStorage, reads = 0;
    h.records.component = [h.records.component[0]];
    h.schemas.component.properties._popup = optionSchema(false);
    h.records.component[0]._popup = { _isEnabled: false, title: 'Hidden popup title',
      ariaLabel: 'Hidden accessibility label', body: '<p>Hidden popup body<img src="course/assets/example.png"></p>',
      _graphic: { src: 'course/assets/example.png', alt: 'Hidden popup image' } };
    filestorage.getStorage = function(repository, callback) {
      reads++;
      callback(null, { getFileContents: function(file, callback) { callback(null, png); } });
    };
    try {
      var zip = await unzipper.Open.buffer(await generate(h));
      var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
      assert(!xml.includes('Hidden'));
      assert(!xml.includes('Image unavailable:'));
      assert(!xml.includes('<w:drawing>'));
      assert(xml.includes('>4 words | right<'));
      assert(xml.includes('>Total word count: 16<'));
      assert(xml.includes('Right body'));
      assert.strictEqual(reads, 0);
    } finally { filestorage.getStorage = getStorage; }
  });

  it('includes selected menu/theme locations but not course globals or unselected plugins', async function() {
    var h = fixture();
    h.records.config[0]._menu = 'adapt-menu-box';
    h.records.config[0]._theme = 'adapt-theme-vanilla';
    h.plugins.menutype.push({ name: 'adapt-menu-box', menu: 'box', globals: { label: text },
      properties: { pluginLocations: { properties: {
        contentobject: { properties: { intro: text } }
      } } } });
    h.plugins.themetype.push({ name: 'adapt-theme-vanilla', theme: 'vanilla',
      properties: { pluginLocations: { properties: {
        component: { properties: { caption: text } }, text: { properties: { detail: text } }
      } } } });
    h.plugins.themetype.push({ name: 'adapt-theme-unused', theme: 'unused',
      properties: { pluginLocations: { properties: { component: { properties: { hidden: text } } } } } });
    h.plugins.extensiontype[0].globals = { label: text };
    h.course._globals = { _menu: { _box: { label: 'Menu global text' } }, _extensions: { _help: { label: 'Help global text' } } };
    h.records.contentobject[1].menuSettings = { intro: 'Menu introduction' };
    h.records.component[1].themeSettings = { caption: 'Theme caption', detail: 'Text-specific detail', hidden: 'Unselected theme text' };
    var implementation = load('lib/storyboard.js', {
      './lightcourse/wordDocument': { generate: function(data, blocks, callback) { callback(null, blocks); } }
    });
    var blocks = await generate(h, implementation);
    var rootFields = blocks[0].fields;
    assert.deepStrictEqual(Array.from(rootFields, function(field) { return field.path; }), ['title', 'displayTitle']);
    assert(!JSON.stringify(blocks).includes('Menu global text'));
    assert(!JSON.stringify(blocks).includes('Help global text'));
    var pageFields = blocks.find(function(block) { return block.id === 'page-1'; }).fields;
    assert(pageFields.some(function(field) { return field.path === 'menuSettings.intro' && field.text === 'Menu introduction'; }));
    var componentFields = blocks.find(function(block) { return block.id === 'left'; }).fields;
    assert(componentFields.some(function(field) { return field.path === 'themeSettings.caption' && field.text === 'Theme caption'; }));
    assert(componentFields.some(function(field) { return field.path === 'themeSettings.detail' && field.text === 'Text-specific detail'; }));
    assert(!JSON.stringify(blocks).includes('Unselected theme text'));
  });

  it('uses the same fields and word count for nested and flat component properties', async function() {
    var h = fixture();
    h.plugins.componenttype[0].properties = { properties: {
      type: 'object', properties: h.plugins.componenttype[0].properties
    } };
    var implementation = load('lib/storyboard.js', {
      './lightcourse/wordDocument': { generate: function(data, blocks, callback) { callback(null, blocks); } }
    });
    var nested = await generate(h, implementation);
    h.plugins.componenttype[0].properties = h.plugins.componenttype[0].properties.properties.properties;
    var flat = await generate(h, implementation);
    assert.deepStrictEqual(copy(nested), copy(flat));
    assert.strictEqual(nested.find(function(block) { return block.id === 'left'; }).wordCount, 12);
  });

  function withCourseExtensions() {
    var h = fixture();
    h.records.config[0]._enabledExtensions.resources = { targetAttribute: '_resources' };
    h.records.config[0]._enabledExtensions.glossary = { targetAttribute: '_glossary' };
    h.course._extensions._resources = {
      _isEnabled: true, title: 'Useful resources', displayTitle: 'Reference library',
      description: 'Resources description', body: '<p>Resources introduction</p>', instruction: 'Choose a resource',
      _filterButtons: { all: 'Do not export filter labels' }, _drawerOrder: 3,
      _resourcesItems: [{ title: 'Reference sheet', description: '<p>Resource details</p>',
        filename: 'reference.pdf', _link: 'course/assets/reference.pdf', _forceDownload: true,
        _isGlobal: true, _type: 'document' }]
    };
    h.course._extensions._glossary = {
      _isEnabled: true, title: 'Key terms', description: 'Glossary description',
      clearSearch: 'Do not export clear-search text', searchPlaceholder: 'Do not export search text',
      _glossaryItems: [{ term: 'Torque', description: '<p>Turning force<img src="course/assets/example.png"></p>' }]
    };
    return h;
  }

  it('exports enabled Resources and Glossary headings, introductory content and items, but no configurable settings', async function() {
    var h = withCourseExtensions(), getStorage = filestorage.getStorage;
    filestorage.getStorage = function(repository, callback) {
      callback(null, { getFileContents: function(file, callback) { callback(null, png); } });
    };
    try {
      var zip = await unzipper.Open.buffer(await generate(h));
      var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
      ['Resources', 'Useful resources', 'Reference library', 'Resources description', 'Resources introduction',
        'Choose a resource', 'Reference sheet', 'Resource details', 'reference.pdf', 'course/assets/reference.pdf',
        'Glossary', 'Key terms', 'Glossary description', 'Torque', 'Turning force']
        .forEach(function(value) { assert(xml.includes(value), value); });
      assert(xml.includes('>Total word count: 50<'));
      ['Do not export', 'Filter buttons', 'Drawer order', 'Clear search', 'Search placeholder', 'Force download', 'Is global',
        'Image unavailable:'].forEach(function(value) { assert(!xml.includes(value), value); });
      assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, 4);
      var itemHeadings = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g).filter(function(paragraph) {
        return paragraph.includes('<w:pStyle w:val="Heading2"/>');
      });
      ['Reference sheet', 'Torque'].forEach(function(title) {
        assert(itemHeadings.some(function(paragraph) { return paragraph.includes('>' + title + '<'); }), title);
      });
      assert(!xml.includes('<w:pStyle w:val="Heading4"/>'));
      assert(!xml.includes('<w:pStyle w:val="Heading5"/>'));
    } finally { filestorage.getStorage = getStorage; }
  });

  ['_resources', '_glossary'].forEach(function(attribute) {
    ['not-selected', 'disabled', 'absent', 'empty'].forEach(function(state) {
      it('handles ' + state + ' ' + attribute + ' content', async function() {
        var h = withCourseExtensions();
        if (state === 'not-selected') delete h.records.config[0]._enabledExtensions[attribute.slice(1)];
        if (state === 'disabled') h.course._extensions[attribute]._isEnabled = false;
        if (state === 'absent') delete h.course._extensions[attribute];
        if (state === 'empty') h.course._extensions[attribute][attribute + 'Items'] = [];
        var implementation = load('lib/storyboard.js', {
          './lightcourse/wordDocument': { generate: function(data, blocks, callback) { callback(null, blocks); } }
        });
        var blocks = await generate(h, implementation);
        assert.strictEqual(blocks.some(function(block) { return block.id === 'course:' + attribute; }), state === 'empty');
        assert(!blocks.some(function(block) { return block.id.startsWith('course:' + attribute + ':'); }));
      });
    });
  });

  it('resolves main-library IDs and paths but reports external, ambiguous and unsupported image references', async function() {
    var h = fixture(), getStorage = filestorage.getStorage, reads = 0;
    filestorage.getStorage = function(repository, callback) {
      callback(null, { getFileContents: function(file, callback) { reads++; callback(null, png); } });
    };
    try {
      var images = [IMAGE, '/api/asset/serve/' + IMAGE, 'assets/example.png', 'course/assets/example.png',
        'https://example.com/image.png', '/etc/image.png', 'assets/duplicate.png', 'assets/vector.svg']
        .map(function(src) { return { src: src }; });
      var assets = h.records.asset.concat([
        { filename: 'duplicate.png' }, { filename: 'duplicate.png' },
        { filename: 'vector.svg', mimeType: 'image/svg+xml' }
      ]);
      await wordImages.load(images, null, assets);
      images.slice(0, 4).forEach(function(image) { assert(image.options.data.equals(png)); });
      images.slice(4).forEach(function(image) { assert(image.error); });
      assert(images[6].error.includes('multiple'));
      assert(images[7].error.includes('support'));
      assert.strictEqual(reads, 4);
    } finally { filestorage.getStorage = getStorage; }
  });

  [
    function(h) { h.records.config = []; },
    function(h) { h.records.component[0]._parentId = 'missing'; },
    function(h) { h.plugins.componenttype = []; },
    function(h) { h.readError = 'article'; }
  ].forEach(function(breakSource, index) {
    it('reports invalid or unreadable course content explicitly (' + index + ')', async function() {
      var h = fixture();
      breakSource(h);
      await assert.rejects(generate(h), /configuration|detached|schema|Read failed/);
    });
  });
});

function routeHarness() {
  var h = { routes: {}, user: { _id: 'user', tenant: { _id: 'tenant' } }, roleAllowed: true, courseAllowed: true,
    course: { _id: 'course', _tenantId: 'tenant', title: 'E-bikes', tags: [{ title: 'Training' }] }, reads: 0, generated: 0 };
  var schemaDb = {};
  var db = { retrieve: function(type, query, options, callback) {
    h.reads++;
    assert.strictEqual(type, 'course');
    assert.strictEqual(query._tenantId, 'tenant');
    callback(h.readError, h.course ? [h.course] : []);
  } };
  load('routes/document-export/index.js', {
    express: function() { return { get: function(route, callback) { h.routes[route] = callback; } }; },
    '../../lib/database': { getDatabase: function(callback, tenant) {
      assert(['tenant', 'master'].includes(tenant)); callback(null, tenant === 'master' ? schemaDb : db);
    } },
    '../../lib/permissions': {
      ignoreRoute: function() {}, buildResourceString: function(tenant, resource) { return tenant + resource; },
      hasPermission: function(user, action, resource, callback) {
        assert.strictEqual(action, 'read'); callback(null, h.roleAllowed);
      }
    },
    '../../lib/usermanager': { getCurrentUser: function() { return h.user; } },
    '../../lib/configuration': { getConfig: function(key) { assert.strictEqual(key, 'dbName'); return 'master'; } },
    '../../lib/logger': { log: function() {} }, '../../lib/lightcourse/documentGenerator': {},
    '../../lib/storyboard': { generate: function(course, actualDb, actualSchemaDb, schemas, callback) {
      h.generated++;
      assert.strictEqual(actualDb, db); assert.strictEqual(actualSchemaDb, schemaDb);
      callback(h.generateError, Buffer.from('storyboard'));
    }, generateRead: function(course, actualDb, actualSchemaDb, schemas, callback, options) {
      h.generated++; h.options = options;
      assert.strictEqual(actualDb, db); assert.strictEqual(actualSchemaDb, schemaDb);
      callback(h.generateError, { title: 'E-bikes', entries: [] });
    }, generateReadDocx: function(course, actualDb, actualSchemaDb, schemas, callback, options) {
      h.generated++; h.options = options;
      assert.strictEqual(actualDb, db); assert.strictEqual(actualSchemaDb, schemaDb);
      callback(h.generateError, Buffer.from('content-only'));
    } },
    '../../': function() { return { contentmanager: {
      _contentSchemas: {}, getContentPlugin: function(type, callback) {
        assert.strictEqual(type, 'course');
        callback(null, { hasPermission: function(action, user, tenant, course, next) { next(null, h.courseAllowed); } });
      },
      create: function() { assert.fail('Full storyboard exports must not create light-course records'); }
    } }; }
  });
  h.request = function(tenant, query, preview) {
    return new Promise(function(resolve) {
      var res = { code: 200, headers: {},
        status: function(code) { this.code = code; return this; },
        setHeader: function(key, value) { this.headers[key] = value; },
        send: function(output) { resolve({ status: this.code, output: output, headers: this.headers }); },
        json: function(body) { resolve({ status: this.code, body: body, headers: this.headers }); }
      };
      h.routes['/document-export/:tenant/:id/' + (preview ? 'content-preview' : 'storyboard.docx')]({
        params: { tenant: tenant || 'tenant', id: 'course' }, query: query || {}
      }, res);
    });
  };
  h.requestPreview = function(query) { return h.request('tenant', query, true); };
  return h;
}

describe('full-course storyboard route', function() {
  it('downloads DOCX using course access, tenant data, master schemas and a safe tagged filename', async function() {
    var h = routeHarness(), result = await h.request();
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert(result.headers['Content-Disposition'].includes('Training_E-bikes_storyboard.docx'));
    assert.strictEqual(result.output.toString(), 'storyboard');
  });
  it('rejects anonymous, cross-tenant, read-denied and unshared-course requests without generating a document', async function() {
    var h = routeHarness();
    h.user = null; assert.strictEqual((await h.request()).status, 401);
    h.user = { _id: 'user', tenant: { _id: 'other' } }; assert.strictEqual((await h.request()).status, 401);
    h.user.tenant._id = 'tenant'; h.roleAllowed = false; assert.strictEqual((await h.request()).status, 403);
    assert.strictEqual(h.reads, 0);
    h.roleAllowed = true; h.courseAllowed = false; assert.strictEqual((await h.request()).status, 403);
    assert.strictEqual(h.generated, 0);
  });
  it('returns explicit missing-course and generation errors', async function() {
    var h = routeHarness(); h.course = null;
    assert.strictEqual((await h.request()).status, 404);
    h = routeHarness(); h.generateError = new Error('Cannot build storyboard');
    var result = await h.request();
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.body.message, 'Cannot build storyboard');
  });
});

describe('full-course content preview route', function() {
  it('uses the existing course permissions for uncached JSON and content-only Word downloads', async function() {
    var h = routeHarness(), result = await h.requestPreview({ images: 'true', screenshots: 'false' });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.title, 'E-bikes');
    assert.strictEqual(result.headers['Cache-Control'], 'no-store');
    assert.deepStrictEqual(copy(h.options), { images: true, screenshots: false });
    result = await h.requestPreview({ format: 'docx', images: 'false', screenshots: 'true' });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.output.toString(), 'content-only');
    assert(result.headers['Content-Disposition'].includes('Training_E-bikes_content-preview.docx'));
    assert.deepStrictEqual(copy(h.options), { images: false, screenshots: true });
  });

  it('rejects anonymous, cross-tenant and denied access without generating preview content', async function() {
    var h = routeHarness();
    h.user = null; assert.strictEqual((await h.requestPreview()).status, 401);
    h.user = { _id: 'user', tenant: { _id: 'other' } }; assert.strictEqual((await h.requestPreview()).status, 401);
    h.user.tenant._id = 'tenant'; h.roleAllowed = false; assert.strictEqual((await h.requestPreview()).status, 403);
    assert.strictEqual(h.reads, 0);
    h.roleAllowed = true; h.courseAllowed = false; assert.strictEqual((await h.requestPreview()).status, 403);
    assert.strictEqual(h.generated, 0);
  });

  it('rejects malformed options and explicitly reports missing courses and failed generation', async function() {
    var h = routeHarness();
    for (var query of [{ format: 'html' }, { images: 'yes' }, { screenshots: ['true', 'false'] }]) {
      assert.strictEqual((await h.requestPreview(query)).status, 400);
    }
    assert.strictEqual(h.reads, 0);
    h.course = null; assert.strictEqual((await h.requestPreview()).status, 404);
    h = routeHarness(); h.generateError = new Error('Cannot build content preview');
    var result = await h.requestPreview();
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.body.message, 'Cannot build content preview');
  });
});

describe('full-course storyboard sidebar (isolated)', function() {
  it('places Content Preview beneath Export storyboard and opens the shared overlay for the full course', function() {
    var template = fs.readFileSync(path.join(ROOT, 'frontend/src/modules/editor/global/templates/partials/part_editorCommon.hbs'), 'utf8');
    assert(template.indexOf('editor-common-sidebar-content-preview') > template.indexOf('editor-common-sidebar-storyboard'));
    assert(template.indexOf('editor-common-sidebar-content-preview') < template.indexOf('class="separator"'));
    assert(template.includes("app.contentpreview"));
    var opened, modalView = {}, course = new Backbone.Model({ _id: 'course' });
    var proto = load('frontend/src/modules/sidebar/views/sidebarItemView.js', {
      'core/origin': {
        editor: { data: { course: course } }, sessionModel: { get: function() { return 'tenant'; } },
        l10n: { t: function(key) { return key; } },
        trigger: function(event, view, options) { opened = { event: event, view: view, options: options }; }
      },
      'core/views/originView': { extend: function(proto) { return proto; } },
      './sidebarFieldsetFilterView': {}, backbone: {}, 'core/helpers': {},
      'modules/lightCourseEditor/views/lightCourseReadView': modalView
    });
    proto[proto.events['click button.editor-common-sidebar-content-preview']]();
    assert.strictEqual(opened.event, 'modal:open');
    assert.strictEqual(opened.view, modalView);
    assert.strictEqual(opened.options.model, course);
    assert.strictEqual(opened.options.sourceUrl, 'document-export/tenant/course/content-preview');
    assert.strictEqual(opened.options._shouldShowDoneButton, false);
    var prepared = false;
    opened.options.prepare(function() { prepared = true; });
    assert(prepared);
  });

  it('places the translated export-only button immediately after source export and wires its sidebar event', function() {
    var template = fs.readFileSync(path.join(ROOT, 'frontend/src/modules/editor/global/templates/partials/part_editorCommon.hbs'), 'utf8');
    assert(template.indexOf('editor-common-sidebar-storyboard') > template.indexOf('editor-common-sidebar-export'));
    assert(template.indexOf('editor-common-sidebar-storyboard') < template.indexOf('class="separator"'));
    assert(template.includes("app.exportstoryboard"));
    var event;
    var proto = load('frontend/src/modules/sidebar/views/sidebarItemView.js', {
      'core/origin': { trigger: function(name) { event = name; } },
      'core/views/originView': { extend: function(proto) { return proto; } },
      './sidebarFieldsetFilterView': {}, backbone: {}, 'core/helpers': {},
      'modules/lightCourseEditor/views/lightCourseReadView': {}
    });
    proto[proto.events['click button.editor-common-sidebar-storyboard']]();
    assert.strictEqual(event, 'editorCommon:storyboard');
  });
  it('prevents duplicate downloads, restores the button on failure and aborts when leaving the editor', function() {
    var options, calls = 0, aborted = 0, alerts = [], removed = false;
    var elements = {};
    function $(selector) {
      return elements[selector] || (elements[selector] = {
        prop: function(key, value) { this[key] = value; return this; }, addClass: function() { return this; }, removeClass: function() { return this; }
      });
    }
    var course = new Backbone.Model({ _id: 'course', title: 'E-bikes' });
    var proto = load('frontend/src/modules/editor/global/views/editorView.js', {
      backbone: Backbone, 'core/origin': { editor: { data: { course: course } }, sessionModel: { get: function() { return 'tenant'; } },
        l10n: { t: function(key) { return key; } }, Notify: { alert: function(alert) { alerts.push(alert); } } },
      'core/helpers': {}, './editorOriginView': { extend: function(proto) { return proto; }, prototype: { remove: function() { removed = true; } } },
      '../../contentObject/views/editorMenuView': {}, '../../contentObject/views/editorPageView': {},
      'core/models/contentObjectModel': {}, 'core/models/articleModel': {}, 'core/models/blockModel': {}, 'core/models/componentModel': {},
      'modules/lightCourseEditor/wordExport': function(model, actual) {
        calls++; assert.strictEqual(model, course); options = actual; return { abort: function() { aborted++; } };
      }
    }, { $: $ });
    var view = Object.create(proto);
    view.exportStoryboard(); view.exportStoryboard();
    assert.strictEqual(calls, 1);
    assert.strictEqual(options.url, 'document-export/tenant/course/storyboard.docx');
    assert.strictEqual(options.filename, 'E-bikes_storyboard.docx');
    assert.strictEqual(elements['.editor-common-sidebar-storyboard'].disabled, true);
    options.error({ responseJSON: { message: 'Export failed' } });
    assert.strictEqual(alerts[0].text, 'Export failed');
    assert.strictEqual(elements['.editor-common-sidebar-storyboard'].disabled, false);
    view.exportStoryboard(); options.success(); assert.strictEqual(view.storyboardPending, false);
    view.exportStoryboard(); view.remove();
    assert.strictEqual(aborted, 1); assert.strictEqual(removed, true); assert.strictEqual(options.isDisposed(), true);
  });
});
