// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var LightCourseTemplateCollection = require('./collections/lightCourseTemplateCollection');
  var LightCourseTemplateModel = require('./models/lightCourseTemplateModel');
  var LightCourseTemplateListView = require('./views/lightCourseTemplateListView');
  var LightCourseTemplateEditorView = require('./views/lightCourseTemplateEditorView');
  var LightCourseConfigModel = require('./models/lightCourseConfigModel');
  var LightCourseConfigView = require('./views/lightCourseConfigView');

  // This whole module is admin-only (template/default-config management, not day-to-day course
  // editing) - same wildcard-only check frontend/src/modules/userManagement/index.js and
  // frontend/src/modules/frameworkImport/index.js use, which only a Super Admin-style role
  // satisfies (lib/role/LightEditor.json grants only narrow, non-wildcard statements, so a Light
  // Editor never sees either nav item below).
  var data = {
    featurePermissions: ['*/*:create', '*/*:read', '*/*:update', '*/*:delete']
  };

  Origin.on('origin:dataReady login:changed', function() {
    Origin.permissions.addRoute('lightCourseTemplates', data.featurePermissions);
    Origin.permissions.addRoute('lightCourseConfig', data.featurePermissions);

    if (!Origin.permissions.hasPermissions(data.featurePermissions)) {
      return;
    }

    Origin.globalMenu.addItem({
      location: 'global',
      text: Origin.l10n.t('app.lightcoursetemplates'),
      icon: 'fa-clone',
      callbackEvent: 'lightCourseTemplates:open',
      sortOrder: 4
    });

    Origin.globalMenu.addItem({
      location: 'global',
      text: Origin.l10n.t('app.lightcourseconfig'),
      icon: 'fa-sliders',
      callbackEvent: 'lightCourseConfig:open',
      sortOrder: 5
    });
  });

  Origin.on('globalMenu:lightCourseTemplates:open', function() {
    Origin.router.navigateTo('lightCourseTemplates');
  });

  Origin.on('globalMenu:lightCourseConfig:open', function() {
    Origin.router.navigateTo('lightCourseConfig');
  });

  Origin.on('router:lightCourseTemplates', function(id) {
    Origin.trigger('sidebar:views:remove');
    Origin.trigger('sidebar:sidebarContainer:hide');

    if (!id) {
      return loadTemplateListView();
    }
    return loadTemplateEditorView(id);
  });

  Origin.on('router:lightCourseConfig', function() {
    Origin.trigger('sidebar:views:remove');
    Origin.trigger('sidebar:sidebarContainer:hide');
    loadConfigView();
  });

  function loadTemplateListView() {
    Origin.trigger('location:title:update', { title: Origin.l10n.t('app.lightcoursetemplates') });
    Origin.contentPane.setView(LightCourseTemplateListView, { collection: new LightCourseTemplateCollection() });
  }

  function loadTemplateEditorView(id) {
    (new LightCourseTemplateModel({ _id: id })).fetch({
      success: function(model) {
        Origin.trigger('location:title:update', { title: model.get('name') });
        Origin.contentPane.setView(LightCourseTemplateEditorView, { model: model });
      },
      error: function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgettinglightcoursetemplate') });
        Origin.router.navigateTo('lightCourseTemplates');
      }
    });
  }

  function loadConfigView() {
    Origin.trigger('location:title:update', { title: Origin.l10n.t('app.lightcourseconfig') });
    (new LightCourseConfigModel()).fetch({
      success: function(model) {
        Origin.contentPane.setView(LightCourseConfigView, { model: model });
      },
      error: function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgettinglightcourseconfig') });
      }
    });
  }
});
