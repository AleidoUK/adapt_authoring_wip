// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseItemListView = require('./lightCourseItemListView');

  // Confirmed real shape per docs/LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md: only `_popup`
  // (title/body/instruction) and `_items[]` (icon/title/body/graphic) exist - there is no
  // separate "linked help page"/style-toggle to build an editor for (Phase 1's resolved
  // product decision: scope down to this real shape).
  var HELP_ICON_OPTIONS = ['question', 'info'];

  /**
   * Help extension content editor (Phase 4's "Help extension editor" section) - gated on the
   * help extension being selected among pluginSelections.extensions, per the main plan.
   */
  var LightCourseHelpView = OriginView.extend({
    className: 'light-course-help',

    events: {
      'change [data-help-field]': 'onPopupFieldChanged',
      'blur [data-help-field]': 'onPopupFieldChanged'
    },

    preRender: function(options) {
      this.isEnabled = options.isEnabled;
      var helpContent = this.model.get('helpContent') || {};
      helpContent.popup = helpContent.popup || { title: '', body: '', instruction: '' };
      helpContent.items = helpContent.items || [];
      this.model.set('helpContent', helpContent, { silent: true });
      this.helpContent = helpContent;
    },

    postRender: function() {
      if (!this.isEnabled) {
        this.$el.html('<p class="light-course-help-disabled">' + Origin.l10n.t('app.lightcoursehelpdisabled') + '</p>');
        return this.setViewToReady();
      }

      this.$el.html(
        '<div class="light-course-help-popup">' +
          '<h3>' + Origin.l10n.t('app.lightcoursehelppopup') + '</h3>' +
          '<div class="field-row"><label>' + Origin.l10n.t('app.title') + '</label><input type="text" data-help-field="title" value="' + _.escape(this.helpContent.popup.title) + '"></div>' +
          '<div class="field-row"><label>' + Origin.l10n.t('app.lightcoursebody') + '</label><textarea data-help-field="body">' + _.escape(this.helpContent.popup.body) + '</textarea></div>' +
          '<div class="field-row"><label>' + Origin.l10n.t('app.lightcourseinstruction') + '</label><textarea data-help-field="instruction">' + _.escape(this.helpContent.popup.instruction) + '</textarea></div>' +
        '</div>' +
        '<div class="light-course-help-items"><h3>' + Origin.l10n.t('app.lightcoursehelpitems') + '</h3></div>'
      );

      this.itemListView = new LightCourseItemListView({
        items: this.helpContent.items,
        isEnabled: true,
        fields: [
          { key: '_icon', label: Origin.l10n.t('app.lightcourseicon'), type: 'select', options: HELP_ICON_OPTIONS },
          { key: 'title', label: Origin.l10n.t('app.title'), type: 'text' },
          { key: 'body', label: Origin.l10n.t('app.lightcoursebody'), type: 'textarea' }
        ],
        emptyItem: function() { return { _icon: HELP_ICON_OPTIONS[0], title: '', body: '' }; }
      });
      this.$('.light-course-help-items').append(this.itemListView.$el);
      this.setViewToReady();
    },

    onPopupFieldChanged: function(event) {
      var $target = $(event.currentTarget);
      this.helpContent.popup[$target.data('help-field')] = $target.val();
    },

    /**
     * @return {object} the current helpContent, including any in-progress item-list edits
     */
    getHelpContent: function() {
      if (this.itemListView) {
        this.helpContent.items = this.itemListView.getItems();
      }
      return this.helpContent;
    },

    remove: function() {
      if (this.itemListView) {
        this.itemListView.remove();
      }
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseHelp'
  });

  return LightCourseHelpView;
});
