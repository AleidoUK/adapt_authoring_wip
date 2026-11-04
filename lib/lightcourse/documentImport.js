// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Document import for the Light Course Editor - the inverse of lib/lightcourse/documentGenerator.js,
 * per docs/LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md.
 *
 * Two explicit product decisions this module implements (confirmed before building, per the main
 * plan's requirement that these not be guessed):
 *   - **Structural changes are rejected, not guessed.** Validation always runs to completion
 *     *before* any field is written - `importDocument()`'s two-phase validate-then-apply shape
 *     below is deliberate, not incidental, so a partially-valid document can never partially
 *     mutate the draft.
 *   - **Strict per-component field mapping.** A component's body text in the document is the
 *     concatenation of however many translatable fields `lib/lightcoursewordcount.js`'s schema
 *     walk produced for it, in that order. On import, the recovered body is split back into that
 *     same number of lines and zip-assigned back onto those same fields, in order. If the line
 *     count no longer matches, that component's import is rejected with a specific, actionable
 *     error (not partially applied, not guessed) - the reviewer must edit text in place rather
 *     than add/remove paragraphs within a component's body for the import to succeed.
 *
 * Glossary/resource/help items are simpler - each is exactly one heading field (term/title) plus
 * one body field (description/body), so no field-count ambiguity exists for them. The one
 * exception is the help popup's optional `instruction` field, which generateMarkdown()/
 * generateDocx() only emit conditionally (not schema-walked, so it can't use the same strict
 * line-count rule) - a deliberate scope reduction, not reapplied by import; edit it via the editor.
 */

var async = require('async');
var documentGenerator = require('./documentGenerator');
var wordcount = require('../lightcoursewordcount');

/**
 * Sets a value at a dot/bracket path produced by lib/lightcoursewordcount.js#walkTranslatableFields
 * (e.g. "title", "_items[0].text") onto an existing object - the containers along the path are
 * expected to already exist (import only ever changes leaf text values, never structure).
 */
function setValueAtPath(data, path, value) {
  var tokens = path.match(/[^.[\]]+/g) || [];
  if (!tokens.length) {
    return false;
  }
  var target = data;
  for (var i = 0; i < tokens.length - 1; i++) {
    target = target[tokens[i]];
    if (target === undefined || target === null) {
      return false;
    }
  }
  target[tokens[tokens.length - 1]] = value;
  return true;
}

/**
 * parseMarkdown()/parseDocx() accumulate a block's recovered text as non-blank lines joined with
 * "\n" (blank lines are paragraph/field separators, not themselves content) - this is the inverse
 * split, trimmed of incidental surrounding whitespace.
 */
function splitBodyLines(body) {
  return (body || '').split('\n').map(function (line) { return line.trim(); }).filter(function (line) { return line.length > 0; });
}

/**
 * Builds the ordered list of block IDs expected in an exported document for the given snapshot -
 * the same content-tree blocks and fixed glossary/resource/help items
 * lib/lightcourse/documentGenerator.js's generateMarkdown()/generateDocx() emit, in the same
 * order, so a round-tripped document's actual IDs/order can be compared against it exactly.
 *
 * @param {object} snapshot - { contentTree, glossaryItems, resourceItems, helpContent }
 * @param {object} db
 * @param {function} callback - function(error, string[] orderedBlockIds)
 */
function buildExpectedBlockIds(snapshot, db, callback) {
  documentGenerator.collectDocumentBlocks(snapshot.contentTree, db, function (err, contentBlocks) {
    if (err) {
      return callback(err);
    }
    var fixedBlocks = documentGenerator.collectFixedItemBlocks(snapshot);
    callback(null, contentBlocks.map(function (b) { return b.id; }).concat(fixedBlocks.map(function (b) { return b.id; })));
  });
}

/**
 * Validates an uploaded document's structure against what's expected - run to completion before
 * any field is written. Returns every structural problem found (missing/unexpected/reordered
 * sections, or anything parseMarkdown()/parseDocx() itself already flagged, e.g. missing/
 * duplicate lcids) rather than stopping at the first one, so a reviewer can fix everything in one
 * pass rather than a frustrating one-error-at-a-time loop.
 *
 * @param {{blocks: Array, errors: string[]}} parsedResult - from parseMarkdown()/parseDocx()
 * @param {string[]} expectedBlockIds - from buildExpectedBlockIds(), in order
 * @return {string[]} errors - empty array means structurally valid
 */
function validateStructure(parsedResult, expectedBlockIds) {
  if (parsedResult.errors && parsedResult.errors.length) {
    return parsedResult.errors.slice(); // the document itself is malformed - nothing else to check
  }
  var actualIds = parsedResult.blocks.map(function (b) { return b.id; });
  var expectedSet = {};
  expectedBlockIds.forEach(function (id) { expectedSet[id] = true; });
  var actualSet = {};
  actualIds.forEach(function (id) { actualSet[id] = true; });

  var missing = expectedBlockIds.filter(function (id) { return !actualSet[id]; });
  var unexpected = actualIds.filter(function (id) { return !expectedSet[id]; });
  var errors = [];
  if (missing.length) {
    errors.push('The document is missing ' + missing.length + ' expected section(s) (' + missing.join(', ') + ') - re-add them rather than deleting, or remove them in the editor first, then re-export and re-import.');
  }
  if (unexpected.length) {
    errors.push('The document contains ' + unexpected.length + ' section(s) not present in the current draft (' + unexpected.join(', ') + ') - adding new sections via import is not supported, add them in the editor instead.');
  }
  if (errors.length) {
    return errors; // a mismatched set makes an order comparison meaningless
  }
  for (var i = 0; i < expectedBlockIds.length; i++) {
    if (expectedBlockIds[i] !== actualIds[i]) {
      errors.push('The document\'s sections have been reordered compared to the current draft - reordering via import is not supported, reorder in the editor instead, then re-export and re-import.');
      break;
    }
  }
  return errors;
}

/**
 * Phase 2 of import (only reached once validateStructure() above returned no errors): re-applies
 * each component's recovered text onto its real schema fields (strict line-count mapping, see the
 * header comment), and each glossary/resource/help item's heading+body. Mutates `snapshot`
 * in place - safe to do unconditionally here because every component's field count is validated
 * *before* any of them are written (the `fieldCountErrors.length` check below), so a later
 * component failing never leaves an earlier one partially applied.
 *
 * @param {Array} parsedBlocks - parsedResult.blocks (already structurally validated)
 * @param {object} snapshot - { contentTree, glossaryItems, resourceItems, helpContent } - mutated in place on success
 * @param {object} db
 * @param {function} callback - function(error, { success: boolean, errors: string[] })
 */
function applyParsedText(parsedBlocks, snapshot, db, callback) {
  var parsedById = {};
  parsedBlocks.forEach(function (block) { parsedById[block.id] = block; });

  var componentNodes = [];
  wordcount.collectComponentNodes((snapshot.contentTree && snapshot.contentTree.children) || [], componentNodes);

  var schemaCache = {};
  var fieldCountErrors = [];
  var pendingWrites = [];

  async.eachSeries(componentNodes, function (node, next) {
    var parsedBlock = parsedById[node._id];
    if (!parsedBlock || !node._component) {
      return next(); // structure already validated - this is a plugin-less/unresolvable node, nothing to apply
    }
    function withSchema(schema) {
      var fields = wordcount.walkTranslatableFields(schema, node);
      var lines = splitBodyLines(parsedBlock.body);
      if (lines.length !== fields.length) {
        fieldCountErrors.push(
          'Component "' + node._id + '" (' + node._component + '): expected ' + fields.length +
          ' line(s) of text but found ' + lines.length + ' - adding/removing paragraphs within a ' +
          'component isn\'t supported for import, edit the existing text in place instead.'
        );
        return next();
      }
      fields.forEach(function (field, index) {
        pendingWrites.push({ node: node, path: field.path, value: lines[index] });
      });
      next();
    }
    if (schemaCache[node._component]) {
      return withSchema(schemaCache[node._component]);
    }
    wordcount.resolveComponentSchema(node._component, db, function (err, schema) {
      if (err) {
        return next(err);
      }
      schemaCache[node._component] = schema;
      withSchema(schema);
    });
  }, function (err) {
    if (err) {
      return callback(err);
    }
    if (fieldCountErrors.length) {
      return callback(null, { success: false, errors: fieldCountErrors });
    }

    pendingWrites.forEach(function (write) {
      setValueAtPath(write.node, write.path, write.value);
    });

    applyFixedItemText(snapshot.glossaryItems, parsedById, 'term', 'description');
    applyFixedItemText(snapshot.resourceItems, parsedById, 'title', 'description');
    if (snapshot.helpContent) {
      if (snapshot.helpContent.popup && snapshot.helpContent.popup.title) {
        var popupBlock = parsedById['help-popup'];
        if (popupBlock) {
          snapshot.helpContent.popup.title = popupBlock.heading;
          snapshot.helpContent.popup.body = popupBlock.body; // .instruction is intentionally not reapplied - see header comment
        }
      }
      applyFixedItemText(snapshot.helpContent.items, parsedById, 'title', 'body');
    }

    callback(null, { success: true, snapshot: snapshot });
  });
}

function applyFixedItemText(items, parsedById, titleField, bodyField) {
  (items || []).forEach(function (item) {
    var block = parsedById[item._id];
    if (!block) {
      return;
    }
    item[titleField] = block.heading;
    item[bodyField] = block.body;
  });
}

/**
 * Full import: validate structure, then (only if valid) apply text changes. Never interleaves the
 * two, per the main plan.
 *
 * @param {{blocks: Array, errors: string[]}} parsedResult - from parseMarkdown()/parseDocx()
 * @param {object} snapshot - the current draft's { contentTree, glossaryItems, resourceItems, helpContent } - mutated in place on success
 * @param {object} db
 * @param {function} callback - function(error, { success: boolean, errors: string[], snapshot }
 */
function importDocument(parsedResult, snapshot, db, callback) {
  buildExpectedBlockIds(snapshot, db, function (err, expectedBlockIds) {
    if (err) {
      return callback(err);
    }
    var structuralErrors = validateStructure(parsedResult, expectedBlockIds);
    if (structuralErrors.length) {
      return callback(null, { success: false, errors: structuralErrors });
    }
    applyParsedText(parsedResult.blocks, snapshot, db, callback);
  });
}

module.exports = {
  setValueAtPath: setValueAtPath,
  splitBodyLines: splitBodyLines,
  buildExpectedBlockIds: buildExpectedBlockIds,
  validateStructure: validateStructure,
  applyParsedText: applyParsedText,
  importDocument: importDocument
};
