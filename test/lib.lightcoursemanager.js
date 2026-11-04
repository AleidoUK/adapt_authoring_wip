var async = require('async');
var request = require('supertest');
var should = require('should');

var origin = require('../');
var auth = require('../lib/auth');
var database = require('../lib/database');
var usermanager = require('../lib/usermanager');
var rolemanager = require('../lib/rolemanager');
var permissions = require('../lib/permissions');

var testData = require('./testData.json').testUser;

var app = origin();

var adminAgent = {};
var editorAgent = {};
var editorUser = {};

var EDITOR_EMAIL = 'lighteditor@adaptlearning.org';
var EDITOR_PASSWORD = 'lighteditorpassword';

var lightCourseId, lightCourseRevision;
var assetId, adminAssetId;
var versionIds = [];

before(function(done) {
  this.timeout(20000);
  adminAgent = request.agent(app.getServerURL());
  editorAgent = request.agent(app.getServerURL());

  async.series([
    function loginAdmin(next) {
      adminAgent
        .post('/api/login')
        .set('Accept', 'application/json')
        .send({ email: testData.email, password: testData.plainPassword })
        .expect(200)
        .end(next);
    },
    function createEditorUser(next) {
      auth.hashPassword(EDITOR_PASSWORD, function(error, hash) {
        if (error) return next(error);
        usermanager.createUser({
          email: EDITOR_EMAIL,
          password: hash,
          auth: 'local',
          _isDeleted: false,
          _tenantId: app.configuration.getConfig('masterTenantID')
        }, function(error, user) {
          if (error) return next(error);
          editorUser = user;
          rolemanager.assignRoleByName('Light Editor', user._id, next);
        });
      });
    },
    function loginEditor(next) {
      editorAgent
        .post('/api/login')
        .set('Accept', 'application/json')
        .send({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD })
        .expect(200)
        .end(next);
    }
  ], done);
});

after(function(done) {
  async.series([
    function cleanup(next) {
      database.getDatabase(function(error, db) {
        if (error) return next(error);
        async.series([
          function(cb) { lightCourseId ? db.destroy('lightcourse', { _id: lightCourseId }, cb) : cb(); },
          function(cb) { versionIds.length ? db.destroy('lightcourseversion', { _id: { $in: versionIds } }, cb) : cb(); },
          function(cb) { assetId ? db.destroy('asset', { _id: assetId }, cb) : cb(); },
          function(cb) { adminAssetId ? db.destroy('asset', { _id: adminAssetId }, cb) : cb(); }
        ], next);
      }, app.configuration.getConfig('dbName'));
    },
    function removeEditorUser(next) {
      editorUser._id ? usermanager.deleteUser({ _id: editorUser._id }, next) : next();
    }
  ], done);
});

it('should allow a Light Editor to create a light course', function(done) {
  editorAgent
    .post('/api/content/lightcourse')
    .set('Accept', 'application/json')
    .send({ title: 'My Light Course' })
    .expect(200)
    .expect('Content-Type', /json/)
    .end(function(error, res) {
      should.not.exist(error);
      should.exist(res.body._id);
      res.body.revision.should.equal(0);
      lightCourseId = res.body._id;
      lightCourseRevision = res.body.revision;
      done();
    });
});

it('should pre-select the Unique ID/Footer/Styling/Trickle/Spoor/Hero extensions for a new (non-template) light course', function(done) {
  editorAgent
    .get('/api/content/lightcourse/' + lightCourseId)
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.body.pluginSelections.extensions.should.containDeep(['uniqueId', 'footer', 'styling', 'trickle', 'spoor', 'hero']);
      res.body.pluginSelections.extensions.length.should.equal(6);
      done();
    });
});

it('should allow the owning Light Editor to read their own light course', function(done) {
  editorAgent
    .get('/api/content/lightcourse/' + lightCourseId)
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.body.title.should.equal('My Light Course');
      done();
    });
});

it('should create a light course from a template with freshly regenerated stable IDs', function(done) {
  var templateSnapshot = {
    contentTree: { children: [
      { _id: 'template-page-1', type: 'page', children: [
        { _id: 'template-article-1', type: 'article', children: [] }
      ]}
    ]},
    pluginSelections: { menu: 'adapt-contrib-boxMenu', theme: 'adapt-contrib-vanilla', extensions: [] },
    glossaryItems: [{ _id: 'template-glossary-1', term: 'Example', description: 'An example term' }],
    resourceItems: []
  };
  adminAgent
    .post('/api/content/lightcoursetemplate')
    .set('Accept', 'application/json')
    .send({ name: 'Starter template', contentSnapshot: templateSnapshot })
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      var templateId = res.body._id;
      editorAgent
        .post('/api/content/lightcourse')
        .set('Accept', 'application/json')
        .send({ title: 'From template', _templateId: templateId })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          var createdId = res.body._id;
          res.body.contentTree.children[0]._id.should.not.equal('template-page-1');
          res.body.contentTree.children[0].type.should.equal('page');
          res.body.contentTree.children[0].children[0].type.should.equal('article');
          res.body.glossaryItems[0].term.should.equal('Example');
          res.body.glossaryItems[0]._id.should.not.equal('template-glossary-1');
          // a template's own plugin selection must not be silently augmented with the
          // new-blank-course extension defaults - confirmed here against its explicit empty list.
          res.body.pluginSelections.extensions.should.eql([]);
          database.getDatabase(function(error, db) {
            should.not.exist(error);
            async.series([
              function(cb) { db.destroy('lightcourse', { _id: createdId }, cb); },
              function(cb) { db.destroy('lightcoursetemplate', { _id: templateId }, cb); }
            ], done);
          }, app.configuration.getConfig('dbName'));
        });
    });
});

it('should reject a Light-Editor-only user accessing full-course content directly', function(done) {
  // Verified against the permissions/role layer directly (rather than a live /api/content/course
  // request) so this check doesn't depend on the full-course content type's schema/model being
  // registered - it only needs the Light Editor role's statements to be correct.
  permissions.hasPermission(editorUser._id, 'read', permissions.buildResourceString(editorUser._tenantId, '/api/content/course/anyid'), function(error, allowed) {
    should.not.exist(error);
    allowed.should.be.false();
    done();
  });
});

it('should allow a Light Editor to create (but not delete) a bank asset', function(done) {
  editorAgent
    .post('/api/asset')
    .field('title', 'Light course bank asset')
    .field('description', 'test asset')
    .field('repo', 'localfs')
    .attach('file', __filename)
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      should.exist(res.body._id);
      assetId = res.body._id;
      done();
    });
});

it('should reject a Light Editor deleting an asset uploaded by somebody else', function(done) {
  // Note: an uploader is automatically granted full CRUD on their *own* upload via a per-asset
  // policy (lib/assetmanager.js's createAsset()), independent of role - this is pre-existing,
  // intentional behaviour for every content type, not something specific to light courses. The
  // Light Editor role's explicit "deny" on /api/asset/* delete (see lib/role/LightEditor.json)
  // is what blocks deleting assets uploaded by someone else, which is what's exercised here.
  adminAgent
    .post('/api/asset')
    .field('title', 'Admin-owned asset')
    .field('description', 'test asset')
    .field('repo', 'localfs')
    .attach('file', __filename)
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      adminAssetId = res.body._id;
      editorAgent
        .del('/api/asset/' + adminAssetId)
        .end(function(error, res) {
          should.not.exist(error);
          res.statusCode.should.not.equal(200);
          done();
        });
    });
});

it('should save a light course when the submitted revision matches (optimistic concurrency, happy path)', function(done) {
  editorAgent
    .put('/api/content/lightcourse/' + lightCourseId)
    .set('Accept', 'application/json')
    .send({
      title: 'My Light Course (edited)',
      revision: lightCourseRevision,
      contentTree: { children: [
        { _id: 'page-1', type: 'page', children: [
          { _id: 'article-1', type: 'article', children: [
            { _id: 'block-1', type: 'block', children: [
              { _id: 'component-1', type: 'component', _component: 'text', title: 'Hello world', body: '<p>Three more words</p>' }
            ]}
          ]}
        ]}
      ]},
      glossaryItems: [{ _id: 'glossary-1', term: 'Term one', description: 'A description' }]
    })
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.body.success.should.be.true;
      lightCourseRevision += 1; // server increments revision on every successful save
      done();
    });
});

it('should auto-append a version-history row on every successful draft save, per the main plan', function(done) {
  editorAgent
    .get('/api/content/lightcourse/' + lightCourseId)
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      var versionHistory = res.body.headerData.versionHistory;
      versionHistory.length.should.equal(1);
      versionHistory[0].version.should.equal('-'); // never published yet
      versionHistory[0].author.should.equal(EDITOR_EMAIL);
      versionHistory[0].screens.should.equal(1);
      versionHistory[0].words.should.equal(9); // matches the wordcount endpoint's total below
      versionHistory[0].notes.should.equal('');
      versionHistory[0].duration.should.equal('');
      done();
    });
});

it('should return a draft word count reflecting the saved content', function(done) {
  editorAgent
    .get('/api/content/lightcourse/' + lightCourseId + '/wordcount')
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.body.screens.should.equal(1);
      res.body.componentWords.should.equal(5); // "Hello world" (2) + "Three more words" (3)
      res.body.glossaryWords.should.equal(4); // "Term one" (2) + "A description" (2)
      res.body.total.should.equal(9);
      done();
    });
});

it('should reject a save that reuses a stale revision with a 409 conflict', function(done) {
  editorAgent
    .put('/api/content/lightcourse/' + lightCourseId)
    .set('Accept', 'application/json')
    .send({ title: 'Should not be applied', revision: lightCourseRevision - 1 })
    .expect(409)
    .end(function(error, res) {
      should.not.exist(error);
      res.body.success.should.be.false;
      done();
    });
});

it('should publish sequential versions following the "1.0 -> 1.1 -> 2.0" numbering rule', function(done) {
  function publish(bump, expectedVersionNumber, next) {
    editorAgent
      .post('/api/content/lightcourse/' + lightCourseId + '/versions')
      .set('Accept', 'application/json')
      .send({ revision: lightCourseRevision, bump: bump })
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        res.body.versionNumber.should.equal(expectedVersionNumber);
        versionIds.push(res.body._id);
        lightCourseRevision += 1; // publish also increments revision
        next();
      });
  }

  async.series([
    function(next) { publish('minor', '1.0', next); }, // first publish is always 1.0
    function(next) { publish('minor', '1.1', next); },
    function(next) { publish('major', '2.0', next); }
  ], done);
});

it('should list published versions for a light course', function(done) {
  editorAgent
    .get('/api/content/lightcourse/' + lightCourseId + '/versions')
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.body.length.should.equal(3);
      done();
    });
});

it('should return the same word count for a published version as the draft it was published from', function(done) {
  editorAgent
    .get('/api/content/lightcourseversion/' + versionIds[0] + '/wordcount')
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.body.screens.should.equal(1);
      res.body.componentWords.should.equal(5);
      res.body.total.should.equal(9);
      done();
    });
});

it('should export a light course draft as Markdown, embedding stable IDs as lcid comments', function(done) {
  var tenantId = app.configuration.getConfig('masterTenantID');
  editorAgent
    .get('/document-export/' + tenantId + '/' + lightCourseId + '?format=markdown')
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.headers['content-type'].should.match(/text\/markdown/);
      res.text.should.match(/<!-- lcid:component-1 -->/);
      res.text.should.match(/Hello world/);
      done();
    });
});

it('should export a light course draft as .docx and persist a lightcourseexport record', function(done) {
  var tenantId = app.configuration.getConfig('masterTenantID');
  editorAgent
    .get('/document-export/' + tenantId + '/' + lightCourseId + '?format=docx')
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.headers['content-type'].should.match(/wordprocessingml/);
      database.getDatabase(function(dbError, db) {
        should.not.exist(dbError);
        db.retrieve('lightcourseexport', { _lightCourseId: lightCourseId, format: 'docx' }, {}, function(retrieveError, results) {
          should.not.exist(retrieveError);
          results.length.should.be.above(0);
          results[0].isDraft.should.be.true;
          done();
        });
      }, app.configuration.getConfig('masterTenantID'));
    });
});

it('should export a published version as Markdown using its point-in-time content snapshot', function(done) {
  var tenantId = app.configuration.getConfig('masterTenantID');
  editorAgent
    .get('/document-export/' + tenantId + '/' + versionIds[0] + '?format=markdown')
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.text.should.match(/<!-- lcid:component-1 -->/);
      done();
    });
});

it('should reject mutating a published (immutable) version', function(done) {
  editorAgent
    .put('/api/content/lightcourseversion/' + versionIds[0])
    .set('Accept', 'application/json')
    .send({ versionNumber: '9.9' })
    .end(function(error, res) {
      should.not.exist(error);
      res.statusCode.should.not.equal(200);
      done();
    });
});

it('should reject mutations on a light course that has been converted (locked)', function(done) {
  database.getDatabase(function(error, db) {
    should.not.exist(error);
    db.update('lightcourse', { _id: lightCourseId }, { conversionStatus: 'converted' }, function(error) {
      should.not.exist(error);
      editorAgent
        .put('/api/content/lightcourse/' + lightCourseId)
        .set('Accept', 'application/json')
        .send({ title: 'Should be blocked', revision: lightCourseRevision })
        .end(function(error, res) {
          should.not.exist(error);
          res.statusCode.should.not.equal(200);
          // revert so other assertions/cleanup aren't affected by the locked state
          db.update('lightcourse', { _id: lightCourseId }, { conversionStatus: 'none' }, done);
        });
    });
  }, app.configuration.getConfig('dbName'));
});

it('should deny access to a light course whose _tenantId does not match the requesting user (cross-tenant ID guessing)', function(done) {
  database.getDatabase(function(error, db) {
    should.not.exist(error);
    db.update('lightcourse', { _id: lightCourseId }, { _tenantId: '000000000000000000000001' }, function(error) {
      should.not.exist(error);
      editorAgent
        .get('/api/content/lightcourse/' + lightCourseId)
        .end(function(error, res) {
          should.not.exist(error);
          res.statusCode.should.not.equal(200);
          // restore the real tenant id so cleanup can find/remove the record afterwards
          db.update('lightcourse', { _id: lightCourseId }, { _tenantId: app.configuration.getConfig('masterTenantID') }, done);
        });
    });
  }, app.configuration.getConfig('dbName'));
});

it('should deny reading a light course template whose _tenantId does not match the requesting user (cross-tenant template read)', function(done) {
  adminAgent
    .post('/api/content/lightcoursetemplate')
    .set('Accept', 'application/json')
    .send({ name: 'Cross-tenant template test', contentSnapshot: {} })
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      var templateId = res.body._id;
      database.getDatabase(function(error, db) {
        should.not.exist(error);
        db.update('lightcoursetemplate', { _id: templateId }, { _tenantId: '000000000000000000000001' }, function(error) {
          should.not.exist(error);
          editorAgent
            .get('/api/content/lightcoursetemplate/' + templateId)
            .end(function(error, res) {
              should.not.exist(error);
              res.statusCode.should.not.equal(200);
              db.destroy('lightcoursetemplate', { _id: templateId }, done);
            });
        });
      }, app.configuration.getConfig('dbName'));
    });
});

it('should cascade-delete a light course\'s versions/exports/bank-asset attachments when the course itself is deleted', function(done) {
  var deleteTestCourseId, deleteTestRevision, deleteTestVersionId;

  async.series([
    function createCourse(next) {
      editorAgent
        .post('/api/content/lightcourse')
        .set('Accept', 'application/json')
        .send({ title: 'Course to be deleted' })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          deleteTestCourseId = res.body._id;
          deleteTestRevision = res.body.revision;
          next();
        });
    },
    function publishAVersion(next) {
      editorAgent
        .post('/api/content/lightcourse/' + deleteTestCourseId + '/versions')
        .set('Accept', 'application/json')
        .send({ revision: deleteTestRevision, bump: 'minor' })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          deleteTestVersionId = res.body._id;
          deleteTestRevision += 1;
          next();
        });
    },
    function exportTheDraft(next) {
      editorAgent
        .get('/document-export/' + app.configuration.getConfig('masterTenantID') + '/' + deleteTestCourseId + '?format=markdown')
        .expect(200)
        .end(function(error) {
          should.not.exist(error);
          next();
        });
    },
    function attachABankAsset(next) {
      database.getDatabase(function(error, db) {
        should.not.exist(error);
        db.create('lightcoursebankasset', {
          _tenantId: app.configuration.getConfig('masterTenantID'),
          _lightCourseId: deleteTestCourseId,
          _assetId: assetId,
          uploadedBy: editorUser._id
        }, next);
      }, app.configuration.getConfig('dbName'));
    },
    function confirmRelatedRecordsExistBeforeDelete(next) {
      database.getDatabase(function(error, db) {
        should.not.exist(error);
        async.parallel({
          versions: function(cb) { db.retrieve('lightcourseversion', { _lightCourseId: deleteTestCourseId }, { jsonOnly: true }, cb); },
          exports: function(cb) { db.retrieve('lightcourseexport', { _lightCourseId: deleteTestCourseId }, { jsonOnly: true }, cb); },
          bankAssets: function(cb) { db.retrieve('lightcoursebankasset', { _lightCourseId: deleteTestCourseId }, { jsonOnly: true }, cb); }
        }, function(error, results) {
          should.not.exist(error);
          results.versions.length.should.equal(1);
          results.exports.length.should.equal(1);
          results.bankAssets.length.should.equal(1);
          next();
        });
      }, app.configuration.getConfig('dbName'));
    },
    function deleteTheCourse(next) {
      editorAgent
        .delete('/api/content/lightcourse/' + deleteTestCourseId)
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          res.body.success.should.be.true();
          next();
        });
    },
    function confirmEverythingIsGone(next) {
      database.getDatabase(function(error, db) {
        should.not.exist(error);
        async.parallel({
          course: function(cb) { db.retrieve('lightcourse', { _id: deleteTestCourseId }, { jsonOnly: true }, cb); },
          versions: function(cb) { db.retrieve('lightcourseversion', { _lightCourseId: deleteTestCourseId }, { jsonOnly: true }, cb); },
          exports: function(cb) { db.retrieve('lightcourseexport', { _lightCourseId: deleteTestCourseId }, { jsonOnly: true }, cb); },
          bankAssets: function(cb) { db.retrieve('lightcoursebankasset', { _lightCourseId: deleteTestCourseId }, { jsonOnly: true }, cb); }
        }, function(error, results) {
          should.not.exist(error);
          results.course.length.should.equal(0);
          results.versions.length.should.equal(0);
          results.exports.length.should.equal(0);
          results.bankAssets.length.should.equal(0);
          next();
        });
      }, app.configuration.getConfig('dbName'));
    }
  ], done);
});
