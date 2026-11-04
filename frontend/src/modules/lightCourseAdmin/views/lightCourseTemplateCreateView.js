// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  /**
   * Opened via Origin.trigger('modal:open', LightCourseTemplateCreateView, {...}) - the
   * surrounding modules/modal/ ModalView wrapper reads this view's getData() when its "Done"
   * button is clicked (see onUpdate callback passed to modal:open).
   */
  var LightCourseTemplateCreateView = OriginView.extend({
    className: 'light-course-template-create',

    getData: function() {
      return {
        name: this.$('.light-course-template-create-name').val().trim(),
        description: this.$('.light-course-template-create-description').val()
      };
    }
  }, {
    template: 'lightCourseTemplateCreate'
  });

  return LightCourseTemplateCreateView;
});
