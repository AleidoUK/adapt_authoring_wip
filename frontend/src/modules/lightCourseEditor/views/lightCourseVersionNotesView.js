// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  var WORDS_PER_MINUTE = 125;

  /**
   * "Enter version notes/est. duration" modal - opened either by the editor shell's repurposed
   * "Edit current entry" toolbar action (for the current, in-progress version-history row), or
   * automatically right after a successful Create Version (for the row that publish just
   * finalised). lightCourseEditorView.js owns writing the result back onto the model + triggering
   * the actual autosave - this view is just the form.
   *
   * options:
   *   - versionLabel: the row's own "version" column value (e.g. "1.0" or "-"), shown read-only
   *   - words: that row's current word count, used only to suggest a default duration
   *   - initialNotes / initialDuration: pre-fill from the row's existing values, if any
   */
  var LightCourseVersionNotesView = OriginView.extend({
    className: 'light-course-version-notes',

    preRender: function(options) {
      this.versionLabel = options.versionLabel;
      this.words = options.words || 0;
      this.initialNotes = options.initialNotes || '';
      this.initialDuration = options.initialDuration || this.suggestDuration();
    },

    postRender: function() {
      this.$('.light-course-version-notes-version').text(this.versionLabel);
      this.$('.light-course-version-notes-words').text(this.words);
      this.$('.light-course-version-notes-notes').val(this.initialNotes);
      this.$('.light-course-version-notes-duration').val(this.initialDuration);
      this.setViewToReady();
    },

    /**
     * @return {string} e.g. "4 mins" - a plain, editable starting suggestion (125 words/minute),
     * never forced - the field stays a free-text input so a reviewer can account for
     * video/interactive time a pure word count can't capture.
     */
    suggestDuration: function() {
      if (!this.words) {
        return '';
      }
      var minutes = Math.max(1, Math.round(this.words / WORDS_PER_MINUTE));
      return minutes + ' ' + Origin.l10n.t(minutes === 1 ? 'app.lightcourseminute' : 'app.lightcourseminutes');
    },

    getData: function() {
      return {
        notes: this.$('.light-course-version-notes-notes').val(),
        duration: this.$('.light-course-version-notes-duration').val()
      };
    }
  }, {
    template: 'lightCourseVersionNotes'
  });

  return LightCourseVersionNotesView;
});
