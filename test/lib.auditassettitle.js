var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var EventEmitter = require('events');
var createRequire = require('module').createRequire;

function harness() {
  var app = new EventEmitter(), hooks = {}, routes = {}, saved = [], lookups = 0;
  var assets = [{ _id: 'image', name: 'AI.jpg', title: 'Image label', filename: 'hashed.jpg' }];
  var logs = [{ contentType: 'courseasset', contentId: 'reference', contentTitle: '', snapshot: { _assetId: 'image' } }];
  app.contentmanager = {
    addContentHook: function(action, type, options, hook) {
      if (options.when === 'post') hooks[action] = hook;
    },
    create: function(type, entry, callback) { saved.push(entry); callback(null, entry); },
    retrieve: function(type, query, options, callback) { callback(null, logs); }
  };
  var mocks = {
    '../../../': function() { return app; },
    '../../../lib/rest': { get: function(url, handler) { routes[url] = handler; } },
    '../../../lib/permissions': { ignoreRoute: function() {} },
    '../../../lib/usermanager': { getCurrentUser: function() {
      return { _id: 'user', email: 'user@example.test', tenant: { _id: 'tenant' } };
    } },
    '../../../lib/database': { getDatabase: function(callback) {
      callback(null, { retrieve: function(type, query, options, callback) {
        lookups++;
        if (h.error) return callback(h.error);
        assert.strictEqual(type, 'asset');
        assert.deepStrictEqual(Array.from(query._id.$in), ['image']);
        callback(null, assets);
      } });
    } }
  };
  var filename = path.join(__dirname, '../plugins/content/auditlog/index.js');
  var nativeRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module, exports: module.exports, console: console,
    require: function(name) { return mocks[name] || nativeRequire(name); }
  }, { filename: filename });
  app.emit('serverStarted');
  var h = { hooks: hooks, logs: logs, assets: assets, saved: saved };
  h.request = function(url) {
    return new Promise(function(resolve) {
      var status;
      routes[url]({ params: { courseId: 'course', contentType: 'courseasset', contentId: 'reference' }, query: {} }, {
        status: function(value) { status = value; return this; },
        json: function(body) { resolve({ status: status, body: body }); }
      });
    });
  };
  h.lookups = function() { return lookups; };
  return h;
}

describe('course asset audit labels', function() {
  ['/auditlog/course/:courseId', '/auditlog/content/:contentType/:contentId'].forEach(function(route) {
    it('resolves existing untitled entries to the original filename on ' + route, async function() {
      var h = harness();
      h.logs.push({ contentType: 'component', contentTitle: 'Keep title' });
      var result = await h.request(route);
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.body[0].contentTitle, 'AI.jpg');
      assert.strictEqual(result.body[1].contentTitle, 'Keep title');
      assert.strictEqual(h.logs[0].contentTitle, '');
      assert.strictEqual(h.lookups(), 1);
    });
  });

  it('stores the resolved label for future create history entries', function(done) {
    var h = harness();
    h.hooks.create({ _id: 'reference', _courseId: 'course', _assetId: 'image' }, function(error) {
      assert.ifError(error);
      assert.strictEqual(h.saved[0].contentTitle, 'AI.jpg');
      assert.strictEqual(h.saved[0].contentType, 'courseasset');
      done();
    }, 'courseasset');
  });

  it('preserves stored labels and handles deleted assets without inventing a filename', async function() {
    var h = harness();
    h.assets.length = 0;
    h.logs.push({ contentType: 'courseasset', contentTitle: 'Saved filename.jpg', snapshot: { _assetId: 'image' } });
    var result = await h.request('/auditlog/course/:courseId');
    assert.strictEqual(result.body[0].contentTitle, '');
    assert.strictEqual(result.body[1].contentTitle, 'Saved filename.jpg');
  });

  it('reports database errors explicitly', async function() {
    var h = harness();
    h.error = new Error('Lookup failed');
    var result = await h.request('/auditlog/course/:courseId');
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.body.message, 'Lookup failed');
  });
});
