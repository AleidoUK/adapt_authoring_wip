var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assetmanager = require('../lib/assetmanager');
var database = require('../lib/database');
var logger = require('../lib/logger');
var crypto = require('crypto');
var os = require('os');
var usermanager = require('../lib/usermanager');
var filestorage = require('../lib/filestorage');

describe('asset import and cleanup', function() {
  it('skips identical bytes under a different filename without writing storage or changing metadata', async function() {
    var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-dedup-'));
    var upload = path.join(directory, 'renamed.PNG'), bytes = Buffer.from('identical file bytes');
    fs.writeFileSync(upload, bytes);
    var hash = crypto.createHash('sha1').update(bytes).digest('hex');
    var existing = { _id: 'existing', title: 'Keep title', path: 'assets/ab/cd/' + hash + '.jpg' };
    var context = {
      retrieveAsset: function(query, callback) {
        assert.strictEqual(query.repository, 'localfs');
        assert.strictEqual(query._isDeleted, false);
        assert(new RegExp(query.path.$regex).test(existing.path));
        assert(!new RegExp(query.path.$regex).test('assets/not-' + hash + '.jpg'));
        callback(null, [existing]);
      }
    };
    try {
      await new Promise(function(resolve, reject) {
        assetmanager._createAssetFromFile.call(context, {}, { path: upload, name: 'renamed.PNG' },
          { title: 'Do not replace' }, { _id: 'user' }, 'localfs', function(error, asset, duplicate) {
            if (error) return reject(error);
            assert.strictEqual(asset, existing);
            assert.strictEqual(duplicate, true);
            assert.strictEqual(asset.title, 'Keep title');
            resolve();
          });
      });
      assert(!fs.existsSync(upload));
    } finally {
      if (fs.existsSync(upload)) fs.unlinkSync(upload);
      fs.rmdirSync(directory);
    }
  });

  it('creates a new record when the content hash is not present and propagates lookup errors', async function() {
    var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-new-'));
    var upload = path.join(directory, 'new.png');
    fs.writeFileSync(upload, 'new content');
    var processed = 0, created = 0;
    var context = {
      retrieveAsset: function(query, callback) { callback(null, []); },
      createAsset: function(asset, callback) { created++; callback(null, Object.assign({ _id: 'new' }, asset)); }
    };
    var storage = { processFileUpload: function(file, target, options, callback) {
      processed++;
      callback(null, { path: target });
    } };
    function create() {
      return new Promise(function(resolve, reject) {
        assetmanager._createAssetFromFile.call(context, storage, { path: upload, name: 'new.png' },
          { title: 'New' }, { _id: 'user' }, 'localfs', function(error, asset) {
            if (error) reject(error); else resolve(asset);
          });
      });
    }
    try {
      assert.strictEqual((await create())._id, 'new');
      fs.writeFileSync(upload, 'new content');
      context.retrieveAsset = function(query, callback) { callback(new Error('Lookup failed')); };
      await assert.rejects(create(), /Lookup failed/);
      assert.strictEqual(processed, 1);
      assert.strictEqual(created, 1);
    } finally {
      if (fs.existsSync(upload)) fs.unlinkSync(upload);
      fs.rmdirSync(directory);
    }
  });

  ['shared', 'last', 'missing', 'denied', 'database-error'].forEach(function(state) {
    it('safely deletes asset records when storage is ' + state, async function() {
      var getUser = usermanager.getCurrentUser, getDatabase = database.getDatabase, getStorage = filestorage.getStorage;
      var deleted = 0, filesDeleted = 0, asset = { _id: 'one', repository: 'localfs', path: 'assets/shared.png' };
      usermanager.getCurrentUser = function() { return { _id: 'user', tenant: { _id: 'tenant' } }; };
      database.getDatabase = function(callback) {
        callback(null, {
          retrieve: function(type, query, options, callback) {
            callback(state === 'database-error' ? new Error('Database failed') : null,
              state === 'shared' ? [asset, { _id: 'two' }] : [asset]);
          },
          destroy: function(type, query, callback) { deleted++; callback(null); }
        });
      };
      filestorage.getStorage = function(repository, callback) {
        callback(null, { deleteFile: function(file, callback) {
          filesDeleted++;
          var error = state === 'missing' || state === 'denied' ? new Error('Storage failed') : null;
          if (error) error.code = state === 'missing' ? 'ENOENT' : 'EACCES';
          callback(error);
        } });
      };
      var context = {
        hasPermission: function(action, user, tenant, query, callback) { callback(null, true); },
        retrieveAsset: function(query, callback) { callback(null, [asset]); }
      };
      try {
        var error = await new Promise(function(resolve) { assetmanager.destroyAsset.call(context, 'one', resolve); });
        if (state === 'denied' || state === 'database-error') {
          assert(error);
          assert.strictEqual(deleted, 0);
        } else {
          assert.ifError(error);
          assert.strictEqual(deleted, 1);
        }
        assert.strictEqual(filesDeleted, state === 'shared' || state === 'database-error' ? 0 : 1);
      } finally {
        usermanager.getCurrentUser = getUser;
        database.getDatabase = getDatabase;
        filestorage.getStorage = getStorage;
      }
    });
  });

  it('returns populated tag titles from the unused asset endpoint', async function() {
    var originalRetrieveAsset = assetmanager.retrieveAsset;
    var originalGetDatabase = database.getDatabase;
    var result, status, failure;
    assetmanager.retrieveAsset = function(query, options, callback) {
      callback(null, [
        { _id: 'asset-1', repository: 'localfs', path: 'assets/map.png',
          filename: 'map.png', tags: [{ title: 'Maps' }, { title: 'Training' }] },
        { _id: 'asset-2', repository: 'localfs', path: 'assets/used.png', filename: 'used.png' }
      ]);
    };
    database.getDatabase = function(callback) {
      callback(null, { retrieve: function(type, query, options, callback) {
        if (typeof options === 'function') callback = options;
        callback(null, type === 'component' ? [{ _id: 'component', provider: 'localfs', image: 'assets/used.png' }] : []);
      } });
    };
    try {
      await assetmanager.getUnusedAssets({}, {
        status: function(code) { status = code; return this; },
        json: function(data) { result = data; }
      }, function(error) { failure = error; });
      assert.ifError(failure);
      assert.strictEqual(status, 200);
      assert.strictEqual(result.assets.length, 1);
      assert.deepStrictEqual(result.assets[0].tags, ['Maps', 'Training']);
    } finally {
      assetmanager.retrieveAsset = originalRetrieveAsset;
      database.getDatabase = originalGetDatabase;
    }
  });

  it('does not count the common storage provider name as an asset use', async function() {
    var getDatabase = database.getDatabase, result;
    database.getDatabase = function(callback) {
      callback(null, { retrieve: function(type, query, callback) {
        callback(null, type === 'asset' ? [{ _id: 'asset-1', filename: 'map.png', path: 'assets/map.png', repository: 'localfs' }] :
          type === 'component' ? [{ _id: 'component', repository: 'localfs', image: 'assets/other.png' }] : []);
      } });
    };
    try {
      await assetmanager.assetUses({ params: { id: 'asset-1' } }, {
        status: function(code) { assert.strictEqual(code, 200); return this; },
        json: function(data) { result = data; }
      }, function(error) { throw error; });
      assert.deepStrictEqual(result, { courses: [], components: [] });
    } finally { database.getDatabase = getDatabase; }
  });

  it('returns real course and content IDs for asset uses across copied courses', async function() {
    var getDatabase = database.getDatabase, result;
    var records = {
      asset: [{ _id: 'asset-1', filename: 'map.png', path: 'assets/map.png' }],
      courseasset: [],
      course: [
        { _id: 'course-1', _uniqueId: 'shared', title: 'First' },
        { _id: 'course-2', _uniqueId: 'shared', title: 'Copy' }
      ],
      component: [
        { _id: 'component-1', _uniqueId: 'shared-component', _courseId: 'course-1', title: 'First item', image: 'map.png' },
        { _id: 'component-2', _uniqueId: 'shared-component', _courseId: 'course-2', title: 'Copy item', image: 'map.png' }
      ],
      contentobject: [{ _id: 'page-2', _courseId: 'course-2', _type: 'page', title: 'Page', image: 'map.png' }]
    };
    database.getDatabase = function(callback) {
      callback(null, { retrieve: function(type, query, callback) {
        callback(null, records[type] || []);
      } });
    };
    try {
      await assetmanager.assetUses({ params: { id: 'asset-1' } }, {
        status: function(code) { assert.strictEqual(code, 200); return this; },
        json: function(data) { result = data; }
      }, function(error) { throw error; });
      assert.deepStrictEqual(result.courses.map(function(course) { return course.id; }), ['course-1', 'course-2']);
      assert.deepStrictEqual(result.components.map(function(item) { return [item.courseId, item.id, item.type]; }), [
        ['course-1', 'component-1', 'component'],
        ['course-2', 'component-2', 'component'],
        ['course-2', 'page-2', 'page']
      ]);
    } finally { database.getDatabase = getDatabase; }
  });

  it('groups asset uses under their own course and links to the correct editor records', function() {
    var filename = path.join(__dirname, '../frontend/src/modules/assetManagement/assetUsage.js');
    var usage, navigation = [], inModal = true;
    var origin = {
      l10n: { t: function() { return 'Unknown course'; } },
      trigger: function(event) { navigation.push(event); },
      router: { navigateTo: function(route) { navigation.push(route); } }
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      $: function(element) {
        return {
          attr: function() { return element.href; },
          closest: function() { return { length: inModal ? 1 : 0 }; }
        };
      },
      define: function(factory) {
        usage = factory(function(name) {
          return name === 'underscore' ? require('underscore') : origin;
        });
      }
    }, { filename: filename });
    var markup = usage.render({
      courses: [{ id: 'one', title: 'First <course>' }, { id: 'two', title: 'Copy' }],
      components: [
        { courseId: 'two', id: 'page2', type: 'page', title: 'Copy page' },
        { courseId: 'one', id: 'item1', type: 'component', title: 'First item' },
        { courseId: 'two', id: 'config2', type: 'config', title: 'Config' },
        { courseId: 'two', id: 'clip2', type: 'clipboard', title: 'Clipboard' },
        { courseId: 'missing', id: 'lost', type: 'component', title: 'Orphan' }
      ]
    });
    var first = markup.indexOf('First &lt;course&gt;'), firstItem = markup.indexOf('First item');
    var copy = markup.indexOf('Copy</a>'), copyItem = markup.indexOf('Copy page');
    assert(first < firstItem && firstItem < copy && copy < copyItem);
    assert(markup.includes('#/editor/one/menu'));
    assert(markup.includes('#/editor/one/component/item1/edit'));
    assert(markup.includes('#/editor/two/page/page2/edit'));
    assert(markup.includes('#/editor/two/config'));
    assert(markup.includes('* Clipboard<br/>'));
    assert(markup.includes('Unknown course</b><br/>* Orphan<br/>'));
    assert(!markup.includes('<course>'));

    var event = { currentTarget: { href: '#/editor/two/page/page2/edit' }, which: 1,
      preventDefault: function() { navigation.push('prevented'); } };
    usage.navigate(event);
    assert.deepStrictEqual(navigation, ['prevented', 'modal:onCancel', 'editor/two/page/page2/edit']);
    navigation.length = 0;
    inModal = false;
    event.ctrlKey = true;
    usage.navigate(event);
    assert.deepStrictEqual(navigation, []);
  });

  it('renders escaped tags only when present in cleanup rows', function() {
    var filename = path.join(__dirname, '../frontend/src/modules/assetManagement/views/assetManagementCleanupView.js');
    var module = { exports: {} };
    var dependencies = {
      underscore: require('underscore'),
      'core/origin': { l10n: { t: function(key) {
        var options = arguments[1];
        if (key === 'app.assetcleanupdeletesuccess') return options.deleted + ' asset(s) permanently deleted.';
        if (key === 'app.assetcleanupdeleteskipped') return options.skipped + ' asset(s) could not be deleted.';
        return key === 'app.tags' ? 'Tags' : 'Uses: 0';
      } } },
      'core/views/originView': { extend: function(proto) { return proto; } }
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      define: function(factory) {
        module.exports = factory(function(name) { return dependencies[name]; });
      }
    }, { filename: filename });
    var view = module.exports;
    var markup = view.buildItemMarkup.call(view, {
      _id: 'asset-1', assetType: 'other', filename: 'map.png', tags: ['Maps', '<script>']
    });
    assert(markup.includes('Tags: Maps, &lt;script&gt;'));
    var withoutTags = view.buildItemMarkup.call(view, {
      _id: 'asset-2', assetType: 'other', filename: 'audio.mp3'
    });
    assert(!withoutTags.includes('asset-cleanup-item-tags'));
    var failed = view.buildItemMarkup.call(view, {
      _id: 'asset-3', filename: 'failed.png', deletionError: 'ENOENT: <missing> & unavailable'
    });
    assert(failed.includes('role="alert"'));
    assert(failed.includes('ENOENT: &lt;missing&gt; &amp; unavailable'));
    assert(!withoutTags.includes('asset-cleanup-item-error'));

    var rendered, alert, summary, visible = false;
    dependencies['core/origin'].trigger = function() {};
    dependencies['core/origin'].Notify = { alert: function(value) { alert = value; } };
    var instance = Object.create(view);
    instance.assets = [{ _id: 'asset-1' }, { _id: 'asset-2', deletionError: 'Old failure' }];
    instance.$ = function(selector) {
      return {
        empty: function() { return this; },
        text: function(value) {
          if (selector === '.asset-cleanup-result') summary = value;
          return this;
        },
        removeClass: function(value) {
          if (selector === '.asset-cleanup-result' && value === 'display-none') visible = true;
          return this;
        }
      };
    };
    instance.renderList = function(assets) { rendered = assets; };
    instance.onDeleteComplete({ deleted: ['asset-1'], errors: [{ id: 'asset-2', message: 'File missing' }] });
    assert.strictEqual(rendered.length, 1);
    assert.strictEqual(rendered[0].deletionError, 'File missing');
    assert.strictEqual(alert.type, 'warning');
    assert.strictEqual(summary, '1 asset(s) permanently deleted. 1 asset(s) could not be deleted.');
    assert.strictEqual(visible, true);
    visible = false;
    instance.onDeleteComplete({ deleted: ['asset-2'], errors: [] });
    assert.strictEqual(rendered.length, 0);
    assert.strictEqual(alert.type, 'success');
    assert.strictEqual(summary, '1 asset(s) permanently deleted.');
    assert.strictEqual(visible, true);
  });

  it('returns and logs each failed asset ID and reason while retaining successful results', function(done) {
    var originalDestroyAsset = assetmanager.destroyAsset, originalLog = logger.log;
    var messages = [];
    assetmanager.destroyAsset = function(id, callback) {
      callback(id === 'failed' ? new Error('ENOENT: file missing') : null);
    };
    logger.log = function(level, message) { messages.push(message); };
    assetmanager.bulkDeleteAssets({ body: { ids: ['failed', 'deleted'] } }, {
      status: function(code) { assert.strictEqual(code, 200); return this; },
      json: function(result) {
        assetmanager.destroyAsset = originalDestroyAsset;
        logger.log = originalLog;
        try {
          assert.deepStrictEqual(result.deleted, ['deleted']);
          assert.deepStrictEqual(result.errors, [{ id: 'failed', message: 'ENOENT: file missing' }]);
          assert.deepStrictEqual(messages, ['Failed to delete asset failed: ENOENT: file missing']);
          done();
        } catch (error) { done(error); }
      }
    });
  });
});
