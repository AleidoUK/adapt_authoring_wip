// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var OriginView = require('core/views/originView');

  /**
   * Opened via Origin.trigger('modal:open', LightCourseAssetEditView, {...}) to rename/annotate
   * an already-uploaded placeholder asset's title/description - deliberately NOT re-run through
   * the upload route, this is a plain metadata patch (see the list item view's onEditClicked).
   */
  var LightCourseAssetEditView = OriginView.extend({
    className: 'light-course-asset-edit',

    getData: function() {
      return {
        title: this.$('.light-course-asset-edit-title').val().trim(),
        description: this.$('.light-course-asset-edit-description').val()
      };
    }
  }, {
    template: 'lightCourseAssetEdit'
  });

  return LightCourseAssetEditView;
});
