var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var _ = require('underscore');
var Backbone = require('../frontend/src/libraries/backbone');
var ROOT = path.join(__dirname, '..', 'frontend/src/modules');

function harness(kind, records) {
  var state = { controls: {}, requests: [], alerts: [], removed: [] };
  function element() {
    return {
      length: 1, value: '', children: [],
      val: function(value) { if (!arguments.length) return this.value; this.value = value; return this; },
      text: function(value) { this.content = value; return this; },
      prop: function(key, value) { this[key] = value; return this; },
      toggleClass: function(key, value) { this[key] = value; return this; },
      empty: function() { this.children = []; return this; },
      append: function(value) { this.children.push(value); return this; }
    };
  }
  function control(selector) {
    if (selector === '<option>') return element();
    if (selector.indexOf(',') !== -1) return {
      val: function(value) { selector.split(', ').forEach(function(key) { control(key).val(value); }); }
    };
    if (!state.controls[selector]) state.controls[selector] = element();
    return state.controls[selector];
  }
  var tags = control('.light-course-admin-filter-tags');
  tags.length = kind === 'template' ? 1 : 0;
  tags[0] = {};
  tags.selectize = function(settings) {
    state.tagSettings = settings;
    state.picker = {
      items: [], options: {}, $control_input: { attr: function() {} },
      addOption: function(tag) { this.options[tag._id] = tag; },
      updateOption: function(id, tag) { this.options[id] = tag; },
      removeOption: function(id) { delete this.options[id]; },
      refreshOptions: function() {},
      clear: function(silent) { assert.strictEqual(silent, true); this.items = []; },
      destroy: function() { this.destroyed = true; }
    };
    settings.options.forEach(function(tag) { state.picker.addOption(tag); });
    tags[0].selectize = state.picker;
  };
  control.get = function(url) {
    var request = { url: url,
      done: function(callback) { this.success = callback; return this; },
      fail: function(callback) { this.failure = callback; return this; },
      abort: function() { this.aborted = true; if (this.failure) this.failure({}, 'abort'); }
    };
    state.requests.push(request);
    return request;
  };
  var origin = { l10n: { t: function(key, values) { return values ? JSON.stringify(values) : key; } },
    Notify: { alert: function(alert) { state.alerts.push(alert); } } };
  var Parent = function() {};
  Parent.extend = Backbone.Model.extend;
  Parent.prototype.remove = function() { this.stopListening(); };
  var cache = {};
  function Row(options) {
    this.options = options;
    this.$el = { id: options.model.id };
    this.remove = function() { state.removed.push(options.model.id); };
  }
  function load(file) {
    if (cache[file]) return cache[file];
    var result;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      _: _, $: control,
      define: function(factory) {
        result = factory(function(name) {
          if (name === 'core/origin') return origin;
          if (name === 'core/views/originView') return Parent;
          if (/ListItemView$/.test(name)) return Row;
          if (/CreateView$|PromoteFromVersionView$|Model$/.test(name)) return function() {};
          return load(path.resolve(path.dirname(file), name + '.js'));
        });
      }
    }, { filename: file });
    return (cache[file] = result);
  }
  var names = { template: 'Template', asset: 'Asset', defaults: 'ComponentDefault' };
  var View = load(path.join(ROOT, 'lightCourseAdmin/views/lightCourse' + names[kind] + 'ListView.js'));
  var Model = Backbone.Model.extend({ idAttribute: '_id' });
  state.collection = new Backbone.Collection(records, { model: Model });
  state.collection.fetch = function(options) {
    state.fetchOptions = options;
    return { abort: function() { state.fetchAborted = true; options.error(state.collection, { statusText: 'abort' }); } };
  };
  state.view = Object.assign(Object.create(View.prototype), Backbone.Events, {
    collection: state.collection, $: control, setViewToReady: function() {}
  });
  state.view.preRender();
  state.view.postRender();
  state.control = control;
  state.visible = function() { return control(state.view.listSelector + '-items').children.map(function(row) { return row.id; }); };
  state.filter = function(search, type, status, tags) {
    control('.light-course-admin-filter-search').val(search || '');
    control('.light-course-admin-filter-type').val(type || '');
    control('.light-course-admin-filter-status').val(status || '');
    if (state.picker) state.picker.items = tags || [];
    state.view.onFiltersChanged();
  };
  return state;
}

describe('light-course admin list filters (isolated)', function() {
  var templates = [
    { _id: 'one', name: 'Alpha template', description: 'Starter', tags: [{ _id: 'red', title: 'Red' }, { _id: 'blue', title: 'Blue' }] },
    { _id: 'two', name: 'Other', description: 'ALPHA description', tags: ['red'] },
    { _id: 'three', name: 'Literal [text]', tags: [] }
  ];
  it('filters template names/descriptions literally and combines all selected tags without changing records', function() {
    var h = harness('template', templates), before = JSON.stringify(h.collection.toJSON());
    assert.deepStrictEqual(h.visible(), ['one', 'two', 'three']);
    h.filter('  aLPHA ', '', '', ['red']);
    assert.deepStrictEqual(h.visible(), ['one', 'two']);
    h.filter('', '', '', ['red', 'blue']);
    assert.deepStrictEqual(h.visible(), ['one']);
    h.filter('[text]');
    assert.deepStrictEqual(h.visible(), ['three']);
    h.filter('.*');
    assert.deepStrictEqual(h.visible(), []);
    assert.strictEqual(h.picker.options.red.title, 'Red');
    assert.strictEqual(h.tagSettings.create, false);
    assert.strictEqual(JSON.stringify(h.collection.toJSON()), before);
  });
  it('refreshes tag options, keeps active selections and disposes rows and requests', function() {
    var h = harness('template', templates);
    h.filter('', '', '', ['blue']);
    h.collection.remove('one');
    assert.deepStrictEqual(h.visible(), []);
    assert(h.picker.options.blue);
    h.view.onClearFilters();
    assert.deepStrictEqual(h.visible(), ['two', 'three']);
    assert.strictEqual(h.picker.options.blue, undefined);
    assert.strictEqual(h.control('.light-course-admin-filter-clear').disabled, true);
    h.view.remove();
    assert(h.fetchAborted);
    assert(h.picker.destroyed);
    var removed = h.removed.length;
    h.collection.trigger('sync');
    assert.strictEqual(h.removed.length, removed);
  });
  it('distinguishes no matches from an empty collection and reports accurate filtered totals', function() {
    var h = harness('template', templates);
    h.filter('missing');
    assert.deepStrictEqual(JSON.parse(h.control('.light-course-admin-filter-results').content), { shown: 0, total: 3 });
    assert.strictEqual(h.control('.light-course-template-list-empty').content, 'app.lightcoursefilternomatches');
    assert.strictEqual(h.control('.light-course-template-list-empty')['display-none'], false);
    var empty = harness('template', []);
    assert.strictEqual(empty.control('.light-course-template-list-empty').content, 'app.lightcoursetemplatenonetodisplay');
  });
  it('filters placeholder assets by title/filename and type while retaining Uses data across refreshes', function() {
    var h = harness('asset', [
      { _id: 'image', title: 'Picture', filename: 'SCREENSHOT.png', assetType: 'image' },
      { _id: 'audio', title: 'Screenshot narration', filename: 'voice.mp3', assetType: 'audio' }
    ]);
    h.filter('screenshot', 'image');
    assert.deepStrictEqual(h.visible(), ['image']);
    h.collection.trigger('sync');
    assert.strictEqual(h.requests.length, 1);
    h.requests[0].success({ image: { count: 2, uses: [] }, audio: { count: 0, uses: [] } });
    assert.deepStrictEqual(h.visible(), ['image']);
    assert.strictEqual(h.view.itemViews[0].options.usage.count, 2);
    h.view.onClearFilters();
    assert.deepStrictEqual(h.visible(), ['image', 'audio']);
    assert.strictEqual(h.requests.length, 1, 'Filtering must not refetch usage');
  });
  it('combines default name/type/status filters, including missing component plugins and absent default flags', function() {
    var h = harness('defaults', [
      { _id: 'one', name: 'Alpha', componentType: 'text', isDefault: true },
      { _id: 'two', name: 'Alpha other', componentType: 'text', isDefault: false },
      { _id: 'three', name: 'Legacy', componentType: 'removed-plugin' }
    ]);
    h.filter('alpha', 'text', 'default');
    assert.deepStrictEqual(h.visible(), ['one']);
    h.filter('ALPHA', 'text', 'other');
    assert.deepStrictEqual(h.visible(), ['two']);
    h.requests[0].success([{ component: 'text', displayName: 'Text' }]);
    var options = h.control('.light-course-admin-filter-type').children;
    assert(options.some(function(option) { return option.value === 'removed-plugin'; }));
    h.filter('', 'removed-plugin', 'other');
    assert.deepStrictEqual(h.visible(), ['three']);
    h.collection.get('three').set('isDefault', true);
    assert.deepStrictEqual(h.visible(), []);
    h.view.onClearFilters();
    assert.deepStrictEqual(h.visible(), ['one', 'two', 'three']);
  });
  it('retains failed-load notifications and aborts in-flight component requests when closed', function() {
    var h = harness('defaults', []);
    h.fetchOptions.error(h.collection, { responseJSON: { message: 'Load failed' } });
    assert.strictEqual(h.alerts[0].text, 'Load failed');
    h.requests[0].failure({}, 'error');
    assert.strictEqual(h.alerts.length, 2);
    h.view.remove();
    assert(h.requests[0].aborted);
    var count = h.alerts.length;
    h.requests[0].success([]);
    assert.strictEqual(h.alerts.length, count);
  });
});
