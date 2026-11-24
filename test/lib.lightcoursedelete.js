var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var createRequire = require('module').createRequire;
var ROOT = path.join(__dirname, '..');

function loadPlugin(dependencies) {
  var filename = path.join(ROOT, 'plugins/content/lightcourse/index.js');
  var nativeRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module, exports: module.exports,
    require: function(name) {
      return Object.prototype.hasOwnProperty.call(dependencies, name) ?
        dependencies[name] : nativeRequire(name);
    }
  }, { filename: filename });
  return module.exports;
}

function harness(course, user, admin, permission, usePermissionOverride) {
  var state = { cascaded: [], baseDestroyed: false, adminResource: null };
  function ContentPermissionError() { this.message = 'Access denied'; }
  function ContentPlugin() {}
  ContentPlugin.prototype.destroy = function(search, force, next) {
    state.baseDestroyed = true;
    state.baseForce = force;
    next(null);
  };
  var app = {
    once: function() {},
    contentmanager: { getContentPlugin: function(type, callback) {
      callback(null, { destroy: function(search, force, next) {
        state.cascaded.push({ type: type, force: force });
        next(null);
      } });
    } }
  };
  var dependencies = {
    '../../../lib/contentmanager': { ContentPlugin: ContentPlugin, errors: {
      ContentPermissionError: ContentPermissionError,
      ContentConflictError: Error
    } },
    '../../../lib/database': {},
    '../../../lib/permissions': {
      buildResourceString: function(tenantId, route) {
        state.adminResource = 'urn:x-adapt:' + tenantId + route;
        return state.adminResource;
      },
      hasPermission: function(userId, action, resource, callback) {
        callback(null, admin);
      }
    },
    '../../../lib/usermanager': { getCurrentUser: function() { return user; } },
    '../../../lib/logger': { log: function() {} },
    '../../../lib/rest': {},
    '../../../': function() { return app; },
    '../../../lib/lightcourse/validation': {},
    '../../../lib/lightcourse/idRegeneration': {},
    '../../../lib/lightcourse/permissionAction': { normalize: function(action) { return action; } },
    '../../../lib/lightcoursewordcount': {},
    '../../../lib/lightcourse/versionDiff': {},
    '../../../lib/lightcourse/iconClasses': { FONT_FILES: {} },
    '../../../lib/lightcourse/comments': {}
  };
  var LightCourse = loadPlugin(dependencies), plugin = new LightCourse();
  plugin.retrieve = function(search, options, callback) { callback(null, [course]); };
  if (usePermissionOverride !== false) {
    plugin.hasPermission = function(action, userId, tenantId, record, callback) {
      assert.strictEqual(action, 'delete');
      assert.strictEqual(record, course);
      callback(null, permission);
    };
  }
  state.plugin = plugin;
  state.course = course;
  state.ContentPermissionError = ContentPermissionError;
  return state;
}

function destroy(state) {
  return new Promise(function(resolve) {
    state.plugin.destroy({ _id: state.course._id }, function(error) {
      resolve(error);
    });
  });
}

describe('Light Course deletion authorization', function() {
  it('rejects deleting another editor\'s course before cascading its records', async function() {
    var h = harness({ _id: 'course', createdBy: 'owner' },
      { _id: 'editor', tenant: { _id: 'tenant' } }, false, true);
    var error = await destroy(h);
    assert(error instanceof h.ContentPermissionError);
    assert.strictEqual(h.baseDestroyed, false);
    assert.deepStrictEqual(h.cascaded, []);
  });

  it('allows an owner to delete their course after permission checks', async function() {
    var h = harness({ _id: 'course', createdBy: 'editor' },
      { _id: 'editor', tenant: { _id: 'tenant' } }, false, true);
    var error = await destroy(h);
    assert.ifError(error);
    assert.strictEqual(h.baseDestroyed, true);
    assert.strictEqual(h.baseForce, true);
    assert.strictEqual(h.cascaded.length, 3);
    assert(h.cascaded.every(function(entry) { return entry.force; }));
  });

  it('allows an administrator to delete another editor\'s course', async function() {
    var h = harness({ _id: 'course', createdBy: 'owner' },
      { _id: 'admin', tenant: { _id: 'tenant' } }, true, true);
    var error = await destroy(h);
    assert.ifError(error);
    assert.strictEqual(h.baseDestroyed, true);
    assert.strictEqual(h.adminResource,
      'urn:x-adapt:tenant/api/content/course/lightcourse-delete-check');
  });

  it('lets admins delete converted courses but keeps active conversions locked', function(done) {
    var converted = { _id: 'course', conversionStatus: 'converted' };
    var editor = harness(converted, { _id: 'editor', tenant: { _id: 'tenant' } }, false, true, false);
    var admin = harness(converted, { _id: 'admin', tenant: { _id: 'tenant' } }, true, true, false);
    editor.plugin.hasPermission('delete', 'editor', 'tenant', converted, function(error, allowed) {
      assert.ifError(error);
      assert.strictEqual(allowed, false);
      admin.plugin.hasPermission('delete', 'admin', 'tenant', converted, function(error, allowed) {
        assert.ifError(error);
        assert.strictEqual(allowed, true);
        admin.plugin.hasPermission('delete', 'admin', 'tenant',
          { _id: 'course', conversionStatus: 'converting' }, function(error, allowed) {
            assert.ifError(error);
            assert.strictEqual(allowed, false);
            done();
          });
      });
    });
  });
});
