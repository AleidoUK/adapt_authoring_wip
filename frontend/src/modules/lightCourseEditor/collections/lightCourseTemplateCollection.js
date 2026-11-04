// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');

  // Templates are read-only from this view's perspective (admin-managed, per Phase 2) - a plain
  // Backbone.Collection is enough, no dedicated model class needed.
  var LightCourseTemplateCollection = Backbone.Collection.extend({
    url: 'api/content/lightcoursetemplate'
  });

  return LightCourseTemplateCollection;
});
