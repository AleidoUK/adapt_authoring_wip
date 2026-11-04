// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseIconPickerView = require('./lightCourseIconPickerView');

  var TERMINOLOGY_OPTIONS = {
    section: ['Section', 'Topic'],
    course: ['Course', 'Module'],
    assessment: ['Assessment', 'Quiz']
  };

  // Confirmed against docs/LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md's icon validation table - each
  // control is owned by its own extension/config, not a single shared theme/menu list. The
  // drawer control has no fixed option list (freeform CSS class) and the Back button has no
  // configurable icon at all, so neither is rendered as a picker here.
  // Real installed extension identifiers (extensiontype.extension field), confirmed against the
  // live installed instance - NOT the Phase 1 schema-spike's assumed `adapt-aleido-*` bower-
  // package-style names, which the actual extensiontype records don't use.
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
   * Header sections (Phase 3's "Header sections" section). Reads/writes directly on this.model's
   * headerData/pluginSelections in-memory, then fires the shared `lightCourseEditor:autosave`
   * Origin event (handled by lightCourseEditorView.js) so every field change/blur/version-row edit
   * persists on its own, rather than only when a manual save action is taken.
   */
  var LightCourseHeaderView = OriginView.extend({
    className: 'light-course-header',

    events: {
      'change [data-bind]': 'onFieldChanged',
      'blur [data-bind]': 'onFieldChanged',
      'click .light-course-header-drawer-icon-browse': 'onBrowseDrawerIconClicked',
      'change .light-course-header-version-notes, .light-course-header-version-duration': 'onVersionRowFieldChanged',
      'blur .light-course-header-version-notes, .light-course-header-version-duration': 'onVersionRowFieldChanged'
    },

    preRender: function() {
      var headerData = this.model.get('headerData') || {};
      headerData.versionHistory = headerData.versionHistory || [];
      headerData.reviewingInstructions = headerData.reviewingInstructions || '';
      headerData.developerInfo = headerData.developerInfo || {};
      headerData.terminology = headerData.terminology || {};
      headerData.iconChoices = headerData.iconChoices || {};
      this.model.set('headerData', headerData, { silent: true });
    },

    postRender: function() {
      this.renderVersionHistory();
      this.fetchIconOptions();
      this.setViewToReady();
    },

    /**
     * Renders every version-history row - safe to call repeatedly (e.g. after every autosave
     * refreshes the current row's words/screens, not just on first render): only ever touches
     * this container's own innerHTML, never the rest of the header view's DOM, so any in-progress
     * typing in another header field survives a version-history-only refresh untouched. The
     * notes/duration change|blur handling itself lives in this view's own delegated `events` map
     * (bound once for the view's lifetime), not re-bound here on every call, to avoid stacking
     * duplicate handlers across repeated renders.
     */
    renderVersionHistory: function() {
      var headerData = this.model.get('headerData');
      var $tbody = this.$('.light-course-header-version-history-rows');
      $tbody.empty();
      headerData.versionHistory.forEach(function(row, index) {
        var $row = $('<div class="light-course-header-version-row col-row"></div>');
        ['version', 'date', 'author', 'screens', 'words'].forEach(function(key) {
          $row.append($('<div class="col-15"></div>').text(row[key] || ''));
        });
        $row.append($('<div class="col-20"><textarea class="light-course-header-version-notes" rows="1"></textarea></div>')
          .find('textarea').val(row.notes || '').attr('data-version-index', index).end());
        $row.append($('<div class="col-15"><input type="text" class="light-course-header-version-duration"></div>')
          .find('input').val(row.duration || '').attr('data-version-index', index).end());
        $tbody.append($row);
      });
    },

    onVersionRowFieldChanged: function(event) {
      var $target = $(event.currentTarget);
      var index = $target.data('version-index');
      var key = $target.hasClass('light-course-header-version-notes') ? 'notes' : 'duration';
      var headerData = this.model.get('headerData');
      headerData.versionHistory[index][key] = $target.val();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onFieldChanged: function(event) {
      var $target = $(event.currentTarget);
      var path = ($target.data('bind') || '').split('.');
      if (!path.length) {
        return;
      }
      var headerData = this.model.get('headerData');
      var target = headerData;
      for (var i = 0; i < path.length - 1; i++) {
        target[path[i]] = target[path[i]] || {};
        target = target[path[i]];
      }
      var value = $target.is(':checkbox') ? $target.is(':checked') : $target.val();
      target[path[path.length - 1]] = value;
      Origin.trigger('lightCourseEditor:autosave');
    },

    /**
     * Opens the "browse icons" reference picker (views/lightCourseIconPickerView.js) - a
     * convenience for the freeform Side Drawer icon field (lib/lightcourse/iconOptions.js's
     * CONTROLS.drawer), not a replacement for it. Writes the chosen class into the real text
     * input and fires a real `change` event on it, so the existing generic onFieldChanged
     * handler above (bound to every `[data-bind]` field) picks it up exactly as if the editor
     * had typed it in directly - no separate write path needed here.
     */
    onBrowseDrawerIconClicked: function(event) {
      event && event.preventDefault();
      var $input = this.$('.light-course-header-drawer-icon-input');
      Origin.trigger('modal:open', LightCourseIconPickerView, {
        title: Origin.l10n.t('app.lightcoursedrawericonpickertitle'),
        _shouldShowDoneButton: false,
        onUpdate: function(data) {
          if (!data || !data.className) {
            return;
          }
          $input.val(data.className).trigger('change');
        }
      });
    },

    isExtensionSelected: function(extensionName) {
      var pluginSelections = this.model.get('pluginSelections') || {};
      return (pluginSelections.extensions || []).indexOf(extensionName) !== -1;
    },

    fetchIconOptions: function() {
      var self = this;
      $.get('api/extensiontype').done(function(extensionTypes) {
        // cached so refreshIconControls() (called whenever a Plugin Selections extension
        // checkbox changes, from lightCourseEditorView.js) can re-check which controls should be
        // shown without another round-trip - the option lists themselves don't change at runtime.
        self._iconOptionsByControl = {};
        ICON_CONTROLS.forEach(function(control) {
          var extensionType = _.findWhere(extensionTypes, { extension: control.extensionName });
          var node = extensionType && getIn(extensionType.properties, control.schemaPath);
          self._iconOptionsByControl[control.key] = (node && node.inputType && node.inputType.options) || [];
        });
        self.refreshIconControls();
      }).fail(function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lighcourseerroriconoptions') });
      });
    },

    /**
     * Shows/populates each Menu/Reflection/Help icon picker only once its owning extension's
     * checkbox is selected in Plugin Selections - hidden (not just empty) otherwise, per the
     * main plan. Safe to call repeatedly (e.g. on every extension-checkbox change) since it only
     * re-checks cached option lists, no new network request.
     */
    refreshIconControls: function() {
      if (!this._iconOptionsByControl) {
        return; // fetchIconOptions() hasn't resolved yet
      }
      var self = this;
      ICON_CONTROLS.forEach(function(control) {
        self.renderIconSelect(control.key, self._iconOptionsByControl[control.key] || [], self.isExtensionSelected(control.extensionName));
      });
    },

    renderIconSelect: function(key, options, isEnabled) {
      var $container = this.$('.light-course-header-icon-' + key);
      if (!$container.length) {
        return;
      }
      // hide the whole label+dropdown row, not just the dropdown itself, so a deselected
      // extension doesn't leave an orphaned label with nothing under it.
      var $row = $container.closest('.field-row');
      if (!isEnabled) {
        // the owning extension isn't selected - hide the picker entirely rather than showing an
        // empty/meaningless dropdown, and don't write a default value for a choice that doesn't
        // currently apply to this course.
        $container.empty();
        $row.addClass('display-none');
        return;
      }
      $row.removeClass('display-none');
      var headerData = this.model.get('headerData');
      var $select = $('<select data-bind="iconChoices.' + key + '"></select>');
      options.slice().sort(function(a, b) {
        return a.localeCompare(b);
      }).forEach(function(option, index) {
        var $option = $('<option></option>').attr('value', option).text(option);
        if (headerData.iconChoices[key] ? headerData.iconChoices[key] === option : index === 0) {
          $option.attr('selected', 'selected');
          if (!headerData.iconChoices[key]) {
            headerData.iconChoices[key] = option; // first option is always the default, per the main plan
          }
        }
        $select.append($option);
      });
      $container.empty().append($select);
    }
  }, {
    template: 'lightCourseHeader'
  });

  return LightCourseHeaderView;
});
