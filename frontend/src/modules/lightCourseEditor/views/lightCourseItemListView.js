// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  /**
   * Generic add/edit/reorder/remove list editor for the Light Course Editor's extension-gated
   * content lists (glossary/resource/help-item entries - Phase 4's "Glossary/resources entries"
   * and "Help extension editor" sections). Each entry is a flat object with a stable `_id` (per
   * Phase 2's item-ID convention) plus whatever text/select fields are configured.
   *
   * Gated on the owning extension being selected, per the main plan ("if a course doesn't have
   * the glossary or resources extension selected, the editor will say so rather than let entries
   * be added and then quietly dropped") - callers pass `isEnabled` based on
   * `pluginSelections.extensions`.
   *
   * options:
   *   - items: the array to edit (mutated in place; this.getItems() also returns it)
   *   - fields: [{ key, label, type: 'text'|'textarea'|'select', options: [] }]
   *   - isEnabled: boolean
   *   - disabledMessageKey: l10n key shown instead of the editor when isEnabled is false
   *   - emptyItem: function returning a new blank item's extra fields (merged with a fresh _id)
   */
  var LightCourseItemListView = OriginView.extend({
    className: 'light-course-item-list',

    events: {
      'click .light-course-item-list-add': 'onAddClicked',
      'click .light-course-item-list-remove': 'onRemoveClicked',
      'click .light-course-item-list-move-up': 'onMoveUpClicked',
      'click .light-course-item-list-move-down': 'onMoveDownClicked',
      'change [data-item-field]': 'onFieldChanged',
      'blur [data-item-field]': 'onFieldChanged'
    },

    preRender: function(options) {
      this.items = options.items;
      this.fields = options.fields;
      this.isEnabled = options.isEnabled;
      this.disabledMessageKey = options.disabledMessageKey;
      this.emptyItem = options.emptyItem || function() { return {}; };
    },

    postRender: function() {
      this.renderItems();
      this.setViewToReady();
    },

    getItems: function() {
      return this.items;
    },

    renderItems: function() {
      if (!this.isEnabled) {
        this.$el.html('<p class="light-course-item-list-disabled">' + Origin.l10n.t('app.' + this.disabledMessageKey) + '</p>');
        return;
      }
      var self = this;
      var $container = $('<div class="light-course-item-list-rows"></div>');
      this.items.forEach(function(item, index) {
        $container.append(self.renderRow(item, index));
      });
      this.$el.html('').append($container).append(
        '<button class="btn secondary-hollow light-course-item-list-add">' + Origin.l10n.t('app.lightcourseadditem') + '</button>'
      );
    },

    renderRow: function(item, index) {
      var self = this;
      var $row = $('<div class="light-course-item-list-row" data-index="' + index + '"></div>');
      this.fields.forEach(function(field) {
        var $field;
        if (field.type === 'textarea') {
          $field = $('<textarea></textarea>').val(item[field.key] || '');
        } else if (field.type === 'select') {
          $field = $('<select></select>');
          (field.options || []).forEach(function(option) {
            $field.append($('<option></option>').attr('value', option).text(option).prop('selected', item[field.key] === option));
          });
        } else {
          $field = $('<input type="text">').val(item[field.key] || '');
        }
        $field.attr('data-item-field', field.key).attr('placeholder', field.label);
        $row.append($('<label></label>').text(field.label)).append($field);
      });
      $row.append(
        '<span class="light-course-item-list-actions">' +
        '<button class="btn-icon light-course-item-list-move-up" title="' + Origin.l10n.t('app.lightcoursemoveup') + '"><i class="fa fa-arrow-up"></i></button>' +
        '<button class="btn-icon light-course-item-list-move-down" title="' + Origin.l10n.t('app.lightcoursemovedown') + '"><i class="fa fa-arrow-down"></i></button>' +
        '<button class="btn-icon light-course-item-list-remove" title="' + Origin.l10n.t('app.remove') + '"><i class="fa fa-trash-o"></i></button>' +
        '</span>'
      );
      return $row;
    },

    onFieldChanged: function(event) {
      var $target = $(event.currentTarget);
      var index = $target.closest('.light-course-item-list-row').data('index');
      this.items[index][$target.data('item-field')] = $target.val();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onAddClicked: function(event) {
      event && event.preventDefault();
      this.items.push(Object.assign({ _id: '' }, this.emptyItem()));
      this.renderItems();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onRemoveClicked: function(event) {
      event && event.preventDefault();
      var index = $(event.currentTarget).closest('.light-course-item-list-row').data('index');
      this.items.splice(index, 1);
      this.renderItems();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onMoveUpClicked: function(event) {
      event && event.preventDefault();
      this.moveItem($(event.currentTarget).closest('.light-course-item-list-row').data('index'), -1);
    },

    onMoveDownClicked: function(event) {
      event && event.preventDefault();
      this.moveItem($(event.currentTarget).closest('.light-course-item-list-row').data('index'), 1);
    },

    moveItem: function(index, direction) {
      var newIndex = index + direction;
      if (newIndex < 0 || newIndex >= this.items.length) {
        return;
      }
      var item = this.items.splice(index, 1)[0];
      this.items.splice(newIndex, 0, item);
      this.renderItems();
      Origin.trigger('lightCourseEditor:autosave');
    }
  }, {
    template: 'lightCourseItemList'
  });

  return LightCourseItemListView;
});
