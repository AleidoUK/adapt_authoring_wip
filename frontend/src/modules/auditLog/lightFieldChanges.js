define(function(require) {
  var Origin = require('core/origin');
  var SchemaFilter = require('../lightCourseEditor/schemaFilter');
  var IGNORED_FIELDS = ['_id', '__v', '_tenantId', 'createdAt', 'updatedAt', 'createdBy', 'revision', '_componentSchemaSnapshot'];

  function label(key, descriptor) {
    var translations = {
      uniqueId: 'app.lightcoursefielduniqueid',
      screenshotAssetId: 'app.lightcoursecomponentscreenshot',
      graphicsNotes: 'app.lightcoursegraphicsnotes',
      developerNotes: 'app.lightcoursedevelopernotes',
      _componentPresetId: 'app.lightcoursecomponentpreset',
      _component: 'app.lightcoursecomponenttype',
      _layout: 'app.lightcoursecomponentlayout'
    };
    if (translations[key]) return Origin.l10n.t(translations[key]);
    if (descriptor && descriptor.title) return descriptor.title;
    var text = key.replace(/^_+/, '').replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function nodeLabel(node, index) {
    var type = node.type && ['page', 'article', 'block', 'component'].indexOf(node.type) !== -1
      ? Origin.l10n.t('app.lightcourse' + node.type) + ' ' + (index + 1) : String(index + 1);
    var title = node.displayTitle || node.title || node.uniqueId || node._component || node.term || node.name;
    return type + (title ? ': ' + title : '') +
      (node.uniqueId && title !== node.uniqueId ? ' (' + node.uniqueId + ')' : '');
  }

  function descriptors(node) {
    var schema = Origin.schemas.get(node._component || node.type) || node._componentSchemaSnapshot || {};
    return Object.assign({}, schema, schema.properties && schema.properties.properties,
      SchemaFilter.filterComponentSchema(schema, { includeAudio: true }));
  }

  function keyed(items) {
    var ids = [];
    return items.every(function(item) {
      if (!item || typeof item !== 'object' || !item._id || ids.indexOf(item._id) !== -1) return false;
      ids.push(item._id);
      return true;
    });
  }

  function fieldChanges(changes, inferValueType, options) {
    options = options || {};
    var result = [];
    function add(path, oldValue, newValue, key) {
      result.push({
        field: (path.length ? path : [label(key)]).join(' / '),
        oldValue: oldValue,
        newValue: newValue,
        changeType: inferValueType(key, newValue == null ? oldValue : newValue)
      });
    }
    function walk(oldValue, newValue, path, descriptor, key) {
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
      function empty(value) {
        return value == null || value === '' || typeof value === 'object' && !Object.keys(value).length;
      }
      if (options.omitEmptyAdditions && (oldValue === undefined && empty(newValue) || newValue === undefined && empty(oldValue))) return;
      if (Array.isArray(oldValue) || Array.isArray(newValue)) {
        if ((oldValue != null && !Array.isArray(oldValue)) || (newValue != null && !Array.isArray(newValue))) {
          add(path, oldValue, newValue, key);
          return;
        }
        var before = Array.isArray(oldValue) ? oldValue : [];
        var after = Array.isArray(newValue) ? newValue : [];
        if (!before.length && !after.length) {
          add(path, oldValue, newValue, key);
          return;
        }
        if (keyed(before) && keyed(after)) {
          var beforeIds = before.map(function(item) { return item._id; });
          var afterIds = after.map(function(item) { return item._id; });
          var ids = _.union(beforeIds, afterIds);
          ids.forEach(function(id) {
            var oldItem = _.findWhere(before, { _id: id });
            var newItem = _.findWhere(after, { _id: id });
            var item = newItem || oldItem;
            var index = newItem ? after.indexOf(newItem) : before.indexOf(oldItem);
            if (options.onItemChange) {
              var element = path.concat(nodeLabel(item, index)).join(' / ');
              if (!oldItem || !newItem) {
                options.onItemChange({ action: oldItem ? 'removed' : 'added', element: element });
              } else if (beforeIds.filter(function(id) { return afterIds.indexOf(id) !== -1; }).indexOf(id) !==
                         afterIds.filter(function(id) { return beforeIds.indexOf(id) !== -1; }).indexOf(id)) {
                options.onItemChange({ action: 'moved', element: element, parent: path.join(' / '),
                  beforeIndex: before.indexOf(oldItem), afterIndex: after.indexOf(newItem) });
              }
            }
            walk(oldItem, newItem, path.concat(nodeLabel(item, index)), descriptor && descriptor.items, key);
          });
          if (!options.onItemChange && beforeIds.length === afterIds.length && ids.length === beforeIds.length &&
              JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
            add(path.concat(Origin.l10n.t('app.lightcourseauditorder')),
              before.map(nodeLabel), after.map(nodeLabel), 'order');
          }
        } else {
          for (var i = 0; i < Math.max(before.length, after.length); i++) {
            walk(before[i], after[i], path.concat(String(i + 1)), descriptor && descriptor.items, key);
          }
        }
        return;
      }
      if ((oldValue && typeof oldValue === 'object' || newValue && typeof newValue === 'object') &&
          (oldValue == null || typeof oldValue === 'object') && (newValue == null || typeof newValue === 'object')) {
        var object = newValue || oldValue;
        var isNode = !!object._id && ['page', 'article', 'block', 'component'].indexOf(object.type) !== -1;
        if (isNode && (!oldValue || !newValue) && !options.expandNodes) {
          add(path, oldValue, newValue, key);
          return;
        }
        var beforeObject = oldValue || {};
        var afterObject = newValue || {};
        var fields = isNode ? descriptors(object) : descriptor && (descriptor.properties || descriptor.subSchema);
        var keys = _.union(Object.keys(beforeObject), Object.keys(afterObject));
        if (!keys.length) {
          add(path, oldValue, newValue, key);
          return;
        }
        keys.forEach(function(field) {
          if (IGNORED_FIELDS.indexOf(field) !== -1 || (field === 'type' && isNode)) return;
          var childDescriptor = fields && fields[field];
          var childPath = field === 'children' ? path : path.concat(label(field, childDescriptor));
          walk(beforeObject[field], afterObject[field], childPath, childDescriptor, field);
        });
        return;
      }
      add(path, oldValue, newValue, key);
    }
    (changes || []).forEach(function(change) {
      if (IGNORED_FIELDS.indexOf(change.field) !== -1) return;
      walk(change.oldValue, change.newValue,
        change.field === 'contentSnapshot' ? [] : [label(change.field)], null, change.field);
    });
    return result;
  }
  fieldChanges.nodeLabel = nodeLabel;
  fieldChanges.label = label;
  return fieldChanges;
});
