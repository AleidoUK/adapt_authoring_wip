var schema = require('./conversionSchema');
var fs = require('fs-extra');
var database = require('../database');

async function expand(definition, seen) {
  if (!definition.$ref) return definition;
  seen = seen || [];
  if (seen.includes(definition.$ref)) throw new Error('Circular content schema reference: ' + definition.$ref);
  var filename = database.resolveSchemaPath(definition.$ref);
  if (!filename) throw new Error('Unresolved content schema: ' + definition.$ref);
  var parent = await expand(await fs.readJson(filename), seen.concat(definition.$ref));
  return Object.assign({}, parent, definition, {
    properties: Object.assign({}, parent.properties, definition.properties),
    required: Array.from(new Set((Array.isArray(parent.required) ? parent.required : [])
      .concat(Array.isArray(definition.required) ? definition.required : [])))
  });
}

function retrieve(db, type) {
  return new Promise(function(resolve, reject) {
    db.retrieve(type, {}, { jsonOnly: true }, function(error, records) {
      if (error) reject(error); else resolve(records || []);
    });
  });
}
async function load(db, contentSchemas) {
  var catalog = { core: {}, component: {}, extension: {}, menu: {}, theme: {} };
  await Promise.all(['course', 'config', 'contentobject', 'article', 'block', 'component'].map(async function(type) {
    var definition = contentSchemas[type];
    if (!definition) throw new Error('Missing installed content schema: ' + type);
    catalog.core[type] = await expand(definition.properties ? definition : { properties: definition });
  }));
  await Promise.all(['component', 'extension', 'menu', 'theme'].map(async function(type) {
    var records = await retrieve(db, type + 'type');
    records.forEach(function(record) { catalog[type][record[type]] = record; });
  }));
  return catalog;
}
function definitions(catalog) {
  var groups = [];
  Object.keys(catalog.core).forEach(function(type) {
    groups.push({ key: 'core:' + type, label: type, schema: catalog.core[type] });
  });
  Object.keys(catalog.component).forEach(function(key) {
    var record = catalog.component[key];
    groups.push({ key: 'component:' + key, label: record.displayName || key,
      schema: { properties: record.properties || {} } });
  });
  ['extension', 'menu', 'theme'].forEach(function(type) {
    Object.keys(catalog[type]).forEach(function(key) {
      var record = catalog[type][key];
      var locations = record.properties && record.properties.pluginLocations;
      Object.keys(locations && locations.properties || {}).forEach(function(location) {
        groups.push({ key: type + ':' + key + ':' + location,
          label: (record.displayName || key) + ' / ' + location,
          schema: locations.properties[location] });
      });
    });
  });
  return groups.map(function(group) {
    var fields = schema.fields(group.schema);
    if (group.key.startsWith('component:')) {
      Object.keys(group.schema.properties).forEach(function(path) {
        var field = group.schema.properties[path];
        if (!schema.questionOption(field, path)) return;
        var existing = fields.find(function(entry) { return entry.path === path; });
        if (existing) existing.questionOption = true;
        else fields.push({ path: path, schema: schema.editorSchema(field), questionOption: true });
      });
    }
    if (group.key === 'core:component' || group.key.startsWith('component:')) {
      fields.forEach(function(field) {
        if (['_supportedLayout', '_items'].includes(field.path)) field.hidden = true;
      });
    }
    fields.forEach(function(field) {
      if (field.hidden || !field.schema.properties && !field.schema.items) return;
      if (!fields.some(function(child) {
        return !child.hidden && (child.path.startsWith(field.path + '.') || child.path.startsWith(field.path + '[]'));
      })) return;
      field.hidden = true;
      field.duplicateContainer = true;
    });
    return { key: group.key, label: group.label, fields: fields };
  }).filter(function(group) { return group.fields.length; });
}
module.exports = { load: load, definitions: definitions };
