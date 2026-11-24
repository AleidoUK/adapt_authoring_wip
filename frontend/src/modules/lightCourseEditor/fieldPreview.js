// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var SchemaFilter = require('./schemaFilter');
  var ideaLinks = require('./ideaLinks');
  var INTERNAL_FIELDS = ['_id', 'type', '_component', '_layout', '_comments', 'children', '_componentSchemaSnapshot', '_componentPresetId'];

  function fieldLabel(key, field) {
    if (key === 'screenshotAssetId') return Origin.l10n.t('app.lightcoursecomponentscreenshot');
    if (key === '_lightCourseIdeaAssets') return Origin.l10n.t('app.lightcourseitemideas');
    if (key === 'graphicsNotes') return Origin.l10n.t('app.lightcoursegraphicsnotes');
    if (key === 'developerNotes') return Origin.l10n.t('app.lightcoursedevelopernotes');
    if (key === 'uniqueId') return Origin.l10n.t('app.lightcoursefielduniqueid');
    if (field && field.title) return field.title;
    var title = key.replace(/^_+/, '').replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  function previewValue(key, value, field, label, context, path) {
    var result = { label: label || fieldLabel(key, field) };
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      if (key === '_lightCourseIdeaAssets') {
        result.children = value.filter(function(item) { return item && item.src; }).map(function(item, index) {
          var parentPath = path.slice(0, Math.max(0, path.lastIndexOf('.')));
          var target = item.targetId ? context.byId[item.targetId] : context.byPath[parentPath];
          var children = [{ label: Origin.l10n.t('app.lightcourseideatarget'),
            value: target || Origin.l10n.t('app.lightcourseideaunavailable') },
          { label: Origin.l10n.t('app.lightcourseideaimage'), isImage: true,
            imageSrc: 'api/content/lightcourseasset/' + encodeURIComponent(item.src) + '/serve' }];
          if (item.notes) children.push({ label: Origin.l10n.t('app.lightcourseideanotes'), value: item.notes, isHtml: true });
          return { label: String(index + 1), children: children };
        });
        return result.children.length ? result : null;
      }
      result.children = value.map(function(item, index) {
        return previewValue(key, item, field && field.items, String(index + 1), context, path + '[' + index + ']');
      }).filter(Boolean);
      return result.children.length ? result : null;
    }
    if (typeof value === 'object') {
      result.children = previewFields(value, field && (field.properties || field.subSchema), false, context, path);
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

  function previewFields(data, fields, isNode, context, path) {
    var keys = Object.keys(data || {});
    if (isNode && data.type === 'component' && keys.indexOf('screenshotAssetId') !== -1) {
      keys = ['title', 'screenshotAssetId', '_lightCourseIdeaAssets'].filter(function(key) { return keys.indexOf(key) !== -1; })
        .concat(keys.filter(function(key) { return ['title', 'screenshotAssetId', '_lightCourseIdeaAssets'].indexOf(key) === -1; }));
    }
    return keys.filter(function(key) {
      if (isNode && data.type === 'component' && key === 'uniqueId') return false;
      if (isNode && (data.type === 'page' || data.type === 'submenu') && key === 'title') return false;
      return (isNode ? INTERNAL_FIELDS : ['_id', '_componentSchemaSnapshot', '_componentPresetId', '_lightCourseIdeaItemId']).indexOf(key) === -1;
    }).map(function(key) {
      return previewValue(key, data[key], fields && fields[key], null, context, path ? path + '.' + key : key);
    }).filter(Boolean);
  }

  return function(node) {
    var schema = Origin.schemas.get(node._component || node.type) || node._componentSchemaSnapshot || {};
    var fields = Object.assign({}, schema, schema.properties && schema.properties.properties,
      SchemaFilter.filterComponentSchema(schema, { includeAudio: true }));
    var context = { byId: Object.create(null), byPath: Object.create(null) };
    ideaLinks.locations(node, Origin.l10n.t('app.lightcourseideacomponent'), Origin.l10n.t('app.lightcourseideaitem'))
      .forEach(function(target) {
        context.byPath[target.path] = target.label;
        if (target.val) context.byId[target.val] = target.label;
      });
    return previewFields(node, fields, true, context, '');
  };
});
