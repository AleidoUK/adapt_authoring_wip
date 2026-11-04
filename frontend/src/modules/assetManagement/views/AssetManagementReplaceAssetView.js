// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require){

  var OriginView = require('core/views/originView');
  var Origin = require('core/origin');

  var AssetManagementReplaceAssetView = OriginView.extend({


    className: 'asset-management-replace-asset',

    events: {
      'change .asset-replace-file': 'onChangeFile',
    },

    preRender: function() {
        this.listenTo(Origin, 'assetManagement:replaceAsset', this.replaceAsset);
        this.checkUsage();
    },

    postRender: function() {
      // tagging
      this.$('#tags_control').selectize({
        create: true,
        labelField: 'title',
        loadingClass: 'selectize-loading',
        load: function(query, callback) {
          $.ajax({
            url: 'api/autocomplete/tag',
            method: 'GET',
            error: callback,
            success: callback
          });
        },
        onItemAdd: this.onAddTag.bind(this),
        onItemRemove: this.onRemoveTag.bind(this),
        searchField: [ 'title' ]
      });

      // Set view to ready
      this.setViewToReady();
    },

    onChangeFile: function(event) {
      var $title = this.$('.asset-title');

      // Default 'title' -- remove C:\fakepath if it is added
      $title.val(this.$('.asset-replace-file')[0].value.replace("C:\\fakepath\\", ""));
    },

    checkUsage: function() {
      var self = this;
      var assetId = this.model.get('_id');
      if (!assetId) return;

      $.ajax({
        url: 'api/asset/uses/' + assetId,
        type: 'GET',
        success: function(data) {
          var parsed = typeof data === 'string' ? JSON.parse(data) : data;
          var courses = (parsed && parsed.courses) || [];

          // Only warn when the asset is shared across more than one course/place
          if (courses.length > 1) {
            var courseTitles = _.pluck(courses, 'title').join(', ');
            var warning = Origin.l10n.t('app.assetreplaceusagewarning', {
              count: courses.length,
              courses: courseTitles
            });
            self.$('.asset-replace-usage-warning').text(warning).show();
          }
        },
        error: function(xhr, status, error) {
          console.error('Failed to check asset usage:', error);
        }
      });
    },

    validateInput: function () {
      var reqs = this.$('.required');
      var uploadFile = this.$('.asset-replace-file');
      var validated = true;
      var uploadFileErrormsg = $(uploadFile).prev('label').find('span.error');
      
      $.each(reqs, function (index, el) {
        var errormsg = $(el).prev('label').find('span.error');
        if (!$.trim($(el).val())) {
          validated = false;
          $(el).addClass('input-error');
          $(errormsg).text(Origin.l10n.t('app.pleaseentervalue'));
        } else {
          $(el).removeClass('input-error');
          $(errormsg).text('');
        }
      });

      // File is required for replacement
      if (!uploadFile.val()) {
        validated = false;
        $(uploadFile).addClass('input-error');
        $(uploadFileErrormsg).text(Origin.l10n.t('app.pleaseaddfile'));
      } else {
        $(uploadFile).removeClass('input-error');
        $(uploadFileErrormsg).text('');
      }
      
      return validated;
    },

    replaceAsset: function() {
      if (!this.validateInput()) {
        Origin.trigger('sidebar:resetButtons');
        return false;
      }

      this.uploadFile();
      return false;
    },

    uploadFile: function() {
      // fix tags
      var tags = [];
      _.each(this.model.get('tags'), function (item) {
        item._id && tags.push(item._id);
      });
      this.$('#tags').val(tags);

      var self = this;
      this.$('.asset-form').ajaxSubmit({
        uploadProgress: function(event, position, total, percentComplete) {
          $(".progress-container").css("visibility", "visible");
          var percentVal = percentComplete + '%';
          $(".progress-bar").css("width", percentVal);
          $('.progress-percent').html(percentVal);
        },

        error: function(xhr, status, error) {
          Origin.trigger('sidebar:resetButtons');
          Origin.Notify.alert({
            type: 'error',
            text: xhr.responseJSON && xhr.responseJSON.message 
              ? xhr.responseJSON.message 
              : Origin.l10n.t('app.errorassetreplace')
          });
        },

        success: function(data, status, xhr) {
          Origin.Notify.alert({
            type: 'success',
            text: Origin.l10n.t('app.assetreplacesuccess')
          });

          // Refresh the asset
          self.model.fetch().always(function () {
            Origin.router.navigateTo('assetManagement');
          });
        }
      });

      return false;
    },

    onAddTag: function (tag) {
      var model = this.model;
      $.ajax({
        url: 'api/content/tag',
        method: 'POST',
        data: { title: tag }
      }).done(function (data) {
        if (data && data._id) {
          var tags = model.get('tags') || [];
          tags.push({ _id: data._id, title: data.title });
          model.set({ tags: tags });
        }
      });
    },

    onRemoveTag: function (tag) {
      var tags = [];
      _.each(this.model.get('tags'), function (item) {
        if (item.title !== tag) {
          tags.push(item);
        }
      });
      this.model.set({ tags: tags });
    },


  }, {
    template: 'assetManagementReplaceAsset'
  });

  return AssetManagementReplaceAssetView;

});
