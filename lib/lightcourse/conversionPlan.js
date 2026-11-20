var crypto = require('crypto');
var Ajv = require('ajv');
var schema = require('./conversionSchema');
var walker = require('../schemaWalker');
var layout = require('../../frontend/src/modules/lightCourseEditor/componentLayout');
var iconOptions = require('./iconOptions');
var validation = require('./validation');
var ajv = new Ajv({ allErrors: true, unknownFormats: 'ignore' });

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce(function(out, key) {
    out[key] = stable(value[key]); return out;
  }, {});
  return value;
}
function signature(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function snapshot(value, header) {
  var out = {};
  ['title', 'body', 'contentTree', 'pluginSelections', 'glossaryItems', 'resourceItems', 'helpContent'].forEach(function(key) {
    out[key] = value[key];
  });
  out.tags = (value.tags || []).map(function(tag) { return String(tag._id || tag); }).sort();
  out.iconChoices = (header || {}).iconChoices || {};
  return out;
}

function build(draft, version, catalog, defaults) {
  var source = copy(version.contentSnapshot), icons = (version.headerSnapshot || {}).iconChoices || {};
  var plan = { records: [], proposals: [], errors: [], assets: [], versionId: String(version._id),
    versionNumber: version.versionNumber, revision: draft.revision };
  var selected = source.pluginSelections || {}, extensions = selected.extensions || [];
  function error(node, path, message) { plan.errors.push({ node: node, path: path, message: message }); }
  var invalid = validation.validate({
    contentTree: source.contentTree, pluginSelections: source.pluginSelections,
    glossaryItems: source.glossaryItems, resourceItems: source.resourceItems, helpContent: source.helpContent
  });
  if (invalid) error('course', '', invalid);
  if (signature(snapshot(draft, draft.headerData)) !== signature(snapshot(source, version.headerSnapshot))) {
    error('course', '', 'The draft has changes since this saved version. Create a new version before conversion.');
  }
  if (!(source.contentTree && source.contentTree.children || []).length) error('course', '', 'The course has no pages.');
  ['menu', 'theme'].forEach(function(type) {
    if (!selected[type] || !catalog[type][selected[type]]) error('course', type, 'Select an installed ' + type + '.');
    else if (!catalog[type][selected[type]].name) error('course', type, 'The selected plugin has no installed package name.');
  });
  extensions.forEach(function(key) {
    if (!catalog.extension[key]) error('course', key, 'Extension is not installed: ' + key);
  });

  function compose(record, definition, group, data, prefix, templatePath) {
    var settings = defaults[group] || {};
    Object.keys(definition.properties || {}).forEach(function(key) {
      if (!schema.safePath(key)) return error(record.id, key, 'Unsupported schema field.');
      var field = definition.properties[key], path = prefix ? prefix + '.' + key : key;
      var fallbackPath = templatePath ? templatePath + '.' + key : key;
      var value = data[key], required = schema.required(field, key, definition);
      var configured = Object.prototype.hasOwnProperty.call(settings, fallbackPath);
      var image = configured && schema.imageField(field);
      var questionOption = configured && group.startsWith('component:') && schema.questionOption(field, fallbackPath);
      var navigationOption = configured && schema.navigationOption(field, fallbackPath, group);
      var videoPlaceholder = configured && schema.videoPlaceholder(field, fallbackPath, group);
      var pluginOption = configured && schema.pluginOption(field, fallbackPath, group);
      var useConfigured = configured && (image || videoPlaceholder || !fallbackPath.includes('[]') || !schema.valid(field, field.default));
      var fallback = useConfigured ? settings[fallbackPath] : field.default;
      if (field.properties && (!value || typeof value !== 'object' || Array.isArray(value)) &&
          schema.fields(field, fallbackPath, [], group).some(function(child) {
            return (child.image || child.navigationOption || child.videoPlaceholder || child.pluginOption) &&
              Object.prototype.hasOwnProperty.call(settings, child.path);
          })) value = data[key] = {};
      var container = field.properties && value && typeof value === 'object' && !Array.isArray(value) ||
        field.items && Array.isArray(value) && (field.minItems === undefined || value.length >= field.minItems);
      if ((required || image || questionOption || navigationOption || videoPlaceholder || pluginOption) &&
          !schema.internal.includes(key) && !container && !schema.valid(field, value)) {
        if (schema.valid(field, fallback)) {
          plan.proposals.push({ node: record.id, path: path, previous: value, value: copy(fallback),
            source: useConfigured ? 'Conversion Defaults' : 'Installed schema' });
          value = data[key] = copy(fallback);
        } else if (!field.properties || value !== undefined && (value === null || typeof value !== 'object')) {
          error(record.id, path, 'A valid required value or Conversion Default is needed.');
        } else if (value === undefined) value = data[key] = {};
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && field.properties) {
        compose(record, field, group, value, path, fallbackPath);
      }
      if (Array.isArray(value) && field.items) value.forEach(function(item, index) {
        if (item && typeof item === 'object') compose(record, field.items, group, item, path + '[' + index + ']', fallbackPath + '[]');
      });
      if (walker.isAssetField(field) && value) {
        var input = typeof field.inputType === 'object' ? field.inputType.type : field.inputType;
        plan.assets.push({ node: record.id, path: path, source: value, required: required || image || videoPlaceholder,
          assetType: input && input.split(':')[1] || (field._backboneForms === 'Asset' ? 'image' : undefined),
          fallback: schema.valid(field, fallback) ? fallback : undefined });
      }
    });
  }

  function add(id, type, input, parent, index, component) {
    var definition = { properties: Object.assign({}, catalog.core[type].properties, component && component.properties) };
    var data = {};
    // Only installed-schema fields cross the boundary; notes, comments and presets stay in the Light Course.
    Object.keys(definition.properties).forEach(function(key) {
      if (!schema.internal.includes(key) && !['uniqueId', 'graphicsNotes', 'developerNotes', 'screenshotAssetId',
        '_comments', '_componentSchemaSnapshot', '_componentPresetId'].includes(key) && input[key] !== undefined) data[key] = copy(input[key]);
    });
    if (definition.properties.displayTitle && input.displayTitle === undefined && input.title !== undefined) data.displayTitle = input.title;
    data._type = type === 'contentobject' ? 'page' : type;
    data._tenantId = String(draft._tenantId);
    if (type !== 'course') data._courseId = '000000000000000000000001';
    if (parent) data._parentId = '000000000000000000000001';
    if (index !== undefined) data._sortOrder = index + 1;
    if (component) {
      data._component = input._component;
      data._componentType = String(component._id);
      data._layout = input._layout;
    }
    var record = { id: id, type: type, parent: parent, data: data, schema: definition };
    plan.records.push(record);
    compose(record, { properties: catalog.core[type].properties }, 'core:' + type, data, '', '');
    if (component) compose(record, { properties: component.properties }, 'component:' + input._component, data, '', '');
    ['extension', 'menu', 'theme'].forEach(function(pluginType) {
      var keys = pluginType === 'extension' ? extensions : [selected[pluginType]];
      var target = pluginType === 'extension' ? '_extensions' : pluginType + 'Settings';
      keys.forEach(function(key) {
        var plugin = catalog[pluginType][key];
        var locations = plugin && plugin.properties && plugin.properties.pluginLocations;
        var fields = locations && locations.properties && locations.properties[type];
        if (!fields) return;
        data[target] = data[target] || {};
        Object.keys(fields.properties || {}).forEach(function(name) {
          data[target][name] = data[target][name] || {};
          if (fields.properties[name].properties && fields.properties[name].properties._isEnabled) data[target][name]._isEnabled = true;
        });
        compose(record, fields, pluginType + ':' + key + ':' + type, data[target], target, '');
        definition.properties[target] = definition.properties[target] || { type: 'object', properties: {} };
        definition.properties[target] = Object.assign({}, definition.properties[target], {
          properties: Object.assign({}, definition.properties[target].properties, fields.properties)
        });
      });
    });
    if (input.uniqueId) {
      if (!['contentobject', 'component'].includes(type)) {
        error(id, 'uniqueId', 'The installed Unique ID extension supports page and component IDs only.');
      } else if (!extensions.includes('uniqueId')) error(id, 'uniqueId', 'Select the Unique ID extension to preserve this authored ID.');
      else schema.set(data, '_extensions._uniqueId._id', input.uniqueId);
    }
    return record;
  }
  var courseExtensions = {};
  function courseExtension(key, property, value) {
    if (!extensions.includes(key)) return;
    schema.set(courseExtensions, '_' + key + '.' + property, copy(value));
  }
  courseExtension('glossary', '_glossaryItems', source.glossaryItems || []);
  courseExtension('resources', '_resourcesItems', source.resourceItems || []);
  courseExtension('help', '_popup', (source.helpContent || {}).popup || {});
  courseExtension('help', '_items', (source.helpContent || {}).items || []);
  var course = add('course', 'course', { title: source.title, displayTitle: source.title, body: source.body,
    tags: (source.tags || []).map(function(tag) { return String(tag._id || tag); }), _extensions: courseExtensions });
  var config = add('config', 'config', {}, null);
  config.data._menu = catalog.menu[selected.menu] && catalog.menu[selected.menu].name;
  config.data._theme = catalog.theme[selected.theme] && catalog.theme[selected.theme].name;
  config.data._enabledExtensions = {};
  extensions.forEach(function(key) {
    if (catalog.extension[key]) config.data._enabledExtensions[key] = String(catalog.extension[key]._id);
  });
  function visit(nodes, parent) {
    var effective = parent && nodes.length && nodes[0].type === 'component' ? layout.effective(nodes) : [];
    (nodes || []).forEach(function(node, index) {
      if (typeof node._id !== 'string' || !node._id || !schema.safePath(node._id) || nodeIds.has(node._id)) {
        error(node._id || parent, '_id', 'Every node must have a unique stable ID (not course or config).');
        return;
      }
      nodeIds.add(node._id);
      var type = node.type === 'page' ? 'contentobject' : node.type;
      var plugin = type === 'component' && catalog.component[node._component];
      if (type === 'component' && !plugin) {
        error(node._id, '_component', 'Component is not installed: ' + (node._component || '(not selected)'));
        return;
      }
      var input = Object.assign({}, node);
      if (effective.length) input._layout = effective[index];
      if (plugin && !layout.choices({ properties: plugin.properties }).includes(input._layout)) {
        error(node._id, '_layout', 'This component does not support the selected layout.');
      }
      add(node._id, type, input, parent, index, plugin);
      visit(node.children || [], node._id);
    });
  }
  var nodeIds = new Set(['course', 'config']);
  if (!invalid) visit(source.contentTree && source.contentTree.children || [], 'course');
  Object.keys(iconOptions.CONTROLS).forEach(function(control) {
    var definition = iconOptions.CONTROLS[control], value = icons[control];
    if (definition.fixed || !value) return;
    if (control === 'drawer') return schema.set(config.data, '_drawer._iconClass', value);
    if (!extensions.includes(definition.owningExtension)) return;
    var plugin = catalog.extension[definition.owningExtension], field = plugin && { properties: plugin.properties };
    var parts = definition.schemaPath.split('.');
    parts.forEach(function(key) { field = field && field.properties && field.properties[key]; });
    var options = field && field.inputType && field.inputType.options || field && field.enum;
    if (!options || !options.includes(value)) return error('course', control,
      'Invalid ' + control + ' icon "' + value + '". Valid icons: ' + (options || []).join(', '));
    var location = parts[1], path = '_extensions.' + parts.slice(2).join('.');
    plan.records.filter(function(record) { return record.type === location; }).forEach(function(record) {
      schema.set(record.data, path, value);
    });
  });
  // Final composition is validated after authored extension lists and icons have been mapped.
  plan.records.forEach(function(record) {
    if (!ajv.validate(schema.normalize(record.schema), record.data)) {
      (ajv.errors || []).forEach(function(issue) { error(record.id, issue.dataPath, issue.message); });
    }
    record.fields = Object.keys(record.schema.properties);
    delete record.schema;
  });
  return plan;
}
module.exports = { build: build, signature: signature, snapshot: snapshot };
