var async = require('async');
var fs = require('fs-extra');
var path = require('path');
var request = require('supertest');
var should = require('should');

var origin = require('../');
var auth = require('../lib/auth');
var configuration = require('../lib/configuration');
var usermanager = require('../lib/usermanager');
var rolemanager = require('../lib/rolemanager');

var testData = require('./testData.json').testUser;

var app = origin();
var adminAgent = {};
var editorAgent = {};
var editorUser = {};

var EDITOR_EMAIL = 'lighteditor-iconclasses-tests@adaptlearning.org';
var EDITOR_PASSWORD = 'lighteditoriconclassestestspassword';

// Mirrors lib/lightcourse/iconClasses.js's own getFrameworkRoot()/getIconsLessPath()/
// getFontFilePath() exactly - these tests fake out a minimal slice of an installed framework
// checkout under the real test masterTenantID's temp dir (set by test/entry.js), rather than
// requiring a real `adapt_framework` clone just to exercise the parsing/serving routes.
var FRAMEWORK_ROOT = path.join(configuration.tempDir, '000000000000000000000000', 'adapt_framework');
var ICONS_LESS_PATH = path.join(FRAMEWORK_ROOT, 'src', 'core', 'less', '_defaults', 'icons.less');
var FONT_DIR = path.join(FRAMEWORK_ROOT, 'src', 'core', 'fonts');

var FIXTURE_ICONS_LESS = [
  '.icon-alpha { &:before { content: "\\e900"; } }',
  '.icon-beta-with-circle { &:before { content: "\\e901"; .dir-rtl & { content: "\\e902"; } } }',
  '.icon-gamma { &:before { content: "\\e903"; } }'
].join('\n');

before(function(done) {
  this.timeout(20000);
  adminAgent = request.agent(app.getServerURL());
  editorAgent = request.agent(app.getServerURL());

  async.series([
    function writeFixtures(next) {
      async.series([
        function writeLess(cb) {
          fs.outputFile(ICONS_LESS_PATH, FIXTURE_ICONS_LESS, cb);
        },
        function writeWoff2(cb) {
          fs.outputFile(path.join(FONT_DIR, 'vanilla.woff2'), 'fake-woff2-bytes', cb);
        },
        function writeWoff(cb) {
          fs.outputFile(path.join(FONT_DIR, 'vanilla.woff'), 'fake-woff-bytes', cb);
        }
      ], next);
    },
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
    function removeFixtures(next) {
      fs.remove(path.join(configuration.tempDir, '000000000000000000000000', 'adapt_framework'), next);
    },
    function removeEditorUser(next) {
      editorUser._id ? usermanager.deleteUser({ _id: editorUser._id }, next) : next();
    }
  ], done);
});

describe('lightcourse icon classes', function() {
  describe('GET /api/content/lightcourse/icons/classes', function() {
    it('should let the admin agent list the parsed vanilla icon classes', function(done) {
      adminAgent
        .get('/api/content/lightcourse/icons/classes')
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          res.body.icons.forEach(function(icon) {
            icon.should.have.properties('className', 'codepoint');
          });
          var classNames = res.body.icons.map(function(icon) { return icon.className; });
          classNames.should.containEql('icon-alpha');
          classNames.should.containEql('icon-beta-with-circle');
          classNames.should.containEql('icon-gamma');

          // the RTL-override content value must never win over the rule's first content value
          var beta = res.body.icons.filter(function(icon) { return icon.className === 'icon-beta-with-circle'; })[0];
          beta.codepoint.should.equal('e901');

          res.body.fontUrls.woff2.should.equal('/api/content/lightcourse/iconfont/vanilla.woff2');
          res.body.fontUrls.woff.should.equal('/api/content/lightcourse/iconfont/vanilla.woff');
          done();
        });
    });

    it('should let the Light Editor agent list the parsed vanilla icon classes too', function(done) {
      editorAgent
        .get('/api/content/lightcourse/icons/classes')
        .expect(200)
        .end(function(error, res) {
          should.not.exist(error);
          res.body.icons.map(function(icon) { return icon.className; }).should.containEql('icon-alpha');
          done();
        });
    });
  });

  describe('GET /api/content/lightcourse/iconfont/:filename', function() {
    it('should serve the real vanilla.woff2 file with the correct content type', function(done) {
      adminAgent
        .get('/api/content/lightcourse/iconfont/vanilla.woff2')
        .expect(200)
        .expect('Content-Type', 'font/woff2')
        .buffer(true)
        .parse(function(res, callback) {
          var chunks = [];
          res.on('data', function(chunk) { chunks.push(chunk); });
          res.on('end', function() { callback(null, Buffer.concat(chunks)); });
        })
        .end(function(error, res) {
          should.not.exist(error);
          res.body.toString().should.equal('fake-woff2-bytes');
          done();
        });
    });

    it('should serve the real vanilla.woff file with the correct content type', function(done) {
      adminAgent
        .get('/api/content/lightcourse/iconfont/vanilla.woff')
        .expect(200)
        .expect('Content-Type', 'font/woff')
        .end(done);
    });

    it('should reject a filename that is not one of the two known font files', function(done) {
      adminAgent
        .get('/api/content/lightcourse/iconfont/not-a-real-font.woff2')
        .expect(404, done);
    });
  });
});
