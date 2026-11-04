// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseComponentDefaultModel = require('../models/lightCourseComponentDefaultModel');

  var LightCourseComponentDefaultListItemView = OriginView.extend({
    tagName: 'div',
    className: 'light-course-component-default-list-item tb-row',

    events: {
      'dblclick .light-course-component-default-list-item-name': 'onEditClicked',
      'click .light-course-component-default-list-item-edit': 'onEditClicked',
      'click .light-course-component-default-list-item-clone': 'onCloneClicked',
      'click .light-course-component-default-list-item-delete': 'onDeleteClicked',
      'click .light-course-component-default-list-item-setdefault': 'onSetDefaultClicked'
    },

    preRender: function(options) {
      this.componentDisplayName = options.componentDisplayName;
    },

    postRender: function() {
      this.$('.light-course-component-default-list-item-type').text(this.componentDisplayName);
      this.renderDefaultColumn();
    },

    /**
     * Shows a plain "Default" label when this preset is currently flagged, or a "Set as
     * default" button otherwise - re-run after every collection 'sync' (see the list view's
     * listenTo), so flipping the flag on one row always updates every row's column correctly.
     */
    renderDefaultColumn: function() {
      var isDefault = this.model.get('isDefault');
      this.$('.light-course-component-default-list-item-default').text(isDefault ? Origin.l10n.t('app.lightcoursecomponentdefaultisdefault') : '');
      this.$('.light-course-component-default-list-item-setdefault').toggleClass('display-none', !!isDefault);
    },

    onEditClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseComponentDefaults/' + this.model.get('_id'));
    },

    /**
     * Clones this preset into a brand-new, independent record (new _id/createdBy/timestamps,
     * same componentType/values) - `isDefault` is deliberately reset to false on the clone,
     * rather than copied, so duplicating the current default preset never silently creates a
     * second one flagged default (and never triggers the server's "clear the other default"
     * sweep for no reason) - the user can flag the clone as default explicitly if they want to.
     * `values` is deep-copied (plain JSON round-trip, fine for this flat preset-data bag) so the
     * clone's in-memory object never shares a reference with the source model's own.
     */
    onCloneClicked: function(event) {
      event && event.preventDefault();
      var clonedData = {
        name: Origin.l10n.t('app.lightcoursecomponentdefaultcopyof', { name: this.model.get('name') }),
        description: this.model.get('description'),
        componentType: this.model.get('componentType'),
        values: JSON.parse(JSON.stringify(this.model.get('values') || {})),
        isDefault: false
      };
      new LightCourseComponentDefaultModel().save(clonedData, {
        success: function(model) {
          Origin.router.navigateTo('lightCourseComponentDefaults/' + model.get('_id'));
        },
        error: function(model, response) {
          var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
          Origin.Notify.alert({ type: 'error', text: message });
        }
      });
    },

    onSetDefaultClicked: function(event) {
      event && event.preventDefault();
      this.model.save({ isDefault: true }, {
        patch: true,
        wait: true,
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
        text: Origin.l10n.t('app.lightcoursecomponentdefaultconfirmdelete', { name: this.model.get('name') }),
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
    template: 'lightCourseComponentDefaultListItem'
  });

  return LightCourseComponentDefaultListItemView;
});
