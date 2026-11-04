// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  /**
   * Opened via Origin.trigger('modal:open', LightCoursePromoteFromVersionView, {...}) - lets an
   * admin pick a light course then one of its published versions, and supply a name/description
   * for the new template that promoting it will create. See getData()'s versionId/name/
   * description, read by the caller's onUpdate callback to POST to the existing
   * api/content/lightcoursetemplate/from-version/:versionId endpoint.
   */
  var LightCoursePromoteFromVersionView = OriginView.extend({
    className: 'light-course-promote-from-version',

    events: {
      'change .light-course-promote-course-select': 'onCourseChanged'
    },

    postRender: function() {
      this.fetchCourses();
    },

    fetchCourses: function() {
      var self = this;
      $.get('api/content/lightcourse').done(function(courses) {
        var $select = self.$('.light-course-promote-course-select');
        (courses || []).slice().sort(function(a, b) {
          return (a.title || '').localeCompare(b.title || '');
        }).forEach(function(course) {
          $select.append($('<option></option>').attr('value', course._id).text(course.title));
        });
        if (courses && courses.length) {
          self.onCourseChanged();
        }
      });
    },

    onCourseChanged: function() {
      var courseId = this.$('.light-course-promote-course-select').val();
      var $versionSelect = this.$('.light-course-promote-version-select').empty();
      if (!courseId) {
        return;
      }
      $.get('api/content/lightcourse/' + courseId + '/versions').done(function(versions) {
        (versions || []).forEach(function(version) {
          var label = 'v' + version.versionNumber + ' - ' + new Date(version.createdAt).toLocaleDateString();
          $versionSelect.append($('<option></option>').attr('value', version._id).text(label));
        });
      });
    },

    getData: function() {
      return {
        versionId: this.$('.light-course-promote-version-select').val(),
        name: this.$('.light-course-promote-name').val().trim(),
        description: this.$('.light-course-promote-description').val()
      };
    }
  }, {
    template: 'lightCoursePromoteFromVersion'
  });

  return LightCoursePromoteFromVersionView;
});
