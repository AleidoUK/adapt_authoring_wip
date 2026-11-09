// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var AdminListView = require('./lightCourseAdminListView');
  var LightCourseAssetListItemView = require('./lightCourseAssetListItemView');

  /**
   * Admin list/upload screen for the dedicated Light Course placeholder asset pool
   * (plugins/content/lightcourseasset/) - entirely separate from, and never cross-referenced
   * with, the main Asset Management area. Upload is a plain inline form (title/type/file) rather
   * than the usual create-modal + Backbone.Model.save() convention other lists here use, since
   * this needs a multipart/FormData POST (api/content/lightcourseasset/upload) rather than a
   * plain JSON save.
   */
  var LightCourseAssetListView = AdminListView.extend({
    className: 'light-course-asset-list',
    listSelector: '.light-course-asset-list',
    searchFields: ['title', 'filename'],
    typeField: 'assetType',
    emptyMessage: 'app.lightcourseassetnonetodisplay',
    loadError: 'app.errorgettinglightcourseassets',

    events: _.extend({}, AdminListView.prototype.events, {
      'click .light-course-asset-list-upload-submit': 'onUploadClicked'
    }),

    preRender: function() {
      AdminListView.prototype.preRender.call(this);
      this.usageState = 'loading';
      this.listenTo(this.collection, 'sync', this.loadUsage);
    },

    loadUsage: function() {
      if (this.disposed) return;
      var self = this;
      var requestId = this.usageRequestId = (this.usageRequestId || 0) + 1;
      if (this.usageRequest) this.usageRequest.abort();
      this.usageState = 'loading';
      this.renderItems();
      this.usageRequest = $.get('api/content/lightcourseasset/uses/all').done(function(usage) {
        if (self.disposed || self.usageRequestId !== requestId) return;
        self.usage = usage;
        self.usageState = 'ready';
        self.renderItems();
      }).fail(function(response, status) {
        if (self.disposed || self.usageRequestId !== requestId || status === 'abort') return;
        self.usageState = 'error';
        self.renderItems();
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcourseassetuseserror') });
      });
    },

    createItemView: function(model) {
      return new LightCourseAssetListItemView({ model: model, usageState: this.usageState,
        usage: this.usage && this.usage[model.id] });
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
    },

    remove: function() {
      this.disposed = true;
      if (this.usageRequest) this.usageRequest.abort();
      AdminListView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseAssetList'
  });

  return LightCourseAssetListView;
});
