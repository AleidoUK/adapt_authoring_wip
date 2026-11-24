var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var unzipper = require('unzipper');
var archiver = require('archiver');
var XMLParser = require('fast-xml-parser').XMLParser;
var filestorage = require('../lib/filestorage');
var wordImages = require('../lib/lightcourse/wordImages');
var generator = require('../lib/lightcourse/documentGenerator');
var importer = require('../lib/lightcourse/documentImport');

var assetId = '1234567890abcdef12345678';
var png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=', 'base64');
var graphic = { type: 'object', properties: {
  src: { type: 'string', inputType: { type: 'Asset:image' } },
  alt: { type: 'string', translatable: true }
} };
var schema = { properties: {
  instruction: { type: 'string', translatable: true },
  _graphic: graphic,
  _items: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string', translatable: true },
    body: { type: 'string', translatable: true },
    _graphic: graphic
  } } },
  audioSrc: { type: 'string', inputType: 'Asset:audio' }
} };

function call(fn, args) {
  return new Promise(function(resolve, reject) {
    fn.apply(null, args.concat(function(error, result) { if (error) reject(error); else resolve(result); }));
  });
}

describe('Word image previews', function() {
  it('collects an optional screenshot independently of the installed component schema', function() {
    assert.deepStrictEqual(wordImages.componentImages({}, { screenshotAssetId: assetId }), [
      { path: 'screenshotAssetId', src: assetId, alt: 'Component screenshot' }
    ]);
    assert.deepStrictEqual(wordImages.componentImages({}, { screenshotAssetId: '' }), []);
  });

  it('collects multiple component and nested item ideas only for light-course exports', function() {
    var node = { _lightCourseIdeaAssets: [{ src: assetId }, { src: assetId }],
      _items: [{ title: 'First', _lightCourseIdeaAssets: [{ src: assetId }] }],
      _componentSchemaSnapshot: { _lightCourseIdeaAssets: [{ src: assetId }] } };
    assert.deepStrictEqual(wordImages.componentImages(schema, node), []);
    var ideas = wordImages.componentImages(schema, node, true);
    assert.deepStrictEqual(ideas.map(function(image) { return image.path; }),
      ['_lightCourseIdeaAssets', '_lightCourseIdeaAssets', '_items[0]._lightCourseIdeaAssets']);
    assert(ideas.every(function(image) { return image.idea && image.src === assetId; }));
    assert.deepStrictEqual(ideas.map(function(image) { return image.ideaTarget; }),
      ['Component', 'Component', 'Item 1: First']);
  });

  it('collects schema-declared images, nested items and flattened plugin properties without audio or unrelated strings', function() {
    var images = wordImages.componentImages({ properties: Object.assign({}, schema.properties, {
      properties: { properties: { logo: { type: 'string', _backboneForms: 'Asset' } } }
    }) }, {
      _graphic: { src: assetId, alt: 'Graphic description' },
      _items: [{ _graphic: { src: assetId, alt: 'Item description' } }],
      logo: assetId, audioSrc: assetId, title: assetId
    });
    assert.deepStrictEqual(images.map(function(image) { return image.path; }), ['_graphic.src', '_items[0]._graphic.src', 'logo']);
    assert.strictEqual(images[0].alt, 'Graphic description');
    assert.strictEqual(images[1].alt, 'Item description');
  });

  it('shows only the Splash large graphic and excludes extension asset fields', function() {
    var asset = { type: 'string', inputType: { type: 'Asset:image' } };
    var splashSchema = { properties: {
      _graphic: { type: 'object', properties: {
        _large: asset, _medium: asset, _smallPortrait: asset
      } },
      _extensions: { type: 'object', properties: { _menuButton: { type: 'object', properties: { icon: asset } } } }
    } };
    var images = wordImages.componentImages(splashSchema, { _component: 'splash',
      _graphic: { _large: assetId, _medium: assetId, _smallPortrait: assetId },
      _extensions: { _menuButton: { icon: assetId } } });
    assert.deepStrictEqual(images.map(function(image) { return image.path; }), ['_graphic._large']);
    assert(wordImages.filterComponentImages([
      { path: '_graphic._large', src: assetId }, { path: '_graphic._medium', src: assetId }
    ], { _component: 'Splash' }).every(function(image) { return image.path === '_graphic._large'; }));
  });

  it('finds rich-text image sources and decoded alt text without treating plain text as HTML', function() {
    assert.deepStrictEqual(wordImages.htmlImages([
      { path: 'body', richText: true, text: '<p>Text<img src="api/content/lightcourseasset/' + assetId + '/serve" alt="A &amp; B"></p>' },
      { path: 'title', richText: false, text: '<img src="ignored.png">' }
    ]), [{ path: 'body', src: 'api/content/lightcourseasset/' + assetId + '/serve', alt: 'A & B' }]);
  });

  it('omits image-only content from light-course storyboards without changing it on import', async function() {
    var node = { _id: 'image-only', _component: 'text', title: '', uniqueId: '',
      body: '<p><img src="/api/content/lightcourseasset/' + assetId + '/serve" alt="Image-only content"></p>',
      _graphic: { src: '', alt: 'Unused label' }, _items: [{ title: '', body: '<p>&nbsp;</p>' }] };
    var data = { _lightCourseId: 'course', title: 'Images', contentTree: { children: [
      { _id: 'page', title: '', children: [{ _id: 'article', children: [{ _id: 'block', children: [node] }] }] }
    ] } };
    var original = JSON.stringify(data), getStorage = filestorage.getStorage, imageReads = 0;
    var db = { retrieve: function(type, query, options, callback) {
      if (type === 'componenttype') return callback(null, [{ displayName: 'Text', properties: schema.properties }]);
      assert.strictEqual(type, 'lightcourseasset');
      imageReads++;
      callback(null, [{ mimeType: 'image/png', repository: 'test', path: 'image.png' }]);
    } };
    filestorage.getStorage = function(repository, callback) {
      callback(null, { getFileContents: function(file, callback) { callback(null, png); } });
    };
    try {
      var buffer = await call(generator.generateDocx, [data, db]), zip = await unzipper.Open.buffer(buffer);
      var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
      assert(xml.includes('>0 words | full<'));
      assert(!xml.includes('descr="Image-only content"'));
      assert(!xml.includes('<w:drawing>'));
      assert.strictEqual(imageReads, 0);
      assert(!xml.includes('Unused label'));
      assert(!xml.includes('Add body here'));
      var parsed = await call(generator.parseDocx, [buffer]);
      assert.deepStrictEqual(parsed.errors, []);
      assert.deepStrictEqual(parsed.blocks.find(function(block) { return block.id === node._id; }).fields, []);
      var imported = await call(importer.importDocument, [parsed, data, db]);
      assert.strictEqual(imported.success, true, JSON.stringify(imported.errors));
      assert.strictEqual(JSON.stringify(data), original);
    } finally { filestorage.getStorage = getStorage; }
  });

  it('embeds only screenshots and component/item ideas while preserving all images on Word import', async function() {
    this.timeout(10000);
    var node = { _id: 'component', _component: 'text', title: 'Title', screenshotAssetId: assetId,
      instruction: 'Original instruction', graphicsNotes: 'Configured graphics notes',
      _lightCourseIdeaAssets: [{ src: assetId, notes: '<p>Component idea note</p>' },
        { src: assetId }, { src: assetId, targetId: 'item-1', notes: '<p>Linked item note</p>' }],
      body: '<p>Caption<img src="/api/content/lightcourseasset/' + assetId + '/serve" alt="Inline"></p>',
      _graphic: { src: assetId, alt: 'Graphic description' },
      _items: [
        { title: 'First item', body: '<p>First item content</p>', _graphic: { src: assetId, alt: 'Item description' },
          _lightCourseIdeaItemId: 'item-1' },
        { title: 'Second item', body: '<p>Second item content</p>', _graphic: { src: assetId, alt: 'Second item image' } }
      ] };
    var data = { _lightCourseId: 'course', title: 'Images', contentTree: { children: [
      { _id: 'page', title: 'Page', children: [{ _id: 'article', children: [{ _id: 'block', children: [node] }] }] }
    ] }, helpContent: { items: [{ _id: 'help', title: 'Help', body: 'Help body', _graphic: { src: assetId, alt: 'Help graphic' } }] } };
    var original = JSON.stringify(data);
    var reads = 0, queries = [];
    var db = { retrieve: function(type, query, options, callback) {
      if (type === 'componenttype') return callback(null, [{ displayName: 'Text', properties: schema.properties }]);
      assert.strictEqual(type, 'lightcourseasset');
      queries.push(query);
      callback(null, [{ mimeType: 'image/png', repository: 'test', path: 'images/example.png' }]);
    } };
    var getStorage = filestorage.getStorage;
    filestorage.getStorage = function(repository, callback) {
      assert.strictEqual(repository, 'test');
      callback(null, { getFileContents: function(file, callback) {
        assert.strictEqual(file, 'images/example.png');
        reads++;
        callback(null, png);
      } });
    };
    try {
      var buffer = await call(generator.generateDocx, [data, db]);
      var zip = await unzipper.Open.buffer(buffer);
      var media = zip.files.filter(function(file) { return file.path.startsWith('word/media/') && !file.path.endsWith('/'); });
      assert.strictEqual(media.length, 1);
      assert((await media[0].buffer()).equals(png));
      var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
      assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, 4);
      assert.strictEqual((xml.match(/descr="Item idea"/g) || []).length, 3);
      ['Graphic description', 'Item description', 'Second item image', 'Inline', 'Help graphic'].forEach(function(alt) {
        assert(!xml.includes('descr="' + alt + '"'));
      });
      var metadataXml = (await zip.files.find(function(file) { return file.path === 'docProps/custom.xml'; }).buffer()).toString();
      var metadata = JSON.parse(new XMLParser().parse(metadataXml).Properties.property['vt:lpwstr']);
      function fieldIndex(path) {
        var field = metadata.fields.find(function(field) { return field.nodeId === 'component' && field.path === path; });
        assert(field, path);
        return xml.indexOf('<w:tag w:val="' + field.bookmark + '"');
      }
      assert(!metadata.fields.some(function(field) { return field.path === 'screenshotAssetId'; }));
      assert(fieldIndex('title') < xml.indexOf('descr="Component screenshot"'));
      assert(xml.indexOf('descr="Component screenshot"') < fieldIndex('body'));
      assert(fieldIndex('_items[0].body') < xml.lastIndexOf('descr="Item idea"'));
      assert(xml.lastIndexOf('descr="Item idea"') < fieldIndex('_items[1].title'));
      assert(xml.includes('Component idea note'));
      assert(xml.includes('Connect to: Component: Title'));
      assert(xml.includes('Connect to: Item 1: First item'));
      assert(xml.includes('<w:i/>'));
      var ideaTables = (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).filter(function(table) {
        return table.includes('w:name="lcidea_');
      });
      assert.strictEqual(ideaTables.length, 3);
      assert(ideaTables.every(function(table) {
        return (table.match(/<w:tc>/g) || []).length === 2 &&
          table.includes('<w:drawing>') && table.includes('<w:tcBorders>') && table.includes('<w:i/>');
      }));
      assert(xml.indexOf('Linked item note') > fieldIndex('_items[0].body'));
      assert(xml.indexOf('Linked item note') < fieldIndex('_items[1].title'));
      assert(xml.includes('>Help body</w:t>'));
      assert(!xml.includes('Image unavailable:'));
      assert(queries.every(function(query) { return query._id === assetId; }));
      assert.strictEqual(reads, 1);
      var parsed = await call(generator.parseDocx, [buffer]);
      assert.deepStrictEqual(parsed.errors, []);
      var imported = await call(importer.importDocument, [parsed, data, db]);
      assert.strictEqual(imported.success, true, JSON.stringify(imported.errors));
      assert.strictEqual(JSON.stringify(data), original);
      assert.strictEqual(JSON.stringify(imported.snapshot), original);
      var archive = archiver('zip'), chunks = [];
      var edited = new Promise(function(resolve, reject) {
        archive.on('data', function(chunk) { chunks.push(chunk); });
        archive.on('end', function() { resolve(Buffer.concat(chunks)); });
        archive.on('error', reject);
      });
      for (var file of zip.files) {
        var bytes = await file.buffer();
        if (file.path === 'word/document.xml') {
          assert(bytes.toString().includes('>Original instruction</w:t>'));
          bytes = bytes.toString().replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, '')
            .replace('>Linked item note</w:t>', '>Changed idea note</w:t>')
            .replace('>Connect to: Item 1: First item</w:t>', '>Changed link</w:t>')
            .replace('>Original instruction</w:t>', '>Edited instruction</w:t>');
        }
        archive.append(bytes, { name: file.path });
      }
      archive.finalize();
      var changed = await call(importer.importDocument, [await call(generator.parseDocx, [await edited]), data, db]);
      assert.strictEqual(changed.success, true, JSON.stringify(changed.errors));
      var changedNode = changed.snapshot.contentTree.children[0].children[0].children[0].children[0];
      assert.strictEqual(changedNode.instruction, '<p>Edited instruction</p>');
      assert.strictEqual(changedNode.screenshotAssetId, assetId);
      assert.deepStrictEqual(changedNode._graphic, node._graphic);
      assert.deepStrictEqual(changedNode._items, node._items);
      assert.deepStrictEqual(changedNode._lightCourseIdeaAssets, node._lightCourseIdeaAssets);
    } finally {
      filestorage.getStorage = getStorage;
    }
  });

  it('uses proportional page bounds without upscaling and reuses duplicate references', async function() {
    var filename = path.join(__dirname, '../lib/lightcourse/wordImages.js');
    var module = { exports: {} }, reads = 0;
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module, require: function(name) {
      if (name === './wordFields') return require('../lib/lightcourse/wordFields');
      if (name === '../../frontend/src/modules/lightCourseEditor/ideaLinks') return require('../frontend/src/modules/lightCourseEditor/ideaLinks');
      if (name === 'image-size') return function() { return { type: 'png', width: 1200, height: 800 }; };
      if (name === '../filestorage') return { getStorage: function(repository, callback) {
        callback(null, { getFileContents: function(file, callback) { reads++; callback(null, png); } });
      } };
      return require(name);
    } }, { filename: filename });
    var images = [{ src: assetId }, { src: assetId }];
    await module.exports.load(images, { retrieve: function(type, query, options, callback) {
      callback(null, [{ mimeType: 'image/png' }]);
    } });
    assert.strictEqual(images[0].options.transformation.width, 300);
    assert.strictEqual(images[0].options.transformation.height, 200);
    assert.strictEqual(reads, 1);
  });

  it('retains the height limit, does not upscale small images and caps wide images at half the usable page width', async function() {
    var filename = path.join(__dirname, '../lib/lightcourse/wordImages.js');
    for (var dimensions of [
      { width: 400, height: 1600, expectedWidth: 150, expectedHeight: 600 },
      { width: 80, height: 40, expectedWidth: 80, expectedHeight: 40 },
      { width: 1200, height: 200, expectedWidth: 300, expectedHeight: 50 }
    ]) {
      var module = { exports: {} };
      vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module, require: function(name) {
        if (name === './wordFields') return require('../lib/lightcourse/wordFields');
        if (name === '../../frontend/src/modules/lightCourseEditor/ideaLinks') return require('../frontend/src/modules/lightCourseEditor/ideaLinks');
        if (name === 'image-size') return function() { return Object.assign({ type: 'png' }, dimensions); };
        if (name === '../filestorage') return { getStorage: function(repository, callback) {
          callback(null, { getFileContents: function(file, callback) { callback(null, png); } });
        } };
        return require(name);
      } }, { filename: filename });
      var images = [{ src: assetId }];
      await module.exports.load(images, { retrieve: function(type, query, options, callback) {
        callback(null, [{ mimeType: 'image/png' }]);
      } });
      assert.strictEqual(images[0].options.transformation.width, dimensions.expectedWidth);
      assert.strictEqual(images[0].options.transformation.height, dimensions.expectedHeight);
    }
  });

  it('writes screenshots no wider than half the actual Word text area', async function() {
    var width = 1200, height = 800, stride = Math.ceil(width * 3 / 4) * 4;
    var bitmap = Buffer.alloc(54 + stride * height);
    bitmap.write('BM');
    bitmap.writeUInt32LE(bitmap.length, 2);
    bitmap.writeUInt32LE(54, 10);
    bitmap.writeUInt32LE(40, 14);
    bitmap.writeInt32LE(width, 18);
    bitmap.writeInt32LE(height, 22);
    bitmap.writeUInt16LE(1, 26);
    bitmap.writeUInt16LE(24, 28);
    bitmap.writeUInt32LE(stride * height, 34);
    var node = { _id: 'component', _component: 'text', title: 'Images', screenshotAssetId: assetId,
      body: '<p><img src="/api/content/lightcourseasset/' + assetId + '/serve"></p>',
      _graphic: { src: assetId },
      _items: [{ title: 'Item', _graphic: { src: assetId } }]
    };
    var data = { _lightCourseId: 'course', title: 'Images', contentTree: { children: [
      { _id: 'page', children: [{ _id: 'article', children: [{ _id: 'block', children: [node] }] }] }
    ] } };
    var db = { retrieve: function(type, query, options, callback) {
      callback(null, type === 'componenttype' ? [{ displayName: 'Text', properties: schema.properties }] :
        [{ mimeType: 'image/bmp', repository: 'test', path: 'image.bmp' }]);
    } };
    var getStorage = filestorage.getStorage;
    filestorage.getStorage = function(repository, callback) {
      callback(null, { getFileContents: function(file, callback) { callback(null, bitmap); } });
    };
    try {
      var zip = await unzipper.Open.buffer(await call(generator.generateDocx, [data, db]));
      var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
      var body = new XMLParser({ ignoreAttributes: false }).parse(xml)['w:document']['w:body'];
      var section = body['w:sectPr'], page = section['w:pgSz'], margins = section['w:pgMar'];
      var halfWidthEmu = (Number(page['@_w:w']) - Number(margins['@_w:left']) - Number(margins['@_w:right'])) * 635 / 2;
      var extents = Array.from(xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g));
      assert.strictEqual(extents.length, 1);
      extents.forEach(function(match) {
        assert(Number(match[1]) <= halfWidthEmu);
        assert.strictEqual(Number(match[1]), 300 * 9525);
        assert.strictEqual(Number(match[2]), 200 * 9525);
      });
    } finally { filestorage.getStorage = getStorage; }
  });

  it('reports external sources, missing assets and unsupported formats explicitly without reading arbitrary files', async function() {
    var images = [
      { src: 'https://example.com/image.png' }, { src: '/etc/example.png' },
      { src: assetId }, { src: '2234567890abcdef12345678' }
    ];
    var queries = 0;
    await wordImages.load(images, { retrieve: function(type, query, options, callback) {
      queries++;
      callback(null, query._id === assetId ? [] : [{ mimeType: 'image/webp' }]);
    } });
    assert.strictEqual(queries, 2);
    assert(images[0].error.includes('not a managed'));
    assert(images[1].error.includes('not a managed'));
    assert(images[2].error.includes('no longer available'));
    assert(images[3].error.includes('PNG, JPEG, GIF and BMP'));
    assert(images.every(function(image) { return !image.options; }));
  });

  it('shows image failures in the generated document without changing content or Word-count fields', async function() {
    var data = { title: 'Missing image', contentTree: { children: [{ _id: 'p', title: 'Page',
      body: '<p>Caption<img src="missing.png"></p>', children: [{ _id: 'a', children: [
        { _id: 'b', children: [{ _id: 'c', _component: 'text', screenshotAssetId: 'missing.png' }] }
      ] }] }] } };
    var db = { retrieve: function(type, query, options, callback) {
      callback(null, [{ properties: schema.properties }]);
    } };
    var buffer = await call(generator.generateDocx, [data, db]);
    var zip = await unzipper.Open.buffer(buffer);
    var xml = (await zip.files.find(function(file) { return file.path === 'word/document.xml'; }).buffer()).toString();
    assert(xml.includes('Image unavailable: This image is not a managed light course asset. Source: missing.png'));
    assert.strictEqual((xml.match(/Image unavailable:/g) || []).length, 1);
    assert.deepStrictEqual((await call(generator.parseDocx, [buffer])).errors, []);
  });
});
