// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');

  /**
   * Admin-facing model for a single item in the dedicated Light Course placeholder asset pool
   * (plugins/content/lightcourseasset/) - a plain file-metadata record (title/description/
   * assetType/filename/path/directory/repository/size/mimeType/thumbnailPath), entirely separate
   * from the main Asset Management area's own `asset` collection/library. New uploads go through
   * `api/content/lightcourseasset/upload` (multipart, see the list view), not a plain POST to
   * this model's urlRoot - so this model is only ever fetched/destroyed via Backbone, never saved
   * directly.
   */
  var LightCourseAssetModel = Backbone.Model.extend({
    idAttribute: '_id',
    urlRoot: 'api/content/lightcourseasset',

    defaults: {
      title: '',
      description: '',
      assetType: 'image',
      filename: '',
      size: 0,
      mimeType: ''
    }
  });

  return LightCourseAssetModel;
});
