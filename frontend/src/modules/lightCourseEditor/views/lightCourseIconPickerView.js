// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var IconGlyphs = require('../iconGlyphs');

  /**
   * "Browse icons" reference picker for the Light Course Editor header's Side Drawer icon field
   * (lightCourseHeaderView.js) - lib/lightcourse/iconOptions.js's CONTROLS.drawer is deliberately
   * freeform (the drawer's icon class isn't restricted to one font/class set, per the real
   * framework's core/templates/nav.hbs using the stored value as a literal CSS class), so this is
   * a convenience browser for the framework's own built-in "vanilla" icon set, not a replacement
   * for the text input - any other installed icon font's class can still be typed in directly.
   *
   * Opened via Origin.trigger('modal:open', LightCourseIconPickerView, { _shouldShowDoneButton:
   * false, onUpdate: fn }) - clicking an icon immediately commits (Origin.trigger('modal:onUpdate'))
   * and closes the modal, rather than waiting for a separate "Done" button click.
   */
  var LightCourseIconPickerView = OriginView.extend({
    className: 'light-course-icon-picker',

    events: {
      'click .light-course-icon-picker-item': 'onIconClicked',
      'keyup .light-course-icon-picker-search': 'onSearchChanged'
    },

    postRender: function() {
      this.setViewToReady();
      this.fetchIcons();
    },

    fetchIcons: function() {
      var self = this;
      IconGlyphs.ensureReady(function(iconData) {
        if (!iconData) {
          return self.$('.light-course-icon-picker-items').html('<p class="light-course-icon-picker-error">' +
            Origin.l10n.t('app.errorgettinglightcourseiconclasses') + '</p>');
        }
        self.renderIcons(iconData.icons);
      });
    },

    renderIcons: function(icons) {
      this._allIcons = icons;
      this.renderFilteredIcons(icons);
    },

    renderFilteredIcons: function(icons) {
      var $container = this.$('.light-course-icon-picker-items');
      $container.empty();
      if (!icons.length) {
        $container.html('<p class="light-course-icon-picker-empty">' + Origin.l10n.t('app.lightcoursedrawericonpickernone') + '</p>');
        return;
      }
      icons.forEach(function(icon) {
        var $item = $('<button type="button" class="light-course-icon-picker-item"></button>')
          .attr('data-icon-class', icon.className)
          .attr('title', icon.className);
        $item.append($('<span class="light-course-icon-picker-glyph ' + IconGlyphs.GLYPH_CLASS + ' ' + icon.className + '"></span>'));
        $item.append($('<span class="light-course-icon-picker-label"></span>').text(icon.className));
        $container.append($item);
      });
    },

    onSearchChanged: function(event) {
      var term = $(event.currentTarget).val().trim().toLowerCase();
      var filtered = !term ? this._allIcons : (this._allIcons || []).filter(function(icon) {
        return icon.className.indexOf(term) !== -1;
      });
      this.renderFilteredIcons(filtered || []);
    },

    onIconClicked: function(event) {
      event && event.preventDefault();
      this.selectedClassName = $(event.currentTarget).data('icon-class');
      Origin.trigger('modal:onUpdate');
    },

    getData: function() {
      return { className: this.selectedClassName };
    }
  }, {
    template: 'lightCourseIconPicker'
  });

  return LightCourseIconPickerView;
});
