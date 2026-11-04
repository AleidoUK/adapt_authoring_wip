// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var SidebarItemView = require('modules/sidebar/views/sidebarItemView');

  var EditorDataImportSidebarView = SidebarItemView.extend({}, {
    template: 'editorDataImportSidebar'
  });

  return EditorDataImportSidebarView;
});
