var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var createRequire = require('module').createRequire;

function copy(value) { return JSON.parse(JSON.stringify(value)); }

function harness(options) {
  options = options || {};
  var source = {
    _id: 'source', _tenantId: 'tenant', title: 'Original', body: 'Body', revision: 8,
    conversionStatus: 'converted', _convertedCourseId: 'full-course', conversionAttempt: { token: 'token' },
    currentVersionNumber: '1.2', versionMajor: 1, versionMinor: 2,
    tags: [{ _id: 'tag', title: 'Tag' }],
    pluginSelections: { menu: 'tile', theme: 'theme', extensions: ['resources'] },
    headerData: { reviewingInstructions: 'Review', versionHistory: [{ version: '1.2' }] },
    contentTree: { children: [{ _id: 'page', type: 'page', children: [
      { _id: 'article', type: 'article', children: [{ _id: 'block', type: 'block', children: [
        { _id: 'component', type: 'component', _layout: 'full', body: 'Text',
          screenshotAssetId: 'image', _comments: [{ text: 'Comment' }] }
      ] }] }
    ] }] },
    glossaryItems: [{ _id: 'glossary', term: 'Term' }],
    resourceItems: [{ _id: 'resource', title: 'Resource' }],
    helpContent: { popup: { title: 'Help' }, items: [{ _id: 'help', title: 'Help item' }] }
  };
  var state = { source: source, writes: [], reads: [] };
  function ContentPlugin() {}
  ContentPlugin.prototype.retrieve = function(search, settings, callback) {
    state.reads.push(search._id);
    if (options.denied) return callback(new Error('Permission denied'));
    callback(null, options.missing ? [] : [source]);
  };
  ContentPlugin.prototype.create = function(data, callback) {
    state.writes.push(copy(data));
    callback(null, copy(data));
  };
  var filename = path.join(__dirname, '../plugins/content/lightcourse/index.js');
  var nativeRequire = createRequire(filename);
  var mocks = {
    '../../../lib/contentmanager': { ContentPlugin: ContentPlugin,
      errors: { ContentPermissionError: Error, ContentConflictError: Error } },
    '../../../lib/database': { getDatabase: function(callback) {
      callback(null, { retrieve: function(type, query, settings, done) { done(null, []); } });
    } },
    '../../../lib/usermanager': { getCurrentUser: function() {
      return { _id: 'user', email: 'user@example.test', tenant: { _id: 'tenant' } };
    } },
    '../../../lib/permissions': {},
    '../../../lib/logger': {},
    '../../../lib/rest': {},
    '../../../': function() { return { once: function() {} }; }
  };
  var module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module, exports: module.exports,
    require: function(name) { return Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : nativeRequire(name); }
  }, { filename: filename });
  state.create = function(data) {
    return new Promise(function(resolve) {
      new module.exports().create(data, function(error, course) { resolve({ error: error, course: course }); });
    });
  };
  return state;
}

describe('cloning light courses', function() {
  this.timeout(5000);
  it('creates an independent unversioned draft with content and fresh IDs', async function() {
    var h = harness(), original = JSON.stringify(h.source);
    var result = await h.create({ title: 'Copy of Original', _cloneCourseId: 'source', _id: 'injected',
      currentVersionNumber: '9.9', versionMajor: 9, conversionAttempt: { token: 'injected' } });
    assert.ifError(result.error);
    var course = result.course, page = course.contentTree.children[0];
    var component = page.children[0].children[0].children[0];
    assert.strictEqual(course.title, 'Copy of Original');
    assert.strictEqual(course.body, 'Body');
    assert.deepStrictEqual(course.tags, ['tag']);
    assert.deepStrictEqual(course.pluginSelections, h.source.pluginSelections);
    assert.strictEqual(course.headerData.reviewingInstructions, 'Review');
    assert.strictEqual(course.headerData.versionHistory, undefined);
    assert.strictEqual(course.conversionStatus, 'none');
    assert.strictEqual(course.revision, 0);
    assert.strictEqual(course.createdBy, 'user');
    ['_id', '_convertedCourseId', 'conversionAttempt', 'currentVersionNumber', 'versionMajor', 'versionMinor']
      .forEach(function(key) { assert.strictEqual(course[key], undefined); });
    assert.notStrictEqual(page._id, 'page');
    assert.notStrictEqual(component._id, 'component');
    assert.strictEqual(component.body, 'Text');
    assert.strictEqual(component.screenshotAssetId, 'image');
    assert.strictEqual(component._comments, undefined);
    ['glossaryItems', 'resourceItems'].forEach(function(key) {
      assert.notStrictEqual(course[key][0]._id, h.source[key][0]._id);
    });
    assert.notStrictEqual(course.helpContent.items[0]._id, 'help');
    assert.strictEqual(JSON.stringify(h.source), original);
    assert.deepStrictEqual(h.reads, ['source']);
    assert.strictEqual(h.writes.length, 1);
  });

  it('requires access to an existing course in the current tenant', async function() {
    for (var option of [{ denied: true }, { missing: true }, { crossTenant: true }]) {
      var h = harness(option);
      if (option.crossTenant) h.source._tenantId = 'other';
      var result = await h.create({ title: 'Copy', _cloneCourseId: 'source' });
      assert(result.error);
      assert.strictEqual(h.writes.length, 0);
    }
  });

  it('also clones an unconverted draft without copying its version metadata', async function() {
    var h = harness();
    h.source.conversionStatus = 'none';
    var result = await h.create({ title: 'Copy', _cloneCourseId: 'source' });
    assert.ifError(result.error);
    assert.strictEqual(result.course.conversionStatus, 'none');
    assert.strictEqual(result.course.currentVersionNumber, undefined);
    assert.strictEqual(result.course.headerData.versionHistory, undefined);
  });
});
