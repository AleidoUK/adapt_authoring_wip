define(function(require) {
  var Origin = require('core/origin');
  var listEditor = require('./inlineListEditor');

  function prepare(schema) {
    Object.keys(schema).forEach(function(key) {
      var field = schema[key];
      if (field.type === 'List' && field.itemType === 'Object') {
        field.subSchema = Origin.scaffold.buildSchema(field.subSchema);
      }
      if (field.subSchema && (field.type === 'Object' || field.itemType === 'Object')) {
        prepare(field.subSchema);
      }
      if (field.type !== 'List') return;
      var List = listEditor();
      var itemType = field.itemType || 'Text';
      itemType = typeof itemType === 'string' ? Backbone.Form.editors[itemType] : itemType;
      field.preserveOrder = true;
      field.itemSchema = Object.assign({}, field, { type: itemType });
      field.type = List;
      field.itemType = itemType;
      field.itemClass = List.Item;
      field.confirmDelete = false;
    });
    return schema;
  }
  return prepare;
});
