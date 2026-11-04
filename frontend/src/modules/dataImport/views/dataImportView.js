// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var OriginView = require('core/views/originView');
  var Origin = require('core/origin');

  var EXTENSION_LABELS = {
    glossary: 'Glossary',
    resources: 'Resources'
  };

  var EXTENSION_CSV_COLUMNS = {
    glossary: 'term, description',
    resources: 'title, _type, description, _link, filename, _isGlobal, _forceDownload, _id'
  };

  // schema key used for each extension's fieldset in the course Project Settings form
  var EXTENSION_SETTINGS_KEYS = {
    glossary: '_glossary',
    resources: '_resources'
  };

  var DataImportView = OriginView.extend({

    tagName: 'div',
    className: 'data-import-view',

    events: {
      'change .data-import-file': 'onFileSelected',
      'click .data-import-btn': 'onImportClick',
      'click .data-import-settings-link': 'onSettingsLinkClick'
    },

    initialize: function(options) {
      this.courseId = this.model ? this.model.get('courseId') : (options && options.courseId);

      var enabledExtensions = (Origin.editor.data.config && Origin.editor.data.config.get('_enabledExtensions')) || {};
      this.extensions = ['glossary', 'resources'].filter(function(key) {
        return !!enabledExtensions[key];
      });

      OriginView.prototype.initialize.apply(this, arguments);
    },

    preRender: function() {
      this.setViewToReady();
    },

    postRender: function() {
      this.renderSections();
    },

    renderSections: function() {
      var self = this;
      var $container = this.$('.data-import-sections');

      $container.empty();

      if (!this.extensions.length) {
        $container.append('<p class="data-import-none field-help">' + Origin.l10n.t('app.dataimportnoextensions') + '</p>');
        return;
      }

      this.extensions.forEach(function(extensionKey) {
        $container.append(self.renderSection(extensionKey));
      });
    },

    renderSection: function(extensionKey) {
      var label = EXTENSION_LABELS[extensionKey];
      var columns = EXTENSION_CSV_COLUMNS[extensionKey];

      var html = '<fieldset class="fieldset-' + extensionKey + ' data-import-section" data-key="' + extensionKey + '">' +
        '<div class="legend"><legend>' + this.escapeHtml(label) + '</legend></div>' +

        '<div class="field" data-type="">' +
        '<label>' + Origin.l10n.t('app.dataimportrequiredcolumns') + '</label>' +
        '<div class="field-editor"><code>' + this.escapeHtml(columns) + '</code></div>' +
        '</div>' +

        '<div class="field" data-type="">' +
        '<div class="field-editor">' +
        '<a class="data-import-template-link" href="api/extension/' + extensionKey + '/import/template" download="' + extensionKey + '-import-template.csv">' + Origin.l10n.t('app.dataimportdownloadtemplate') + '</a>' +
        ' &middot; ' +
        '<a class="data-import-settings-link" href="#" data-extension="' + extensionKey + '">' + Origin.l10n.t('app.dataimportjumptosettings') + '</a>' +
        '</div>' +
        '</div>' +

        '<form class="data-import-form" data-extension="' + extensionKey + '" enctype="multipart/form-data">' +
        '<div class="field" data-type="">' +
        '<label>' + Origin.l10n.t('app.dataimportfile') + '</label>' +
        '<div class="field-editor"><input type="file" name="file" class="data-import-file" accept=".csv" data-extension="' + extensionKey + '"></div>' +
        '</div>' +
        '<div class="field" data-type="">' +
        '<label>' + Origin.l10n.t('app.dataimportmode') + '</label>' +
        '<div class="field-editor">' +
        '<select class="data-import-mode" name="mode" data-extension="' + extensionKey + '">' +
        '<option value="append">' + Origin.l10n.t('app.dataimportappend') + '</option>' +
        '<option value="replace">' + Origin.l10n.t('app.dataimportreplace') + '</option>' +
        '</select>' +
        '</div>' +
        '</div>' +
        '<div class="field" data-type="">' +
        '<div class="field-editor"><button type="button" class="btn btn-secondary data-import-btn" data-extension="' + extensionKey + '" disabled>' + Origin.l10n.t('app.dataimportbutton') + '</button></div>' +
        '</div>' +
        '</form>' +

        '<div class="field" data-type="">' +
        '<div class="field-editor"><div class="data-import-feedback" data-extension="' + extensionKey + '"></div></div>' +
        '</div>' +
        '</fieldset>';

      return html;
    },

    onSettingsLinkClick: function(e) {
      e.preventDefault();

      var extensionKey = this.$(e.currentTarget).attr('data-extension');
      var settingsKey = EXTENSION_SETTINGS_KEYS[extensionKey];

      if (settingsKey) {
        sessionStorage.setItem('scaffoldScrollToKey', settingsKey);
      }
      Origin.router.navigateTo('editor/' + this.courseId + '/settings');
    },

    onFileSelected: function(e) {
      var $target = this.$(e.currentTarget);
      var extensionKey = $target.attr('data-extension');
      var hasFile = !!(e.target.files && e.target.files.length);

      this.$('.data-import-btn[data-extension="' + extensionKey + '"]').prop('disabled', !hasFile);
    },

    onImportClick: function(e) {
      var $btn = this.$(e.currentTarget);
      var extensionKey = $btn.attr('data-extension');
      var $form = this.$('.data-import-form[data-extension="' + extensionKey + '"]');
      var mode = this.$('.data-import-mode[data-extension="' + extensionKey + '"]').val();
      var label = EXTENSION_LABELS[extensionKey];
      var isReplace = (mode === 'replace');
      var self = this;

      Origin.Notify.confirm({
        type: 'warning',
        title: Origin.l10n.t('app.dataimportconfirmtitle'),
        text: isReplace ?
          Origin.l10n.t('app.dataimportconfirmreplace', { extension: label }) :
          Origin.l10n.t('app.dataimportconfirmappend', { extension: label }),
        destructive: isReplace,
        callback: function(confirmed) {
          if (confirmed) {
            self.performImport(extensionKey, $form);
          }
        }
      });
    },

    performImport: function(extensionKey, $form) {
      var self = this;
      var $feedback = this.$('.data-import-feedback[data-extension="' + extensionKey + '"]');
      var $btn = this.$('.data-import-btn[data-extension="' + extensionKey + '"]');

      $feedback.removeClass('error success').text(Origin.l10n.t('app.dataimportinprogress'));
      $btn.prop('disabled', true);

      $form.ajaxSubmit({
        url: 'api/extension/' + extensionKey + '/import/' + this.courseId,
        type: 'POST',
        dataType: 'json',

        success: function(response) {
          $btn.prop('disabled', false);

          var message = Origin.l10n.t('app.dataimportsuccess', {
            imported: response.imported,
            total: response.total
          });
          if (response.skipped) {
            message += ' ' + Origin.l10n.t('app.dataimportskipped', { skipped: response.skipped });
          }
          $feedback.addClass('success').removeClass('error').text(message);
        },

        error: function(xhr) {
          $btn.prop('disabled', false);
          var message = (xhr.responseJSON && xhr.responseJSON.message) || Origin.l10n.t('app.dataimporterror');
          $feedback.addClass('error').removeClass('success').text(message);
        }
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
    }

  }, {
    template: 'dataImport'
  });

  return DataImportView;
});
