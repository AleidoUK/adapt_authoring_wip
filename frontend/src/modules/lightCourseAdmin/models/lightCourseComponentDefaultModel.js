// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');

  /**
   * Admin-facing component default (preset) model - plugins/content/lightcomponentdefault/
   * model.schema's fields are already flat (name/description/componentType/values/isDefault),
   * so unlike LightCourseTemplateModel this needs no parse()/toJSON() wrapping.
   */
  var LightCourseComponentDefaultModel = Backbone.Model.extend({
    idAttribute: '_id',
    urlRoot: 'api/content/lightcomponentdefault',

    defaults: {
      name: '',
      description: '',
      componentType: '',
      values: {},
      isDefault: false
    }
  });

  return LightCourseComponentDefaultModel;
});
