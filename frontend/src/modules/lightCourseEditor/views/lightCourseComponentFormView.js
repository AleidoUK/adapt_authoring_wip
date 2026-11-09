// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var SchemaFilter = require('../schemaFilter');
  var LightCourseAssetContext = require('../lightCourseAssetContext');
  var ComponentLayout = require('../componentLayout');

  /**
   * Renders the generic component field editor described in Phase 3/4's "Generic component-field
   * rendering" sections: reuses Backbone.Form (and every custom editor already registered on
   * Backbone.Form.editors by modules/scaffold/index.js - Asset, List, etc.) directly, rather than
   * going through Scaffold.buildForm()/Schemas(), which assume the full-course editor's
   * Origin.editor.data context exists (see schemaFilter.js's header comment for why). The actual
   * JSON-schema-type -> Backbone.Form-editor-name mapping (e.g. "string" -> "Text", "array" ->
   * "List") is still done via the real `Origin.scaffold.buildSchema()` (exported from
   * modules/scaffold/index.js specifically for this reuse) rather than reimplemented here.
   *
   * this.model is a plain Backbone.Model wrapping one contentTree component node's own data
   * (_component, title, body, uniqueId, items, graphicsNotes, developerNotes, ...) - not the
   * lightcourse model itself. Changes are read back out via getFormData() when the tree view saves.
   *
   * Missing/upgraded plugin handling (Phase 4): if the component type isn't currently installed,
   * fall back to the schema snapshot stored on the node itself at the time it was added
   * (`_componentSchemaSnapshot`, per the main plan's "keep a snapshot of the field descriptors"
   * requirement) and render the form read-only, rather than failing to render at all.
   */
  var LightCourseComponentFormView = OriginView.extend({
    className: 'light-course-component-form',

    preRender: function(options) {
      this.includeAudio = !!options.includeAudio;
      this.lightCourseRefs = options.lightCourseRefs || null;
      this.allowedLayouts = options.allowedLayouts || ComponentLayout.values;
      LightCourseAssetContext.set(options.lightCourseId);
    },

    postRender: function() {
      if (this.isRemoved) {
        return;
      }
      var component = this.model.get('_component');
      var rawSchema = Origin.schemas.get(component);
      var isMissingPlugin = !rawSchema;

      if (isMissingPlugin) {
        rawSchema = this.model.get('_componentSchemaSnapshot');
      } else {
        // keep the snapshot fresh while the plugin is still installed, so it's available the
        // next time this node is opened after the plugin is removed
        this.model.set('_componentSchemaSnapshot', rawSchema, { silent: true });
      }

      if (!rawSchema) {
        this.$('.light-course-component-form-inner').html('<p class="light-course-component-form-missing">' +
          Origin.l10n.t('app.lightcoursecomponentschemamissing') + '</p>');
        return this.setViewToReady();
      }

      if (isMissingPlugin) {
        this.$el.prepend('<p class="light-course-component-form-missing">' +
          Origin.l10n.t('app.lightcoursecomponentschemamissingreadonly') + '</p>');
      }

      var filteredSchema = SchemaFilter.filterComponentSchema(rawSchema, { includeAudio: this.includeAudio, lightCourseRefs: this.lightCourseRefs });
      var layouts = ComponentLayout.choices(rawSchema).filter(function(layout) {
        return (this.allowedLayouts || ComponentLayout.values).indexOf(layout) !== -1;
      }, this);
      if (this.model.get('_layout') === undefined) this.model.set('_layout', layouts[0], { silent: true });
      filteredSchema._layout = { type: 'string', inputType: { type: 'Select', options: layouts },
        title: Origin.l10n.t('app.lightcoursecomponentlayout'), validators: ['required'] };
      filteredSchema.screenshotAssetId = { type: 'string', inputType: 'LightCourseAsset:image',
        title: Origin.l10n.t('app.lightcoursecomponentscreenshot') };

      // Light-editor-only fields, per the main plan - never part of the real component schema,
      // merged in here at the form-building level only (Phase 3's "Generic component-field
      // rendering" deliverable 2). Must declare `inputType: 'TextArea'` (not just `type:
      // 'TextArea'`) - confirmed via live browser testing that modules/scaffold/index.js's
      // generateFieldObject()/getType() only ever resolves a real Backbone.Form editor from
      // `field.inputType` (or a JSON-schema `type` of 'string'/'array'/etc, never a raw
      // Backbone.Form editor name in `field.type` itself) - this was a real, pre-existing bug
      // (present since Phase 3/4, never caught because those phases had no live browser session)
      // that broke every component's form entirely, now fixed alongside this feature since it
      // otherwise made the new reference-link button impossible to test at all.
      filteredSchema.graphicsNotes = { type: 'string', inputType: 'TextArea', title: Origin.l10n.t('app.lightcoursegraphicsnotes'), lightCourseRefs: this.lightCourseRefs };
      filteredSchema.developerNotes = { type: 'string', inputType: 'TextArea', title: Origin.l10n.t('app.lightcoursedevelopernotes'), lightCourseRefs: this.lightCourseRefs };

      var schema = Origin.scaffold.buildSchema(filteredSchema);
      var fields = Object.keys(schema);
      fields = ['uniqueId', '_layout', 'title', 'screenshotAssetId'].filter(function(key) { return fields.indexOf(key) !== -1; })
        .concat(_.without(fields, 'uniqueId', '_layout', 'title', 'screenshotAssetId'));

      this.model.schema = schema;
      this.form = new Backbone.Form({ model: this.model, schema: schema, fields: fields }).render();
      this.$('.light-course-component-form-inner').append(this.form.el);

      if (isMissingPlugin) {
        this.form.$('input, textarea, select, button').prop('disabled', true);
      }

      this.setViewToReady();
    },

    /**
     * @return {object} the current form values, merged back onto the component node's data -
     * includes `_component`/`_componentSchemaSnapshot` explicitly since neither is a rendered
     * form field and so wouldn't otherwise survive the round-trip through this.form.getValue().
     */
    getFormData: function() {
      var bookkeeping = this.model.pick('_component', '_componentSchemaSnapshot');
      return _.omit(Object.assign({}, bookkeeping, this.form ? this.form.getValue() : this.model.toJSON()), '_comments');
    },

    remove: function() {
      this.isRemoved = true;
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseComponentForm'
  });

  return LightCourseComponentFormView;
});
