define(function(require) {
  var Origin = require('core/origin');
  var Alphabetical = require('./alphabetical');
  var List;
  return function() {
    if (List) return List;
    // Full-course list overrides require an active course and create courseasset joins.
    var Base = Backbone.Form.editors.__List || Backbone.Form.editors.List;
    var BaseItem = Base.__Item || Base.Item;
    List = Base.extend({
      events: {
        'focusout': function(event) {
          if (event.relatedTarget && this.el.contains(event.relatedTarget)) return;
          this.sortItems();
        },
        'click [data-action="add"]': function(event) {
          event.preventDefault();
          event.stopPropagation();
          this.addItem(undefined, true);
        }
      },
      render: function() {
        if (!this.sortItemsBound && typeof this.on === 'function') {
          this.on('add', this.sortItems, this);
          this.sortItemsBound = true;
        }
        this.rendering = true;
        try {
          Base.prototype.render.apply(this, arguments);
          this.sortItems();
          return this;
        }
        finally { this.rendering = false; }
      },
      addItem: function(value, userInitiated) {
        if (this.rendering && value === undefined) return;
        var previous = this.userInitiated;
        this.userInitiated = userInitiated;
        try {
          var item = Base.prototype.addItem.call(this, value, userInitiated);
          if (!this.rendering) this.sortItems();
          return item;
        }
        finally { this.userInitiated = previous; }
      },
      sortItems: function() {
        var preserveOrder = this.schema && this.schema.preserveOrder;
        if (!preserveOrder) {
          this.items.sort(function(a, b) { return Alphabetical.compare(a.getValue(), b.getValue()); });
        }
        this.items.forEach(function(item, index) {
          this.$list.append(item.el);
          if (preserveOrder) {
            item.$('[data-action="move-up"]').prop('disabled', index === 0);
            item.$('[data-action="move-down"]').prop('disabled', index === this.items.length - 1);
          }
        }, this);
      },
      getValue: function() {
        var values = Base.prototype.getValue.call(this);
        return this.schema && this.schema.preserveOrder ? values : values.sort(Alphabetical.compare);
      },
      moveItem: function(item, direction) {
        if (!this.schema || !this.schema.preserveOrder) return;
        var index = this.items.indexOf(item);
        var newIndex = index + direction;
        if (index === -1 || newIndex < 0 || newIndex >= this.items.length) return;
        this.items.splice(index, 1);
        this.items.splice(newIndex, 0, item);
        this.sortItems();
        this.trigger('change', this);
      },
      removeItem: function(item) {
        var index = this.items.indexOf(item);
        if (index === -1) return;
        this.items.splice(index, 1);
        item.remove();
        this.sortItems();
        this.trigger('remove', this, item.editor);
        this.trigger('change', this);
      },
      setValue: function(value) {
        var items = this.items;
        this.items = [];
        items.forEach(function(item) { item.remove(); });
        return Base.prototype.setValue.call(this, value);
      }
    });
    List.Item = BaseItem.extend({
      initialize: function(options) {
        BaseItem.prototype.initialize.call(this, options);
        this.schema = this.schema.itemSchema;
      },
      render: function() {
        this.editor = new this.Editor({
          id: 'light-course-item-' + this.cid,
          key: this.key,
          schema: this.schema,
          value: this.value,
          list: this.list,
          item: this,
          form: this.form
        }).render();
        var $el = Backbone.$(Backbone.$.trim(this.template({
          preserveOrder: !!(this.list.schema && this.list.schema.preserveOrder)
        })));
        $el.find('[data-editor]').append(this.editor.el);
        this.setElement($el);
        this.$el.children('details').prop('open', this.value === undefined || !!this.list.userInitiated);
        this.listenTo(this.editor, 'change', this.updateLabel);
        this.updateLabel();
        return this;
      },
      updateLabel: function() {
        var label = Alphabetical.label(this.getValue()).replace(/<[^>]*>/g, '').trim();
        this.$el.children('details').children('summary').children('.light-course-inline-list-item-label')
          .text(label || Origin.l10n.t('app.lightcourseinlineitemuntitled'));
      },
      events: {
        'click [data-action="move-up"]': function(event) {
          event.preventDefault();
          event.stopPropagation();
          this.list.moveItem(this, -1);
        },
        'click [data-action="move-down"]': function(event) {
          event.preventDefault();
          event.stopPropagation();
          this.list.moveItem(this, 1);
        },
        'click [data-action="clone"]': function(event) {
          event.preventDefault();
          event.stopPropagation();
          var value = this.getValue();
          this.list.addItem(value === undefined ? undefined : JSON.parse(JSON.stringify(value)), true);
        },
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
    List.Item.template = Handlebars.templates.lightCourseInlineListItem;
    List.template = Handlebars.templates.list;
    return List;
  };
});
