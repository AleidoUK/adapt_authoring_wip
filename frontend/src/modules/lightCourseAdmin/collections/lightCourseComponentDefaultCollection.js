// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');
  var LightCourseComponentDefaultModel = require('../models/lightCourseComponentDefaultModel');

  var LightCourseComponentDefaultCollection = Backbone.Collection.extend({
    model: LightCourseComponentDefaultModel,
    url: 'api/content/lightcomponentdefault'
  });

  return LightCourseComponentDefaultCollection;
});
