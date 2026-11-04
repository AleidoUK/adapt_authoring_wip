// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  /**
   * "Insert glossary/resource reference" picker, opened by lightCourseRefPlugin.js's toolbar
   * buttons. Mirrors the same immediate-click-to-select-and-close modal convention already used
   * by lightCourseIconPickerView.js (Origin.trigger('modal:open', ..., { _shouldShowDoneButton:
   * false, onUpdate: fn })).
   *
   * options.refType: 'glossary' | 'resource'
   * options.items: the course's own glossaryItems/resourceItems array (per
   *   lightCourseTreeView.js's buildLightCourseRefs())
   *
   * getData() returns { type, value, label } - the exact shape
   * lightCourseRefPlugin.js's insertLightCourseRef command expects:
   *   - glossary: { type: 'glossary', value: <term name>, label: <term name> }
   *   - resource (linked):  { type: 'resource-open',    value: <resource _id>, label: <title> }
   *   - resource (marker):  { type: 'resource-marker',  value: <resource _id>, label: <title> }
   */
  var LightCourseRefPickerView = OriginView.extend({
    className: 'light-course-ref-picker',

    events: {
      'click .light-course-ref-picker-item': 'onItemClicked',
      'keyup .light-course-ref-picker-search': 'onSearchChanged'
    },

    preRender: function(options) {
      this.refType = options.refType;
      this.items = options.items || [];
    },

    postRender: function() {
      this.$('.light-course-ref-picker-marker-toggle-row').toggleClass('display-none', this.refType !== 'resource');
      this.renderItems(this.items);
      this.setViewToReady();
    },

    renderItems: function(items) {
      var $container = this.$('.light-course-ref-picker-items');
      $container.empty();
      if (!items.length) {
        $container.html('<p class="light-course-ref-picker-empty">' +
          Origin.l10n.t(this.refType === 'glossary' ? 'app.lightcourserefpickernoglossary' : 'app.lightcourserefpickernoresources') +
          '</p>');
        return;
      }
      var self = this;
      items.forEach(function(item) {
        var label = self.refType === 'glossary' ? item.term : item.title;
        var description = item.description || '';
        var $item = $('<button type="button" class="light-course-ref-picker-item"></button>')
          .attr('data-ref-id', item._id);
        $item.append($('<span class="light-course-ref-picker-item-label"></span>').text(label || ''));
        if (description) {
          $item.append($('<span class="light-course-ref-picker-item-description"></span>').text(description));
        }
        $container.append($item);
      });
    },

    onSearchChanged: function(event) {
      var term = $(event.currentTarget).val().trim().toLowerCase();
      var self = this;
      var filtered = !term ? this.items : this.items.filter(function(item) {
        var label = (self.refType === 'glossary' ? item.term : item.title) || '';
        return label.toLowerCase().indexOf(term) !== -1;
      });
      this.renderItems(filtered);
    },

    onItemClicked: function(event) {
      event && event.preventDefault();
      var id = $(event.currentTarget).data('ref-id');
      var item = _.findWhere(this.items, { _id: id });
      if (!item) {
        return;
      }
      if (this.refType === 'glossary') {
        this.selection = { type: 'glossary', value: item.term, label: item.term };
      } else {
        var asMarker = this.$('.light-course-ref-picker-marker-toggle').is(':checked');
        this.selection = {
          type: asMarker ? 'resource-marker' : 'resource-open',
          value: item._id,
          label: item.title
        };
      }
      Origin.trigger('modal:onUpdate');
    },

    getData: function() {
      return this.selection || null;
    }
  }, {
    template: 'lightCourseRefPicker'
  });

  return LightCourseRefPickerView;
});
