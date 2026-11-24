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
    '../alphabetical': require('../frontend/src/modules/lightCourseEditor/alphabetical'),
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

describe('light course clone action', function() {
  function cloneHarness() {
    var state = { alerts: [], saves: [] };
    var origin = {
      l10n: { t: function(key, values) { return key === 'app.lightcourseclonetitle' ? 'Copy of ' + values.title : key; } },
      Notify: { alert: function(alert) { state.alerts.push(alert); } },
      router: { navigateTo: function(route) { state.route = route; } }
    };
    function Model() {}
    Model.prototype.save = function(data, options) { state.saves.push({ data: data, options: options }); };
    var proto = load('frontend/src/modules/lightCourseEditor/views/lightCourseListItemView.js', {
      'core/origin': origin,
      'core/views/originView': { extend: function(value) { return value; } },
      '../tagEditor': {},
      '../models/lightCourseModel': Model
    });
    state.button = {
      prop: function(key, value) { this[key] = value; return this; },
      attr: function(key, value) { this[key] = value; return this; }
    };
    state.view = Object.assign(Object.create(proto), {
      model: new Backbone.Model({ _id: 'source', title: 'Converted', conversionStatus: 'converted' }),
      $: function() { return state.button; }
    });
    return state;
  }

  it('creates one clone and opens it after success', function() {
    var h = cloneHarness();
    h.view.onCloneClicked();
    h.view.onCloneClicked();
    assert.strictEqual(h.saves.length, 1);
    assert.strictEqual(h.saves[0].data.title, 'Copy of Converted');
    assert.strictEqual(h.saves[0].data._cloneCourseId, 'source');
    assert.strictEqual(h.button.disabled, true);
    h.saves[0].options.success({ get: function() { return 'new-course'; } });
    assert.strictEqual(h.route, 'lightCourseEditor/new-course');
  });

  it('shows errors and permits retry', function() {
    var h = cloneHarness();
    h.view.onCloneClicked();
    h.saves[0].options.error(null, { responseJSON: { message: 'Not permitted' } });
    assert.strictEqual(h.button.disabled, false);
    assert.strictEqual(h.alerts[0].text, 'Not permitted');
    h.view.onCloneClicked();
    assert.strictEqual(h.saves.length, 2);
  });
});

describe('light course delete availability (isolated)', function() {
  function deleteHarness(course, currentUserId, admin) {
    var state = { permissions: [], alerts: [], route: null };
    var origin = {
      permissions: { hasPermissions: function(permissions) {
        state.permissions.push(permissions);
        return !!admin;
      } },
      sessionModel: { get: function() { return currentUserId; } },
      trigger: function(event, view, options) { state.modal = { event: event, view: view, options: options }; },
      l10n: { t: function(key) { return key; } },
      Notify: { alert: function(alert) { state.alerts.push(alert); } },
      router: { navigateTo: function(route) { state.route = route; } }
    };
    var proto = load('frontend/src/modules/lightCourseEditor/views/lightCourseListItemView.js', {
      'core/origin': origin,
      'core/views/originView': { extend: function(value) { return value; } },
      '../tagEditor': { renderTags: function() {} },
      '../models/lightCourseModel': function() {},
      './lightCourseDeleteView': function() {}
    });
    state.button = {
      prop: function(key, value) { this[key] = value; return this; },
      attr: function(key, value) { this[key] = value; return this; }
    };
    state.view = Object.assign(Object.create(proto), {
      model: new Backbone.Model(Object.assign({ _id: 'course', title: 'Course' }, course)),
      $: function() { return state.button; }
    });
    state.view.postRender();
    return state;
  }

  it('enables deletion only for the creator or an administrator and guards the click handler', function() {
    var own = deleteHarness({ createdBy: 'editor-1' }, 'editor-1', false);
    assert.strictEqual(own.button.disabled, false);
    own.view.onDeleteClicked({ preventDefault: function() {} });
    assert.strictEqual(own.modal.options.model, own.view.model);

    var populatedOwner = deleteHarness({ createdBy: { _id: 'editor-1' } }, 'editor-1', false);
    assert.strictEqual(populatedOwner.button.disabled, false);

    var other = deleteHarness({ createdBy: 'editor-2' }, 'editor-1', false);
    assert.strictEqual(other.button.disabled, true);
    assert.strictEqual(other.button.title, 'app.lightcoursedeleteownonly');
    other.view.onDeleteClicked({ preventDefault: function() {} });
    assert.strictEqual(other.modal, undefined);

    var admin = deleteHarness({ createdBy: 'editor-2' }, 'admin-1', true);
    assert.strictEqual(admin.button.disabled, false);
    admin.view.onDeleteClicked({ preventDefault: function() {} });
    assert.strictEqual(admin.modal.options.model, admin.view.model);
  });
});

describe('light course delete export flow (isolated)', function() {
  function dialogHarness() {
    var state = { triggers: [], destroyOptions: null, exportOptions: null };
    var origin = {
      trigger: function(event) { state.triggers.push(event); },
      l10n: { t: function(key) { return key; } }
    };
    var proto = load('frontend/src/modules/lightCourseEditor/views/lightCourseDeleteView.js', {
      'core/origin': origin,
      'core/views/originView': { extend: function(value) { return value; }, prototype: {
        remove: function() { state.removed = true; }
      } },
      '../wordExport': function(model, options) {
        state.exportModel = model;
        state.exportOptions = options;
        return { abort: function() { state.aborted = true; } };
      }
    });
    state.status = {
      prop: function(key, value) { this[key] = value; return this; },
      text: function(value) { this.message = value; return this; }
    };
    state.actions = { prop: function(key, value) { this[key] = value; return this; } };
    state.model = {
      get: function(key) { return key === 'title' ? 'Course' : undefined; },
      destroy: function(options) { state.destroyOptions = options; }
    };
    state.view = Object.assign(Object.create(proto), {
      model: state.model,
      $: function(selector) {
        return selector === '.light-course-delete-status' ? state.status : state.actions;
      }
    });
    return state;
  }

  it('exports successfully before starting deletion', function() {
    var h = dialogHarness();
    h.view.onExportThenDelete({ preventDefault: function() {} });
    assert.strictEqual(h.exportModel, h.model);
    assert.strictEqual(h.destroyOptions, null);
    assert.strictEqual(h.status.message, 'app.lightcourseexportingbeforedelete');
    h.exportOptions.success();
    assert.strictEqual(h.status.message, 'app.lightcoursedeleting');
    assert(h.destroyOptions);
    h.destroyOptions.success();
    assert(h.triggers.includes('modal:onCancel'));
  });

  it('does not delete if the Word export fails and allows deletion without export', function() {
    var h = dialogHarness();
    h.view.onExportThenDelete({ preventDefault: function() {} });
    h.exportOptions.error({ responseJSON: { message: 'Export failed' } });
    assert.strictEqual(h.destroyOptions, null);
    assert.strictEqual(h.status.message, 'Export failed');
    assert.strictEqual(h.actions.disabled, false);

    h.view.onDeleteWithoutExport({ preventDefault: function() {} });
    assert(h.destroyOptions);
    assert.strictEqual(h.status.message, 'app.lightcoursedeleting');
  });
});

describe('light course list filters (isolated)', function() {
  it('shows the full collection alphabetically with no filters', function() {
    var state = harness();
    assert.deepStrictEqual(state.visible, ['a', 'b', 'c', 'd']);
    assert.strictEqual(state.collection.length, 4);
    assert.strictEqual(state.control('.light-course-list-filter-clear').disabled, true);
    assert.strictEqual(state.settings.create, false);
    assert.strictEqual(state.settings.maxItems, null);
    assert.strictEqual(state.controls['aria-label'], 'app.lightcoursetags');
    assert.strictEqual(state.controls['aria-describedby'], 'light-course-list-tag-help');
  });

  it('sorts unsorted courses by title without changing the backing collection', function() {
    var state = harness(courses().reverse());
    assert.deepStrictEqual(state.visible, ['a', 'b', 'c', 'd']);
    state.collection.get('d').set('title', 'Aardvark');
    assert.deepStrictEqual(state.visible, ['d', 'a', 'b', 'c']);
    assert.strictEqual(state.settings.sortField, 'title');
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
