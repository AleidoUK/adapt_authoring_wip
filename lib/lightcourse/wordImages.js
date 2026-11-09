var parseDocument = require('htmlparser2').parseDocument;
var imageSize = require('image-size');
var filestorage = require('../filestorage');

function collect(value, schema, path, images) {
  if (value == null || !schema) return;
  var input = schema.inputType && typeof schema.inputType === 'object' ? schema.inputType.type : schema.inputType;
  if (typeof value === 'string' && (input === 'Asset:image' || input === 'LightCourseAsset:image' ||
      input === 'Asset' || schema._backboneForms === 'Asset')) {
    if (value) images.push({ path: path, src: value });
    return;
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach(function(item, index) { collect(item, schema.items, path + '[' + index + ']', images); });
  } else if (typeof value === 'object' && schema.properties) {
    Object.keys(schema.properties).forEach(function(key) {
      var start = images.length;
      collect(value[key], schema.properties[key], path ? path + '.' + key : key, images);
      if (key === 'src' && images.length > start) images[start].alt = value.alt || '';
    });
  }
}

function componentImages(schema, node) {
  var properties = Object.assign({}, schema.properties,
    schema.properties && schema.properties.properties && schema.properties.properties.properties);
  delete properties.properties;
  var images = node.screenshotAssetId ? [{
    path: 'screenshotAssetId', src: node.screenshotAssetId, alt: 'Component screenshot'
  }] : [];
  collect(node, { properties: properties }, '', images);
  return images;
}

function htmlImages(fields) {
  var images = [];
  function walk(nodes, path) {
    (nodes || []).forEach(function(node) {
      if (node.name === 'img' && node.attribs.src) {
        images.push({ path: path, src: node.attribs.src, alt: node.attribs.alt || '' });
      } else if (!['script', 'style'].includes(node.name)) walk(node.children, path);
    });
  }
  (fields || []).forEach(function(field) {
    if (field.richText) walk(parseDocument(field.text || '').children, field.path);
  });
  return images;
}

async function load(images, db, imageAssets) {
  var cache = new Map();
  async function resolve(src) {
    // Resolve only managed assets in the current tenant DB, never arbitrary URLs or file paths.
    var assets;
    if (imageAssets) {
      var id = /^(?:\/?api\/asset\/serve\/)?([a-f0-9]{24})$/i.exec(src);
      var filename = /^(?:course\/)?assets\/([^/?#]+)$/.exec(src);
      var name = filename && decodeURIComponent(filename[1]);
      assets = imageAssets.filter(function(asset) {
        return id && String(asset._id).toLowerCase() === id[1].toLowerCase() || name && asset.filename === name;
      });
      if (assets.length > 1) throw new Error('The image reference matches multiple assets.');
    } else {
      var match = /^(?:\/?api\/content\/lightcourseasset\/)?([a-f0-9]{24})(?:\/serve)?$/i.exec(src);
      if (!match) throw new Error('This image is not a managed light course asset.');
      assets = await new Promise(function(resolve, reject) {
        db.retrieve('lightcourseasset', { _id: match[1] }, { jsonOnly: true }, function(error, records) {
          if (error) reject(error); else resolve(records);
        });
      });
    }
    var asset = assets && assets[0];
    if (!asset) throw new Error('The image asset is no longer available.');
    if (!/^image\/(?:png|jpeg|gif|bmp)$/i.test(asset.mimeType || '')) {
      throw new Error('Word image previews support PNG, JPEG, GIF and BMP files.');
    }
    var storage = await new Promise(function(resolve, reject) {
      filestorage.getStorage(asset.repository, function(error, storage) {
        if (error) reject(error); else resolve(storage);
      });
    });
    var buffer = await new Promise(function(resolve, reject) {
      storage.getFileContents(asset.path, function(error, buffer) {
        if (error) reject(error); else resolve(buffer);
      });
    });
    var size = imageSize(buffer);
    if (!['png', 'jpg', 'gif', 'bmp'].includes(size.type) || !(size.width > 0 && size.height > 0)) {
      throw new Error('The image format or dimensions are not supported by Word.');
    }
    var scale = Math.min(1, 600 / size.width, 600 / size.height);
    return { data: buffer, type: size.type, transformation: {
      width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale))
    } };
  }
  for (var image of images) {
    if (!cache.has(image.src)) {
      cache.set(image.src, resolve(image.src).then(function(value) { return { value: value }; },
        function(error) { return { error: error.message }; }));
    }
    var result = await cache.get(image.src);
    if (result.error) image.error = result.error;
    else image.options = result.value;
  }
}

module.exports = { componentImages: componentImages, htmlImages: htmlImages, load: load };
