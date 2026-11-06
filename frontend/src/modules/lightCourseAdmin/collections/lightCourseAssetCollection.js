// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');
  var LightCourseAssetModel = require('../models/lightCourseAssetModel');

  var LightCourseAssetCollection = Backbone.Collection.extend({
    model: LightCourseAssetModel,
    url: 'api/content/lightcourseasset'
  });

  return LightCourseAssetCollection;
});
