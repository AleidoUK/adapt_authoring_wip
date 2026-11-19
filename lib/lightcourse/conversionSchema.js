var Ajv = require('ajv');
var walker = require('../schemaWalker');
var ajv = new Ajv({ allErrors: true, schemaId: 'auto', unknownFormats: 'ignore' });
var INTERNAL = ['_id', '_parentId', '_courseId', '_tenantId', '_componentType', '_type', '_component',
  '_sortOrder', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', '_trackingId', '_isDeleted', 'deletedAt', 'deletedBy'];
var QUESTION_OPTIONS = ['_canShowModelAnswer', '_canShowCorrectness', '_canShowFeedback', '_canShowMarking',
  '_shouldDisplayAttempts', '_isRandom', '_recordInteraction', '_hasItemScoring'];

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function normalize(schema) {
  schema = walker.unwrapPatch(schema) || {};
  var out = {};
  ['type', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern',
    'uniqueItems', 'format', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum'].forEach(function(key) {
    if (schema[key] !== undefined) out[key] = copy(schema[key]);
  });
  if (out.type === 'objectid') out.type = 'string';
  if (out.type === 'date') { out.type = 'string'; out.format = 'date-time'; }
  var options = schema.inputType && schema.inputType.options;
  if (Array.isArray(options) && options.every(function(option) { return typeof option === 'string'; })) out.enum = options;
  if (Array.isArray(schema.required)) out.required = schema.required.slice();
  if (schema.properties) {
    out.type = 'object';
    out.properties = {};
    Object.keys(schema.properties).forEach(function(key) {
      var field = schema.properties[key];
      out.properties[key] = normalize(field);
      if (required(field, key, schema)) out.required = Array.from(new Set((out.required || []).concat(key)));
    });
  }
  if (schema.items) out.items = normalize(schema.items);
  if (schema.validators && schema.validators.includes('required') && out.type === 'string') {
    out.minLength = Math.max(out.minLength || 0, 1);
  }
  return out;
}
function required(field, key, parent) {
  return field.required === true || Array.isArray(parent.required) && parent.required.includes(key) ||
    Array.isArray(field.validators) && field.validators.includes('required');
}
function valid(schema, value) {
  if (value === undefined || value === null || typeof value === 'string' && !value.trim()) return false;
  return ajv.validate(normalize(schema), value);
}
function itemGraphic(field, path) {
  var input = typeof field.inputType === 'object' && field.inputType ? field.inputType.type : field.inputType;
  return path.includes('[]') && walker.isAssetField(field) &&
    (input === 'Asset:image' || field._backboneForms === 'Asset');
}
function questionOption(field, path) {
  return field.type === 'boolean' && QUESTION_OPTIONS.includes(path);
}
function editorSchema(definition, inItem) {
  var result = copy(definition);
  if (definition.properties) Object.keys(definition.properties).forEach(function(key) {
    var child = definition.properties[key];
    var edited = editorSchema(child, inItem);
    if (inItem) {
      edited.conversionUseDefault = valid(child, child.default);
      edited.conversionHidden = !required(child, key, definition) || edited.conversionUseDefault;
    }
    result.properties[key] = edited;
  });
  if (definition.items) result.items = editorSchema(definition.items, true);
  return result;
}
function fields(schema, prefix, result) {
  prefix = prefix || '';
  result = result || [];
  Object.keys(schema.properties || {}).forEach(function(key) {
    if (INTERNAL.includes(key)) return;
    var field = schema.properties[key], path = prefix ? prefix + '.' + key : key;
    var graphic = itemGraphic(field, path);
    if (required(field, key, schema) || graphic) result.push({
      path: path, schema: editorSchema(field, path.includes('[]')), itemGraphic: graphic,
      hidden: !graphic && path.includes('[]') && valid(field, field.default)
    });
    if (field.properties) fields(field, path, result);
    // Array defaults are configured as complete arrays; existing items are reviewed individually.
    if (field.items && field.items.properties) fields(field.items, path + '[]', result);
  });
  return result;
}
function get(value, path) {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce(function(current, key) { return current && current[key]; }, value);
}
function set(value, path, data) {
  var parts = path.replace(/\[(\d+)\]/g, '.$1').split('.'), last = parts.pop();
  var parent = parts.reduce(function(current, key) {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    return current[key];
  }, value);
  parent[last] = data;
}
function safePath(path) {
  return typeof path === 'string' && path.split(/[.[\]]/).every(function(key) {
    return !['__proto__', 'prototype', 'constructor'].includes(key);
  });
}
function validateDefaults(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Conversion defaults must be an object.';
  for (var scope of Object.keys(value)) {
    if (!safePath(scope) || !value[scope] || typeof value[scope] !== 'object' || Array.isArray(value[scope])) {
      return 'Invalid conversion defaults group: ' + scope;
    }
    for (var path of Object.keys(value[scope])) {
      if (!safePath(path) || !path) return 'Invalid conversion default path: ' + path;
    }
  }
  return null;
}

module.exports = { normalize: normalize, valid: valid, required: required, fields: fields,
  get: get, set: set, safePath: safePath, validateDefaults: validateDefaults, internal: INTERNAL,
  itemGraphic: itemGraphic, editorSchema: editorSchema, questionOption: questionOption };
