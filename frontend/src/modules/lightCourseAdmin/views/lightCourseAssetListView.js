// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseAssetListItemView = require('./lightCourseAssetListItemView');

  /**
   * Admin list/upload screen for the dedicated Light Course placeholder asset pool
   * (plugins/content/lightcourseasset/) - entirely separate from, and never cross-referenced
   * with, the main Asset Management area. Upload is a plain inline form (title/type/file) rather
   * than the usual create-modal + Backbone.Model.save() convention other lists here use, since
   * this needs a multipart/FormData POST (api/content/lightcourseasset/upload) rather than a
   * plain JSON save.
   */
  var LightCourseAssetListView = OriginView.extend({
    className: 'light-course-asset-list',

    events: {
      'click .light-course-asset-list-upload-submit': 'onUploadClicked'
    },

    preRender: function() {
      this.listenTo(this.collection, 'sync', this.renderItems);
      this.listenTo(this.collection, 'remove', this.renderItems);
    },

    postRender: function() {
      this.collection.fetch({
        success: this.setViewToReady.bind(this)
      });
    },

    renderItems: function() {
      var $container = this.$('.light-course-asset-list-items');
      $container.empty();
      if (!this.collection.length) {
        this.$('.light-course-asset-list-empty').removeClass('display-none');
        return;
      }
      this.$('.light-course-asset-list-empty').addClass('display-none');
      this.collection.each(function(model) {
        $container.append(new LightCourseAssetListItemView({ model: model }).$el);
      });
    },

    onUploadClicked: function(event) {
      event && event.preventDefault();
      var $file = this.$('.light-course-asset-list-upload-file');
      var file = $file[0].files && $file[0].files[0];
      if (!file) {
        return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcourseassetfilerequired') });
      }
      var title = this.$('.light-course-asset-list-upload-title').val().trim() || file.name;
      var assetType = this.$('.light-course-asset-list-upload-type').val();
      var formData = new FormData();
      formData.append('file', file);
      formData.append('title', title);
      formData.append('assetType', assetType);

      var self = this;
      var $submit = this.$('.light-course-asset-list-upload-submit');
      $submit.prop('disabled', true);
      $.ajax({
        url: 'api/content/lightcourseasset/upload',
        type: 'POST',
        data: formData,
        processData: false,
        contentType: false
      }).done(function() {
        self.$('.light-course-asset-list-upload-title').val('');
        $file.val('');
        self.collection.fetch();
      }).fail(function(response) {
        var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
        Origin.Notify.alert({ type: 'error', text: message });
      }).always(function() {
        $submit.prop('disabled', false);
      });
    }
  }, {
    template: 'lightCourseAssetList'
  });

  return LightCourseAssetListView;
});
