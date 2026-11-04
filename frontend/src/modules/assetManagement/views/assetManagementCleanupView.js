// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require){
  var _ = require('underscore');
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  var AssetManagementCleanupView = OriginView.extend({
    className: 'asset-management-cleanup',

    events: {
      'change .asset-cleanup-select-all': 'onSelectAllChanged',
      'change .asset-cleanup-item-checkbox': 'onItemCheckboxChanged'
    },

    assets: [],

    preRender: function() {
      Origin.trigger('location:title:update', { title: Origin.l10n.t('app.assetcleanuptitle') });
      this.listenTo(Origin, 'assetManagement:cleanupDeleteSelected', this.deleteSelected);
    },

    postRender: function() {
      this.loadUnusedAssets();
      _.defer(this.setViewToReady);
    },

    loadUnusedAssets: function() {
      var self = this;

      this.$('.asset-cleanup-list').empty();
      this.$('.asset-cleanup-header').addClass('display-none');
      this.$('.asset-cleanup-empty').addClass('display-none');
      this.$('.asset-cleanup-loading').removeClass('display-none');

      $.get('api/asset/unused', function(data) {
        self.renderList((data && data.assets) || []);
      }).fail(function() {
        self.$('.asset-cleanup-loading').addClass('display-none');
        Origin.Notify.alert({
          type: 'error',
          text: Origin.l10n.t('app.assetcleanuploaderror')
        });
      });
    },

    renderList: function(assets) {
      this.assets = assets;
      this.$('.asset-cleanup-loading').addClass('display-none');

      if (!assets.length) {
        this.$('.asset-cleanup-empty').removeClass('display-none');
        Origin.trigger('assetManagement:cleanupSelectionChanged', 0, 0);
        return;
      }

      this.$('.asset-cleanup-header').removeClass('display-none');
      this.$('.asset-cleanup-select-all').prop('checked', false);

      var self = this;
      var $list = this.$('.asset-cleanup-list');
      assets.forEach(function(asset) {
        $list.append(self.buildItemMarkup(asset));
      });

      this.updateSelectedCount();
    },

    buildItemMarkup: function(asset) {
      var isPreviewable = (asset.assetType === 'image' || asset.assetType === 'video') && asset.metadata;
      var thumbHtml = isPreviewable
        ? '<div class="asset-cleanup-item-thumb" style="background-image:url(api/asset/thumb/' + asset._id + '?v=' + (asset.updatedAt || '') + ')"></div>'
        : '<div class="asset-cleanup-item-thumb asset-cleanup-item-thumb-icon"><i class="fa ' + this.getIconClass(asset.assetType) + '"></i></div>';

      return (
        '<li class="asset-cleanup-item" data-id="' + asset._id + '">' +
          '<label class="asset-cleanup-item-select">' +
            '<input type="checkbox" class="asset-cleanup-item-checkbox" value="' + asset._id + '">' +
          '</label>' +
          thumbHtml +
          '<div class="asset-cleanup-item-details">' +
            '<div class="asset-cleanup-item-title">' + this.escapeHtml(asset.title || asset.filename) + '</div>' +
            '<div class="asset-cleanup-item-filename">' + this.escapeHtml(asset.filename || '') + '</div>' +
            '<div class="asset-cleanup-item-usage">' + Origin.l10n.t('app.assetcleanupusagecount', { count: asset.usageCount || 0 }) + '</div>' +
          '</div>' +
        '</li>'
      );
    },

    getIconClass: function(assetType) {
      switch (assetType) {
        case 'image': return 'fa-file-image-o';
        case 'audio': return 'fa-file-audio-o';
        case 'video': return 'fa-file-video-o';
        default: return 'fa-file-o';
      }
    },

    onSelectAllChanged: function(event) {
      var checked = $(event.currentTarget).prop('checked');
      this.$('.asset-cleanup-item-checkbox').prop('checked', checked);
      this.updateSelectedCount();
    },

    onItemCheckboxChanged: function() {
      var $boxes = this.$('.asset-cleanup-item-checkbox');
      var $checked = $boxes.filter(':checked');
      this.$('.asset-cleanup-select-all').prop('checked', $boxes.length > 0 && $checked.length === $boxes.length);
      this.updateSelectedCount();
    },

    updateSelectedCount: function() {
      var total = this.$('.asset-cleanup-item-checkbox').length;
      var count = this.$('.asset-cleanup-item-checkbox:checked').length;
      Origin.trigger('assetManagement:cleanupSelectionChanged', count, total);
    },

    deleteSelected: function() {
      var self = this;
      var ids = this.$('.asset-cleanup-item-checkbox:checked').map(function() {
        return $(this).val();
      }).get();

      if (!ids.length) {
        Origin.trigger('assetManagement:cleanupDeleteFinished');
        return;
      }

      $.ajax({
        url: 'api/asset/bulkdelete',
        type: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify({ ids: ids }),
        success: function(data) {
          self.onDeleteComplete(data);
        },
        error: function() {
          Origin.trigger('assetManagement:cleanupDeleteFinished');
          Origin.Notify.alert({
            type: 'error',
            text: Origin.l10n.t('app.assetcleanupdeleteerror')
          });
        }
      });
    },

    onDeleteComplete: function(data) {
      Origin.trigger('assetManagement:cleanupDeleteFinished');
      Origin.trigger('assets:update');

      var deletedIds = (data && data.deleted) || [];
      var errorCount = (data && data.errors && data.errors.length) || 0;

      this.assets = _.reject(this.assets, function(asset) {
        return _.contains(deletedIds, String(asset._id));
      });

      this.$('.asset-cleanup-list').empty();
      this.renderList(this.assets);

      var text = Origin.l10n.t('app.assetcleanupdeletesuccess', { deleted: deletedIds.length });
      if (errorCount) {
        text += ' ' + Origin.l10n.t('app.assetcleanupdeleteskipped', { skipped: errorCount });
      }
      Origin.Notify.alert({
        type: errorCount ? 'warning' : 'success',
        text: text
      });
    },

    escapeHtml: function(str) {
      if (str === null || typeof str === 'undefined') {
        return '';
      }
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

  }, {
    template: 'assetManagementCleanup'
  });

  return AssetManagementCleanupView;
});
