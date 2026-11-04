// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');
  var Origin = require('core/origin');

  var DataImportView = require('../../dataImport/views/dataImportView');
  var EditorDataImportSidebarView = require('./views/editorDataImportSidebarView');

  Origin.on('editor:dataimport', function(data) {
    Origin.trigger('location:title:update', {
      breadcrumbs: ['dashboard', 'course', { title: Origin.l10n.t('app.editordataimport') }],
      title: Origin.editor.data.course.get('title')
    });

    var route1 = Origin.location.route1;
    var backButtonRoute = "#/editor/" + route1 + "/menu";
    var backButtonText = Origin.l10n.t('app.backtomenu');

    // Check whether the user came from the page editor
    if (Origin.previousLocation.route2 === "page") {
      backButtonRoute = "#/editor/" + route1 + "/page/" + Origin.previousLocation.route3;
      backButtonText = Origin.l10n.t('app.backtopage');
    }

    Origin.sidebar.addView(new EditorDataImportSidebarView().$el, {
      backButtonText: backButtonText,
      backButtonRoute: backButtonRoute
    });

    Origin.contentPane.setView(DataImportView, {
      model: new Backbone.Model({
        _id: route1,
        courseId: Origin.editor.data.course.get('_id')
      })
    });
  });
});
