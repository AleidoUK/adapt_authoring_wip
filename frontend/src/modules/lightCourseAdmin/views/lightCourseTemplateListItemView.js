// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseTemplateModel = require('../models/lightCourseTemplateModel');

  var LightCourseTemplateListItemView = OriginView.extend({
    tagName: 'div',
    className: 'light-course-template-list-item tb-row',

    events: {
      'dblclick .light-course-template-list-item-name': 'onEditClicked',
      'click .light-course-template-list-item-edit': 'onEditClicked',
      'click .light-course-template-list-item-clone': 'onCloneClicked',
      'click .light-course-template-list-item-delete': 'onDeleteClicked'
    },

    onEditClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseTemplates/' + this.model.get('_id'));
    },

    /**
     * Clones this template into a brand-new, independent record (new _id/createdBy/timestamps,
     * same content) - LightCourseTemplateModel#toJSON() already produces exactly the
     * {name, description, contentSnapshot} shape the create route expects, so the only field
     * that needs overriding here is the name. Navigates straight into the new clone's own
     * editor afterwards, same as the plain "Create" flow, so the name can be adjusted there.
     */
    onCloneClicked: function(event) {
      event && event.preventDefault();
      var clonedData = Object.assign({}, this.model.toJSON(), {
        name: Origin.l10n.t('app.lightcoursetemplatecopyof', { name: this.model.get('name') })
      });
      new LightCourseTemplateModel().save(clonedData, {
        success: function(model) {
          Origin.router.navigateTo('lightCourseTemplates/' + model.get('_id'));
        },
        error: function(model, response) {
          var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
          Origin.Notify.alert({ type: 'error', text: message });
        }
      });
    },

    onDeleteClicked: function(event) {
      event && event.preventDefault();
      var self = this;
      Origin.Notify.confirm({
        type: 'warning',
        text: Origin.l10n.t('app.lightcoursetemplateconfirmdelete', { name: this.model.get('name') }),
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
    template: 'lightCourseTemplateListItem'
  });

  return LightCourseTemplateListItemView;
});
