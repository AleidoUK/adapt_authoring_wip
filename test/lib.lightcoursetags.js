var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var _ = require('underscore');
var Backbone = require('../frontend/src/libraries/backbone');
var ROOT = path.join(__dirname, '..');

function load(file, dependencies, globals) {
  var result;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), Object.assign({
    _: _, Backbone: Backbone,
    define: function(factory) { result = factory(function(name) { return dependencies[name]; }); }
  }, globals));
  return result;
}

function harness(tags, locked) {
  var state = { requests: [], alerts: [], saves: 0 };
  var origin = { l10n: { t: function(key) { return key; } }, Notify: { alert: function(data) { state.alerts.push(data); } } };
  var input = { 0: {} };
  input.selectize = function(options) {
    state.settings = options;
    state.picker = {
      items: options.items.slice(), options: {},
      $control_input: { attr: function(key, value) { state.label = value; } },
      destroy: function() { this.destroyed = true; },
      disable: function() { this.disabled = true; }
    };
    options.options.forEach(function(tag) { state.picker.options[tag._id] = tag; });
    input[0].selectize = state.picker;
    options.onChange();
  };
  var $ = { ajax: function(options) {
    var request = { options: options,
      done: function(callback) { this.success = callback; return this; },
      fail: function(callback) { this.failure = callback; return this; },
      abort: function() { this.aborted = true; this.failure({ statusText: 'abort' }); }
    };
    state.requests.push(request);
    return request;
  } };
  var Model = load('frontend/src/modules/lightCourseEditor/models/lightCourseModel.js', { backbone: Backbone });
  var proto = load('frontend/src/modules/lightCourseEditor/views/lightCourseEditorView.js', {
    'core/origin': origin, 'core/views/originView': {
      extend: function(proto) { return proto; }, prototype: { remove: function() {} }
    }
  }, { $: $ });
  state.view = Object.assign(Object.create(proto), {
    model: new Model({ _id: 'course', tags: tags || [], conversionStatus: locked ? 'converted' : 'none' }),
    $: function() { return input; },
    treeView: { getContentTree: function() { return { children: [] }; }, remove: function() {} },
    autosave: function() { state.saves++; state.saved = this.assembleSaveData(); }
  });
  state.proto = proto;
  state.view.initializeTags();
  return state;
}

describe('core tags in light courses (isolated)', function() {
  it('uses the full-course tag reference schema and places the control before the course tree', function() {
    var course = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/content/course/model.schema'), 'utf8'));
    var light = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/content/lightcourse/model.schema'), 'utf8'));
    assert.strictEqual(light.properties.tags.items.ref, course.properties.tags.items.ref);
    assert.strictEqual(light.properties.tags.items.type, 'objectid');
    assert.deepStrictEqual(light.properties.tags.default, []);
    var template = fs.readFileSync(path.join(ROOT, 'frontend/src/modules/lightCourseEditor/templates/lightCourseEditor.hbs'), 'utf8');
    assert(template.indexOf('light-course-editor-tags-input') < template.indexOf('light-course-editor-tree-container'));
    var state = harness();
    assert.strictEqual(state.saves, 0);
    assert.strictEqual(state.settings.valueField, '_id');
    assert.strictEqual(state.settings.labelField, 'title');
    assert.strictEqual(state.label, 'app.lightcoursetags');
  });

  it('loads the existing core tag catalogue and autosaves attaching, removing and clearing tags by reference', function() {
    var state = harness([{ _id: 'existing', title: 'Existing core tag' }]);
    var loaded;
    state.settings.load('core', function(data) { loaded = data; });
    assert.strictEqual(state.requests[0].options.url, 'api/autocomplete/tag');
    var tag = { _id: 'second', title: 'Second core tag' };
    state.requests[0].success([tag]);
    assert.strictEqual(loaded[0], tag);
    state.picker.options.second = tag;
    state.picker.items.push('second');
    state.settings.onChange();
    assert.deepStrictEqual(Array.from(state.saved.tags), ['existing', 'second']);
    assert.strictEqual(state.view.model.get('tags')[1].title, tag.title);
    state.picker.items = ['second']; state.settings.onChange();
    assert.deepStrictEqual(Array.from(state.saved.tags), ['second']);
    state.picker.items = []; state.settings.onChange();
    assert.deepStrictEqual(Array.from(state.saved.tags), []);
    assert.strictEqual(state.saves, 3);
    assert.strictEqual(state.requests.length, 1, 'Removing a tag must not delete it from the shared catalogue');
  });

  it('creates new tags through the core endpoint and uses its canonical ID/title', function() {
    var state = harness();
    assert.strictEqual(state.settings.createFilter(' , '), false);
    var created;
    state.settings.create(' New tag, ', function(data) { created = data; });
    assert.strictEqual(state.requests[0].options.url, 'api/content/tag');
    assert.strictEqual(state.requests[0].options.data.title, 'New tag');
    assert.strictEqual(state.saves, 0);
    state.requests[0].success({ _id: 'canonical', title: 'New tag' });
    state.picker.options.canonical = created;
    state.picker.items = ['canonical']; state.settings.onChange();
    assert.deepStrictEqual(Array.from(state.saved.tags), ['canonical']);
  });

  it('reports failed loads, failed creation and invalid creation responses without attaching tags', function() {
    var state = harness(), result;
    state.settings.load('', function(data) { result = data; });
    state.requests[0].failure({ responseJSON: { message: 'Cannot load tags' } });
    assert.strictEqual(state.alerts[0].text, 'Cannot load tags');
    assert.strictEqual(result, undefined);
    state.settings.create('Tag', function(data) { result = data; });
    state.requests[1].failure({ responseJSON: { message: 'Cannot create tag' } });
    assert.strictEqual(state.alerts[1].text, 'Cannot create tag');
    state.settings.create('Tag', function(data) { result = data; });
    state.requests[2].success({ success: true });
    assert.strictEqual(state.alerts[2].text, 'app.lightcoursetagscreateerror');
    assert.strictEqual(state.saves, 0);
    assert.strictEqual(result, undefined);
  });

  it('retains rapid selections across an in-flight save and its stale revision refresh', function() {
    var state = harness([{ _id: 'first', title: 'First' }]);
    var saves = [], fetches = [];
    state.view.autosave = state.proto.autosave;
    state.view.setSaveStatus = state.view.hideConflictBanner = function() {};
    state.view.model.save = function(data, options) { saves.push({ data: data, options: options }); };
    state.view.model.fetch = function(options) { fetches.push(options); };
    state.picker.options.second = { _id: 'second', title: 'Second' };
    state.settings.onChange();
    state.picker.items.push('second'); state.settings.onChange();
    assert.strictEqual(saves.length, 1);
    saves[0].options.success();
    state.view.model.set('tags', [{ _id: 'first', title: 'First' }]);
    state.view.model.set('revision', 1);
    fetches[0].success();
    assert.strictEqual(saves.length, 2);
    assert.deepStrictEqual(Array.from(saves[1].data.tags), ['first', 'second']);
  });

  it('disables locked courses and disposes pending requests and the widget', function() {
    var locked = harness([], true);
    assert(locked.picker.disabled);
    locked.settings.onChange();
    assert.strictEqual(locked.saves, 0);
    var state = harness();
    state.settings.load('', function() { assert.fail('Disposed tag picker must not be changed'); });
    state.settings.create('Tag', function() { assert.fail('Disposed tag creation must not update the picker'); });
    state.view.remove();
    state.requests[0].success([]);
    state.requests[1].success({ _id: 'tag', title: 'Tag' });
    assert(state.requests.every(function(request) { return request.aborted; }));
    assert(state.picker.destroyed);
    assert.strictEqual(state.alerts.length, 0);
  });
});
