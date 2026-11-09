// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var AdminListView = require('./lightCourseAdminListView');
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
  var LightCourseComponentDefaultListView = AdminListView.extend({
    className: 'light-course-component-default-list',
    listSelector: '.light-course-component-default-list',
    searchFields: ['name'],
    typeField: 'componentType',
    emptyMessage: 'app.lightcoursecomponentdefaultnonetodisplay',
    loadError: 'app.errorgettinglightcoursecomponentdefault',

    events: _.extend({}, AdminListView.prototype.events, {
      'click .light-course-component-default-list-create': 'onCreateClicked'
    }),

    preRender: function() {
      this.componentTypes = [];
      AdminListView.prototype.preRender.call(this);
    },

    postRender: function() {
      var self = this;
      AdminListView.prototype.postRender.call(this);
      this.componentTypesRequest = $.get('api/componenttype').done(function(componentTypes) {
        if (self.disposed) return;
        self.componentTypes = (componentTypes || []).slice().sort(function(a, b) {
          return (a.displayName || a.component).localeCompare(b.displayName || b.component);
        });
        self.onCollectionChanged();
      }).fail(function(response, status) {
        if (self.disposed || status === 'abort') return;
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgettinglightcoursecomponenttypes') });
      });
    },

    onCollectionChanged: function() {
      if (this.disposed) return;
      var selected = this.$('.light-course-admin-filter-type').val() || '';
      var $type = this.$('.light-course-admin-filter-type').empty();
      $type.append($('<option>').val('').text(Origin.l10n.t('app.lightcoursefilteralltypes')));
      var types = this.componentTypes.slice();
      this.collection.each(function(model) {
        var key = model.get('componentType');
        if (!_.findWhere(types, { component: key })) types.push({ component: key, displayName: key });
      });
      if (selected && !_.findWhere(types, { component: selected })) types.push({ component: selected, displayName: selected });
      types.forEach(function(type) {
        $type.append($('<option>').val(type.component).text(type.displayName || type.component));
      });
      $type.val(selected);
      AdminListView.prototype.onCollectionChanged.call(this);
    },

    getComponentDisplayName: function(componentType) {
      var match = _.findWhere(this.componentTypes, { component: componentType });
      return (match && match.displayName) || componentType;
    },

    createItemView: function(model) {
      return new LightCourseComponentDefaultListItemView({
        model: model, componentDisplayName: this.getComponentDisplayName(model.get('componentType'))
      });
    },

    remove: function() {
      this.disposed = true;
      if (this.componentTypesRequest) this.componentTypesRequest.abort();
      AdminListView.prototype.remove.apply(this, arguments);
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
