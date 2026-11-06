var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var _ = require('underscore');
var Handlebars = require('handlebars');
var ROOT = path.join(__dirname, '..');
var backboneModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'frontend/src/libraries/backbone.js'), 'utf8'), {
  module: backboneModule, exports: backboneModule.exports,
  require: function() { return _; }
});
var Backbone = backboneModule.exports;

function load(relativePath, dependencies, globals) {
  var exported;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), Object.assign({
    _: _, Backbone: Backbone, console: console,
    define: function(factory) { exported = factory(function(name) { return dependencies[name]; }); }
  }, globals), { filename: relativePath });
  return exported;
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }
var componentSchema = {
  title: { type: 'string', title: 'Title', translatable: true },
  body: { type: 'string', title: 'Body', translatable: true, inputType: 'TextArea' },
  properties: { type: 'object', properties: {
    instruction: { type: 'string', title: 'Instruction', translatable: true, inputType: 'TextArea' },
    items: { type: 'array', title: 'Items', items: { type: 'object', properties: {
      title: { type: 'string', title: 'Item title', translatable: true },
      body: { type: 'string', title: 'Item body', translatable: true, inputType: 'TextArea' }
    } } }
  } }
};
var origin = {
  schemas: { get: function() { return componentSchema; } },
  l10n: { t: function(key) {
    return {
      'app.lightcoursefielduniqueid': 'Unique ID',
      'app.lightcoursegraphicsnotes': 'Graphics Notes',
      'app.lightcoursedevelopernotes': 'Developer Notes'
    }[key] || key;
  } }
};
var filter = load('frontend/src/modules/lightCourseEditor/schemaFilter.js', {});
var preview = load('frontend/src/modules/lightCourseEditor/fieldPreview.js', {
  'core/origin': origin, './schemaFilter': filter
});

function flatten(fields) {
  return fields.reduce(function(out, field) {
    return out.concat(field, flatten(field.children || []));
  }, []);
}

describe('populated light course tree fields (isolated)', function() {
  it('keeps populated fields but leaves the component unique ID for the title row', function() {
    var fields = preview({
      _id: 'internal', type: 'component', _component: 'text', uniqueId: 'c-01', title: 'Title',
      body: '<p>Body</p>', instruction: '<p>Instruction</p>', graphicsNotes: 'Graphic notes',
      developerNotes: 'Developer notes', attempts: 0, enabled: false
    });
    assert.deepStrictEqual(copy(fields.map(function(field) { return field.label; })), [
      'Title', 'Body', 'Instruction', 'Graphics Notes', 'Developer Notes', 'Attempts', 'Enabled'
    ]);
    assert.strictEqual(fields.find(function(field) { return field.label === 'Attempts'; }).value, '0');
    assert.strictEqual(fields.find(function(field) { return field.label === 'Enabled'; }).value, 'false');
  });

  it('recursively displays populated item and graphic fields without exposing internal IDs', function() {
    var fields = flatten(preview({
      type: 'component', _component: 'text',
      items: [{ _id: 'internal-item', title: 'Item', body: '<p>Details</p>', type: 'custom',
        _graphic: { src: 'image.png', alt: 'Description' } }]
    }));
    ['Items', '1', 'Item title', 'Item body', 'Type', 'Graphic', 'Src', 'Alt'].forEach(function(label) {
      assert(fields.some(function(field) { return field.label === label; }), label);
    });
    assert(!fields.some(function(field) { return field.value === 'internal-item'; }));
  });

  it('omits empty fields and bookkeeping but keeps rich media without text', function() {
    var fields = preview({
      _id: 'internal', type: 'component', _component: 'text', children: [],
      _componentSchemaSnapshot: componentSchema, _componentPresetId: 'preset',
      title: ' ', body: '<p>&nbsp;<br></p>', items: [], blank: {}, nothing: null,
      instruction: '<img src="image.png" alt="">'
    });
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0].label, 'Instruction');
  });

  it('uses schema snapshot labels when a component plugin is missing', function() {
    var missing = load('frontend/src/modules/lightCourseEditor/fieldPreview.js', {
      'core/origin': Object.assign({}, origin, { schemas: { get: function() { return null; } } }),
      './schemaFilter': filter
    });
    var fields = missing({
      type: 'component', _component: 'removed', _componentSchemaSnapshot: {
        custom: { type: 'string', title: 'Saved label', translatable: true }
      }, custom: 'Saved value'
    });
    assert.strictEqual(fields[0].label, 'Saved label');
  });

  it('includes populated block fields and never mutates stored content', function() {
    var node = { _id: 'block', type: 'block', title: 'Block title', instruction: 'Block instructions', children: [] };
    var original = copy(node);
    assert.strictEqual(preview(node).length, 2);
    assert.deepStrictEqual(node, original);
  });

  it('leaves page titles for the heading but keeps other page and nested fields', function() {
    var fields = flatten(preview({ type: 'page', title: 'Heading', instruction: 'Page instructions',
      custom: { title: 'Nested title' }, children: [] }));
    assert(!fields.some(function(field) { return field.value === 'Heading'; }));
    assert(fields.some(function(field) { return field.value === 'Page instructions'; }));
    assert(fields.some(function(field) { return field.value === 'Nested title'; }));
  });

  it('renders all values in the recursive tree while escaping plain text', function() {
    Handlebars.registerHelper('t', function(key) { return key === 'app.lightcourseuniqueid' ? 'ID' : key; });
    Handlebars.registerHelper('ifValueEquals', function(a, b, options) {
      return a === b ? options.fn(this) : options.inverse(this);
    });
    ['part_lightCourseTreeField', 'part_lightCourseTreeNode'].forEach(function(name) {
      Handlebars.registerPartial(name, fs.readFileSync(path.join(ROOT,
        'frontend/src/modules/lightCourseEditor/templates/partials/' + name + '.hbs'), 'utf8'));
    });
    var component = { _id: 'component', type: 'component', _component: 'text',
      uniqueId: 'c-01', instruction: '<p>Use this instruction</p>', custom: '<script>plain text</script>' };
    var block = { _id: 'block', type: 'block', title: 'Block details', children: [component] };
    var template = Handlebars.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseEditor/templates/lightCourseTreeRootNodes.hbs'), 'utf8'));
    var html = template({
      children: [block],
      nodeMeta: {
        block: { fields: preview(block) },
        component: { componentTypeDisplayName: 'Text', wordCount: 3, fields: preview(component) }
      }
    });
    assert(html.includes('<span class="light-course-tree-component-uniqueid">(ID: c-01)</span>'));
    assert.strictEqual((html.match(/c-01/g) || []).length, 1);
    assert(!html.includes('<dt>Unique ID</dt>'));
    assert(html.includes('<p>Use this instruction</p>'));
    assert(html.includes('Block details'));
    assert(html.includes('&lt;script&gt;plain text&lt;/script&gt;'));
    assert(!html.includes('<script>'));
    assert.strictEqual((html.match(/class="btn-icon light-course-tree-copy"/g) || []).length, 2);
    assert(!html.includes('light-course-tree-paste'));
    var emptyParents = template({
      children: [{ _id: 'page', type: 'page', children: [{ _id: 'article', type: 'article', children: [] }] }]
    });
    assert.strictEqual((emptyParents.match(/class="btn-icon light-course-tree-copy"/g) || []).length, 1);
    var tree = [{ _id: 'page', type: 'page', children: [
      { _id: 'article', type: 'article', children: [block] },
      { _id: 'second-article', type: 'article', children: [] }
    ] }];
    var blockClipboard = template({ children: tree, clipboardType: 'block' });
    assert.strictEqual((blockClipboard.match(/light-course-tree-paste/g) || []).length, 2);
    assert.strictEqual((blockClipboard.match(/app.lightcoursepasteblock/g) || []).length, 2);
    assert(!blockClipboard.includes('app.lightcoursepastecomponent'));
    var componentClipboard = template({ children: tree, clipboardType: 'component' });
    assert.strictEqual((componentClipboard.match(/light-course-tree-paste/g) || []).length, 1);
    assert(componentClipboard.includes('app.lightcoursepastecomponent'));
    assert(!componentClipboard.includes('app.lightcoursepasteblock'));
    var pageClipboard = template({
      children: [{ _id: 'first-page', type: 'page', children: [] },
        { _id: 'second-page', type: 'page', children: [] }],
      clipboardType: 'page'
    });
    assert.strictEqual((pageClipboard.match(/class="light-course-tree-page-paste-zone"/g) || []).length, 3);
    assert(pageClipboard.indexOf('data-after-node-id=""') < pageClipboard.indexOf('data-node-id="first-page"'));
    assert(pageClipboard.indexOf('data-after-node-id="first-page"') > pageClipboard.indexOf('data-node-id="first-page"'));
    assert(pageClipboard.indexOf('data-after-node-id="first-page"') < pageClipboard.indexOf('data-node-id="second-page"'));
    assert(pageClipboard.indexOf('data-after-node-id="second-page"') > pageClipboard.indexOf('data-node-id="second-page"'));
    assert(!template({ children: tree }).includes('light-course-tree-paste'));
    var titledPage = template({ children: [
      { _id: 'titled', type: 'page', title: '<Title & "quoted">', children: [] },
      { _id: 'untitled', type: 'page', children: [] }
    ] });
    assert(titledPage.includes('<h1 class="light-course-tree-node-label light-course-tree-page-heading">&lt;Title &amp; &quot;quoted&quot;&gt;</h1>'));
    assert(titledPage.includes('<h1 class="light-course-tree-node-label light-course-tree-page-heading">app.lightcoursepage</h1>'));
    assert(titledPage.includes('class="light-course-tree-page-title-input" value="&lt;Title &amp; &quot;quoted&quot;&gt;"'));
  });
});

describe('light course editor collapsible settings (isolated)', function() {
  function render() {
    var hb = Handlebars.create();
    hb.registerHelper('t', function(key) { return key; });
    hb.registerHelper('ifValueEquals', function(a, b, options) {
      return a === b ? options.fn(this) : options.inverse(this);
    });
    return hb.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseEditor/templates/lightCourseEditor.hbs'), 'utf8'))({
      title: 'Course title', body: 'Menu content', conversionStatus: 'converted'
    });
  }

  it('puts all former above-tree settings in a closed native panel at the bottom', function() {
    var html = render();
    var panelStart = html.indexOf('<details class="light-course-editor-settings">');
    var panelEnd = html.indexOf('</details>', panelStart);
    assert(panelStart > html.indexOf('light-course-editor-tree-container'));
    assert(panelStart > html.indexOf('light-course-editor-help-container'));
    var panel = html.slice(panelStart, panelEnd);
    ['light-course-editor-header-container', 'light-course-editor-menu-section', 'light-course-editor-plugins']
      .forEach(function(selector) {
        assert(panel.includes(selector));
        assert.strictEqual((html.match(new RegExp(selector, 'g')) || []).length, 1);
      });
    assert(panel.includes('<summary>app.lightcourseeditorsettings</summary>'));
    assert(panel.includes('value="Course title"'));
    assert(panel.includes('>Menu content</textarea>'));
    assert(!panel.includes(' open'));
  });

  it('keeps navigation, save status, toolbar actions and warnings outside the collapsed panel', function() {
    var html = render();
    var beforePanel = html.slice(0, html.indexOf('<details'));
    ['light-course-editor-back-to-list', 'light-course-editor-save-status', 'light-course-editor-auditlog',
      'light-course-editor-create-major-version', 'light-course-editor-conflict-banner', 'light-course-editor-locked-banner']
      .forEach(function(selector) { assert(beforePanel.includes(selector)); });
    assert(!fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseAdmin/templates/lightCourseTemplateEditor.hbs'), 'utf8')
      .includes('light-course-editor-settings'));
  });
});

describe('light course administration submenu (isolated)', function() {
  function menuHarness(allowed) {
    var store;
    var registrations = [];
    var Origin = _.extend({}, Backbone.Events, {
      location: { module: 'lightCourseTemplates' },
      sessionModel: new Backbone.Model({ isAuthenticated: true }),
      l10n: { t: function(key) { return key; } },
      permissions: {
        addRoute: function(route) { registrations.push(route); },
        hasPermissions: function() { return allowed; }
      }
    });
    load('frontend/src/modules/globalMenu/index.js', { 'core/origin': Origin }, {
      Backbone: { Collection: function() { store = new Backbone.Collection(); return store; } }
    });
    load('frontend/src/modules/lightCourseAdmin/index.js', { 'core/origin': Origin });
    Origin.trigger('origin:dataReady');
    return { Origin: Origin, store: store, registrations: registrations };
  }

  it('groups the four admin links in order under one parent', function() {
    var h = menuHarness(true);
    assert.strictEqual(h.store.length, 5);
    var parent = h.store.findWhere({ _isSubMenuItem: false });
    assert.strictEqual(parent.get('text'), 'app.lightcourseadministration');
    var children = h.store.where({ parent: parent.get('text') });
    assert.deepStrictEqual(children.map(function(item) { return item.get('callbackEvent'); }), [
      'lightCourseConfig:open', 'lightCourseAssets:open', 'lightCourseTemplates:open', 'lightCourseComponentDefaults:open'
    ]);
    assert(children.every(function(item) { return item.get('_isSubMenuItem'); }));
  });

  it('does not duplicate submenu items after login or repeated data-ready events', function() {
    var h = menuHarness(true);
    h.Origin.trigger('origin:dataReady');
    h.Origin.trigger('login:changed');
    assert.strictEqual(h.store.length, 5);
  });

  it('retains the existing admin permissions and does not expose admin items to light editors', function() {
    var h = menuHarness(false);
    assert.strictEqual(h.store.length, 0);
    assert.deepStrictEqual(h.registrations, [
      'lightCourseTemplates', 'lightCourseConfig', 'lightCourseComponentDefaults', 'lightCourseAssets'
    ]);
  });

  it('expands/collapses without triggering navigation, and leaf links still navigate and close', function() {
    var calls = [];
    var attributes = {};
    var Origin = {
      trigger: function(event) { calls.push(event); },
      location: { module: 'lightCourseTemplates' }
    };
    var proto = load('frontend/src/modules/globalMenu/views/globalMenuItemView.js', { 'core/origin': Origin }, {
      Backbone: { View: { extend: function(proto) { return proto; } } }
    });
    var event = { preventDefault: function() {}, stopPropagation: function() {} };
    var item = Object.assign(Object.create(proto), {
      model: new Backbone.Model({ callbackEvent: 'lightCourseTemplates:open' }),
      collection: new Backbone.Collection(),
      $: function() {
        return {
          attr: function(key, value) { attributes[key] = value; },
          prop: function(key, value) { attributes[key] = value; }
        };
      }
    });
    item.onToggleClicked(event);
    assert.strictEqual(attributes['aria-expanded'], 'true');
    assert.strictEqual(attributes.hidden, false);
    assert.strictEqual(calls.length, 0);
    item.onToggleClicked(event);
    assert.strictEqual(attributes.hidden, true);
    item.onMenuItemClicked(event);
    assert.deepStrictEqual(calls, ['globalMenu:lightCourseTemplates:open', 'globalMenu:close']);
  });
});
