// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');

  /**
   * A standalone (non-Backbone.Form, non-course-scoped) asset picker for the Light Course Admin
   * config screen's graphic placeholders/required-default asset fields - deliberately NOT reusing
   * ../../lightCourseEditor/views/lightCourseBankAssetFieldView.js here, since that view's
   * "attach to bank" behaviour (plugins/content/lightcoursebankasset) is scoped to a specific
   * light course via lightCourseAssetContext.js, which has no meaning for a tenant-wide default -
   * these are plain api/asset references, not bank entries.
   */
  var LightCourseConfigAssetPickerView = Backbone.View.extend({
    className: 'light-course-config-asset-picker',

    events: {
      'click .light-course-config-asset-browse': 'onBrowseClicked',
      'click .light-course-config-asset-item': 'onItemClicked',
      'click .light-course-config-asset-clear': 'onClearClicked'
    },

    initialize: function(options) {
      this.assetType = (options && options.assetType) || 'image';
      this.value = (options && options.value) || '';
      this.render();
    },

    render: function() {
      this.$el.html(Handlebars.templates['lightCourseConfigAssetPicker']({ hasValue: !!this.value }));
      return this;
    },

    onBrowseClicked: function(event) {
      event && event.preventDefault();
      var $list = this.$('.light-course-config-asset-list');
      if (!$list.is(':empty')) {
        return $list.empty();
      }
      var self = this;
      $.get('api/asset/query', { search: { assetType: { $in: [this.assetType] } } }).done(function(assets) {
        $list.empty();
        (assets || []).forEach(function(asset) {
          $list.append($('<div class="light-course-config-asset-item"></div>')
            .attr('data-asset-id', asset._id).text(asset.title || asset.filename));
        });
        if (!assets || !assets.length) {
          $list.append('<p>' + Origin.l10n.t('app.lightcoursebankempty') + '</p>');
        }
      });
    },

    onItemClicked: function(event) {
      this.value = $(event.currentTarget).data('asset-id');
      this.render();
    },

    onClearClicked: function(event) {
      event && event.preventDefault();
      this.value = '';
      this.render();
    },

    getValue: function() {
      return this.value || '';
    }
  });

  return LightCourseConfigAssetPickerView;
});
