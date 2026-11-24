(function(factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else define(factory);
})(function() {
  function newId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function(value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  function prepare(model, schema) {
    var data = JSON.parse(JSON.stringify(model.toJSON()));
    var ideas = Array.isArray(data._lightCourseIdeaAssets) ? data._lightCourseIdeaAssets.slice() : [];
    function walk(value, properties) {
      if (!value || !properties) return;
      Object.keys(properties).forEach(function(key) {
        var field = properties[key], child = value[key];
        if (field.type === 'array' && field.items && field.items.properties && Array.isArray(child)) {
          child.forEach(function(item) {
            if (!item || typeof item !== 'object') return;
            if (!item._lightCourseIdeaItemId) item._lightCourseIdeaItemId = newId();
            (Array.isArray(item._lightCourseIdeaAssets) ? item._lightCourseIdeaAssets : []).forEach(function(idea) {
              ideas.push(Object.assign({}, idea, { targetId: item._lightCourseIdeaItemId }));
            });
            delete item._lightCourseIdeaAssets;
            walk(item, field.items.properties);
          });
        } else if (field.properties) {
          walk(child, field.properties);
        }
      });
    }
    walk(data, schema);
    data._lightCourseIdeaAssets = ideas;
    model.set(data, { silent: true });
    return data;
  }

  function locations(data, componentLabel, itemLabel) {
    var title = data && (data.displayTitle || data.title) || '';
    title = String(title).replace(/<[^>]*>/g, '').trim();
    var options = [{ val: '', path: '', label: componentLabel + (title ? ': ' + title : '') }];
    function walk(value, label, path, inArray) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        return value.forEach(function(item, index) {
          walk(item, label + ' ' + (index + 1), path + '[' + index + ']', true);
        });
      }
      if (inArray || value._lightCourseIdeaItemId) {
        var title = value.displayTitle || value.title || value.body || '';
        title = String(title).replace(/<[^>]*>/g, '').trim();
        options.push({ val: value._lightCourseIdeaItemId, path: path,
          label: label.trim() + (title ? ': ' + title : '') });
      }
      Object.keys(value).forEach(function(key) {
        if (['_lightCourseIdeaAssets', '_componentSchemaSnapshot', '_comments'].indexOf(key) !== -1) return;
        var childPath = path ? path + '.' + key : key;
        if (Array.isArray(value[key])) {
          var childLabel = itemLabel;
          if (key !== '_items' && key !== 'items') childLabel += ' (' + key.replace(/^_+/, '') + ')';
          walk(value[key], (label ? label + ' / ' : '') + childLabel, childPath);
        }
        else if (value[key] && typeof value[key] === 'object') walk(value[key], label, childPath);
      });
    }
    walk(data, '', '');
    return options;
  }

  function targets(data, componentLabel, itemLabel) {
    return locations(data, componentLabel, itemLabel).filter(function(option) {
      return option.path === '' || option.val;
    }).map(function(option) { return { val: option.val, label: option.label }; });
  }

  function clearItemIds(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(clearItemIds);
    delete value._lightCourseIdeaItemId;
    Object.keys(value).forEach(function(key) { clearItemIds(value[key]); });
  }

  return { newId: newId, prepare: prepare, locations: locations, targets: targets, clearItemIds: clearItemIds };
});
