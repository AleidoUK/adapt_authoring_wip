// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var IconGlyphs = require('../../lightCourseEditor/iconGlyphs');

  // Same per-control option-fetch approach as lightCourseEditor/views/lightCourseHeaderView.js's
  // own ICON_CONTROLS/getIn - duplicated here rather than shared (see
  // lightCourseTemplateEditorView.js's own "duplicate the small block" note for why), since this
  // view's icon pickers are always visible (a tenant-wide default has no "owning extension
  // selected on this particular course" concept to gate on).
  var ICON_CONTROLS = [
    { key: 'menuButton', extensionName: 'menuButton', schemaPath: ['pluginLocations', 'contentobject', '_menuButton', '_icon'] },
    { key: 'reflection', extensionName: 'reflection', schemaPath: ['pluginLocations', 'course', '_reflection', '_navItem', '_icon'] },
    { key: 'help', extensionName: 'help', schemaPath: ['pluginLocations', 'course', '_help', '_navItem', '_icon'] }
  ];

  function getIn(obj, path) {
    return path.reduce(function(acc, key) {
      return acc && acc.properties ? acc.properties[key] : (acc && acc[key]);
    }, obj);
  }

  /**
   * Admin-only tenant-wide default configuration screen (lib/role/*.json wildcard-only, see
   * ../index.js) - two independent sections, each assembled into its own slice of the model's
   * payload only when Save is clicked (nothing is written back to the model incrementally,
   * unlike the light course editor's own header/tree views, since there's no live-course-state
   * reason to keep this model in sync between edits here).
   *
   * Per-component field defaults (graphic/audio placeholders, required-field prompts) used to
   * live here too, but per direct user request were removed in favour of the dedicated
   * "Component Defaults" admin screen (plugins/content/lightcomponentdefault/) - this view no
   * longer renders or submits `graphicPlaceholders`/`requiredDefaults` at all. Both fields remain
   * in the backend model/schema (plugins/content/lightcourseconfig/model.schema) purely so any
   * previously-saved values aren't silently wiped by this screen's own save - they're just never
   * read or written from here any more.
   */
  var LightCourseConfigView = OriginView.extend({
    className: 'light-course-config',

    events: {
      'click .light-course-config-save': 'onSaveClicked',
      'change .light-course-config-menu-select': 'onPluginSelectionChanged',
      'change .light-course-config-theme-select': 'onPluginSelectionChanged',
      'change .light-course-config-extension-checkbox': 'onPluginSelectionChanged',
      'change .light-course-config-icon-select': 'onIconSelectChanged'
    },

    postRender: function() {
      this.fetchPluginTypes();
      this.fetchIconOptions();
      this.setViewToReady();
    },

    // --- Section 1: default plugin selections (menu/theme/extensions) ---

    fetchPluginTypes: function() {
      var self = this;
      $.when($.get('api/menutype'), $.get('api/themetype'), $.get('api/extensiontype')).done(function(menuRes, themeRes, extensionRes) {
        self.renderPluginSelections(menuRes[0], themeRes[0], extensionRes[0]);
      });
    },

    renderPluginSelections: function(menuTypes, themeTypes, extensionTypes) {
      var selections = this.model.get('defaultPluginSelections') || {};
      var $menu = this.$('.light-course-config-menu-select').empty();
      $menu.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursenoneselected')));
      menuTypes.slice().sort(function(a, b) {
        return (a.displayName || a.menu).localeCompare(b.displayName || b.menu);
      }).forEach(function(menuType) {
        $menu.append($('<option></option>').attr('value', menuType.menu).text(menuType.displayName || menuType.menu)
          .prop('selected', selections.menu === menuType.menu));
      });
      var $theme = this.$('.light-course-config-theme-select').empty();
      $theme.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursenoneselected')));
      themeTypes.slice().sort(function(a, b) {
        return (a.displayName || a.theme).localeCompare(b.displayName || b.theme);
      }).forEach(function(themeType) {
        $theme.append($('<option></option>').attr('value', themeType.theme).text(themeType.displayName || themeType.theme)
          .prop('selected', selections.theme === themeType.theme));
      });
      var $extensions = this.$('.light-course-config-extensions-list').empty();
      var selectedExtensions = selections.extensions || [];
      extensionTypes.slice().sort(function(a, b) {
        return (a.displayName || a.extension).localeCompare(b.displayName || b.extension);
      }).forEach(function(extensionType) {
        var id = 'light-course-config-extension-' + extensionType.extension;
        var $checkbox = $('<input type="checkbox" class="light-course-config-extension-checkbox">')
          .attr('id', id).attr('data-extension', extensionType.extension)
          .prop('checked', selectedExtensions.indexOf(extensionType.extension) !== -1);
        var $label = $('<label></label>').attr('for', id).text(extensionType.displayName || extensionType.extension);
        $extensions.append($('<div class="light-course-config-extension-row"></div>').append($checkbox).append($label));
      });
    },

    onPluginSelectionChanged: function() {
      var selections = this.model.get('defaultPluginSelections') || {};
      selections.menu = this.$('.light-course-config-menu-select').val() || undefined;
      selections.theme = this.$('.light-course-config-theme-select').val() || undefined;
      selections.extensions = this.$('.light-course-config-extension-checkbox:checked').map(function() {
        return $(this).data('extension');
      }).get();
      this.model.set('defaultPluginSelections', selections, { silent: true });
    },

    // --- Section 2: icon defaults (Menu/Reflection/Help) ---

    fetchIconOptions: function() {
      var self = this;
      $.get('api/extensiontype').done(function(extensionTypes) {
        self._iconOptionsByControl = {};
        ICON_CONTROLS.forEach(function(control) {
          var extensionType = _.findWhere(extensionTypes, { extension: control.extensionName });
          var node = extensionType && getIn(extensionType.properties, control.schemaPath);
          self._iconOptionsByControl[control.key] = (node && node.inputType && node.inputType.options) || [];
        });
        self.renderIconDefaults();
      }).fail(function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lighcourseerroriconoptions') });
      });
    },

    renderIconDefaults: function() {
      var self = this;
      var iconDefaults = this.model.get('iconDefaults') || {};
      ICON_CONTROLS.forEach(function(control) {
        var $container = self.$('.light-course-config-icon-' + control.key).empty();
        var $select = $('<select class="light-course-config-icon-select"></select>').attr('data-control', control.key);
        $select.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursenoneselected')));
        (self._iconOptionsByControl[control.key] || []).slice().sort(function(a, b) {
          return a.localeCompare(b);
        }).forEach(function(option) {
          $select.append($('<option></option>').attr('value', option).text(option).prop('selected', iconDefaults[control.key] === option));
        });
        var $preview = $('<span class="light-course-config-icon-preview"></span>');
        $container.append($select).append($preview);
        self.updateIconPreview($preview, iconDefaults[control.key]);
      });
    },

    /**
     * Shows the actual glyph (from the vanilla framework's own built-in icon font, same source
     * as lightCourseIconPickerView.js's "browse icons" modal) next to a Menu/Reflection/Help
     * select, updating live as the selection changes - per direct user request. The select's own
     * option values are plain names (e.g. "home") with no "icon-" prefix (confirmed against the
     * real installed extensions' own schema, e.g. adapt-aleido-menuButton's `_icon` field), but
     * the framework's actual CSS class always is that name prefixed with "icon-".
     */
    updateIconPreview: function($preview, value) {
      $preview.attr('class', 'light-course-config-icon-preview');
      if (!value) {
        return;
      }
      IconGlyphs.ensureReady(function(iconData) {
        if (!iconData) {
          return;
        }
        $preview.addClass(IconGlyphs.GLYPH_CLASS).addClass('icon-' + value);
      });
    },

    onIconSelectChanged: function(event) {
      var $select = $(event.currentTarget);
      this.updateIconPreview($select.next('.light-course-config-icon-preview'), $select.val());
    },

    assembleIconDefaults: function() {
      var result = {};
      this.$('.light-course-config-icon-select').each(function() {
        var value = $(this).val();
        if (value) {
          result[$(this).data('control')] = value;
        }
      });
      return result;
    },

    onSaveClicked: function(event) {
      event && event.preventDefault();
      var data = {
        defaultPluginSelections: this.model.get('defaultPluginSelections') || {},
        iconDefaults: this.assembleIconDefaults()
      };
      this.model.save(data, {
        wait: true,
        success: function() {
          Origin.Notify.alert({ type: 'success', text: Origin.l10n.t('app.lightcourseconfigsaved') });
        },
        error: function(model, response) {
          var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
          Origin.Notify.alert({ type: 'error', text: message });
        }
      });
    },

    remove: function() {
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseConfig'
  });

  return LightCourseConfigView;
});
