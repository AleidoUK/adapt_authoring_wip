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
      'click .light-course-auditlog-back': 'onBackClicked'
    },

    preRender: function(options) {
      this.lightCourseId = options.lightCourseId;
    },

    postRender: function() {
      this.auditLogView = new AuditLogView({
        model: new Backbone.Model({ contentType: 'lightcourse', contentId: this.lightCourseId })
      });
      this.$('.light-course-auditlog-container').append(this.auditLogView.$el);
      this.setViewToReady();
    },

    onBackClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor/' + this.lightCourseId);
    },

    remove: function() {
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
