// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var SchemaFilter = require('./schemaFilter');
  var INTERNAL_FIELDS = ['_id', 'type', '_component', '_layout', 'children', '_componentSchemaSnapshot', '_componentPresetId'];

  function fieldLabel(key, field) {
    if (key === 'screenshotAssetId') return Origin.l10n.t('app.lightcoursecomponentscreenshot');
    if (key === 'graphicsNotes') return Origin.l10n.t('app.lightcoursegraphicsnotes');
    if (key === 'developerNotes') return Origin.l10n.t('app.lightcoursedevelopernotes');
    if (key === 'uniqueId') return Origin.l10n.t('app.lightcoursefielduniqueid');
    if (field && field.title) return field.title;
    var title = key.replace(/^_+/, '').replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  function previewValue(key, value, field, label) {
    var result = { label: label || fieldLabel(key, field) };
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      result.children = value.map(function(item, index) {
        return previewValue(key, item, field && field.items, String(index + 1));
      }).filter(Boolean);
      return result.children.length ? result : null;
    }
    if (typeof value === 'object') {
      result.children = previewFields(value, field && (field.properties || field.subSchema), false);
      return result.children.length ? result : null;
    }
    result.value = String(value);
    if (!result.value.trim()) return null;
    if (key === 'screenshotAssetId') {
      result.isImage = true;
      result.imageSrc = 'api/content/lightcourseasset/' + encodeURIComponent(result.value) + '/serve';
      return result;
    }
    result.isHtml = !!(field && field.inputType === 'TextArea') || key === 'body' || key === 'instruction';
    if (result.isHtml && !/<(?:img|video|audio|iframe|svg|hr|table)\b/i.test(result.value) &&
      !result.value.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim()) {
      return null;
    }
    return result;
  }

  function previewFields(data, fields, isNode) {
    var keys = Object.keys(data || {});
    if (isNode && data.type === 'component' && keys.indexOf('screenshotAssetId') !== -1) {
      keys = ['title', 'screenshotAssetId'].filter(function(key) { return keys.indexOf(key) !== -1; })
        .concat(keys.filter(function(key) { return key !== 'title' && key !== 'screenshotAssetId'; }));
    }
    return keys.filter(function(key) {
      if (isNode && data.type === 'component' && key === 'uniqueId') return false;
      if (isNode && data.type === 'page' && key === 'title') return false;
      return (isNode ? INTERNAL_FIELDS : ['_id', '_componentSchemaSnapshot', '_componentPresetId']).indexOf(key) === -1;
    }).map(function(key) {
      return previewValue(key, data[key], fields && fields[key]);
    }).filter(Boolean);
  }

  return function(node) {
    var schema = Origin.schemas.get(node._component || node.type) || node._componentSchemaSnapshot || {};
    var fields = Object.assign({}, schema, schema.properties && schema.properties.properties,
      SchemaFilter.filterComponentSchema(schema, { includeAudio: true }));
    return previewFields(node, fields, true);
  };
});
