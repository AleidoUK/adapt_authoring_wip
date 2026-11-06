// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var itemHistory = require('../itemHistory');
  var LightCourseComponentFormView = require('../../lightCourseEditor/views/lightCourseComponentFormView');

  /**
   * Create/edit view for a single component default (preset) - name/description/componentType/
   * isDefault plus the actual field-value editing form for whichever componentType is currently
   * selected, reusing LightCourseComponentFormView exactly as the Light Course Editor's own tree
   * view does (see ../../lightCourseEditor/views/lightCourseTreeView.js's renderComponentForm),
   * rather than reimplementing schema-filtering/rendering here.
   */
  var LightCourseComponentDefaultEditorView = OriginView.extend({
    className: 'light-course-component-default-editor',

    events: {
      'click .light-course-component-default-editor-back-to-list': 'onBackToListClicked',
      'click .light-course-component-default-editor-save': 'onSaveClicked',
      'click .light-course-item-history': itemHistory('lightcomponentdefault'),
      'change .light-course-component-default-editor-type': 'onComponentTypeChanged'
    },

    preRender: function() {
      this.componentTypes = [];
    },

    postRender: function() {
      this.fetchComponentTypes();
      this.setViewToReady();
    },

    fetchComponentTypes: function() {
      var self = this;
      $.get('api/componenttype').done(function(componentTypes) {
        self.componentTypes = (componentTypes || []).slice().sort(function(a, b) {
          return (a.displayName || a.component).localeCompare(b.displayName || b.component);
        });
        self.renderComponentTypeSelect();
        self.renderComponentForm();
      });
    },

    renderComponentTypeSelect: function() {
      var $select = this.$('.light-course-component-default-editor-type').empty();
      var currentType = this.model.get('componentType');
      $select.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursecomponenttypeselect')));
      this.componentTypes.forEach(function(componentType) {
        $select.append($('<option></option>').attr('value', componentType.component).text(componentType.displayName || componentType.component)
          .prop('selected', componentType.component === currentType));
      });
    },

    onComponentTypeChanged: function() {
      // a different component type's fields are a completely different shape, so start the
      // values bag over - matches the Light Course Editor's own tree view, which also re-renders
      // a blank form whenever its component-type select changes (see lightCourseTreeView.js's
      // renderComponentPicker).
      this.model.set('values', {}, { silent: true });
      this.renderComponentForm();
    },

    renderComponentForm: function() {
      var $container = this.$('.light-course-component-default-editor-form-container');
      if (this.componentFormView) {
        this.componentFormView.remove();
        this.componentFormView = null;
      }
      var componentType = this.$('.light-course-component-default-editor-type').val();
      if (!componentType) {
        $container.empty();
        return;
      }
      var formModel = new Backbone.Model(Object.assign({ _component: componentType }, this.model.get('values')));
      this.componentFormView = new LightCourseComponentFormView({ model: formModel, includeAudio: true });
      $container.empty().append(this.componentFormView.$el);
    },

    assembleSaveData: function() {
      var formData = this.componentFormView ? this.componentFormView.getFormData() : {};
      return {
        name: this.$('.light-course-component-default-editor-name').val().trim(),
        description: this.$('.light-course-component-default-editor-description').val(),
        componentType: this.$('.light-course-component-default-editor-type').val(),
        isDefault: this.$('.light-course-component-default-editor-isdefault').prop('checked'),
        values: _.omit(formData, '_component')
      };
    },

    onSaveClicked: function(event) {
      event && event.preventDefault();
      var name = this.$('.light-course-component-default-editor-name').val().trim();
      if (!name) {
        return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcoursecomponentdefaultnamerequired') });
      }
      if (!this.$('.light-course-component-default-editor-type').val()) {
        return Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.lightcoursecomponentdefaulttyperequired') });
      }
      var self = this;
      this.model.save(this.assembleSaveData(), {
        wait: true,
        success: function() {
          Origin.Notify.alert({ type: 'success', text: Origin.l10n.t('app.lightcoursecomponentdefaultsaved') });
        },
        error: function(model, response) {
          var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
          Origin.Notify.alert({ type: 'error', text: message });
        }
      });
    },

    onBackToListClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseComponentDefaults');
    },

    remove: function() {
      if (this.componentFormView) {
        this.componentFormView.remove();
      }
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseComponentDefaultEditor'
  });

  return LightCourseComponentDefaultEditorView;
});
