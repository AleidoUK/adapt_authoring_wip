var should = require('should');

var documentGenerator = require('../lib/lightcourse/documentGenerator');
var documentImport = require('../lib/lightcourse/documentImport');

function stubDb(componentTypesByName) {
  return {
    retrieve: function (collection, search, options, callback) {
      if ('function' === typeof options) {
        callback = options;
      }
      var match = componentTypesByName[search.component];
      callback(null, match ? [match] : []);
    }
  };
}

var TEXT_COMPONENT_TYPE = { component: 'text', properties: {} };

function sampleSnapshot() {
  return {
    contentTree: { children: [
      { _id: 'page-1', type: 'page', children: [
        { _id: 'article-1', type: 'article', children: [
          { _id: 'block-1', type: 'block', children: [
            { _id: 'comp-1', type: 'component', _component: 'text', title: 'Welcome', body: 'Hello world.' }
          ]}
        ]}
      ]}
    ]},
    glossaryItems: [{ _id: 'g1', term: 'Adapt', description: 'A framework.' }],
    resourceItems: [{ _id: 'r1', title: 'Community Site', description: 'Visit us.' }],
    helpContent: { popup: { title: 'Need help?', body: 'Click here.', instruction: '' }, items: [{ _id: 'h1', title: 'Item one', body: 'Item body text' }] }
  };
}

describe('documentImport (Markdown round-trip)', function() {
  it('should re-apply an unmodified exported document back onto the snapshot with no changes and no errors', function(done) {
    var snapshot = sampleSnapshot();
    documentGenerator.generateMarkdown(snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, markdown) {
      should.not.exist(error);
      var parsed = documentGenerator.parseMarkdown(markdown);
      documentImport.importDocument(parsed, snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(importError, result) {
        should.not.exist(importError);
        result.success.should.be.true();
        snapshot.contentTree.children[0].children[0].children[0].children[0].title.should.equal('Welcome');
        snapshot.glossaryItems[0].term.should.equal('Adapt');
        done();
      });
    });
  });

  it('should apply an edited component field value back onto the matching schema field', function(done) {
    var snapshot = sampleSnapshot();
    documentGenerator.generateMarkdown(snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, markdown) {
      should.not.exist(error);
      // target the standalone body line ("Welcome"), not the cosmetic heading ("#### text: Welcome")
      var editedMarkdown = markdown.replace(/^Welcome$/m, 'Welcome, everyone');
      var parsed = documentGenerator.parseMarkdown(editedMarkdown);
      documentImport.importDocument(parsed, snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(importError, result) {
        should.not.exist(importError);
        result.success.should.be.true();
        snapshot.contentTree.children[0].children[0].children[0].children[0].title.should.equal('Welcome, everyone');
        snapshot.contentTree.children[0].children[0].children[0].children[0].body.should.equal('Hello world.'); // untouched field unaffected
        done();
      });
    });
  });

  it('should apply edited glossary/resource/help item text', function(done) {
    var snapshot = sampleSnapshot();
    documentGenerator.generateMarkdown(snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, markdown) {
      should.not.exist(error);
      var editedMarkdown = markdown.replace('A framework.', 'A powerful e-learning framework.');
      var parsed = documentGenerator.parseMarkdown(editedMarkdown);
      documentImport.importDocument(parsed, snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(importError, result) {
        should.not.exist(importError);
        result.success.should.be.true();
        snapshot.glossaryItems[0].description.should.equal('A powerful e-learning framework.');
        done();
      });
    });
  });

  it('should reject (not partially apply) a document missing an expected section', function(done) {
    var snapshot = sampleSnapshot();
    documentGenerator.generateMarkdown(snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, markdown) {
      should.not.exist(error);
      // delete the glossary section entirely (including its lcid comment/heading/body)
      var withoutGlossary = markdown.replace(/## Glossary[\s\S]*?(?=## Resources)/, '');
      var parsed = documentGenerator.parseMarkdown(withoutGlossary);
      documentImport.importDocument(parsed, snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(importError, result) {
        should.not.exist(importError);
        result.success.should.be.false();
        result.errors.length.should.equal(1);
        result.errors[0].should.match(/missing 1 expected section/);
        // the draft's original content must be untouched - validation runs before any apply
        snapshot.contentTree.children[0].children[0].children[0].children[0].title.should.equal('Welcome');
        done();
      });
    });
  });

  it('should reject a document whose sections have been reordered', function(done) {
    var snapshot = sampleSnapshot();
    documentGenerator.generateMarkdown(snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, markdown) {
      should.not.exist(error);
      // swap the glossary and resources sections' order
      var glossarySection = markdown.match(/## Glossary[\s\S]*?(?=## Resources)/)[0];
      var resourcesSection = markdown.match(/## Resources[\s\S]*?(?=## Help)/)[0];
      var reordered = markdown.replace(glossarySection + resourcesSection, resourcesSection + glossarySection);
      var parsed = documentGenerator.parseMarkdown(reordered);
      documentImport.importDocument(parsed, snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(importError, result) {
        should.not.exist(importError);
        result.success.should.be.false();
        result.errors[0].should.match(/reordered/);
        done();
      });
    });
  });

  it('should reject a component whose paragraph count changed, without applying any other component\'s changes', function(done) {
    var snapshot = sampleSnapshot();
    snapshot.contentTree.children[0].children[0].children[0].children.push(
      { _id: 'comp-2', type: 'component', _component: 'text', title: 'Second', body: 'Second body' }
    );
    documentGenerator.generateMarkdown(snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, markdown) {
      should.not.exist(error);
      // add an extra paragraph inside comp-1's body (a structural edit within a component - not supported)
      var edited = markdown.replace('Welcome\n\nHello world.', 'Welcome\n\nHello world.\n\nAn extra new paragraph');
      // also edit comp-2's title, which should NOT be applied since the whole import fails validation-before-apply
      edited = edited.replace('Second', 'Second (edited)');
      var parsed = documentGenerator.parseMarkdown(edited);
      documentImport.importDocument(parsed, snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(importError, result) {
        should.not.exist(importError);
        result.success.should.be.false();
        result.errors.length.should.equal(1);
        result.errors[0].should.match(/comp-1/);
        result.errors[0].should.match(/expected 2 line\(s\) of text but found 3/);
        snapshot.contentTree.children[0].children[0].children[0].children[1].title.should.equal('Second'); // untouched
        done();
      });
    });
  });
});

describe('documentImport (.docx round-trip)', function() {
  it('should re-apply an unmodified exported .docx back onto the snapshot with no changes and no errors', function(done) {
    var snapshot = sampleSnapshot();
    documentGenerator.generateDocx(snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, buffer) {
      should.not.exist(error);
      documentGenerator.parseDocx(buffer, function(parseError, parsed) {
        should.not.exist(parseError);
        documentImport.importDocument(parsed, snapshot, stubDb({ text: TEXT_COMPONENT_TYPE }), function(importError, result) {
          should.not.exist(importError);
          result.success.should.be.true();
          done();
        });
      });
    });
  });
});
