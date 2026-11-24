var parseDocument = require('htmlparser2').parseDocument;
var imageSize = require('image-size');
var filestorage = require('../filestorage');
var docx = require('docx');
var wordFields = require('./wordFields');
var ideaLinks = require('../../frontend/src/modules/lightCourseEditor/ideaLinks');

// Page dimensions are twips; Word image dimensions are pixels (15 twips at 96 dpi).
var maxImageWidth = Math.floor((docx.sectionPageSizeDefaults.WIDTH -
  docx.sectionMarginDefaults.LEFT - docx.sectionMarginDefaults.RIGHT) / 15 / 2);
var maxSideBySideImageWidth = Math.floor(maxImageWidth / 2);

function variantPath(path) {
  var match = /^(?:(.*)\.)?(_?large|_?small)$/.exec(path);
  return match && { base: match[1] || '', variant: match[2].replace(/^_/, '') };
}

function groupVariants(images) {
  var variants = new Map(), used = new Set(), groups = [];
  images.forEach(function(image, index) {
    var match = !image.idea && variantPath(image.path);
    if (!match) return;
    var group = variants.get(match.base) || {};
    if (!group[match.variant]) group[match.variant] = { image: image, index: index };
    variants.set(match.base, group);
  });
  images.forEach(function(image, index) {
    if (used.has(index)) return;
    var match = !image.idea && variantPath(image.path), group = match && variants.get(match.base);
    var large = group && group.large, small = group && group.small;
    if (large && small && !used.has(large.index) && !used.has(small.index)) {
      used.add(large.index);
      used.add(small.index);
      if (large.image.src === small.image.src) groups.push(large.image);
      else groups.push({ type: 'imageGroup', images: [large.image, small.image] });
    } else {
      used.add(index);
      groups.push(image);
    }
  });
  return groups;
}

function flattenGroups(images) {
  return images.reduce(function(flattened, image) {
    return flattened.concat(image.type === 'imageGroup' ? image.images : [image]);
  }, []);
}

function sideBySideDimensions(width, height) {
  var scale = Math.min(1, maxSideBySideImageWidth / width);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function filterComponentImages(images, node) {
  var isSplash = String(node && node._component || '').toLowerCase() === 'splash';
  return images.filter(function(image) {
    if (wordFields.isExtensionPath(image.path) && !/(?:^|\.)_hero(?:\.|$)/i.test(image.path)) return false;
    if (!isSplash || image.idea || image.path === 'screenshotAssetId') return true;
    return /(?:^|[._])_?large$/i.test(image.path);
  });
}

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

function componentImages(schema, node, includeIdeas) {
  var properties = Object.assign({}, schema.properties,
    schema.properties && schema.properties.properties && schema.properties.properties.properties);
  delete properties.properties;
  var images = node.screenshotAssetId ? [{
    path: 'screenshotAssetId', src: node.screenshotAssetId, alt: 'Component screenshot'
  }] : [];
  collect(node, { properties: properties }, '', images);
  if (includeIdeas) {
    var itemTargets = Object.create(null), pathTargets = Object.create(null);
    ideaLinks.locations(node, 'Component', 'Item').forEach(function(target) {
      pathTargets[target.path] = target;
      if (target.val) itemTargets[target.val] = target;
    });
    function ideas(value, path) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        return value.forEach(function(item, index) { ideas(item, path + '[' + index + ']'); });
      }
      (Array.isArray(value._lightCourseIdeaAssets) ? value._lightCourseIdeaAssets : []).forEach(function(item) {
        if (!item || !item.src || item.targetId && !itemTargets[item.targetId]) return;
        var target = item.targetId ? itemTargets[item.targetId] : pathTargets[path];
        var targetPath = item.targetId ? target.path : path;
        var entry = { path: targetPath ? targetPath + '._lightCourseIdeaAssets' : '_lightCourseIdeaAssets',
          src: item.src, alt: 'Item idea', idea: true,
          ideaTarget: wordFields.plainText(target ? target.label : pathTargets[''].label) };
        if (item.notes) entry.notes = wordFields.plainText(item.notes);
        images.push(entry);
      });
      Object.keys(value).forEach(function(key) {
        if (['_lightCourseIdeaAssets', '_componentSchemaSnapshot', '_comments'].includes(key)) return;
        ideas(value[key], path ? path + '.' + key : key);
      });
    }
    ideas(node, '');
  }
  return filterComponentImages(images, node);
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
    if (!wordFields.isExtensionPath(field.path) && field.richText) {
      walk(parseDocument(field.text || '').children, field.path);
    }
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
    var scale = Math.min(1, maxImageWidth / size.width, 600 / size.height);
    return { assetId: asset._id == null ? undefined : String(asset._id), data: buffer, type: size.type, transformation: {
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
    else {
      image.assetId = result.value.assetId;
      image.options = result.value;
    }
  }
}

module.exports = {
  componentImages: componentImages,
  filterComponentImages: filterComponentImages,
  flattenGroups: flattenGroups,
  groupVariants: groupVariants,
  htmlImages: htmlImages,
  load: load,
  sideBySideDimensions: sideBySideDimensions
};
