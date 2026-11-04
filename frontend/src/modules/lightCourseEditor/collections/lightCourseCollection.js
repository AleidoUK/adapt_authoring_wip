// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');
  var LightCourseModel = require('../models/lightCourseModel');

  var LightCourseCollection = Backbone.Collection.extend({
    model: LightCourseModel,
    url: 'api/content/lightcourse',

    // Sorted client-side rather than via a `?operators[sort]=...` fetch param: confirmed
    // lib/contentmanager.js's generic `GET /content/:type` route builds its Mongo filter from
    // the *entire* `req.query` object without stripping the `operators` key back out first, so
    // a nested `operators[sort][...]` param is itself matched against as a (non-existent)
    // "operators" field and silently returns zero results - a pre-existing quirk of that shared
    // route, not something worth risking a wider fix for just for this one listing.
    comparator: function(model) {
      return -(new Date(model.get('updatedAt') || model.get('createdAt') || 0).getTime());
    }
  });

  return LightCourseCollection;
});
