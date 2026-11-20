var crypto = require('crypto');
var Ajv = require('ajv');
var schema = require('./conversionSchema');
var walker = require('../schemaWalker');
var layout = require('../../frontend/src/modules/lightCourseEditor/componentLayout');
var iconOptions = require('./iconOptions');
var validation = require('./validation');
var extensionDefaults = require('./extensionDefaults');
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

  function compose(record, definition, group, data, prefix, templatePath, assetsOnly) {
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
      if (!assetsOnly && field.properties && (!value || typeof value !== 'object' || Array.isArray(value)) &&
          schema.fields(field, fallbackPath, [], group).some(function(child) {
            return (child.image || child.navigationOption || child.videoPlaceholder || child.pluginOption) &&
              Object.prototype.hasOwnProperty.call(settings, child.path);
          })) value = data[key] = {};
      var container = field.properties && value && typeof value === 'object' && !Array.isArray(value) ||
        field.items && Array.isArray(value) && (field.minItems === undefined || value.length >= field.minItems);
      if (!assetsOnly && (required || image || questionOption || navigationOption || videoPlaceholder || pluginOption) &&
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
        compose(record, field, group, value, path, fallbackPath, assetsOnly);
      }
      if (Array.isArray(value) && field.items) value.forEach(function(item, index) {
        if (item && typeof item === 'object') compose(record, field.items, group, item, path + '[' + index + ']', fallbackPath + '[]', assetsOnly);
      });
      if (walker.isAssetField(field) && value && !plan.assets.some(function(asset) {
        return asset.node === record.id && asset.path === path;
      })) {
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
    var record = { id: id, type: type, parent: parent, data: data, schema: definition,
      customFields: component ? Object.keys(component.properties || {}).filter(function(key) {
        return !Object.prototype.hasOwnProperty.call(catalog.core[type].properties, key) && !schema.internal.includes(key);
      }) : [] };
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
          if (fields.properties[name].properties && fields.properties[name].properties._isEnabled &&
              data[target][name]._isEnabled === undefined) data[target][name]._isEnabled = true;
        });
        compose(record, fields, pluginType + ':' + key + ':' + type, data[target], target, '');
        extensionDefaults.mergeMissing(data[target], extensionDefaults.locationDefaults(plugin, type));
        compose(record, fields, pluginType + ':' + key + ':' + type, data[target], target, '', true);
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
  var theme = catalog.theme[selected.theme];
  if (theme) {
    var variables = extensionDefaults.themeVariables(theme);
    if (Object.keys(variables).length) {
      course.data.themeVariables = course.data.themeVariables || {};
      extensionDefaults.mergeMissing(course.data.themeVariables, variables);
    }
  }
  extensions.forEach(function(key) {
    var plugin = catalog.extension[key];
    if (!plugin || !plugin.globals) return;
    course.data._globals = course.data._globals || {};
    course.data._globals._extensions = course.data._globals._extensions || {};
    course.data._globals._extensions['_' + key] = course.data._globals._extensions['_' + key] || {};
    extensionDefaults.mergeMissing(course.data._globals._extensions['_' + key], extensionDefaults.globalDefaults(plugin));
  });
  if (course.data._globals && catalog.core.course.properties._globals) {
    compose(course, catalog.core.course.properties._globals, 'core:course', course.data._globals, '_globals', '_globals');
  }
  var config = add('config', 'config', {}, null);
  config.data._menu = catalog.menu[selected.menu] && catalog.menu[selected.menu].name;
  config.data._theme = catalog.theme[selected.theme] && catalog.theme[selected.theme].name;
  config.data._enabledExtensions = {};
  extensions.forEach(function(key) {
    var plugin = catalog.extension[key];
    if (plugin) config.data._enabledExtensions[key] = {
      _id: String(plugin._id), name: plugin.name, version: plugin.version, targetAttribute: plugin.targetAttribute
    };
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
  var pages = source.contentTree && source.contentTree.children || [];
  var splashPages = new Set(plan.records.filter(function(record) {
    return record.type === 'component' && record.data._component === 'splash';
  }).map(function(record) {
    var block = plan.records.find(function(entry) { return entry.id === record.parent; });
    var article = block && plan.records.find(function(entry) { return entry.id === block.parent; });
    return article && article.parent;
  }));
  var firstPage = pages[0] && plan.records.find(function(record) {
    return record.id === pages[0]._id && record.type === 'contentobject';
  });
  function structureChange(record, path, value, source, display) {
    var previous = schema.get(record.data, path);
    if (previous === value && display === undefined) return;
    var proposal = plan.proposals.find(function(item) { return item.node === record.id && item.path === path; });
    if (!proposal) {
      proposal = { node: record.id, path: path, previous: previous };
      plan.proposals.push(proposal);
    }
    proposal.value = display === undefined ? value : display;
    proposal.source = source;
    schema.set(record.data, path, value);
  }
  if (firstPage && splashPages.has(firstPage.id)) {
    var hidden = catalog.core.contentobject.properties._isHidden;
    var start = catalog.core.course.properties._start;
    var startFields = start && start.properties;
    var startItem = { _id: '000000000000000000000001', _className: '', _skipIfComplete: false };
    if (!hidden || !schema.valid(hidden, true)) {
      error(firstPage.id, '_isHidden', 'The installed page schema does not support hiding a menu item.');
    } else {
      structureChange(firstPage, '_isHidden', true, 'First page contains Splash');
    }
    if (!startFields || !startFields._isEnabled || !schema.valid(startFields._isEnabled, true) ||
        !startFields._force || !schema.valid(startFields._force, true) ||
        !startFields._startIds || !schema.valid(startFields._startIds, [startItem])) {
      error('course', '_start', 'The installed course schema does not support Splash start settings.');
    } else {
      var existingStarts = schema.get(course.data, '_start._startIds') || [];
      if (!Array.isArray(existingStarts)) {
        error('course', '_start._startIds', 'The existing start list is invalid.');
      } else {
        structureChange(course, '_start._isEnabled', true, 'First page contains Splash');
        structureChange(course, '_start._force', true, 'First page contains Splash');
        structureChange(course, '_start._startIds', [startItem].concat(existingStarts), 'First page contains Splash',
          'Start at ' + (pages[0].title || firstPage.id) + ' (ID assigned on conversion)');
        course.startTarget = firstPage.id;
      }
    }
    ['footer', 'hero'].forEach(function(key) {
      if (!extensions.includes(key) || !catalog.extension[key]) return;
      var locations = catalog.extension[key].properties && catalog.extension[key].properties.pluginLocations;
      var pageSchema = locations && locations.properties && locations.properties.contentobject;
      var pluginSchema = pageSchema && pageSchema.properties && pageSchema.properties['_' + key];
      var fields = pluginSchema && pluginSchema.properties;
      var backgroundFields = fields && fields._backgroundImage && fields._backgroundImage.properties;
      var settings = [{ path: '_extensions._' + key + '._isEnabled', field: fields && fields._isEnabled,
        value: key === 'hero', description: 'page enablement' }];
      if (key === 'hero') settings.push({ path: '_extensions._hero._backgroundImage._isEnabled',
        field: backgroundFields && backgroundFields._isEnabled, value: false, description: 'background image enablement' });
      settings.forEach(function(setting) {
        if (!setting.field || setting.field.type !== 'boolean' || !schema.valid(setting.field, setting.value)) {
          return error(firstPage.id, setting.path, 'The installed ' + key + ' schema does not support ' + setting.description + '.');
        }
        structureChange(firstPage, setting.path, setting.value, 'First page contains Splash');
      });
    });
  }
  if (!invalid && extensions.includes('footer') && catalog.extension.footer) {
    var footerLocations = catalog.extension.footer.properties && catalog.extension.footer.properties.pluginLocations;
    var footerFields = footerLocations && footerLocations.properties && footerLocations.properties.contentobject;
    var footerSchema = footerFields && footerFields.properties && footerFields.properties._footer;
    var buttons = footerSchema && footerSchema.properties;
    var validButtons = ['_previous', '_next'].every(function(key) {
      var props = buttons && buttons[key] && buttons[key].properties;
      return props && props._isEnabled && props._isEnabled.type === 'boolean' &&
        props._customLink && schema.valid(props._customLink, '000000000000000000000001');
    });
    if (!validButtons) {
      error('course', '_extensions._footer', 'The installed Footer schema must support previous and next buttons with custom page IDs.');
    } else {
      if (splashPages.size > 1 || splashPages.size === 1 && !splashPages.has(pages[0] && pages[0]._id)) {
        error('course', '_extensions._footer', 'Footer navigation requires at most one Splash page, and it must be the first page.');
      } else {
        pages.forEach(function(page, index) {
          var record = plan.records.find(function(entry) { return entry.id === page._id && entry.type === 'contentobject'; });
          if (!record) return;
          var firstContentIndex = splashPages.size ? 1 : 0;
          [['_previous', index > firstContentIndex ? pages[index - 1] : null],
            ['_next', index + 1 < pages.length ? pages[index + 1] : null]].forEach(function(entry) {
            var button = entry[0], target = entry[1];
            var base = '_extensions._footer.' + button;
            function propose(path, value, display) {
              var previous = schema.get(record.data, path);
              if (previous === value && display === undefined) return;
              var proposal = plan.proposals.find(function(item) { return item.node === record.id && item.path === path; });
              if (!proposal) {
                proposal = { node: record.id, path: path, previous: previous };
                plan.proposals.push(proposal);
              }
              proposal.value = display === undefined ? value : display;
              proposal.source = 'Course structure';
              schema.set(record.data, path, value);
            }
            propose(base + '._isEnabled', !!target);
            if (target) {
              record.footerTargets = record.footerTargets || {};
              record.footerTargets[button] = target._id;
              propose(base + '._customLink', '000000000000000000000001',
                (button === '_next' ? 'Next page: ' : 'Previous page: ') +
                (target.title || target._id) + ' (ID assigned on conversion)');
            } else {
              propose(base + '._customLink', '');
            }
          });
        });
      }
    }
  }
  plan.records.filter(function(record) {
    return record.type === 'component' && record.data._component === 'splash';
  }).forEach(function(record) {
    var plugin = catalog.component.splash, fields = plugin && plugin.properties || {};
    if (!fields._naviageTo) return;
    var block = plan.records.find(function(entry) { return entry.id === record.parent; });
    var article = block && plan.records.find(function(entry) { return entry.id === block.parent; });
    var pageIndex = pages.findIndex(function(page) { return article && page._id === article.parent; });
    if (pageIndex < 0) return error(record.id, '_naviageTo', 'The Splash page could not be located.');
    var nextPage = pages[pageIndex + 1];
    if (!schema.valid(fields._naviageTo, record.data._naviageTo) && nextPage) {
      var placeholder = '000000000000000000000001';
      if (!schema.valid(fields._naviageTo, placeholder)) {
        return error(record.id, '_naviageTo', 'The Splash target field does not accept a generated page ID.');
      }
      record.splashTarget = nextPage._id;
      record.data._naviageTo = placeholder;
      plan.proposals.push({ node: record.id, path: '_naviageTo', value: 'Next page: ' + (nextPage.title || nextPage._id) +
        ' (ID assigned on conversion)', source: 'Course structure' });
    }
    if (schema.valid(fields._naviageTo, record.data._naviageTo)) {
      if (pageIndex === 0) {
        if (!fields._naviagteToNextPage || !schema.valid(fields._naviagteToNextPage, false)) {
          return error(record.id, '_naviagteToNextPage', 'The installed Splash schema cannot use a custom target.');
        }
        structureChange(record, '_naviagteToNextPage', false, 'Hidden Splash page uses custom target');
      }
      return;
    }
    if (!fields._naviagteHome || fields._naviagteHome.type !== 'boolean' ||
        !fields._naviagteToNextPage || fields._naviagteToNextPage.type !== 'boolean') {
      return error(record.id, '_naviageTo', 'The last-page Splash needs a main-menu navigation option in its installed schema.');
    }
    [['_naviagteHome', true], ['_naviagteToNextPage', false]].forEach(function(setting) {
      var key = setting[0], value = setting[1], previous = record.data[key];
      if (previous === value) return;
      var proposal = plan.proposals.find(function(entry) { return entry.node === record.id && entry.path === key; });
      if (!proposal) {
        proposal = { node: record.id, path: key, previous: previous };
        plan.proposals.push(proposal);
      }
      proposal.value = record.data[key] = value;
      proposal.source = 'Last-page main menu';
    });
  });
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
