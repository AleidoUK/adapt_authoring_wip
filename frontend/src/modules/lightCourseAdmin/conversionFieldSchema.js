define(function(require) {
  var Origin = require('core/origin');
  var BankAsset = require('../lightCourseEditor/views/lightCourseBankAssetFieldView');

  var List;
  var HiddenValue;
  function hiddenEditor() {
    if (HiddenValue) return HiddenValue;
    HiddenValue = Backbone.Form.editors.Base.extend({
      initialize: function(options) {
        Backbone.Form.editors.Base.prototype.initialize.call(this, options);
        this.value = options.value;
      },
      render: function() { return this; },
      getValue: function() {
        var value = this.schema.conversionUseDefault ? this.schema.default : this.value;
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      }
    });
    return HiddenValue;
  }
  function listEditor() {
    if (List) return List;
    // The full editor's list overrides depend on an active course and create courseasset joins.
    var Base = Backbone.Form.editors.__List || Backbone.Form.editors.List;
    var BaseItem = Base.__Item || Base.Item;
    List = Base.extend({
      events: {
        'click [data-action="add"]': function(event) {
          event.preventDefault();
          event.stopPropagation();
          this.addItem(undefined, true);
        }
      },
      render: function() {
        this.rendering = true;
        try { return Base.prototype.render.apply(this, arguments); }
        finally { this.rendering = false; }
      },
      addItem: function(value, userInitiated) {
        if (this.rendering && value === undefined) return;
        return Base.prototype.addItem.call(this, value, userInitiated);
      },
      removeItem: function(item) {
        var index = this.items.indexOf(item);
        if (index === -1) return;
        item.remove();
        this.items.splice(index, 1);
        this.trigger('remove', this, item.editor);
        this.trigger('change', this);
      },
      setValue: function(value) {
        this.items.forEach(function(item) { item.remove(); });
        this.items = [];
        return Base.prototype.setValue.call(this, value);
      }
    });
    List.Item = BaseItem.extend({
      initialize: function(options) {
        BaseItem.prototype.initialize.call(this, options);
        this.schema = this.schema.itemSchema;
      },
      events: {
        'click [data-action="remove"]': function(event) {
          event.preventDefault();
          event.stopPropagation();
          this.list.removeItem(this);
        },
        'keydown input[type=text]': function(event) {
          if (event.which !== 13) return;
          event.preventDefault();
          event.stopPropagation();
        }
      }
    });
    List.Item.template = BaseItem.template;
    return List;
  }

  function build(field, key) {
    var definition = JSON.parse(JSON.stringify(field));
    if (definition.conversionHidden) return {
      type: hiddenEditor(), fieldAttrs: { style: 'display: none' },
      default: definition.default, conversionUseDefault: definition.conversionUseDefault
    };
    definition.title = definition.title || key;
    definition.required = false;
    definition.validators = [];
    var input = definition.inputType;
    var inputType = typeof input === 'object' && input ? input.type : input;
    if ((typeof inputType === 'string' && inputType.indexOf('Asset:') === 0) || definition._backboneForms === 'Asset') {
      return {
        type: BankAsset, title: definition.title, help: definition.help,
        default: definition.default,
        inputType: 'LightCourseAsset:' + (typeof inputType === 'string' && inputType.split(':')[1] || 'image'),
        validators: []
      };
    }
    if (definition.type === 'object' || definition.properties) {
      var properties = {};
      Object.keys(definition.properties || {}).forEach(function(name) {
        properties[name] = build(definition.properties[name], name);
      });
      return { type: Backbone.Form.editors.Object, title: definition.title, help: definition.help,
        default: definition.default, subSchema: properties };
    }
    if (definition.type === 'array') {
      var item = build(definition.items || { type: 'string' }, key);
      return Object.assign({}, item, {
        type: listEditor(), title: definition.title, help: definition.help,
        default: definition.default,
        itemType: typeof item.type === 'string' ? Backbone.Form.editors[item.type] : item.type,
        itemClass: listEditor().Item,
        itemSchema: item,
        confirmDelete: false
      });
    }
    return Origin.scaffold.buildSchema({ value: definition }).value;
  }

  return build;
});
