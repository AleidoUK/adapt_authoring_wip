// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var TagEditor = require('../tagEditor');
  var LightCourseModel = require('../models/lightCourseModel');
  var LightCourseDeleteView = require('./lightCourseDeleteView');

  function canDelete(model) {
    if (Origin.permissions.hasPermissions(['{{tenantid}}/content/*:delete'])) return true;
    var creator = model.get('createdBy');
    if (creator && typeof creator === 'object' && creator._id != null) creator = creator._id;
    return creator != null && String(creator) === String(Origin.sessionModel.get('id'));
  }

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
      var $delete = this.$('.light-course-list-item-delete'), allowed = canDelete(this.model);
      $delete.prop('disabled', !allowed);
      if (!allowed) $delete.attr('title', Origin.l10n.t('app.lightcoursedeleteownonly'));
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
      if (!canDelete(this.model)) return;
      Origin.trigger('modal:open', LightCourseDeleteView, {
        model: this.model, _shouldShowDoneButton: false
      });
    }
  }, {
    template: 'lightCourseListItem'
  });

  return LightCourseListItemView;
});
