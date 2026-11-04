// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var SidebarItemView = require('modules/sidebar/views/sidebarItemView');

  var EditorAuditLogSidebarView = SidebarItemView.extend({}, {
    template: 'editorAuditLogSidebar'
  });

  return EditorAuditLogSidebarView;
});
