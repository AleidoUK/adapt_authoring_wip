// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * One-off/maintenance script: brings the running instance's `role` collection fully in line with
 * whatever's currently on disk under lib/role/ - both roles that don't exist yet (created from
 * scratch) AND roles that already exist but have had their `statement` (permissions) edited since
 * the instance was first installed (their `version`/`statement` are updated to match the file).
 *
 * Why this is needed: lib/rolemanager.js's `installDefaultRoles()` only ever runs once, on the
 * `tenant:mastercreated` event (i.e. at fresh install), and `syncDefaultRoles()` only runs
 * automatically on the one-time `create:masterdatabase` event - NOT on every server start/restart
 * (a common misconception, since the name suggests otherwise). So neither:
 *   - adding a brand new file under lib/role/ (e.g. a whole new role), nor
 *   - editing the `statement` of an EXISTING role file (e.g. adding a permission line to
 *     LightEditor.json for a newly-added content type)
 * ...to an already-installed instance is picked up by a plain server restart - this script needs
 * to be run once, manually, after deploying such a change.
 *
 * Usage: `node sync-roles.js` - run it from the repo root, on whichever machine/environment is
 * running the instance you want to update (it reads the same conf/config.json that server.js
 * does, so the exact same command works unmodified on a local dev instance or the live server).
 * Safe to run at any time, including repeatedly and alongside an already-running instance (it
 * doesn't start an HTTP server or bind any port) - roles already matching the file on disk are
 * simply re-written to the same values. If updating one existing role fails (e.g. a database-level
 * conflict on that specific document), the script logs it and carries on with the rest rather
 * than aborting - check the "Failed" section of the output and investigate/re-run if non-empty.
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
      var updated = [];
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
          if (!existing || !existing.length) {
            return db.create('role', roleDef, function (error) {
              if (error) {
                failed.push({ file: file, error: error.message });
                return next();
              }
              created.push(roleDef.name);
              next();
            });
          }
          // Already exists - bring its version/statement (the only fields that actually change
          // between deploys) in line with the file, same fields lib/rolemanager.js's own
          // syncDefaultRoles() applies, just invoked here on every run rather than only on the
          // one-time create:masterdatabase event.
          db.update('role', { name: roleDef.name }, { version: roleDef.version, statement: roleDef.statement }, function (error) {
            if (error) {
              failed.push({ file: file, error: error.message });
              return next();
            }
            updated.push(roleDef.name);
            next();
          });
        });
      }, function () {
        console.log('');
        console.log('Created (' + created.length + '): ' + (created.join(', ') || 'none'));
        console.log('Updated, already existed (' + updated.length + '): ' + (updated.join(', ') || 'none'));
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
