var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var createRequire = require('module').createRequire;

function copy(value) { return JSON.parse(JSON.stringify(value)); }
class ConflictError extends Error {}

function harness(options) {
  options = options || {};
  var state = {
    draft: {
      _id: 'course', _tenantId: 'tenant', revision: 7, title: 'Original', body: 'Original body',
      versionMajor: 1, versionMinor: 2, currentVersionNumber: '1.2',
      contentTree: { children: [] }, pluginSelections: {}, glossaryItems: [], resourceItems: [], helpContent: {},
      headerData: { versionHistory: [{ version: '1.2', notes: 'Keep notes', duration: '4 mins', words: 3 }] }
    },
    versions: [{ _id: 'old-version', versionNumber: '1.2', contentSnapshot: { title: 'Previous version' } }],
    events: [], reservations: 0
  };
  if (options.firstVersion) {
    delete state.draft.currentVersionNumber;
    delete state.draft.versionMajor;
    delete state.draft.versionMinor;
    state.draft.headerData.versionHistory = [];
    state.versions = [];
  }
  var db = {
    retrieve: function(type, search, options, callback) {
      callback(null, state.versions.filter(function(version) { return version.versionNumber === search.versionNumber; }));
    },
    getModel: function() { return { findOneAndUpdate: function(search, delta, settings, callback) {
    state.reservations++;
    if ((search.revision !== undefined && (options.stale || search.revision !== state.draft.revision)) ||
        (search.currentVersionNumber !== undefined && search.currentVersionNumber !== state.draft.currentVersionNumber)) {
      return callback(null, null);
    }
    Object.assign(state.draft, copy(delta.$set || {}));
    Object.keys(delta.$unset || {}).forEach(function(key) { delete state.draft[key]; });
    state.draft.revision += delta.$inc.revision;
    callback(null, copy(state.draft));
  } }; } };
  var manager = {
    create: function(type, data, callback) {
      state.events.push('create:' + type);
      assert.strictEqual(state.draft.title, 'Original', 'draft content must not change before its snapshot exists');
      if (options.concurrentPublish) {
        Object.assign(state.draft, { versionMajor: 3, versionMinor: 0, currentVersionNumber: '3.0', revision: 9 });
      }
      if (options.failCreate) return callback(new Error('Snapshot storage failed'));
      var version = Object.assign({ _id: 'new-version' }, copy(data));
      state.versions.push(version);
      if (options.failCreateHook) return callback(new Error('Audit hook failed'));
      callback(null, version);
    },
    update: function(type, search, data, callback) {
      state.events.push('update:' + type);
      if (options.failActivate) return callback(new ConflictError('Concurrent change'));
      assert.strictEqual(data.revision, state.draft.revision);
      Object.assign(state.draft, copy(data), { revision: data.revision + 1 });
      callback(null, copy(state.draft));
    }
  };
  var app = { once: function() {}, contentmanager: manager };
  var filename = path.join(__dirname, '../plugins/content/lightcourse/index.js');
  var nativeRequire = createRequire(filename);
  var mocks = {
    '../../../lib/contentmanager': { ContentPlugin: function() {},
      errors: { ContentConflictError: ConflictError, ContentPermissionError: Error } },
    '../../../lib/database': {},
    '../../../lib/permissions': {},
    '../../../lib/usermanager': { getCurrentUser: function() {
      return { _id: 'author', email: 'author@example.test', tenant: { _id: 'tenant' } };
    } },
    '../../../lib/logger': {},
    '../../../lib/rest': {},
    '../../../': function() { return app; },
    '../../../lib/lightcoursewordcount': { computeWordCount: function(snapshot, database, callback) {
      callback(null, { screens: 0, total: 5 });
    } }
  };
  var module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module, exports: module.exports,
    require: function(name) { return Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : nativeRequire(name); }
  }, { filename: filename });
  state.import = function(bump, snapshot) {
    snapshot = snapshot || {
      title: 'Imported', body: 'Imported body', contentTree: { children: [] },
      pluginSelections: {}, glossaryItems: [], resourceItems: [], helpContent: {}
    };
    return new Promise(function(resolve) {
      new module.exports().importVersion(db, copy(state.draft), snapshot, bump, function(error, version) {
        resolve({ error: error, version: version });
      });
    });
  };
  return state;
}

describe('imported light course versions (isolated)', function() {
  it('preserves current core tags in imported snapshots and activation, ignoring supplied tag changes', async function() {
    var state = harness();
    state.draft.tags = [{ _id: 'core-tag', title: 'Shared core tag' }];
    var result = await state.import('minor', {
      title: 'Imported', body: 'Imported body', contentTree: { children: [] },
      pluginSelections: {}, glossaryItems: [], resourceItems: [], helpContent: {},
      tags: [{ _id: 'wrong-tag', title: 'Do not import tags' }]
    });
    assert.ifError(result.error);
    assert.deepStrictEqual(copy(result.version.contentSnapshot.tags), [{ _id: 'core-tag', title: 'Shared core tag' }]);
    assert.deepStrictEqual(state.draft.tags, [{ _id: 'core-tag', title: 'Shared core tag' }]);
  });

  [['minor', '1.3'], ['major', '2.0']].forEach(function(test) {
    it('creates a ' + test[0] + ' snapshot, activates it and preserves existing snapshots/history', async function() {
      var state = harness();
      var previous = JSON.stringify(state.versions[0]);
      var previousRow = JSON.stringify(state.draft.headerData.versionHistory[0]);
      var result = await state.import(test[0]);
      assert.ifError(result.error);
      assert.strictEqual(result.version.versionNumber, test[1]);
      assert.strictEqual(result.version.contentSnapshot.title, 'Imported');
      assert.strictEqual(result.version.contentSnapshot.body, 'Imported body');
      assert.strictEqual(state.draft.title, 'Imported');
      assert.strictEqual(state.draft.currentVersionNumber, test[1]);
      assert.strictEqual(state.draft.headerData.versionHistory.length, 2);
      assert.strictEqual(state.draft.headerData.versionHistory[1].words, 5);
      assert.strictEqual(JSON.stringify(state.versions[0]), previous);
      assert.strictEqual(JSON.stringify(state.draft.headerData.versionHistory[0]), previousRow);
      assert.deepStrictEqual(state.events, ['create:lightcourseversion', 'update:lightcourse']);
    });
  });

  it('uses 0.1 for the first minor version and 1.0 for the first major version', async function() {
    for (var test of [['minor', '0.1'], ['major', '1.0']]) {
      var state = harness({ firstVersion: true });
      assert.strictEqual((await state.import(test[0])).version.versionNumber, test[1]);
    }
  });

  it('rejects stale revisions without creating or activating anything', async function() {
    var state = harness({ stale: true });
    var original = JSON.stringify(state.draft);
    var result = await state.import('minor');
    assert(result.error instanceof ConflictError);
    assert.strictEqual(JSON.stringify(state.draft), original);
    assert.deepStrictEqual(state.events, []);
  });

  it('leaves content/history untouched and releases the number when snapshot creation fails', async function() {
    var state = harness({ failCreate: true });
    var original = copy(state.draft);
    var result = await state.import('minor');
    assert.match(result.error.message, /Snapshot storage failed/);
    assert.strictEqual(state.draft.revision, original.revision + 2);
    state.draft.revision = original.revision;
    assert.deepStrictEqual(state.draft, original);
    assert.strictEqual(state.versions.length, 1);
  });

  it('never rolls back another publisher when releasing a failed reservation', async function() {
    var state = harness({ failCreate: true, concurrentPublish: true });
    var result = await state.import('major');
    assert(result.error);
    assert.strictEqual(state.draft.currentVersionNumber, '3.0');
    assert.strictEqual(state.draft.revision, 9);
    assert.strictEqual(state.draft.title, 'Original');
  });

  it('does not release the number of a stored snapshot when a post-create hook fails', async function() {
    var state = harness({ failCreateHook: true });
    var result = await state.import('minor');
    assert.strictEqual(result.error.version.versionNumber, '1.3');
    assert.match(result.error.message, /creation hooks failed/);
    assert.strictEqual(state.draft.currentVersionNumber, '1.3');
    assert.strictEqual(state.versions.length, 2);
    assert.strictEqual(state.draft.title, 'Original');
    assert.strictEqual(state.reservations, 1);
  });

  it('reports the saved version explicitly if a concurrent change prevents activation', async function() {
    var state = harness({ failActivate: true });
    var result = await state.import('major');
    assert(result.error instanceof ConflictError);
    assert.strictEqual(result.error.version.versionNumber, '2.0');
    assert.match(result.error.message, /was created.*before it could be activated/);
    assert.strictEqual(state.versions.length, 2);
    assert.strictEqual(state.draft.title, 'Original');
  });

  it('rejects invalid choices and invalid structures before reserving a number', async function() {
    var state = harness();
    assert((await state.import('other')).error);
    assert((await state.import('minor', { title: 'Imported', contentTree: { children: [
      { _id: 'bad', type: 'block', children: [] }
    ] } })).error);
    assert.strictEqual(state.reservations, 0);
    assert.deepStrictEqual(state.events, []);
  });
});
