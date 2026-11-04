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

var EDITOR_EMAIL = 'lighteditor-componentdefault-tests@adaptlearning.org';
var EDITOR_PASSWORD = 'lighteditorcomponentdefaulttestspassword';

// every record created across this file's tests, so the `after` hook can clean up regardless
// of which `it` block created it (mirrors test/lib.lightcourseadmin.js's own cleanup style).
var createdIds = [];

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
        db.destroy('lightcomponentdefault', { _id: { $in: createdIds } }, next);
      }, app.configuration.getConfig('dbName'));
    },
    function removeEditorUser(next) {
      editorUser._id ? usermanager.deleteUser({ _id: editorUser._id }, next) : next();
    }
  ], done);
});

describe('lightcomponentdefault content type', function() {
  describe('admin/Light Editor permissions', function() {
    var createdId;

    afterEach(function() {
      createdId = undefined;
    });

    it('should let the admin agent create a component default', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Permissions test preset', componentType: 'text', values: { title: 'Hello' } })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          should.exist(res.body._id);
          createdId = res.body._id;
          createdIds.push(createdId);
          done();
        });
    });

    it('should let the admin agent update that component default', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Update test preset', componentType: 'text', values: {} })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          createdIds.push(res.body._id);
          adminAgent
            .put('/api/content/lightcomponentdefault/' + res.body._id)
            .set('Accept', 'application/json')
            .send({ description: 'updated via admin' })
            .expect(200)
            .end(function(error2) {
              should.not.exist(error2);
              done();
            });
        });
    });

    it('should let the admin agent delete that component default', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Delete test preset', componentType: 'text', values: {} })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          var id = res.body._id;
          adminAgent
            .delete('/api/content/lightcomponentdefault/' + id)
            .expect(200)
            .end(function(error2) {
              should.not.exist(error2);
              done();
            });
        });
    });

    it('should let the Light Editor agent read component defaults', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Read test preset', componentType: 'text', values: {} })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          createdIds.push(res.body._id);
          editorAgent
            .get('/api/content/lightcomponentdefault')
            .expect(200)
            .end(function(error2, res2) {
              should.not.exist(error2);
              res2.body.should.be.an.Array();
              done();
            });
        });
    });

    /**
     * lib/contentmanager.js's generic content POST/PUT/DELETE routes only special-case
     * ContentTypeError (400, create/update) and ContentConflictError (409, update) - every other
     * error, including a denied ContentPermissionError, falls through to a flat 500 (only the
     * `/content/:type/query` GET route special-cases ContentPermissionError to 403). That's an
     * existing, framework-wide REST-layer behaviour affecting every content type's create/update/
     * delete permission denials, not something specific to lightcomponentdefault - so, matching
     * test/lib.lightcourseadmin.js's own existing permission/validation-rejection assertions,
     * these checks only assert "not a success", not a specific status code.
     */
    it('should reject the Light Editor agent creating a component default', function(done) {
      editorAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Should be rejected', componentType: 'text', values: {} })
        .end(function(error, res) {
          should.not.exist(error);
          res.statusCode.should.not.equal(200);
          res.body.success.should.be.false();
          done();
        });
    });

    it('should reject the Light Editor agent updating a component default', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Update rejection preset', componentType: 'text', values: {} })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          createdIds.push(res.body._id);
          editorAgent
            .put('/api/content/lightcomponentdefault/' + res.body._id)
            .set('Accept', 'application/json')
            .send({ description: 'should be rejected' })
            .end(function(error2, res2) {
              should.not.exist(error2);
              res2.statusCode.should.not.equal(200);
              res2.body.success.should.be.false();
              done();
            });
        });
    });

    it('should reject the Light Editor agent deleting a component default', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Delete rejection preset', componentType: 'text', values: {} })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          createdIds.push(res.body._id);
          editorAgent
            .delete('/api/content/lightcomponentdefault/' + res.body._id)
            .end(function(error2, res2) {
              should.not.exist(error2);
              res2.statusCode.should.not.equal(200);
              res2.body.success.should.be.false();
              done();
            });
        });
    });
  });

  describe('single-default-per-componentType enforcement', function() {
    it('should clear a previous default for the same componentType when a new one is created with isDefault: true', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'First default', componentType: 'graphic', values: {}, isDefault: true })
        .expect(200)
        .end(function(error, firstRes) {
          should.not.exist(error);
          var firstId = firstRes.body._id;
          createdIds.push(firstId);
          firstRes.body.isDefault.should.equal(true);

          adminAgent
            .post('/api/content/lightcomponentdefault')
            .set('Accept', 'application/json')
            .send({ name: 'Second default', componentType: 'graphic', values: {}, isDefault: true })
            .expect(200)
            .end(function(error2, secondRes) {
              should.not.exist(error2);
              var secondId = secondRes.body._id;
              createdIds.push(secondId);
              secondRes.body.isDefault.should.equal(true);

              async.parallel({
                first: function(cb) { adminAgent.get('/api/content/lightcomponentdefault/' + firstId).end(cb); },
                second: function(cb) { adminAgent.get('/api/content/lightcomponentdefault/' + secondId).end(cb); }
              }, function(error3, results) {
                should.not.exist(error3);
                results.first.body.isDefault.should.equal(false);
                results.second.body.isDefault.should.equal(true);
                done();
              });
            });
        });
    });

    it('should clear a previous default for the same componentType when an existing one is updated to isDefault: true', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Original default', componentType: 'media', values: {}, isDefault: true })
        .expect(200)
        .end(function(error, firstRes) {
          should.not.exist(error);
          var firstId = firstRes.body._id;
          createdIds.push(firstId);

          adminAgent
            .post('/api/content/lightcomponentdefault')
            .set('Accept', 'application/json')
            .send({ name: 'Soon-to-be default', componentType: 'media', values: {} })
            .expect(200)
            .end(function(error2, secondRes) {
              should.not.exist(error2);
              var secondId = secondRes.body._id;
              createdIds.push(secondId);
              secondRes.body.isDefault.should.equal(false);

              adminAgent
                .put('/api/content/lightcomponentdefault/' + secondId)
                .set('Accept', 'application/json')
                .send({ isDefault: true })
                .expect(200)
                .end(function(error3) {
                  should.not.exist(error3);

                  async.parallel({
                    first: function(cb) { adminAgent.get('/api/content/lightcomponentdefault/' + firstId).end(cb); },
                    second: function(cb) { adminAgent.get('/api/content/lightcomponentdefault/' + secondId).end(cb); }
                  }, function(error4, results) {
                    should.not.exist(error4);
                    results.first.body.isDefault.should.equal(false);
                    results.second.body.isDefault.should.equal(true);
                    done();
                  });
                });
            });
        });
    });

    it('should let different componentType values each independently have their own default', function(done) {
      adminAgent
        .post('/api/content/lightcomponentdefault')
        .set('Accept', 'application/json')
        .send({ name: 'Text default', componentType: 'text', values: {}, isDefault: true })
        .expect(200)
        .end(function(error, textRes) {
          should.not.exist(error);
          var textId = textRes.body._id;
          createdIds.push(textId);

          adminAgent
            .post('/api/content/lightcomponentdefault')
            .set('Accept', 'application/json')
            .send({ name: 'Graphic default', componentType: 'graphic', values: {}, isDefault: true })
            .expect(200)
            .end(function(error2, graphicRes) {
              should.not.exist(error2);
              var graphicId = graphicRes.body._id;
              createdIds.push(graphicId);

              async.parallel({
                text: function(cb) { adminAgent.get('/api/content/lightcomponentdefault/' + textId).end(cb); },
                graphic: function(cb) { adminAgent.get('/api/content/lightcomponentdefault/' + graphicId).end(cb); }
              }, function(error3, results) {
                should.not.exist(error3);
                results.text.body.isDefault.should.equal(true);
                results.graphic.body.isDefault.should.equal(true);
                done();
              });
            });
        });
    });
  });
});
