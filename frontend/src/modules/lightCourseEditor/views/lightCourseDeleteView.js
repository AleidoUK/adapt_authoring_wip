// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var exportWord = require('../wordExport');

  return OriginView.extend({
    className: 'light-course-delete',

    events: {
      'click .light-course-delete-export': 'onExportThenDelete',
      'click .light-course-delete-without-export': 'onDeleteWithoutExport'
    },

    postRender: function() {
      this.setViewToReady();
    },

    setBusy: function(busy, message) {
      this.busy = busy;
      this.$('.light-course-delete-action').prop('disabled', busy);
      this.$('.light-course-delete-status').text(message || '').prop('hidden', !message);
      Origin.trigger(busy ? 'modal:disableCancelButton' : 'modal:enableCancelButton');
    },

    showError: function(response) {
      var data = response && response.responseJSON || {};
      this.setBusy(false, data.message || Origin.l10n.t('app.errorgeneric'));
    },

    destroyCourse: function() {
      var self = this;
      this.model.destroy({
        wait: true,
        success: function() {
          if (!self.disposed) Origin.trigger('modal:onCancel');
        },
        error: function(model, response) {
          if (!self.disposed) self.showError(response);
        }
      });
    },

    onDeleteWithoutExport: function(event) {
      event && event.preventDefault();
      if (this.busy) return;
      this.setBusy(true, Origin.l10n.t('app.lightcoursedeleting'));
      this.destroyCourse();
    },

    onExportThenDelete: function(event) {
      event && event.preventDefault();
      if (this.busy) return;
      var self = this;
      this.setBusy(true, Origin.l10n.t('app.lightcourseexportingbeforedelete'));
      this.exportRequest = exportWord(this.model, {
        isDisposed: function() { return self.disposed; },
        success: function() {
          if (self.disposed) return;
          self.setBusy(true, Origin.l10n.t('app.lightcoursedeleting'));
          self.destroyCourse();
        },
        error: function(response) {
          if (!self.disposed) self.showError(response);
        }
      });
    },

    getData: function() { return { title: this.model.get('title') }; },

    remove: function() {
      this.disposed = true;
      if (this.exportRequest) this.exportRequest.abort();
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseDelete'
  });
});
