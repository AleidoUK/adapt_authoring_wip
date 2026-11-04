// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');

  /**
   * One tenant-scoped admin configuration record (see plugins/content/lightcourseconfig/
   * index.js). Always fetched via the "mine" get-or-create convenience route (this model never
   * knows its own _id up front - there's exactly one per tenant, created lazily on first use) but
   * saved via the generic content PUT route once its _id is known, per Backbone's own isNew()
   * url-selection convention.
   */
  var LightCourseConfigModel = Backbone.Model.extend({
    idAttribute: '_id',

    defaults: {
      defaultPluginSelections: {},
      graphicPlaceholders: {},
      requiredDefaults: {},
      iconDefaults: {}
    },

    url: function() {
      return this.isNew() ? 'api/lightcourseconfig/mine' : 'api/content/lightcourseconfig/' + this.get('_id');
    }
  });

  return LightCourseConfigModel;
});
