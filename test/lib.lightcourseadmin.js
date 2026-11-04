var async = require('async');
var request = require('supertest');
var should = require('should');

var origin = require('../');
var auth = require('../lib/auth');
var database = require('../lib/database');
var usermanager = require('../lib/usermanager');
var rolemanager = require('../lib/rolemanager');

var testData = require('./testData.json').testUser;

var app = origin();
var adminAgent = {};
var editorAgent = {};
var editorUser = {};

var EDITOR_EMAIL = 'lighteditor-admin-tests@adaptlearning.org';
var EDITOR_PASSWORD = 'lighteditoradmintestspassword';

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
        should.not.exist(error);
        db.destroy('lightcourseconfig', { _tenantId: app.configuration.getConfig('masterTenantID') }, next);
      }, app.configuration.getConfig('dbName'));
    },
    function removeEditorUser(next) {
      editorUser._id ? usermanager.deleteUser({ _id: editorUser._id }, next) : next();
    }
  ], done);
});

describe('lightcourseconfig "mine" convenience route', function() {
  it('should create a default config record on first use and return it', function(done) {
    adminAgent
      .get('/api/lightcourseconfig/mine')
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        should.exist(res.body._id);
        res.body.defaultPluginSelections.should.eql({});
        res.body.graphicPlaceholders.should.eql({});
        res.body.requiredDefaults.should.eql({});
        res.body.iconDefaults.should.eql({});
        done();
      });
  });

  it('should return the same existing record on a second call, not create a duplicate', function(done) {
    adminAgent
      .get('/api/lightcourseconfig/mine')
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        var firstId = res.body._id;
        adminAgent
          .get('/api/lightcourseconfig/mine')
          .expect(200)
          .end(function(error2, res2) {
            should.not.exist(error2);
            res2.body._id.should.equal(firstId);
            database.getDatabase(function(error3, db) {
              should.not.exist(error3);
              db.retrieve('lightcourseconfig', { _tenantId: app.configuration.getConfig('masterTenantID') }, { jsonOnly: true }, function(error4, results) {
                should.not.exist(error4);
                results.length.should.equal(1);
                done();
              });
            }, app.configuration.getConfig('dbName'));
          });
      });
  });

  it('should persist updates made via the generic content PUT route', function(done) {
    adminAgent
      .get('/api/lightcourseconfig/mine')
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        var configId = res.body._id;
        adminAgent
          .put('/api/content/lightcourseconfig/' + configId)
          .set('Accept', 'application/json')
          .send({ defaultPluginSelections: { extensions: ['uniqueId', 'footer'] } })
          .expect(200)
          .end(function(error2) {
            should.not.exist(error2);
            adminAgent
              .get('/api/lightcourseconfig/mine')
              .expect(200)
              .end(function(error3, res3) {
                should.not.exist(error3);
                res3.body.defaultPluginSelections.extensions.should.eql(['uniqueId', 'footer']);
                done();
              });
          });
      });
  });

  it('should seed a newly created (blank) light course\'s extensions from the admin-configured default instead of the built-in fallback', function(done) {
    editorAgent
      .post('/api/content/lightcourse')
      .set('Accept', 'application/json')
      .send({ title: 'Admin-default-seeded course' })
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        res.body.pluginSelections.extensions.should.eql(['uniqueId', 'footer']); // the admin-configured value set above, not the 6-item built-in fallback
        var createdId = res.body._id;
        database.getDatabase(function(error2, db) {
          should.not.exist(error2);
          db.destroy('lightcourse', { _id: createdId }, done);
        }, app.configuration.getConfig('dbName'));
      });
  });

  it('should reject an iconDefaults update with an icon that is not valid for its control', function(done) {
    adminAgent
      .get('/api/lightcourseconfig/mine')
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        adminAgent
          .put('/api/content/lightcourseconfig/' + res.body._id)
          .set('Accept', 'application/json')
          .send({ iconDefaults: { menuButton: 'not-a-real-icon' } })
          .end(function(error2, res2) {
            should.not.exist(error2);
            res2.statusCode.should.not.equal(200);
            done();
          });
      });
  });

  it('should reject a defaultPluginSelections update whose extensions is not an array', function(done) {
    adminAgent
      .get('/api/lightcourseconfig/mine')
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        adminAgent
          .put('/api/content/lightcourseconfig/' + res.body._id)
          .set('Accept', 'application/json')
          .send({ defaultPluginSelections: { extensions: 'not-an-array' } })
          .end(function(error2, res2) {
            should.not.exist(error2);
            res2.statusCode.should.not.equal(200);
            done();
          });
      });
  });

  it('should accept a valid iconDefaults update and have it merged into a new blank course\'s headerData.iconChoices', function(done) {
    adminAgent
      .get('/api/lightcourseconfig/mine')
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        adminAgent
          .put('/api/content/lightcourseconfig/' + res.body._id)
          .set('Accept', 'application/json')
          .send({ iconDefaults: { menuButton: 'menu' } })
          .expect(200)
          .end(function(error2) {
            should.not.exist(error2);
            editorAgent
              .post('/api/content/lightcourse')
              .set('Accept', 'application/json')
              .send({ title: 'Icon-default-seeded course' })
              .expect(200)
              .end(function(error3, res3) {
                should.not.exist(error3);
                res3.body.headerData.iconChoices.menuButton.should.equal('menu');
                var createdId = res3.body._id;
                database.getDatabase(function(error4, db) {
                  should.not.exist(error4);
                  db.destroy('lightcourse', { _id: createdId }, done);
                }, app.configuration.getConfig('dbName'));
              });
          });
      });
  });

  it('should list only installed component/extension types with a qualifying required translatable/asset field', function(done) {
    adminAgent
      .get('/api/lightcourseconfig/requireddefaultschema')
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        res.body.components.should.be.an.Array();
        res.body.extensions.should.be.an.Array();
        res.body.components.concat(res.body.extensions).forEach(function(entry) {
          should.exist(entry.key);
          entry.requiredTranslatablePaths.should.be.an.Array();
          entry.requiredAssetPaths.should.be.an.Array();
          (entry.requiredTranslatablePaths.length + entry.requiredAssetPaths.length).should.be.above(0);
        });
        done();
      });
  });
});

describe('lightcoursetemplate content validation', function() {
  var templateId;

  after(function(done) {
    templateId ? database.getDatabase(function(error, db) {
      should.not.exist(error);
      db.destroy('lightcoursetemplate', { _id: templateId }, done);
    }, app.configuration.getConfig('dbName')) : done();
  });

  it('should reject creating a template with an invalid contentTree hierarchy', function(done) {
    adminAgent
      .post('/api/content/lightcoursetemplate')
      .set('Accept', 'application/json')
      .send({
        name: 'Invalid template',
        contentSnapshot: { contentTree: { children: [{ _id: 'a', type: 'block', children: [] }] } } // root children must be pages, not blocks
      })
      .end(function(error, res) {
        should.not.exist(error);
        res.statusCode.should.not.equal(200);
        done();
      });
  });

  it('should auto-assign missing stable IDs on a template\'s glossary/resource items, like a light course draft does', function(done) {
    adminAgent
      .post('/api/content/lightcoursetemplate')
      .set('Accept', 'application/json')
      .send({
        name: 'Template with unassigned item IDs',
        contentSnapshot: { glossaryItems: [{ term: 'No id yet', description: '...' }] }
      })
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        templateId = res.body._id;
        should.exist(res.body.contentSnapshot.glossaryItems[0]._id);
        done();
      });
  });

  it('should reject updating a template to an invalid contentTree hierarchy', function(done) {
    adminAgent
      .put('/api/content/lightcoursetemplate/' + templateId)
      .set('Accept', 'application/json')
      .send({ contentSnapshot: { contentTree: { children: 'not-an-array' } } })
      .end(function(error, res) {
        should.not.exist(error);
        res.statusCode.should.not.equal(200);
        done();
      });
  });

  it('should allow a valid update to a template\'s contentSnapshot', function(done) {
    adminAgent
      .put('/api/content/lightcoursetemplate/' + templateId)
      .set('Accept', 'application/json')
      .send({ contentSnapshot: { contentTree: { children: [{ _id: 'page-1', type: 'page', children: [] }] } } })
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        res.body.success.should.be.true();
        done();
      });
  });
});
