// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  /**
   * Opened via Origin.trigger('modal:open', LightCourseComponentDefaultCreateView, {...}), same
   * convention as LightCourseTemplateCreateView - the surrounding modules/modal/ ModalView
   * wrapper reads this view's getData() when its "Done" button is clicked. componentType has to
   * be chosen up front (unlike a template's name-only create) since the field-value form shown
   * in the full editor afterwards depends entirely on which component type the preset is for.
   */
  var LightCourseComponentDefaultCreateView = OriginView.extend({
    className: 'light-course-component-default-create',

    preRender: function(options) {
      this.componentTypes = options.componentTypes || [];
    },

    postRender: function() {
      var $select = this.$('.light-course-component-default-create-type');
      $select.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursecomponenttypeselect')));
      this.componentTypes.forEach(function(componentType) {
        $select.append($('<option></option>').attr('value', componentType.component).text(componentType.displayName || componentType.component));
      });
    },

    getData: function() {
      return {
        name: this.$('.light-course-component-default-create-name').val().trim(),
        description: this.$('.light-course-component-default-create-description').val(),
        componentType: this.$('.light-course-component-default-create-type').val(),
        isDefault: this.$('.light-course-component-default-create-isdefault').prop('checked')
      };
    }
  }, {
    template: 'lightCourseComponentDefaultCreate'
  });

  return LightCourseComponentDefaultCreateView;
});
