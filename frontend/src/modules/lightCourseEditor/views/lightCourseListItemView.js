// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var TagEditor = require('../tagEditor');
  var LightCourseModel = require('../models/lightCourseModel');

  var LightCourseListItemView = OriginView.extend({
    tagName: 'div',
    className: 'light-course-list-item tb-row',

    events: {
      'dblclick .light-course-list-item-title': 'onEditClicked',
      'click .light-course-list-item-edit': 'onEditClicked',
      'click .light-course-list-item-clone': 'onCloneClicked',
      'click .light-course-list-item-delete': 'onDeleteClicked'
    },

    postRender: function() {
      TagEditor.renderTags.call(this);
    },

    onEditClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor/' + this.model.get('_id'));
    },

    onCloneClicked: function(event) {
      event && event.preventDefault();
      if (this.cloneInProgress) return;
      this.cloneInProgress = true;
      this.$('.light-course-list-item-clone').prop('disabled', true);
      var self = this;
      var data = {
        title: Origin.l10n.t('app.lightcourseclonetitle', { title: this.model.get('title') }),
        _cloneCourseId: this.model.get('_id')
      };
      new LightCourseModel().save(data, {
        attrs: data,
        wait: true,
        success: function(model) {
          Origin.router.navigateTo('lightCourseEditor/' + model.get('_id'));
        },
        error: function(model, response) {
          self.cloneInProgress = false;
          self.$('.light-course-list-item-clone').prop('disabled', false);
          var message = response && response.responseJSON && response.responseJSON.message || Origin.l10n.t('app.errorgeneric');
          Origin.Notify.alert({ type: 'error', text: message });
        }
      });
    },

    onDeleteClicked: function(event) {
      event && event.preventDefault();
      var self = this;
      Origin.Notify.confirm({
        type: 'warning',
        text: Origin.l10n.t('app.lightcourseconfirmdeletecourse', { title: this.model.get('title') }),
        callback: function(confirmed) {
          if (!confirmed) {
            return;
          }
          self.model.destroy({
            wait: true,
            error: function(model, response) {
              var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
              Origin.Notify.alert({ type: 'error', text: message });
            }
          });
        }
      });
    }
  }, {
    template: 'lightCourseListItem'
  });

  return LightCourseListItemView;
});
