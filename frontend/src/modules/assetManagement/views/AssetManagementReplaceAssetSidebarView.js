// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var SidebarItemView = require('modules/sidebar/views/sidebarItemView');

  var AssetManagementReplaceAssetSidebarView = SidebarItemView.extend({
    events: {
      'click .asset-management-replace-sidebar-save-button': 'onSaveReplaceAssetClicked',
      'click .asset-management-replace-sidebar-cancel-button': 'onCancelReplaceAssetClicked'
    },

    onSaveReplaceAssetClicked: function() {
      this.updateButton('.asset-management-replace-sidebar-save-button', Origin.l10n.t('app.saving'));
      Origin.trigger('assetManagement:replaceAsset');
    },

    onCancelReplaceAssetClicked: function() {
      Origin.router.navigateTo('assetManagement');
    }
  }, {
    template: 'assetManagementReplaceAssetSidebar'
  });

  return AssetManagementReplaceAssetSidebarView;
});
