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
      title: '',
      body: '',
      contentTree: {},
      pluginSelections: {},
      headerData: {},
      glossaryItems: [],
      resourceItems: [],
      helpContent: {}
    },

    parse: function(response) {
      if (!response) {
        return response;
      }
      // Content updates return an acknowledgement, not a replacement snapshot.
      if (response.success === true && response.contentSnapshot === undefined) {
        var acknowledgement = Object.assign({}, response);
        delete acknowledgement.success;
        return acknowledgement;
      }
      var snapshot = response.contentSnapshot || {};
      var flattened = Object.assign({}, response, {
        title: snapshot.title || '',
        body: snapshot.body || '',
        contentTree: snapshot.contentTree || {},
        pluginSelections: snapshot.pluginSelections || {},
        headerData: snapshot.headerData || {},
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
        _id: attrs._id,
        createdAt: attrs.createdAt,
        updatedAt: attrs.updatedAt,
        name: attrs.name,
        description: attrs.description,
        // also exposed flat (not just nested below) - this view's own template renders
        // `value="{{title}}"` etc directly against `model.toJSON()` (standard Backbone/
        // OriginView render convention), same as it already does for name/description; without
        // this, the fields always looked blank on open despite being saved correctly, confirmed
        // live (the backend happily ignores these two harmless top-level duplicates - its
        // model.schema only declares name/description/contentSnapshot).
        title: attrs.title,
        body: attrs.body,
        contentSnapshot: {
          title: attrs.title,
          body: attrs.body,
          contentTree: attrs.contentTree,
          pluginSelections: attrs.pluginSelections,
          headerData: attrs.headerData,
          glossaryItems: attrs.glossaryItems,
          resourceItems: attrs.resourceItems,
          helpContent: attrs.helpContent
        }
      };
    }
  });

  return LightCourseTemplateModel;
});
