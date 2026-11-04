// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseConfigAssetPickerView = require('./lightCourseConfigAssetPickerView');

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
   * ../index.js) - four independent sections, each assembled into its own slice of the model's
   * payload only when Save is clicked (nothing is written back to the model incrementally,
   * unlike the light course editor's own header/tree views, since there's no live-course-state
   * reason to keep this model in sync between edits here).
   */
  var LightCourseConfigView = OriginView.extend({
    className: 'light-course-config',

    events: {
      'click .light-course-config-save': 'onSaveClicked',
      'change .light-course-config-menu-select': 'onPluginSelectionChanged',
      'change .light-course-config-theme-select': 'onPluginSelectionChanged',
      'change .light-course-config-extension-checkbox': 'onPluginSelectionChanged',
      'click .light-course-config-placeholder-add': 'onAddPlaceholderClicked',
      'click .light-course-config-placeholder-remove': 'onRemovePlaceholderClicked'
    },

    postRender: function() {
      this.placeholderPickers = {};
      this.requiredDefaultFields = {};
      this.renderPlaceholders();
      this.fetchPluginTypes();
      this.fetchIconOptions();
      this.fetchRequiredDefaultSchema();
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
      menuTypes.forEach(function(menuType) {
        $menu.append($('<option></option>').attr('value', menuType.menu).text(menuType.displayName || menuType.menu)
          .prop('selected', selections.menu === menuType.menu));
      });
      var $theme = this.$('.light-course-config-theme-select').empty();
      $theme.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursenoneselected')));
      themeTypes.forEach(function(themeType) {
        $theme.append($('<option></option>').attr('value', themeType.theme).text(themeType.displayName || themeType.theme)
          .prop('selected', selections.theme === themeType.theme));
      });
      var $extensions = this.$('.light-course-config-extensions-list').empty();
      var selectedExtensions = selections.extensions || [];
      extensionTypes.forEach(function(extensionType) {
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

    // --- Section 2: graphic/audio placeholders (freeform named asset slots) ---

    renderPlaceholders: function() {
      var self = this;
      var placeholders = this.model.get('graphicPlaceholders') || {};
      Object.keys(placeholders).forEach(function(key) {
        self.addPlaceholderRow(key, placeholders[key]);
      });
    },

    addPlaceholderRow: function(key, value) {
      var rowId = _.uniqueId('light-course-config-placeholder-row-');
      var $keyInput = $('<input type="text" class="light-course-config-placeholder-key">')
        .attr('placeholder', Origin.l10n.t('app.lightcourseplaceholdername')).val(key || '');
      var pickerView = new LightCourseConfigAssetPickerView({ assetType: 'image', value: value || '' });
      var $row = $('<div class="light-course-config-placeholder-row col-row" data-row-id="' + rowId + '"></div>');
      $row.append($('<div class="col-35"></div>').append($keyInput));
      $row.append($('<div class="col-45"></div>').append(pickerView.$el));
      $row.append($('<div class="col-20"></div>').append(
        $('<button class="btn alert light-course-config-placeholder-remove">' + Origin.l10n.t('app.delete') + '</button>')
      ));
      this.$('.light-course-config-placeholders-rows').append($row);
      this.placeholderPickers[rowId] = { $row: $row, $keyInput: $keyInput, pickerView: pickerView };
    },

    onAddPlaceholderClicked: function(event) {
      event && event.preventDefault();
      this.addPlaceholderRow('', '');
    },

    onRemovePlaceholderClicked: function(event) {
      event && event.preventDefault();
      var $row = $(event.currentTarget).closest('.light-course-config-placeholder-row');
      var rowId = $row.data('row-id');
      if (this.placeholderPickers[rowId]) {
        this.placeholderPickers[rowId].pickerView.remove();
        delete this.placeholderPickers[rowId];
      }
      $row.remove();
    },

    assemblePlaceholders: function() {
      var result = {};
      _.each(this.placeholderPickers, function(entry) {
        var key = entry.$keyInput.val().trim();
        var value = entry.pickerView.getValue();
        if (key && value) {
          result[key] = value;
        }
      });
      return result;
    },

    // --- Section 3: required-field defaults (schema-driven, per installed component/extension) ---

    fetchRequiredDefaultSchema: function() {
      var self = this;
      $.get('api/lightcourseconfig/requireddefaultschema').done(function(schema) {
        self.renderRequiredDefaults(schema);
      }).fail(function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgeneric') });
      });
    },

    renderRequiredDefaults: function(schema) {
      var self = this;
      var existing = this.model.get('requiredDefaults') || {};
      var $container = this.$('.light-course-config-required-defaults-container').empty();

      function renderGroup(kind, entries) {
        entries.forEach(function(entry) {
          var existingForEntry = (existing[kind] && existing[kind][entry.key]) || {};
          var $group = $('<div class="light-course-config-required-defaults-group"></div>')
            .append('<h3>' + entry.displayName + '</h3>');

          entry.requiredTranslatablePaths.forEach(function(path) {
            var $input = $('<input type="text" class="light-course-config-required-default-text">').val(existingForEntry[path] || '');
            $group.append($('<div class="field-row"></div>').append('<label>' + path + '</label>').append($input));
            self.requiredDefaultFields[kind + '.' + entry.key + '.' + path] = { type: 'text', $input: $input };
          });

          entry.requiredAssetPaths.forEach(function(path) {
            var pickerView = new LightCourseConfigAssetPickerView({ assetType: 'image', value: existingForEntry[path] || '' });
            $group.append($('<div class="field-row"></div>').append('<label>' + path + '</label>').append(pickerView.$el));
            self.requiredDefaultFields[kind + '.' + entry.key + '.' + path] = { type: 'asset', pickerView: pickerView };
          });

          $container.append($group);
        });
      }

      renderGroup('components', schema.components || []);
      renderGroup('extensions', schema.extensions || []);

      if (!(schema.components || []).length && !(schema.extensions || []).length) {
        $container.append('<p>' + Origin.l10n.t('app.lightcoursenorequireddefaults') + '</p>');
      }
    },

    assembleRequiredDefaults: function() {
      var result = { components: {}, extensions: {} };
      _.each(this.requiredDefaultFields, function(field, compoundKey) {
        var parts = compoundKey.split('.');
        var kind = parts[0];
        var entryKey = parts[1];
        var path = parts.slice(2).join('.');
        var value = field.type === 'text' ? field.$input.val() : field.pickerView.getValue();
        if (value) {
          result[kind][entryKey] = result[kind][entryKey] || {};
          result[kind][entryKey][path] = value;
        }
      });
      return result;
    },

    // --- Section 4: icon defaults (Menu/Reflection/Help) ---

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
        (self._iconOptionsByControl[control.key] || []).forEach(function(option) {
          $select.append($('<option></option>').attr('value', option).text(option).prop('selected', iconDefaults[control.key] === option));
        });
        $container.append($select);
      });
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
        graphicPlaceholders: this.assemblePlaceholders(),
        requiredDefaults: this.assembleRequiredDefaults(),
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
      _.each(this.placeholderPickers, function(entry) { entry.pickerView.remove(); });
      _.each(this.requiredDefaultFields, function(field) {
        if (field.pickerView) {
          field.pickerView.remove();
        }
      });
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseConfig'
  });

  return LightCourseConfigView;
});
