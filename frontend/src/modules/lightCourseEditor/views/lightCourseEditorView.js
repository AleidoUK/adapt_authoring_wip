// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseHeaderView = require('./lightCourseHeaderView');
  var LightCourseTreeView = require('./lightCourseTreeView');
  var LightCourseItemListView = require('./lightCourseItemListView');
  var LightCourseHelpView = require('./lightCourseHelpView');

  // Real installed extension identifiers (extensiontype.extension field), confirmed against the
  // live installed instance - NOT the Phase 1 schema-spike's assumed `adapt-aleido-*`/
  // `adapt-contrib-*` bower-package-style names, which the actual extensiontype records don't use.
  var GLOSSARY_EXTENSION = 'glossary';
  var RESOURCES_EXTENSION = 'resources';
  var HELP_EXTENSION = 'help';

  /**
   * Editor shell (Phase 3's "Editor shell and tree" section): header sections + plugin
   * selections + the content tree, with Save Draft / Create Version actions and a 409-conflict
   * banner (Phase 2's optimistic-concurrency contract).
   */
  var LightCourseEditorView = OriginView.extend({
    className: 'light-course-editor',

    events: {
      'click .light-course-editor-back-to-list': 'onBackToListClicked',
      'click .light-course-editor-auditlog': 'onAuditLogClicked',
      'click .light-course-editor-save-draft': 'onSaveDraftClicked',
      'click .light-course-editor-create-minor-version': 'onCreateMinorVersionClicked',
      'click .light-course-editor-create-major-version': 'onCreateMajorVersionClicked',
      'click .light-course-editor-conflict-reload': 'onConflictReloadClicked',
      'change .light-course-editor-menu-select': 'onPluginSelectionChanged',
      'change .light-course-editor-theme-select': 'onPluginSelectionChanged',
      'change .light-course-editor-extension-checkbox': 'onPluginSelectionChanged'
    },

    onBackToListClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor');
    },

    onAuditLogClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor/' + this.model.get('_id') + '/auditlog');
    },

    preRender: function() {
      if (this.model.isLocked()) {
        this.$el.addClass('light-course-editor-locked');
      }
      // ensure stable array/object references so the item-list sub-views' in-place
      // mutations (push/splice) are reflected back onto the model automatically
      this.model.set('glossaryItems', this.model.get('glossaryItems') || [], { silent: true });
      this.model.set('resourceItems', this.model.get('resourceItems') || [], { silent: true });
    },

    postRender: function() {
      this.headerView = new LightCourseHeaderView({ model: this.model });
      this.$('.light-course-editor-header-container').append(this.headerView.$el);

      this.treeView = new LightCourseTreeView({ model: this.model });
      this.$('.light-course-editor-tree-container').append(this.treeView.$el);

      this.renderGlossaryResourcesHelp();

      this.fetchComponentTypes();
      this.fetchPluginTypes();
      this.updateVersionButtonLabels();
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
      this.$('.light-course-editor-glossary-container').empty().append(this.glossaryView.$el);

      this.resourcesView = new LightCourseItemListView({
        items: this.model.get('resourceItems') || [],
        isEnabled: this.isExtensionSelected(RESOURCES_EXTENSION),
        disabledMessageKey: 'lightcourseresourcesdisabled',
        fields: [
          { key: '_type', label: Origin.l10n.t('app.lightcoursetype'), type: 'select', options: ['document', 'media', 'link'] },
          { key: 'title', label: Origin.l10n.t('app.title'), type: 'text' },
          { key: 'description', label: Origin.l10n.t('app.lightcoursedescription'), type: 'textarea' },
          { key: '_link', label: Origin.l10n.t('app.lightcourselink'), type: 'text' }
        ],
        emptyItem: function() { return { _type: 'document', title: '', description: '', _link: '' }; }
      });
      this.$('.light-course-editor-resources-container').empty().append(this.resourcesView.$el);

      this.helpView = new LightCourseHelpView({
        model: this.model,
        isEnabled: this.isExtensionSelected(HELP_EXTENSION)
      });
      this.$('.light-course-editor-help-container').empty().append(this.helpView.$el);
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
      var $menu = this.$('.light-course-editor-menu-select').empty();
      menuTypes.forEach(function(menuType) {
        $menu.append($('<option></option>').attr('value', menuType.menu).text(menuType.displayName || menuType.menu)
          .prop('selected', pluginSelections.menu === menuType.menu));
      });
      var $theme = this.$('.light-course-editor-theme-select').empty();
      themeTypes.forEach(function(themeType) {
        $theme.append($('<option></option>').attr('value', themeType.theme).text(themeType.displayName || themeType.theme)
          .prop('selected', pluginSelections.theme === themeType.theme));
      });
      var $extensions = this.$('.light-course-editor-extensions-list').empty();
      var selectedExtensions = pluginSelections.extensions || [];
      extensionTypes.forEach(function(extensionType) {
        var id = 'light-course-extension-' + extensionType.extension;
        var $checkbox = $('<input type="checkbox" class="light-course-editor-extension-checkbox">')
          .attr('id', id).attr('data-extension', extensionType.extension)
          .prop('checked', selectedExtensions.indexOf(extensionType.extension) !== -1);
        var $label = $('<label></label>').attr('for', id).text(extensionType.displayName || extensionType.extension);
        $extensions.append($('<div class="light-course-editor-extension-row"></div>').append($checkbox).append($label));
      });
    },

    onPluginSelectionChanged: function() {
      var pluginSelections = this.model.get('pluginSelections') || {};
      pluginSelections.menu = this.$('.light-course-editor-menu-select').val();
      pluginSelections.theme = this.$('.light-course-editor-theme-select').val();
      pluginSelections.extensions = this.$('.light-course-editor-extension-checkbox:checked').map(function() {
        return $(this).data('extension');
      }).get();
      this.model.set('pluginSelections', pluginSelections, { silent: true });
      // glossary/resources/help editors are gated on extension selection, per the main plan -
      // re-render so toggling an extension immediately shows/hides the relevant editor
      this.renderGlossaryResourcesHelp();
      // Menu/Reflection/Help icon pickers are also gated on extension selection, per the main
      // plan (see frontend/src/modules/lightCourseEditor/views/lightCourseHeaderView.js) - keep
      // them in sync too.
      if (this.headerView) {
        this.headerView.refreshIconControls();
      }
    },

    updateVersionButtonLabels: function() {
      var major = this.model.get('versionMajor');
      var minor = this.model.get('versionMinor');
      var minorLabel = major ? (major + '.' + (minor + 1)) : '1.0';
      var majorLabel = major ? ((major + 1) + '.0') : '1.0';
      this.$('.light-course-editor-create-minor-version').text(Origin.l10n.t('app.lightcoursecreateversion', { version: minorLabel }));
      this.$('.light-course-editor-create-major-version').text(Origin.l10n.t('app.lightcoursecreatemajorversion', { version: majorLabel }));
    },

    /**
     * Re-renders the header view (version history table, icon pickers etc) against the model's
     * latest fetched attributes - needed after every save/publish, since the server auto-appends
     * a version-history row (and increments `revision`) that this.model only has after a fetch.
     */
    refreshHeaderView: function() {
      if (this.headerView) {
        this.headerView.remove();
      }
      this.headerView = new LightCourseHeaderView({ model: this.model });
      this.$('.light-course-editor-header-container').append(this.headerView.$el);
      this.updateVersionButtonLabels();
    },

    assembleSaveData: function() {
      return {
        title: this.model.get('title'),
        revision: this.model.get('revision'),
        contentTree: this.treeView.getContentTree(),
        pluginSelections: this.model.get('pluginSelections'),
        glossaryItems: this.glossaryView ? this.glossaryView.getItems() : this.model.get('glossaryItems'),
        resourceItems: this.resourcesView ? this.resourcesView.getItems() : this.model.get('resourceItems'),
        helpContent: this.helpView ? this.helpView.getHelpContent() : this.model.get('helpContent'),
        headerData: this.model.get('headerData')
      };
    },

    onSaveDraftClicked: function(event) {
      event && event.preventDefault();
      this.hideConflictBanner();
      var self = this;
      this.model.save(this.assembleSaveData(), {
        wait: true,
        success: function() {
          // the server response here is just {success:true} (lib/contentmanager.js's generic
          // PUT route doesn't echo the updated document back) - re-fetch so the client picks up
          // the incremented `revision` (needed for the *next* save/publish's concurrency check)
          // and the version-history row the server just auto-appended.
          self.model.fetch({
            success: function() {
              self.refreshHeaderView();
              Origin.Notify.alert({ type: 'success', text: Origin.l10n.t('app.lightcoursesaved') });
            }
          });
        },
        error: function(model, response) {
          self.onSaveError(response);
        }
      });
    },

    onCreateMinorVersionClicked: function(event) {
      event && event.preventDefault();
      this.createVersion('minor');
    },

    onCreateMajorVersionClicked: function(event) {
      event && event.preventDefault();
      this.createVersion('major');
    },

    createVersion: function(bump) {
      this.hideConflictBanner();
      var self = this;
      // Create Version always saves the current draft content first, then publishes it, so the
      // version snapshot matches exactly what the editor is currently looking at. A fetch
      // between the two is required - see onSaveDraftClicked's comment on why `revision` isn't
      // already up to date after save() alone - otherwise publishVersion would submit the
      // now-stale pre-save revision and get rejected as a conflict.
      this.model.save(this.assembleSaveData(), {
        wait: true,
        success: function() {
          self.model.fetch({
            success: function() {
              self.model.publishVersion(bump, {
                success: function() {
                  Origin.Notify.alert({ type: 'success', text: Origin.l10n.t('app.lightcourseversioncreated') });
                  self.model.fetch({ success: function() { self.refreshHeaderView(); } });
                },
                error: function(jqXHR) {
                  self.onSaveError(jqXHR);
                }
              });
            }
          });
        },
        error: function(model, response) {
          self.onSaveError(response);
        }
      });
    },

    onSaveError: function(response) {
      var status = response && response.status;
      var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
      if (status === 409) {
        return this.showConflictBanner();
      }
      Origin.Notify.alert({ type: 'error', text: message });
    },

    showConflictBanner: function() {
      this.$('.light-course-editor-conflict-banner').removeClass('display-none');
    },

    hideConflictBanner: function() {
      this.$('.light-course-editor-conflict-banner').addClass('display-none');
    },

    onConflictReloadClicked: function(event) {
      event && event.preventDefault();
      // Per the main plan's concurrency requirement: offer reload-and-reapply, never a silent
      // overwrite - this discards local changes and re-opens the editor against the latest save.
      Origin.router.navigateTo('lightCourseEditor/' + this.model.get('_id'));
    },

    remove: function() {
      if (this.headerView) {
        this.headerView.remove();
      }
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
    template: 'lightCourseEditor'
  });

  return LightCourseEditorView;
});
