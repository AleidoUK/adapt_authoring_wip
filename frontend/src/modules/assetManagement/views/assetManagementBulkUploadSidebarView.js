// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var SidebarItemView = require('modules/sidebar/views/sidebarItemView');

  var AssetManagementBulkUploadSidebarView = SidebarItemView.extend({
    events: {
      'click .asset-management-bulk-upload-sidebar-save-button': 'onSaveButtonClicked',
      'click .asset-management-bulk-upload-sidebar-cancel-button': 'onCancelButtonClicked'
    },

    postRender: function() {
      this.listenTo(Origin, 'assetManagement:bulkUploadFinished', this.onBulkUploadFinished);
    },

    onSaveButtonClicked: function() {
      console.log('[bulkUpload] sidebar save/upload button clicked');
      this.updateButton('.asset-management-bulk-upload-sidebar-save-button', Origin.l10n.t('app.assetbulkuploadinprogress'));
      this.$('.asset-management-bulk-upload-sidebar-cancel-button').attr('disabled', true);
      Origin.trigger('assetManagement:bulkUploadAssets');
    },

    onBulkUploadFinished: function() {
      console.log('[bulkUpload] sidebar received bulkUploadFinished, re-enabling buttons');
      this.resetButtons();
      this.$('.asset-management-bulk-upload-sidebar-cancel-button').attr('disabled', false);
    },

    onCancelButtonClicked: function() {
      Origin.router.navigateTo('assetManagement');
    }
  }, {
    template: 'assetManagementBulkUploadSidebar'
  });

  return AssetManagementBulkUploadSidebarView;
});
