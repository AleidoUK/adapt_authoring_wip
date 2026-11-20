var helpers = require('../helpers');
var schema = require('./conversionSchema');
var crypto = require('crypto');
var Ajv = require('ajv');
var ajv = new Ajv({ allErrors: true, unknownFormats: 'ignore' });

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function mergeMissing(target, defaults) {
  if (!isObject(target) || !isObject(defaults)) return;
  Object.keys(defaults).forEach(function(key) {
    if (!schema.safePath(key) || defaults[key] === undefined) return;
    if (target[key] === undefined) target[key] = copy(defaults[key]);
    else if (isObject(target[key]) && isObject(defaults[key])) mergeMissing(target[key], defaults[key]);
  });
}

function locationDefaults(plugin, type) {
  var locations = plugin.properties && plugin.properties.pluginLocations;
  var location = locations && locations.properties && locations.properties[type];
  if (!location || !location.properties) return {};
  var hash = crypto.createHash('sha256').update(JSON.stringify(location.properties)).digest('hex');
  var generated = helpers.schemaToObject(location.properties, plugin.name + '#lightcourse-' + hash, plugin.version, type);
  function validDefaults(values, properties) {
    return Object.keys(values).reduce(function(result, key) {
      if (!schema.safePath(key) || !properties[key]) return result;
      var field = properties[key], value = values[key];
      if (field.properties && isObject(value)) {
        result[key] = validDefaults(value, field.properties);
      } else if (ajv.validate(schema.normalize(field), value)) {
        result[key] = copy(value);
      }
      return result;
    }, {});
  }
  return validDefaults(generated, location.properties);
}

function themeVariables(plugin) {
  function defaults(properties) {
    return Object.keys(properties || {}).reduce(function(result, key) {
      if (!schema.safePath(key)) return result;
      var field = properties[key];
      if (field.properties) {
        var nested = defaults(field.properties);
        if (Object.keys(nested).length) result[key] = nested;
      } else if (field.default !== undefined && ajv.validate(schema.normalize(field), field.default)) {
        result[key] = copy(field.default);
      }
      return result;
    }, {});
  }
  return defaults(plugin.properties && plugin.properties.variables);
}

function globalDefaults(plugin) {
  return Object.keys(plugin.globals || {}).reduce(function(result, key) {
    if (schema.safePath(key) && plugin.globals[key].default !== undefined) {
      result[key] = copy(plugin.globals[key].default);
    }
    return result;
  }, {});
}

module.exports = { mergeMissing: mergeMissing, locationDefaults: locationDefaults, globalDefaults: globalDefaults,
  themeVariables: themeVariables };
