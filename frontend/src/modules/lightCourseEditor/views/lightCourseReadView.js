define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var exportWord = require('../wordExport');

  return OriginView.extend({
    className: 'light-course-read',
    events: {
      'change .light-course-read-images': 'loadContent',
      'change .light-course-read-screenshots': 'loadContent',
      'click .light-course-read-export': 'exportWord',
      'click .light-course-read-print': 'printContent'
    },

    preRender: function(options) {
      this.prepare = options.prepare;
      this.sourceUrl = options.sourceUrl;
    },

    postRender: function() {
      var self = this;
      this.setViewToReady();
      this.setBusy(true);
      this.prepare(function(error) {
        if (self.disposed) return;
        if (error) return self.showError(error);
        self.prepared = true;
        self.revision = self.model.get('revision');
        self.loadContent();
      });
    },

    baseUrl: function() {
      return (this.sourceUrl || 'document-export/' + encodeURIComponent(Origin.sessionModel.get('tenantId')) + '/' +
        encodeURIComponent(this.model.get('_id')) + '/read') + '?images=' + this.images + '&screenshots=' + this.screenshots +
        (this.revision === undefined ? '' : '&revision=' + encodeURIComponent(this.revision));
    },

    setBusy: function(busy) {
      this.busy = busy;
      this.$('.light-course-read-images, .light-course-read-screenshots').prop('disabled', busy || !this.prepared);
      this.$('.light-course-read-export, .light-course-read-print').prop('disabled', busy || !this.content);
      this.$el.attr('aria-busy', String(busy));
    },

    showError: function(response) {
      this.setBusy(false);
      var data = response && response.responseJSON || {};
      this.$('.light-course-read-status').text(data.message || Origin.l10n.t('app.errorgeneric')).prop('hidden', false);
    },

    loadContent: function() {
      if (this.disposed) return;
      var self = this;
      this.images = !!this.$('.light-course-read-images').prop('checked');
      this.screenshots = !!this.$('.light-course-read-screenshots').prop('checked');
      this.content = null;
      this.$('.light-course-read-output').empty();
      this.$('.light-course-read-status').text(Origin.l10n.t('app.lightcoursereadloading')).prop('hidden', false);
      this.setBusy(true);
      this.request = $.ajax({ url: this.baseUrl() + '&format=json', dataType: 'json', cache: false })
        .done(function(content) {
          if (self.disposed) return;
          self.content = content;
          self.$('.light-course-read-output').html(Handlebars.templates.lightCourseReadContent(content));
          self.$('.light-course-read-status').prop('hidden', true);
          self.setBusy(false);
        }).fail(function(response) {
          if (!self.disposed) self.showError(response);
        });
    },

    exportWord: function(event) {
      event.preventDefault();
      if (this.busy || !this.content) return;
      var self = this;
      this.setBusy(true);
      this.$('.light-course-read-status').prop('hidden', true);
      this.request = exportWord(this.model, {
        url: this.baseUrl() + '&format=docx',
        isDisposed: function() { return self.disposed; },
        success: function() { self.setBusy(false); },
        error: function(response) { self.showError(response); }
      });
    },

    printContent: function(event) {
      event.preventDefault();
      if (this.busy || !this.content) return;
      this.removePrintFrame();
      this.setBusy(true);
      this.$('.light-course-read-status').prop('hidden', true);
      var self = this;
      var frame = this.printFrame = document.createElement('iframe');
      frame.title = Origin.l10n.t('app.lightcoursereadprint');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;';
      document.body.appendChild(frame);
      var printDocument = frame.contentDocument;
      printDocument.open();
      printDocument.write('<!doctype html><html><head><meta charset="utf-8"><title></title><style>' +
        'body{font:12pt/1.5 Arial,sans-serif;color:#000;margin:0;padding:24px;overflow-wrap:break-word}' +
        'h1,h2,h3,h4,h5,h6{font-weight:bold;line-height:1.3;break-after:avoid}' +
        'h1{font-size:24pt}h2{font-size:18pt}h3{font-size:14pt}h4{font-size:12pt}h5{font-size:11pt}h6{font-size:10pt}' +
        'p{white-space:pre-wrap}img{max-width:50%;height:auto;break-inside:avoid}' +
        '.light-course-read-component-type{font-size:9pt;line-height:1.3;margin:18pt 0 0;break-after:avoid}' +
        '.light-course-read-component-type+h3,.light-course-read-component-type+h5{margin-top:3pt}' +
        '@media print{body{padding:0}@page{margin:20mm}}' +
        '</style></head><body>' + this.$('.light-course-read-output').html() + '</body></html>');
      printDocument.title = this.content.title;
      printDocument.close();
      var pending = Array.prototype.map.call(printDocument.images, function(image) {
        return new Promise(function(resolve, reject) {
          if (image.complete) return image.naturalWidth ? resolve() : reject(new Error('image'));
          image.onload = resolve;
          image.onerror = reject;
        });
      });
      Promise.all(pending).then(function() {
        if (self.disposed || self.printFrame !== frame) return;
        self.setBusy(false);
        frame.contentWindow.onafterprint = function() { self.removePrintFrame(); };
        frame.contentWindow.focus();
        frame.contentWindow.print();
      }).catch(function() {
        if (self.disposed) return;
        self.removePrintFrame();
        self.showError({ responseJSON: { message: Origin.l10n.t('app.lightcoursereadprintfailed') } });
      });
    },

    removePrintFrame: function() {
      if (!this.printFrame) return;
      this.printFrame.remove();
      this.printFrame = null;
    },

    getData: function() { return {}; },

    remove: function() {
      this.disposed = true;
      if (this.request) this.request.abort();
      this.removePrintFrame();
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, { template: 'lightCourseRead' });
});
