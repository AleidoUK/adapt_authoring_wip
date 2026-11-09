// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var itemHistory = require('../itemHistory');
  var LightCourseTreeView = require('../../lightCourseEditor/views/lightCourseTreeView');
  var LightCourseItemListView = require('../../lightCourseEditor/views/lightCourseItemListView');
  var LightCourseHelpView = require('../../lightCourseEditor/views/lightCourseHelpView');
  var TagEditor = require('../../lightCourseEditor/tagEditor');

  // Same real installed extension identifiers used in lightCourseEditor/views/
  // lightCourseEditorView.js - duplicated rather than shared from there deliberately: this is a
  // separate, admin-only module (per lib/role permission scoping), and the rendering logic below
  // is a near-exact duplicate of that view's own glossary/resources/help/plugin-selection code,
  // reused this way (rather than refactoring the full-course-editor's module to export it) to
  // avoid risking the already-tested, light-editor-facing editor while building this.
  var GLOSSARY_EXTENSION = 'glossary';
  var RESOURCES_EXTENSION = 'resources';
  var HELP_EXTENSION = 'help';

  /**
   * Admin-only full content editor for a light course template - reuses the exact same tree/
   * glossary/resources/help sub-views the light course editor itself uses, bound to a
   * LightCourseTemplateModel (see ../models/lightCourseTemplateModel.js for how its contentSnapshot
   * wrapper is flattened/re-wrapped transparently so those sub-views need no changes at all).
   */
  var LightCourseTemplateEditorView = OriginView.extend({
    className: 'light-course-template-editor',

    events: {
      'click .light-course-template-editor-back-to-list': 'onBackToListClicked',
      'click .light-course-template-editor-save': 'onSaveClicked',
      'click .light-course-item-history': itemHistory('lightcoursetemplate'),
      'change .light-course-template-editor-menu-select': 'onPluginSelectionChanged',
      'change .light-course-template-editor-theme-select': 'onPluginSelectionChanged',
      'change .light-course-template-editor-extension-checkbox': 'onPluginSelectionChanged'
    },

    preRender: function() {
      // ensure stable array/object references so the item-list sub-views' in-place mutations
      // (push/splice) are reflected back onto the model automatically
      this.model.set('glossaryItems', this.model.get('glossaryItems') || [], { silent: true });
      this.model.set('resourceItems', this.model.get('resourceItems') || [], { silent: true });
    },

    postRender: function() {
      if (this._removed) return;
      TagEditor.initialize.call(this);
      this.treeView = new LightCourseTreeView({ model: this.model });
      this.$('.light-course-template-editor-tree-container').append(this.treeView.$el);

      this.renderGlossaryResourcesHelp();

      this.fetchComponentTypes();
      this.fetchPluginTypes();
      this.setViewToReady();
    },

    isExtensionSelected: function(extensionName) {
      var pluginSelections = this.model.get('pluginSelections') || {};
      return (pluginSelections.extensions || []).indexOf(extensionName) !== -1;
    },

    renderGlossaryResourcesHelp: function() {
      if (this.glossaryView) {
        this.glossaryView.remove();
      }
      if (this.resourcesView) {
        this.resourcesView.remove();
      }
      if (this.helpView) {
        this.helpView.remove();
      }

      this.glossaryView = new LightCourseItemListView({
        items: this.model.get('glossaryItems') || [],
        isEnabled: this.isExtensionSelected(GLOSSARY_EXTENSION),
        disabledMessageKey: 'lightcourseglossarydisabled',
        fields: [
          { key: 'term', label: Origin.l10n.t('app.lightcourseterm'), type: 'text' },
          { key: 'description', label: Origin.l10n.t('app.lightcoursedescription'), type: 'textarea' }
        ],
        emptyItem: function() { return { term: '', description: '' }; }
      });
      this.$('.light-course-template-editor-glossary-container').empty().append(this.glossaryView.$el);

      this.resourcesView = new LightCourseItemListView({
        items: this.model.get('resourceItems') || [],
        isEnabled: this.isExtensionSelected(RESOURCES_EXTENSION),
        disabledMessageKey: 'lightcourseresourcesdisabled',
        fields: [
          { key: '_type', label: Origin.l10n.t('app.lightcoursetype'), type: 'select', options: ['document', 'link', 'media'] },
          { key: 'title', label: Origin.l10n.t('app.title'), type: 'text' },
          { key: 'description', label: Origin.l10n.t('app.lightcoursedescription'), type: 'textarea' },
          { key: '_link', label: Origin.l10n.t('app.lightcourselink'), type: 'text' }
        ],
        emptyItem: function() { return { _type: 'document', title: '', description: '', _link: '' }; }
      });
      this.$('.light-course-template-editor-resources-container').empty().append(this.resourcesView.$el);

      this.helpView = new LightCourseHelpView({
        model: this.model,
        isEnabled: this.isExtensionSelected(HELP_EXTENSION)
      });
      this.$('.light-course-template-editor-help-container').empty().append(this.helpView.$el);
    },

    fetchComponentTypes: function() {
      var self = this;
      $.get('api/componenttype').done(function(componentTypes) {
        self.treeView.setComponentTypes(componentTypes);
      });
    },

    fetchPluginTypes: function() {
      var self = this;
      $.when($.get('api/menutype'), $.get('api/themetype'), $.get('api/extensiontype')).done(function(menuRes, themeRes, extensionRes) {
        self.renderPluginSelections(menuRes[0], themeRes[0], extensionRes[0]);
      });
    },

    renderPluginSelections: function(menuTypes, themeTypes, extensionTypes) {
      var pluginSelections = this.model.get('pluginSelections') || {};
      var $menu = this.$('.light-course-template-editor-menu-select').empty();
      $menu.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursenoneselected')));
      menuTypes.slice().sort(function(a, b) {
        return (a.displayName || a.menu).localeCompare(b.displayName || b.menu);
      }).forEach(function(menuType) {
        $menu.append($('<option></option>').attr('value', menuType.menu).text(menuType.displayName || menuType.menu)
          .prop('selected', pluginSelections.menu === menuType.menu));
      });
      var $theme = this.$('.light-course-template-editor-theme-select').empty();
      $theme.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursenoneselected')));
      themeTypes.slice().sort(function(a, b) {
        return (a.displayName || a.theme).localeCompare(b.displayName || b.theme);
      }).forEach(function(themeType) {
        $theme.append($('<option></option>').attr('value', themeType.theme).text(themeType.displayName || themeType.theme)
          .prop('selected', pluginSelections.theme === themeType.theme));
      });
      var $extensions = this.$('.light-course-template-editor-extensions-list').empty();
      var selectedExtensions = pluginSelections.extensions || [];
      extensionTypes.slice().sort(function(a, b) {
        return (a.displayName || a.extension).localeCompare(b.displayName || b.extension);
      }).forEach(function(extensionType) {
        var id = 'light-course-template-extension-' + extensionType.extension;
        var $checkbox = $('<input type="checkbox" class="light-course-template-editor-extension-checkbox">')
          .attr('id', id).attr('data-extension', extensionType.extension)
          .prop('checked', selectedExtensions.indexOf(extensionType.extension) !== -1);
        var $label = $('<label></label>').attr('for', id).text(extensionType.displayName || extensionType.extension);
        $extensions.append($('<div class="light-course-template-editor-extension-row"></div>').append($checkbox).append($label));
      });
    },

    onPluginSelectionChanged: function() {
      var pluginSelections = this.model.get('pluginSelections') || {};
      pluginSelections.menu = this.$('.light-course-template-editor-menu-select').val() || undefined;
      pluginSelections.theme = this.$('.light-course-template-editor-theme-select').val() || undefined;
      pluginSelections.extensions = this.$('.light-course-template-editor-extension-checkbox:checked').map(function() {
        return $(this).data('extension');
      }).get();
      this.model.set('pluginSelections', pluginSelections, { silent: true });
      this.renderGlossaryResourcesHelp();
    },

    assembleSaveData: function() {
      return {
        name: this.$('.light-course-template-editor-name').val().trim(),
        description: this.$('.light-course-template-editor-description').val(),
        title: this.$('.light-course-template-editor-menu-title').val(),
        body: this.$('.light-course-template-editor-menu-body').val(),
        tags: TagEditor.selected.call(this).map(TagEditor.id),
        contentTree: this.treeView.getContentTree(),
        pluginSelections: this.model.get('pluginSelections'),
        glossaryItems: this.glossaryView ? this.glossaryView.getItems() : this.model.get('glossaryItems'),
        resourceItems: this.resourcesView ? this.resourcesView.getItems() : this.model.get('resourceItems'),
        helpContent: this.helpView ? this.helpView.getHelpContent() : this.model.get('helpContent')
      };
    },

    onSaveClicked: function(event) {
      event && event.preventDefault();
      var name = this.$('.light-course-template-editor-name').val().trim();
      if (!name) {
        return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcoursetemplatenamerequired') });
      }
      this.model.save(this.assembleSaveData(), {
        wait: true,
        success: function() {
          Origin.Notify.alert({ type: 'success', text: Origin.l10n.t('app.lightcoursetemplatesaved') });
        },
        error: function(model, response) {
          var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
          Origin.Notify.alert({ type: 'error', text: message });
        }
      });
    },

    onBackToListClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseTemplates');
    },

    remove: function() {
      this._removed = true;
      (this._tagRequests || []).forEach(function(request) { request.abort(); });
      if (this.tagPicker) this.tagPicker.destroy();
      if (this.treeView) {
        this.treeView.remove();
      }
      if (this.glossaryView) {
        this.glossaryView.remove();
      }
      if (this.resourcesView) {
        this.resourcesView.remove();
      }
      if (this.helpView) {
        this.helpView.remove();
      }
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseTemplateEditor'
  });

  return LightCourseTemplateEditorView;
});
