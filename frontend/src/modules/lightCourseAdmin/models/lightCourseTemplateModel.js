// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');

  /**
   * Admin-facing light course template model. The server stores a template's content as a single
   * nested `contentSnapshot` object (plugins/content/lightcoursetemplate/model.schema) - `parse()`/
   * `toJSON()` flatten/re-wrap it to/from top-level attributes (contentTree/pluginSelections/
   * glossaryItems/resourceItems/helpContent) so the *exact same* reusable light-course-editor
   * sub-views (LightCourseTreeView, LightCourseItemListView, LightCourseHelpView - all of which
   * read these as plain top-level model attributes) work against this model completely unmodified,
   * with no template-specific changes needed in any of them.
   */
  var LightCourseTemplateModel = Backbone.Model.extend({
    idAttribute: '_id',
    urlRoot: 'api/content/lightcoursetemplate',

    defaults: {
      name: '',
      description: '',
      contentTree: {},
      pluginSelections: {},
      glossaryItems: [],
      resourceItems: [],
      helpContent: {}
    },

    parse: function(response) {
      if (!response) {
        return response;
      }
      var snapshot = response.contentSnapshot || {};
      var flattened = Object.assign({}, response, {
        contentTree: snapshot.contentTree || {},
        pluginSelections: snapshot.pluginSelections || {},
        glossaryItems: snapshot.glossaryItems || [],
        resourceItems: snapshot.resourceItems || [],
        helpContent: snapshot.helpContent || {}
      });
      delete flattened.contentSnapshot;
      return flattened;
    },

    toJSON: function() {
      var attrs = Backbone.Model.prototype.toJSON.call(this);
      return {
        name: attrs.name,
        description: attrs.description,
        contentSnapshot: {
          contentTree: attrs.contentTree,
          pluginSelections: attrs.pluginSelections,
          glossaryItems: attrs.glossaryItems,
          resourceItems: attrs.resourceItems,
          helpContent: attrs.helpContent
        }
      };
    }
  });

  return LightCourseTemplateModel;
});
