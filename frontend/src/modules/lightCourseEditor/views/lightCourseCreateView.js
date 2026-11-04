// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  var LightCourseCreateView = OriginView.extend({
    className: 'light-course-create',

    events: {
      'click .light-course-create-save': 'onSaveClicked',
      'click .light-course-create-cancel': 'onCancelClicked'
    },

    preRender: function(options) {
      this.templateCollection = options.templateCollection;
    },

    postRender: function() {
      var $select = this.$('.light-course-create-template');
      this.templateCollection.each(function(template) {
        $select.append($('<option></option>').attr('value', template.get('_id')).text(template.get('name')));
      });
      this.setViewToReady();
    },

    onSaveClicked: function(event) {
      event && event.preventDefault();
      var title = this.$('.light-course-create-title').val().trim();
      if (!title) {
        return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcoursetitlerequired') });
      }
      var templateId = this.$('.light-course-create-template').val();
      var data = { title: title };
      if (templateId) {
        data._templateId = templateId;
      }
      this.model.save(data, {
        wait: true,
        success: function(model) {
          Origin.router.navigateTo('lightCourseEditor/' + model.get('_id'));
        },
        error: function(model, response) {
          var message = (response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
          Origin.Notify.alert({ type: 'error', text: message });
        }
      });
    },

    onCancelClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor');
    }
  }, {
    template: 'lightCourseCreate'
  });

  return LightCourseCreateView;
});
