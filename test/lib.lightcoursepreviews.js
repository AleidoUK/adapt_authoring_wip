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
      'app.lightcoursecomponentscreenshot': 'Component screenshot',
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
  it('shows the component screenshot below the title and before body content without exposing its asset ID as text', function() {
    var node = { type: 'component', _component: 'text', body: '<p>Body</p>',
      screenshotAssetId: '1234567890abcdef12345678', title: 'Title' };
    var original = JSON.stringify(node);
    var fields = preview(node);
    assert.deepStrictEqual(copy(fields.map(function(field) { return field.label; })), ['Title', 'Component screenshot', 'Body']);
    assert.strictEqual(fields[1].isImage, true);
    assert.strictEqual(fields[1].imageSrc, 'api/content/lightcourseasset/1234567890abcdef12345678/serve');
    var template = Handlebars.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseEditor/templates/partials/part_lightCourseTreeField.hbs'), 'utf8'));
    var html = template(fields[1]);
    assert(html.includes('<img class="light-course-component-screenshot"'));
    assert(html.includes('alt="Component screenshot"'));
    assert(!html.includes('light-course-tree-field-value'));
    assert.strictEqual(JSON.stringify(node), original);
    node.screenshotAssetId = '';
    assert(!preview(node).some(function(field) { return field.isImage; }));
  });

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
    var headings = titledPage.match(/<h1 class="light-course-tree-node-label light-course-tree-page-heading">[\s\S]*?<\/h1>/g);
    assert.strictEqual(headings.length, 2);
    headings.forEach(function(heading) {
      assert.strictEqual((heading.match(/<input /g) || []).length, 1);
      assert(heading.includes('aria-label="app.lightcoursepagetitle"'));
      assert(heading.includes('placeholder="app.lightcoursepage"'));
    });
    assert.strictEqual((titledPage.match(/light-course-tree-page-title-input/g) || []).length, 2);
    assert(!titledPage.includes('light-course-tree-page-title-editor'));
    assert(headings[0].includes('value="&lt;Title &amp; &quot;quoted&quot;&gt;"'));
    assert(headings[1].includes('value=""'));
  });
});

describe('edited field labels in light editor audit logs (isolated)', function() {
  var logOrigin = Object.assign({}, origin, {
    l10n: { t: function(key) {
      return {
        'app.lightcoursepage': 'Page', 'app.lightcoursearticle': 'Article',
        'app.lightcourseblock': 'Block', 'app.lightcoursecomponent': 'Component',
        'app.lightcourseauditorder': 'Order', 'app.lightcoursefielduniqueid': 'Unique ID',
        'app.lightcoursecomponentpreset': 'Preset'
      }[key] || key;
    } }
  });
  var fields = load('frontend/src/modules/auditLog/lightFieldChanges.js', {
    'core/origin': logOrigin, '../lightCourseEditor/schemaFilter': filter
  });
  var audit = load('frontend/src/modules/auditLog/views/auditLogView.js', {
    backbone: Backbone, 'core/origin': logOrigin,
    'core/views/originView': { extend: function(proto) { return proto; } },
    '../lightFieldChanges': fields
  });
  function diff(changes) { return fields(changes, audit.inferValueType.bind(audit)); }
  function tree() {
    return { children: [{ _id: 'page', type: 'page', title: 'Introduction', children: [
      { _id: 'article', type: 'article', children: [{ _id: 'block', type: 'block', children: [
        { _id: 'component', type: 'component', _component: 'text', uniqueId: 'c-01',
          title: 'Welcome', instruction: '<p>Before</p>', items: [{ title: 'Item', body: 'Old body' }] }
      ] }] }
    ] }] };
  }

  it('finds the actual nested component and item fields, using labels rather than snapshot keys', function() {
    var before = tree();
    var after = copy(before);
    var component = after.children[0].children[0].children[0].children[0];
    component.instruction = '<p>After</p>';
    component.items[0].body = 'New body';
    var changes = [{ field: 'contentSnapshot', oldValue: { contentTree: before }, newValue: { contentTree: after } }];
    var original = copy(changes);
    var result = diff(changes);
    assert.strictEqual(result.length, 2);
    assert(result[0].field.includes('Component 1: Welcome (c-01) / Instruction'));
    assert(result[1].field.endsWith('Items / 1 / Item body'));
    assert.strictEqual(result[0].oldValue, '<p>Before</p>');
    assert.strictEqual(result[1].newValue, 'New body');
    assert.deepStrictEqual(changes, original);
  });

  it('matches stable node IDs when reordering and reports order separately from field edits', function() {
    var before = tree();
    before.children.push({ _id: 'second', type: 'page', title: 'Second', children: [] });
    var after = copy(before);
    after.children.reverse();
    var result = diff([{ field: 'contentTree', oldValue: before, newValue: after }]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].field, 'Content Tree / Order');
  });

  it('reports additions, deletions, new nested values, zero, false, and preset selections', function() {
    var before = tree();
    var after = copy(before);
    after.children[0].children[0].children[0].children = [];
    var result = diff([
      { field: 'contentTree', oldValue: before, newValue: after },
      { field: 'values', oldValue: {}, newValue: { attempts: 0, enabled: false, _componentPresetId: 'preset' } },
      { field: 'headerData', oldValue: {}, newValue: { iconChoices: { help: 'question' } } },
      { field: 'revision', oldValue: 1, newValue: 2 }
    ]);
    assert.strictEqual(result.length, 5);
    assert(result[0].field.includes('Component 1: Welcome'));
    assert.strictEqual(result[0].newValue, undefined);
    assert(result.some(function(change) { return change.field === 'Values / Attempts' && change.newValue === 0; }));
    assert(result.some(function(change) { return change.field === 'Values / Enabled' && change.newValue === false; }));
    assert(result.some(function(change) { return change.field === 'Values / Preset'; }));
    assert(result.some(function(change) { return change.field === 'Header Data / Icon Choices / Help'; }));
  });

  it('shows edited fields in light log headers and details without changing full-editor logs', function() {
    var log = { _id: 'log', timestamp: new Date().toISOString(), action: 'update',
      contentType: 'lightcoursetemplate', contentId: 'template', contentTitle: 'Already known template',
      userName: 'Editor', changes: [
        { field: 'values', oldValue: { instruction: 'Old' }, newValue: { instruction: '<script>New</script>' }, changeType: 'object' }
      ] };
    var lightView = Object.assign(Object.create(audit), { contentType: 'lightcoursetemplate' });
    var html = lightView.renderLogItem(log);
    assert(html.includes('<span class="audit-content-title">Values / Instruction</span>'));
    assert(html.includes('<strong>Values / Instruction:</strong>'));
    assert(html.includes('&lt;script&gt;New&lt;/script&gt;'));
    assert(!html.includes('Already known template'));
    assert(!html.includes('<script>'));
    var fullHtml = Object.create(audit).renderLogItem(log);
    assert(fullHtml.includes('<span class="audit-content-title">Already known template</span>'));
    assert(fullHtml.includes('<strong>values:</strong>'));
    assert.strictEqual(log.changes[0].field, 'values');
  });

  it('keeps empty-value transitions and custom type fields visible', function() {
    var result = diff([
      { field: 'items', oldValue: [], newValue: null },
      { field: 'settings', oldValue: {}, newValue: null },
      { field: 'custom', oldValue: { type: 'article' }, newValue: { type: 'component' } }
    ]);
    assert.deepStrictEqual(copy(result.map(function(change) { return change.field; })), [
      'Items', 'Settings', 'Custom / Type'
    ]);
  });

  it('labels create and delete events explicitly and identifies missing edited-field details', function() {
    var view = Object.assign(Object.create(audit), { contentType: 'lightcourse' });
    ['create', 'delete', 'update'].forEach(function(action) {
      var html = view.renderLogItem({ _id: 'log', contentId: 'course', timestamp: new Date().toISOString(),
        action: action, contentType: 'lightcourse', userName: 'Editor' });
      assert(html.includes(action === 'update' ? 'app.lightcourseauditnofields' : 'app.lightcourseaudit' + action));
      assert(!html.includes('(untitled)'));
    });
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
