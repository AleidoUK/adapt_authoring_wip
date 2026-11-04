// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require){
  var _ = require('underscore');
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  var POLL_INTERVAL = 1500;

  var AssetManagementBulkUploadView = OriginView.extend({
    className: 'asset-management-bulk-upload',

    preRender: function() {
      Origin.trigger('location:title:update', { title: Origin.l10n.t('app.assetbulkuploadtitle') });
      this.listenTo(Origin, 'assetManagement:bulkUploadAssets', this.uploadFile);
    },

    postRender: function() {
      _.defer(this.setViewToReady);
    },

    validate: function() {
      if(_.isEmpty(this.$('.asset-bulk-upload-file').val())) {
        this.$('.field-error').removeClass('display-none');
        Origin.trigger('assetManagement:bulkUploadFinished');
        return false;
      }
      this.$('.field-error').addClass('display-none');
      return true;
    },

    uploadFile: function() {
      console.log('[bulkUpload] uploadFile called');
      if(this.validate()) {
        console.log('[bulkUpload] validation passed, submitting form to api/asset/import');
        var $form = this.$('.asset-bulk-upload-form');
        console.log('[bulkUpload] form element found:', $form.length, 'ajaxSubmit available:', typeof $form.ajaxSubmit);
        this.$('.asset-bulk-upload-progress-list').empty();
        this.$('.asset-bulk-upload-overall').addClass('display-none');
        $('.loading').show();
        try {
          $form.ajaxSubmit({
            dataType: 'json',
            success: _.bind(this.onUploadStarted, this),
            error: _.bind(this.onUploadError, this)
          });
          console.log('[bulkUpload] ajaxSubmit call completed without throwing');
        } catch (e) {
          console.log('[bulkUpload] ajaxSubmit threw an exception', e);
        }
      } else {
        console.log('[bulkUpload] validation failed, no file selected');
      }
      // Return false to prevent the page submitting
      return false;
    },

    onUploadStarted: function(data) {
      console.log('[bulkUpload] initial POST response received', data);
      $('.loading').hide();

      if(!data || !data.jobId) {
        console.log('[bulkUpload] response missing jobId, treating as error');
        return this.onUploadError({ responseJSON: { message: Origin.l10n.t('app.assetbulkuploaderror') } });
      }

      this.jobId = data.jobId;
      console.log('[bulkUpload] jobId received, starting poll', this.jobId);
      this.renderProgressRows(data.rows || []);
      this.$('.asset-bulk-upload-overall').removeClass('display-none');
      this.updateOverallProgress(0, data.total || 0);

      this.pollTimer = setInterval(_.bind(this.pollJobStatus, this), POLL_INTERVAL);
    },

    renderProgressRows: function(rows) {
      console.log('[bulkUpload] renderProgressRows', rows);
      var self = this;
      var $list = this.$('.asset-bulk-upload-progress-list');

      $list.empty();
      rows.forEach(function(row, index) {
        $list.append(
          '<li class="asset-bulk-upload-progress-row" data-index="' + index + '">' +
            '<span class="asset-bulk-upload-progress-name">' + self.escapeHtml(row.title || row.filename) + '</span>' +
            '<div class="progress-container"><div class="progress-bar"><div class="progress-percent"></div></div></div>' +
            '<span class="asset-bulk-upload-progress-status"></span>' +
          '</li>'
        );
      });
      this.updateProgressRows(rows);
    },

    updateProgressRows: function(rows) {
      var self = this;
      (rows || []).forEach(function(row, index) {
        var $row = self.$('.asset-bulk-upload-progress-row[data-index="' + index + '"]');
        var $bar = $row.find('.progress-bar');
        var $status = $row.find('.asset-bulk-upload-progress-status');

        $bar.removeClass('pending uploading done error').addClass(row.status);

        if(row.status === 'done') {
          $bar.css('width', '100%');
          $status.text(Origin.l10n.t('app.assetbulkuploadstatusdone'));
        } else if(row.status === 'error') {
          $bar.css('width', '100%');
          $status.text(row.message || Origin.l10n.t('app.assetbulkuploadstatuserror'));
        } else if(row.status === 'uploading') {
          $bar.css('width', '50%');
          $status.text(Origin.l10n.t('app.assetbulkuploadstatusuploading'));
        } else {
          $bar.css('width', '0%');
          $status.text(Origin.l10n.t('app.assetbulkuploadstatuspending'));
        }
      });
    },

    updateOverallProgress: function(done, total) {
      var percent = total ? Math.round((done / total) * 100) : 0;
      this.$('.asset-bulk-upload-overall .progress-bar').css('width', percent + '%');
      this.$('.asset-bulk-upload-overall .progress-percent').text(percent + '%');
      this.$('.asset-bulk-upload-overall-text').text(Origin.l10n.t('app.assetbulkuploadprogress', { imported: done, total: total }));
    },

    pollJobStatus: function() {
      var self = this;

      if(!this.jobId) {
        return;
      }

      console.log('[bulkUpload] polling job status', this.jobId);
      $.get('api/asset/import/' + this.jobId + '/status', function(job) {
        console.log('[bulkUpload] poll response', job);
        self.updateProgressRows(job.rows);

        var doneCount = _.filter(job.rows, function(row) {
          return row.status === 'done' || row.status === 'error';
        }).length;
        self.updateOverallProgress(doneCount, job.total);

        if(job.status === 'complete') {
          self.onImportComplete(job);
        }
      }).fail(function(xhr) {
        console.log('[bulkUpload] poll request failed', xhr && xhr.status, xhr && xhr.responseText);
        self.onImportComplete(null);
      });
    },

    onImportComplete: function(job) {
      console.log('[bulkUpload] import complete', job);
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.jobId = null;

      Origin.trigger('assets:update');
      Origin.trigger('assetManagement:bulkUploadFinished');

      if(!job) {
        return Origin.Notify.alert({
          type: 'error',
          title: Origin.l10n.t('app.assetbulkuploaderror'),
          text: Origin.l10n.t('app.assetbulkuploaderror')
        });
      }

      var text = Origin.l10n.t('app.assetbulkuploadsuccess', { imported: job.imported, total: job.total });
      if(job.errors && job.errors.length) {
        text += ' ' + Origin.l10n.t('app.assetbulkuploadskipped', { skipped: job.errors.length });
      }
      Origin.Notify.alert({
        type: (job.errors && job.errors.length) ? 'warning' : 'success',
        text: text
      });
    },

    onUploadError: function(data) {
      console.log('[bulkUpload] upload error', data && data.status, data && data.responseText);
      $('.loading').hide();
      Origin.trigger('assetManagement:bulkUploadFinished');

      var resError = data && data.responseJSON && data.responseJSON.message;
      var resText = data && data.responseText;
      var message = resError || resText || Origin.l10n.t('app.assetbulkuploaderror');

      Origin.Notify.alert({
        type: 'error',
        title: Origin.l10n.t('app.assetbulkuploaderror'),
        text: message
      });
    },

    escapeHtml: function(str) {
      if (str === null || typeof str === 'undefined') {
        return '';
      }
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    remove: function() {
      clearInterval(this.pollTimer);
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'assetManagementBulkUpload'
  });

  return AssetManagementBulkUploadView;
});
