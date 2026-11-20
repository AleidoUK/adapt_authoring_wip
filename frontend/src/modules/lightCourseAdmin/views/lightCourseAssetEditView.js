// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var OriginView = require('core/views/originView');

  /**
   * Opened via Origin.trigger('modal:open', LightCourseAssetEditView, {...}) to rename/annotate
   * an already-uploaded placeholder asset, optionally replacing its file while keeping its ID.
   */
  var LightCourseAssetEditView = OriginView.extend({
    className: 'light-course-asset-edit',

    getData: function() {
      var data = {
        title: this.$('.light-course-asset-edit-title').val().trim(),
        description: this.$('.light-course-asset-edit-description').val()
      };
      var file = this.$('.light-course-asset-edit-file')[0];
      if (file && file.files && file.files[0]) data.replacementFile = file.files[0];
      return data;
    }
  }, {
    template: 'lightCourseAssetEdit'
  });

  return LightCourseAssetEditView;
});
