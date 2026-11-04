// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * One-off/maintenance script: adds any role definition under lib/role/ that doesn't yet exist in
 * the running instance's `role` collection, without touching roles that already exist.
 *
 * Why this is needed: lib/rolemanager.js's `installDefaultRoles()` only ever runs once, on the
 * `tenant:mastercreated` event (i.e. at fresh install) - and `syncDefaultRoles()` (which runs on
 * every server start) only *updates* roles that already exist by name; it does nothing for a
 * brand new role file added to an already-installed instance (confirmed by reading both
 * functions - `syncDefaultRoles` uses `db.update({name: role.name}, ...)`, which simply matches
 * zero documents and logs a warning if the name doesn't exist yet). So adding a new file under
 * lib/role/ (e.g. LightEditor.json) to an already-running instance needs this script run once -
 * a plain server restart is not enough.
 *
 * Usage: `node sync-roles.js` - run it from the repo root, on whichever machine/environment is
 * running the instance you want to update (it reads the same conf/config.json that server.js
 * does, so the exact same command works unmodified on a local dev instance or the live server).
 * Safe to run at any time, including repeatedly - roles that already exist are left completely
 * untouched (not even their `version`/`statement` are updated - edit directly in the database or
 * extend this script if you need existing roles updated too). Does not start an HTTP server or
 * bind any port, so it's safe to run alongside an already-running instance.
 */

var fs = require('fs');
var path = require('path');
var async = require('async');

var app = require('./lib/application')();
var database = require('./lib/database');
var configuration = require('./lib/configuration');

app.once('modulesReady', function () {
  database.getDatabase(function (error, db) {
    if (error) {
      console.error('Failed to connect to the database:', error.message || error);
      return process.exit(1);
    }

    var roleDir = path.join(configuration.serverRoot, 'lib', 'role');
    fs.readdir(roleDir, function (error, files) {
      if (error) {
        console.error('Failed to read ' + roleDir + ':', error.message || error);
        return process.exit(1);
      }

      var jsonFiles = files.filter(function (file) { return '.json' === path.extname(file); });
      var created = [];
      var skipped = [];
      var failed = [];

      async.eachSeries(jsonFiles, function (file, next) {
        var roleDef;
        try {
          roleDef = JSON.parse(fs.readFileSync(path.join(roleDir, file), 'utf8'));
        } catch (parseError) {
          failed.push({ file: file, error: parseError.message });
          return next();
        }

        db.retrieve('role', { name: roleDef.name }, { jsonOnly: true }, function (error, existing) {
          if (error) {
            failed.push({ file: file, error: error.message });
            return next();
          }
          if (existing && existing.length) {
            skipped.push(roleDef.name);
            return next();
          }
          db.create('role', roleDef, function (error) {
            if (error) {
              failed.push({ file: file, error: error.message });
              return next();
            }
            created.push(roleDef.name);
            next();
          });
        });
      }, function () {
        console.log('');
        console.log('Created (' + created.length + '): ' + (created.join(', ') || 'none'));
        console.log('Already existed, left untouched (' + skipped.length + '): ' + (skipped.join(', ') || 'none'));
        if (failed.length) {
          console.log('Failed (' + failed.length + '):');
          failed.forEach(function (f) { console.log('  - ' + f.file + ': ' + f.error); });
        }
        console.log('');
        process.exit(failed.length ? 1 : 0);
      });
    });
  }, configuration.getConfig('dbName'));
});

// mirrors lib/application.js's Origin.prototype.run(), minus the app.startServer(options) call at
// the end - we only need configuration/database/rolemanager preloaded, not an HTTP server.
app.preloadModule('configuration', require('./lib/configuration'));
app.preloadModule('database', require('./lib/database'));
app.preloadModule('logger', require('./lib/logger'));
app.preloadModule('rest', require('./lib/rest'));
app.preloadModule('pluginmanager', require('./lib/pluginmanager'));
app.preloadModule('filestorage', require('./lib/filestorage'));
app.preloadModule('contentmanager', require('./lib/contentmanager'));
app.preloadModule('assetmanager', require('./lib/assetmanager'));
app.preloadModule('outputmanager', require('./lib/outputmanager'));
app.preloadModule('authentication', require('./lib/auth'));
app.preloadModule('usermanager', require('./lib/usermanager'));
app.preloadModule('tenantmanager', require('./lib/tenantmanager'));
app.preloadModule('rolemanager', require('./lib/rolemanager'));
app.preloadModule('bowermanager', require('./lib/bowermanager'));
app.preload();
