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
    it('exposes optional image paths only inside arrays as explicit per-item fallbacks', function() {
      var fields = schema.fields({ properties: {
        image: { type: 'string', inputType: 'Asset:image' },
        _items: { type: 'array', items: { properties: {
          _graphic: { properties: { src: { type: 'string', inputType: 'Asset:image' } } },
          audio: { type: 'string', inputType: 'Asset:audio' }, optional: { type: 'string' }
        } } }
      } });
      assert.deepStrictEqual(fields.map(function(field) { return field.path; }), ['_items[]._graphic.src']);
      assert.strictEqual(fields[0].itemGraphic, true);
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
        records[type] = records[type] || [];
        var stored = copy(data);
        if (options.dropField && type === 'component') delete stored._graphic.large;
        records[type].push(stored);
        if (type === 'course') records.config = [{ _id: 'dddddddddddddddddddddddd', _courseId: data._id }];
        if (type === state.failType) return next(new Error('Write failed'));
        next(null, data);
      },
      update: function(type, query, data, next) {
        var record = records[type].find(function(record) { return matches(record, query); });
        Object.assign(record, copy(data)); next(null, record);
      }
    },
    assetmanager: {
      _createAssetFromFile: function(storage, file, metadata, user, repository, next) {
        var record = { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', filename: 'copied.png' };
        records.asset = records.asset || [];
        records.asset.push(record);
        next(null, record, !!options.duplicate);
      },
      destroyAsset: function(id, next) { records.asset = records.asset.filter(function(record) { return record._id !== id; }); next(); }
    },
    emit: function() {}
  };
  var user = { _id: 'admin', tenant: { _id: 'tenant' } };
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
  it('performs read-only preflight and converts parent-first with a single config and asset copy', async function() {
    var h = harness(), original = copy(h.records.lightcourseversion);
    var review = await h.request(false);
    assert.strictEqual(review.status, 200, review.body.message);
    assert.strictEqual(review.body.ready, true);
    assert.deepStrictEqual(h.writes, []);
    var result = await h.request(true, { hash: review.body.hash, approved: true });
    assert.strictEqual(result.status, 200, result.body.message);
    assert.deepStrictEqual(h.writes.slice(0, 5), ['course', 'contentobject', 'article', 'block', 'component']);
    assert.strictEqual(h.records.config.length, 1);
    assert.strictEqual(h.records.config[0]._menu, 'adapt-menu');
    assert.strictEqual(h.records.component[0]._parentId, h.records.block[0]._id);
    assert.strictEqual(h.records.component[0]._graphic.large, 'course/assets/copied.png');
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
    var items = h.records.component[0]._items;
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

describe('Conversion Defaults nested field controls', function() {
  function builder() {
    var build, editors = {};
    function Base() {}
    Base.Item = function() {};
    Base.Item.template = 'plain item template';
    Base.extend = function(methods) {
      function List() {}
      List.prototype = methods;
      return List;
    };
    Base.Item.extend = Base.extend;
    Base.prototype = {
      render: function() { this.addItem(); return this; },
      addItem: function(value) { this.added = value; return value; },
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
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      Backbone: { Form: { editors: editors } },
      define: function(factory) {
        build = factory(function(name) {
          if (name === 'core/origin') return Origin;
          if (name === '../lightCourseEditor/views/lightCourseBankAssetFieldView') return BankAsset;
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
    assert.strictEqual(result.itemClass.template, 'plain item template');
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
          return [{ key: 'component:sample', label: 'Sample', fields: [
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
