// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');
  var LightCourseTemplateModel = require('../models/lightCourseTemplateModel');

  var LightCourseTemplateCollection = Backbone.Collection.extend({
    model: LightCourseTemplateModel,
    url: 'api/content/lightcoursetemplate'
  });

  return LightCourseTemplateCollection;
});
