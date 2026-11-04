// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var LightCourseCollection = require('./collections/lightCourseCollection');
  var LightCourseTemplateCollection = require('./collections/lightCourseTemplateCollection');
  var LightCourseModel = require('./models/lightCourseModel');
  var LightCourseListView = require('./views/lightCourseListView');
  var LightCourseCreateView = require('./views/lightCourseCreateView');
  var LightCourseEditorView = require('./views/lightCourseEditorView');
  var LightCourseAuditLogView = require('./views/lightCourseAuditLogView');

  // Matches the resource/action strings lib/role/LightEditor.json's statements produce once
  // passed through lib/permissions.js's getUserPermissions() (urn:x-adapt:{{tenantid}}/api/...
  // stripped of the 'urn:x-adapt:' and '/api' prefixes, '{{tenantid}}' left as a literal token -
  // confirmed against the only other module with a non-wildcard example,
  // frontend/src/modules/pluginManagement/index.js's "{{tenantid}}/extensiontype/*:update").
  var data = {
    featurePermissions: [
      '{{tenantid}}/content/lightcourse/*:read',
      '{{tenantid}}/content/lightcourse/*:create'
    ]
  };

  // Same check frontend/src/modules/projects/index.js (Dashboard) and
  // frontend/src/modules/assetManagement/index.js use to decide whether a user is a full
  // Course Creator/Super Admin - a Light Editor never has this. Used below so a Light-Editor-only
  // user lands on the Light Course Editor on login, without stealing the home route from full
  // editors who can also see this module's nav item (e.g. Super Admin's universal wildcard).
  var fullCourseAccessPermissions = ['{{tenantid}}/content/*:read'];

  Origin.on('origin:dataReady login:changed', function() {
    Origin.permissions.addRoute('lightCourseEditor', data.featurePermissions);

    if (!Origin.permissions.hasPermissions(data.featurePermissions)) {
      return;
    }

    if (!Origin.permissions.hasPermissions(fullCourseAccessPermissions)) {
      // a genuine Light-Editor-only user (not also a Course Creator/Super Admin) - this is the
      // only area they have access to, so it should also be where login lands them.
      Origin.router.setHomeRoute('lightCourseEditor');
    }

    Origin.globalMenu.addItem({
      location: 'global',
      text: Origin.l10n.t('app.lightcourseeditor'),
      icon: 'fa-pencil-square-o',
      callbackEvent: 'lightCourseEditor:open',
      sortOrder: 2
    });
  });

  Origin.on('globalMenu:lightCourseEditor:open', function() {
    Origin.router.navigateTo('lightCourseEditor');
  });

  Origin.on('router:lightCourseEditor', function(route1, route2, route3, route4) {
    // this module has no sidebar content of its own (course creation is a button inside the list
    // view itself, not a separate sidebar action) - clear/hide whatever sidebar the previously
    // active module (e.g. Dashboard's "My/Shared Courses") left rendered, since only the module
    // that owns a given sidebar re-triggers Origin.sidebar.addView() to replace it.
    Origin.trigger('sidebar:views:remove');
    Origin.trigger('sidebar:sidebarContainer:hide');

    if (!route1) {
      return loadListView();
    }
    if (route1 === 'new') {
      return loadCreateView();
    }
    if (route2 === 'auditlog') {
      return loadAuditLogView(route1);
    }
    return loadEditorView(route1);
  });

  function loadListView() {
    Origin.trigger('location:title:update', { title: Origin.l10n.t('app.lightcourseeditor') });
    Origin.contentPane.setView(LightCourseListView, { collection: new LightCourseCollection() });
  }

  function loadCreateView() {
    Origin.trigger('location:title:update', { title: Origin.l10n.t('app.lightcoursecreatetitle') });
    var templateCollection = new LightCourseTemplateCollection();
    templateCollection.fetch({
      success: function() {
        Origin.contentPane.setView(LightCourseCreateView, {
          model: new LightCourseModel(),
          templateCollection: templateCollection
        });
      },
      error: function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgettingtemplates') });
      }
    });
  }

  function loadEditorView(id) {
    (new LightCourseModel({ _id: id })).fetch({
      success: function(model) {
        Origin.trigger('location:title:update', { title: model.get('title') });
        Origin.contentPane.setView(LightCourseEditorView, { model: model });
      },
      error: function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgettinglightcourse') });
        Origin.router.navigateTo('lightCourseEditor');
      }
    });
  }

  function loadAuditLogView(id) {
    Origin.trigger('location:title:update', { title: Origin.l10n.t('app.editorauditlog') });
    Origin.contentPane.setView(LightCourseAuditLogView, { lightCourseId: id });
  }
});
