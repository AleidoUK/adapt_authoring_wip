var wordcount = require('./lightcoursewordcount');
var wordFields = require('./lightcourse/wordFields');
var wordImages = require('./lightcourse/wordImages');
var wordDocument = require('./lightcourse/wordDocument');
var wordContent = require('./lightcourse/wordContent');

function retrieve(db, type, query, options) {
  return new Promise(function(resolve, reject) {
    db.retrieve(type, query, Object.assign({ jsonOnly: true }, options), function(error, records) {
      if (error) reject(error); else resolve(records);
    });
  });
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }

function enabledExtensions(config) {
  return Object.values(config._enabledExtensions || {}).map(function(plugin) {
    return typeof plugin === 'string' ? plugin : plugin.targetAttribute;
  });
}

function schemaFor(type, node, baseSchemas, plugins, config) {
  if (!baseSchemas[type]) throw new Error('The storyboard schema is unavailable for ' + type + '.');
  var schema = copy(baseSchemas[type]);
  if (type === 'component') {
    var component = plugins.componenttype.find(function(plugin) { return plugin.component === node._component; });
    if (!component) throw new Error('The component schema is unavailable for ' + node._component + '.');
    Object.assign(schema.properties, copy(component.properties || {}));
    Object.assign(schema.properties, schema.properties.properties && schema.properties.properties.properties);
    delete schema.properties.properties;
  }
  var enabled = enabledExtensions(config);
  [
    { type: 'extensiontype', property: '_extensions', name: 'extension' },
    { type: 'menutype', property: 'menuSettings', name: 'menu' },
    { type: 'themetype', property: 'themeSettings', name: 'theme' }
  ].forEach(function(source) {
    plugins[source.type].forEach(function(plugin) {
      var selected = source.type === 'extensiontype' ? enabled.includes(plugin.targetAttribute || '_' + plugin.extension) :
        plugin.name === config['_' + source.name];
      if (!selected) return;
      var locations = plugin.properties && plugin.properties.pluginLocations;
      var properties = locations && locations.properties || {};
      var location = Object.assign({}, properties[type] && properties[type].properties,
        type === 'component' && properties[node._component] && properties[node._component].properties);
      if (Object.keys(location).length) {
        var target = schema.properties[source.property] || { type: 'object', properties: {} };
        target.properties = Object.assign({}, target.properties, copy(location));
        schema.properties[source.property] = target;
      }
    });
  });
  return schema;
}

async function build(course, db, schemaDb, baseSchemas) {
  var types = ['contentobject', 'article', 'block', 'component', 'config'];
  var pluginTypes = ['componenttype', 'extensiontype', 'menutype', 'themetype'];
  var results = await Promise.all(types.map(function(type) {
    return retrieve(db, type, { _courseId: course._id }, { operators: { sort: { _sortOrder: 1 } } });
  }).concat(pluginTypes.map(function(type) { return retrieve(schemaDb, type, {}); }), [
    retrieve(db, 'asset', {}, { fields: '_id filename path repository mimeType' })
  ]));
  var content = {}, plugins = {};
  types.forEach(function(type, index) { content[type] = results[index]; });
  pluginTypes.forEach(function(type, index) { plugins[type] = results[types.length + index]; });
  if (content.config.length !== 1) throw new Error('The storyboard requires a unique course configuration.');
  var config = content.config[0], blocks = [], seen = new Set();
  function add(type, stored, level, heading) {
    var node = Object.assign({}, stored, type === 'component' ? stored.properties : {});
    var schema = schemaFor(type, node, baseSchemas, plugins, config);
    var component = type === 'component' ? wordContent.component(schema, node) : null;
    var uniqueId = node.uniqueId || node._extensions && node._extensions._uniqueId && node._extensions._uniqueId._id;
    node.uniqueId = uniqueId || '';
    var fields = component ? component.fields :
      wordcount.walkTranslatableFields(schema, node).map(function(field) {
      return wordFields.field(field.path, field.text, /(?:^|\.)(?:body|instruction|pageBody)$/.test(field.path));
    });
    if (type !== 'component' && uniqueId) fields.unshift(wordFields.field('uniqueId', uniqueId, false));
    var images = component ? component.images : wordImages.componentImages(schema, node);
    blocks.push({ id: String(node._id), level: level, heading: heading, fields: fields,
      layout: component ? node._layout || 'full' : undefined,
      headingLevel: type === 'component' ? 2 : level,
      wordCount: component ? component.wordCount : undefined,
      images: images });
  }
  function fieldsFor(node, paths) {
    return paths.filter(function(path) { return typeof node[path] === 'string'; }).map(function(path) {
      return wordFields.field(path, node[path], false);
    });
  }
  blocks.push({ id: String(course._id), level: 1, heading: 'Course content',
    fields: fieldsFor(course, ['title', 'displayTitle']) });
  function addExtension(attribute, heading, itemsPath, titlePath) {
    var extension = course._extensions && course._extensions[attribute];
    if (!enabledExtensions(config).includes(attribute) || !extension || extension._isEnabled === false) return;
    var id = String(course._id) + ':' + attribute;
    blocks.push({ id: id, level: 1, heading: heading,
      fields: fieldsFor(extension, ['title', 'displayTitle', 'description', 'body', 'instruction']) });
    (extension[itemsPath] || []).forEach(function(item, index) {
      var fields = wordFields.fixedFields(item, titlePath, 'description');
      if (attribute === '_resources') fields = fields.concat(fieldsFor(item, ['filename', '_link']));
      blocks.push({ id: id + ':' + index, level: 5, headingLevel: 2, heading: wordFields.plainText(item[titlePath]),
        fields: fields, images: item._graphic && item._graphic.src ? [{
          path: '_graphic.src', src: item._graphic.src, alt: item._graphic.alt || ''
        }] : [] });
    });
  }
  addExtension('_resources', 'Resources', '_resourcesItems', 'title');
  addExtension('_glossary', 'Glossary', '_glossaryItems', 'term');
  function children(type, parentId, level, position) {
    var nodes = content[type].filter(function(node) { return String(node._parentId) === String(parentId); })
      .sort(function(a, b) { return (a._sortOrder || 0) - (b._sortOrder || 0); });
    nodes.forEach(function(node, index) {
      var id = String(node._id);
      if (seen.has(id)) throw new Error('The course contains duplicate or cyclic storyboard elements.');
      seen.add(id);
      var location = position ? position + '.' + (index + 1) : String(index + 1);
      if (type === 'contentobject') {
        var label = node._type === 'menu' ? 'Menu' : 'Page';
        add(type, node, level, label + ' ' + location);
      } else if (type === 'component') {
        var component = plugins.componenttype.find(function(plugin) { return plugin.component === node._component; });
        var heading = component && component.displayName || node._component.replace(/^./, function(letter) { return letter.toUpperCase(); });
        add(type, node, level, heading);
      }
      if (type === 'contentobject') {
        children('contentobject', id, 1, location);
        children('article', id, 2, location);
      } else if (type === 'article') children('block', id, 3, location);
      else if (type === 'block') children('component', id, 4, location);
    });
  }
  children('contentobject', course._id, 1, '');
  var total = types.slice(0, 4).reduce(function(count, type) { return count + content[type].length; }, 0);
  if (seen.size !== total) throw new Error('Some course elements are detached from the course structure. Repair them before exporting the storyboard.');
  var totalWordCount = blocks.reduce(function(count, block) {
    if (block.wordCount !== undefined) return count + block.wordCount;
    return count + block.fields.reduce(function(words, field) {
      if (['uniqueId', 'graphicsNotes', 'developerNotes', 'filename', '_link'].includes(field.path)) return words;
      return words + wordcount.countWords(field.text);
    }, 0);
  }, 0);
  return { data: { title: wordFields.plainText(course.title), tags: course.tags, storyboard: true,
    totalWordCount: totalWordCount,
    imageAssets: results[results.length - 1] }, blocks: blocks };
}

function generate(course, db, schemaDb, baseSchemas, callback) {
  build(course, db, schemaDb, baseSchemas).then(function(result) {
    wordDocument.generate(result.data, result.blocks, callback, db);
  }, callback);
}

module.exports = { generate: generate };
