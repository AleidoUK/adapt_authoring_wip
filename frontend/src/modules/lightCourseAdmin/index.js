// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var LightCourseTemplateCollection = require('./collections/lightCourseTemplateCollection');
  var LightCourseTemplateModel = require('./models/lightCourseTemplateModel');
  var LightCourseTemplateListView = require('./views/lightCourseTemplateListView');
  var LightCourseTemplateEditorView = require('./views/lightCourseTemplateEditorView');
  var LightCourseConfigModel = require('./models/lightCourseConfigModel');
  var LightCourseConfigView = require('./views/lightCourseConfigView');
  var LightCourseComponentDefaultCollection = require('./collections/lightCourseComponentDefaultCollection');
  var LightCourseComponentDefaultModel = require('./models/lightCourseComponentDefaultModel');
  var LightCourseComponentDefaultListView = require('./views/lightCourseComponentDefaultListView');
  var LightCourseComponentDefaultEditorView = require('./views/lightCourseComponentDefaultEditorView');
  // Same module-load-time side-effect requirement as lightCourseEditor/index.js's own copy of
  // this require (see that file's comment for the full explanation) - both the Template Editor
  // and Component Default Editor in this module also render LightCourseComponentFormView, so
  // this registration needs to have run regardless of which of the two top-level modules happens
  // to load first in a given session.
  var LightCourseBankAssetFieldView = require('../lightCourseEditor/views/lightCourseBankAssetFieldView');

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
    Origin.permissions.addRoute('lightCourseComponentDefaults', data.featurePermissions);

    if (!Origin.permissions.hasPermissions(data.featurePermissions)) {
      return;
    }

    Origin.globalMenu.addItem({
      location: 'global',
      text: Origin.l10n.t('app.lightcourseconfig'),
      icon: 'fa-sliders',
      callbackEvent: 'lightCourseConfig:open',
      sortOrder: 4
    });

    Origin.globalMenu.addItem({
      location: 'global',
      text: Origin.l10n.t('app.lightcoursetemplates'),
      icon: 'fa-clone',
      callbackEvent: 'lightCourseTemplates:open',
      sortOrder: 5
    });

    Origin.globalMenu.addItem({
      location: 'global',
      text: Origin.l10n.t('app.lightcoursecomponentdefaults'),
      icon: 'fa-puzzle-piece',
      callbackEvent: 'lightCourseComponentDefaults:open',
      sortOrder: 6
    });
  });

  Origin.on('globalMenu:lightCourseTemplates:open', function() {
    Origin.router.navigateTo('lightCourseTemplates');
  });

  Origin.on('globalMenu:lightCourseConfig:open', function() {
    Origin.router.navigateTo('lightCourseConfig');
  });

  Origin.on('globalMenu:lightCourseComponentDefaults:open', function() {
    Origin.router.navigateTo('lightCourseComponentDefaults');
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

  Origin.on('router:lightCourseComponentDefaults', function(id) {
    Origin.trigger('sidebar:views:remove');
    Origin.trigger('sidebar:sidebarContainer:hide');

    if (!id) {
      return loadComponentDefaultListView();
    }
    return loadComponentDefaultEditorView(id);
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

  function loadComponentDefaultListView() {
    Origin.trigger('location:title:update', { title: Origin.l10n.t('app.lightcoursecomponentdefaults') });
    Origin.contentPane.setView(LightCourseComponentDefaultListView, { collection: new LightCourseComponentDefaultCollection() });
  }

  function loadComponentDefaultEditorView(id) {
    (new LightCourseComponentDefaultModel({ _id: id })).fetch({
      success: function(model) {
        Origin.trigger('location:title:update', { title: model.get('name') });
        Origin.contentPane.setView(LightCourseComponentDefaultEditorView, { model: model });
      },
      error: function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgettinglightcoursecomponentdefault') });
        Origin.router.navigateTo('lightCourseComponentDefaults');
      }
    });
  }
});
