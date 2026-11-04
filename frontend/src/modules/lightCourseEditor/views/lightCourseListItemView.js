// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  var LightCourseListItemView = OriginView.extend({
    tagName: 'div',
    className: 'light-course-list-item tb-row',

    events: {
      'dblclick .light-course-list-item-title': 'onEditClicked',
      'click .light-course-list-item-edit': 'onEditClicked',
      'click .light-course-list-item-delete': 'onDeleteClicked'
    },

    onEditClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor/' + this.model.get('_id'));
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
