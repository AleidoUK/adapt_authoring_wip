// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require){

  var Backbone = require('backbone');
  var OriginView = require('core/views/originView');
  var Origin = require('core/origin');

  var ContentCollection = require('core/collections/contentCollection');

  var AssetManagementPreviewView = OriginView.extend({

    tagName: 'div',

    className: 'asset-management-preview',

    events: {
      'click a.confirm-select-asset' : 'selectAsset',
      'click .asset-preview-edit-button': 'onEditButtonClicked',
      'click .asset-preview-delete-button': 'onDeleteButtonClicked',
      'click .asset-preview-restore-button': 'onRestoreButtonClicked',
      'click .asset-preview-replace-button': 'onReplaceButtonClicked',
      'mouseover .asset-use-icon': 'onShowUseInfo',
      'mouseout .asset-use-icon': 'onHideUseInfo'
    },

    permanentDelete: false,
    uses: 'none',

    preRender: function() {
      this.listenTo(this, 'remove', this.remove);

      this.$('.asset-use-info').html("");
      this.checkUsage();
    },

    selectAsset: function (event) {
      event && event.preventDefault();

      var data = {eventToTrigger: 'assetModal:assetSelected', model: this.model};
      Origin.trigger('modal:passThrough', data);
    },

    checkUsage: function() {
      var self = this;
      this.permanentDelete = false;

      $.ajax({
        url: 'api/asset/uses/' + this.model.get('_id'),
        type: 'GET',
        success: function(data) {
          console.log('Asset usage response:', data);
          
          // Backend now returns proper JSON
          var parsed = typeof data === 'string' ? JSON.parse(data) : data;
          
          console.log('Parsed usage data:', parsed);
          console.log('Components count:', parsed.components.length);

          if (parsed.components.length === 0) {
            console.log('No usage found - setting permanentDelete true');
            self.permanentDelete = true;
            self.$('.asset-use-info').addClass('is-visible').html('Not used in any courses');
            self.model.set('usage', 'none');
          } else {
            console.log('Building usage string...');
            // Build usage display string
            var usageStr = '';
            var courseMap = {};
            
            // Create course lookup map
            parsed.courses.forEach(function(course) {
              courseMap[course.id] = course;
              usageStr += '<br/><b>' + course.title + '</b><br/>';
            });

            // Group components by course
            parsed.components.forEach(function(component) {
              usageStr += '* ' + component.title + '<br/>';
            });

            console.log('Usage string:', usageStr);
            self.uses = usageStr;
            self.model.set('usage', usageStr);
            self.$('.asset-use-icon').addClass('is-visible');
            self.$('.asset-use-info').addClass('hover').html(usageStr);
          }
        },
        error: function(xhr, status, error) {
          console.error('Failed to check asset usage:', error);
          Origin.Notify.alert({
            type: 'error',
            text: Origin.l10n.t('app.errorcheckusage')
          });
        }
      });
    },

    onShowUseInfo: function() {
      this.$('.asset-use-info').addClass('is-visible');
    },

    onHideUseInfo: function() {
      this.$('.asset-use-info').removeClass('is-visible');
    },

    onEditButtonClicked: function(event) {
      event.preventDefault();
      var assetId = this.model.get('_id');
      Origin.router.navigateTo('assetManagement/' + assetId + '/edit');
    },

    onReplaceButtonClicked: function(event) {
      event.preventDefault();
      var assetId = this.model.get('_id');
      Origin.router.navigateTo('assetManagement/' + assetId + '/replace');
    },

    onDeleteButtonClicked: function(event) {
      event.preventDefault();

      Origin.Notify.confirm({
        type: 'warning',
        text: Origin.l10n.t('app.assetconfirmdelete'),
        callback: _.bind(this.onDeleteConfirmed, this)
      });
    },

    onDeleteConfirmed: function(confirmed) {
      if (!confirmed) return;

      var self = this;
      var _url = this.permanentDelete 
        ? 'api/asset/delete/' + this.model.get('_id')
        : 'api/asset/trash/' + this.model.get('_id');

      $.ajax({
        url: _url,
        type: 'PUT',
        success: function() {
          if (Origin.permissions.hasPermissions(["*"])) {
            self.model.set({_isDeleted: true});
          } else {
            self.model.trigger('destroy', self.model, self.model.collection);
          }
          
          var eventName = self.permanentDelete 
            ? 'assetManagement:assetPreviewView:permanentdelete'
            : 'assetManagement:assetPreviewView:delete';
          Origin.trigger(eventName);
          
          self.remove();

          // Navigate to asset management via dashboard to refresh
          setTimeout(function() {
            Origin.router.navigateTo('dashboard');
            setTimeout(function() {
              Origin.router.navigateTo('assetManagement');
            }, 100);
          }, 100);
        },
        error: function(xhr, status, error) {
          console.error('Failed to delete asset:', error);
          Origin.Notify.alert({
            type: 'error',
            text: Origin.l10n.t('app.errordeleteasset')
          });
        }
      });
    },

    onRestoreButtonClicked: function(event) {
      event.preventDefault();

      event.preventDefault();

      Origin.Notify.confirm({
        text: Origin.l10n.t('app.assetconfirmrestore'),
        callback: _.bind(this.onRestoreConfirmed, this)
      });
    },

    onRestoreConfirmed: function(confirmed) {
      var self = this;

      if (confirmed) {
        $.ajax({
          url: 'api/asset/restore/' + self.model.get('_id'),
          type: 'PUT',
          success: function() {
            self.model.set({_isDeleted: false});
            Origin.trigger('assetManagement:assetPreviewView:delete');
            self.remove();
          },
          error: function(data) {
            Origin.Notify.alert({
              type: 'error',
              text: Origin.l10n.t('app.errorrestoreasset', { message: data.message })
            });
          }
        });
      }
    }

  }, {
    template: 'assetManagementPreview'
  });

  return AssetManagementPreviewView;

});
