// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var SchemaFilter = require('./schemaFilter');

  /**
   * Client-side per-component word count, used to annotate the Light Course Editor's tree node
   * labels live (as the author types), without a server round-trip. Deliberately mirrors
   * lib/lightcoursewordcount.js's countWords() HTML-stripping/whitespace-split rule exactly, so
   * this always agrees with the authoritative server-side total (the version history row's
   * "Words" column) rather than drifting into a looser approximation.
   *
   * @param {string} text
   * @return {number}
   */
  function countWords(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    var stripped = text
      .replace(/<\/?(p|li|div|h[1-6]|br|tr)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\'')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped ? stripped.split(' ').length : 0;
  }

  /**
   * Walks a SchemaFilter.filterComponentSchema() result (so asset/non-translatable fields are
   * already excluded) summing word counts over every translatable string actually present on
   * `data`, recursing into nested item arrays/objects the same way schemaFilter.js's own
   * filterProperties() does.
   */
  function countFieldsWords(fields, data) {
    var total = 0;
    Object.keys(fields || {}).forEach(function(key) {
      var field = fields[key];
      if (!field || typeof field !== 'object' || !data) {
        return;
      }
      var value = data[key];
      if (field.items && field.items.properties && Array.isArray(value)) {
        value.forEach(function(item) {
          total += countFieldsWords(field.items.properties, item);
        });
        return;
      }
      if (field.properties && value && typeof value === 'object') {
        total += countFieldsWords(field.properties, value);
        return;
      }
      if (SchemaFilter.isTranslatable(field) && typeof value === 'string') {
        total += countWords(value);
      }
    });
    return total;
  }

  /**
   * @param {object} node - a contentTree component node (has `_component` plus its own flat
   *   field data directly on it, per schemaFilter.js's confirmed "flat, not wrapped" shape)
   * @return {number}
   */
  function countComponentWords(node) {
    if (!node || !node._component) {
      return 0;
    }
    var rawSchema = Origin.schemas.get(node._component) || node._componentSchemaSnapshot;
    if (!rawSchema) {
      return 0;
    }
    return countFieldsWords(SchemaFilter.filterComponentSchema(rawSchema), node);
  }

  return { countWords: countWords, countComponentWords: countComponentWords };
});
