// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  var FONT_STYLE_ELEMENT_ID = 'light-course-icon-picker-font-face';

  // Fetched once per page load (241+ classes, static for the lifetime of the installed
  // framework checkout - see lib/lightcourse/iconClasses.js's own in-memory cache on the server
  // side), shared across every time this picker is opened rather than re-fetched per open.
  var cachedIconData = null;

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
      if (cachedIconData) {
        this.ensureFontFaceInjected();
        return this.renderIcons(cachedIconData.icons);
      }
      var self = this;
      $.get('api/content/lightcourse/icons/classes').done(function(response) {
        cachedIconData = response;
        self.ensureFontFaceInjected();
        self.renderIcons(response.icons);
      }).fail(function() {
        self.$('.light-course-icon-picker-items').html('<p class="light-course-icon-picker-error">' +
          Origin.l10n.t('app.errorgettinglightcourseiconclasses') + '</p>');
      });
    },

    /**
     * Injects one shared <style> tag (once per page load, not once per picker open) declaring
     * the real installed framework's own vanilla icon font plus every class's :before content
     * codepoint, so each picker item can render the actual glyph via a plain
     * `<span class="icon-xxx">` - exactly the same mechanism the framework's own
     * core/less/_defaults/icons.less uses, just re-derived client-side from the parsed data
     * rather than loading that whole stylesheet (which assumes the full framework page/theme).
     */
    ensureFontFaceInjected: function() {
      if (document.getElementById(FONT_STYLE_ELEMENT_ID) || !cachedIconData) {
        return;
      }
      var fontUrls = cachedIconData.fontUrls;
      var rules = cachedIconData.icons.map(function(icon) {
        return '.light-course-icon-picker .' + icon.className + ':before { content: "\\' + icon.codepoint + '"; }';
      }).join('\n');
      var css = '@font-face {' +
        ' font-family: "light-course-vanilla-icons";' +
        ' src: url("' + fontUrls.woff2 + '") format("woff2"), url("' + fontUrls.woff + '") format("woff");' +
        ' font-weight: normal; font-style: normal; font-display: block; }\n' +
        '.light-course-icon-picker [class*="icon-"]:before {' +
        ' font-family: "light-course-vanilla-icons"; font-style: normal; speak: none; }\n' + rules;
      $('<style>').attr('id', FONT_STYLE_ELEMENT_ID).text(css).appendTo('head');
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
        $item.append($('<span class="light-course-icon-picker-glyph ' + icon.className + '"></span>'));
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
