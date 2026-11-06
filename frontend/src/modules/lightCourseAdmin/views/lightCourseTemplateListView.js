// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseTemplateListItemView = require('./lightCourseTemplateListItemView');
  var LightCourseTemplateCreateView = require('./lightCourseTemplateCreateView');
  var LightCoursePromoteFromVersionView = require('./lightCoursePromoteFromVersionView');
  var LightCourseTemplateModel = require('../models/lightCourseTemplateModel');

  var LightCourseTemplateListView = OriginView.extend({
    className: 'light-course-template-list',

    events: {
      'click .light-course-template-list-create': 'onCreateClicked',
      'click .light-course-template-list-promote': 'onPromoteClicked'
    },

    preRender: function() {
      this.listenTo(this.collection, 'sync', this.renderItems);
      this.listenTo(this.collection, 'remove', this.renderItems);
    },

    postRender: function() {
      this.collection.fetch({
        success: this.setViewToReady.bind(this)
      });
    },

    renderItems: function() {
      var $container = this.$('.light-course-template-list-items');
      $container.empty();
      if (!this.collection.length) {
        this.$('.light-course-template-list-empty').removeClass('display-none');
        return;
      }
      this.$('.light-course-template-list-empty').addClass('display-none');
      this.collection.each(function(model) {
        $container.append(new LightCourseTemplateListItemView({ model: model }).$el);
      });
    },

    onCreateClicked: function(event) {
      event && event.preventDefault();
      Origin.trigger('modal:open', LightCourseTemplateCreateView, {
        title: Origin.l10n.t('app.lightcoursetemplatecreate'),
        onUpdate: function(data) {
          if (!data || !data.name) {
            return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcoursetemplatenamerequired') });
          }
          new LightCourseTemplateModel().save(data, {
            attrs: data,
            success: function(model) {
              Origin.router.navigateTo('lightCourseTemplates/' + model.get('_id'));
            },
            error: function(model, response) {
              var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
              Origin.Notify.alert({ type: 'error', text: message });
            }
          });
        }
      });
    },

    onPromoteClicked: function(event) {
      event && event.preventDefault();
      var self = this;
      Origin.trigger('modal:open', LightCoursePromoteFromVersionView, {
        title: Origin.l10n.t('app.lightcoursetemplatepromote'),
        onUpdate: function(data) {
          if (!data || !data.versionId) {
            return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcoursepromoteversionrequired') });
          }
          $.post('api/content/lightcoursetemplate/from-version/' + data.versionId, {
            name: data.name,
            description: data.description
          }).done(function() {
            self.collection.fetch();
          }).fail(function(response) {
            var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
            Origin.Notify.alert({ type: 'error', text: message });
          });
        }
      });
    }
  }, {
    template: 'lightCourseTemplateList'
  });

  return LightCourseTemplateListView;
});
