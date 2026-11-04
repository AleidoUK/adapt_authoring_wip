// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var ProjectsView = require('./views/projectsView');
  var ProjectsSidebarView = require('./views/projectsSidebarView');
  var MyProjectCollection = require('./collections/myProjectCollection');
  var SharedProjectCollection = require('./collections/sharedProjectCollection');
  var TagsCollection = require('core/collections/tagsCollection');

  // Full-course dashboard access, per docs/LIGHT_COURSE_EDITOR.md: a Light Editor only has
  // '{{tenantid}}/content/lightcourse/*:*'-style permissions (lib/role/LightEditor.json), never
  // this broader '{{tenantid}}/content/*:read' a Course Creator/Super Admin has (Super Admin
  // passes any check via Origin.permissions.hasPermissions' separate '*'-prefix wildcard rule) -
  // used to hide the Dashboard nav item/route/home-route for Light-Editor-only users, who should
  // only ever see the Light Course Editor (frontend/src/modules/lightCourseEditor/index.js).
  var dashboardPermissions = ['{{tenantid}}/content/*:read'];

  Origin.on('router:dashboard', function(location, subLocation, action) {
    Origin.trigger('editor:resetData');
    Origin.options.addItems([
      {
        title: Origin.l10n.t('app.grid'),
        icon: 'th',
        callbackEvent: 'dashboard:layout:grid',
        value: 'grid',
        group: 'layout',
      },
      {
        title: Origin.l10n.t('app.list'),
        icon: 'list',
        callbackEvent: 'dashboard:layout:list',
        value: 'list',
        group: 'layout'
      },
      {
        title: Origin.l10n.t('app.ascending'),
        icon: 'sort-alpha-asc',
        callbackEvent: 'dashboard:sort:asc',
        value: 'asc',
        group: 'sort'
      },
      {
        title: Origin.l10n.t('app.descending'),
        icon: 'sort-alpha-desc',
        callbackEvent: 'dashboard:sort:desc',
        value: 'desc',
        group: 'sort'
      },
      {
        title: Origin.l10n.t('app.recent'),
        icon: 'edit',
        callbackEvent: 'dashboard:sort:updated',
        value: 'updated',
        group: 'sort'
      }
    ]);

    var tagsCollection = new TagsCollection();

    tagsCollection.fetch({
      success: function() {
        Origin.sidebar.addView(new ProjectsSidebarView({ collection: tagsCollection }).$el);
        Origin.trigger('dashboard:loaded', { type: location || 'all' });
      },
      error: function() {
        console.log('Error occured getting the tags collection - try refreshing your page');
      }
    });
  });

  Origin.on('dashboard:loaded', function (options) {
    var isMine = options.type === 'all';
    var isShared = options.type === 'shared';
    if(!isMine && !isShared) {
      return;
    }
    var titleKey = (isMine) ? 'myprojects' : 'sharedprojects';
    var Coll = (isMine) ? MyProjectCollection : SharedProjectCollection;

    Origin.trigger('location:title:update', { breadcrumbs: ['dashboard'], title: Origin.l10n.t('app.' + titleKey) });
    Origin.contentPane.setView(ProjectsView, { collection: new Coll, _isShared: options.type === 'shared' });
  });

  Origin.on('globalMenu:dashboard:open', function() {
    Origin.router.navigateTo('dashboard');
  });

  Origin.on('origin:dataReady login:changed', function() {
    Origin.permissions.addRoute('dashboard', dashboardPermissions);

    if (!Origin.permissions.hasPermissions(dashboardPermissions)) {
      return; // Light-Editor-only user - no Dashboard nav item, route, or home route
    }

    Origin.router.setHomeRoute('dashboard');
    Origin.globalMenu.addItem({
      "location": "global",
      "text": Origin.l10n.t('app.dashboard'),
      "icon": "fa-home",
      "callbackEvent": "dashboard:open",
      "sortOrder": 1
    });
  });
});
