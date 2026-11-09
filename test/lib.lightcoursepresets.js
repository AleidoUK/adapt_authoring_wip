var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var createRequire = require('module').createRequire;
var _ = require('underscore');
var ROOT = path.join(__dirname, '..');

function load(relativePath, mocks, globals) {
  var filename = path.join(ROOT, relativePath);
  var module = { exports: {} };
  var nativeRequire = createRequire(filename);
  function resolve(name) {
    return Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : nativeRequire(name);
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), Object.assign({
    module: module, exports: module.exports, require: resolve, _: _,
    console: console, setTimeout: setTimeout,
    define: function(deps, factory) {
      module.exports = factory ? factory.apply(null, deps.map(resolve)) : deps(resolve);
    }
  }, globals), { filename: filename });
  return module.exports;
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }
var Backbone = load('frontend/src/libraries/backbone.js', { underscore: _ });

function Element() { this.children = []; this.value = ''; this.handlers = {}; this.attributes = {}; }
Element.prototype.empty = function() { this.children = []; return this; };
Element.prototype.append = function(child) { this.children.push(child); return this; };
Element.prototype.attr = function(key, value) {
  if (value === undefined) return this.attributes[key];
  this.attributes[key] = value;
  if (key === 'value') this.value = value;
  return this;
};
Element.prototype.prop = function() { return this; };
Element.prototype.text = function(value) { this.label = value; return this; };
Element.prototype.html = function(value) { this.content = value; return this; };
Element.prototype.toggleClass = function(name, enabled) { this.hidden = enabled; return this; };
Element.prototype.remove = function() { this.removed = true; return this; };
Element.prototype.val = function(value) { if (value === undefined) return this.value; this.value = value; return this; };
Element.prototype.on = function(event, handler) { this.handlers[event] = handler; return this; };
Element.prototype.addClass = Element.prototype.removeClass = Element.prototype.trigger =
  Element.prototype.filter = Element.prototype.first = function() { return this; };

function treeHarness() {
  var requests = [];
  var alerts = [];
  var containers = {};
  var events = [];
  var confirmations = [];
  var renderedContexts = [];
  function $(selector) { return selector instanceof Element ? selector : new Element(); }
  $.get = function() {
    var request = {};
    requests.push(request);
    return {
      done: function(callback) { request.done = callback; return this; },
      fail: function(callback) { request.fail = callback; return this; }
    };
  };
  var origin = {
    trigger: function(name) { events.push(name); }, l10n: { t: function(key) { return key; } },
    Notify: { alert: function(alert) { alerts.push(alert); }, confirm: function(options) { confirmations.push(options); } }
  };
  var proto = load('frontend/src/modules/lightCourseEditor/views/lightCourseTreeView.js', {
    'core/origin': origin,
    'core/views/originView': { extend: function(proto) { return proto; } },
    './lightCourseComponentFormView': {},
    './lightCourseCommentsView': {},
    '../wordCount': { countComponentWords: function() { return 0; } },
    '../fieldPreview': function() { return []; }
  }, { $: $, Backbone: Backbone, Handlebars: { templates: {
    lightCourseTreeRootNodes: function(context) { renderedContexts.push(copy(context)); return '<tree>'; }
  } } });
  var node = { _id: 'component', type: 'component', _component: 'text', body: 'Original' };
  var tree = Object.assign(Object.create(proto), {
    openComponentNodeId: node._id, componentTypes: [{ component: 'text' }, { component: 'graphic' }],
    tree: { children: [node] },
    $: function(selector) { return containers[selector] || (containers[selector] = new Element()); },
    renderTree: function() {},
    renderComponentForm: function(node) { this.rendered = copy(node); }
  });
  return { tree: tree, node: node, containers: containers, requests: requests, alerts: alerts,
    events: events, renderedContexts: renderedContexts, confirmations: confirmations, origin: origin };
}

var PRESET = { _id: 'text-default', name: 'Text default', isDefault: true, values: { body: 'Default body', items: [{ title: 'Item' }] } };
var PRESET_PICKER = '.light-course-tree-component-editor-preset-picker';

describe('component comment status indicators (isolated)', function() {
  it('ignores deleted comments and hides indicators outside course comment-enabled trees', function() {
    var h = treeHarness();
    h.tree.enableComments = true;
    assert.strictEqual(h.tree.buildNodeMeta([h.node]).component.hasComments, false);
    h.node._comments = [{ _id: 'deleted', parentId: null, deleted: true, resolved: false }];
    assert.strictEqual(h.tree.buildNodeMeta([h.node]).component.hasComments, false);
    h.node._comments.push({ _id: 'active', parentId: null, resolved: false });
    assert.strictEqual(h.tree.buildNodeMeta([h.node]).component.hasComments, true);
    h.tree.enableComments = false;
    assert.strictEqual(h.tree.buildNodeMeta([h.node]).component.hasComments, false);
  });
  it('tracks root thread status rather than counting unresolved reply flags', function() {
    var h = treeHarness();
    h.tree.enableComments = true;
    h.node._comments = [
      { _id: 'root', parentId: null, resolved: true },
      { _id: 'reply', parentId: 'root', resolved: false }
    ];
    assert.strictEqual(h.tree.buildNodeMeta([h.node]).component.allCommentsResolved, true);
    h.node._comments.push({ _id: 'open-root', parentId: null, resolved: false });
    assert.strictEqual(h.tree.buildNodeMeta([h.node]).component.allCommentsResolved, false);
    h.node._comments[2].deleted = true;
    assert.strictEqual(h.tree.buildNodeMeta([h.node]).component.allCommentsResolved, true);
    h.node._comments[0].resolved = false;
    assert.strictEqual(h.tree.buildNodeMeta([h.node]).component.allCommentsResolved, false);
  });
});

describe('new light course pages (isolated)', function() {
  it('creates exactly one article containing one empty block and saves the full structure once', function() {
    var h = treeHarness();
    h.tree.tree = { children: [] };
    var renders = 0;
    h.tree.renderTree = function() { renders++; };
    h.tree.onAddPageClicked();
    var pages = h.tree.getContentTree().children;
    assert.strictEqual(pages.length, 1);
    assert.strictEqual(pages[0].type, 'page');
    assert.strictEqual(pages[0].children.length, 1);
    var article = pages[0].children[0];
    assert.strictEqual(article.type, 'article');
    assert.strictEqual(article.children.length, 1);
    var block = article.children[0];
    assert.strictEqual(block.type, 'block');
    assert.strictEqual(block.children.length, 0);
    var ids = [pages[0]._id, article._id, block._id];
    assert(ids.every(function(id) { return typeof id === 'string' && id.length > 0; }));
    assert.strictEqual(new Set(ids).size, 3);
    assert.strictEqual(renders, 1);
    assert.deepStrictEqual(h.events, ['lightCourseEditor:autosave']);
  });

  it('appends independent page structures without changing existing pages', function() {
    var h = treeHarness();
    var existing = { _id: 'existing-page', type: 'page', children: [] };
    h.tree.tree = { children: [existing] };
    h.tree.onAddPageClicked();
    h.tree.onAddPageClicked();
    var pages = h.tree.getContentTree().children;
    assert.strictEqual(pages.length, 3);
    assert.strictEqual(pages[0], existing);
    assert.strictEqual(existing.children.length, 0);
    var ids = pages.slice(1).reduce(function(out, page) {
      return out.concat(page._id, page.children[0]._id, page.children[0].children[0]._id);
    }, []);
    assert.strictEqual(new Set(ids).size, 6);
    pages[1].children[0].children[0].title = 'Changed';
    assert.strictEqual(pages[2].children[0].children[0].title, undefined);
    var Model = load('frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js', { backbone: Backbone });
    var serialized = new Model({ contentTree: h.tree.getContentTree() }).toJSON();
    var restored = new Model(serialized, { parse: true });
    assert.deepStrictEqual(copy(restored.get('contentTree')), copy(h.tree.getContentTree()));
  });
});

describe('editing light course page titles (isolated)', function() {
  function setup(title) {
    var h = treeHarness();
    h.page = { _id: 'page', type: 'page', title: title, children: [] };
    h.tree.tree = { children: [h.page] };
    h.tree.getNodeIdFromEvent = function() { return h.page._id; };
    h.input = new Element();
    h.input.closest = function() { assert.fail('Do not replace the heading containing the title input'); };
    return h;
  }

  it('saves page titles in the heading field without rebuilding or replacing the active input', function() {
    var h = setup();
    var renders = 0;
    h.tree.renderTree = function() { renders++; };
    h.tree.clipboardNode = { type: 'page' };
    h.input.val('  My page <title>  ');
    h.tree.onPageTitleChanged({ currentTarget: h.input });
    assert.strictEqual(h.page.title, 'My page <title>');
    assert.strictEqual(h.input.val(), 'My page <title>');
    assert.strictEqual(h.tree.clipboardNode, null);
    assert.strictEqual(renders, 0);
    assert.deepStrictEqual(h.events, ['lightCourseEditor:autosave']);
    var Model = load('frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js', { backbone: Backbone });
    var serialized = new Model({ contentTree: h.tree.getContentTree() }).toJSON();
    assert.strictEqual(new Model(serialized, { parse: true }).get('contentTree').children[0].title, h.page.title);
  });

  it('clears a title without replacing the field, allowing its default placeholder to show', function() {
    var h = setup('Old title');
    h.input.val(' ');
    h.tree.onPageTitleChanged({ currentTarget: h.input });
    assert.strictEqual(h.page.title, '');
    assert.strictEqual(h.input.val(), '');
    assert.strictEqual(h.events.length, 1);
  });

  it('does not autosave an unchanged title', function() {
    var h = setup('My page');
    h.input.val('My page');
    h.tree.onPageTitleChanged({ currentTarget: h.input });
    assert.strictEqual(h.events.length, 0);
  });
});

describe('copying and pasting light course pages, blocks and components (isolated)', function() {
  function setup() {
    var h = treeHarness();
    h.node._componentPresetId = PRESET._id;
    h.node.uniqueId = 'c-01';
    h.node.instruction = '<p>Instructions</p>';
    h.node.items = [{ title: 'Item', graphic: { src: 'asset.png' } }];
    h.node._componentSchemaSnapshot = { title: { type: 'string' } };
    h.block = { _id: 'block', type: 'block', title: 'Block', children: [h.node] };
    h.article = { _id: 'article', type: 'article', children: [h.block,
      { _id: 'next-block', type: 'block', children: [] }] };
    h.destination = { _id: 'destination-article', type: 'article', children: [
      { _id: 'destination-block', type: 'block', children: [] }
    ] };
    h.tree.tree = { children: [{ _id: 'page', type: 'page', children: [h.article, h.destination] }] };
    h.tree.getNodeIdFromEvent = function(event) { return event.nodeId; };
    return h;
  }

  function copyNode(h, id) {
    h.tree.onCopyClicked({ nodeId: id, preventDefault: function() {} });
  }

  function pasteNode(h, id) {
    h.tree.onPasteClicked({ nodeId: id, preventDefault: function() {} });
  }

  it('copies without saving, then pastes a block into another article with all values and fresh descendant IDs', function() {
    var h = setup();
    h.block.children.push({ _id: 'second-component', type: 'component', _component: 'graphic', body: 'Second' });
    var original = copy(h.block);
    copyNode(h, h.block._id);
    assert.strictEqual(h.events.length, 0);
    assert.strictEqual(h.article.children.length, 2);
    pasteNode(h, h.destination._id);
    var cloned = h.destination.children[1];
    assert.strictEqual(h.article.children[0], h.block);
    assert.strictEqual(h.article.children[1]._id, 'next-block');
    assert.strictEqual(h.destination.children[0]._id, 'destination-block');
    assert.notStrictEqual(cloned._id, h.block._id);
    cloned.children.forEach(function(node, index) {
      assert.notStrictEqual(node._id, h.block.children[index]._id);
    });
    var values = copy(cloned);
    values._id = original._id;
    values.children.forEach(function(node, index) { node._id = original.children[index]._id; });
    original.children[0]._layout = 'left';
    original.children[1]._layout = 'right';
    assert.deepStrictEqual(values, original);
    cloned.children[0].items[0].graphic.src = 'changed.png';
    cloned.children[0]._componentSchemaSnapshot.title.type = 'number';
    assert.strictEqual(h.node.items[0].graphic.src, 'asset.png');
    assert.strictEqual(h.node._componentSchemaSnapshot.title.type, 'string');
    assert.deepStrictEqual(h.events, ['lightCourseEditor:autosave']);
    assert.strictEqual(h.tree.clipboardNode, null);
  });

  it('pastes a component into another block without sharing nested values', function() {
    var h = setup();
    copyNode(h, h.node._id);
    pasteNode(h, 'destination-block');
    var target = h.destination.children[0];
    var cloned = target.children[0];
    assert.strictEqual(h.block.children[0], h.node);
    assert.strictEqual(h.block.children.length, 1);
    assert.notStrictEqual(cloned._id, h.node._id);
    assert.strictEqual(cloned._componentPresetId, PRESET._id);
    assert.strictEqual(cloned.uniqueId, 'c-01');
    cloned.items[0].title = 'Changed';
    assert.strictEqual(h.node.items[0].title, 'Item');
    assert.strictEqual(h.tree.getContentTree().children[0].children[1].children[0].children.length, 1);
    assert.strictEqual(h.events.length, 1);
    assert.strictEqual(h.tree.clipboardNode, null);
  });

  it('does not duplicate component discussions on copy and paste', function() {
    var h = setup();
    h.node._comments = [{ _id: 'discussion', text: 'Keep only on source' }];
    copyNode(h, h.node._id);
    pasteNode(h, 'destination-block');
    assert.strictEqual(h.destination.children[0].children[0]._comments, undefined);
    assert.strictEqual(h.node._comments[0].text, 'Keep only on source');
  });

  it('warns and makes no change when pasting into a full block', function() {
    var h = setup();
    h.block.children.push(Object.assign({}, copy(h.node), { _id: 'second-component' }));
    copyNode(h, h.node._id);
    var treeBefore = copy(h.tree.getContentTree());
    pasteNode(h, h.block._id);
    assert.deepStrictEqual(copy(h.tree.getContentTree()), treeBefore);
    assert.strictEqual(h.alerts.length, 1);
    assert.strictEqual(h.alerts[0].type, 'warning');
    assert.strictEqual(h.alerts[0].text, 'app.lightcoursemaxcomponents');
    assert.strictEqual(h.events.length, 0);
    assert.strictEqual(h.tree.clipboardNode._id, h.node._id);
  });

  it('consumes the copy after a paste and generates fresh IDs when copied again', function() {
    var h = setup();
    copyNode(h, h.block._id);
    pasteNode(h, h.destination._id);
    pasteNode(h, h.destination._id);
    assert.strictEqual(h.destination.children.length, 2);
    copyNode(h, h.block._id);
    pasteNode(h, h.destination._id);
    var nodes = [h.block].concat(h.destination.children.slice(1));
    assert.strictEqual(new Set(nodes.map(function(node) { return node._id; })).size, 3);
    assert.strictEqual(new Set(nodes.map(function(node) { return node.children[0]._id; })).size, 3);
    var Model = load('frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js', { backbone: Backbone });
    var saved = new Model({ contentTree: h.tree.getContentTree() }).toJSON();
    var restored = new Model(saved, { parse: true });
    assert.deepStrictEqual(copy(restored.get('contentTree')), copy(h.tree.getContentTree()));
  });

  it('does not copy articles or paste into the wrong node type', function() {
    var h = setup();
    pasteNode(h, h.destination._id);
    copyNode(h, 'article');
    assert.strictEqual(h.tree.clipboardNode, undefined);
    copyNode(h, 'page');
    pasteNode(h, 'destination-block');
    copyNode(h, h.node._id);
    pasteNode(h, h.destination._id);
    pasteNode(h, 'page');
    copyNode(h, h.block._id);
    pasteNode(h, 'destination-block');
    assert.strictEqual(h.tree.tree.children.length, 1);
    assert.strictEqual(h.article.children.length, 2);
    assert.strictEqual(h.destination.children.length, 1);
    assert.strictEqual(h.destination.children[0].children.length, 0);
    assert.strictEqual(h.events.length, 0);
  });

  it('uses the snapshot from Copy even after the original changes or is removed', function() {
    var h = setup();
    copyNode(h, h.node._id);
    h.node.body = 'Later edits';
    h.node.items[0].title = 'Later item';
    h.block.children = [];
    pasteNode(h, 'destination-block');
    var pasted = h.destination.children[0].children[0];
    assert.strictEqual(pasted.body, 'Original');
    assert.strictEqual(pasted.items[0].title, 'Item');
    assert.strictEqual(h.tree.clipboardNode, null);
  });

  ['', 'page', 'second-page'].forEach(function(afterNodeId, insertionIndex) {
    it('pastes a complete page into gap ' + insertionIndex + ' with fresh IDs and consumes the copy', function() {
      var h = setup();
      h.tree.tree.children.push({ _id: 'second-page', type: 'page', children: [] });
      h.tree.tree.children[0].title = 'Original page title';
      var original = copy(h.tree.tree.children[0]);
      copyNode(h, 'page');
      var target = new Element().attr('data-after-node-id', afterNodeId);
      h.tree.onPastePageClicked({ currentTarget: target, preventDefault: function() {} });
      assert.strictEqual(h.tree.tree.children.length, 3);
      var pasted = h.tree.tree.children[insertionIndex];
      assert.strictEqual(pasted.title, 'Original page title');
      function collectIds(node) {
        return [node._id].concat((node.children || []).reduce(function(ids, child) {
          return ids.concat(collectIds(child));
        }, []));
      }
      var originalIds = collectIds(original);
      var pastedIds = collectIds(pasted);
      assert.strictEqual(pastedIds.length, originalIds.length);
      assert.strictEqual(new Set(pastedIds).size, pastedIds.length);
      assert(pastedIds.every(function(id) { return originalIds.indexOf(id) === -1; }));
      assert.deepStrictEqual(h.tree.tree.children.filter(function(node) { return node !== pasted; })
        .map(function(node) { return node._id; }), ['page', 'second-page']);
      pasted.children[0].children[0].children[0].items[0].title = 'Edited copy';
      assert.strictEqual(h.node.items[0].title, 'Item');
      assert.strictEqual(h.tree.clipboardNode, null);
      assert.deepStrictEqual(h.events, ['lightCourseEditor:autosave']);
    });
  });

  it('does not insert a page after an invalid or nested page anchor', function() {
    var h = setup();
    copyNode(h, 'page');
    ['missing', 'block'].forEach(function(id) {
      h.tree.onPastePageClicked({
        currentTarget: new Element().attr('data-after-node-id', id), preventDefault: function() {}
      });
    });
    assert.strictEqual(h.tree.tree.children.length, 1);
    assert.strictEqual(h.events.length, 0);
    assert.strictEqual(h.tree.clipboardNode.type, 'page');
  });

  it('clears copying when adding, moving, or opening a component editor', function() {
    var h = setup();
    copyNode(h, h.node._id);
    h.tree.onAddPageClicked();
    assert.strictEqual(h.tree.clipboardNode, null);
    copyNode(h, h.node._id);
    h.tree.onAddChildClicked({ nodeId: 'article', preventDefault: function() {} });
    assert.strictEqual(h.tree.clipboardNode, null);
    copyNode(h, h.node._id);
    h.tree.moveNode('next-block', -1);
    assert.strictEqual(h.tree.clipboardNode, null);
    copyNode(h, h.node._id);
    h.tree.openComponentEditor(h.node._id);
    assert.strictEqual(h.tree.clipboardNode, null);
  });

  it('clears copying for other UI actions but not Copy, Paste, or plain content clicks', function() {
    var h = setup();
    copyNode(h, 'page');
    function action(isControl, isCopyAction) {
      var target = new Element();
      target.closest = function(selector) {
        return { length: selector.indexOf('button, a') === 0 ? Number(isControl) : Number(isCopyAction) };
      };
      h.tree.onOtherActionSelected({ target: target });
    }
    action(false, false);
    assert.strictEqual(h.tree.clipboardNode.type, 'page');
    action(true, true);
    assert.strictEqual(h.tree.clipboardNode.type, 'page');
    action(true, false);
    assert.strictEqual(h.tree.clipboardNode, null);
    assert.strictEqual(h.events.length, 0);
  });

  it('cancels copying without saving or allowing another paste', function() {
    var h = setup();
    copyNode(h, h.node._id);
    h.tree.onCancelCopyClicked();
    assert.strictEqual(h.tree.clipboardNode, null);
    pasteNode(h, 'destination-block');
    assert.strictEqual(h.destination.children[0].children.length, 0);
    assert.strictEqual(h.events.length, 0);
  });

  it('shows the copied type and cancel control, then hides them when copying is cancelled', function() {
    var h = setup();
    delete h.tree.renderTree;
    copyNode(h, h.node._id);
    assert.strictEqual(h.renderedContexts[0].clipboardType, 'component');
    assert.strictEqual(h.containers['.light-course-tree-copy-status'].hidden, false);
    assert.strictEqual(h.containers['.light-course-tree-copy-status-label'].label, 'app.lightcoursecomponentcopied');
    copyNode(h, h.block._id);
    assert.strictEqual(h.renderedContexts[1].clipboardType, 'block');
    assert.strictEqual(h.containers['.light-course-tree-copy-status-label'].label, 'app.lightcourseblockcopied');
    h.tree.onCancelCopyClicked();
    assert.strictEqual(h.tree.clipboardNode, null);
    assert.strictEqual(h.renderedContexts.length, 2);
    assert.strictEqual(h.containers['.light-course-tree-paste'].removed, true);
    assert.strictEqual(h.containers['.light-course-tree-page-paste-zone'].removed, true);
    assert.strictEqual(h.containers['.light-course-tree-copy-status'].hidden, true);
    assert.strictEqual(h.containers['.light-course-tree-copy-status-label'].label, '');
  });
});

describe('component editor overlay drafts (isolated)', function() {
  function open(h) {
    h.tree.openComponentNodeId = null;
    h.tree.openComponentEditor(h.node._id);
    return h.tree.openComponentDraft;
  }

  it('saves discussions with the component and discards them on Cancel', function() {
    var h = treeHarness(), draft = open(h);
    draft._comments = [{ _id: 'comment', text: 'New discussion' }];
    assert.strictEqual(h.tree.getContentTree().children[0]._comments, undefined);
    h.tree.closeComponentEditor();
    assert.strictEqual(h.tree.getContentTree().children[0]._comments[0].text, 'New discussion');
    draft = open(h);
    draft._comments[0].text = 'Discarded edit';
    h.tree.closeComponentEditor(false);
    assert.strictEqual(h.tree.getContentTree().children[0]._comments[0].text, 'New discussion');
  });

  it('keeps an unfinished discussion composer open instead of discarding it on Save', function() {
    var h = treeHarness(), draft = open(h);
    h.tree.commentsView = { composerText: 'Not added yet', remove: function() { assert.fail('Composer should remain open'); } };
    assert.strictEqual(h.tree.closeComponentEditor(), false);
    assert.strictEqual(h.tree.openComponentDraft, draft);
    assert.strictEqual(h.alerts[0].text, 'app.lightcoursecommentunfinished');
    assert.strictEqual(h.events.length, 0);
  });

  it('keeps the component discussion when applying preset values', function() {
    var h = treeHarness(), draft = open(h);
    draft._comments = [{ _id: 'source', text: 'Original discussion' }];
    h.tree.applyPresetValues(draft, { _id: 'preset', values: {
      body: 'Preset body', _comments: [{ _id: 'copied', text: 'Not part of preset values' }]
    } });
    assert.strictEqual(draft._comments[0]._id, 'source');
    assert.strictEqual(draft.body, 'Preset body');
  });

  it('does not include open field or preset edits in background saves', function() {
    var h = treeHarness();
    var draft = open(h);
    h.tree.applyPresetValues(draft, PRESET);
    h.tree.componentFormView = { getFormData: function() { return { body: 'Edited field' }; } };
    h.tree.flushOpenComponentForm();
    assert.strictEqual(draft.body, 'Edited field');
    assert.strictEqual(h.tree.getContentTree().children[0].body, 'Original');
    assert.strictEqual(h.node._componentPresetId, undefined);
    assert.strictEqual(h.events.length, 0);
  });

  it('saves field values and preset selection together and autosaves once', function() {
    var h = treeHarness();
    var draft = open(h);
    h.tree.applyPresetValues(draft, PRESET);
    var removed = false;
    h.tree.componentFormView = {
      getFormData: function() { return { body: 'Author edits' }; },
      remove: function() { removed = true; }
    };
    h.tree.onCloseEditorClicked();
    var saved = h.tree.getContentTree().children[0];
    assert.strictEqual(saved.body, 'Author edits');
    assert.strictEqual(saved._componentPresetId, PRESET._id);
    assert.strictEqual(saved._id, h.node._id);
    assert.strictEqual(h.tree.openComponentDraft, null);
    assert.strictEqual(h.tree.openComponentNodeId, null);
    assert(removed);
    assert.deepStrictEqual(h.events, ['lightCourseEditor:autosave']);
  });

  it('cancels type, preset and nested edits without reading or saving the form', function() {
    var h = treeHarness();
    h.node.items = [{ title: 'Original item' }];
    h.node._componentPresetId = 'original-preset';
    var original = copy(h.node);
    var draft = open(h);
    draft._component = 'graphic';
    delete draft._componentPresetId;
    draft.items[0].title = 'Changed';
    var removed = false;
    h.tree.componentFormView = {
      getFormData: function() { throw new Error('Cancelled fields should not be read'); },
      remove: function() { removed = true; }
    };
    h.tree.onCancelEditorClicked();
    assert.deepStrictEqual(h.tree.getContentTree().children[0], original);
    assert.strictEqual(h.tree.openComponentDraft, null);
    assert(removed);
    assert.strictEqual(h.events.length, 0);
    h.requests[0].done([PRESET]);
    assert.strictEqual(h.containers[PRESET_PICKER].children.length, 0);
  });

  it('commits clearing a component type and preset even without a field form', function() {
    var h = treeHarness();
    h.node._componentPresetId = PRESET._id;
    var draft = open(h);
    draft._component = '';
    delete draft._componentPresetId;
    h.tree.closeComponentEditor();
    assert.strictEqual(h.tree.getContentTree().children[0]._component, '');
    assert.strictEqual(h.tree.getContentTree().children[0]._componentPresetId, undefined);
    assert.strictEqual(h.events.length, 1);
  });

  it('renders an accessible overlay with adjacent Cancel and Save and no visible component heading', function() {
    var Handlebars = require('handlebars').create();
    Handlebars.registerHelper('t', function(key) { return key; });
    var html = Handlebars.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseEditor/templates/lightCourseTree.hbs'), 'utf8'))({});
    assert(html.includes('role="dialog" aria-modal="true"'));
    assert(html.includes('aria-label="app.lightcoursecomponenteditor"'));
    assert(html.includes('light-course-tree-component-editor-cancel'));
    assert(html.includes('light-course-tree-component-editor-close'));
    assert(!html.includes('<h3>'));
  });
});

describe('light-course full and paired layouts (isolated)', function() {
  function setup(layouts) {
    var h = treeHarness();
    h.block = { _id: 'layout-block', type: 'block', children: layouts.map(function(layout, index) {
      return { _id: 'layout-' + index, type: 'component', _component: 'text', _layout: layout, body: 'Body ' + index };
    }) };
    h.tree.tree = { children: [h.block] };
    h.tree.getNodeIdFromEvent = function() { return h.block._id; };
    return h;
  }
  it('adds a full component to an empty block and confirms before splitting it into left and right', function() {
    var h = setup([]);
    h.tree.onAddChildClicked();
    assert.strictEqual(h.block.children[0]._layout, 'full');
    assert.strictEqual(h.events.length, 1);
    h.tree.onAddChildClicked();
    assert.strictEqual(h.block.children.length, 1);
    assert.strictEqual(h.confirmations.length, 1);
    h.confirmations[0].callback(false);
    assert.strictEqual(h.block.children[0]._layout, 'full');
    h.tree.onAddChildClicked();
    h.confirmations[1].callback(true);
    assert.deepStrictEqual(Array.from(h.block.children, function(node) { return node._layout; }), ['left', 'right']);
    assert.strictEqual(h.events.length, 2);
    h.tree.onAddChildClicked();
    assert.strictEqual(h.block.children.length, 2);
    assert.strictEqual(h.alerts[0].text, 'app.lightcoursemaxcomponents');
  });
  it('adds or pastes into the vacant half without changing the existing slot or sharing values', function() {
    var h = setup(['right']);
    h.tree.clipboardNode = { _id: 'source', type: 'component', _component: 'text', _layout: 'full', items: [{ body: 'Copied' }] };
    h.tree.onPasteClicked();
    assert.deepStrictEqual(Array.from(h.block.children, function(node) { return node._layout; }), ['left', 'right']);
    assert.notStrictEqual(h.block.children[0]._id, 'source');
    assert.strictEqual(h.tree.clipboardNode, null);
    assert.strictEqual(h.confirmations.length, 0);
    assert.strictEqual(h.events.length, 1);
  });
  it('rejects pairing full-width-only component types without altering the block', function() {
    var h = setup(['full']);
    h.origin.schemas = { get: function() { return { _supportedLayout: { enum: ['full-width'] } }; } };
    h.tree.onAddChildClicked();
    assert.strictEqual(h.block.children.length, 1);
    assert.strictEqual(h.block.children[0]._layout, 'full');
    assert.strictEqual(h.confirmations.length, 0);
    assert.strictEqual(h.events.length, 0);
    assert.strictEqual(h.alerts[0].text, 'app.lightcourselayoutunsupported');
  });
  it('saves side changes atomically by swapping the other half and ordering left before right', function() {
    var h = setup(['left', 'right']);
    h.tree.openComponentNodeId = h.block.children[0]._id;
    h.tree.openComponentDraft = copy(h.block.children[0]);
    h.tree.componentFormView = { getFormData: function() { return { _layout: 'right', body: 'Reviewed' }; }, remove: function() {} };
    h.tree.closeComponentEditor();
    assert.strictEqual(h.block.children[0]._id, 'layout-1');
    assert.strictEqual(h.block.children[0]._layout, 'left');
    assert.strictEqual(h.block.children[0].body, 'Body 1');
    assert.strictEqual(h.block.children[1]._id, 'layout-0');
    assert.strictEqual(h.block.children[1]._layout, 'right');
    assert.strictEqual(h.block.children[1].body, 'Reviewed');
    assert.strictEqual(h.events.length, 1);
  });
  it('rejects a full-width edit in a pair without closing the editor or partially saving', function() {
    var h = setup(['left', 'right']), before = copy(h.block);
    h.tree.openComponentNodeId = h.block.children[0]._id;
    h.tree.openComponentDraft = copy(h.block.children[0]);
    h.tree.componentFormView = { getFormData: function() { return { _layout: 'full', body: 'Do not save' }; } };
    assert.strictEqual(h.tree.closeComponentEditor(), false);
    assert.deepStrictEqual(h.block, before);
    assert.strictEqual(h.tree.openComponentNodeId, 'layout-0');
    assert.strictEqual(h.events.length, 0);
  });
  it('moves a pair between left and right slots without changing the component content', function() {
    var h = setup(['left', 'right']);
    h.tree.moveNode('layout-1', -1);
    assert.strictEqual(h.block.children[0]._id, 'layout-1');
    assert.strictEqual(h.block.children[0]._layout, 'left');
    assert.strictEqual(h.block.children[0].body, 'Body 1');
    assert.strictEqual(h.block.children[1]._layout, 'right');
  });
  it('applies preset content but explicitly warns when its full layout cannot replace a paired slot', function() {
    var h = setup(['left', 'right']);
    var draft = copy(h.block.children[0]);
    h.tree.applyPresetValues(draft, { _id: 'preset', values: { body: 'Preset body', _layout: 'full' } });
    assert.strictEqual(draft._layout, 'left');
    assert.strictEqual(draft.body, 'Preset body');
    assert.strictEqual(h.block.children[0].body, 'Body 0');
    assert.strictEqual(h.alerts[0].text, 'app.lightcoursepresetlayoutkept');
  });
});

describe('component default layout validation (isolated)', function() {
  function harness() {
    var writes = [];
    function ContentPlugin() {}
    ContentPlugin.prototype.create = function(data, next) { writes.push(data); next(null, data); };
    ContentPlugin.prototype.update = function(search, data, next) { writes.push(data); next(null, data); };
    var Plugin = load('plugins/content/lightcomponentdefault/index.js', {
      '../../../lib/contentmanager': { ContentPlugin: ContentPlugin },
      '../../../': {},
      '../../../lib/permissions': {},
      '../../../lib/lightcourse/permissionAction': {},
      '../../../lib/usermanager': {}
    });
    return { plugin: new Plugin(), writes: writes };
  }
  it('rejects invalid layout values on create/update before writing a preset', function() {
    var h = harness();
    ['wide', '', null].forEach(function(layout) {
      var callbacks = 0;
      function rejected(error) { assert(error); assert.match(error.message, /layout must be/); callbacks++; }
      h.plugin.create({ values: { _layout: layout } }, rejected);
      h.plugin.update({ _id: 'preset' }, { values: { _layout: layout } }, rejected);
      assert.strictEqual(callbacks, 2);
    });
    assert.strictEqual(h.writes.length, 0);
  });
  it('allows full, left, right and legacy presets without a stored layout', function() {
    var h = harness();
    ['full', 'left', 'right', undefined].forEach(function(layout) {
      var callbacks = 0;
      function saved(error) { assert.ifError(error); callbacks++; }
      h.plugin.create({ values: { _layout: layout } }, saved);
      h.plugin.update({ _id: 'preset' }, { values: { _layout: layout } }, saved);
      assert.strictEqual(callbacks, 2);
    });
    assert.strictEqual(h.writes.length, 8);
  });
});

describe('component popup field order (isolated)', function() {
  var rawSchema = {
    title: { type: 'string', title: 'Title', translatable: true },
    body: { type: 'string', title: 'Body', translatable: true },
    _extensions: { properties: { _uniqueId: { properties: {
      _id: { type: 'string', title: 'Unique ID' }
    } } } }
  };

  function render(schema, useSnapshot, allowedLayouts) {
    var options;
    function Form(formOptions) { options = formOptions; }
    Form.prototype.render = function() { return this; };
    Form.prototype.$ = function() { return new Element(); };
    Form.prototype.getValue = function() { return options.model.pick(options.fields); };
    var filter = load('frontend/src/modules/lightCourseEditor/schemaFilter.js', {});
    var proto = load('frontend/src/modules/lightCourseEditor/views/lightCourseComponentFormView.js', {
      'core/origin': {
        schemas: { get: function() { return useSnapshot ? undefined : schema; } },
        scaffold: { buildSchema: function(fields) { return fields; } },
        l10n: { t: function(key) { return key; } }
      },
      'core/views/originView': { extend: function(proto) { return proto; } },
      '../schemaFilter': filter,
      '../lightCourseAssetContext': {}
    }, { Backbone: Object.assign({}, Backbone, { Form: Form }) });
    var model = new Backbone.Model({
      _component: 'text', title: 'Original title', uniqueId: 'c-01', screenshotAssetId: '1234567890abcdef12345678',
      _componentSchemaSnapshot: useSnapshot ? schema : undefined
    });
    var view = Object.assign(Object.create(proto), {
      model: model, allowedLayouts: allowedLayouts, $el: { prepend: function() {} },
      $: function() { return new Element(); },
      setViewToReady: function() {}
    });
    view.postRender();
    options.getFormData = function() { return view.getFormData(); };
    return options;
  }

  [false, true].forEach(function(useSnapshot) {
    it('places unique ID before title and preserves other fields for ' +
      (useSnapshot ? 'a missing plugin snapshot' : 'an installed component'), function() {
      var options = render(rawSchema, useSnapshot);
      assert.deepStrictEqual(copy(options.fields), ['uniqueId', '_layout', 'title', 'screenshotAssetId', 'body', 'graphicsNotes', 'developerNotes']);
      assert.strictEqual(options.schema.uniqueId.title, 'Unique ID');
      assert.strictEqual(options.model.get('uniqueId'), 'c-01');
      assert.strictEqual(options.model.get('title'), 'Original title');
      assert.strictEqual(options.model.get('_layout'), 'full');
      assert.deepStrictEqual(copy(options.schema._layout.inputType.options), ['full', 'left', 'right']);
      options.model.set('_layout', 'right');
      assert.strictEqual(options.getFormData()._layout, 'right');
      assert.strictEqual(options.schema.screenshotAssetId.inputType, 'LightCourseAsset:image');
      assert.strictEqual(options.schema.screenshotAssetId.translatable, undefined);
      assert.strictEqual(options.getFormData().screenshotAssetId, '1234567890abcdef12345678');
      options.model.set('screenshotAssetId', '');
      assert.strictEqual(options.getFormData().screenshotAssetId, '');
    });
  });

  it('preserves field order without adding an unavailable unique ID field', function() {
    var options = render(_.omit(rawSchema, '_extensions'), false);
    assert.deepStrictEqual(copy(options.fields), ['_layout', 'title', 'screenshotAssetId', 'body', 'graphicsNotes', 'developerNotes']);
    assert.strictEqual(options.schema.uniqueId, undefined);
  });
  it('offers only half-width positions for a paired slot and persists the selected side', function() {
    var options = render(rawSchema, false, ['left', 'right']);
    assert.deepStrictEqual(copy(options.schema._layout.inputType.options), ['left', 'right']);
    assert.strictEqual(options.model.get('_layout'), 'left');
    options.model.set('_layout', 'right');
    assert.strictEqual(options.getFormData()._layout, 'right');
  });
  it('restricts component-default forms to their installed component type layout support', function() {
    var options = render(Object.assign({}, rawSchema, { _supportedLayout: { enum: ['full-width'] } }), false);
    assert.deepStrictEqual(copy(options.schema._layout.inputType.options), ['full']);
    assert.strictEqual(options.getFormData()._layout, 'full');
  });
});

describe('component preset selection and template copying (isolated)', function() {
  it('applies and stores the automatic default on first component-type choice', function() {
    var h = treeHarness();
    h.node._component = '';
    h.tree.renderComponentPicker(h.node);
    var select = h.containers['.light-course-tree-component-editor-component-picker'].children[1];
    select.val('text');
    select.handlers.change();
    h.requests[0].done([PRESET]);
    assert.strictEqual(h.node._componentPresetId, PRESET._id);
    assert.strictEqual(h.tree.rendered.body, PRESET.values.body);
    assert.strictEqual(h.containers[PRESET_PICKER].children[1].val(), PRESET._id);
  });

  it('restores the saved selection without overwriting manual field edits', function() {
    var h = treeHarness();
    h.node._componentPresetId = PRESET._id;
    h.node.body = 'Author edits';
    h.tree.renderPresetSelect(h.node, [PRESET], false);
    assert.strictEqual(h.containers[PRESET_PICKER].children[1].val(), PRESET._id);
    assert.strictEqual(h.node.body, 'Author edits');
    assert.strictEqual(h.tree.rendered, undefined);
  });

  it('clears a selection on none without deleting current field values', function() {
    var h = treeHarness();
    h.tree.applyPresetValues(h.node, PRESET);
    h.tree.renderPresetSelect(h.node, [PRESET], false);
    var select = h.containers[PRESET_PICKER].children[1];
    select.val('');
    select.handlers.change();
    assert.strictEqual(h.node._componentPresetId, undefined);
    assert.strictEqual(h.node.body, PRESET.values.body);
  });

  it('clears the preset when changing an existing component type without autoapplying', function() {
    var h = treeHarness();
    h.node._componentPresetId = PRESET._id;
    h.tree.renderComponentPicker(h.node);
    var select = h.containers['.light-course-tree-component-editor-component-picker'].children[1];
    select.val('graphic');
    select.handlers.change();
    h.requests[0].done([{ _id: 'graphic-default', name: 'Graphic', isDefault: true, values: { body: 'Graphic body' } }]);
    assert.strictEqual(h.node._componentPresetId, undefined);
    assert.strictEqual(h.node.body, 'Original');
  });

  it('copies preset values independently and preserves component identity', function() {
    var h = treeHarness();
    h.tree.applyPresetValues(h.node, Object.assign({}, PRESET, {
      values: Object.assign({}, PRESET.values, { _id: 'bad-id', type: 'page', _component: 'graphic' })
    }));
    h.node.items[0].title = 'Edited';
    assert.strictEqual(PRESET.values.items[0].title, 'Item');
    assert.strictEqual(h.node._id, 'component');
    assert.strictEqual(h.node.type, 'component');
    assert.strictEqual(h.node._component, 'text');
  });

  it('ignores stale responses after switching nodes, changing types twice, or closing', function() {
    var h = treeHarness();
    h.tree.renderPresetPicker(h.node, true);
    h.tree.openComponentNodeId = 'other-node';
    h.requests[0].done([PRESET]);
    assert.strictEqual(h.node._componentPresetId, undefined);
    h.tree.openComponentNodeId = h.node._id;
    h.tree.renderPresetPicker(h.node, true);
    h.tree.renderPresetPicker(h.node, false);
    h.requests[1].done([PRESET]);
    assert.strictEqual(h.node._componentPresetId, undefined);
    h.tree.openComponentNodeId = null;
    h.requests[2].done([PRESET]);
    assert.strictEqual(h.containers[PRESET_PICKER].children.length, 0);
  });

  it('shows an unavailable saved preset rather than pretending none was selected', function() {
    var h = treeHarness();
    h.node._componentPresetId = 'removed-preset';
    h.tree.renderPresetSelect(h.node, [], false);
    var select = h.containers[PRESET_PICKER].children[1];
    assert.strictEqual(select.val(), 'removed-preset');
    assert(select.children.some(function(option) { return option.label === 'app.lightcoursecomponentpresetunavailable'; }));
    assert.strictEqual(h.node.body, 'Original');
  });

  it('notifies the author when presets cannot be loaded', function() {
    var h = treeHarness();
    h.tree.renderPresetPicker(h.node, true);
    h.requests[0].fail();
    assert.strictEqual(h.alerts.length, 1);
  });

  it('retains the saved preset and values through template serialization and real course creation', function(done) {
    var h = treeHarness();
    h.node.screenshotAssetId = '1234567890abcdef12345678';
    h.tree.applyPresetValues(h.node, PRESET);
    var Model = load('frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js', { backbone: Backbone });
    var model = new Model({ name: 'Template', contentTree: { children: [
      { _id: 'page', type: 'page', children: [
        { _id: 'article', type: 'article', children: [
          { _id: 'block', type: 'block', children: [h.node] }
        ] }
      ] }
    ] } });
    var template = copy(model.toJSON());
    template._tenantId = 'tenant';
    function ContentPlugin() {}
    ContentPlugin.prototype.create = function(data, next) { next(null, copy(data)); };
    var Plugin = load('plugins/content/lightcourse/index.js', {
      '../../../lib/contentmanager': { ContentPlugin: ContentPlugin, errors: { ContentPermissionError: Error, ContentConflictError: Error } },
      '../../../lib/database': { getDatabase: function(next) {
        next(null, { retrieve: function(type, search, options, callback) { callback(null, [template]); } });
      } },
      '../../../lib/usermanager': { getCurrentUser: function() { return { tenant: { _id: 'tenant' } }; } },
      '../../../lib/permissions': {},
      '../../../lib/logger': {},
      '../../../lib/rest': {},
      '../../../lib/lightcoursewordcount': {},
      '../../../lib/lightcourse/versionDiff': {},
      '../../../lib/lightcourse/iconClasses': {},
      '../../../': function() { return { once: function() {} }; }
    });
    new Plugin().create({ _templateId: 'template' }, function(error, course) {
      if (error) return done(error);
      var component = course.contentTree.children[0].children[0].children[0].children[0];
      assert.notStrictEqual(component._id, h.node._id);
      assert.strictEqual(component._componentPresetId, PRESET._id);
      assert.strictEqual(component._component, 'text');
      assert.strictEqual(component.body, PRESET.values.body);
      assert.strictEqual(component.screenshotAssetId, h.node.screenshotAssetId);
      h.tree.renderPresetSelect(component, [PRESET], false);
      assert.strictEqual(h.containers[PRESET_PICKER].children[1].val(), PRESET._id);
      done();
    });
  });
});

function editorHarness(attached) {
  function Stub() {}
  function TextArea() { this.value = 'Initial'; this.$el = { 0: {}, parents: function() { return { length: attached ? 1 : 0 }; } }; }
  TextArea.prototype.render = function() { this.setValue(this.value); return this; };
  TextArea.prototype.getValue = function() { return this.value; };
  TextArea.prototype.setValue = function(value) { this.value = value; };
  TextArea.prototype.remove = function() { this.baseRemoved = true; return this; };
  function Form() {}
  Form.Field = Stub; Form.Fieldset = Stub; Form.NestedField = Stub;
  Form.editors = { Base: Stub, Text: Stub, Number: Stub, TextArea: TextArea };
  var created = [];
  var errors = [];
  var CKEDITOR = {
    pluginsConfig: [], instances: {},
    create: function() { return new Promise(function(resolve) { created.push(resolve); }); }
  };
  load('frontend/src/modules/scaffold/backboneFormsOverrides.js', {
    'core/origin': {
      constants: {}, Notify: { alert: function() { errors.push('alert'); } },
      l10n: { t: function(key) { return key; } }
    },
    'backbone-forms': {}, '../lightCourseEditor/lightCourseRefPlugin': {}
  }, { Backbone: { Form: Form }, Handlebars: { templates: {} }, CKEDITOR: CKEDITOR, window: { CKEDITOR: CKEDITOR } });
  return { field: new TextArea(), created: created, errors: errors, CKEDITOR: CKEDITOR };
}

function tick() { return new Promise(function(resolve) { setTimeout(resolve, 20); }); }
var nextEditorId = 0;
function fakeEditor() {
  return {
    id: 'editor-' + (++nextEditorId), data: '', destroyed: false, destroyCalls: 0,
    getData: function() { return this.data; }, setData: function(value) { this.data = value; },
    destroy: function() { this.destroyed = true; this.destroyCalls++; return Promise.resolve(); }
  };
}

describe('rich-text fields during preset replacement (isolated)', function() {
  it('preserves the CKEditor context identity when registering and destroying an editor', async function() {
    var h = editorHarness(true), editor = fakeEditor(), originalId = editor.id;
    var contextEditors = new Map([[originalId, editor]]);
    var destroy = editor.destroy;
    editor.destroy = function() {
      assert.strictEqual(contextEditors.get(this.id), this, 'Editor must remain removable by its original context ID');
      contextEditors.delete(this.id);
      return destroy.call(this);
    };
    h.field.render();
    await tick();
    h.created[0](editor);
    await tick();
    assert.strictEqual(editor.id, originalId);
    assert.strictEqual(h.CKEDITOR.instances[originalId], editor);
    h.field.remove();
    h.field.remove();
    await tick();
    assert.strictEqual(editor.destroyCalls, 1);
    assert.strictEqual(contextEditors.size, 0);
    assert.strictEqual(h.CKEDITOR.instances[originalId], undefined);
  });

  it('keeps multiple rich-text fields registered separately and removes only the closed field', async function() {
    var h = editorHarness(true), secondField = new h.field.constructor();
    var firstEditor = fakeEditor(), secondEditor = fakeEditor();
    var firstId = firstEditor.id, secondId = secondEditor.id;
    h.field.render();
    secondField.render();
    await tick();
    h.created[0](firstEditor);
    h.created[1](secondEditor);
    await tick();
    assert.strictEqual(h.CKEDITOR.instances[firstId], firstEditor);
    assert.strictEqual(h.CKEDITOR.instances[secondId], secondEditor);
    h.field.remove();
    assert.strictEqual(h.CKEDITOR.instances[firstId], undefined);
    assert.strictEqual(h.CKEDITOR.instances[secondId], secondEditor);
    assert.strictEqual(secondEditor.destroyCalls, 0);
    secondField.remove();
    assert.strictEqual(secondEditor.destroyCalls, 1);
    assert.strictEqual(h.CKEDITOR.instances[secondId], undefined);
  });

  it('allows an early save and applies pending values when the editor becomes ready', async function() {
    var h = editorHarness(true);
    h.field.render();
    h.field.setValue('Default body');
    assert.strictEqual(h.field.getValue(), 'Default body');
    await tick();
    var editor = fakeEditor();
    h.created[0](editor);
    await tick();
    assert.strictEqual(h.field.getValue(), 'Default body');
    h.field.remove();
    assert(editor.destroyed);
    assert(h.field.baseRemoved);
    assert.strictEqual(h.CKEDITOR.instances[editor.id], undefined);
  });

  it('removes an initializing editor safely and destroys its eventual instance', async function() {
    var h = editorHarness(true);
    h.field.render();
    await tick();
    h.field.remove();
    var editor = fakeEditor();
    h.created[0](editor);
    await tick();
    assert(editor.destroyed);
    assert.strictEqual(h.field.editor, undefined);
    assert.deepStrictEqual(h.errors, []);
    h.field.remove();
  });

  it('does not initialize an editor removed before its textarea is attached', async function() {
    var h = editorHarness(false);
    h.field.render();
    h.field.remove();
    await tick();
    assert.strictEqual(h.created.length, 0);
    assert(h.field.baseRemoved);
  });
});
