// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Document export generator for the Light Course Editor (Markdown and .docx), per
 * docs/LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md. No existing reusable "build a document from a
 * course" utility was found - plugins/output/adapt/export.js's ZIP-building pipeline is the
 * closest architectural relative (build to a temp location, then package/stream) but produces
 * framework-runnable output, not a reviewable document, so this is new.
 *
 * Stable node ID embedding (resolved product decision, see the main plan/Phase 5 doc):
 *   - Markdown: an invisible `<!-- lcid:<nodeId> -->` HTML comment on its own line directly above
 *     each heading.
 *   - .docx: a named Word bookmark (`lcid_<nodeId>`) wrapping each heading's text run.
 *
 * Reuses lib/lightcoursewordcount.js's component-schema resolution and translatable-field
 * walking rather than re-implementing schema handling a third time.
 */

var async = require('async');
var unzipper = require('unzipper');
var XMLParser = require('fast-xml-parser').XMLParser;
var wordcount = require('../lightcoursewordcount');
var wordFields = require('./wordFields');
var wordDocument = require('./wordDocument');

var LEVEL_LABELS = { page: 'Page', article: 'Article', block: 'Block' };

/**
 * Walks a contentTree (`{ children: [] }`, per lib/lightcourse/validation.js) into a flat,
 * ordered list of document blocks: `{ id, level (1-4), heading, bodyParagraphs: [string] }`.
 * Structural nodes (page/article/block) get a positional label ("Page 1", "Article 1.1" etc.);
 * component nodes get their translatable field values resolved against the installed component's
 * real schema.
 *
 * @param {object} contentTree
 * @param {object} db - a connected database handle (for component schema resolution)
 * @param {function} callback - function(error, blocks)
 */
function collectDocumentBlocks(contentTree, db, callback, options) {
  options = options || {};
  var blocks = [];
  var schemaCache = {};

  function walkComponent(node, position, next) {
    var heading = node._component + (node.title ? ': ' + node.title : '');
    if (!node._component) {
      var emptyBlock = { id: node._id, level: 4, heading: options.word ? 'Component' : heading || 'Component', bodyParagraphs: [] };
      if (options.word) {
        emptyBlock.fields = wordFields.structuralFields(node, options);
        emptyBlock.wordCount = 0;
      }
      blocks.push(emptyBlock);
      return next();
    }
    function withSchema(schema, displayName) {
      var fields = options.word ? wordFields.componentFields(schema, node, options) : wordcount.walkTranslatableFields(schema, node);
      var block = {
        id: node._id,
        level: 4,
        heading: options.reviewLayout ? displayName || node._component.replace(/^./, function(letter) {
          return letter.toUpperCase();
        }) : heading,
        bodyParagraphs: fields.map(function (f) { return f.text; })
      };
      if (options.word) {
        block.fields = fields;
        block.wordCount = wordcount.countNodeWords(node, schema);
      }
      blocks.push(block);
      next();
    }
    if (schemaCache[node._component]) {
      return withSchema(schemaCache[node._component].schema, schemaCache[node._component].displayName);
    }
    wordcount.resolveComponentSchema(node._component, db, function (err, schema, displayName) {
      if (err) {
        return next(err);
      }
      schemaCache[node._component] = { schema: schema, displayName: displayName };
      withSchema(schema, displayName);
    });
  }

  var LEVEL_NUMBERS = { page: 1, article: 2, block: 3 };

  function walkStructural(node, type, position, next) {
    var block = { id: node._id, level: LEVEL_NUMBERS[type],
      heading: options.reviewLayout && type === 'page' ? (options.sectionLabel || 'Section') + ' ' + position :
        LEVEL_LABELS[type] + ' ' + position + (options.word && node.title ? ': ' + node.title : ''),
      bodyParagraphs: [] };
    if (options.word) block.fields = wordFields.structuralFields(node);
    blocks.push(block);
    async.eachOfSeries(node.children || [], function (child, index, childNext) {
      var childPosition = position + '.' + (index + 1);
      if (type === 'block') {
        return walkComponent(child, childPosition, childNext);
      }
      var childType = type === 'page' ? 'article' : 'block';
      walkStructural(child, childType, childPosition, childNext);
    }, next);
  }

  async.eachOfSeries((contentTree && contentTree.children) || [], function (page, index, next) {
    walkStructural(page, 'page', String(index + 1), next);
  }, function (err) {
    callback(err, blocks);
  });
}

function markdownComment(id) {
  return '<!-- lcid:' + id + ' -->';
}

/**
 * Flattens glossaryItems/resourceItems/helpContent into the single ordered list of "item blocks"
 * generateMarkdown()/generateDocx() each render as their own Glossary/Resources/Help sections -
 * same order (glossary, then resources, then the help popup, then help items) both generators
 * already use. Exposed so the Phase 6 document-import validator can build the exact same
 * "expected block IDs, in order" list the export produced, without a second hand-maintained copy
 * of this ordering ever drifting out of sync with it.
 *
 * @param {object} data - { glossaryItems, resourceItems, helpContent }
 * @return {Array<{id: string, heading: string, body: string}>}
 */
function collectFixedItemBlocks(data) {
  var blocks = [];
  (data.glossaryItems || []).forEach(function (item) {
    blocks.push({ id: item._id, heading: item.term, body: item.description || '' });
  });
  (data.resourceItems || []).forEach(function (item) {
    blocks.push({ id: item._id, heading: item.title, body: item.description || '' });
  });
  if (data.helpContent) {
    if (data.helpContent.popup && data.helpContent.popup.title) {
      blocks.push({ id: 'help-popup', heading: data.helpContent.popup.title, body: data.helpContent.popup.body || '' });
    }
    (data.helpContent.items || []).forEach(function (item) {
      blocks.push({ id: item._id, heading: item.title, body: item.body || '' });
    });
  }
  return blocks;
}

/**
 * @param {object} data - { contentTree, headerData, glossaryItems, resourceItems, helpContent,
 *   title, versionNumber, isDraft }
 * @param {object} db
 * @param {function} callback - function(error, markdownString)
 */
function generateMarkdown(data, db, callback) {
  collectDocumentBlocks(data.contentTree, db, function (err, blocks) {
    if (err) {
      return callback(err);
    }
    var lines = [];
    lines.push('# ' + (data.title || 'Untitled light course'));
    lines.push('');
    lines.push('**Version:** ' + (data.isDraft ? 'Draft (unpublished)' : (data.versionNumber || '')));
    if (data.headerData && data.headerData.reviewingInstructions) {
      lines.push('');
      lines.push('**Instructions for reviewing this document:** ' + data.headerData.reviewingInstructions);
    }
    lines.push('');

    blocks.forEach(function (block) {
      lines.push(markdownComment(block.id));
      lines.push(repeatString('#', block.level) + ' ' + block.heading);
      lines.push('');
      block.bodyParagraphs.forEach(function (paragraph) {
        lines.push(paragraph);
        lines.push('');
      });
    });

    if ((data.glossaryItems || []).length) {
      lines.push('## Glossary');
      lines.push('');
      data.glossaryItems.forEach(function (item) {
        lines.push(markdownComment(item._id));
        lines.push('##### ' + item.term);
        lines.push('');
        lines.push(item.description || '');
        lines.push('');
      });
    }

    if ((data.resourceItems || []).length) {
      lines.push('## Resources');
      lines.push('');
      data.resourceItems.forEach(function (item) {
        lines.push(markdownComment(item._id));
        lines.push('##### ' + item.title);
        lines.push('');
        lines.push(item.description || '');
        lines.push('');
      });
    }

    if (data.helpContent && ((data.helpContent.items || []).length || (data.helpContent.popup && data.helpContent.popup.title))) {
      lines.push('## Help');
      lines.push('');
      if (data.helpContent.popup && data.helpContent.popup.title) {
        lines.push(markdownComment('help-popup'));
        lines.push('##### ' + data.helpContent.popup.title);
        lines.push('');
        lines.push(data.helpContent.popup.body || '');
        if (data.helpContent.popup.instruction) {
          lines.push('');
          lines.push(data.helpContent.popup.instruction);
        }
        lines.push('');
      }
      (data.helpContent.items || []).forEach(function (item) {
        lines.push(markdownComment(item._id));
        lines.push('##### ' + item.title);
        lines.push('');
        lines.push(item.body || '');
        lines.push('');
      });
    }

    callback(null, lines.join('\n'));
  });
}

function repeatString(str, count) {
  var out = '';
  for (var i = 0; i < count; i++) {
    out += str;
  }
  return out;
}

/**
 * @param {object} data - same shape as generateMarkdown
 * @param {object} db
 * @param {function} callback - function(error, Buffer)
 */
function generateDocx(data, db, callback) {
  collectDocumentBlocks(data.contentTree, db, function (err, blocks) {
    if (err) {
      return callback(err);
    }
    wordDocument.generate(data, blocks, callback);
  }, { word: true, reviewLayout: true, sectionLabel: data.headerData && data.headerData.terminology && data.headerData.terminology.section });
}

/**
 * Parses a Markdown document previously produced by generateMarkdown() back into its ordered
 * `<!-- lcid:ID -->`-keyed blocks, for round-trip/import validation. Per the main plan's "reject,
 * don't guess" rule: a heading with no immediately-preceding ID comment, or a duplicated ID, is
 * reported as a structural error rather than silently assigning/reusing an ID. Full re-import
 * business logic (replacing a draft, creating the next version) is Phase 6's concern - this only
 * extracts the structure/IDs/text so that logic has something reliable to validate against.
 *
 * @param {string} markdownText
 * @return {{ blocks: Array<{id: string, level: number, heading: string, body: string}>, errors: Array<string> }}
 */
function parseMarkdown(markdownText) {
  var lines = (markdownText || '').split('\n');
  var blocks = [];
  var errors = [];
  var seenIds = {};
  var pendingId = null;
  var currentBlock = null;
  var FURNITURE_HEADINGS = ['Glossary', 'Resources', 'Help'];

  lines.forEach(function (line, index) {
    var commentMatch = line.match(/^<!--\s*lcid:(\S+)\s*-->$/);
    if (commentMatch) {
      if (pendingId) {
        errors.push('Line ' + (index + 1) + ': found a new lcid comment before the previous one ("' + pendingId + '") was followed by a heading');
      }
      pendingId = commentMatch[1];
      return;
    }
    var headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      // The document title (first line) and the fixed "Glossary"/"Resources"/"Help" section
      // dividers are document furniture generateMarkdown() always emits without an lcid comment -
      // not an error, but still a heading boundary (so content after them never gets wrongly
      // appended to whatever content block came before).
      var isFurniture = index === 0 || (headingMatch[1].length === 2 && FURNITURE_HEADINGS.indexOf(headingMatch[2]) !== -1);
      if (!pendingId && !isFurniture) {
        errors.push('Line ' + (index + 1) + ': heading "' + headingMatch[2] + '" has no preceding lcid comment - structure cannot be matched to the original course, re-add it rather than guessing');
      } else if (pendingId && seenIds[pendingId]) {
        errors.push('Line ' + (index + 1) + ': duplicate lcid "' + pendingId + '"');
      } else if (pendingId) {
        seenIds[pendingId] = true;
        currentBlock = { id: pendingId, level: headingMatch[1].length, heading: headingMatch[2], body: '' };
        blocks.push(currentBlock);
      } else {
        currentBlock = null; // furniture heading - not tracked as a content block
      }
      pendingId = null;
      return;
    }
    if (currentBlock && line.trim()) {
      currentBlock.body = currentBlock.body ? (currentBlock.body + '\n' + line) : line;
    }
  });

  return { blocks: blocks, errors: errors };
}

var DOCX_FURNITURE_HEADINGS = ['Glossary', 'Resources', 'Help'];
var DOCX_STYLE_LEVELS = { Heading1: 1, Heading2: 2, Heading3: 3, Heading4: 4, Heading5: 5 };

/**
 * Finds the first child element of `nodes` (a fast-xml-parser `preserveOrder` array) with the
 * given tag name - a direct-child lookup, not recursive (OOXML elements like `w:bookmarkStart`
 * are always direct siblings of `w:r` within their parent `w:p`, never nested inside a run).
 */
function findXmlChild(nodes, tagName) {
  return (nodes || []).find(function (node) {
    return Object.prototype.hasOwnProperty.call(node, tagName);
  });
}

/**
 * Recursively concatenates every `#text` leaf under `nodes`, in document order - reconstructs a
 * paragraph's full text across however many runs/bookmarks it's split into, without needing to
 * know the exact run/bookmark nesting shape up front.
 */
function extractXmlText(nodes) {
  var text = '';
  (nodes || []).forEach(function (node) {
    Object.keys(node).forEach(function (key) {
      if (key === ':@') {
        return;
      }
      if (key === '#text') {
        text += node['#text'];
        return;
      }
      text += extractXmlText(node[key]);
    });
  });
  return text;
}

function getXmlAttr(node, attrName) {
  return node && node[':@'] && node[':@'][attrName];
}

function getParagraphStyle(paragraphChildren) {
  var pPr = findXmlChild(paragraphChildren, 'w:pPr');
  if (!pPr) {
    return null;
  }
  var pStyle = findXmlChild(pPr['w:pPr'], 'w:pStyle');
  return pStyle && getXmlAttr(pStyle, '@_w:val');
}

function getBookmarkId(paragraphChildren) {
  var bookmark = findXmlChild(paragraphChildren, 'w:bookmarkStart');
  var name = bookmark && getXmlAttr(bookmark, '@_w:name');
  return name ? name.replace(/^lcid_/, '') : null;
}

/**
 * Parses a `.docx` document previously produced by generateDocx() back into the same
 * `{ blocks, errors }` shape parseMarkdown() returns, so Phase 6's import logic can validate
 * either format identically. Reads the raw OOXML (`word/document.xml`) rather than converting to
 * an intermediate text format first, so the named bookmarks (`lcid_<id>`) - invisible in any
 * text-extraction view - remain available to key each block.
 *
 * @param {Buffer} docxBuffer
 * @param {function} callback - function(error, { blocks, errors })
 */
function parseDocx(docxBuffer, callback) {
  wordDocument.parse(docxBuffer, function(error, parsed) {
    if (error || parsed) return callback(error, parsed);
    parseLegacyDocx(docxBuffer, callback);
  });
}

function parseLegacyDocx(docxBuffer, callback) {
  unzipper.Open.buffer(docxBuffer).then(function (directory) {
    var entry = directory.files.find(function (file) { return file.path === 'word/document.xml'; });
    if (!entry) {
      return callback(null, { blocks: [], errors: ['Not a valid .docx file (missing word/document.xml)'] });
    }
    return entry.buffer().then(function (xmlBuffer) {
      var parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
      var parsed;
      try {
        parsed = parser.parse(xmlBuffer.toString('utf8'));
      } catch (parseError) {
        return callback(null, { blocks: [], errors: ['Could not parse word/document.xml: ' + parseError.message] });
      }
      var documentNode = findXmlChild(parsed, 'w:document');
      var bodyNode = documentNode && findXmlChild(documentNode['w:document'], 'w:body');
      var paragraphs = (bodyNode && bodyNode['w:body'] || []).filter(function (node) {
        return Object.prototype.hasOwnProperty.call(node, 'w:p');
      });

      var blocks = [];
      var errors = [];
      var seenIds = {};
      var currentBlock = null;

      paragraphs.forEach(function (paragraphNode, index) {
        var children = paragraphNode['w:p'];
        var style = getParagraphStyle(children);
        var text = extractXmlText(children).trim();
        var bookmarkId = getBookmarkId(children);

        if (style === 'Title') {
          currentBlock = null; // document title - furniture, no lcid expected
          return;
        }
        var level = DOCX_STYLE_LEVELS[style];
        if (!level) {
          if (currentBlock && text) {
            currentBlock.body = currentBlock.body ? (currentBlock.body + '\n' + text) : text;
          }
          return;
        }
        var isFurniture = level === 2 && !bookmarkId && DOCX_FURNITURE_HEADINGS.indexOf(text) !== -1;
        if (isFurniture) {
          currentBlock = null;
          return;
        }
        if (!bookmarkId) {
          errors.push('Paragraph ' + (index + 1) + ': heading "' + text + '" has no lcid bookmark - structure cannot be matched to the original course, re-add it rather than guessing');
          currentBlock = null;
          return;
        }
        if (seenIds[bookmarkId]) {
          errors.push('Paragraph ' + (index + 1) + ': duplicate lcid "' + bookmarkId + '"');
          currentBlock = null;
          return;
        }
        seenIds[bookmarkId] = true;
        currentBlock = { id: bookmarkId, level: level, heading: text, body: '' };
        blocks.push(currentBlock);
      });

      callback(null, { blocks: blocks, errors: errors });
    });
  }).catch(function (err) {
    callback(null, { blocks: [], errors: ['Could not read .docx file: ' + err.message] });
  });
}

module.exports = {
  collectDocumentBlocks: collectDocumentBlocks,
  collectFixedItemBlocks: collectFixedItemBlocks,
  generateMarkdown: generateMarkdown,
  generateDocx: generateDocx,
  parseMarkdown: parseMarkdown,
  parseDocx: parseDocx
};
