// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  /**
   * Frontend field-visibility filter for the Light Course component editor
   * (docs/LIGHT_COURSE_PHASE3_LIST_AND_EDITOR.md, "Generic component-field rendering").
   *
   * Scaffold.buildForm()/./schemas.js's Schemas() cannot be reused as-is here: Schemas() reads
   * `Origin.editor.data.config`/`.menutypes`/`.themetypes`, which are only populated inside the
   * full-course editor and would throw (reading `.config` of undefined) if called from the Light
   * Course Editor. Origin.schemas itself, however, is populated globally at app start
   * (core/origin.js triggers 'schemas:loadData' once on init, independent of the full editor), so
   * Origin.schemas.get(componentName) - the same flat, combined (common component fields + the
   * installed component's own properties.schema fields) schema Schemas()/buildForm() would
   * eventually consume - is safe to read directly. This module takes that raw schema and keeps
   * only the fields the Light Course Editor should ever show, mirroring the dialect-handling
   * already confirmed by lib/schemaWalker.js (Phase 1), but as a plain object filter rather than
   * a path-list walk, since the output needs to stay a valid schema fragment for Backbone.Form.
   *
   * Kept fields:
   *   - translatable string fields (`field.translatable === true` or
   *     `field._adapt && field._adapt.translatable === true`)
   *   - asset reference fields (`field.inputType` starting with "Asset:", or `field._backboneForms
   *     === "Asset"`)
   *   - the uniqueId remap (`_extensions._uniqueId._id`, per Phase 1), exposed to the editor as a
   *     flat top-level `uniqueId` field
   *   - nested item arrays (`type: "array"` with object `items`) are recursed into and kept only
   *     if they contain at least one kept field
   *
   * Everything else (settings/style/layout fields such as `_classes`, `_isOptional`,
   * `themeSettings`, `properties`) is dropped.
   */

  function isTranslatable(field) {
    return field.translatable === true || !!(field._adapt && field._adapt.translatable === true);
  }

  function getAssetSubtype(field) {
    if (typeof field.inputType === 'string' && field.inputType.indexOf('Asset:') === 0) {
      return field.inputType.slice('Asset:'.length) || 'image';
    }
    if (field.inputType && typeof field.inputType.type === 'string' && field.inputType.type.indexOf('Asset:') === 0) {
      return field.inputType.type.slice('Asset:'.length) || 'image';
    }
    if (field._backboneForms === 'Asset') {
      return 'image'; // 2020-12 dialect (e.g. adapt-contrib-resources' `_link`) has no sub-type encoded
    }
    return null;
  }

  function isAssetField(field) {
    return getAssetSubtype(field) !== null;
  }

  /**
   * Remaps an asset field's inputType to the light-course-scoped "LightCourseAsset:<type>"
   * editor (views/lightCourseBankAssetFieldView.js), instead of the shared "Asset:<type>" editor
   * (scaffoldAssetView.js) which writes to the full-course `courseasset` collection and calls
   * Origin.scaffold.getCurrentModel() - neither applies to the Light Course Editor.
   */
  function remapAssetField(field, subtype) {
    return Object.assign({}, field, { inputType: 'LightCourseAsset:' + subtype });
  }

  function filterProperties(properties) {
    var filtered = {};
    Object.keys(properties || {}).forEach(function(key) {
      var field = properties[key];
      if (!field || typeof field !== 'object') {
        return;
      }
      if (field.type === 'array' && field.items && field.items.properties) {
        var nestedItemProperties = filterProperties(field.items.properties);
        if (Object.keys(nestedItemProperties).length) {
          filtered[key] = Object.assign({}, field, { items: Object.assign({}, field.items, { properties: nestedItemProperties }) });
        }
        return;
      }
      if (field.type === 'object' && field.properties) {
        // e.g. adapt-aleido-help's `_items[]._graphic` ({ alt, src }) - the wrapper itself isn't
        // translatable/asset, only its children are, so recurse and keep it only if something
        // inside survived. Scaffold.buildSchema() already knows how to walk a nested `.properties`
        // object field correctly, so no extra bookkeeping is needed here beyond that.
        var nestedObjectProperties = filterProperties(field.properties);
        if (Object.keys(nestedObjectProperties).length) {
          filtered[key] = Object.assign({}, field, { properties: nestedObjectProperties });
        }
        return;
      }
      var assetSubtype = getAssetSubtype(field);
      if (field.type === 'string' && assetSubtype) {
        filtered[key] = remapAssetField(field, assetSubtype);
        return;
      }
      if (field.type === 'string' && isTranslatable(field)) {
        filtered[key] = field;
      }
    });
    return filtered;
  }

  /**
   * @param {object} rawSchema - as returned by Origin.schemas.get(componentName)
   * @param {object} [options]
   * @param {boolean} [options.includeAudio] - include the component/item audio fields declared by
   *   adapt-aleido-audio's properties.schema, only when that extension is among the course's
   *   selected extensions (per the product doc)
   * @param {object} [options.lightCourseRefs] - if given, attached to every TextArea-typed field
   *   as `field.lightCourseRefs` (see attachLightCourseRefs() below)
   * @return {object} a filtered schema fragment, safe to assign as a Backbone.Form schema
   */
  function filterComponentSchema(rawSchema, options) {
    options = options || {};
    if (!rawSchema) {
      return {};
    }
    // Confirmed live (via Origin.schemas.get(componentName) in a real browser session -
    // genuinely exercising this for the first time, the Phase 3/4 docs' own "no live browser
    // session" caveat had let this go unnoticed): `rawSchema` is ALREADY the flat common/base
    // field map itself (title/body/displayTitle/etc at its own top level, confirmed against a
    // real installed component) - it is NOT wrapped in another `.properties` layer the way a
    // plain JSON-schema object node would be. `_extensions` and `rawSchema.properties` (the
    // component's own opaque per-component settings bag, confirmed nested one level via its OWN
    // `.properties`, e.g. adapt-contrib-text's `instruction`) are handled explicitly below -
    // never walked generically here, or e.g. the audio fields would be kept twice.
    var genericProperties = _.omit(rawSchema, '_extensions', 'properties');
    var filtered = filterProperties(genericProperties);

    // The component's own custom fields (e.g. adapt-contrib-text's `instruction`) - previously
    // never actually reached at all (this whole function was reading one level too deep
    // everywhere, so every component's field editor silently rendered with none of its own
    // fields, only the two synthetic graphicsNotes/developerNotes ones) - merged in via the same
    // generic filter, so a custom translatable field gets exactly the same keep/drop treatment a
    // common one does.
    if (rawSchema.properties && rawSchema.properties.properties) {
      Object.assign(filtered, filterProperties(rawSchema.properties.properties));
    }

    // Phase 1's confirmed uniqueId remap: not a literal top-level field in the raw schema.
    var uniqueIdNode = rawSchema._extensions &&
      rawSchema._extensions.properties &&
      rawSchema._extensions.properties._uniqueId &&
      rawSchema._extensions.properties._uniqueId.properties &&
      rawSchema._extensions.properties._uniqueId.properties._id;
    if (uniqueIdNode) {
      filtered.uniqueId = Object.assign({}, uniqueIdNode, { title: uniqueIdNode.title || 'Unique ID' });
    }

    // Confirmed against the real extensions/adapt-aleido-audio/properties.schema: the merged
    // path on every component's schema (via lib/contentmanager.js's /content/schema route) is
    // `_extensions._audio`, not a top-level `_audio` - it's an extension-contributed block, not a
    // component-owned field. Flattened to two top-level fields here; the extension's separate
    // per-item audio overlay (`_audio._componentItems._items[]`, index-matched against the
    // component's own unrelated item array) is a significant extra bespoke-UI undertaking for
    // comparatively low value and is deliberately out of scope for now - only the single
    // component-level audio field is exposed.
    var audioNode = rawSchema._extensions &&
      rawSchema._extensions.properties &&
      rawSchema._extensions.properties._audio &&
      rawSchema._extensions.properties._audio.properties;
    if (options.includeAudio && audioNode && audioNode._src) {
      filtered.audioSrc = remapAssetField(Object.assign({}, audioNode._src, { title: audioNode._src.title || 'Audio' }), 'audio');
      if (audioNode.transcript) {
        filtered.audioTranscript = audioNode.transcript;
      }
    }

    if (options.lightCourseRefs) {
      attachLightCourseRefs(filtered, options.lightCourseRefs);
    }

    return filtered;
  }

  /**
   * Attaches `field.lightCourseRefs` (consumed by frontend/src/modules/lightCourseEditor/
   * lightCourseRefPlugin.js, via modules/scaffold/index.js's generateFieldObject() and
   * backboneFormsOverrides.js's TextArea render() override) to every `TextArea`-typed field in a
   * filtered schema - the "insert glossary/resource reference" button only ever makes sense on a
   * CKEditor-backed rich-text field, never a plain single-line `Text` field. Recurses into nested
   * item-array field sets (e.g. adapt-aleido-help's `_items[]`) since those can have their own
   * TextArea fields too.
   */
  function attachLightCourseRefs(properties, lightCourseRefs) {
    Object.keys(properties).forEach(function(key) {
      var field = properties[key];
      if (!field || typeof field !== 'object') {
        return;
      }
      // Real component schema fields declare this as `inputType: 'TextArea'` (with `type:
      // 'string'`), matching the JSON-schema `type` + Backbone.Form `inputType` split used
      // throughout the real installed schemas (confirmed live) - not `type: 'TextArea'' directly
      // (that was a separate pre-existing bug in graphicsNotes/developerNotes below, now fixed).
      if (field.inputType === 'TextArea') {
        field.lightCourseRefs = lightCourseRefs;
      }
      if (field.items && field.items.properties) {
        attachLightCourseRefs(field.items.properties, lightCourseRefs);
      }
    });
  }

  return { filterComponentSchema: filterComponentSchema, isTranslatable: isTranslatable, isAssetField: isAssetField };
});
