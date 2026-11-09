var wordcount = require('../lightcoursewordcount');
var schemaWalker = require('../schemaWalker');
var wordFields = require('./wordFields');
var wordImages = require('./wordImages');

function activeContent(schema, value, root) {
  if (!schema || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(function(item) { return activeContent(schema.items, item); });
  }
  var properties = schema.properties || {};
  var enabled = value._isEnabled;
  if (enabled === undefined && properties._isEnabled) enabled = properties._isEnabled.default;
  if (!root && enabled === false) return undefined;
  var result = Object.assign({}, value);
  var media = Object.keys(properties).filter(function(key) { return schemaWalker.isAssetField(properties[key]); });
  var missingMedia = !root && media.length > 0 && !media.some(function(key) {
    return typeof value[key] === 'string' && value[key].trim().length > 0;
  });
  Object.keys(properties).forEach(function(key) {
    var child = activeContent(properties[key], value[key]);
    if (child === undefined || missingMedia && /^(?:alt|ariaLabel|attribution|longdescription)$/i.test(key.replace(/^_/, ''))) {
      delete result[key];
    } else result[key] = child;
  });
  return result;
}

function withValues(fields, images) {
  var configured = fields.filter(function(field) { return wordFields.plainText(field.text).trim().length > 0; });
  return { fields: configured, images: (images || []).concat(wordImages.htmlImages(fields.filter(function(field) {
    return !configured.includes(field);
  }))) };
}

function component(schema, node) {
  if (schema) {
    var properties = Object.assign({}, schema.properties,
      schema.properties && schema.properties.properties && schema.properties.properties.properties);
    delete properties.properties;
    schema = { properties: properties };
  }
  node = Object.assign({}, activeContent(schema, node, true));
  node.uniqueId = node.uniqueId || node._extensions && node._extensions._uniqueId && node._extensions._uniqueId._id || '';
  var fields = schema ? wordFields.componentFields(schema, node, { reviewLayout: true }) :
    wordFields.structuralFields(node, { reviewLayout: true });
  var result = withValues(fields, wordImages.componentImages(schema || {}, node));
  result.wordCount = schema ? wordcount.countNodeWords(node, schema) : 0;
  return result;
}

module.exports = { component: component, withValues: withValues, activeContent: activeContent };
