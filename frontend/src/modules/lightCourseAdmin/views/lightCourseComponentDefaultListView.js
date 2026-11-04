// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseComponentDefaultListItemView = require('./lightCourseComponentDefaultListItemView');
  var LightCourseComponentDefaultCreateView = require('./lightCourseComponentDefaultCreateView');
  var LightCourseComponentDefaultModel = require('../models/lightCourseComponentDefaultModel');

  /**
   * Lists every component default (preset) across every component type, same tb-row table
   * layout as LightCourseTemplateListView - componentType is shown via its installed display
   * name (fetched from `api/componenttype`, the same source lightCourseTreeView.js's "add
   * component" picker uses), and each row can be flagged as the default for its own
   * componentType (clearing any previous default for that same type is left entirely to the
   * server-side singleton enforcement in plugins/content/lightcomponentdefault/index.js - this
   * view just re-fetches/re-renders afterwards).
   */
  var LightCourseComponentDefaultListView = OriginView.extend({
    className: 'light-course-component-default-list',

    events: {
      'click .light-course-component-default-list-create': 'onCreateClicked'
    },

    preRender: function() {
      this.componentTypes = [];
      this.listenTo(this.collection, 'sync', this.renderItems);
      this.listenTo(this.collection, 'remove', this.renderItems);
    },

    postRender: function() {
      var self = this;
      $.get('api/componenttype').done(function(componentTypes) {
        self.componentTypes = componentTypes;
        self.collection.fetch({
          success: self.setViewToReady.bind(self)
        });
      });
    },

    getComponentDisplayName: function(componentType) {
      var match = _.findWhere(this.componentTypes, { component: componentType });
      return (match && match.displayName) || componentType;
    },

    renderItems: function() {
      var $container = this.$('.light-course-component-default-list-items');
      $container.empty();
      if (!this.collection.length) {
        this.$('.light-course-component-default-list-empty').removeClass('display-none');
        return;
      }
      this.$('.light-course-component-default-list-empty').addClass('display-none');
      var self = this;
      this.collection.each(function(model) {
        $container.append(new LightCourseComponentDefaultListItemView({
          model: model,
          componentDisplayName: self.getComponentDisplayName(model.get('componentType'))
        }).$el);
      });
    },

    onCreateClicked: function(event) {
      event && event.preventDefault();
      var self = this;
      Origin.trigger('modal:open', LightCourseComponentDefaultCreateView, {
        title: Origin.l10n.t('app.lightcoursecomponentdefaultcreate'),
        componentTypes: this.componentTypes,
        onUpdate: function(data) {
          if (!data || !data.name) {
            return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcoursecomponentdefaultnamerequired') });
          }
          if (!data.componentType) {
            return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcoursecomponentdefaulttyperequired') });
          }
          new LightCourseComponentDefaultModel().save(data, {
            success: function(model) {
              Origin.router.navigateTo('lightCourseComponentDefaults/' + model.get('_id'));
            },
            error: function(model, response) {
              var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
              Origin.Notify.alert({ type: 'error', text: message });
            }
          });
        }
      });
    }
  }, {
    template: 'lightCourseComponentDefaultList'
  });

  return LightCourseComponentDefaultListView;
});
