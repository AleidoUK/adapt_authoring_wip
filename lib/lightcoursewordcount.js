// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Shared translatable word-count service for the Light Course Editor (and, per the main plan,
 * the full-course editor too - see docs/LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md).
 *
 * No existing word-count or generic "walk a schema for translatable fields" utility was found
 * anywhere in this codebase (confirmed by repo-wide search, excluding node_modules/temp) -
 * lib/outputmanager.js's getCourseJSON()/getConfigJson() flatten Mongo documents into the export
 * JSON shape but do nothing with translatable-field semantics. Built from scratch here.
 *
 * This pairs a schema with real stored data (unlike lib/schemaWalker.js's Phase 1 schema-only
 * path walk, which only knows the *shape* of translatable fields, not actual values) - reuses
 * schemaWalker.js's dialect-detection helpers (isTranslatable/unwrapPatch) rather than
 * duplicating them.
 */

var async = require('async');
var database = require('./database');
var schemaWalker = require('./schemaWalker');

var COMPONENT_SCHEMA_PATH = require('path').join(__dirname, '..', 'plugins', 'content', 'component', 'model.schema');
var componentCommonSchemaCache = null;

/**
 * Strips HTML, decodes the handful of entities Adapt content realistically uses, normalizes
 * whitespace, then splits on whitespace to count words - per the main plan's agreed rule. Applied
 * identically to per-component and course-level totals so they sum consistently.
 *
 * Block-level tags (`p`/`li`/`div`/`h1`-`h6`/`br`/`tr`) are replaced with a space first (they
 * represent real word boundaries in rendered text); every other tag (`strong`/`em`/`a`/`span`
 * etc.) is dropped entirely rather than replaced with a space, so e.g. `world</strong>,` doesn't
 * get an artificial space inserted before the comma and counted as its own stray "word".
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
  if (!stripped) {
    return 0;
  }
  return stripped.split(' ').length;
}

/**
 * Recursively walks a schema fragment (any dialect confirmed by Phase 1) paired with real stored
 * data, returning every translatable string actually present.
 *
 * @param {object} schema - a schema fragment (same shapes lib/schemaWalker.js#walkSchema accepts:
 *   a `{ properties: {...} }` document, or a `{ $patch: { with: {...} } }` document)
 * @param {object} data - the stored data this schema describes
 * @return {Array<{path: string, text: string}>}
 */
function walkTranslatableFields(schema, data, options) {
  var results = [];
  var root = schemaWalker.unwrapPatch(schema);
  if (root && typeof root === 'object') {
    walkNode(root, data, '', results, options || {});
  }
  return results;
}

function walkNode(node, data, path, results, options) {
  if (!node || typeof node !== 'object' || data === undefined || data === null) {
    return;
  }

  if (path && node.type === 'string' && schemaWalker.isTranslatable(node) && typeof data === 'string' && (data.length || options.includeEmpty)) {
    results.push({ path: path, text: data });
    return;
  }

  if (node.properties && typeof node.properties === 'object' && typeof data === 'object' && !Array.isArray(data)) {
    Object.keys(node.properties).forEach(function (key) {
      var childPath = path ? path + '.' + key : key;
      walkNode(node.properties[key], data[key], childPath, results, options);
    });
  }

  if (node.items && typeof node.items === 'object' && !Array.isArray(node.items) && Array.isArray(data)) {
    data.forEach(function (item, index) {
      walkNode(node.items, item, path + '[' + index + ']', results, options);
    });
  }
}

/**
 * Loads plugins/content/component/model.schema once (the common fields every component shares -
 * title/displayTitle/body/_extensions etc.) and caches it for the process lifetime - it's a
 * static file, not tenant data.
 */
function getComponentCommonSchema(callback) {
  if (componentCommonSchemaCache) {
    return callback(null, componentCommonSchemaCache);
  }
  require('fs').readFile(COMPONENT_SCHEMA_PATH, function (err, data) {
    if (err) {
      return callback(err);
    }
    try {
      componentCommonSchemaCache = JSON.parse(data);
      callback(null, componentCommonSchemaCache);
    } catch (parseError) {
      callback(parseError);
    }
  });
}

/**
 * Merges the common component schema with an installed component's own declared properties -
 * the same combination the server's own `/content/schema` route builds for the full editor
 * (confirmed in lib/contentmanager.js's generateComponentProperties()), reimplemented here since
 * that logic isn't exported.
 */
function resolveComponentSchema(componentName, db, callback) {
  getComponentCommonSchema(function (err, commonSchema) {
    if (err) {
      return callback(err);
    }
    db.retrieve('componenttype', { component: componentName }, { jsonOnly: true }, function (err, results) {
      if (err) {
        return callback(err);
      }
      var merged = { properties: Object.assign({}, commonSchema.properties) };
      if (results && results.length && results[0].properties) {
        merged.properties = Object.assign({}, merged.properties, results[0].properties);
      }
      callback(null, merged, results && results.length ? results[0].displayName : undefined);
    });
  });
}

// Fixed internal shapes (not schema-driven - these are the Light Course Editor's own data
// structures, not installed-plugin schemas) for the glossary/resource/help lists Phase 2/4
// introduced. Kept here, alongside the schema-driven component walk, so one service covers every
// translatable-content source on a light course.
var FIXED_ITEM_FIELDS = {
  glossaryItems: ['term', 'description'],
  resourceItems: ['title', 'description']
};

function countFixedItemsWords(items, fields) {
  var total = 0;
  (items || []).forEach(function (item) {
    fields.forEach(function (field) {
      total += countWords(item[field]);
    });
  });
  return total;
}

function countHelpContentWords(helpContent) {
  if (!helpContent) {
    return 0;
  }
  var total = 0;
  if (helpContent.popup) {
    total += countWords(helpContent.popup.title) + countWords(helpContent.popup.body) + countWords(helpContent.popup.instruction);
  }
  (helpContent.items || []).forEach(function (item) {
    total += countWords(item.title) + countWords(item.body);
  });
  return total;
}

/**
 * Walks every page/article/block/component node in a contentTree (the `{ children: [] }` shape
 * confirmed in lib/lightcourse/validation.js), word-counting each component against its resolved
 * schema. A "screen" is one component, per the main plan - the screen count is just the
 * component-node count from this same tree walk, no separate logic needed.
 *
 * @param {object} contentTree
 * @param {object} db - a connected database handle (for componenttype lookups)
 * @param {function} callback - function(error, { screens, components: [{ _id, _component, words }], componentWordsTotal })
 */
function walkContentTreeWordCounts(contentTree, db, callback) {
  var componentNodes = [];
  collectComponentNodes((contentTree && contentTree.children) || [], componentNodes);

  var schemaCache = {};
  async.mapSeries(componentNodes, function (node, next) {
    var componentName = node._component;
    if (!componentName) {
      return next(null, { _id: node._id, _component: componentName, words: 0 });
    }
    if (schemaCache[componentName]) {
      return next(null, { _id: node._id, _component: componentName, words: countNodeWords(node, schemaCache[componentName]) });
    }
    resolveComponentSchema(componentName, db, function (err, schema) {
      if (err) {
        return next(err);
      }
      schemaCache[componentName] = schema;
      next(null, { _id: node._id, _component: componentName, words: countNodeWords(node, schema) });
    });
  }, function (err, components) {
    if (err) {
      return callback(err);
    }
    var componentWordsTotal = components.reduce(function (sum, c) { return sum + c.words; }, 0);
    callback(null, { screens: componentNodes.length, components: components, componentWordsTotal: componentWordsTotal });
  });
}

function countNodeWords(node, schema) {
  var fields = walkTranslatableFields(schema, node);
  return fields.reduce(function (sum, field) { return sum + countWords(field.text); }, 0);
}

function collectComponentNodes(nodes, out) {
  (nodes || []).forEach(function (node) {
    if (!node) {
      return;
    }
    if (node.type === 'component') {
      out.push(node);
      return;
    }
    collectComponentNodes(node.children, out);
  });
}

/**
 * Full word-count computation for a light course draft or version snapshot: component/screen
 * totals from the contentTree, plus glossary/resource/help-content totals, summed into a single
 * course-level total. Explicitly excludes Graphics Notes/Developer Notes and all document header
 * fields (version history, reviewing instructions, developer information, terminology,
 * button/help-icon choices) - these are never part of the schema-driven field set or the fixed
 * glossary/resource/help shapes walked here, so they're naturally excluded without extra code.
 *
 * @param {object} data - { contentTree, glossaryItems, resourceItems, helpContent }
 * @param {object} db - a connected database handle
 * @param {function} callback - function(error, { screens, componentWords, glossaryWords, resourceWords, helpWords, total, components })
 */
function computeWordCount(data, db, callback) {
  walkContentTreeWordCounts(data.contentTree, db, function (err, treeResult) {
    if (err) {
      return callback(err);
    }
    var glossaryWords = countFixedItemsWords(data.glossaryItems, FIXED_ITEM_FIELDS.glossaryItems);
    var resourceWords = countFixedItemsWords(data.resourceItems, FIXED_ITEM_FIELDS.resourceItems);
    var helpWords = countHelpContentWords(data.helpContent);

    callback(null, {
      screens: treeResult.screens,
      componentWords: treeResult.componentWordsTotal,
      glossaryWords: glossaryWords,
      resourceWords: resourceWords,
      helpWords: helpWords,
      total: treeResult.componentWordsTotal + glossaryWords + resourceWords + helpWords,
      components: treeResult.components
    });
  });
}

module.exports = {
  countWords: countWords,
  countNodeWords: countNodeWords,
  walkTranslatableFields: walkTranslatableFields,
  resolveComponentSchema: resolveComponentSchema,
  computeWordCount: computeWordCount,
  collectComponentNodes: collectComponentNodes
};
