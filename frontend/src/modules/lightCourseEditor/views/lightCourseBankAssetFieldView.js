// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var LightCourseAssetContext = require('../lightCourseAssetContext');

  /**
   * A light-course-scoped Asset editor, registered under "LightCourseAsset:<type>" (not the
   * shared "Asset:<type>" editor scaffoldAssetView.js provides) - that editor calls
   * Origin.scaffold.getCurrentModel() and writes to the full-course `courseasset` join
   * collection, neither of which apply here (see schemaFilter.js/lightCourseComponentFormView.js
   * for how fields get remapped to this editor instead).
   *
   * Attaches the chosen asset to the course's shared bank via `lightcoursebankasset`
   * (Phase 2/4), scoped by the light course ID from lightCourseAssetContext.js and this field's
   * own key (`_fieldName`) - deletion from the bank itself is intentionally not offered here
   * (per the main plan, light editors can't delete bank assets even their own uploads).
   */
  var LightCourseBankAssetFieldView = Backbone.Form.editors.Base.extend({
    className: 'light-course-bank-asset-field',

    events: {
      'click .light-course-bank-asset-browse': 'onBrowseClicked',
      'click .light-course-bank-asset-upload-trigger': 'onUploadTriggerClicked',
      'change .light-course-bank-asset-file-input': 'onFileChosen',
      'click .light-course-bank-asset-clear': 'onClearClicked',
      'click .light-course-bank-asset-bank-item': 'onBankItemClicked'
    },

    initialize: function(options) {
      Backbone.Form.editors.Base.prototype.initialize.call(this, options);
      this.assetType = (this.schema.inputType || '').replace('LightCourseAsset:', '') || 'image';
    },

    render: function() {
      this.renderPreview();
      return this;
    },

    renderPreview: function() {
      var hasValue = !!this.value;
      this.$el.html(Handlebars.templates[this.constructor.template]({
        hasValue: hasValue,
        assetId: this.value,
        assetType: this.assetType
      }));
      if (hasValue) {
        this.$('.light-course-bank-asset-preview-filename').text(Origin.l10n.t('app.lightcourseassetselected'));
      }
    },

    onBrowseClicked: function(event) {
      event && event.preventDefault();
      var $bank = this.$('.light-course-bank-asset-bank-list');
      if (!$bank.is(':empty')) {
        return $bank.empty();
      }
      var self = this;
      var lightCourseId = LightCourseAssetContext.get();
      $.when(
        $.get('api/asset/query', { search: { assetType: { $in: [this.assetType] } } }),
        lightCourseId ? $.get('api/content/lightcoursebankasset/query', { search: { _lightCourseId: lightCourseId } }) : $.Deferred().resolve([]).promise()
      ).done(function(assetsResponse, bankAssetsResponse) {
        var assets = assetsResponse[0];
        var usedAssetIds = (bankAssetsResponse[0] || []).map(function(bankAsset) { return bankAsset._assetId; });
        $bank.empty();
        assets.forEach(function(asset) {
          var isUsed = usedAssetIds.indexOf(asset._id) !== -1;
          $bank.append(
            $('<div class="light-course-bank-asset-bank-item"></div>')
              .attr('data-asset-id', asset._id)
              .text(asset.title || asset.filename)
              .append(isUsed ? '<span class="light-course-bank-asset-used-badge">' + Origin.l10n.t('app.lightcourseassetused') + '</span>' : '')
          );
        });
        if (!assets.length) {
          $bank.append('<p>' + Origin.l10n.t('app.lightcoursebankempty') + '</p>');
        }
      });
    },

    onBankItemClicked: function(event) {
      var assetId = $(event.currentTarget).data('asset-id');
      this.selectAsset(assetId);
    },

    onUploadTriggerClicked: function(event) {
      event && event.preventDefault();
      this.$('.light-course-bank-asset-file-input').trigger('click');
    },

    onFileChosen: function(event) {
      var file = event.target.files && event.target.files[0];
      if (!file) {
        return;
      }
      var formData = new FormData();
      formData.append('file', file);
      formData.append('title', file.name);
      formData.append('repo', 'localfs');
      formData.append('assetType', this.assetType);
      var self = this;
      $.ajax({
        url: 'api/asset',
        type: 'POST',
        data: formData,
        processData: false,
        contentType: false
      }).done(function(asset) {
        self.selectAsset(asset._id);
      }).fail(function() {
        Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgeneric') });
      });
    },

    selectAsset: function(assetId) {
      this.value = assetId;
      this.renderPreview();
      this.trigger('change', this);
      this.attachToBank(assetId);
    },

    attachToBank: function(assetId) {
      var lightCourseId = LightCourseAssetContext.get();
      if (!lightCourseId) {
        return;
      }
      $.ajax({
        url: 'api/content/lightcoursebankasset',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ _lightCourseId: lightCourseId, _assetId: assetId, _fieldName: this.key })
      });
    },

    onClearClicked: function(event) {
      event && event.preventDefault();
      this.value = '';
      this.renderPreview();
      this.trigger('change', this);
    },

    getValue: function() {
      return this.value || '';
    },

    setValue: function(value) {
      this.value = value;
      this.renderPreview();
    }
  }, {
    template: 'lightCourseBankAssetField'
  });

  Origin.on('origin:dataReady', function() {
    Origin.scaffold.addCustomField('LightCourseAsset:image', LightCourseBankAssetFieldView);
    Origin.scaffold.addCustomField('LightCourseAsset:audio', LightCourseBankAssetFieldView);
  });

  return LightCourseBankAssetFieldView;
});
