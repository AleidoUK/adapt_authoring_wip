var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var _ = require('underscore');
var Backbone = require('../frontend/src/libraries/backbone');
var ROOT = path.join(__dirname, '..');

function load(file, dependencies) {
  var result;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
    _: _,
    define: function(factory) { result = factory(function(name) { return dependencies[name]; }); }
  });
  return result;
}

function courses() {
  return [
    { _id: 'a', title: 'Alpha course', updatedAt: '2026-11-06', tags: [{ _id: 'red', title: 'Red' }, { _id: 'blue', title: 'Blue' }] },
    { _id: 'b', title: 'ALPHA review', updatedAt: '2026-11-05', tags: [{ _id: 'red', title: 'Red' }], conversionStatus: 'converted' },
    { _id: 'c', title: 'Beta course', updatedAt: '2026-11-04', tags: ['blue'], conversionStatus: 'none' },
    { _id: 'd', title: 'Course [literal]', updatedAt: '2026-11-03', tags: [] }
  ];
}

function harness(data) {
  var state = { created: [], removed: [], alerts: [], ready: 0, controls: {} };
  function control(selector) {
    if (!state.controls[selector]) {
      state.controls[selector] = {
        value: '', classes: new Set(),
        val: function(value) { if (!arguments.length) return this.value; this.value = value; return this; },
        text: function(value) { this.content = value; return this; },
        prop: function(key, value) { this[key] = value; return this; },
        addClass: function(value) { this.classes.add(value); return this; },
        removeClass: function(value) { this.classes.delete(value); return this; },
        empty: function() { state.visible = []; return this; },
        append: function(element) { state.visible.push(element.id); return this; }
      };
    }
    return state.controls[selector];
  }
  var input = control('.light-course-list-filter-tags');
  input[0] = {};
  input.selectize = function(settings) {
    state.settings = settings;
    var picker = {
      items: [], options: {},
      $control_input: { attr: function(key, value) { state.controls[key] = value; } },
      addOption: function(tag) { this.options[tag._id] = tag; },
      updateOption: function(id, tag) { this.options[id] = tag; },
      removeOption: function(id) { delete this.options[id]; },
      refreshOptions: function() {},
      clear: function(silent) { state.clearedSilently = silent; this.items = []; },
      destroy: function() { state.destroyed = true; }
    };
    settings.options.forEach(function(tag) { picker.addOption(tag); });
    input[0].selectize = state.picker = picker;
  };
  var origin = {
    l10n: { t: function(key, values) { state.lastTranslation = { key: key, values: values }; return key; } },
    Notify: { alert: function(alert) { state.alerts.push(alert); } },
    router: { navigateTo: function(route) { state.route = route; } }
  };
  var Model = load('frontend/src/modules/lightCourseEditor/models/lightCourseModel.js', { backbone: Backbone });
  var Collection = load('frontend/src/modules/lightCourseEditor/collections/lightCourseCollection.js', {
    backbone: Backbone, '../models/lightCourseModel': Model
  });
  var proto = load('frontend/src/modules/lightCourseEditor/views/lightCourseListView.js', {
    'core/origin': origin,
    'core/views/originView': { extend: function(proto) { return proto; }, prototype: {
      remove: function() { this.stopListening(); state.parentRemoved = true; }
    } },
    './lightCourseListItemView': function(options) {
      var id = options.model.id;
      state.created.push(id);
      this.$el = { id: id };
      this.remove = function() { state.removed.push(id); };
    }
  });
  state.collection = new Collection(data === undefined ? courses() : data);
  state.collection.fetch = function(options) {
    state.fetchOptions = options;
    return { abort: function() { state.aborted = true; options.error(state.collection, { statusText: 'abort' }); } };
  };
  state.view = Object.assign(Object.create(proto), Backbone.Events, {
    collection: state.collection,
    $: control,
    setViewToReady: function() { state.ready++; }
  });
  state.control = control;
  state.view.preRender();
  state.view.postRender();
  state.filter = function(title, tags, status) {
    control('.light-course-list-filter-title').val(title || '');
    control('.light-course-list-filter-state').val(status || '');
    state.picker.items = tags || [];
    state.settings.onChange();
  };
  return state;
}

describe('light course list filters (isolated)', function() {
  it('keeps the full collection and updated-date order with no filters', function() {
    var state = harness();
    assert.deepStrictEqual(state.visible, ['a', 'b', 'c', 'd']);
    assert.strictEqual(state.collection.length, 4);
    assert.strictEqual(state.control('.light-course-list-filter-clear').disabled, true);
    assert.strictEqual(state.settings.create, false);
    assert.strictEqual(state.settings.maxItems, null);
    assert.strictEqual(state.controls['aria-label'], 'app.lightcoursetags');
    assert.strictEqual(state.controls['aria-describedby'], 'light-course-list-tag-help');
  });

  it('matches trimmed, case-insensitive literal title substrings without treating punctuation as regex', function() {
    var state = harness();
    state.filter('  ALpha ');
    assert.deepStrictEqual(state.visible, ['a', 'b']);
    state.filter('[literal]');
    assert.deepStrictEqual(state.visible, ['d']);
    state.filter('.*');
    assert.deepStrictEqual(state.visible, []);
    state.filter(' ');
    assert.deepStrictEqual(state.visible, ['a', 'b', 'c', 'd']);
    assert.strictEqual(state.collection.length, 4);
  });

  it('requires all selected tag IDs and combines tags with title and displayed state', function() {
    var state = harness();
    state.filter('', ['red']);
    assert.deepStrictEqual(state.visible, ['a', 'b']);
    state.filter('', ['blue']);
    assert.deepStrictEqual(state.visible, ['a', 'c']);
    state.filter('', ['red', 'blue']);
    assert.deepStrictEqual(state.visible, ['a']);
    state.filter('alpha', ['red'], 'converted');
    assert.deepStrictEqual(state.visible, ['b']);
    state.filter('alpha', ['red', 'blue'], 'converted');
    assert.deepStrictEqual(state.visible, []);
    state.filter('', [], 'draft');
    assert.deepStrictEqual(state.visible, ['a', 'c', 'd']);
  });

  it('normalizes referenced/populated tags, keeps readable names and does not narrow tag options with search', function() {
    var state = harness();
    assert.deepStrictEqual(Object.keys(state.picker.options).sort(), ['blue', 'red']);
    assert.strictEqual(state.picker.options.blue.title, 'Blue');
    state.filter('review', ['red'], 'converted');
    assert.deepStrictEqual(Object.keys(state.picker.options).sort(), ['blue', 'red']);
    assert.strictEqual(state.collection.get('c').get('tags')[0], 'blue');
  });

  it('distinguishes an empty collection from no matches and reports correct counts', function() {
    var state = harness();
    state.filter('alpha');
    assert.strictEqual(state.control('.light-course-list-results').content, 'app.lightcourselistresults');
    var counts;
    state.view.$ = function(selector) {
      var element = state.control(selector);
      if (selector === '.light-course-list-results') element.text = function() {
        counts = state.lastTranslation.values;
        return this;
      };
      return element;
    };
    state.filter('missing');
    assert.strictEqual(counts.shown, 0);
    assert.strictEqual(counts.total, 4);
    assert.strictEqual(state.control('.light-course-list-empty').content, 'app.lightcourselistnomatches');
    assert.strictEqual(state.control('.light-course-list-empty').classes.has('display-none'), false);
    var empty = harness([]);
    assert.strictEqual(empty.control('.light-course-list-empty').content, 'app.lightcoursenonetodisplay');
    assert.strictEqual(empty.collection.length, 0);
  });

  it('clears all controls and restores courses without refetching or changing models', function() {
    var state = harness();
    var original = JSON.stringify(state.collection.toJSON());
    state.filter('alpha', ['red'], 'converted');
    state.view.onClearFilters({ preventDefault: function() { state.prevented = true; } });
    assert.deepStrictEqual(state.visible, ['a', 'b', 'c', 'd']);
    assert.strictEqual(state.control('.light-course-list-filter-title').val(), '');
    assert.strictEqual(state.control('.light-course-list-filter-state').val(), '');
    assert.strictEqual(state.picker.items.length, 0);
    assert.strictEqual(state.clearedSilently, true);
    assert.strictEqual(state.prevented, true);
    assert.strictEqual(JSON.stringify(state.collection.toJSON()), original);
  });

  it('retains filters and selected tags across refreshes, changes and deletion of the last match', function() {
    var state = harness();
    state.filter('alpha', ['red', 'blue'], 'draft');
    state.collection.trigger('sync');
    assert.deepStrictEqual(state.visible, ['a']);
    state.collection.get('a').set('tags', [{ _id: 'red', title: 'Renamed red' }]);
    assert.deepStrictEqual(state.visible, []);
    assert.deepStrictEqual(state.picker.items, ['red', 'blue']);
    assert.strictEqual(state.picker.options.red.title, 'Renamed red');
    state.collection.remove(['a', 'c']);
    assert.deepStrictEqual(state.picker.items, ['red', 'blue']);
    assert(state.picker.options.blue, 'Keep the selected tag even when its final course is removed');
    state.view.onClearFilters();
    assert.deepStrictEqual(state.visible, ['b', 'd']);
    assert.strictEqual(state.picker.options.blue, undefined);
  });

  it('removes old item views on filtering and aborts requests/destroys the picker on navigation', function() {
    var state = harness();
    state.filter('alpha');
    assert.deepStrictEqual(state.removed, ['a', 'b', 'c', 'd']);
    state.view.remove();
    assert.strictEqual(state.aborted, true);
    assert.strictEqual(state.destroyed, true);
    assert.strictEqual(state.parentRemoved, true);
    assert.deepStrictEqual(state.removed, ['a', 'b', 'c', 'd', 'a', 'b']);
    state.fetchOptions.success();
    state.fetchOptions.error(state.collection, { responseJSON: { message: 'Late error' } });
    state.collection.trigger('sync');
    assert.strictEqual(state.ready, 0);
    assert.deepStrictEqual(state.alerts, []);
  });

  it('surfaces list-load errors and leaves the create action intact', function() {
    var state = harness();
    state.fetchOptions.error(state.collection, { responseJSON: { message: 'Cannot load courses' } });
    assert.strictEqual(state.ready, 1);
    assert.strictEqual(state.alerts[0].text, 'Cannot load courses');
    state.fetchOptions.error(state.collection, {});
    assert.strictEqual(state.alerts[1].text, 'app.errorgettinglightcourses');
    state.view.onCreateClicked();
    assert.strictEqual(state.route, 'lightCourseEditor/new');
  });

  it('renders labelled search/tag/state controls with clear-filter and accessible result feedback', function() {
    var template = fs.readFileSync(path.join(ROOT, 'frontend/src/modules/lightCourseEditor/templates/lightCourseList.hbs'), 'utf8');
    ['light-course-list-title', 'light-course-list-tags', 'light-course-list-state'].forEach(function(id) {
      assert(template.includes('for="' + id + '"'));
      assert(template.includes('id="' + id + '"'));
    });
    assert(template.includes('multiple'));
    assert(template.includes('value="draft"'));
    assert(template.includes('value="converted"'));
    assert(template.includes('aria-live="polite"'));
    assert(template.includes('light-course-list-filter-clear'));
  });
});
