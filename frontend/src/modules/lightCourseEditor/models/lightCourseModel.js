// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');

  var LightCourseModel = Backbone.Model.extend({
    idAttribute: '_id',
    urlRoot: 'api/content/lightcourse',

    defaults: {
      title: '',
      body: '',
      tags: [],
      revision: 0,
      contentTree: {},
      pluginSelections: {},
      glossaryItems: [],
      resourceItems: [],
      headerData: {},
      conversionStatus: 'none'
    },

    /**
     * Publishes the current revision as a new immutable version.
     * @param {string} bump - 'minor' or 'major'
     */
    publishVersion: function(bump, options) {
      options = options || {};
      return $.ajax({
        url: this.url() + '/versions',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ revision: this.get('revision'), bump: bump }),
        success: options.success,
        error: options.error
      });
    },

    fetchVersions: function(options) {
      return $.ajax({ url: this.url() + '/versions', type: 'GET' }).done(options.success).fail(options.error);
    },

    fetchVersion: function(id, options) {
      return $.ajax({ url: this.url() + '/versions/' + encodeURIComponent(id), type: 'GET' }).done(options.success).fail(options.error);
    },

    compareVersions: function(a, b, options) {
      return $.ajax({ url: this.url() + '/versions/compare', type: 'GET', data: { a: a, b: b } })
        .done(options.success).fail(options.error);
    },

    isLocked: function() {
      return this.get('conversionStatus') === 'converted';
    }
  });

  return LightCourseModel;
});
