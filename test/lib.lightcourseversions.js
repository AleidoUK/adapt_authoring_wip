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

var editorAgent = {};
var editorUser = {};

var EDITOR_EMAIL = 'lighteditor-versions@adaptlearning.org';
var EDITOR_PASSWORD = 'lighteditorversionspassword';

var lightCourseId, lightCourseRevision;
var versionIds = [];
var tenantId;

before(function(done) {
  this.timeout(20000);
  editorAgent = request.agent(app.getServerURL());
  tenantId = app.configuration.getConfig('masterTenantID');

  async.series([
    function createEditorUser(next) {
      auth.hashPassword(EDITOR_PASSWORD, function(error, hash) {
        if (error) return next(error);
        usermanager.createUser({
          email: EDITOR_EMAIL,
          password: hash,
          auth: 'local',
          _isDeleted: false,
          _tenantId: tenantId
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
    },
    function createLightCourse(next) {
      editorAgent
        .post('/api/content/lightcourse')
        .set('Accept', 'application/json')
        .send({ title: 'Versions Test Course' })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          lightCourseId = res.body._id;
          lightCourseRevision = res.body.revision;
          next();
        });
    },
    function saveInitialContent(next) {
      editorAgent
        .put('/api/content/lightcourse/' + lightCourseId)
        .set('Accept', 'application/json')
        .send({
          revision: lightCourseRevision,
          contentTree: { children: [
            { _id: 'page-1', type: 'page', children: [
              { _id: 'article-1', type: 'article', children: [
                { _id: 'block-1', type: 'block', children: [
                  { _id: 'component-1', type: 'component', _component: 'text', title: 'Hello world', body: '' }
                ]}
              ]}
            ]}
          ]},
          glossaryItems: [{ _id: 'glossary-1', term: 'Term one', description: 'Description one' }]
        })
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          lightCourseRevision += 1;
          next();
        });
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
          function(cb) { lightCourseId ? db.destroy('lightcourseexport', { _lightCourseId: lightCourseId }, cb) : cb(); }
        ], next);
      }, tenantId);
    },
    function removeEditorUser(next) {
      editorUser._id ? usermanager.deleteUser({ _id: editorUser._id }, next) : next();
    }
  ], done);
});

it('should publish version 0.1 from the initial content (first-ever publish via a minor bump, before any major release, is 0.1 rather than 1.0)', function(done) {
  editorAgent
    .post('/api/content/lightcourse/' + lightCourseId + '/versions')
    .set('Accept', 'application/json')
    .send({ revision: lightCourseRevision, bump: 'minor' })
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      res.body.versionNumber.should.equal('0.1');
      versionIds.push(res.body._id);
      lightCourseRevision += 1;
      done();
    });
});

it('should edit the draft and publish version 0.2 with an added component and changed text', function(done) {
  editorAgent
    .put('/api/content/lightcourse/' + lightCourseId)
    .set('Accept', 'application/json')
    .send({
      revision: lightCourseRevision,
      contentTree: { children: [
        { _id: 'page-1', type: 'page', children: [
          { _id: 'article-1', type: 'article', children: [
            { _id: 'block-1', type: 'block', children: [
              { _id: 'component-1', type: 'component', _component: 'text', title: 'Hello universe', body: '' },
              { _id: 'component-2', type: 'component', _component: 'text', title: 'A new component', body: '' }
            ]}
          ]}
        ]}
      ]},
      glossaryItems: [{ _id: 'glossary-1', term: 'Term one', description: 'Description one' }]
    })
    .expect(200)
    .end(function(error, res) {
      should.not.exist(error);
      lightCourseRevision += 1;
      editorAgent
        .post('/api/content/lightcourse/' + lightCourseId + '/versions')
        .set('Accept', 'application/json')
        .send({ revision: lightCourseRevision, bump: 'minor' })
        .expect(200)
        .end(function(error2, res2) {
          should.not.exist(error2);
          res2.body.versionNumber.should.equal('0.2');
          versionIds.push(res2.body._id);
          lightCourseRevision += 1;
          done();
        });
    });
});

describe('version comparison', function() {
  it('should report an added component and a changed component text field between 1.0 and 1.1', function(done) {
    editorAgent
      .get('/api/content/lightcourse/' + lightCourseId + '/versions/compare?a=' + versionIds[0] + '&b=' + versionIds[1])
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        res.body.hasChanges.should.be.true();
        res.body.contentTree.added.should.eql(['component-2']);
        res.body.contentTree.changed.length.should.equal(1);
        res.body.contentTree.changed[0].id.should.equal('component-1');
        res.body.contentTree.deleted.should.eql([]);
        done();
      });
  });

  it('should report no differences when comparing a version against itself', function(done) {
    editorAgent
      .get('/api/content/lightcourse/' + lightCourseId + '/versions/compare?a=' + versionIds[1] + '&b=' + versionIds[1])
      .expect(200)
      .end(function(error, res) {
        should.not.exist(error);
        res.body.hasChanges.should.be.false();
        done();
      });
  });
});

describe('document import', function() {
  it('should require confirmation before importing when the draft has unsaved changes relative to the latest version', function(done) {
    // edit the draft again without publishing, so it now diverges from version 1.1
    editorAgent
      .put('/api/content/lightcourse/' + lightCourseId)
      .set('Accept', 'application/json')
      .send({
        revision: lightCourseRevision,
        contentTree: { children: [
          { _id: 'page-1', type: 'page', children: [
            { _id: 'article-1', type: 'article', children: [
              { _id: 'block-1', type: 'block', children: [
                { _id: 'component-1', type: 'component', _component: 'text', title: 'Unsaved edit', body: '' },
                { _id: 'component-2', type: 'component', _component: 'text', title: 'A new component', body: '' }
              ]}
            ]}
          ]}
        ]},
        glossaryItems: [{ _id: 'glossary-1', term: 'Term one', description: 'Description one' }]
      })
      .expect(200)
      .end(function(error) {
        should.not.exist(error);
        lightCourseRevision += 1;

        editorAgent
          .get('/document-export/' + tenantId + '/' + lightCourseId + '?format=markdown')
          .expect(200)
          .end(function(exportError, exportRes) {
            should.not.exist(exportError);
            editorAgent
              .post('/document-import/' + tenantId + '/' + lightCourseId)
              .attach('file', Buffer.from(exportRes.text), 'course.md')
              .expect(409)
              .end(function(importError, importRes) {
                should.not.exist(importError);
                importRes.body.requiresConfirmation.should.be.true();
                done();
              });
          });
      });
  });

  it('should apply an edited re-import with confirmed=true, refreshing the current open version-history row in place', function(done) {
    editorAgent
      .get('/api/content/lightcourse/' + lightCourseId)
      .expect(200)
      .end(function(beforeError, beforeRes) {
        should.not.exist(beforeError);
        var versionHistoryCountBefore = beforeRes.body.headerData.versionHistory.length;

        editorAgent
          .get('/document-export/' + tenantId + '/' + lightCourseId + '?format=markdown')
          .expect(200)
          .end(function(exportError, exportRes) {
            should.not.exist(exportError);
            var edited = exportRes.text.replace(/^Unsaved edit$/m, 'Edited via Word');
            editorAgent
              .post('/document-import/' + tenantId + '/' + lightCourseId)
              .field('confirmed', 'true')
              .attach('file', Buffer.from(edited), 'course.md')
              .expect(200)
              .end(function(importError, importRes) {
                should.not.exist(importError);
                importRes.body.success.should.be.true();

                editorAgent
                  .get('/api/content/lightcourse/' + lightCourseId)
                  .expect(200)
                  .end(function(getError, getRes) {
                    should.not.exist(getError);
                    getRes.body.contentTree.children[0].children[0].children[0].children[0].title.should.equal('Edited via Word');
                    // the document-import route's own plugin.update() call goes through the same
                    // generic update() override as every other save - which only ever refreshes
                    // the current *open* version-history row in place (words/screens/date/author),
                    // leaving the row count unchanged; only a Create Version publish ever appends
                    // a new row (per the main plan, extended on direct user request so ordinary
                    // saves - now autosaved on every change - don't flood the table with one
                    // near-duplicate row per edit).
                    getRes.body.headerData.versionHistory.length.should.equal(versionHistoryCountBefore);
                    var lastRow = getRes.body.headerData.versionHistory[getRes.body.headerData.versionHistory.length - 1];
                    lastRow.version.should.equal('0.2');
                    lastRow.screens.should.equal(2);
                    lightCourseRevision = getRes.body.revision;
                    done();
                  });
              });
          });
      });
  });

  it('should reject (with a specific error) a document missing an expected section, without applying any change', function(done) {
    editorAgent
      .get('/document-export/' + tenantId + '/' + lightCourseId + '?format=markdown')
      .expect(200)
      .end(function(exportError, exportRes) {
        should.not.exist(exportError);
        var withoutGlossary = exportRes.text.replace(/## Glossary[\s\S]*$/, '');
        editorAgent
          .post('/document-import/' + tenantId + '/' + lightCourseId)
          .field('confirmed', 'true')
          .attach('file', Buffer.from(withoutGlossary), 'course.md')
          .expect(422)
          .end(function(importError, importRes) {
            should.not.exist(importError);
            importRes.body.success.should.be.false();
            importRes.body.errors[0].should.match(/missing 1 expected section/);

            editorAgent
              .get('/api/content/lightcourse/' + lightCourseId)
              .expect(200)
              .end(function(getError, getRes) {
                should.not.exist(getError);
                getRes.body.glossaryItems.length.should.equal(1); // unaffected by the rejected import
                done();
              });
          });
      });
  });
});
