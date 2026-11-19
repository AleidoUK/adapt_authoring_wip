var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var createRequire = require('module').createRequire;
var Constants = require('../lib/outputmanager').Constants;

function preview(options) {
  var filename = path.join(__dirname, '../plugins/output/adapt/publish.js');
  var nativeRequire = createRequire(filename), module = { exports: {} };
  var commands = [], emptied = [], defaultsApplied = false, includesRemoved = false;
  var json = { config: [{ _defaultLanguage: 'en' }], course: { title: 'Preview' } };
  var dependencies = {
    'child_process': { exec: function(command, settings, callback) {
      commands.push(command);
      if (command.includes('schema-defaults') || command.includes('server-build:')) {
        if (options.error) return callback(new Error('Defaults failed'), '', '');
        defaultsApplied = true;
        json.config.screenSize = { small: 0, medium: 47.5, large: 64 };
      }
      callback(null, 'Task complete', '');
    } },
    'fs-extra': {
      existsSync: function(file) {
        return file.endsWith('schema-defaults.js') ? !options.legacy : true;
      },
      emptyDirSync: function(file) { emptied.push(file); }
    },
    '../../../lib/configuration': { tempDir: '/temp', getConfig: function() { return 'master'; } },
    '../../../lib/installHelpers': { getInstalledFrameworkVersion: function(callback) { callback(null, '5.0.0'); } },
    '../../../lib/logger': { log: function() {} },
    '../../../': function() { return { emit: function() {} }; },
    './outputHelpers': { validateCourse: function(data, callback) { callback(null, true); } },
    '../../../lib/usermanager': { getCurrentUser: function() { return { _id: 'user', tenant: { _id: 'tenant' } }; } }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module,
    require: function(name) { return dependencies[name] || nativeRequire(name); }
  }, { filename: filename });
  var context = {
    getCourseJSON: function(tenant, course, callback) { callback(null, json); },
    applyTheme: function(tenant, course, data, folder, callback) { callback(null, 'theme'); },
    writeCustomStyle: function(tenant, course, folder, callback) { callback(null); },
    sanitizeCourseJSON: function(mode, data, callback) { data.config = data.config[0]; callback(null, data); },
    buildFlagExists: function(file, callback) { callback(null, !!options.flag); },
    applyMenu: function(tenant, course, data, folder, callback) { callback(null, 'menu'); },
    writeCourseAssets: function(tenant, course, folder, assets, data, callback) { callback(null, data); },
    writeCourseJSON: function(data, folder, callback) {
      assert.strictEqual(data.config.screenSize, undefined);
      callback(null);
    },
    clearBuildFlag: function(file, callback) { callback(null); },
    removeBuildIncludes: function(file, callback) { includesRemoved = true; callback(null); }
  };
  return new Promise(function(resolve, reject) {
    module.exports.call(context, 'course', Constants.Modes.Preview, { query: { force: String(!!options.force) } }, {},
      function(error, result) {
        if (error) return reject(error);
        resolve({ commands: commands, emptied: emptied, defaultsApplied: defaultsApplied,
          includesRemoved: includesRemoved, json: json, result: result });
      });
  });
}

describe('preview framework defaults', function() {
  it('applies installed framework defaults on cached previews without rebuilding or clearing output', async function() {
    var result = await preview({});
    assert.strictEqual(result.commands.length, 1);
    assert(result.commands[0].startsWith('npx grunt schema-defaults --outputdir='));
    assert(result.commands[0].includes('--theme=theme --menu=menu'));
    assert.strictEqual(result.emptied.length, 0);
    assert(result.defaultsApplied);
    assert(result.json.config.screenSize.small === 0);
    assert(result.includesRemoved);
    assert(result.result.success);
  });

  it('keeps the existing cached-preview path for older frameworks without the defaults task', async function() {
    var result = await preview({ legacy: true });
    assert.strictEqual(result.commands.length, 0);
    assert.strictEqual(result.emptied.length, 0);
    assert(result.result.success);
  });

  [{ force: true }, { flag: true }].forEach(function(options) {
    it('retains the full build when ' + (options.force ? 'forced' : 'flagged'), async function() {
      var result = await preview(options);
      assert(result.commands.some(function(command) { return command.includes('server-build:prod'); }));
      assert(result.defaultsApplied);
      assert.strictEqual(result.emptied.length, options.force ? 1 : 0);
    });
  });

  it('reports defaults-task failures instead of returning a successful preview', async function() {
    await assert.rejects(preview({ error: true }), /Defaults failed/);
  });
});
