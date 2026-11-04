// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var SidebarItemView = require('modules/sidebar/views/sidebarItemView');

  var AssetManagementCleanupSidebarView = SidebarItemView.extend({
    events: {
      'click .asset-management-cleanup-sidebar-delete-button': 'onDeleteButtonClicked',
      'click .asset-management-cleanup-sidebar-cancel-button': 'onCancelButtonClicked'
    },

    selectedCount: 0,

    postRender: function() {
      this.listenTo(Origin, 'assetManagement:cleanupSelectionChanged', this.onSelectionChanged);
      this.listenTo(Origin, 'assetManagement:cleanupDeleteFinished', this.onDeleteFinished);
      this.updateDeleteButton();
    },

    onSelectionChanged: function(count) {
      this.selectedCount = count;
      this.updateDeleteButton();
    },

    updateDeleteButton: function() {
      this.$('.asset-management-cleanup-sidebar-delete-button').attr('disabled', this.selectedCount === 0);
      this.$('.asset-management-cleanup-sidebar-delete-count')
        .text(this.selectedCount ? Origin.l10n.t('app.assetcleanupselectedcount', { count: this.selectedCount }) : '');
    },

    onDeleteButtonClicked: function() {
      if (!this.selectedCount) return;

      Origin.Notify.confirm({
        type: 'warning',
        destructive: true,
        title: Origin.l10n.t('app.assetcleanupdeletebutton'),
        text: Origin.l10n.t('app.assetcleanupconfirmdelete', { count: this.selectedCount }),
        callback: _.bind(this.onDeleteConfirmed, this)
      });
    },

    onDeleteConfirmed: function(confirmed) {
      if (!confirmed) return;

      this.updateButton('.asset-management-cleanup-sidebar-delete-button', Origin.l10n.t('app.assetcleanupdeleteinprogress'));
      this.$('.asset-management-cleanup-sidebar-cancel-button').attr('disabled', true);
      Origin.trigger('assetManagement:cleanupDeleteSelected');
    },

    onDeleteFinished: function() {
      this.resetButtons();
      this.$('.asset-management-cleanup-sidebar-cancel-button').attr('disabled', false);
      this.updateDeleteButton();
    },

    onCancelButtonClicked: function() {
      Origin.router.navigateTo('assetManagement');
    }
  }, {
    template: 'assetManagementCleanupSidebar'
  });

  return AssetManagementCleanupSidebarView;
});
