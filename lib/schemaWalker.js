// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Schema-walking utility for the Light Course Editor (see docs/LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md).
 *
 * Given a JSON Schema fragment in any of the dialects confirmed by the Phase 1 spike - AT's own
 * draft-04 `model.schema`/`properties.schema` files (flat `"translatable": true`), or the
 * framework's 2020-12 `$patch`/`$anchor` course/contentobject schema patches (nested
 * `"_adapt": { "translatable": true }`) - recursively walks it and returns:
 *
 *   - translatablePaths: dot/bracket-notation paths to every translatable string field.
 *   - assetPaths: paths to every field referencing an uploaded asset (the `"inputType":
 *     "Asset:<type>"` convention used by draft-04 schemas, and the `"_backboneForms": "Asset"`
 *     convention used by 2020-12 schemas, which does not encode an asset sub-type).
 *   - requiredDefaults: a path -> default value map for every field that is both required and
 *     declares a `default`, for pre-populating new content instances.
 *   - requiredTranslatablePaths/requiredAssetPaths: paths to every required field that is also
 *     translatable/an asset reference respectively - the two categories the main plan's "add
 *     defaults for templates (values and assets)" admin feature targets (see
 *     plugins/content/lightcourseconfig/index.js's requiredDefaultSchema route), deliberately
 *     excluding required-but-neither fields like internal `_parentId`/`_courseId` plumbing.
 *
 * This is a schema-shape walk, not a data walk: array items are represented with a single
 * trailing `[]` segment (e.g. `_items[].title`) rather than per-index paths. Reusable by Phase 5's
 * word-count service, which pairs these schema paths with real stored data.
 *
 * Accepts the same object shape stored by lib/bowermanager.js in the `componenttype`/
 * `extensiontype` collections (`{ properties: {...}, ... }`, where `properties` is the plugin's
 * `properties.schema` `properties` value), AT's own `model.schema` files (which have the same
 * `{ properties: {...} }` shape), or a framework `course.schema.json`/`contentobject.schema.json`
 * `$patch` document (`{ $patch: { with: { properties: {...}, required: [...] } } }`).
 */

function walkSchema(schemaDoc) {
  // requiredTranslatablePaths/requiredAssetPaths (added for the Light Course Admin "required
  // defaults" config screen - see plugins/content/lightcourseconfig/index.js's
  // requiredDefaultSchema route) are deliberately scoped to exactly the two categories the
  // original plan called out ("add defaults for templates (values and assets)"), rather than
  // every required field regardless of type - that would also surface internal plumbing fields
  // like _parentId/_courseId/_isOptional, which have nothing to do with authoring defaults.
  var result = {
    translatablePaths: [], assetPaths: [], requiredDefaults: {},
    requiredTranslatablePaths: [], requiredAssetPaths: []
  };
  var root = unwrapPatch(schemaDoc);
  if (root && typeof root === 'object') {
    walkNode(root, '', undefined, undefined, result);
  }
  return result;
}

function unwrapPatch(schemaDoc) {
  if (schemaDoc && schemaDoc.$patch && schemaDoc.$patch.with) {
    return schemaDoc.$patch.with;
  }
  return schemaDoc;
}

function isTranslatable(node) {
  return node.translatable === true || !!(node._adapt && node._adapt.translatable === true);
}

function isAssetField(node) {
  if (typeof node.inputType === 'string') {
    return node.inputType.indexOf('Asset:') === 0;
  }
  if (node.inputType && typeof node.inputType.type === 'string') {
    return node.inputType.type.indexOf('Asset:') === 0;
  }
  // 2020-12 dialect (e.g. adapt-contrib-resources' `_link` field) has no sub-type encoded.
  return node._backboneForms === 'Asset';
}

function isRequired(node, key, parentRequiredList) {
  if (node.required === true) {
    return true; // draft-04 field-level flag
  }
  if (Array.isArray(parentRequiredList)) {
    return parentRequiredList.indexOf(key) !== -1; // 2020-12 parent-level required array
  }
  return false;
}

function walkNode(node, path, key, parentRequiredList, result) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (path) {
    var nodeIsTranslatable = node.type === 'string' && isTranslatable(node);
    var nodeIsAsset = isAssetField(node);
    var nodeIsRequired = isRequired(node, key, parentRequiredList);

    if (nodeIsTranslatable) {
      result.translatablePaths.push(path);
    }
    if (nodeIsAsset) {
      result.assetPaths.push(path);
    }
    if (nodeIsRequired && Object.prototype.hasOwnProperty.call(node, 'default')) {
      result.requiredDefaults[path] = node.default;
    }
    if (nodeIsRequired && nodeIsTranslatable) {
      result.requiredTranslatablePaths.push(path);
    }
    if (nodeIsRequired && nodeIsAsset) {
      result.requiredAssetPaths.push(path);
    }
  }

  if (node.properties && typeof node.properties === 'object') {
    var requiredList = Array.isArray(node.required) ? node.required : undefined;
    Object.keys(node.properties).forEach(function (childKey) {
      var childPath = path ? path + '.' + childKey : childKey;
      walkNode(node.properties[childKey], childPath, childKey, requiredList, result);
    });
  }

  if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
    walkNode(node.items, path + '[]', undefined, undefined, result);
  }
}

module.exports = { walkSchema: walkSchema, isTranslatable: isTranslatable, isAssetField: isAssetField, unwrapPatch: unwrapPatch };
