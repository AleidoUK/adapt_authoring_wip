// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  /**
   * Tiny shared singleton giving views/lightCourseBankAssetFieldView.js access to the owning
   * light course's _id, since Backbone.Form editors are instantiated generically by the form
   * library itself (no constructor options pass-through) - the same pattern
   * modules/scaffold/index.js already uses for its own `currentModel`/`alternativeModel`.
   */
  var current = { lightCourseId: null };

  return {
    set: function(lightCourseId) {
      current.lightCourseId = lightCourseId;
    },
    get: function() {
      return current.lightCourseId;
    }
  };
});
