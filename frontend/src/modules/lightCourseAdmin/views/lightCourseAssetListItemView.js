// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var itemHistory = require('../itemHistory');
  var LightCourseAssetEditView = require('./lightCourseAssetEditView');

  var LightCourseAssetListItemView = OriginView.extend({
    tagName: 'div',
    className: 'light-course-asset-list-item tb-row',

    events: {
      'click .light-course-asset-list-item-edit': 'onEditClicked',
      'click .light-course-item-history': itemHistory('lightcourseasset'),
      'click .light-course-asset-list-item-delete': 'onDeleteClicked'
    },

    preRender: function(options) {
      this.usage = options.usage;
      this.usageState = options.usageState;
    },

    postRender: function() {
      this.$('.light-course-asset-list-item-type').text(this.getTypeLabel());
      this.$('.light-course-asset-list-item-size').text(this.getSizeLabel());
      var $uses = this.$('.light-course-asset-list-item-uses');
      if (this.usageState === 'loading') return $uses.text(Origin.l10n.t('app.lightcourseassetusesloading'));
      if (this.usageState !== 'ready' || !this.usage) return $uses.text(Origin.l10n.t('app.lightcourseassetuseserror'));
      var routes = { lightcourse: 'lightCourseEditor/', lightcoursetemplate: 'lightCourseTemplates/',
        lightcomponentdefault: 'lightCourseComponentDefaults/' };
      $uses.html(Handlebars.templates.lightCourseAssetUses({
        count: this.usage.count,
        uses: this.usage.uses.map(function(use) {
          return {
            title: use.title || Origin.l10n.t('app.lightcourseassetusetype' + use.type),
            typeLabel: Origin.l10n.t('app.lightcourseassetusetype' + use.type),
            href: '#' + routes[use.type] + encodeURIComponent(use.id),
            count: use.paths.length, paths: use.paths.join('\n')
          };
        })
      }));
    },

    getTypeLabel: function() {
      var assetType = this.model.get('assetType');
      return Origin.l10n.t('app.lightcourseassettype' + assetType) || assetType;
    },

    /**
     * Matches the plain-KB/MB rounding the main Asset Management list already uses, so file
     * sizes read consistently across both areas despite being entirely separate libraries.
     */
    getSizeLabel: function() {
      var bytes = this.model.get('size') || 0;
      if (bytes < 1024) {
        return bytes + ' B';
      }
      if (bytes < 1024 * 1024) {
        return Math.round(bytes / 1024) + ' KB';
      }
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    onEditClicked: function(event) {
      event && event.preventDefault();
      var self = this;
      Origin.trigger('modal:open', LightCourseAssetEditView, {
        title: Origin.l10n.t('app.lightcourseassetedit'),
        model: this.model,
        onUpdate: function(data) {
          self.model.save(data, {
            patch: true,
            wait: true,
            success: function() {
              self.model.fetch({
                error: function() {
                  Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgeneric') });
                }
              });
            },
            error: function(model, response) {
              var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
              Origin.Notify.alert({ type: 'error', text: message });
            }
          });
        }
      });
    },

    onDeleteClicked: function(event) {
      event && event.preventDefault();
      var self = this;
      Origin.Notify.confirm({
        type: 'warning',
        text: Origin.l10n.t('app.lightcourseassetconfirmdelete', { name: this.model.get('title') }),
        callback: function(confirmed) {
          if (!confirmed) {
            return;
          }
          self.model.destroy({
            wait: true,
            error: function(model, response) {
              var message = (response && response.responseJSON && response.responseJSON.message) || Origin.l10n.t('app.errorgeneric');
              Origin.Notify.alert({ type: 'error', text: message });
            }
          });
        }
      });
    }
  }, {
    template: 'lightCourseAssetListItem'
  });

  return LightCourseAssetListItemView;
});
