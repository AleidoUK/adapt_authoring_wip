var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var createRequire = require('module').createRequire;
var schema = require('../lib/lightcourse/conversionSchema');
var planner = require('../lib/lightcourse/conversionPlan');
var catalogs = require('../lib/lightcourse/conversionCatalog');
var ROOT = path.join(__dirname, '..');
var ASSET = 'aaaaaaaaaaaaaaaaaaaaaaaa';
var COMPONENT = 'bbbbbbbbbbbbbbbbbbbbbbbb';
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function load(file, mocks) {
  var filename = path.join(ROOT, file), module = { exports: {} }, nativeRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module, exports: module.exports, Buffer: Buffer, console: console,
    require: function(name) { return Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : nativeRequire(name); }
  }, { filename: filename });
  return module.exports;
}
function fixture() {
  var core = {};
  ['course', 'config', 'contentobject', 'article', 'block', 'component'].forEach(function(type) {
    core[type] = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/content', type, 'model.schema')));
  });
  var component = { _id: COMPONENT, component: 'graphic', name: 'adapt-contrib-graphic', properties: {
    _supportedLayout: { type: 'string', required: true, enum: ['both'], default: 'both' },
    _graphic: { type: 'object', required: true, properties: {
      large: { type: 'string', required: true, inputType: 'Asset:image', validators: ['required'], default: '' },
      small: { type: 'string', required: true, inputType: 'Asset:image', validators: ['required'], default: '' },
      alt: { type: 'string', default: '' }
    } },
    optional: { type: 'string', default: 'Not applied' },
    _items: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string', required: true, default: 'Fallback item' }
    } } }
  } };
  var catalog = { core: core, component: { graphic: component }, extension: {},
    menu: { tile: { _id: 'menu-type', name: 'adapt-menu', menu: 'tile', properties: {} } },
    theme: { theme: { _id: 'theme-type', name: 'adapt-theme', theme: 'theme', properties: {} } } };
  var draft = {
    _id: 'cccccccccccccccccccccccc', _tenantId: 'tenant', title: 'Light course', body: 'Course body',
    revision: 3, conversionStatus: 'none', currentVersionNumber: '1.0', tags: [],
    pluginSelections: { menu: 'tile', theme: 'theme', extensions: [] },
    headerData: { iconChoices: {}, developer: 'Not transferred', versionHistory: [] },
    contentTree: { children: [{ _id: 'page', type: 'page', title: 'Page', displayTitle: 'Display page', children: [
      { _id: 'article', type: 'article', title: 'Article', children: [
        { _id: 'block', type: 'block', title: 'Block', children: [
          { _id: 'component', type: 'component', _component: 'graphic', title: 'Graphic',
            _graphic: { alt: 'Authored alt' }, optional: '', graphicsNotes: 'Keep in light',
            developerNotes: 'Keep in light', screenshotAssetId: ASSET, _comments: [] }
        ] }
      ] }
    ] }] },
    glossaryItems: [], resourceItems: [], helpContent: {}
  };
  var version = { _id: 'version', _lightCourseId: draft._id, versionNumber: '1.0', contentSnapshot: copy(draft), headerSnapshot: copy(draft.headerData) };
  var defaults = { 'component:graphic': { '_graphic.large': ASSET, '_graphic.small': ASSET, optional: 'Never use' } };
  return { catalog: catalog, draft: draft, version: version, defaults: defaults };
}
function component(data) { return data.contentTree.children[0].children[0].children[0].children[0]; }
function itemGraphics(f, items, enabled) {
  f.catalog.component.graphic.properties._items.items.properties._graphic = {
    type: 'object', properties: {
      src: { type: 'string', inputType: 'Asset:image' }, alt: { type: 'string' }
    }
  };
  component(f.draft)._items = copy(items);
  f.version.contentSnapshot = copy(f.draft);
  if (enabled !== false) f.defaults['component:graphic']['_items[]._graphic.src'] = ASSET;
}
function planFixture(change) {
  var f = fixture();
  if (change) change(f);
  return planner.build(f.draft, f.version, f.catalog, f.defaults);
}

function splashFixture(f) {
  f.catalog.component.splash = f.catalog.component.graphic;
  f.catalog.component.splash.component = 'splash';
  f.catalog.component.splash.name = 'adapt-aleido-splash';
  Object.assign(f.catalog.component.splash.properties, {
    _naviagteHome: { type: 'boolean', default: false, title: 'Navigate to the main menu' },
    _naviagteToNextPage: { type: 'boolean', default: true, title: 'Navigate to the next page/menu' },
    _naviageTo: { type: 'string', default: '', title: 'Custom page/menu ID to navigate to' }
  });
  delete f.catalog.component.graphic;
  component(f.draft)._component = 'splash';
  f.defaults['component:splash'] = f.defaults['component:graphic'];
  delete f.defaults['component:graphic'];
  f.version.contentSnapshot = copy(f.draft);
}

function footerLocation() {
  function button() {
    return { type: 'object', properties: {
      _isEnabled: { type: 'boolean', required: true, default: false },
      _customLink: { type: 'string', default: '' },
      _isRound: { type: 'boolean', default: false, title: 'Use circular button' },
      title: { type: 'string', default: '', title: 'Button title' }
    } };
  }
  return { properties: { _footer: { type: 'object', properties: {
    _isEnabled: { type: 'boolean', default: false },
    _previous: button(), _next: button(), _parent: button()
  } } } };
}
function configureFooter(f) {
  f.catalog.extension.footer = { _id: 'footer-id', name: 'adapt-aleido-footer', version: '1',
    properties: { pluginLocations: { properties: { contentobject: footerLocation() } } } };
  f.draft.pluginSelections.extensions = ['footer'];
  f.version.contentSnapshot = copy(f.draft);
}

function configureProgress(f) {
  var locations = {};
  ['course', 'contentobject', 'article', 'block', 'component'].forEach(function(type) {
    locations[type] = { properties: { _pageLevelProgress: { type: 'object', properties: {
      _isEnabled: { type: 'boolean', required: true, default: !['article', 'block'].includes(type) },
      _isCompletionIndicatorEnabled: { type: 'boolean', required: true, default: false }
    } } } };
  });
  f.catalog.extension.pageLevelProgress = { _id: 'progress-id', name: 'adapt-contrib-pageLevelProgress', version: '8.3.0',
    properties: { pluginLocations: { properties: locations } } };
  f.draft.pluginSelections.extensions.push('pageLevelProgress');
  f.version.contentSnapshot = copy(f.draft);
}

function configureIntroductionProgress(f) {
  ['sectionProgress', 'overallProgress'].forEach(function(key) {
    var plugin = { type: 'object', properties: {
      _isEnabled: { type: 'boolean', required: true, default: true },
      label: { type: 'string', required: true, default: 'keep' }
    } };
    var fields = {};
    fields['_' + key] = plugin;
    f.catalog.extension[key] = { _id: key + '-id', name: 'adapt-aleido-' + key, version: '1',
      properties: { pluginLocations: { properties: {
        course: { properties: copy(fields) }, contentobject: { properties: copy(fields) }
      } } } };
    f.draft.pluginSelections.extensions.push(key);
  });
  f.version.contentSnapshot = copy(f.draft);
}

function configureMenuButton(f) {
  f.catalog.extension.menuButton = { _id: 'menu-button-id', name: 'adapt-aleido-menuButton', version: '1',
    properties: { pluginLocations: { properties: { contentobject: { properties: {
      _menuButton: { type: 'object', properties: {
        _isEnabled: { type: 'boolean', required: true, default: true },
        _icon: { type: 'string', required: true, default: 'home' }
      } }
    } } } } } };
  f.draft.pluginSelections.extensions.push('menuButton');
  f.version.contentSnapshot = copy(f.draft);
}

function configureCompletion(f) {
  f.catalog.extension.completion = { _id: 'completion-id', name: 'adapt-aleido-completion', version: '1',
    properties: { pluginLocations: { properties: { course: { properties: {
      _completion: { type: 'object', properties: {
        _isEnabled: { type: 'boolean', required: true, default: false },
        title: { type: 'string', required: false, default: '', title: 'Title', inputType: 'Text' },
        body: { type: 'string', required: false, default: '', title: 'Body', inputType: 'TextArea' },
        instruction: { type: 'string', required: false, default: '' }
      } }
    } } } } } };
  f.draft.pluginSelections.extensions.push('completion');
  f.version.contentSnapshot = copy(f.draft);
}

function configureHelp(f) {
  var properties = JSON.parse(fs.readFileSync(path.join(ROOT,
    'test/fixtures/lightcourse/adapt-aleido-help/properties.schema'), 'utf8'));
  f.catalog.extension.help = {
    _id: 'help-id', name: 'adapt-aleido-help', version: '1.0.0', properties: properties.properties
  };
  f.draft.pluginSelections.extensions.push('help');
  f.version.contentSnapshot = copy(f.draft);
}

function heroFixture() {
  return { _id: 'hero-id', name: 'adapt-aleido-hero', properties: { pluginLocations: { properties: {
    course: { properties: { _hero: { type: 'object', properties: { _isEnabled: { type: 'boolean', default: false } } } } },
    contentobject: { properties: { _hero: { type: 'object', properties: {
      _isEnabled: { type: 'boolean', default: false }, _hideHeader: { type: 'boolean', default: false },
      _backgroundImage: { type: 'object', properties: {
        _isEnabled: { type: 'boolean', default: true }, _opacity: { type: 'number', default: 1 }
      } }
    } } } }
  } } } };
}
describe('Splash page extension settings', function() {
  it('disables Footer and enables Hero without its background image on a first Splash page', function() {
    var f = fixture();
    splashFixture(f);
    configureFooter(f);
    f.catalog.extension.hero = heroFixture();
    f.draft.pluginSelections.extensions.push('hero');
    f.draft.contentTree.children[0]._extensions = {
      _footer: { _isEnabled: true }, _hero: { _isEnabled: false, _hideHeader: true,
        _backgroundImage: { _isEnabled: true, _opacity: 0.5 } }
    };
    f.draft.contentTree.children.push({ _id: 'second', type: 'page', title: 'Second', children: [],
      _extensions: { _footer: { _isEnabled: true }, _hero: { _isEnabled: true, _backgroundImage: { _isEnabled: true } } } });
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var first = plan.records.find(function(record) { return record.id === 'page'; }).data;
    var second = plan.records.find(function(record) { return record.id === 'second'; }).data;
    assert.strictEqual(first._extensions._footer._isEnabled, false);
    assert.strictEqual(first._extensions._hero._isEnabled, true);
    assert.deepStrictEqual(first._extensions._hero._backgroundImage, { _isEnabled: false, _opacity: 0.5 });
    assert.strictEqual(first._isHidden, true);
    assert.strictEqual(first._extensions._hero._hideHeader, true);
    assert.strictEqual(second._extensions._footer._isEnabled, true);
    assert.strictEqual(second._extensions._hero._isEnabled, true);
    assert.strictEqual(second._extensions._hero._backgroundImage._isEnabled, true);
    assert.notStrictEqual(second._isHidden, true);
    assert.strictEqual(plan.records[0].data._start._isEnabled, true);
    assert.strictEqual(plan.records[0].data._start._force, true);
    assert.strictEqual(plan.records[0].startTarget, 'page');
    assert.strictEqual(plan.records[0].data._extensions._hero._isEnabled, true);
    [['_extensions._footer._isEnabled', true, false], ['_extensions._hero._isEnabled', false, true],
      ['_extensions._hero._backgroundImage._isEnabled', true, false]].forEach(function(setting) {
      assert(plan.proposals.some(function(item) {
        return item.node === 'page' && item.path === setting[0] &&
          item.previous === setting[1] && item.value === setting[2] && item.source === 'First page contains Splash';
      }));
    });
  });
  it('reports an incompatible Hero background image schema on the first Splash page', function() {
    var f = fixture();
    splashFixture(f);
    f.catalog.extension.hero = heroFixture();
    delete f.catalog.extension.hero.properties.pluginLocations.properties.contentobject.properties._hero.properties._backgroundImage;
    f.draft.pluginSelections.extensions = ['hero'];
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert(plan.errors.some(function(item) {
      return item.node === 'page' && item.path === '_extensions._hero._backgroundImage._isEnabled';
    }));
  });
  it('leaves unselected extensions and first pages without Splash unchanged', function() {
    var f = fixture();
    splashFixture(f);
    f.catalog.extension.hero = heroFixture();
    f.draft.contentTree.children.push({ _id: 'second', type: 'page', title: 'Second', children: [] });
    f.version.contentSnapshot = copy(f.draft);
    var page = planner.build(f.draft, f.version, f.catalog, f.defaults).records.find(function(record) { return record.id === 'page'; });
    assert(!page.data._extensions || !page.data._extensions._hero);
    assert.strictEqual(page.data._isHidden, true);
    f.draft.pluginSelections.extensions = ['hero'];
    f.draft.contentTree.children.unshift({ _id: 'first', type: 'page', title: 'First', children: [] });
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'first'; }).data._extensions._hero._isEnabled, true);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; }).data._extensions._hero._isEnabled, true);
    assert.notStrictEqual(plan.records.find(function(record) { return record.id === 'first'; }).data._isHidden, true);
    assert.strictEqual(plan.records[0].startTarget, undefined);
  });
});

describe('Footer navigation conversion', function() {
  it('skips the Help page for Next in standard courses only when Help is selected', function() {
    var f = fixture();
    configureFooter(f);
    configureHelp(f);
    f.draft.contentTree.children.push(
      { _id: 'help-page', type: 'page', title: 'Help', children: [] },
      { _id: 'after-help', type: 'page', title: 'After Help', children: [] }
    );
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var first = plan.records.find(function(record) { return record.id === 'page'; });
    var help = plan.records.find(function(record) { return record.id === 'help-page'; });
    var after = plan.records.find(function(record) { return record.id === 'after-help'; });
    assert.strictEqual(first.data._extensions._footer._next._isEnabled, true);
    assert.strictEqual(first.footerTargets._next, 'after-help');
    assert.strictEqual(help.data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(help.data._extensions._footer._next._customLink, '');
    assert(!help.footerTargets || !help.footerTargets._next);
    assert.strictEqual(after.footerTargets._previous, 'help-page');

    f.draft.contentTree.children.pop();
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    first = plan.records.find(function(record) { return record.id === 'page'; });
    assert.strictEqual(first.data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(first.data._extensions._footer._next._customLink, '');
    assert(!first.footerTargets || !first.footerTargets._next);

    f.draft.pluginSelections.extensions = ['footer'];
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; }).footerTargets._next, 'help-page');
  });

  it('keeps submenu course Next navigation unchanged when Help is selected', function() {
    var f = fixture();
    configureFooter(f);
    configureHelp(f);
    f.draft.contentTree.children.push(
      { _id: 'help-page', type: 'page', title: 'Help', children: [] },
      { _id: 'menu', type: 'submenu', title: 'Menu', children: [] }
    );
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; }).footerTargets._next, 'help-page');
  });

  it('uses the structure for Next and Previous, excluding the Splash page as a previous target', function() {
    var f = fixture();
    splashFixture(f);
    configureFooter(f);
    f.draft.contentTree.children.push(
      { _id: 'first', type: 'page', title: 'First', children: [],
        _extensions: { _footer: { _isEnabled: false, _previous: { _isEnabled: true, _customLink: 'old' },
          _next: { _isEnabled: false, _customLink: 'old', _isRound: false } } } },
      { _id: 'second', type: 'page', title: 'Second', children: [] }
    );
    f.defaults['extension:footer:contentobject'] = {
      '_footer._previous._isRound': true, '_footer._next._isRound': true, '_footer._parent._isRound': true
    };
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var splash = plan.records.find(function(record) { return record.id === 'page'; });
    var first = plan.records.find(function(record) { return record.id === 'first'; });
    var second = plan.records.find(function(record) { return record.id === 'second'; });
    assert.strictEqual(splash.data._extensions._footer._previous._isEnabled, false);
    assert.strictEqual(splash.footerTargets._next, 'first');
    assert.strictEqual(first.data._extensions._footer._previous._isEnabled, false);
    assert.strictEqual(first.data._extensions._footer._previous._customLink, '');
    assert.strictEqual(first.data._extensions._footer._next._isEnabled, true);
    assert.strictEqual(first.footerTargets._next, 'second');
    assert.strictEqual(first.data._extensions._footer._isEnabled, false);
    assert.strictEqual(second.data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(second.footerTargets._previous, 'first');
    assert.strictEqual(first.data._extensions._footer._previous._isRound, true);
    assert.strictEqual(first.data._extensions._footer._next._isRound, false);
    assert.strictEqual(first.data._extensions._footer._parent._isRound, true);
    assert(plan.proposals.some(function(entry) {
      return entry.node === 'first' && entry.path === '_extensions._footer._next._customLink' &&
        entry.previous === 'old' && entry.value.includes('Second');
    }));
    var fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'extension:footer:contentobject'; }).fields;
    assert.deepStrictEqual(fields.filter(function(field) { return field.pluginOption; }).map(function(field) { return field.path; }),
      ['_footer._previous._isRound', '_footer._next._isRound', '_footer._parent._isRound']);
  });
  it('handles one page and courses without Splash, without applying Footer when unselected', function() {
    var f = fixture();
    configureFooter(f);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    var first = plan.records.find(function(record) { return record.id === 'page'; });
    assert.strictEqual(first.data._extensions._footer._previous._isEnabled, false);
    assert.strictEqual(first.data._extensions._footer._next._isEnabled, false);
    f.draft.contentTree.children.push({ _id: 'second', type: 'page', title: 'Second', children: [] });
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'second'; }).footerTargets._previous, 'page');
    f.draft.pluginSelections.extensions = [];
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; }).footerTargets, undefined);
  });
  it('blocks Footer conversion when Splash appears after the first page or on multiple pages', function() {
    var f = fixture();
    splashFixture(f);
    configureFooter(f);
    var splashPage = f.draft.contentTree.children[0];
    f.draft.contentTree.children.unshift({ _id: 'first', type: 'page', title: 'First', children: [] });
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert(plan.errors.some(function(entry) { return entry.message.includes('must be the first page'); }));
    f.draft.contentTree.children.shift();
    var duplicate = copy(splashPage);
    duplicate._id = 'another-page';
    duplicate.children[0]._id = 'another-article';
    duplicate.children[0].children[0]._id = 'another-block';
    duplicate.children[0].children[0].children[0]._id = 'another-component';
    f.draft.contentTree.children.push(duplicate);
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert(plan.errors.some(function(entry) { return entry.message.includes('at most one Splash page'); }));
  });
});

describe('Splash navigation conversion', function() {
  it('exposes only declared Splash navigation options and preserves authored choices', function() {
    var f = fixture();
    splashFixture(f);
    f.draft.contentTree.children.push({ _id: 'next-page', type: 'page', title: 'Next', children: [] });
    component(f.draft)._naviagteHome = false;
    f.defaults['component:splash']._naviagteHome = true;
    f.defaults['component:splash']._naviagteToNextPage = false;
    f.version.contentSnapshot = copy(f.draft);
    var fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:splash'; }).fields;
    assert.deepStrictEqual(fields.filter(function(field) { return field.pluginOption; }).map(function(field) { return field.path; }),
      ['_naviagteHome', '_naviagteToNextPage']);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var record = plan.records.find(function(entry) { return entry.id === 'component'; });
    assert.strictEqual(record.data._naviagteHome, false);
    assert.strictEqual(record.data._naviagteToNextPage, false);
    assert.strictEqual(record.splashTarget, 'next-page');
    assert(plan.proposals.some(function(entry) { return entry.path === '_naviageTo' && entry.value.includes('Next'); }));
    delete f.catalog.component.splash.properties._naviagteHome;
    fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:splash'; }).fields;
    assert(!fields.some(function(field) { return field.path === '_naviagteHome'; }));
  });
  it('preserves an authored custom target and does not apply the last-page fallback', function() {
    var f = fixture();
    splashFixture(f);
    component(f.draft)._naviageTo = 'authored-target';
    component(f.draft)._naviagteHome = false;
    component(f.draft)._naviagteToNextPage = false;
    f.version.contentSnapshot = copy(f.draft);
    var record = planner.build(f.draft, f.version, f.catalog, f.defaults).records.find(function(entry) {
      return entry.id === 'component';
    });
    assert.strictEqual(record.data._naviageTo, 'authored-target');
    assert.strictEqual(record.data._naviagteHome, false);
    assert.strictEqual(record.data._naviagteToNextPage, false);
    assert.strictEqual(record.splashTarget, undefined);
  });
  it('uses the custom target instead of automatic next-page navigation on a first Splash page', function() {
    var f = fixture();
    splashFixture(f);
    f.draft.contentTree.children.push({ _id: 'next-page', type: 'page', title: 'Next', children: [] });
    component(f.draft)._naviageTo = 'authored-target';
    component(f.draft)._naviagteToNextPage = true;
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var record = plan.records.find(function(entry) { return entry.id === 'component'; });
    assert.strictEqual(record.data._naviageTo, 'authored-target');
    assert.strictEqual(record.data._naviagteToNextPage, false);
    assert(plan.proposals.some(function(entry) { return entry.path === '_naviagteToNextPage' && entry.value === false; }));
  });
  it('uses the main-menu setting on the last page even when configured defaults differ', function() {
    var f = fixture();
    splashFixture(f);
    f.defaults['component:splash']._naviagteHome = false;
    f.defaults['component:splash']._naviagteToNextPage = true;
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var record = plan.records.find(function(entry) { return entry.id === 'component'; });
    assert.strictEqual(record.data._naviagteHome, true);
    assert.strictEqual(record.data._naviagteToNextPage, false);
    assert(plan.proposals.some(function(entry) { return entry.path === '_naviagteHome' && entry.source === 'Last-page main menu'; }));
    delete f.catalog.component.splash.properties._naviagteHome;
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert(plan.errors.some(function(entry) { return entry.path === '_naviageTo' && entry.message.includes('main-menu'); }));
  });
});

describe('submenu conversion', function() {
  function withMenus(f) {
    splashFixture(f);
    configureFooter(f);
    component(f.draft)._naviageTo = 'authored-target';
    component(f.draft)._naviagteHome = true;
    component(f.draft)._naviagteToNextPage = true;
    var splash = f.draft.contentTree.children[0];
    f.draft.contentTree.children = [
      { _id: 'menu-a', type: 'submenu', title: 'A submenu', children: [
        { _id: 'page-a', type: 'page', title: 'A page', children: [] },
        { _id: 'page-b', type: 'page', title: 'B page', children: [] }
      ] },
      { _id: 'menu-b', type: 'submenu', title: 'B submenu', children: [
        { _id: 'page-c', type: 'page', title: 'C page', children: [] }
      ] },
      splash,
      { _id: 'page-d', type: 'page', title: 'D root page', children: [] }
    ];
    f.version.contentSnapshot = copy(f.draft);
  }

  function addHelpPage(f) {
    var source = f.draft.contentTree.children.find(function(node) { return node._id === 'page'; });
    var help = copy(source);
    help._id = 'help-page';
    help.title = 'Help';
    help.children[0]._id = 'help-article';
    help.children[0].title = 'Help article';
    help.children[0].children[0]._id = 'help-block';
    help.children[0].children[0].title = 'Help block';
    var helpComponent = help.children[0].children[0].children[0];
    helpComponent._id = 'help-component';
    helpComponent.title = 'Help component';
    helpComponent._component = 'graphic';
    if (f.catalog.component.splash) {
      f.catalog.component.graphic = copy(f.catalog.component.splash);
      f.catalog.component.graphic._id = 'help-graphic-id';
      f.catalog.component.graphic.component = 'graphic';
      f.catalog.component.graphic.name = 'adapt-contrib-graphic';
      f.defaults['component:graphic'] = copy(f.defaults['component:splash']);
    }
    f.draft.contentTree.children.push(help);
    f.version.contentSnapshot = copy(f.draft);
  }

  it('disables the main menu only in submenu courses and makes Help content optional in both', function() {
    var f = fixture();
    withMenus(f);
    addHelpPage(f);
    f.draft.contentTree.children[1].children.push(f.draft.contentTree.children.pop());
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var course = plan.records.find(function(record) { return record.id === 'course'; });
    assert.strictEqual(course.data._start._isMenuDisabled, true);
    assert.strictEqual(course.startTarget, 'page');
    ['help-page', 'help-article', 'help-block', 'help-component'].forEach(function(id) {
      var record = plan.records.find(function(entry) { return entry.id === id; });
      assert.strictEqual(record.data._isOptional, true, id);
      assert(plan.proposals.some(function(proposal) {
        return proposal.node === id && proposal.path === '_isOptional' &&
          proposal.value === true && proposal.source === 'Help page';
      }));
    });
    assert.notStrictEqual(plan.records.find(function(record) { return record.id === 'article'; }).data._isOptional, true);
    var help = f.draft.contentTree.children[1].children.pop();
    f.draft.contentTree.children = f.draft.contentTree.children.filter(function(node) { return node.type !== 'submenu'; });
    f.draft.contentTree.children.push(help);
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.notStrictEqual(plan.records.find(function(record) { return record.id === 'course'; })
      .data._start._isMenuDisabled, true);
    ['help-page', 'help-article', 'help-block', 'help-component'].forEach(function(id) {
      assert.strictEqual(plan.records.find(function(record) { return record.id === id; }).data._isOptional, true);
    });
    assert.notStrictEqual(plan.records.find(function(record) { return record.id === 'article'; }).data._isOptional, true);
  });

  it('starts on the first saved page when a submenu course has no Splash', function() {
    var f = fixture();
    f.draft.contentTree.children.unshift({ _id: 'menu', type: 'submenu', title: 'Menu', children: [
      { _id: 'first-menu-page', type: 'page', title: 'First submenu page', children: [] }
    ] });
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var course = plan.records.find(function(record) { return record.id === 'course'; });
    assert.strictEqual(course.data._start._isEnabled, true);
    assert.strictEqual(course.data._start._isMenuDisabled, true);
    assert.notStrictEqual(course.data._start._force, true);
    assert.strictEqual(course.startTarget, 'first-menu-page');
  });

  it('reports incompatible main menu and Help optional schemas before conversion', function() {
    var f = fixture();
    withMenus(f);
    addHelpPage(f);
    delete f.catalog.core.course.properties._start.properties._isMenuDisabled;
    delete f.catalog.core.block.properties._isOptional;
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert(plan.errors.some(function(entry) { return entry.path === '_start._isMenuDisabled'; }));
    assert(plan.errors.some(function(entry) { return entry.node === 'help-block' && entry.path === '_isOptional'; }));
  });

  it('disables Menu Button on submenu pages but not on menu containers or root pages', function() {
    var f = fixture();
    withMenus(f);
    configureMenuButton(f);
    f.draft.contentTree.children[0].children[1]._extensions = {
      _menuButton: { _isEnabled: true, _icon: 'grid' }
    };
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    function record(id) { return plan.records.find(function(entry) { return entry.id === id; }); }
    ['page-a', 'page-b', 'page-c'].forEach(function(id) {
      assert.strictEqual(record(id).data._extensions._menuButton._isEnabled, false);
      assert(plan.proposals.some(function(proposal) {
        return proposal.node === id && proposal.path === '_extensions._menuButton._isEnabled' &&
          proposal.value === false && proposal.source === 'Submenu page';
      }));
    });
    ['menu-a', 'menu-b', 'page', 'page-d'].forEach(function(id) {
      assert.strictEqual(record(id).data._extensions._menuButton._isEnabled, true);
    });
    assert.strictEqual(record('page-b').data._extensions._menuButton._icon, 'grid');
  });

  it('disables Menu Button on submenu pages without a Splash page', function() {
    var f = fixture();
    f.draft.contentTree.children = [{ _id: 'menu', type: 'submenu', title: 'Menu',
      children: f.draft.contentTree.children }];
    configureMenuButton(f);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; })
      .data._extensions._menuButton._isEnabled, false);
  });

  it('disables Overall Progress on Help pages in standard and submenu courses only when selected', function() {
    [false, true].forEach(function(withSubmenu) {
      var f = fixture();
      if (withSubmenu) withMenus(f);
      addHelpPage(f);
      if (withSubmenu) f.draft.contentTree.children[1].children.push(f.draft.contentTree.children.pop());
      configureIntroductionProgress(f);
      var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.errors, []);
      var help = plan.records.find(function(record) { return record.id === 'help-page'; });
      assert.strictEqual(help.data._extensions._overallProgress._isEnabled, false);
      assert.strictEqual(help.data._extensions._sectionProgress._isEnabled, true);
      assert.strictEqual(help.data._extensions._overallProgress.label, 'keep');
      assert(plan.proposals.some(function(proposal) {
        return proposal.node === 'help-page' && proposal.path === '_extensions._overallProgress._isEnabled' &&
          proposal.value === false && proposal.source === 'Help page';
      }));
      f.draft.pluginSelections.extensions = f.draft.pluginSelections.extensions.filter(function(key) {
        return key !== 'overallProgress';
      });
      f.version.contentSnapshot = copy(f.draft);
      plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      help = plan.records.find(function(record) { return record.id === 'help-page'; });
      assert.strictEqual(help.data._extensions._overallProgress, undefined);
    });
  });

  it('reports incompatible Menu Button and Overall Progress page schemas before conversion', function() {
    var f = fixture();
    withMenus(f);
    addHelpPage(f);
    configureMenuButton(f);
    configureIntroductionProgress(f);
    delete f.catalog.extension.menuButton.properties.pluginLocations.properties.contentobject
      .properties._menuButton.properties._isEnabled;
    delete f.catalog.extension.overallProgress.properties.pluginLocations.properties.contentobject
      .properties._overallProgress.properties._isEnabled;
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert(plan.errors.some(function(entry) {
      return entry.node === 'page-b' && entry.path === '_extensions._menuButton._isEnabled';
    }));
    assert(plan.errors.some(function(entry) {
      return entry.node === 'help-page' && entry.path === '_extensions._overallProgress._isEnabled';
    }));
  });

  it('preserves article and block progress indicator defaults in submenu courses, with or without Splash', function() {
    [false, true].forEach(function(hasSplash) {
      var f = fixture();
      if (hasSplash) withMenus(f);
      else f.draft.contentTree.children = [
        { _id: 'menu', type: 'submenu', title: 'Menu', children: f.draft.contentTree.children }
      ];
      configureProgress(f);
      var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.errors, []);
      plan.records.filter(function(record) {
        return ['course', 'contentobject', 'article', 'block', 'component'].includes(record.type);
      }).forEach(function(record) {
        var progress = record.data._extensions._pageLevelProgress;
        var disabled = ['article', 'block'].includes(record.type);
        assert.strictEqual(progress._isEnabled, !disabled, record.id);
        assert.strictEqual(progress._isCompletionIndicatorEnabled, false);
      });
    });
  });

  it('leaves standard courses and unselected progress extensions unchanged', function() {
    var f = fixture();
    configureProgress(f);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert.strictEqual(plan.records.find(function(record) { return record.type === 'article'; })
      .data._extensions._pageLevelProgress._isEnabled, false);
    assert.strictEqual(plan.records.find(function(record) { return record.type === 'block'; })
      .data._extensions._pageLevelProgress._isEnabled, false);
    withMenus(f);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert(!plan.proposals.some(function(proposal) { return proposal.source === 'Submenu progress indicators'; }));
  });

  it('disables selected progress extensions only on the submenu Splash and first submenu page', function() {
    var f = fixture();
    withMenus(f);
    configureIntroductionProgress(f);
    f.draft.contentTree.children[2]._extensions = { _sectionProgress: { _isEnabled: true, label: 'authored' } };
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    function record(id) { return plan.records.find(function(entry) { return entry.id === id; }); }
    ['sectionProgress', 'overallProgress'].forEach(function(key) {
      ['page', 'page-a'].forEach(function(id) {
        assert.strictEqual(record(id).data._extensions['_' + key]._isEnabled, false);
        assert(plan.proposals.some(function(proposal) {
          return proposal.node === id && proposal.path === '_extensions._' + key + '._isEnabled' &&
            proposal.value === false && proposal.source === 'Submenu introduction';
        }));
      });
      ['course', 'page-b', 'page-c', 'page-d', 'menu-a'].forEach(function(id) {
        assert.strictEqual(record(id).data._extensions['_' + key]._isEnabled, true);
      });
    });
    assert.strictEqual(record('page').data._extensions._sectionProgress.label, 'authored');
  });

  it('leaves progress unchanged without both a submenu and Splash and reports unsupported page settings', function() {
    var f = fixture();
    splashFixture(f);
    configureIntroductionProgress(f);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; })
      .data._extensions._sectionProgress._isEnabled, true);
    f = fixture();
    f.draft.contentTree.children = [{ _id: 'menu', type: 'submenu', title: 'Menu',
      children: f.draft.contentTree.children }];
    configureIntroductionProgress(f);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; })
      .data._extensions._overallProgress._isEnabled, true);
    f = fixture();
    withMenus(f);
    configureIntroductionProgress(f);
    delete f.catalog.extension.sectionProgress.properties.pluginLocations.properties.contentobject
      .properties._sectionProgress.properties._isEnabled;
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert(plan.errors.some(function(entry) {
      return entry.node === 'page' && entry.path === '_extensions._sectionProgress._isEnabled';
    }));
  });

  it('only changes selected progress extensions', function() {
    var f = fixture();
    withMenus(f);
    configureIntroductionProgress(f);
    f.draft.pluginSelections.extensions = ['footer', 'sectionProgress'];
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var page = plan.records.find(function(record) { return record.id === 'page-a'; });
    assert.strictEqual(page.data._extensions._sectionProgress._isEnabled, false);
    assert.strictEqual(page.data._extensions._overallProgress, undefined);
  });

  it('creates menu and page hierarchy, sends Splash to the first submenu and stops Next at submenu boundaries', function() {
    var f = fixture();
    withMenus(f);
    f.catalog.extension.hero = heroFixture();
    f.draft.pluginSelections.extensions.push('hero');
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    function record(id) { return plan.records.find(function(entry) { return entry.id === id; }); }
    assert.strictEqual(record('menu-a').data._type, 'menu');
    assert.strictEqual(record('menu-a').parent, 'course');
    assert.strictEqual(record('page-a').data._type, 'page');
    assert.strictEqual(record('page-a').parent, 'menu-a');
    assert.strictEqual(record('page-c').parent, 'menu-b');
    assert.strictEqual(record('page-d').parent, 'course');
    assert.strictEqual(record('course').startTarget, 'page');
    assert.strictEqual(record('component').splashTarget, 'page-a');
    assert.strictEqual(record('component').data._naviagteToNextPage, false);
    assert.strictEqual(record('component').data._naviagteHome, false);
    assert.strictEqual(record('page-a').data._isHidden, true);
    assert.strictEqual(record('page-a').data._extensions._footer._isEnabled, true);
    assert.strictEqual(record('page-a').data._extensions._footer._parent._isEnabled, true);
    assert.strictEqual(record('page-a').data._extensions._footer._previous._isEnabled, false);
    assert.strictEqual(record('page-a').data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(record('page-b').data._extensions._footer._previous._isEnabled, false);
    assert.strictEqual(record('page-b').data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(record('page-b').data._extensions._footer._next._customLink, '');
    assert(!record('page-b').footerTargets || !record('page-b').footerTargets._next);
    assert.strictEqual(record('page-c').footerTargets._previous, 'page-b');
    assert.strictEqual(record('page-c').data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(record('page-c').data._extensions._footer._next._customLink, '');
    assert.strictEqual(record('page-d').data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(record('menu-a').data._extensions._footer._isEnabled, true);
    assert.strictEqual(record('menu-a').data._extensions._footer._previous._isEnabled, true);
    assert.strictEqual(record('menu-a').footerTargets._previous, 'page-a');
    assert.strictEqual(record('menu-a').data._extensions._footer._previous.title,
      'Select here to return to the introduction screen.');
    assert.strictEqual(record('menu-a').data._extensions._footer._previous._isRound, false);
    assert.strictEqual(record('menu-a').data._extensions._footer._parent._isEnabled, false);
    assert.strictEqual(record('menu-a').data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(record('menu-a').data._extensions._hero._isEnabled, false);
  });

  it('reports an empty first submenu or a Splash inside a submenu before conversion', function() {
    var f = fixture();
    withMenus(f);
    f.draft.contentTree.children[0].children = [];
    f.version.contentSnapshot = copy(f.draft);
    assert(planner.build(f.draft, f.version, f.catalog, f.defaults).errors.some(function(error) {
      return error.message.includes('first submenu');
    }));
    var splash = f.draft.contentTree.children.splice(2, 1)[0];
    f.draft.contentTree.children[0].children.push(splash);
    f.version.contentSnapshot = copy(f.draft);
    assert(planner.build(f.draft, f.version, f.catalog, f.defaults).errors.some(function(error) {
      return error.message.includes('course root');
    }));
  });

  it('stops Next at the last submenu page without Splash while preserving other page links', function() {
    var f = fixture();
    configureFooter(f);
    f.draft.contentTree.children.push(
      { _id: 'menu', type: 'submenu', title: 'Menu', children: [
        { _id: 'child', type: 'page', title: 'Child', children: [] },
        { _id: 'last-child', type: 'page', title: 'Last child', children: [] }
      ] },
      { _id: 'after', type: 'page', title: 'After', children: [] }
    );
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var child = plan.records.find(function(record) { return record.id === 'child'; });
    assert.strictEqual(child.footerTargets._previous, 'page');
    assert.strictEqual(child.footerTargets._next, 'last-child');
    var lastChild = plan.records.find(function(record) { return record.id === 'last-child'; });
    assert.strictEqual(lastChild.footerTargets._previous, 'child');
    assert.strictEqual(lastChild.data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(lastChild.data._extensions._footer._next._customLink, '');
    assert.strictEqual(lastChild.footerTargets._next, undefined);
  });

  it('links the Help button and uses native previous navigation on a standard Help page', function() {
    var f = fixture();
    configureFooter(f);
    configureHelp(f);
    f.draft.contentTree.children.push(
      { _id: 'next-page', type: 'page', title: 'Next', children: [] },
      { _id: 'help-page', type: 'page', title: 'Help', children: [], _extensions: { _footer: {
        _isEnabled: false, _previous: { _isEnabled: false, _customLink: 'old' },
        _next: { _isEnabled: true, _customLink: 'old' }, _parent: { _isEnabled: true, _customLink: 'old' }
      } } }
    );
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var course = plan.records.find(function(record) { return record.type === 'course'; });
    var help = plan.records.find(function(record) { return record.id === 'help-page'; });
    assert.strictEqual(course.data._extensions._help._navItem._customLink, '000000000000000000000001');
    assert.strictEqual(course.helpTarget, 'help-page');
    assert.strictEqual(help.data._extensions._footer._isEnabled, true);
    assert.strictEqual(help.data._extensions._footer._previous._isEnabled, true);
    assert.strictEqual(help.data._extensions._footer._previous._customLink, '');
    assert.strictEqual(help.data._extensions._footer._next._isEnabled, false);
    assert.strictEqual(help.data._extensions._footer._parent._isEnabled, false);

    f.draft.pluginSelections.extensions = ['footer'];
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    course = plan.records.find(function(record) { return record.type === 'course'; });
    assert.strictEqual(course.helpTarget, undefined);

    f.draft.pluginSelections.extensions = ['help'];
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    course = plan.records.find(function(record) { return record.type === 'course'; });
    assert.strictEqual(plan.errors.length, 0);
    assert.strictEqual(course.helpTarget, 'help-page');
  });

  it('persists the Page Level Progress location defaults when converting a submenu course', async function() {
    var h = harness();
    withMenus(h.fixture);
    configureProgress(h.fixture);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.componenttype[0] = copy(h.fixture.catalog.component.splash);
    h.records.extensiontype = ['footer', 'pageLevelProgress'].map(function(key) {
      return Object.assign({ extension: key }, copy(h.fixture.catalog.extension[key]));
    });
    h.records.lightcourseconfig[0].conversionDefaults = copy(h.fixture.defaults);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    assert.strictEqual(h.records.article[0]._extensions._pageLevelProgress._isEnabled, false);
    assert.strictEqual(h.records.block[0]._extensions._pageLevelProgress._isEnabled, false);
    assert.strictEqual(h.records.component[0]._extensions._pageLevelProgress._isEnabled, true);
    assert.strictEqual(h.records.contentobject[0]._extensions._pageLevelProgress._isEnabled, true);
  });

  it('persists the first page start target for a submenu course without Splash', async function() {
    var h = harness();
    h.fixture.draft.contentTree.children.unshift({ _id: 'menu', type: 'submenu', title: 'Menu', children: [
      { _id: 'first-menu-page', type: 'page', title: 'First submenu page', children: [] }
    ] });
    h.fixture.version.contentSnapshot = copy(h.fixture.draft);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var firstPage = h.records.contentobject.find(function(node) { return node.title === 'First submenu page'; });
    assert.strictEqual(h.records.course[0]._start._isEnabled, true);
    assert.strictEqual(h.records.course[0]._start._isMenuDisabled, true);
    assert.strictEqual(h.records.course[0]._start._startIds[0]._id, firstPage._id);
  });

  it('persists optional Help content in a standard course without the Help extension', async function() {
    var h = harness();
    addHelpPage(h.fixture);
    configureIntroductionProgress(h.fixture);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.extensiontype = ['sectionProgress', 'overallProgress'].map(function(key) {
      return Object.assign({ extension: key }, copy(h.fixture.catalog.extension[key]));
    });
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    ['contentobject', 'article', 'block', 'component'].forEach(function(type) {
      var node = h.records[type].find(function(item) { return item.title === (type === 'contentobject' ?
        'Help' : 'Help ' + type); });
      assert.strictEqual(node._isOptional, true, type);
    });
    assert.strictEqual(h.records.contentobject.find(function(node) { return node.title === 'Help'; })
      ._extensions._overallProgress._isEnabled, false);
    assert.strictEqual(h.records.contentobject.find(function(node) { return node.title === 'Page'; })
      ._extensions._overallProgress._isEnabled, true);
    assert.notStrictEqual(h.records.course[0]._start && h.records.course[0]._start._isMenuDisabled, true);
    assert.notStrictEqual(h.records.component.find(function(node) { return node.title === 'Graphic'; })._isOptional, true);
  });

  it('persists generated submenu, page and navigation IDs', async function() {
    var h = harness();
    withMenus(h.fixture);
    configureIntroductionProgress(h.fixture);
    configureMenuButton(h.fixture);
    configureHelp(h.fixture);
    h.fixture.catalog.extension.hero = heroFixture();
    h.fixture.draft.pluginSelections.extensions.push('hero');
    addHelpPage(h.fixture);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.componenttype = [copy(h.fixture.catalog.component.splash), copy(h.fixture.catalog.component.graphic)];
    h.records.extensiontype = ['footer', 'hero', 'help', 'sectionProgress', 'overallProgress', 'menuButton'].map(function(key) {
      return Object.assign({ extension: key }, copy(h.fixture.catalog.extension[key]));
    });
    h.records.lightcourseconfig[0].conversionDefaults = copy(h.fixture.defaults);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var menu = h.records.contentobject.find(function(node) { return node.title === 'A submenu'; });
    var page = h.records.contentobject.find(function(node) { return node.title === 'A page'; });
    var second = h.records.contentobject.find(function(node) { return node.title === 'B page'; });
    var third = h.records.contentobject.find(function(node) { return node.title === 'C page'; });
    var splash = h.records.contentobject.find(function(node) { return node.title === 'Page'; });
    var help = h.records.contentobject.find(function(node) { return node.title === 'Help'; });
    assert.strictEqual(menu._type, 'menu');
    assert.strictEqual(menu._parentId, h.records.course[0]._id);
    assert.strictEqual(page._parentId, menu._id);
    assert.strictEqual(h.records.component[0].properties._naviageTo, page._id);
    assert.strictEqual(page._isHidden, true);
    ['sectionProgress', 'overallProgress'].forEach(function(key) {
      assert.strictEqual(splash._extensions['_' + key]._isEnabled, false);
      assert.strictEqual(page._extensions['_' + key]._isEnabled, false);
      assert.strictEqual(second._extensions['_' + key]._isEnabled, true);
      assert.strictEqual(h.records.course[0]._extensions['_' + key]._isEnabled, true);
    });
    assert.strictEqual(page._extensions._footer._parent._isEnabled, true);
    assert.strictEqual(page._extensions._footer._previous._isEnabled, false);
    assert.strictEqual(page._extensions._footer._next._isEnabled, false);
    assert.strictEqual(second._extensions._footer._previous._isEnabled, false);
    assert.strictEqual(second._extensions._footer._next._isEnabled, false);
    assert.strictEqual(second._extensions._footer._next._customLink, '');
    assert.strictEqual(third._extensions._footer._previous._customLink, second._id);
    assert.strictEqual(third._extensions._footer._next._isEnabled, false);
    assert.strictEqual(third._extensions._footer._next._customLink, '');
    assert.strictEqual(menu._extensions._footer._previous._isEnabled, true);
    assert.strictEqual(menu._extensions._footer._previous._customLink, page._id);
    assert.strictEqual(menu._extensions._footer._previous.title, 'Select here to return to the introduction screen.');
    assert.strictEqual(menu._extensions._footer._previous._isRound, false);
    assert.strictEqual(menu._extensions._footer._parent._isEnabled, false);
    assert.strictEqual(menu._extensions._footer._next._isEnabled, false);
    assert.strictEqual(menu._extensions._hero._isEnabled, false);
    assert.strictEqual(h.records.course[0]._extensions._help._navItem._customLink, help._id);
    assert.strictEqual(help._extensions._overallProgress._isEnabled, false);
    [page, second, third].forEach(function(node) {
      assert.strictEqual(node._extensions._menuButton._isEnabled, false);
    });
    assert.strictEqual(splash._extensions._menuButton._isEnabled, true);
    assert.strictEqual(menu._extensions._menuButton._isEnabled, true);
    assert.strictEqual(h.records.course[0]._start._isMenuDisabled, true);
    assert.strictEqual(h.records.course[0]._start._startIds[0]._id, splash._id);
    assert.strictEqual(help._isOptional, true);
    assert.strictEqual(h.records.article.find(function(node) { return node.title === 'Help article'; })._isOptional, true);
    assert.strictEqual(h.records.block.find(function(node) { return node.title === 'Help block'; })._isOptional, true);
    assert.strictEqual(h.records.component.find(function(node) { return node.title === 'Help component'; })._isOptional, true);
    assert.strictEqual(help._extensions._footer._previous._isEnabled, true);
    assert.strictEqual(help._extensions._footer._previous._customLink, '');
    assert.strictEqual(help._extensions._footer._next._isEnabled, false);
    assert.strictEqual(help._extensions._footer._parent._isEnabled, false);
  });
});

describe('Flow and Timeline navigation conversion defaults', function() {
  function navigationFixture(type) {
    var f = fixture();
    var plugin = f.catalog.component.graphic;
    plugin.component = type;
    plugin.properties._navigation = { type: 'object', properties: {
      _isEnabled: { type: 'boolean', default: false, inputType: 'Checkbox' },
      _showFirstItem: { type: 'boolean', default: false, inputType: 'Checkbox' },
      _icon: { type: 'string', default: '', inputType: { type: 'Select', options: ['plus', 'arrow-down'] } },
      buttonText: { type: 'string', default: '', inputType: 'Text' },
      ariaLabel: { type: 'string', default: '', inputType: 'Text' },
      instruction: { type: 'string', default: '', inputType: 'Text' }
    } };
    f.catalog.component = {};
    f.catalog.component[type] = plugin;
    component(f.draft)._component = type;
    f.defaults['component:' + type] = Object.assign({}, f.defaults['component:graphic'], {
      '_navigation._isEnabled': true,
      '_navigation._showFirstItem': false,
      '_navigation._icon': 'plus',
      '_navigation.buttonText': 'Next',
      '_navigation.ariaLabel': 'Show next item',
      '_navigation.instruction': 'Select next'
    });
    delete f.defaults['component:graphic'];
    f.version.contentSnapshot = copy(f.draft);
    return f;
  }
  ['flow', 'timeline'].forEach(function(type) {
    it('exposes all declared ' + type + ' navigation fields once without a duplicate container', function() {
      var f = navigationFixture(type);
      f.catalog.component[type].properties._navigation.required = true;
      f.catalog.component[type].properties._navigation.properties._isEnabled.required = true;
      var fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:' + type; }).fields;
      assert.strictEqual(fields.find(function(field) { return field.path === '_navigation'; }).hidden, true);
      var navigation = fields.filter(function(field) { return field.navigationOption; });
      assert.deepStrictEqual(navigation.map(function(field) { return field.path; }),
        Object.keys(f.defaults['component:' + type]).filter(function(key) { return key.startsWith('_navigation.'); }));
      navigation.forEach(function(field) { assert.strictEqual(field.hidden, false); });
      assert.strictEqual(schema.valid(navigation.find(function(field) { return field.path === '_navigation._icon'; }).schema, 'invalid'), false);
      delete f.catalog.component[type].properties._navigation.properties.ariaLabel;
      fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:' + type; }).fields;
      assert(!fields.some(function(field) { return field.path === '_navigation.ariaLabel'; }));
    });
    it('fills only enabled missing/invalid ' + type + ' navigation settings and preserves authored values', function() {
      var f = navigationFixture(type);
      var original = JSON.stringify(f);
      var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.errors, []);
      var data = plan.records.find(function(record) { return record.id === 'component'; }).data;
      assert.deepStrictEqual(data._navigation, {
        _isEnabled: true, _showFirstItem: false, _icon: 'plus',
        buttonText: 'Next', ariaLabel: 'Show next item', instruction: 'Select next'
      });
      assert.strictEqual(plan.proposals.filter(function(proposal) { return proposal.path.startsWith('_navigation.'); }).length, 6);
      assert.strictEqual(JSON.stringify(f), original);
      component(f.draft)._navigation = {
        _isEnabled: false, _showFirstItem: true, _icon: 'invalid',
        buttonText: 'Continue', ariaLabel: '', other: 'Keep'
      };
      delete f.defaults['component:' + type]['_navigation.instruction'];
      f.version.contentSnapshot = copy(f.draft);
      plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.errors, []);
      data = plan.records.find(function(record) { return record.id === 'component'; }).data;
      assert.deepStrictEqual(data._navigation, {
        _isEnabled: false, _showFirstItem: true, _icon: 'plus',
        buttonText: 'Continue', ariaLabel: 'Show next item', other: 'Keep'
      });
      assert.deepStrictEqual(plan.proposals.filter(function(proposal) { return proposal.path.startsWith('_navigation.'); })
        .map(function(proposal) { return proposal.path; }), ['_navigation._icon', '_navigation.ariaLabel']);
      delete component(f.draft)._navigation;
      f.version.contentSnapshot = copy(f.draft);
      f.defaults['component:' + type] = {};
      data = planner.build(f.draft, f.version, f.catalog, f.defaults).records.find(function(record) { return record.id === 'component'; }).data;
      assert.strictEqual(data._navigation, undefined);
    });
  });
  it('does not expose optional navigation fields on unrelated components', function() {
    var f = navigationFixture('other');
    var fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:other'; }).fields;
    assert(!fields.some(function(field) { return field.navigationOption || field.path.startsWith('_navigation'); }));
  });
});

['immersive-video', 'media'].forEach(function(componentType) {
describe(componentType + ' MP4 conversion defaults', function() {
  var VIDEO = 'abababababababababababab';
  function immersive(f) {
    var plugin = f.catalog.component.graphic;
    plugin.component = componentType;
    plugin.properties._media = { type: 'object', required: true, properties: {
      mp4: { type: 'string', default: '', inputType: 'Asset:video', title: 'MP4 Link' },
      webm: { type: 'string', default: '', inputType: 'Asset:video' },
      poster: { type: 'string', default: '', inputType: 'Asset:image' }
    } };
    delete f.catalog.component.graphic;
    f.catalog.component[componentType] = plugin;
    f.defaults['component:' + componentType] = Object.assign({}, f.defaults['component:graphic'], { '_media.mp4': VIDEO });
    delete f.defaults['component:graphic'];
    component(f.draft)._component = componentType;
    f.version.contentSnapshot = copy(f.draft);
  }
  it('exposes MP4 once alongside the poster without a duplicate media container or unrelated optional video fields', function() {
    var f = fixture();
    immersive(f);
    var fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:' + componentType; }).fields;
    var mp4 = fields.filter(function(field) { return field.path === '_media.mp4'; });
    assert.strictEqual(mp4.length, 1);
    assert.strictEqual(mp4[0].hidden, false);
    assert.strictEqual(mp4[0].videoPlaceholder, true);
    assert.strictEqual(mp4[0].schema.inputType, 'Asset:video');
    assert.strictEqual(fields.find(function(field) { return field.path === '_media'; }).hidden, true);
    assert(!fields.some(function(field) { return field.path === '_media.webm'; }));
    delete f.catalog.component[componentType].properties._media.properties.mp4;
    fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:' + componentType; }).fields;
    assert(!fields.some(function(field) { return field.videoPlaceholder; }));
  });
  it('fills configured missing MP4 values without changing source content, existing videos or sibling media', function() {
    var f = fixture();
    immersive(f);
    var original = JSON.stringify(f);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._media.mp4, VIDEO);
    assert.strictEqual(JSON.stringify(f), original);
    component(f.draft)._media = { mp4: 'https://example.test/authored.mp4', webm: '', poster: '' };
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._media, component(f.draft)._media);
    assert(!plan.proposals.some(function(proposal) { return proposal.path.startsWith('_media.'); }));
    component(f.draft)._media.mp4 = '';
    delete f.defaults['component:' + componentType]['_media.mp4'];
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._media.mp4, '');
  });
  function videoHarness() {
    var h = harness();
    immersive(h.fixture);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0].contentSnapshot = copy(h.fixture.draft);
    h.records.lightcourseasset.push({ _id: VIDEO, _tenantId: 'tenant', title: 'Video placeholder',
      filename: 'placeholder.mp4', mimeType: 'video/mp4', repository: 'localfs', path: 'bank/placeholder.mp4' });
    return h;
  }
  it('reviews a wrong-MIME authored MP4 replacement and migrates the configured video asset', async function() {
    var h = videoHarness();
    component(h.fixture.draft)._media = { mp4: ASSET };
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0].contentSnapshot = copy(h.fixture.draft);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    assert(review.body.proposals.some(function(proposal) { return proposal.path === '_media.mp4' && proposal.value === VIDEO; }));
    var converted = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(converted.status, 200, converted.body.message);
    assert.strictEqual(h.records.component[0].properties._media.mp4, 'course/assets/copied.png');
  });
  it('blocks an invalid video placeholder rather than reporting a successful preflight', async function() {
    var h = videoHarness();
    h.records.lightcourseasset[1].mimeType = 'image/png';
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, false);
    assert(review.body.errors.some(function(error) { return error.path === '_media.mp4' && /video/.test(error.message); }));
  });
  it('previews video bank selections as playable video while retaining audio and image previews', function() {
    var handlebars = require('handlebars').create();
    handlebars.registerHelper('ifValueEquals', function(value, expected, options) {
      return value === expected ? options.fn(this) : options.inverse(this);
    });
    handlebars.registerHelper('t', function(key) { return key; });
    var render = handlebars.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseEditor/templates/lightCourseBankAssetField.hbs'), 'utf8'));
    ['video', 'audio', 'image'].forEach(function(type) {
      var html = render({ hasValue: true, assetId: VIDEO, assetType: type });
      assert(html.includes(type === 'image' ? '<img ' : '<' + type + ' controls'));
      assert(html.includes('api/content/lightcourseasset/' + VIDEO + (type === 'image' ? '/thumb' : '/serve')));
      if (type !== 'image') assert(!html.includes('<img '));
    });
  });
});

});

describe('Video Wall item MP4 conversion defaults', function() {
  var VIDEO = 'abababababababababababab';
  function videoWall(f, items) {
    var plugin = f.catalog.component.graphic;
    plugin.component = 'videoWall';
    plugin.properties._items = { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' },
      _media: { type: 'object', properties: {
        mp4: { type: 'string', default: 'https://example.test/installed.mp4', inputType: 'Asset:video' },
        poster: { type: 'string', inputType: 'Asset:image' },
        webm: { type: 'string', inputType: 'Asset:video' }
      } }
    } } };
    f.catalog.component = { videoWall: plugin };
    f.defaults['component:videoWall'] = Object.assign({}, f.defaults['component:graphic'], { '_items[]._media.mp4': VIDEO });
    delete f.defaults['component:graphic'];
    component(f.draft)._component = 'videoWall';
    if (items !== undefined) component(f.draft)._items = copy(items);
    f.version.contentSnapshot = copy(f.draft);
  }
  it('shows the declared item MP4 even with an installed default, without duplicate media or invented fields', function() {
    var f = fixture();
    videoWall(f);
    var fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:videoWall'; }).fields;
    var videos = fields.filter(function(field) { return field.videoPlaceholder; });
    assert.strictEqual(videos.length, 1);
    assert.strictEqual(videos[0].path, '_items[]._media.mp4');
    assert.strictEqual(videos[0].hidden, false);
    assert(!fields.some(function(field) { return field.path === '_items[]._media' || field.path === '_items[]._media.webm'; }));
    delete f.catalog.component.videoWall.properties._items.items.properties._media.properties.mp4;
    fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:videoWall'; }).fields;
    assert(!fields.some(function(field) { return field.videoPlaceholder; }));
  });
  it('fills only missing item videos while preserving text, media siblings, order and the source', function() {
    var f = fixture();
    videoWall(f, [{ title: 'First' }, { title: 'Second', _media: { mp4: '', poster: '' } },
      { title: 'Third', _media: { mp4: 'https://example.test/authored.mp4' } }]);
    var original = JSON.stringify(f), plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._items,
      [{ title: 'First', _media: { mp4: VIDEO } }, { title: 'Second', _media: { mp4: VIDEO, poster: '' } },
        { title: 'Third', _media: { mp4: 'https://example.test/authored.mp4' } }]);
    assert.strictEqual(plan.proposals.filter(function(proposal) { return proposal.path.endsWith('.mp4'); }).length, 2);
    assert.strictEqual(JSON.stringify(f), original);
    delete f.defaults['component:videoWall']['_items[]._media.mp4'];
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._items, component(f.draft)._items);
  });
  it('does not create items or populate empty item arrays', function() {
    [undefined, []].forEach(function(items) {
      var f = fixture();
      videoWall(f, items);
      var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._items, items);
    });
  });
  it('reviews wrong-MIME and unavailable item videos and migrates approved replacements', async function() {
    var h = harness();
    videoWall(h.fixture, [{ title: 'Image instead', _media: { mp4: ASSET } },
      { title: 'Missing', _media: { mp4: 'ffffffffffffffffffffffff' } },
      { title: 'Valid', _media: { mp4: 'https://example.test/keep.mp4' } }]);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0].contentSnapshot = copy(h.fixture.draft);
    h.records.lightcourseasset.push({ _id: VIDEO, _tenantId: 'tenant', mimeType: 'video/mp4',
      filename: 'placeholder.mp4', repository: 'localfs', path: 'bank/placeholder.mp4' });
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    assert.strictEqual(review.body.proposals.filter(function(proposal) {
      return proposal.path.endsWith('.mp4') && proposal.value === VIDEO;
    }).length, 2);
    var converted = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(converted.status, 200, converted.body.message);
    assert.deepStrictEqual(h.records.component[0].properties._items.map(function(item) { return item._media.mp4; }),
      ['course/assets/copied.png', 'course/assets/copied.png', 'https://example.test/keep.mp4']);
  });
});

describe('Completion conversion defaults', function() {
  it('exposes only the installed course-level title and body as optional text fallbacks', function() {
    var f = fixture();
    configureCompletion(f);
    var group = catalogs.definitions(f.catalog).find(function(entry) {
      return entry.key === 'extension:completion:course';
    });
    var fields = group.fields.filter(function(field) { return field.pluginOption; });
    assert.deepStrictEqual(fields.map(function(field) { return field.path; }), ['_completion.title', '_completion.body']);
    assert(fields.every(function(field) { return !field.hidden; }));
    assert.strictEqual(fields[1].schema.inputType, 'TextArea');
    assert.strictEqual(schema.pluginOption({ type: 'string' }, '_completion.instruction', group.key), false);
    assert.strictEqual(schema.pluginOption({ type: 'string' }, '_completion.title', 'extension:completion:contentobject'), false);
    assert.strictEqual(schema.pluginOption({ type: 'boolean' }, '_completion.title', group.key), false);
  });

  it('reviews configured text including HTML and leaves unconfigured or unselected fields alone', function() {
    var f = fixture();
    configureCompletion(f);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    var completion = plan.records.find(function(record) { return record.id === 'course'; }).data._extensions._completion;
    assert.strictEqual(completion.title, '');
    assert.strictEqual(completion.body, '');
    f.defaults['extension:completion:course'] = {
      '_completion.title': 'Great job!', '_completion.body': '<p>You have completed this <em>module</em>.</p>'
    };
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    completion = plan.records.find(function(record) { return record.id === 'course'; }).data._extensions._completion;
    assert.strictEqual(completion.title, 'Great job!');
    assert.strictEqual(completion.body, '<p>You have completed this <em>module</em>.</p>');
    ['title', 'body'].forEach(function(key) {
      assert(plan.proposals.some(function(proposal) {
        return proposal.node === 'course' && proposal.path === '_extensions._completion.' + key &&
          proposal.value === f.defaults['extension:completion:course']['_completion.' + key] &&
          proposal.source === 'Conversion Defaults';
      }));
    });
    assert.strictEqual(completion.instruction, '');
    f.draft.pluginSelections.extensions = [];
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'course'; }).data._extensions._completion, undefined);
  });

  it('persists approved Completion title and body in the converted Full Course', async function() {
    var h = harness();
    configureCompletion(h.fixture);
    h.fixture.defaults['extension:completion:course'] = {
      '_completion.title': 'Great job!', '_completion.body': '<p>Well done!</p>'
    };
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.extensiontype = [Object.assign({ extension: 'completion' }, copy(h.fixture.catalog.extension.completion))];
    h.records.lightcourseconfig[0].conversionDefaults = copy(h.fixture.defaults);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var completion = h.records.course[0]._extensions._completion;
    assert.strictEqual(completion.title, 'Great job!');
    assert.strictEqual(completion.body, '<p>Well done!</p>');
  });
});

describe('Tile Menu, Hero and Styling conversion options', function() {
  function pluginFixture() {
    var f = fixture();
    var tile = { type: 'object', properties: { _tileMenu: { type: 'object', properties: {
      _isItemButton: { type: 'boolean', default: false, title: 'Display item as a button' },
      removeLink: { type: 'boolean', default: false, title: 'Remove default link button' },
      unrelated: { type: 'boolean', default: false }
    } } } };
    var hero = { type: 'object', properties: { _hero: { type: 'object', properties: {
      _hideHeader: { type: 'boolean', required: true, default: true, title: 'Hide the default page header' },
      _isFullWidth: { type: 'boolean', default: false, title: 'Make full width' },
      _backgroundImage: { type: 'object', properties: {
        _isEnabled: { type: 'boolean', default: false, title: 'Enable background image' },
        _opacity: { type: 'number', required: true, default: 1 }
      } }
    } } } };
    f.catalog.menu.tileMenu = { name: 'adapt-aleido-tileMenu', properties: {
      pluginLocations: { properties: { contentobject: tile } }
    } };
    f.catalog.extension.hero = { _id: 'hero-type', name: 'adapt-aleido-hero', properties: {
      pluginLocations: { properties: { course: copy(hero), contentobject: copy(hero) } }
    } };
    f.catalog.extension.styling = { _id: 'styling-type', name: 'adapt-aleido-styling', properties: {
      pluginLocations: { properties: { contentobject: { type: 'object', properties: {
        _styling: { type: 'object', properties: {
          _isContentFullWidth: { type: 'boolean', default: false, title: 'Set the content full width' },
          unrelated: { type: 'boolean', default: false }
        } }
      } } } }
    } };
    f.draft.pluginSelections.menu = 'tileMenu';
    f.draft.pluginSelections.extensions = ['hero'];
    f.defaults['menu:tileMenu:contentobject'] = { '_tileMenu._isItemButton': true, '_tileMenu.removeLink': true };
    ['course', 'contentobject'].forEach(function(location) {
      f.defaults['extension:hero:' + location] = { '_hero._hideHeader': false, '_hero._isFullWidth': true };
    });
    f.version.contentSnapshot = copy(f.draft);
    return f;
  }
  it('exposes supported options once in only their requested locations', function() {
    var f = pluginFixture(), groups = catalogs.definitions(f.catalog);
    ['menu:tileMenu:contentobject', 'extension:hero:course', 'extension:hero:contentobject'].forEach(function(key) {
      var fields = groups.find(function(group) { return group.key === key; }).fields;
      var options = fields.filter(function(field) { return field.pluginOption; });
      assert.strictEqual(options.length, key.startsWith('extension:hero:') ? 3 : 2);
      assert(options.every(function(field) { return !field.hidden; }));
      assert.strictEqual(new Set(options.map(function(field) { return field.path; })).size, options.length);
      if (key.startsWith('extension:hero:')) {
        assert(options.some(function(field) {
          return field.path === '_hero._backgroundImage._isEnabled' && field.schema.title === 'Enable background image';
        }));
      }
    });
    assert.strictEqual(schema.pluginOption({ type: 'boolean', title: 'Remove default link button' },
      '_tileMenu.removeLink', 'menu:other:contentobject'), false);
    assert.strictEqual(schema.pluginOption({ type: 'string' }, '_hero._isFullWidth', 'extension:hero:course'), false);
    assert.strictEqual(schema.pluginOption({ type: 'boolean' }, '_hero._isFullWidth', 'extension:hero:block'), false);
    var styling = groups.find(function(group) { return group.key === 'extension:styling:contentobject'; });
    var fullWidth = styling.fields.filter(function(field) { return field.path === '_styling._isContentFullWidth'; });
    assert.strictEqual(fullWidth.length, 1);
    assert.strictEqual(fullWidth[0].pluginOption, true);
    assert(!fullWidth[0].hidden);
    assert.strictEqual(schema.pluginOption({ type: 'boolean' }, '_styling._isContentFullWidth', 'extension:styling:course'), false);
  });
  it('applies configured true/false values and preserves authored page options and siblings', function() {
    var f = pluginFixture(), page = f.draft.contentTree.children[0];
    page.menuSettings = { _tileMenu: { _isItemButton: false, other: 'Keep' } };
    page._extensions = { _hero: { _hideHeader: true, _isFullWidth: false } };
    f.version.contentSnapshot = copy(f.draft);
    var original = JSON.stringify(f), plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var output = plan.records.find(function(record) { return record.id === 'page'; }).data;
    assert.deepStrictEqual(output.menuSettings._tileMenu, { _isItemButton: false, other: 'Keep', removeLink: true, unrelated: false });
    assert.strictEqual(output._extensions._hero._hideHeader, true);
    assert.strictEqual(output._extensions._hero._isFullWidth, false);
    var course = plan.records.find(function(record) { return record.id === 'course'; }).data;
    assert.strictEqual(course._extensions._hero._hideHeader, false);
    assert.strictEqual(course._extensions._hero._isFullWidth, true);
    assert.strictEqual(JSON.stringify(f), original);
    assert(plan.proposals.some(function(proposal) {
      return proposal.path === 'menuSettings._tileMenu.removeLink' && proposal.value === true;
    }));
  });
  it('uses installed menu and extension defaults for unconfigured settings', function() {
    var f = pluginFixture();
    delete f.defaults['menu:tileMenu:contentobject'];
    delete f.defaults['extension:hero:course'];
    delete f.defaults['extension:hero:contentobject'];
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var page = plan.records.find(function(record) { return record.id === 'page'; }).data;
    assert.strictEqual(page.menuSettings._tileMenu._isItemButton, false);
    assert.strictEqual(page.menuSettings._tileMenu.removeLink, false);
    assert.strictEqual(page._extensions._hero._isFullWidth, false);
    assert.deepStrictEqual(page._extensions._hero._backgroundImage, { _isEnabled: false, _opacity: 1 });
    assert.strictEqual(page._extensions._hero._hideHeader, true);
  });
  it('applies the background-image setting only when configured and preserves authored choices', function() {
    var f = pluginFixture(), page = f.draft.contentTree.children[0];
    f.defaults['extension:hero:course']['_hero._backgroundImage._isEnabled'] = true;
    f.defaults['extension:hero:contentobject']['_hero._backgroundImage._isEnabled'] = true;
    page._extensions = { _hero: { _backgroundImage: { _isEnabled: false, _opacity: 0.5 } } };
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'page'; })
      .data._extensions._hero._backgroundImage, { _isEnabled: false, _opacity: 0.5 });
    assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'course'; })
      .data._extensions._hero._backgroundImage, { _isEnabled: true, _opacity: 1 });
    assert(plan.proposals.some(function(proposal) {
      return proposal.node === 'course' && proposal.path === '_extensions._hero._backgroundImage._isEnabled' && proposal.value === true;
    }));
    f.defaults['extension:hero:course']['_hero._backgroundImage._isEnabled'] = false;
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'course'; })
      .data._extensions._hero._backgroundImage._isEnabled, false);
  });
  it('does not apply configured extension overrides when the extension is not selected', function() {
    var f = pluginFixture();
    f.defaults['extension:hero:course']['_hero._backgroundImage._isEnabled'] = true;
    f.defaults['extension:hero:contentobject']['_hero._backgroundImage._isEnabled'] = true;
    f.draft.pluginSelections.extensions = [];
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert(!plan.proposals.some(function(proposal) { return proposal.path.indexOf('_hero') !== -1; }));
    assert(plan.records.every(function(record) {
      return !record.data._extensions || !record.data._extensions._hero;
    }));
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'config'; }).data._enabledExtensions.hero, undefined);
  });
  it('applies Styling full width only when selected and configured, preserving authored choices', function() {
    var f = pluginFixture(), page = f.draft.contentTree.children[0];
    f.draft.pluginSelections.extensions.push('styling');
    f.defaults['extension:styling:contentobject'] = { '_styling._isContentFullWidth': true };
    page._extensions = { _styling: { _isContentFullWidth: false, unrelated: true } };
    f.version.contentSnapshot = copy(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'page'; })
      .data._extensions._styling, { _isContentFullWidth: false, unrelated: true });
    delete page._extensions._styling._isContentFullWidth;
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; })
      .data._extensions._styling._isContentFullWidth, true);
    assert(plan.proposals.some(function(proposal) {
      return proposal.node === 'page' && proposal.path === '_extensions._styling._isContentFullWidth' && proposal.value === true;
    }));
    f.defaults['extension:styling:contentobject']['_styling._isContentFullWidth'] = false;
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; })
      .data._extensions._styling._isContentFullWidth, false);
    delete f.defaults['extension:styling:contentobject'];
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; })
      .data._extensions._styling._isContentFullWidth, false);
    f.defaults['extension:styling:contentobject'] = { '_styling._isContentFullWidth': true };
    f.draft.pluginSelections.extensions = ['hero'];
    delete page._extensions;
    f.version.contentSnapshot = copy(f.draft);
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert(!plan.proposals.some(function(proposal) { return proposal.path.indexOf('_styling') !== -1; }));
    assert(!plan.records.find(function(record) { return record.id === 'page'; }).data._extensions._styling);
  });
});

describe('selected menu and theme initialization', function() {
  function settings(f) {
    f.catalog.menu.tile.version = '1';
    f.catalog.menu.tile.properties = { pluginLocations: { properties: {
      contentobject: { properties: { _tileMenu: { type: 'object', properties: {
        _isItemButton: { type: 'boolean', default: false },
        _styling: { type: 'object', properties: {
          _detailsAlignment: { type: 'string', default: 'left' },
          _buttonAlignment: { type: 'string', default: 'left' }
        } }
      } } } }
    } } };
    f.catalog.menu.tileMenu = f.catalog.menu.tile;
    delete f.catalog.menu.tile;
    f.draft.pluginSelections.menu = 'tileMenu';
    f.catalog.theme.theme.properties = {
      variables: {
        _fonts: { type: 'object', properties: {
          titleFont: { type: 'string', default: "'https://example.test/font'" },
          bodyFont: { type: 'string', default: "'https://example.test/body'" },
          invalid: { type: 'string', enum: ['valid'], default: 'invalid' },
          absent: { type: 'string' }
        } },
        color: { type: 'string', default: '#fff' }
      },
      pluginLocations: { properties: { course: { properties: {
        _aleido: { type: 'object', properties: { _enabled: { type: 'boolean', default: false } } }
      } } } }
    };
  }
  it('fills missing runtime settings while preserving configured and authored menu values', function() {
    var f = fixture();
    settings(f);
    f.defaults['menu:tileMenu:contentobject'] = { '_tileMenu._isItemButton': true };
    f.draft.contentTree.children[0].menuSettings = { _tileMenu: { _styling: { _detailsAlignment: 'right' } } };
    f.version.contentSnapshot = copy(f.draft);
    var original = JSON.stringify(f);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var course = plan.records.find(function(record) { return record.id === 'course'; }).data;
    var page = plan.records.find(function(record) { return record.id === 'page'; }).data;
    assert.deepStrictEqual(page.menuSettings._tileMenu, {
      _isItemButton: true, _styling: { _detailsAlignment: 'right', _buttonAlignment: 'left' }
    });
    assert.deepStrictEqual(course.themeVariables, {
      _fonts: { titleFont: "'https://example.test/font'", bodyFont: "'https://example.test/body'" }, color: '#fff'
    });
    assert.strictEqual(course.themeSettings._aleido._enabled, false);
    var mongoose = require('mongoose');
    var Stored = mongoose.models.ConversionMenuThemeDefaultsTest ||
      mongoose.model('ConversionMenuThemeDefaultsTest', new mongoose.Schema({}, { strict: false }));
    assert.strictEqual(new Stored(page).toObject().menuSettings._tileMenu._styling._detailsAlignment, 'right');
    assert.strictEqual(new Stored(course).toObject().themeVariables._fonts.titleFont, "'https://example.test/font'");
    assert.strictEqual(JSON.stringify(f), original);
    course.themeVariables._fonts.titleFont = 'changed';
    assert.strictEqual(planner.build(f.draft, f.version, f.catalog, f.defaults).records[0]
      .data.themeVariables._fonts.titleFont, "'https://example.test/font'");
  });
  it('uses only the selected menu and theme', function() {
    var f = fixture();
    settings(f);
    f.version.contentSnapshot = copy(f.draft);
    f.catalog.menu.other = { name: 'other', properties: { pluginLocations: { properties: {
      contentobject: { properties: { _other: { type: 'string', default: 'unexpected' } } }
    } } } };
    f.catalog.theme.other = { name: 'other-theme', properties: { variables: {
      unexpected: { type: 'string', default: 'unexpected' }
    } } };
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'page'; }).data.menuSettings._other, undefined);
    assert.strictEqual(plan.records[0].data.themeVariables.unexpected, undefined);
  });
});

describe('selected extension initialization', function() {
  it('fills missing nested Resources and Footer settings and globals without replacing authored values', function() {
    var f = fixture();
    f.catalog.extension.resources = { name: 'test-resources', version: '1', globals: {
      _types: { default: { link: 'Link' } }
    }, properties: { pluginLocations: { properties: { course: { properties: {
      _resources: { type: 'object', properties: {
        _isEnabled: { type: 'boolean', default: false },
        _resourcesItems: { type: 'array', default: [] },
        _invalidChoice: { type: 'string', inputType: { type: 'Select', options: ['one', 'two'] } },
        _graphic: { type: 'string', inputType: 'Asset:image', default: ASSET },
        _filterButtons: { type: 'object', properties: {
          _showAll: { type: 'boolean', default: true }, all: { type: 'string', default: 'All' }
        } }
      } }
    } } } } } };
    f.catalog.extension.footer = { name: 'test-footer', version: '1', globals: {
      next: { default: 'Next' }
    }, properties: { pluginLocations: { properties: { contentobject: { properties: {
      _footer: { type: 'object', properties: {
        _isEnabled: { type: 'boolean', default: false },
        _styling: { type: 'object', properties: { _textAlignment: { type: 'string', default: 'center' } } },
        _buttons: { type: 'object', properties: { _showNext: { type: 'boolean', default: true } } },
        _previous: copy(footerLocation().properties._footer.properties._previous),
        _next: copy(footerLocation().properties._footer.properties._next)
      } }
    } } } } } };
    f.catalog.extension.unselected = { name: 'test-unselected', globals: { text: { default: 'No' } },
      properties: { pluginLocations: { properties: { course: { properties: {
        _unselected: { type: 'object', properties: { _isEnabled: { type: 'boolean', default: true } } }
      } } } } } };
    f.draft.pluginSelections.extensions = ['resources', 'footer'];
    f.draft.contentTree.children[0]._extensions = { _footer: { _isEnabled: false, _buttons: { _showNext: false } } };
    f.version.contentSnapshot = copy(f.draft);
    var original = JSON.stringify(f);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var course = plan.records.find(function(record) { return record.id === 'course'; }).data;
    var page = plan.records.find(function(record) { return record.id === 'page'; }).data;
    assert.deepStrictEqual(course._extensions._resources._filterButtons, { _showAll: true, all: 'All' });
    assert.deepStrictEqual(course._extensions._resources._resourcesItems, []);
    assert.strictEqual(course._extensions._resources._invalidChoice, undefined);
    assert(plan.assets.some(function(asset) {
      return asset.node === 'course' && asset.path === '_extensions._resources._graphic' && asset.source === ASSET;
    }));
    assert.deepStrictEqual(page._extensions._footer, {
      _isEnabled: false, _buttons: { _showNext: false }, _styling: { _textAlignment: 'center' },
      _previous: { _isEnabled: false, _customLink: '', _isRound: false, title: '' },
      _next: { _isEnabled: false, _customLink: '', _isRound: false, title: '' }
    });
    assert.deepStrictEqual(course._globals._extensions, { _resources: { _types: { link: 'Link' } }, _footer: { next: 'Next' } });
    assert.strictEqual(course._extensions._unselected, undefined);
    var mongoose = require('mongoose');
    var Stored = mongoose.models.ConversionExtensionDefaultsTest ||
      mongoose.model('ConversionExtensionDefaultsTest', new mongoose.Schema({}, { strict: false }));
    var storedCourse = new Stored(course).toObject(), storedPage = new Stored(page).toObject();
    assert.strictEqual(storedCourse._extensions._resources._filterButtons.all, 'All');
    assert.strictEqual(storedCourse._globals._extensions._footer.next, 'Next');
    assert.strictEqual(storedPage._extensions._footer._styling._textAlignment, 'center');
    assert.strictEqual(JSON.stringify(f), original);
    course._globals._extensions._resources._types.link = 'Changed';
    course._extensions._resources._filterButtons.all = 'Changed';
    var next = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(next.records[0].data._extensions._resources._filterButtons.all, 'All');
    assert.strictEqual(next.records[0].data._globals._extensions._resources._types.link, 'Link');
  });
});

describe('conversion catalogue duplicate containers', function() {
  it('keeps individual nested fields and graphic placeholders without duplicate grouped editors', function() {
    var f = fixture();
    var columns = { type: 'object', required: true, properties: {
      _large: { type: 'number', required: true, default: 3 },
      _medium: { type: 'number', required: true, default: 2 },
      _small: { type: 'number', required: true, default: 1 }
    } };
    f.catalog.component.graphic.properties._columns = columns;
    f.catalog.core.config.properties.columns = copy(columns);
    f.catalog.component.graphic.properties.standalone = {
      type: 'object', required: true, properties: { optional: { type: 'string' } }
    };
    var original = JSON.stringify(f.catalog);
    var groups = catalogs.definitions(f.catalog);
    var component = groups.find(function(group) { return group.key === 'component:graphic'; });
    var config = groups.find(function(group) { return group.key === 'core:config'; });
    [[component, '_columns'], [config, 'columns']].forEach(function(entry) {
      var fields = entry[0].fields, path = entry[1];
      assert.strictEqual(fields.find(function(field) { return field.path === path; }).duplicateContainer, true);
      assert.strictEqual(fields.find(function(field) { return field.path === path; }).hidden, true);
      ['_large', '_medium', '_small'].forEach(function(key) {
        assert.strictEqual(fields.find(function(field) { return field.path === path + '.' + key; }).hidden, false);
      });
    });
    assert.strictEqual(component.fields.find(function(field) { return field.path === 'standalone'; }).hidden, false);
    assert.strictEqual(JSON.stringify(f.catalog), original);
  });
});

describe('question option conversion defaults', function() {
  var options = ['_canShowModelAnswer', '_canShowCorrectness', '_canShowFeedback', '_canShowMarking',
    '_shouldDisplayAttempts', '_isRandom', '_recordInteraction', '_hasItemScoring'];
  function questionFixture() {
    var f = fixture();
    options.forEach(function(key) {
      f.catalog.component.graphic.properties[key] = { type: 'boolean', default: true, title: key };
    });
    return f;
  }
  it('exposes every supported boolean option once, without inventing unsupported options', function() {
    var f = questionFixture();
    f.catalog.component.graphic.properties._canShowFeedback.required = true;
    f.catalog.component.partial = { properties: {
      _isRandom: { type: 'boolean', default: false }, _hasItemScoring: { type: 'string' }
    } };
    var groups = catalogs.definitions(f.catalog);
    var fields = groups.find(function(group) { return group.key === 'component:graphic'; }).fields;
    options.forEach(function(key) {
      var matches = fields.filter(function(field) { return field.path === key; });
      assert.strictEqual(matches.length, 1, key);
      assert.strictEqual(matches[0].questionOption, true);
    });
    var partial = groups.find(function(group) { return group.key === 'component:partial'; }).fields;
    assert.deepStrictEqual(partial.map(function(field) { return field.path; }), ['_isRandom']);
  });
  it('applies configured true/false fallbacks to missing values and preserves authored booleans', function() {
    var f = questionFixture();
    options.forEach(function(key, index) { f.defaults['component:graphic'][key] = index % 2 === 0; });
    component(f.draft)._canShowModelAnswer = false;
    component(f.draft)._canShowCorrectness = true;
    f.version.contentSnapshot = copy(f.draft);
    var original = JSON.stringify(f), plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var data = plan.records.find(function(record) { return record.id === 'component'; }).data;
    assert.strictEqual(data._canShowModelAnswer, false);
    assert.strictEqual(data._canShowCorrectness, true);
    options.slice(2).forEach(function(key) { assert.strictEqual(data[key], f.defaults['component:graphic'][key]); });
    assert.strictEqual(plan.proposals.filter(function(proposal) { return options.includes(proposal.path); }).length, 6);
    assert.strictEqual(JSON.stringify(f), original);
  });
  it('leaves unconfigured optional question settings unchanged', function() {
    var f = questionFixture(), plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    var data = plan.records.find(function(record) { return record.id === 'component'; }).data;
    options.forEach(function(key) { assert.strictEqual(data[key], undefined); });
    assert(!plan.proposals.some(function(proposal) { return options.includes(proposal.path); }));
  });
});

describe('conversion schemas and required-only fallbacks', function() {
  it('excludes component and nested item ideas from the converted course and asset plan', function() {
    var f = fixture();
    component(f.draft)._lightCourseIdeaAssets = [{ src: 'bbbbbbbbbbbbbbbbbbbbbbbb' }];
    component(f.draft)._items = [{ title: 'Item', _lightCourseIdeaItemId: 'item-id',
      _lightCourseIdeaAssets: [{ src: 'cccccccccccccccccccccccc' }] }];
    f.version.contentSnapshot = copy(f.draft);
    var before = JSON.stringify(f.draft);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    var converted = plan.records.find(function(record) { return record.id === 'component'; });
    assert(converted);
    assert.strictEqual(converted.data._lightCourseIdeaAssets, undefined);
    assert.strictEqual(converted.data._items[0]._lightCourseIdeaAssets, undefined);
    assert.strictEqual(converted.data._items[0]._lightCourseIdeaItemId, undefined);
    assert.strictEqual(converted.data._items[0].title, 'Item');
    assert(!plan.assets.some(function(asset) { return /IdeaAssets/.test(asset.path); }));
    assert.strictEqual(JSON.stringify(f.draft), before);
  });
  it('accepts both required dialects, validators, arrays and enum inputs', function() {
    var definition = { type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, count: { type: 'number', required: true },
      choice: { type: 'string', inputType: { type: 'Select', options: ['one', 'two'] } }
    } };
    assert.deepStrictEqual(schema.fields(definition).map(function(field) { return field.path; }), ['name', 'count']);
    assert.strictEqual(schema.valid(definition, { name: 'Example', count: 0, choice: 'one' }), true);
    assert.strictEqual(schema.valid(definition, { name: 'Example', count: 0, choice: 'wrong' }), false);
    assert.ok(schema.validateDefaults(JSON.parse('{"component:graphic":{"__proto__.value":1}}')));
  });
  it('proposes missing required image values and preserves optional empties and authored nested values', function() {
    var plan = planFixture(), graphic = plan.records.find(function(record) { return record.id === 'component'; }).data;
    assert.deepStrictEqual(plan.errors, []);
    assert.strictEqual(graphic._graphic.alt, 'Authored alt');
    assert.strictEqual(graphic._graphic.large, ASSET);
    assert.strictEqual(graphic.optional, '');
    assert.strictEqual(graphic.graphicsNotes, undefined);
    assert.strictEqual(graphic.developerNotes, undefined);
    assert.strictEqual(graphic.screenshotAssetId, undefined);
    assert.strictEqual(graphic._layout, 'full');
    assert.strictEqual(graphic.displayTitle, 'Graphic');
    assert.strictEqual(plan.proposals.filter(function(proposal) { return proposal.source === 'Conversion Defaults'; }).length, 2);
  });
  it('does not replace authored valid required values, even with configured defaults', function() {
    var plan = planFixture(function(f) {
      component(f.version.contentSnapshot)._graphic.large = 'https://example.test/real.png';
      component(f.draft)._graphic.large = 'https://example.test/real.png';
    });
    var graphic = plan.records.find(function(record) { return record.id === 'component'; }).data;
    assert.strictEqual(graphic._graphic.large, 'https://example.test/real.png');
    assert(!plan.proposals.some(function(proposal) { return proposal.path.endsWith('.large'); }));
  });
  it('does not change source snapshots while preparing fallbacks', function() {
    var f = fixture(), original = JSON.stringify(f);
    planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.strictEqual(JSON.stringify(f), original);
  });
  it('reports all required failures and missing plugins together', function() {
    var plan = planFixture(function(f) {
      f.defaults = {};
      delete f.catalog.menu.tile;
      f.draft.pluginSelections.extensions = ['missing'];
      f.version.contentSnapshot.pluginSelections.extensions = ['missing'];
    });
    assert(plan.errors.some(function(error) { return error.path === 'menu'; }));
    assert(plan.errors.some(function(error) { return error.path === 'missing'; }));
    assert(plan.errors.some(function(error) { return error.path === '_graphic.large'; }));
    assert(plan.errors.some(function(error) { return error.path === '_graphic.small'; }));
  });
  it('requires a new version for draft changes and missing components', function() {
    assert(planFixture(function(f) { f.draft.title = 'New unsaved version'; }).errors.some(function(error) {
      return error.message.includes('changes since');
    }));
    assert(planFixture(function(f) { delete f.catalog.component.graphic; }).errors.some(function(error) {
      return error.message.includes('Component is not installed');
    }));
  });
  it('blocks unsupported article/block IDs and incomplete menu/theme metadata', function() {
    ['article', 'block'].forEach(function(type) {
      var plan = planFixture(function(f) {
        var article = f.draft.contentTree.children[0].children[0];
        (type === 'article' ? article : article.children[0]).uniqueId = 'authored-id';
        f.version.contentSnapshot = copy(f.draft);
      });
      assert(plan.errors.some(function(error) { return error.path === 'uniqueId'; }));
    });
    ['menu', 'theme'].forEach(function(type) {
      assert(planFixture(function(f) {
        delete f.catalog[type][f.draft.pluginSelections[type]].name;
      }).errors.some(function(error) { return error.path === type; }));
    });
  });
  it('preserves explicit empty display titles instead of substituting the internal title', function() {
    var plan = planFixture(function(f) {
      component(f.draft).displayTitle = '';
      f.version.contentSnapshot = copy(f.draft);
    });
    assert.strictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data.displayTitle, '');
  });
  it('rejects duplicate or reserved node IDs before creating ID mappings', function() {
    ['course', 'config', '__proto__', 'page'].forEach(function(id) {
      var plan = planFixture(function(f) {
        component(f.draft)._id = id;
        component(f.version.contentSnapshot)._id = id;
      });
      assert(plan.errors.some(function(error) { return error.path === '_id'; }), id);
    });
  });
  it('applies item defaults per existing item without adding optional arrays', function() {
    var plan = planFixture(function(f) {
      component(f.version.contentSnapshot)._items = [{ title: 'Keep' }, {}];
      component(f.draft)._items = [{ title: 'Keep' }, {}];
    });
    var graphic = plan.records.find(function(record) { return record.id === 'component'; }).data;
    assert.deepStrictEqual(graphic._items, [{ title: 'Keep' }, { title: 'Fallback item' }]);
  });
  it('fills only per-item graphic fields, including absent optional graphic objects', function() {
      var f = fixture();
      itemGraphics(f, [
        { title: 'First', _graphic: { src: 'https://example.test/authored.png', alt: 'Keep alt' } },
        { title: 'Second', _graphic: { src: '', alt: 'Second alt' } },
        { title: 'Third' }, { title: 'Fourth', _graphic: { src: 42, alt: 'Fourth alt' } }
      ]);
      var original = JSON.stringify(f), plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.errors, []);
      var items = plan.records.find(function(record) { return record.id === 'component'; }).data._items;
      assert.deepStrictEqual(items.map(function(item) { return item.title; }), ['First', 'Second', 'Third', 'Fourth']);
      assert.deepStrictEqual(items[0], { title: 'First', _graphic: { src: 'https://example.test/authored.png', alt: 'Keep alt' } });
      assert.strictEqual(items[1]._graphic.alt, 'Second alt');
      assert.strictEqual(items[3]._graphic.alt, 'Fourth alt');
      items.slice(1).forEach(function(item) { assert.strictEqual(item._graphic.src, ASSET); });
      assert.strictEqual(plan.proposals.filter(function(proposal) { return proposal.path.startsWith('_items['); }).length, 3);
      assert.strictEqual(JSON.stringify(f), original);
    });
    it('does not seed optional graphics without opt-in or create items from a per-item fallback', function() {
      var f = fixture();
      itemGraphics(f, [{ title: 'Keep', _graphic: { src: '', alt: 'Keep alt' } }, { title: 'No graphic' }], false);
      var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._items,
        component(f.draft)._items);
      f.defaults['component:graphic']['_items[]._graphic.src'] = ASSET;
      [[], undefined].forEach(function(items) {
        if (items) component(f.draft)._items = items;
        else delete component(f.draft)._items;
        f.version.contentSnapshot = copy(f.draft);
        var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
        assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._items, items);
      });
    });
    it('exposes all optional images but labels only schema-declared array images as per-item fallbacks', function() {
      var fields = schema.fields({ properties: {
        image: { type: 'string', inputType: 'Asset:image' },
        _items: { type: 'array', items: { properties: {
          _graphic: { properties: { src: { type: 'string', inputType: 'Asset:image' } } },
          audio: { type: 'string', inputType: 'Asset:audio' }, optional: { type: 'string' }
        } } }
      } });
      assert.deepStrictEqual(fields.map(function(field) { return field.path; }), ['image', '_items[]._graphic.src']);
      assert.strictEqual(fields[0].image, true);
      assert.strictEqual(fields[0].itemGraphic, false);
      assert.strictEqual(fields[1].itemGraphic, true);
    });
    it('filters only defaulted item fields while retaining graphic placeholders and non-item defaults', function() {
      var definition = { properties: {
        title: { type: 'string', required: true, default: 'Course default' },
        _items: { type: 'array', required: true, items: { type: 'object', required: ['needed'], properties: {
          needed: { type: 'string' },
          empty: { type: 'string', required: true, default: '' },
          count: { type: 'number', required: true, default: 0 },
          enabled: { type: 'boolean', required: true, default: false },
          optional: { type: 'string' },
          graphic: { type: 'string', inputType: 'Asset:image', default: 'https://example.test/image.png' }
        } } }
      } };
      var fields = schema.fields(definition);
      assert.strictEqual(fields.find(function(field) { return field.path === 'title'; }).hidden, false);
      ['count', 'enabled'].forEach(function(key) {
        assert.strictEqual(fields.find(function(field) { return field.path === '_items[].' + key; }).hidden, true);
      });
      ['needed', 'empty', 'graphic'].forEach(function(key) {
        assert.strictEqual(fields.find(function(field) { return field.path === '_items[].' + key; }).hidden, false);
      });
      var item = fields.find(function(field) { return field.path === '_items'; }).schema.items.properties;
      assert.strictEqual(item.optional.conversionHidden, true);
      assert.strictEqual(item.needed.conversionHidden, false);
      assert.strictEqual(item.empty.conversionHidden, false);
      assert.strictEqual(item.enabled.conversionUseDefault, true);
      assert.strictEqual(definition.properties._items.items.properties.optional.conversionHidden, undefined);
    });
    it('prefers installed defaults for missing item values but preserves authored values and graphic overrides', function() {
      var f = fixture();
      itemGraphics(f, [{ title: 'Authored' }, {}]);
      var properties = f.catalog.component.graphic.properties._items.items.properties;
      properties.count = { type: 'number', required: true, default: 0 };
      properties.enabled = { type: 'boolean', required: true, default: false };
      f.defaults['component:graphic']['_items[].title'] = 'Old custom title';
      f.defaults['component:graphic']['_items[].count'] = 7;
      f.defaults['component:graphic']['_items[].enabled'] = true;
      properties._graphic.properties.src.default = 'https://example.test/default.png';
      var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.errors, []);
      var items = plan.records.find(function(record) { return record.id === 'component'; }).data._items;
      assert.strictEqual(items[0].title, 'Authored');
      assert.strictEqual(items[1].title, 'Fallback item');
      items.forEach(function(item) {
        assert.strictEqual(item.count, 0);
        assert.strictEqual(item.enabled, false);
        assert.strictEqual(item._graphic.src, ASSET);
      });
      assert(plan.proposals.some(function(proposal) {
        return proposal.path === '_items[1].title' && proposal.source === 'Installed schema';
      }));
    });
    it('distinguishes a whole-array fallback from per-item graphic defaults', function() {
      var f = fixture();
      itemGraphics(f, [{ title: 'Authored item' }], false);
      var definition = f.catalog.component.graphic.properties._items;
      definition.required = true;
      definition.minItems = 1;
      f.defaults['component:graphic']._items = [{ title: 'Fallback item', _graphic: { src: ASSET } }];
      var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._items,
        [{ title: 'Authored item' }]);
      component(f.draft)._items = [];
      f.version.contentSnapshot = copy(f.draft);
      plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.records.find(function(record) { return record.id === 'component'; }).data._items,
        f.defaults['component:graphic']._items);
      assert(plan.proposals.some(function(proposal) { return proposal.path === '_items'; }));
    });
    it('applies graphic defaults within nested arrays without creating absent nested arrays', function() {
      var f = fixture();
      itemGraphics(f, [{ title: 'First', _children: [{ title: 'Nested' }] }, { title: 'Second' }], false);
      var fields = f.catalog.component.graphic.properties._items.items.properties;
      fields._children = { type: 'array', items: { type: 'object', properties: {
        title: { type: 'string' }, _graphic: copy(fields._graphic)
      } } };
      f.defaults['component:graphic']['_items[]._children[]._graphic.src'] = ASSET;
      var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
      assert.deepStrictEqual(plan.errors, []);
      var items = plan.records.find(function(record) { return record.id === 'component'; }).data._items;
      assert.strictEqual(items[0]._children[0]._graphic.src, ASSET);
      assert.strictEqual(items[1]._children, undefined);
      assert.strictEqual(items[0]._graphic, undefined);
    });
  it('maps selected extension entries, stable IDs, icons and paired component layouts', function() {
    var f = fixture();
    f.catalog.extension.uniqueId = { _id: 'unique', properties: { pluginLocations: { properties: {
      component: { properties: { _uniqueId: { type: 'object', properties: { _id: { type: 'string' } } } } },
      contentobject: { properties: { _uniqueId: { type: 'object', properties: { _id: { type: 'string' } } } } }
    } } } };
    f.catalog.extension.resources = { _id: 'resources', properties: { pluginLocations: { properties: {
      course: { properties: { _resources: { type: 'object', properties: {
        _resourcesItems: { type: 'array', items: { type: 'object', properties: { _id: { type: 'string' } } } }
      } } } }
    } } } };
    f.catalog.extension.menuButton = { _id: 'menu-button', properties: { pluginLocations: { properties: {
      contentobject: { properties: { _menuButton: { properties: { _icon: { type: 'string', inputType: { options: ['home', 'menu'] } } } } } }
    } } } };
    f.draft.pluginSelections.extensions = ['uniqueId', 'resources', 'menuButton'];
    f.draft.headerData.iconChoices = { menuButton: 'home', back: 'ignored' };
    f.draft.resourceItems = [{ _id: 'r01', title: 'Resource', _type: 'link', _link: 'https://example.test' }];
    f.draft.contentTree.children[0].uniqueId = 'page01';
    var first = component(f.draft);
    first.uniqueId = 'component01';
    var block = f.draft.contentTree.children[0].children[0].children[0];
    block.children.push(Object.assign(copy(first), { _id: 'second', uniqueId: 'component02' }));
    f.version.contentSnapshot = copy(f.draft);
    f.version.headerSnapshot = copy(f.draft.headerData);
    var plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var page = plan.records.find(function(record) { return record.id === 'page'; }).data;
    assert.strictEqual(page._extensions._uniqueId._id, 'page01');
    assert.strictEqual(page._extensions._menuButton._icon, 'home');
    var components = plan.records.filter(function(record) { return record.type === 'component'; });
    assert.deepStrictEqual(components.map(function(record) { return record.data._layout; }), ['left', 'right']);
    assert.strictEqual(plan.records[0].data._extensions._resources._resourcesItems[0]._id, 'r01');
    f.version.headerSnapshot.iconChoices.menuButton = 'wrong';
    f.draft.headerData.iconChoices.menuButton = 'wrong';
    assert(planner.build(f.draft, f.version, f.catalog, f.defaults).errors.some(function(error) {
      return error.message.includes('Invalid menuButton icon');
    }));
  });
});

function harness(options) {
  options = options || {};
  var f = fixture();
  var state = { writes: [], files: [], allowed: !options.denied, failType: options.failType };
  var coursePlugin, courseHelpers;
  var records = {
    lightcourse: [copy(f.draft)], lightcourseversion: [f.version],
    lightcourseconfig: [{ _tenantId: 'tenant', conversionDefaults: f.defaults }],
    componenttype: [f.catalog.component.graphic], extensiontype: [],
    menutype: [f.catalog.menu.tile], themetype: [f.catalog.theme.theme],
    lightcourseasset: [{ _id: ASSET, _tenantId: options.foreignAsset ? 'other' : 'tenant',
      title: 'Placeholder', filename: 'placeholder.png', mimeType: 'image/png', repository: 'localfs', path: 'bank/placeholder.png' }]
  };
  function matches(record, query) {
    return Object.keys(query).every(function(key) {
      var value = schema.get(record, key), wanted = query[key];
      if (wanted && wanted.$nin) return !wanted.$nin.includes(value);
      return String(value) === String(wanted);
    });
  }
  function Model(value) { this.validateSync = function() { return state.failValidation ? new Error('Stored invalid') : null; }; }
  Model.findOneAndUpdate = function(query, delta, settings, next) {
    if (state.failFinal && delta.$set && delta.$set.conversionStatus === 'converted') return next(null, null);
    var record = records.lightcourse.find(function(record) { return matches(record, query); });
    if (!record) return next(null, null);
    Object.assign(record, copy(delta.$set || {}));
    Object.keys(delta.$unset || {}).forEach(function(key) { delete record[key]; });
    record.revision += delta.$inc && delta.$inc.revision || 0;
    next(null, copy(record));
  };
  var db = {
    create: function(type, data, next) {
      records[type] = records[type] || [];
      records[type].push(copy(data));
      next(null, data);
    },
    retrieve: function(type, query, options, next) { next(null, copy((records[type] || []).filter(function(record) { return matches(record, query); }))); },
    destroy: function(type, query, next) {
      if (options.cleanupFail && type === 'component') return next(new Error('Cleanup failed'));
      records[type] = (records[type] || []).filter(function(record) { return !matches(record, query); }); next();
    },
    getModel: function() { return Model; }
  };
  var app = {
    contentmanager: {
      _contentSchemas: f.catalog.core,
      create: function(type, data, next) {
        state.writes.push(type);
        function store(error) {
          if (error) return next(error);
          records[type] = records[type] || [];
          var stored = copy(data);
          if (options.dropField && type === 'component') delete stored.properties._graphic.large;
          if (options.minimizeCourse && type === 'course') {
            var mongoose = require('mongoose');
            var MinimizedCourse = mongoose.models.ConversionMinimizedCourse ||
              mongoose.model('ConversionMinimizedCourse', new mongoose.Schema({}, { strict: false }));
            stored = copy(new MinimizedCourse(stored).toObject());
          }
          if (options.componentModel && type === 'component') stored = copy(new options.componentModel(stored).toObject());
          if (options.dropExtension && type === 'course') delete stored._extensions._active;
          records[type].push(stored);
          if (type === 'course') records.config = [{ _id: 'dddddddddddddddddddddddd', _courseId: data._id }];
          if (type === state.failType) return next(new Error('Write failed'));
          next(null, data);
        }
        if (coursePlugin && type === 'course') {
          return coursePlugin.create(data, function(error) {
            if (error) return next(error);
            records.config = [{ _id: 'dddddddddddddddddddddddd', _courseId: data._id }];
            next(null, data);
          });
        }
        if (courseHelpers && type !== 'courseasset') {
          return courseHelpers.hasCoursePermission('create', 'admin', 'tenant', data, function(error, allowed) {
            store(error || (!allowed && new Error('Course owner permission denied')));
          });
        }
        store();
      },
      update: function(type, query, data, next) {
        function update(error) {
          if (error) return next(error);
          var record = records[type].find(function(record) { return matches(record, query); });
          Object.assign(record, copy(data)); next(null, record);
        }
        if (courseHelpers) {
          return courseHelpers.hasCoursePermission('update', 'admin', 'tenant', data, function(error, allowed) {
            update(error || (!allowed && new Error('Course owner permission denied')));
          });
        }
        update();
      }
    },
    assetmanager: {
      _createAssetFromFile: function(storage, file, metadata, user, repository, next) {
        if (options.validateAsset) {
          var error = options.validateAsset(metadata, file, repository);
          if (error) return next(error);
        }
        var record = { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', filename: 'copied.png' };
        records.asset = records.asset || [];
        records.asset.push(record);
        next(null, record, !!options.duplicate);
      },
      destroyAsset: function(id, next) { records.asset = records.asset.filter(function(record) { return record._id !== id; }); next(); }
    },
    emit: function() {},
    once: function() {}
  };
  var user = { _id: options.componentModel ? '111111111111111111111111' : 'admin', tenant: { _id: 'tenant' } };
  if (options.realCoursePermissions) {
    var dbModule = { getDatabase: function(next) { next(null, db); } };
    var userModule = { getCurrentUser: function() { return user; } };
    var permissionModule = {
      buildResourceString: function(tenant, resource) { return tenant + resource; },
      hasPermission: function(userId, action, resource, next) {
        if (resource === 'tenant/api/content/course/*') {
          if (options.coursePermissionError) return next(new Error('Permission service unavailable'));
          return next(null, !options.denyCourseCreate);
        }
        next(null, false);
      },
      createPolicy: function(id, next) { next(null, {}); },
      addStatement: function(policy, actions, resource, effect, next) { next(); }
    };
    var logger = { log: function() {} };
    courseHelpers = load('lib/helpers.js', {
      './database': dbModule, './permissions': permissionModule, './logger': logger
    });
    var contentmanager = load('lib/contentmanager.js', {
      './database': dbModule, './usermanager': userModule, './permissions': permissionModule,
      './helpers': courseHelpers, './logger': logger, '../': function() { return app; }
    });
    app.contentmanager.addContentHook = function() {};
    var Course = load('plugins/content/course/index.js', {
      '../../../lib/contentmanager': contentmanager, '../../../lib/database': dbModule,
      '../../../lib/usermanager': userModule, '../../../lib/permissions': permissionModule,
      '../../../lib/helpers': courseHelpers, '../../../lib/logger': logger, '../../../': function() { return app; }
    });
    coursePlugin = new Course();
  }
  var storage = { getFileContents: function(file, next) { next(options.missingFile ? new Error('Missing file') : null, Buffer.from('image')); } };
  var service = load('lib/lightcourse/conversion.js', {
    '../database': { getDatabase: function(next, tenant) { assert.strictEqual(tenant, 'tenant'); next(null, db); } },
    '../permissions': { buildResourceString: function(tenant, resource) { return 'urn:x-adapt:' + tenant + resource; },
      hasPermission: function(user, action, resource, next) {
        assert.strictEqual(resource, 'urn:x-adapt:tenant/*');
        next(null, state.allowed);
      } },
    '../usermanager': { getCurrentUser: function() { return options.loggedOut ? null : user; } },
    '../filestorage': { getStorage: function(repository, next) { next(null, storage); } },
    '../configuration': { getConfig: function() { return 'localfs'; } },
    '../logger': { log: function() {} }, '../../': function() { return app; },
    'fs-extra': { writeFile: async function(file) { state.files.push(file); }, remove: async function(file) {
      state.files = state.files.filter(function(entry) { return entry !== file; });
    } }
  });
  state.records = records;
  state.service = service;
  state.db = db;
  state.fixture = f;
  state.request = function(convert, body) {
    return new Promise(function(resolve) {
      service.route(convert)({ params: { id: f.draft._id }, body: body }, {
        status: function(status) { this.code = status; return this; },
        json: function(body) { resolve({ status: this.code, body: body }); }
      });
    });
  };
  return state;
}

describe('reviewed Light Course conversion', function() {
  it('retains the Splash start entry in the actual course schema and published JSON', async function() {
    var mongoose = require('mongoose');
    var MongooseDB = require('../lib/dml/mongoose');
    var db = new MongooseDB();
    var definition = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/content/course/model.schema')));
    var imported = await new Promise(function(resolve, reject) {
      db.importSchema('http://localhost/system/course.schema', definition, function(error, result) {
        if (error) reject(error); else resolve(result);
      });
    });
    db.conn = mongoose.createConnection();
    db._models = {};
    try {
      db.addSchema('course', imported);
      var Course = db.getModel('course');
      var course = new Course({ _start: { _isEnabled: true, _force: true, _isMenuDisabled: true, _startIds: [
        { _id: '000000000000000000000001', _className: '', _skipIfComplete: false }
      ] } });
      assert.strictEqual(course.validateSync(), undefined);
      var output = course.toJSON({ transform: true, forExport: true })._start;
      assert.strictEqual(output._isEnabled, true);
      assert.strictEqual(output._force, true);
      assert.strictEqual(output._isMenuDisabled, true);
      assert.strictEqual(output._startIds[0]._id, '000000000000000000000001');
    } finally {
      await db.conn.close();
    }
  });
  it('stores Footer disabled and Hero enabled without a background image on the first Splash page', async function() {
    var h = harness();
    splashFixture(h.fixture);
    configureFooter(h.fixture);
    h.fixture.catalog.extension.hero = heroFixture();
    h.fixture.draft.pluginSelections.extensions.push('hero');
    h.fixture.draft.contentTree.children[0]._extensions = {
      _hero: { _isEnabled: false, _backgroundImage: { _isEnabled: true, _opacity: 0.5 } }
    };
    h.fixture.draft.contentTree.children.push({ _id: 'second', type: 'page', title: 'Second', children: [] });
    h.fixture.version.contentSnapshot = copy(h.fixture.draft);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.componenttype[0] = copy(h.fixture.catalog.component.splash);
    h.records.extensiontype = ['footer', 'hero'].map(function(key) {
      return Object.assign({ extension: key }, copy(h.fixture.catalog.extension[key]));
    });
    h.records.lightcourseconfig[0].conversionDefaults = copy(h.fixture.defaults);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var first = h.records.contentobject.find(function(page) { return page.title === 'Page'; });
    var second = h.records.contentobject.find(function(page) { return page.title === 'Second'; });
    assert.strictEqual(first._extensions._footer._isEnabled, false);
    assert.strictEqual(first._extensions._hero._isEnabled, true);
    assert.deepStrictEqual(first._extensions._hero._backgroundImage, { _isEnabled: false, _opacity: 0.5 });
    assert.strictEqual(first._isHidden, true);
    assert.strictEqual(h.records.course[0]._start._isEnabled, true);
    assert.strictEqual(h.records.course[0]._start._force, true);
    assert.strictEqual(h.records.course[0]._start._startIds[0]._id, first._id);
    assert.strictEqual(h.records.course[0]._start._startIds[0]._className, '');
    assert.strictEqual(second._extensions._footer._isEnabled, true);
    assert.strictEqual(second._extensions._hero._isEnabled, true);
    assert.strictEqual(second._extensions._hero._backgroundImage._isEnabled, true);
  });
  it('stores Footer links to the generated adjacent Full Course page IDs', async function() {
    var h = harness();
    configureFooter(h.fixture);
    h.fixture.draft.contentTree.children.push(
      { _id: 'second', type: 'page', title: 'Second', children: [] },
      { _id: 'third', type: 'page', title: 'Third', children: [] }
    );
    h.fixture.version.contentSnapshot = copy(h.fixture.draft);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.extensiontype = [Object.assign({ extension: 'footer' }, copy(h.fixture.catalog.extension.footer))];
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var pages = h.records.contentobject;
    var first = pages.find(function(page) { return page.title === 'Page'; });
    var second = pages.find(function(page) { return page.title === 'Second'; });
    var third = pages.find(function(page) { return page.title === 'Third'; });
    assert.strictEqual(first._extensions._footer._next._customLink, second._id);
    assert.strictEqual(second._extensions._footer._previous._customLink, first._id);
    assert.strictEqual(second._extensions._footer._next._customLink, third._id);
    assert.strictEqual(third._extensions._footer._previous._customLink, second._id);
    assert.strictEqual(third._extensions._footer._next._isEnabled, false);
  });
  it('stores the page after Help as the preceding page Next target', async function() {
    var h = harness();
    configureFooter(h.fixture);
    configureHelp(h.fixture);
    h.fixture.draft.contentTree.children.push(
      { _id: 'help-page', type: 'page', title: 'Help', children: [] },
      { _id: 'after-help', type: 'page', title: 'After Help', children: [] }
    );
    h.fixture.version.contentSnapshot = copy(h.fixture.draft);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.extensiontype = ['footer', 'help'].map(function(key) {
      return Object.assign({ extension: key }, copy(h.fixture.catalog.extension[key]));
    });
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var pages = h.records.contentobject;
    var first = pages.find(function(page) { return page.title === 'Page'; });
    var help = pages.find(function(page) { return page.title === 'Help'; });
    var after = pages.find(function(page) { return page.title === 'After Help'; });
    assert.strictEqual(first._extensions._footer._next._customLink, after._id);
    assert.strictEqual(help._extensions._footer._next._isEnabled, false);
    assert.strictEqual(help._extensions._footer._next._customLink, '');
  });
  it('stores the generated next Full Course page ID in the Splash custom target', async function() {
    var h = harness();
    splashFixture(h.fixture);
    h.fixture.draft.contentTree.children.push({ _id: 'next-page', type: 'page', title: 'Next', children: [] });
    h.fixture.version.contentSnapshot = copy(h.fixture.draft);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.componenttype[0] = copy(h.fixture.catalog.component.splash);
    h.records.lightcourseconfig[0].conversionDefaults = copy(h.fixture.defaults);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var target = h.records.contentobject.find(function(page) { return page.title === 'Next'; });
    assert(target);
    assert.strictEqual(h.records.component[0].properties._naviageTo, target._id);
    assert.strictEqual(h.records.component[0].properties._naviagteToNextPage, false);
    assert.notStrictEqual(target._id, 'next-page');
  });
  it('stores the last-page main-menu exception in the converted Splash', async function() {
    var h = harness();
    splashFixture(h.fixture);
    h.fixture.defaults['component:splash']._naviagteHome = false;
    h.fixture.defaults['component:splash']._naviagteToNextPage = true;
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = copy(h.fixture.version);
    h.records.componenttype[0] = copy(h.fixture.catalog.component.splash);
    h.records.lightcourseconfig[0].conversionDefaults = copy(h.fixture.defaults);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    assert.strictEqual(h.records.component[0].properties._naviagteHome, true);
    assert.strictEqual(h.records.component[0].properties._naviagteToNextPage, false);
  });
  function footerFixture(options) {
    var h = harness(options);
    h.records.extensiontype = [
      { _id: 'footer-id', extension: 'footer', name: 'adapt-aleido-footer', version: '1.0.0', targetAttribute: '_footer',
        properties: { pluginLocations: { properties: { course: { properties: {
          _footer: { type: 'object', properties: {
            _styling: { type: 'object', required: true, default: {}, properties: {} }
          } }
        } } } } } },
      { _id: 'active-id', extension: 'active', name: 'adapt-active', version: '2.0.0', targetAttribute: '_active',
        properties: { pluginLocations: { properties: { course: { properties: {
          _active: { type: 'object', properties: { _isEnabled: { type: 'boolean', default: false } } }
        } } } } } }
    ];
    h.records.extensiontype[0].properties.pluginLocations.properties.contentobject = footerLocation();
    h.records.lightcourse[0].pluginSelections.extensions = ['footer', 'active'];
    h.records.lightcourseversion[0].contentSnapshot = copy(h.records.lightcourse[0]);
    return h;
  }
  it('accepts MongoDB minimizing empty extension objects while retaining enabled plugin metadata', async function() {
    var h = footerFixture({ minimizeCourse: true });
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    assert.strictEqual(h.records.course[0]._extensions._footer, undefined);
    assert.strictEqual(h.records.course[0]._extensions._active._isEnabled, true);
    assert.deepStrictEqual(h.records.config[0]._enabledExtensions.footer, {
      _id: 'footer-id', name: 'adapt-aleido-footer', version: '1.0.0', targetAttribute: '_footer'
    });
  });
  it('still rejects missing non-empty extension settings', async function() {
    var h = footerFixture({ minimizeCourse: true, dropExtension: true });
    var review = await h.request(false);
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 500);
    assert(result.body.message.includes('course._extensions._active'));
    assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'none');
  });
  it('stores component-specific values in the actual Full Course component schema', async function() {
    var mongoose = require('mongoose');
    var MongooseDB = require('../lib/dml/mongoose');
    var definition = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/content/component/model.schema')));
    var imported = await new Promise(function(resolve, reject) {
      new MongooseDB().importSchema('http://localhost/system/component.schema', definition, function(error, result) {
        if (error) reject(error); else resolve(result);
      });
    });
    var Component = mongoose.model('ConversionStoredComponentTest', new mongoose.Schema(imported));
    var h = harness({ componentModel: Component });
    var review = await h.request(false);
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    assert.strictEqual(h.records.component[0].properties._graphic.large, 'course/assets/copied.png');
    assert.strictEqual(h.records.component[0]._graphic, undefined);
  });
  it('creates a preassigned course ID with normal create permission and grants its creator ownership', async function() {
    var h = harness({ realCoursePermissions: true });
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    assert.strictEqual(h.records.course[0]._id, result.body.courseId);
    assert.strictEqual(h.records.course[0].createdBy, 'admin');
    assert.strictEqual(h.records.component[0].createdBy, 'admin');
    assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'converted');
  });
  it('rejects denied course creation and surfaces permission lookup failures without leaving a converted course', async function() {
    for (var options of [{ realCoursePermissions: true, denyCourseCreate: true },
      { realCoursePermissions: true, coursePermissionError: true }]) {
      var h = harness(options);
      var review = await h.request(false);
      var result = await h.request(true, { hash: review.body.hash, approved: true });
      assert.strictEqual(result.status, options.denyCourseCreate ? 403 : 500);
      if (options.coursePermissionError) assert.strictEqual(result.body.message, 'Permission service unavailable');
      assert.strictEqual((h.records.course || []).length, 0);
      assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'none');
    }
  });
  it('converts placeholder assets with an empty description without inventing metadata', async function() {
    var mongoose = require('mongoose');
    var MongooseDB = require('../lib/dml/mongoose');
    var assetSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/dml/schema/system/asset.schema')));
    var imported = await new Promise(function(resolve, reject) {
      new MongooseDB().importSchema('http://localhost/system/asset.schema', assetSchema, function(error, result) {
        if (error) reject(error); else resolve(result);
      });
    });
    var Asset = mongoose.model('ConversionAssetDescriptionTest', new mongoose.Schema(imported));
    for (var description of [undefined, '', 'Original caption']) {
      var metadata;
      var h = harness({ validateAsset: function(data, file, repository) {
        metadata = data;
        return new Asset({ title: data.title, description: data.description, assetType: 'image',
          path: 'image.png', filename: file.name, thumbnailPath: 'thumb.png', repository: repository }).validateSync();
      } });
      h.records.lightcourseasset[0].description = description;
      var review = await h.request(false);
      assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
      var result = await h.request(true, { hash: review.body.hash, approved: true });
      assert.strictEqual(result.status, 200, result.body.message);
      assert.strictEqual(metadata.description, description || '');
      assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'converted');
    }
  });
  it('performs read-only preflight and converts parent-first with a single config and asset copy', async function() {
    var h = harness(), original = copy(h.records.lightcourseversion);
    var review = await h.request(false);
    assert.strictEqual(review.status, 200, review.body.message);
    assert.strictEqual(review.body.ready, true);
    assert.deepStrictEqual(Array.from(review.body.locations.component, function(item) { return item.title; }),
      ['Page', 'Article', 'Block', 'Graphic']);
    assert.strictEqual(review.body.locations.component[3].component, 'graphic');
    assert.deepStrictEqual(h.writes, []);
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    assert.deepStrictEqual(h.writes.slice(0, 5), ['course', 'contentobject', 'article', 'block', 'component']);
    assert.strictEqual(h.records.config.length, 1);
    assert.strictEqual(h.records.config[0]._menu, 'adapt-menu');
    assert.strictEqual(h.records.component[0]._parentId, h.records.block[0]._id);
    assert.strictEqual(h.records.component[0].properties._graphic.large, 'course/assets/copied.png');
    assert.strictEqual(h.records.courseasset[0]._contentType, 'component');
    assert.strictEqual(h.records.courseasset[0]._contentTypeId, h.records.component[0]._id);
    assert.strictEqual(h.records.courseasset[0]._contentTypeParentId, h.records.block[0]._id);
    assert.strictEqual(h.records.courseasset[0]._fieldName, 'copied.png');
    assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'converted');
    assert.strictEqual(h.records.lightcourse[0]._convertedCourseId, result.body.courseId);
    assert.strictEqual(h.records.lightcourse[0].conversionAttempt.idMap.component, h.records.component[0]._id);
    assert.strictEqual(h.records.auditlog[0].snapshot.conversionAttempt.idMap.component, h.records.component[0]._id);
    assert.deepStrictEqual(h.records.lightcourseversion, original);
    assert.deepStrictEqual(h.files, []);
    var retry = await h.request(true, { approved: true });
    assert.strictEqual(retry.body.courseId, result.body.courseId);
    assert.strictEqual(h.records.course.length, 1);
  });
  it('requires admin permissions and authentication', async function() {
    assert.strictEqual((await harness({ denied: true }).request(false)).status, 403);
    assert.strictEqual((await harness({ loggedOut: true }).request(false)).status, 401);
  });
  it('describes issue locations using the saved version even when the draft has changed', async function() {
    var h = harness();
    component(h.records.lightcourse[0]).title = 'Unsaved version title';
    var review = await h.request(false);
    assert.strictEqual(review.status, 200);
    assert.strictEqual(review.body.ready, false);
    assert.strictEqual(review.body.locations.component[3].title, 'Graphic');
    assert(review.body.errors.some(function(error) { return /draft has changes/.test(error.message); }));
  });
  it('rewrites resource and help assets while retaining resource IDs and ownership joins', async function() {
    var h = harness(), resourceId = 'ffffffffffffffffffffffff';
    h.records.asset = [{ _id: resourceId, _tenantId: 'tenant', filename: 'resource.pdf',
      path: 'general/resource.pdf', repository: 'localfs', mimeType: 'application/pdf' }];
    h.records.extensiontype = ['resources', 'help'].map(function(key) {
      var properties = key === 'resources' ? { _resourcesItems: { type: 'array' } } :
        { _popup: { type: 'object' }, _items: { type: 'array' } };
      return { _id: key, extension: key, properties: { pluginLocations: { properties: {
        course: { properties: { ['_' + key]: { type: 'object', properties: properties } } }
      } } } };
    });
    var draft = h.records.lightcourse[0];
    draft.pluginSelections.extensions = ['resources', 'help'];
    draft.resourceItems = [{ _id: 'resource-01', title: 'Document', _type: 'document', _assetId: resourceId }];
    draft.helpContent = { popup: { title: 'Help' }, items: [{ _id: 'help-01', title: 'Example', _graphicAssetId: ASSET }] };
    h.records.lightcourseversion[0].contentSnapshot = copy(draft);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var extensions = h.records.course[0]._extensions, resource = extensions._resources._resourcesItems[0];
    assert.strictEqual(resource._id, 'resource-01');
    assert.strictEqual(resource._link, 'course/assets/resource.pdf');
    assert.strictEqual(resource._assetId, undefined);
    assert.strictEqual(extensions._help._items[0]._graphic.src, 'course/assets/copied.png');
    assert(h.records.courseasset.some(function(join) {
      return join._assetId === resourceId && join._contentType === 'course' && join._contentTypeId === result.body.courseId;
    }));
    assert(h.records.asset.some(function(asset) { return asset._id === resourceId; }));
  });
  it('blocks missing/foreign assets and missing saved versions without writes', async function() {
    for (var options of [{ missingFile: true }, { foreignAsset: true }]) {
      var h = harness(options), result = await h.request(false);
      assert.strictEqual(result.body.ready, false);
      assert(result.body.errors.length > 0);
      assert.deepStrictEqual(h.writes, []);
    }
    var h = harness();
    h.records.lightcourseversion = [];
    assert.strictEqual((await h.request(false)).status, 400);
  });
  it('rejects a saved version owned by another tenant without writing', async function() {
    var h = harness();
    h.records.lightcourseversion[0]._tenantId = 'another-tenant';
    assert.strictEqual((await h.request(false)).status, 403);
    assert.deepStrictEqual(h.writes, []);
  });
  it('requires explicit approval and a current review hash', async function() {
    var h = harness(), review = await h.request(false);
    assert.strictEqual((await h.request(true, { hash: review.body.hash })).status, 409);
    h.records.lightcourseconfig[0].conversionDefaults['component:graphic']['_graphic.large'] = 'https://example.test/changed.png';
    assert.strictEqual((await h.request(true, { hash: review.body.hash, approved: true })).status, 409);
    assert.deepStrictEqual(h.writes, []);
  });
  it('allows only one concurrent conversion of a reviewed revision', async function() {
    var h = harness(), review = await h.request(false);
    var results = await Promise.all([h.request(true, { hash: review.body.hash, approved: true }),
      h.request(true, { hash: review.body.hash, approved: true })]);
    assert.deepStrictEqual(results.map(function(result) { return result.status; }).sort(), [200, 409]);
    assert.strictEqual(h.records.course.length, 1);
  });
  it('proposes a configured required image fallback when the authored managed asset is missing', async function() {
    var h = harness(), missing = 'ffffffffffffffffffffffff';
    component(h.records.lightcourse[0])._graphic.large = missing;
    component(h.records.lightcourseversion[0].contentSnapshot)._graphic.large = missing;
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    assert(review.body.proposals.some(function(proposal) { return proposal.previous === missing && proposal.value === ASSET; }));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200);
  });
  it('reviews and rewrites per-item image fallbacks for missing files and wrong MIME types without replacing items', async function() {
    var h = harness(), missing = 'ffffffffffffffffffffffff', wrongType = '999999999999999999999999';
    itemGraphics(h.fixture, [
      { title: 'Valid', _graphic: { src: ASSET, alt: 'Valid alt' } },
      { title: 'Missing file', _graphic: { src: missing, alt: 'Missing alt' } },
      { title: 'Wrong type', _graphic: { src: wrongType, alt: 'Wrong alt' } },
      { title: 'Empty' }
    ]);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = h.fixture.version;
    h.records.lightcourseasset.push({ _id: wrongType, _tenantId: 'tenant', mimeType: 'audio/mpeg',
      path: 'bank/audio.mp3', repository: 'localfs' });
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    var proposals = review.body.proposals.filter(function(proposal) { return proposal.path.startsWith('_items['); });
    assert.strictEqual(proposals.length, 3);
    assert(!proposals.some(function(proposal) { return proposal.path === '_items[0]._graphic.src'; }));
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    var items = h.records.component[0].properties._items;
    assert.deepStrictEqual(items.map(function(item) { return item.title; }), ['Valid', 'Missing file', 'Wrong type', 'Empty']);
    items.forEach(function(item) { assert.strictEqual(item._graphic.src, 'course/assets/copied.png'); });
    assert.strictEqual(items[1]._graphic.alt, 'Missing alt');
  });
  it('blocks conversion if an opted-in item graphic placeholder is unavailable', async function() {
    var h = harness();
    itemGraphics(h.fixture, [{ title: 'Keep this item' }]);
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0] = h.fixture.version;
    h.fixture.defaults['component:graphic']['_items[]._graphic.src'] = 'ffffffffffffffffffffffff';
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, false);
    assert(review.body.errors.some(function(error) { return error.path === '_items[0]._graphic.src'; }));
    assert.deepStrictEqual(h.writes, []);
    assert.strictEqual(component(h.records.lightcourse[0])._items[0]._graphic, undefined);
  });
  it('rejects wrong media types and missing draft versions without writing', async function() {
    var h = harness();
    h.records.lightcourseasset[0].mimeType = 'audio/mpeg';
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, false);
    assert(review.body.errors.some(function(error) { return error.message.includes('type image'); }));
    assert.deepStrictEqual(h.writes, []);
  });
  it('validates the stored course before locking and rolls back if the final lock fails', async function() {
    for (var option of ['failValidation', 'failFinal']) {
      var h = harness(), review = await h.request(false);
      h[option] = true;
      var result = await h.request(true, { hash: review.body.hash, approved: true });
      assert.strictEqual(result.status, option === 'failFinal' ? 409 : 500);
      assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'none');
      assert.strictEqual(h.records.course.length, 0);
      assert.strictEqual((h.records.auditlog || []).length, 0);
    }
  });
  it('rolls back if persistence silently drops composed content', async function() {
    var h = harness({ dropField: true }), review = await h.request(false);
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 500);
    assert(result.body.message.includes('not preserved'));
    assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'none');
    assert.strictEqual(h.records.course.length, 0);
  });
  it('cleans up writes including a failed post-create hook and leaves the source editable', async function() {
    var h = harness({ failType: 'component' }), review = await h.request(false);
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 500);
    ['course', 'config', 'contentobject', 'article', 'block', 'component', 'asset'].forEach(function(type) {
      assert.strictEqual((h.records[type] || []).length, 0, type);
    });
    assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'none');
    assert.deepStrictEqual(h.files, []);
    h.failType = undefined;
    var nextReview = await h.request(false);
    assert.strictEqual((await h.request(true, { hash: nextReview.body.hash, approved: true })).status, 200);
  });
  it('does not remove reused existing assets on a failed conversion', async function() {
    var h = harness({ failType: 'component', duplicate: true }), review = await h.request(false);
    await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(h.records.asset.length, 1);
  });
  it('does not unlock after cleanup errors and reports administrator recovery details', async function() {
    var h = harness({ failType: 'component', cleanupFail: true }), review = await h.request(false);
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 500);
    assert(result.body.message.includes('administrator attention'));
    assert.strictEqual(h.records.lightcourse[0].conversionStatus, 'converting');
    assert.strictEqual((await h.request(true, { hash: review.body.hash, approved: true })).status, 409);
  });
});

describe('Conversion Defaults admin editor', function() {
  function element(category) {
    return {
      category: category, options: [], value: '',
      attr: function() { return this.category; },
      empty: function() { this.options = []; return this; },
      append: function(option) { this.options.push(option); return this; },
      val: function(value) {
        if (!arguments.length) return this.value;
        this.value = value;
        return this;
      },
      text: function(value) { this.label = value; return this; },
      prop: function(name, value) { this[name] = value; return this; }
    };
  }
  function view() {
    var definition, payload, reported;
    var Origin = { l10n: { t: function(key) { return key; } }, Notify: { alert: function() {} } };
    var filename = path.join(ROOT, 'frontend/src/modules/lightCourseAdmin/views/lightCourseConversionDefaultsView.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      $: function(value) { return typeof value === 'string' ? element() : value; },
      define: function(factory) {
        factory(function(name) {
          if (name === 'core/origin') return Origin;
          if (name === 'core/views/originView') return { extend: function(value) { definition = value; } };
          return {};
        });

      }
    }, { filename: filename });
    var instance = Object.assign({}, definition, {
      model: {
        get: function(key) {
          assert.strictEqual(key, 'conversionDefaults');
          return { 'component:graphic': { '_graphic.large': ASSET }, 'core:course': { title: 'Untitled conversion' } };
        },
        save: function(data) { payload = data; }
      },
      $: function() { return { prop: function() {} }; },
      showError: function(error) { reported = error.responseJSON.message; }
    });
    instance.preRender();
    return { instance: instance, payload: function() { return payload; }, error: function() { return reported; } };
  }
  it('saves only the separate conversion values and retains other configured groups', function() {
    var h = view(), instance = h.instance;
    instance.currentGroup = 'component:graphic';
    instance.editors = [
      { path: '_graphic.large', enabled: { prop: function() { return true; } }, form: { getValue: function() { return { value: ASSET }; } } },
      { path: '_items', enabled: { prop: function() { return true; } },
        form: { getValue: function() { return { value: [{ title: 'Default item' }] }; } } },
      { path: '_media', enabled: { prop: function() { return true; } },
        form: { getValue: function() { return { value: { source: ASSET, autoplay: false, volume: 0 } }; } } },
      { path: 'unused', enabled: { prop: function() { return false; } } }
    ];
    instance.onSave({ preventDefault: function() {} });
    assert.deepStrictEqual(Object.keys(h.payload()), ['conversionDefaults']);
    assert.strictEqual(h.payload().conversionDefaults['core:course'].title, 'Untitled conversion');
    assert.strictEqual(h.payload().conversionDefaults['component:graphic']._items[0].title, 'Default item');
    assert.deepStrictEqual(h.payload().conversionDefaults['component:graphic']._media,
      { source: ASSET, autoplay: false, volume: 0 });
    assert.strictEqual(h.payload().conversionDefaults['component:graphic'].unused, undefined);
  });
  it('retains existing hidden grouped fallbacks when saving individual controls', function() {
    var h = view(), instance = h.instance;
    instance.currentGroup = 'component:graphic';
    instance.values['component:graphic']._columns = { _large: 4, _medium: 2, _small: 1 };
    instance.groups = [{ key: instance.currentGroup, fields: [
      { path: '_columns', hidden: true, duplicateContainer: true },
      { path: '_columns._large' }
    ] }];
    instance.editors = [{ path: '_columns._large', enabled: { prop: function() { return true; } },
      form: { getValue: function() { return { value: 3 }; } } }];
    instance.onSave({ preventDefault: function() {} });
    var values = h.payload().conversionDefaults['component:graphic'];
    assert.deepStrictEqual(values._columns, { _large: 4, _medium: 2, _small: 1 });
    assert.strictEqual(values['_columns._large'], 3);
  });
  it('reports editor errors and rejects empty enabled defaults instead of saving them', function() {
    var h = view(), instance = h.instance;
    instance.currentGroup = 'component:graphic';
    instance.editors = [{ path: '_items', enabled: { prop: function() { return true; } },
      form: { getValue: function() { throw new Error('Editor failed'); } } }];
    instance.onSave({ preventDefault: function() {} });
    assert(h.error());
    assert.strictEqual(h.payload(), undefined);
    instance.editors = [{ path: '_graphic.large', enabled: { prop: function() { return true; } },
      form: { getValue: function() { return { value: '' }; } } }];
    instance.onSave({ preventDefault: function() {} });
    assert.strictEqual(h.error(), 'app.lightcourseconversionemptydefault');
    assert.strictEqual(h.payload(), undefined);
  });
  function withSelectors() {
    var h = view(), instance = h.instance;
    var selectors = ['core', 'component', 'extension', 'menu', 'theme'].map(element);
    instance.$ = function(selector) {
      if (selector === '.light-course-conversion-group') return {
        each: function(callback) { selectors.forEach(function(select) { callback.call(select); }); }
      };
      return element();
    };
    instance.renderGroup = function(key) { this.currentGroup = key; this.editors = []; };
    h.selectors = selectors;
    return h;
  }
  it('splits core types, components and plugins into alphabetically sorted dropdowns', function() {
    var h = withSelectors(), instance = h.instance;
    instance.groups = [
      { key: 'component:zebra', label: 'Zebra' }, { key: 'core:config', label: 'config' },
      { key: 'extension:zebra:course', label: 'Zebra / course' }, { key: 'core:article', label: 'article' },
      { key: 'component:accordion', label: 'accordion' }, { key: 'extension:audio:course', label: 'Audio / course' },
      { key: 'menu:tiles:course', label: 'Tiles / course' }
    ];
    instance.renderSelectors();
    assert.deepStrictEqual(h.selectors[0].options.map(function(option) { return option.value; }), ['', 'core:article', 'core:config']);
    assert.deepStrictEqual(h.selectors[1].options.map(function(option) { return option.value; }),
      ['', 'component:accordion', 'component:zebra']);
    assert.deepStrictEqual(h.selectors[2].options.map(function(option) { return option.value; }),
      ['', 'extension:audio:course', 'extension:zebra:course']);
    assert.strictEqual(h.selectors[3].options[1].value, 'menu:tiles:course');
    assert.strictEqual(h.selectors[4].disabled, true);
    assert.strictEqual(instance.currentGroup, 'core:article');
    assert.deepStrictEqual(h.selectors.map(function(select) { return select.value; }), ['core:article', '', '', '', '']);
  });
  it('retains edits across categories and restores the active selection if validation fails', function() {
    var h = withSelectors(), instance = h.instance;
    instance.currentGroup = 'component:graphic';
    instance.editors = [{ path: '_graphic.large', enabled: { prop: function() { return true; } },
      form: { getValue: function() { return { value: ASSET }; } } }];
    h.selectors[0].val('core:course');
    instance.onGroupChanged({ currentTarget: h.selectors[0] });
    assert.strictEqual(instance.values['component:graphic']['_graphic.large'], ASSET);
    assert.strictEqual(instance.currentGroup, 'core:course');
    assert.deepStrictEqual(h.selectors.map(function(select) { return select.value; }), ['core:course', '', '', '', '']);
    instance.editors = [{ path: 'count', enabled: { prop: function() { return true; } },
      form: { getValue: function() { throw new Error('Editor failed'); } } }];
    h.selectors[2].val('extension:audio:course');
    instance.onGroupChanged({ currentTarget: h.selectors[2] });
    assert(h.error());
    assert.strictEqual(instance.currentGroup, 'core:course');
    assert.deepStrictEqual(h.selectors.map(function(select) { return select.value; }), ['core:course', '', '', '', '']);
  });
  it('handles an empty catalogue without selecting a nonexistent group', function() {
    var h = withSelectors();
    h.instance.groups = [];
    h.instance.renderSelectors();
    assert.strictEqual(h.instance.currentGroup, '');
    h.selectors.forEach(function(select) {
      assert.strictEqual(select.disabled, true);
      assert.strictEqual(select.options.length, 1);
    });
  });
  it('hides layout metadata and whole item arrays for all components while retaining individual item controls', async function() {
    var h = harness();
    itemGraphics(h.fixture, [{ title: 'Item' }]);
    var plugin = h.fixture.catalog.component.graphic;
    plugin.properties._items.required = true;
    plugin.properties._items.items.properties.answer = { type: 'string', required: true };
    h.records.componenttype.push(Object.assign(copy(plugin), { component: 'accordion' }));
    var catalog = await catalogs.load(h.db, h.fixture.catalog.core);
    var groups = catalogs.definitions(catalog);
    ['graphic', 'accordion'].forEach(function(key) {
      var fields = groups.find(function(group) { return group.key === 'component:' + key; }).fields;
      ['_supportedLayout', '_items'].forEach(function(path) {
        assert.strictEqual(fields.find(function(field) { return field.path === path; }).hidden, true);
      });
      assert.strictEqual(fields.find(function(field) { return field.path === '_items[].answer'; }).hidden, false);
      var graphic = fields.find(function(field) { return field.path === '_items[]._graphic.src'; });
      assert.strictEqual(graphic.hidden, false);
      assert.strictEqual(graphic.itemGraphic, true);
      assert.strictEqual(fields.find(function(field) { return field.path === '_graphic.large'; }).hidden, false);
    });
  });
  it('uses the installed required-field catalogue, including inherited content fields', async function() {
    var h = harness(), catalog = await catalogs.load(h.db, h.fixture.catalog.core);
    assert(catalog.core.article.properties._parentId);
    assert(catalog.core.article.properties._tenantId);
    var groups = catalogs.definitions(catalog), graphic = groups.find(function(group) { return group.key === 'component:graphic'; });
    assert(graphic.fields.some(function(field) { return field.path === '_graphic.large'; }));
    assert(!graphic.fields.some(function(field) { return field.path === 'optional'; }));
  });
});

describe('optional base image conversion defaults', function() {
  function baseImages(f) {
    f.catalog.component.graphic.properties._graphic.required = false;
    ['large', 'small'].forEach(function(key) {
      f.catalog.component.graphic.properties._graphic.properties[key].required = false;
      f.catalog.component.graphic.properties._graphic.properties[key].validators = [];
    });
    f.catalog.component.graphic.properties._mobile = { type: 'object', properties: {
      image: { type: 'string', inputType: { type: 'Asset:image' }, default: '' }
    } };
    f.defaults['component:graphic']['_mobile.image'] = ASSET;
  }
  it('lists base/mobile images and does not invent item images for text-only items', function() {
    var f = fixture();
    baseImages(f);
    var groups = catalogs.definitions(f.catalog);
    var fields = groups.find(function(group) { return group.key === 'component:graphic'; }).fields;
    ['_graphic.large', '_graphic.small', '_mobile.image'].forEach(function(path) {
      var field = fields.find(function(field) { return field.path === path; });
      assert(field, path);
      assert.strictEqual(field.hidden, false);
      assert.strictEqual(field.image, true);
      assert.strictEqual(field.itemGraphic, false);
    });
    assert(!fields.some(function(field) { return field.itemGraphic; }));
    itemGraphics(f, []);
    fields = catalogs.definitions(f.catalog).find(function(group) { return group.key === 'component:graphic'; }).fields;
    assert.deepStrictEqual(fields.filter(function(field) { return field.itemGraphic; }).map(function(field) { return field.path; }),
      ['_items[]._graphic.src']);
  });
  it('fills configured optional base images and creates absent mobile graphic objects without changing source content', function() {
    var f = fixture();
    baseImages(f);
    component(f.draft)._graphic.large = 'https://example.test/authored.png';
    f.version.contentSnapshot = copy(f.draft);
    var original = JSON.stringify(f), plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    assert.deepStrictEqual(plan.errors, []);
    var data = plan.records.find(function(record) { return record.id === 'component'; }).data;
    assert.strictEqual(data._graphic.large, 'https://example.test/authored.png');
    assert.strictEqual(data._graphic.alt, 'Authored alt');
    assert.strictEqual(data._graphic.small, ASSET);
    assert.strictEqual(data._mobile.image, ASSET);
    assert.strictEqual(JSON.stringify(f), original);
    f.defaults = {};
    plan = planner.build(f.draft, f.version, f.catalog, f.defaults);
    data = plan.records.find(function(record) { return record.id === 'component'; }).data;
    assert.strictEqual(data._mobile, undefined);
    assert.strictEqual(data._graphic.small, undefined);
  });
  it('reviews invalid optional base images and migrates replacements without replacing valid images', async function() {
    var h = harness();
    baseImages(h.fixture);
    component(h.fixture.draft)._graphic.large = 'ffffffffffffffffffffffff';
    component(h.fixture.draft)._graphic.small = 'https://example.test/keep.png';
    h.records.lightcourse[0] = copy(h.fixture.draft);
    h.records.lightcourseversion[0].contentSnapshot = copy(h.fixture.draft);
    var review = await h.request(false);
    assert.strictEqual(review.body.ready, true, JSON.stringify(review.body.errors));
    assert(review.body.proposals.some(function(proposal) {
      return proposal.path === '_graphic.large' && proposal.value === ASSET;
    }));
    var converted = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(converted.status, 200, converted.body.message);
    assert.strictEqual(h.records.component[0].properties._graphic.large, 'course/assets/copied.png');
    assert.strictEqual(h.records.component[0].properties._graphic.small, 'https://example.test/keep.png');
    assert.strictEqual(h.records.component[0].properties._mobile.image, 'course/assets/copied.png');
  });
});

describe('Conversion Defaults nested field controls', function() {
  function builder() {
    var build, editors = {};
    var handlebars = require('handlebars').create();
    handlebars.registerHelper('t', function(key) {
      return key === 'app.delete' ? 'Delete' : key === 'app.duplicate' ? 'Duplicate' :
        key === 'app.lightcoursemoveup' ? 'Move up' :
        key === 'app.lightcoursemovedown' ? 'Move down' : 'Add';
    });
    var listTemplate = handlebars.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/scaffold/templates/list.hbs'), 'utf8'));
    var itemTemplate = handlebars.compile(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseEditor/templates/lightCourseInlineListItem.hbs'), 'utf8'));
    function Base() {}
    Base.Item = function() {};
    Base.Item.template = 'plain item template';
    Base.Item.prototype.render = function() { return this; };
    Base.extend = function(methods) {
      function List() {}
      List.prototype = methods;
      return List;
    };
    Base.Item.extend = Base.extend;
    Base.prototype = {
      render: function() { this.addItem(); return this; },
      addItem: function(value) { this.added = value; return value; },
      getValue: function() { return this.items.map(function(item) { return item.getValue(); }); },
      setValue: function(value) { this.value = value; return this.render(); }
    };
    editors.__List = Base;
    editors.Base = Base;
    editors.Object = function ObjectEditor() {};
    editors.Text = function TextEditor() {};
    editors.Number = function NumberEditor() {};
    editors.Checkbox = function CheckboxEditor() {};
    var BankAsset = function BankAsset() {};
    var Origin = { scaffold: { buildSchema: function(fields) {
      var field = fields.value;
      return { value: {
        type: field.type === 'boolean' ? 'Checkbox' : field.type === 'number' ? 'Number' : 'Text',
        title: field.title, inputType: field.inputType, validators: field.validators, default: field.default
      } };
    } } };
    var filename = path.join(ROOT, 'frontend/src/modules/lightCourseAdmin/conversionFieldSchema.js');
    var listEditor;
    function jquery(value) { return value; }
    jquery.trim = function(value) { return value; };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT,
      'frontend/src/modules/lightCourseEditor/inlineListEditor.js'), 'utf8'), {
      Backbone: { Form: { editors: editors }, $: jquery },
      Handlebars: { templates: { list: listTemplate, lightCourseInlineListItem: itemTemplate } },
      define: function(factory) {
        listEditor = factory(function(name) {
          if (name === 'core/origin') return { l10n: { t: function() { return 'Untitled item'; } } };
          if (name === './ideaLinks') return { clearItemIds: function() {} };
          return require('../frontend/src/modules/lightCourseEditor/alphabetical');
        });
      }
    });
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      Backbone: { Form: { editors: editors } },
      define: function(factory) {
        build = factory(function(name) {
          if (name === 'core/origin') return Origin;
          if (name === '../lightCourseEditor/views/lightCourseBankAssetFieldView') return BankAsset;
          if (name === '../lightCourseEditor/inlineListEditor') return listEditor;
          throw new Error('Unexpected dependency: ' + name);
        });
      }
    }, { filename: filename });
    return { build: build, editors: editors, BankAsset: BankAsset };
  }
  it('expands required containers into typed controls for every nested field without modifying the schema', function() {
    var h = builder(), field = { type: 'object', required: true, properties: {
      source: { type: 'string', inputType: 'Asset:video' },
      optionalCaption: { type: 'string' },
      autoplay: { type: 'boolean', default: false },
      settings: { type: 'object', properties: { volume: { type: 'number', default: 0 } } }
    } }, original = JSON.stringify(field);
    var result = h.build(field, '_media');
    assert.strictEqual(result.type, h.editors.Object);
    assert.deepStrictEqual(Object.keys(result.subSchema), ['source', 'optionalCaption', 'autoplay', 'settings']);
    assert.strictEqual(result.subSchema.source.type, h.BankAsset);
    assert.strictEqual(result.subSchema.source.inputType, 'LightCourseAsset:video');
    assert.strictEqual(result.subSchema.autoplay.type, 'Checkbox');
    assert.strictEqual(result.subSchema.autoplay.default, false);
    assert.strictEqual(result.subSchema.settings.subSchema.volume.type, 'Number');
    assert.strictEqual(result.subSchema.settings.subSchema.volume.default, 0);
    assert.strictEqual(JSON.stringify(field), original);
  });
  it('supports all asset dialects inside array items without invoking full-editor asset controls', function() {
    var h = builder(), result = h.build({ type: 'array', items: { type: 'object', properties: {
      image: { type: 'string', inputType: { type: 'Asset:image' } },
      audio: { type: 'string', inputType: 'Asset:audio' },
      legacy: { type: 'string', _backboneForms: 'Asset' },
      nested: { type: 'array', items: { type: 'number' } }
    } } }, '_items');
    assert.strictEqual(result.itemType, h.editors.Object);
    assert.strictEqual(result.itemSchema.type, h.editors.Object);
    ['image', 'audio', 'legacy'].forEach(function(key) {
      assert.strictEqual(result.subSchema[key].type, h.BankAsset);
    });
    assert.strictEqual(result.subSchema.nested.itemType, h.editors.Number);
    assert.strictEqual(result.confirmDelete, false);
  });
  it('keeps hidden item values typed and uses installed defaults without exposing optional controls', function() {
    var h = builder(), raw = { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string', required: true },
      enabled: { type: 'boolean', required: true, default: false },
      count: { type: 'number', required: true, default: 0 },
      optional: { type: 'string' }
    } } };
    var result = h.build(schema.editorSchema(raw), '_items'), properties = result.subSchema;
    assert.strictEqual(properties.title.type, 'Text');
    ['enabled', 'count', 'optional'].forEach(function(key) {
      assert.strictEqual(properties[key].fieldAttrs.style, 'display: none');
    });
    var enabled = new properties.enabled.type();
    enabled.schema = properties.enabled;
    enabled.value = true;
    assert.strictEqual(enabled.getValue(), false);
    var count = new properties.count.type();
    count.schema = properties.count;
    count.value = 25;
    assert.strictEqual(count.getValue(), 0);
    var optional = new properties.optional.type();
    optional.schema = properties.optional;
    optional.value = 'Retain existing optional value';
    assert.strictEqual(optional.getValue(), 'Retain existing optional value');
    optional.value = undefined;
    assert.strictEqual(optional.getValue(), undefined);
  });
  it('keeps arrays empty until Add and supports removing the last item without adding a replacement', function() {
    var h = builder(), result = h.build({ type: 'array', items: { type: 'string' } }, 'names');
    var list = new result.type();
    list.items = [];
    list.render();
    assert.strictEqual(list.added, undefined);
    list.addItem('New item', true);
    assert.strictEqual(list.added, 'New item');
    var removed = false, events = [];
    var item = { remove: function() { removed = true; }, editor: {} };
    list.items = [item];
    list.trigger = function(event) { events.push(event); };
    list.removeItem(item);
    assert.strictEqual(removed, true);
    assert.strictEqual(list.items.length, 0);
    assert.deepStrictEqual(events, ['remove', 'change']);
  });
  it('uses the translated primary Add button template for inline lists', function() {
    var result = builder().build({ type: 'array', items: { type: 'string' } }, 'names');
    var html = result.type.template({});
    assert(/class="btn primary"[^>]*data-action="add"[^>]*>Add<\/button>/.test(html));
  });
  it('preserves component item order and reorders items through the arrow controls', function() {
    var result = builder().build({ type: 'array', items: { type: 'string' } }, 'names');
    var list = new result.type(), appended = [], events = [];
    function item(value) {
      var state = { disabled: {} };
      return {
        value: value,
        el: value,
        state: state,
        list: list,
        getValue: function() { return this.value; },
        $: function(selector) {
          return { prop: function(key, disabled) { state.disabled[selector] = disabled; } };
        }
      };
    }
    var z = item('Z'), a = item('A');
    list.schema = { preserveOrder: true };
    list.items = [z, a];
    list.$list = { append: function(element) { appended.push(element); } };
    list.trigger = function(event) { events.push(event); };
    list.sortItems();
    assert.deepStrictEqual(list.items.map(function(entry) { return entry.value; }), ['Z', 'A']);
    assert.deepStrictEqual(appended, ['Z', 'A']);

    var moveUp = result.itemClass.prototype.events['click [data-action="move-up"]'];
    moveUp.call(a, { preventDefault: function() {}, stopPropagation: function() {} });
    assert.deepStrictEqual(list.items.map(function(entry) { return entry.value; }), ['A', 'Z']);
    assert.deepStrictEqual(list.getValue(), ['A', 'Z']);
    assert.strictEqual(a.state.disabled['[data-action="move-up"]'], true);
    assert.strictEqual(z.state.disabled['[data-action="move-down"]'], true);
    assert.deepStrictEqual(events, ['change']);

    var conversionList = new result.type();
    conversionList.schema = {};
    conversionList.items = [z, a];
    conversionList.$list = { append: function() {} };
    conversionList.sortItems();
    assert.deepStrictEqual(conversionList.items.map(function(entry) { return entry.value; }), ['A', 'Z']);
    assert.deepStrictEqual(conversionList.getValue(), ['A', 'Z']);
  });
  it('removes the intended item if removing its focused editor causes the list to sort', function() {
    var result = builder().build({ type: 'array', items: { type: 'string' } }, 'names');
    var list = new result.type();
    var other = { editor: {}, getValue: function() { return 'Z'; } };
    var selected = { editor: {}, getValue: function() { return 'A'; },
      remove: function() { list.sortItems(); } };
    list.items = [other, selected];
    list.$list = { append: function() {} };
    list.trigger = function() {};
    list.removeItem(selected);
    assert.strictEqual(list.items.length, 1);
    assert.strictEqual(list.items[0], other);
  });
  it('removes every old item when resetting a list whose focused editor triggers sorting', function() {
    var result = builder().build({ type: 'array', items: { type: 'string' } }, 'names');
    var list = new result.type(), removed = [];
    list.$list = { append: function() {} };
    list.items = ['Z', 'A'].map(function(value) {
      return { getValue: function() { return value; }, remove: function() { removed.push(value); list.sortItems(); } };
    });
    list.setValue(['replacement']);
    assert.deepStrictEqual(removed, ['Z', 'A']);
    assert.strictEqual(list.items.length, 0);
    assert.strictEqual(list.value[0], 'replacement');
  });
  it('renders accessible item accordions with a separate Delete button', function() {
    var result = builder().build({ type: 'array', items: { type: 'string' } }, 'names');
    var html = result.itemClass.template({});
    assert(/<details>[\s\S]*<summary>[\s\S]*<\/summary>[\s\S]*data-editor[\s\S]*<\/details>/.test(html));
    assert(/<button[^>]*data-action="remove"[^>]*>Delete<\/button>/.test(html));
    assert(/<button[^>]*data-action="clone"[^>]*aria-label="Duplicate"[^>]*>[\s\S]*fa-clone/.test(html));
  });
  it('renders move arrows only for component item lists that preserve order', function() {
    var result = builder().build({ type: 'array', items: { type: 'string' } }, 'names');
    var html = result.itemClass.template({ preserveOrder: true });
    assert(/data-action="move-up"[^>]*title="Move up"/.test(html));
    assert(/data-action="move-down"[^>]*title="Move down"/.test(html));
    assert(!/data-action="move-up"/.test(result.itemClass.template({})));
  });
  it('opens new items, collapses saved items and updates only their own heading on changes', function() {
    var result = builder().build({ type: 'array', items: { type: 'object', properties: {} } }, 'items');
    var proto = result.itemClass.prototype;
    function item(value, current, userInitiated) {
      var state = {}, label = { text: function(text) { state.label = text; } };
      var summary = { children: function(selector) {
        assert.strictEqual(selector, '.light-course-inline-list-item-label');
        return label;
      } };
      var details = {
        prop: function(key, open) { assert.strictEqual(key, 'open'); state.open = open; return this; },
        children: function(selector) { assert.strictEqual(selector, 'summary'); return summary; }
      };
      var $el = {
        find: function(selector) {
          assert.strictEqual(selector, '[data-editor]');
          return { append: function() {} };
        },
        children: function(selector) { assert.strictEqual(selector, 'details'); return details; }
      };
      var view = Object.assign(Object.create(proto), {
        cid: value === undefined ? 'new' : 'saved', value: value, list: { userInitiated: userInitiated },
        Editor: function(options) { state.editorId = options.id; this.render = function() { return this; }; },
        template: function() { return $el; },
        setElement: function(element) { this.$el = element; },
        getValue: function() { return current; },
        listenTo: function(editor, event, callback) { state.change = callback.bind(this); }
      });
      view.render();
      return { state: state, change: function(value) { current = value; state.change(); } };
    }
    var saved = item({ title: 'Saved' }, { title: '<b>Saved</b>' });
    var added = item(undefined, { title: '' });
    var duplicated = item({ title: 'Copy' }, { title: 'Copy' }, true);
    assert.strictEqual(saved.state.open, false);
    assert.strictEqual(saved.state.label, 'Saved');
    assert.strictEqual(saved.state.editorId, 'light-course-item-saved');
    assert.strictEqual(added.state.open, true);
    assert.strictEqual(added.state.label, 'Untitled item');
    assert.strictEqual(duplicated.state.open, true);
    assert.notStrictEqual(added.state.editorId, saved.state.editorId);
    added.change({ title: 'New title' });
    assert.strictEqual(added.state.label, 'New title');
    assert.strictEqual(saved.state.label, 'Saved');
  });
  it('duplicates the current item values independently and stops nested clicks from reaching the parent', function() {
    var result = builder().build({ type: 'array', items: { type: 'object', properties: {} } }, 'items');
    var clone = result.itemClass.prototype.events['click [data-action="clone"]'];
    var original = { title: 'Edited', children: [{ title: 'Child', image: 'asset-id' }], enabled: false };
    var copied, initiated, stopped = 0;
    var context = {
      getValue: function() { return original; },
      list: { addItem: function(value, user) { copied = value; initiated = user; } }
    };
    clone.call(context, { preventDefault: function() {}, stopPropagation: function() { stopped++; } });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(copied)), original);
    assert.strictEqual(initiated, true);
    assert.strictEqual(stopped, 1);
    copied.children[0].title = 'Changed copy';
    assert.strictEqual(original.children[0].title, 'Child');
    context.getValue = function() { return undefined; };
    clone.call(context, { preventDefault: function() {}, stopPropagation: function() {} });
    assert.strictEqual(copied, undefined);
  });
  it('clears the transient add state after creating a copy', function() {
    var result = builder().build({ type: 'array', items: { type: 'string' } }, 'names');
    var list = new result.type();
    list.items = [];
    list.$list = { append: function() {} };
    list.addItem('Copy', true);
    assert.strictEqual(list.added, 'Copy');
    assert.strictEqual(list.userInitiated, undefined);
  });
  it('passes each array item its own schema so nested lists do not recurse into the outer list', function() {
    var h = builder(), result = h.build({ type: 'array', items: {
      type: 'array', items: { type: 'boolean' }
    } }, 'matrix');
    assert.strictEqual(result.itemSchema.itemType, h.editors.Checkbox);
    assert.strictEqual(result.itemSchema.itemSchema.type, 'Checkbox');
    var stopped = 0, added = false;
    result.type.prototype.events['click [data-action="add"]'].call({
      addItem: function(value, user) { added = user; }
    }, { preventDefault: function() {}, stopPropagation: function() { stopped++; } });
    result.itemClass.prototype.events['click [data-action="remove"]'].call({
      list: { removeItem: function() {} }
    }, { preventDefault: function() {}, stopPropagation: function() { stopped++; } });
    assert.strictEqual(added, true);
    assert.strictEqual(stopped, 2);
  });
});

describe('Conversion Defaults backend validation', function() {
  function configHarness(options) {
    options = options || {};
    var routes = {}, writes = 0;
    function Plugin() {}
    Plugin.prototype.create = function(data, next) { writes++; next(null, data); };
    Plugin.prototype.update = function(search, data, next) { writes++; next(null, data); };
    var Content = load('plugins/content/lightcourseconfig/index.js', {
      '../../../lib/contentmanager': { ContentPlugin: Plugin },
      '../../../lib/database': { getDatabase: function(next, tenant) {
        assert.strictEqual(tenant, 'tenant');
        next(null, {});
      } },
      '../../../lib/permissions': {
        ignoreRoute: function() {},
        buildResourceString: function(tenant, resource) { return 'urn:x-adapt:' + tenant + resource; },
        hasPermission: function(user, action, resource, next) {
          assert.strictEqual(resource, 'urn:x-adapt:tenant/*');
          next(null, !options.denied);
        }
      },
      '../../../lib/usermanager': { getCurrentUser: function() {
        return options.loggedOut ? null : { _id: 'admin', tenant: { _id: 'tenant' } };
      } },
      '../../../lib/rest': { get: function(url, handler) { routes[url] = handler; } },
      '../../../': function() {
        return { once: function(event, next) { next(); }, contentmanager: { _contentSchemas: {} } };
      },
      '../../../lib/lightcourse/conversionCatalog': {
        load: async function() { if (options.catalogError) throw new Error('Catalogue unavailable'); return {}; },
        definitions: function() {
          return options.groups || [{ key: 'component:sample', label: 'Sample', fields: [
            { path: 'count', schema: { type: 'number', required: true, minimum: 1 } }
          ] }];
        }
      }
    });
    return {
      write: function(method, defaults) {
        return new Promise(function(resolve) {
          var instance = new Content(), args = [{ conversionDefaults: defaults }, function(error) { resolve(error); }];
          if (method === 'update') args.unshift({});
          instance[method].apply(instance, args);
        });
      },
      writes: function() { return writes; },
      catalogue: function() {
        return new Promise(function(resolve) {
          routes['/lightcourseconfig/conversionschema']({}, {
            status: function(value) { this.code = value; return this; },
            json: function(body) { resolve({ status: this.code, body: body }); }
          });
        });
      }
    };
  }
  it('validates typed required fallbacks on create and update before persisting', async function() {
    for (var method of ['create', 'update']) {
      var h = configHarness();
      assert(await h.write(method, { 'component:sample': { count: 'not a number' } }));
      assert.strictEqual(h.writes(), 0);
      assert.strictEqual(await h.write(method, { 'component:sample': { count: 2 } }), null);
      assert.strictEqual(h.writes(), 1);
    }
  });
  it('accepts Completion text defaults and rejects invalid values', async function() {
    var f = fixture();
    configureCompletion(f);
    var h = configHarness({ groups: catalogs.definitions(f.catalog) });
    assert.strictEqual(await h.write('update', { 'extension:completion:course': {
      '_completion.title': 'Great job!', '_completion.body': '<p>Well done!</p>'
    } }), null);
    assert(await h.write('update', { 'extension:completion:course': { '_completion.body': 123 } }));
    assert.strictEqual(h.writes(), 1);
  });
  it('rejects non-required paths in installed groups but retains unavailable plugin groups', async function() {
    var h = configHarness();
    assert(await h.write('update', { 'component:sample': { optional: 'Not configurable' } }));
    assert.strictEqual(h.writes(), 0);
    assert.strictEqual(await h.write('update', { 'component:uninstalled': { requiredField: 'Retain' } }), null);
    assert.strictEqual(h.writes(), 1);
  });
  it('reports catalogue failures rather than persisting unchecked values', async function() {
    var h = configHarness({ catalogError: true });
    assert.strictEqual((await h.write('create', {})).message, 'Catalogue unavailable');
    assert.strictEqual(h.writes(), 0);
    assert.strictEqual((await h.catalogue()).status, 500);
  });
  it('requires authentication and administrator permission for the catalogue', async function() {
    assert.strictEqual((await configHarness({ loggedOut: true }).catalogue()).status, 401);
    assert.strictEqual((await configHarness({ denied: true }).catalogue()).status, 403);
    assert.strictEqual((await configHarness().catalogue()).status, 200);
  });
});
