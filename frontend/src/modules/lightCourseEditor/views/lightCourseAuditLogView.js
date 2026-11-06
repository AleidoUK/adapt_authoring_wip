// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var AuditLogView = require('../../auditLog/views/auditLogView');

  /**
   * Light Course Editor's "Change history" page - reuses the same AuditLogView the full-course
   * editor's own Change History screen uses (frontend/src/modules/editor/auditLog/index.js),
   * scoped by contentType/contentId instead of courseId (light courses are a single flat
   * document, not a course/contentobject/article/block/component tree, so they have no
   * _courseId to key off) - see AuditLogView#loadLogs' contentType branch.
   */
  var LightCourseAuditLogView = OriginView.extend({
    className: 'light-course-auditlog',

    events: {
      'click .light-course-auditlog-back': 'onBackClicked',
      'change .light-course-auditlog-version': 'onVersionChanged'
    },

    preRender: function(options) {
      this.lightCourseId = options.lightCourseId;
      this.selectedVersion = options.selectedVersion || this.model.get('currentVersionNumber') || 'draft';
    },

    postRender: function() {
      var self = this;
      this.versionRequest = this.model.fetchVersions({
        success: function(versions) {
          if (self.disposed) return;
          var numbers = _.uniq(versions.map(function(version) { return version.versionNumber; }));
          var current = self.model.get('currentVersionNumber');
          if (current && numbers.indexOf(current) === -1) numbers.unshift(current);
          var choices = [
            { value: 'all', label: Origin.l10n.t('app.lightcourseauditallversions') },
            { value: 'draft', label: Origin.l10n.t('app.lightcourseauditdraft') }
          ].concat(numbers.map(function(number) {
            return { value: number, label: number + (number === current ? ' (' + Origin.l10n.t('app.lightcourseversioncurrent') + ')' : '') };
          })).concat([{ value: 'unknown', label: Origin.l10n.t('app.lightcourseauditunknown') }]);
          self.$('.light-course-auditlog-version').empty();
          choices.forEach(function(choice) { self.$('.light-course-auditlog-version').append($('<option></option>').val(choice.value).text(choice.label)); });
          self.$('.light-course-auditlog-version').val(self.selectedVersion);
          self.renderAudit();
          self.setViewToReady();
        },
        error: function(response) {
          if (self.disposed) return;
          self.$('.light-course-auditlog-error').text(response.responseJSON && response.responseJSON.message ||
            Origin.l10n.t('app.lightcourseversionloaderror')).prop('hidden', false);
          self.setViewToReady();
        }
      });
    },

    renderAudit: function() {
      if (this.auditLogView) this.auditLogView.remove();
      this.auditLogView = new AuditLogView({
        model: new Backbone.Model({ contentType: 'lightcourse', contentId: this.lightCourseId, auditVersion: this.selectedVersion })
      });
      this.$('.light-course-auditlog-container').empty().append(this.auditLogView.$el);
    },

    onVersionChanged: function() {
      this.selectedVersion = this.$('.light-course-auditlog-version').val();
      this.renderAudit();
    },

    onBackClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor/' + this.lightCourseId);
    },

    remove: function() {
      this.disposed = true;
      if (this.versionRequest) this.versionRequest.abort();
      if (this.auditLogView) {
        this.auditLogView.remove();
      }
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseAuditLog'
  });

  return LightCourseAuditLogView;
});
