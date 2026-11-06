// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var exportWord = require('../wordExport');

  return OriginView.extend({
    className: 'light-course-word',
    events: {
      'click .light-course-word-export': 'exportWord',
      'click .light-course-word-import': 'confirmImport'
    },

    preRender: function(options) {
      this.prepare = options.prepare;
      this.onImported = options.onImported;
      this.exportOnly = !!options.exportOnly;
    },

    postRender: function() {
      if (this.exportOnly || this.model.isLocked()) this.$('.light-course-word-import-section').hide();
      if (this.exportOnly) this.$('.light-course-word-instructions').text(Origin.l10n.t('app.lightcoursewordversionexportinstructions'));
      this.setViewToReady();
    },

    setBusy: function(busy) {
      this.busy = busy;
      this.$('button, input, select').prop('disabled', busy);
      Origin.trigger(busy ? 'modal:disableCancelButton' : 'modal:enableCancelButton');
      this.$el.attr('aria-busy', String(busy));
      if (busy) this.$('.light-course-word-status').text('').prop('hidden', true);
    },

    showError: function(response) {
      this.setBusy(false);
      var data = response && response.responseJSON || {};
      this.$('.light-course-word-status').text((data.errors || [data.message || Origin.l10n.t('app.errorgeneric')]).join('\n')).prop('hidden', false);
    },

    baseUrl: function(route) {
      return route + '/' + encodeURIComponent(Origin.sessionModel.get('tenantId')) + '/' + encodeURIComponent(this.model.get('_id'));
    },

    exportWord: function(event) {
      event.preventDefault();
      if (this.busy) return;
      this.setBusy(true);
      var self = this;
      this.prepare(function(error) {
        if (self.disposed) return;
        if (error) return self.showError(error);
        self.request = exportWord(self.model, {
          isDisposed: function() { return self.disposed; },
          success: function() {
            self.setBusy(false);
            Origin.trigger('modal:onCancel');
          },
          error: function(response) { self.showError(response); }
        });
      });
    },

    confirmImport: function(event) {
      event.preventDefault();
      if (this.busy) return;
      var file = this.$('.light-course-word-file')[0].files[0];
      if (!file || !/\.docx$/i.test(file.name)) {
        return this.showError({ responseJSON: { message: Origin.l10n.t('app.lightcoursewordchoosefile') } });
      }
      var bump = this.$('.light-course-word-version').val();
      if (bump !== 'minor' && bump !== 'major') {
        return this.showError({ responseJSON: { message: Origin.l10n.t('app.lightcoursewordchooseversion') } });
      }
      var self = this;
      this.setBusy(true);
      Origin.Notify.confirm({
        type: 'warning',
        text: Origin.l10n.t('app.lightcoursewordversionconfirm', { versionType: Origin.l10n.t('app.lightcourseword' + bump) }),
        callback: function(confirmed) {
          if (self.disposed) return;
          if (!confirmed) return self.setBusy(false);
          self.prepare(function(error) {
            if (self.disposed) return;
            if (error) return self.showError(error);
            self.upload(file, false, bump);
          });
        }
      });
    },

    upload: function(file, confirmed, bump) {
      var self = this;
      var data = new FormData();
      data.append('file', file);
      data.append('format', 'docx');
      data.append('revision', this.model.get('revision'));
      data.append('bump', bump);
      if (confirmed) data.append('confirmed', 'true');
      this.request = $.ajax({
        url: this.baseUrl('document-import'), type: 'POST', data: data,
        processData: false, contentType: false
      }).done(function(result) {
        if (self.disposed) return;
        self.model.fetch({
          success: function() {
            if (self.disposed) return;
            self.onImported();
            self.setBusy(false);
            Origin.Notify.alert({ type: 'success', text: Origin.l10n.t('app.lightcoursewordversionimported', { version: result.version.versionNumber }) });
            Origin.trigger('modal:onCancel');
          },
          error: function(model, response) {
            if (!self.disposed) {
              self.showError({ responseJSON: { message: Origin.l10n.t('app.lightcoursewordreload') } });
            }
          }
        });
      }).fail(function(response) {
        if (self.disposed) return;
        var body = response.responseJSON || {};
        if (response.status === 409 && body.requiresConfirmation) {
          Origin.Notify.confirm({
            type: 'warning', text: body.message,
            callback: function(accepted) {
              if (self.disposed) return;
              if (accepted) self.upload(file, true, bump);
              else self.setBusy(false);
            }
          });
          return;
        }
        self.showError(response);
      });
    },

    getData: function() { return {}; },

    remove: function() {
      this.disposed = true;
      if (this.request) this.request.abort();
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, { template: 'lightCourseWord' });
});
