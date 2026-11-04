var should = require('should');

var documentGenerator = require('../lib/lightcourse/documentGenerator');

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

function sampleData(overrides) {
  return Object.assign({
    title: 'My Course',
    versionNumber: '1.0',
    isDraft: false,
    headerData: { reviewingInstructions: 'Please check tone and clarity.' },
    contentTree: { children: [
      { _id: 'page-1', type: 'page', children: [
        { _id: 'article-1', type: 'article', children: [
          { _id: 'block-1', type: 'block', children: [
            { _id: 'comp-1', type: 'component', _component: 'text', title: 'Welcome', body: '<p>Hello <strong>world</strong>.</p>' }
          ]}
        ]}
      ]}
    ]},
    glossaryItems: [{ _id: 'g1', term: 'Adapt', description: 'A framework.' }],
    resourceItems: [{ _id: 'r1', title: 'Community Site', description: 'Visit us.' }],
    helpContent: { popup: { title: 'Need help?', body: 'Click here.', instruction: '' }, items: [{ _id: 'h1', title: 'Item one', body: 'Item body text' }] }
  }, overrides || {});
}

describe('generateMarkdown', function() {
  it('should embed an invisible lcid HTML comment directly above every content-tree/glossary/resource/help heading', function(done) {
    documentGenerator.generateMarkdown(sampleData(), stubDb({}), function(error, markdown) {
      should.not.exist(error);
      markdown.should.match(/<!-- lcid:page-1 -->\n# Page 1/);
      markdown.should.match(/<!-- lcid:article-1 -->\n## Article 1\.1/);
      markdown.should.match(/<!-- lcid:block-1 -->\n### Block 1\.1\.1/);
      markdown.should.match(/<!-- lcid:comp-1 -->\n#### text: Welcome/);
      markdown.should.match(/<!-- lcid:g1 -->\n##### Adapt/);
      markdown.should.match(/<!-- lcid:r1 -->\n##### Community Site/);
      markdown.should.match(/<!-- lcid:h1 -->\n##### Item one/);
      done();
    });
  });

  it('should include the component\'s translatable field values as body text, resolved against its real schema', function(done) {
    documentGenerator.generateMarkdown(sampleData(), stubDb({}), function(error, markdown) {
      should.not.exist(error);
      markdown.should.containEql('<p>Hello <strong>world</strong>.</p>');
      done();
    });
  });

  it('should label the document as a draft when isDraft is true, per the main plan', function(done) {
    documentGenerator.generateMarkdown(sampleData({ isDraft: true }), stubDb({}), function(error, markdown) {
      should.not.exist(error);
      markdown.should.containEql('Draft (unpublished)');
      done();
    });
  });

  it('should omit the glossary/resources/help sections entirely when their lists are empty', function(done) {
    documentGenerator.generateMarkdown(sampleData({ glossaryItems: [], resourceItems: [], helpContent: null }), stubDb({}), function(error, markdown) {
      should.not.exist(error);
      markdown.should.not.containEql('## Glossary');
      markdown.should.not.containEql('## Resources');
      markdown.should.not.containEql('## Help');
      done();
    });
  });
});

describe('generateDocx', function() {
  it('should produce a non-empty docx buffer without error', function(done) {
    documentGenerator.generateDocx(sampleData(), stubDb({}), function(error, buffer) {
      should.not.exist(error);
      Buffer.isBuffer(buffer).should.be.true();
      buffer.length.should.be.above(0);
      done();
    });
  });
});

describe('parseDocx (document round-trip)', function() {
  it('should re-extract every embedded node ID and its structural level after a .docx round-trip', function(done) {
    documentGenerator.generateDocx(sampleData(), stubDb({}), function(error, buffer) {
      should.not.exist(error);
      documentGenerator.parseDocx(buffer, function(parseError, parsed) {
        should.not.exist(parseError);
        parsed.errors.should.eql([]);
        var ids = parsed.blocks.map(function(b) { return b.id; });
        ids.should.containDeep(['page-1', 'article-1', 'block-1', 'comp-1', 'g1', 'r1', 'h1']);
        parsed.blocks.find(function(b) { return b.id === 'page-1'; }).level.should.equal(1);
        parsed.blocks.find(function(b) { return b.id === 'comp-1'; }).level.should.equal(4);
        done();
      });
    });
  });

  it('should scope each block\'s body text correctly, not leaking into/from document-furniture headings (title, section dividers)', function(done) {
    documentGenerator.generateDocx(sampleData(), stubDb({}), function(error, buffer) {
      should.not.exist(error);
      documentGenerator.parseDocx(buffer, function(parseError, parsed) {
        should.not.exist(parseError);
        var component = parsed.blocks.find(function(b) { return b.id === 'comp-1'; });
        component.body.should.containEql('Welcome');
        component.body.should.containEql('Hello world.'); // HTML stripped for docx, per stripHtmlForDocx
        component.body.should.not.containEql('Adapt'); // must not have swallowed the glossary section

        var glossaryItem = parsed.blocks.find(function(b) { return b.id === 'g1'; });
        glossaryItem.body.should.equal('A framework.');
        done();
      });
    });
  });

  it('should reject (not guess) a heading with no lcid bookmark', function(done) {
    var docx = require('docx');
    var doc = new docx.Document({ sections: [{ children: [
      new docx.Paragraph({ heading: docx.HeadingLevel.TITLE, text: 'Course' }),
      new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, text: 'Page 1 (no bookmark)' })
    ]}]});
    docx.Packer.toBuffer(doc).then(function(buffer) {
      documentGenerator.parseDocx(buffer, function(error, parsed) {
        should.not.exist(error);
        parsed.errors.length.should.equal(1);
        parsed.errors[0].should.match(/no lcid bookmark/);
        done();
      });
    });
  });

  it('should reject (not guess) a duplicated lcid bookmark', function(done) {
    var docx = require('docx');
    var doc = new docx.Document({ sections: [{ children: [
      new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [ new docx.Bookmark({ id: 'lcid_page-1', children: [new docx.TextRun('Page 1')] }) ] }),
      new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: [ new docx.Bookmark({ id: 'lcid_page-1', children: [new docx.TextRun('Article 1.1')] }) ] })
    ]}]});
    docx.Packer.toBuffer(doc).then(function(buffer) {
      documentGenerator.parseDocx(buffer, function(error, parsed) {
        should.not.exist(error);
        parsed.errors.length.should.equal(1);
        parsed.errors[0].should.match(/duplicate lcid/);
        done();
      });
    });
  });

  it('should not flag the document title or the Glossary/Resources/Help section dividers as missing an lcid', function(done) {
    documentGenerator.generateDocx(sampleData(), stubDb({}), function(error, buffer) {
      should.not.exist(error);
      documentGenerator.parseDocx(buffer, function(parseError, parsed) {
        should.not.exist(parseError);
        parsed.errors.should.eql([]);
        done();
      });
    });
  });

  it('should report an unreadable/non-docx buffer as a structural error rather than throwing', function(done) {
    documentGenerator.parseDocx(Buffer.from('not a real docx file'), function(error, parsed) {
      should.not.exist(error);
      parsed.errors.length.should.be.above(0);
      parsed.blocks.should.eql([]);
      done();
    });
  });
});

describe('parseMarkdown (document round-trip)', function() {
  it('should re-extract every embedded node ID and its structural level after a markdown round-trip', function(done) {
    documentGenerator.generateMarkdown(sampleData(), stubDb({}), function(error, markdown) {
      should.not.exist(error);
      var parsed = documentGenerator.parseMarkdown(markdown);
      parsed.errors.should.eql([]);
      var ids = parsed.blocks.map(function(b) { return b.id; });
      ids.should.containDeep(['page-1', 'article-1', 'block-1', 'comp-1', 'g1', 'r1', 'h1']);
      parsed.blocks.find(function(b) { return b.id === 'page-1'; }).level.should.equal(1);
      parsed.blocks.find(function(b) { return b.id === 'comp-1'; }).level.should.equal(4);
      done();
    });
  });

  it('should scope each block\'s body text correctly, not leaking into/from document-furniture headings (title, section dividers)', function(done) {
    documentGenerator.generateMarkdown(sampleData(), stubDb({}), function(error, markdown) {
      should.not.exist(error);
      var parsed = documentGenerator.parseMarkdown(markdown);
      var component = parsed.blocks.find(function(b) { return b.id === 'comp-1'; });
      component.body.should.containEql('Welcome');
      component.body.should.containEql('<p>Hello <strong>world</strong>.</p>');
      component.body.should.not.containEql('Adapt'); // must not have swallowed the glossary section

      var glossaryItem = parsed.blocks.find(function(b) { return b.id === 'g1'; });
      glossaryItem.body.should.equal('A framework.');
      done();
    });
  });

  it('should reject (not guess) a heading with no preceding lcid comment', function() {
    var parsed = documentGenerator.parseMarkdown('# Title\n\n# Page 1\n\nSome text');
    parsed.errors.length.should.equal(1);
    parsed.errors[0].should.match(/no preceding lcid comment/);
  });

  it('should reject (not guess) a duplicated lcid comment', function() {
    var parsed = documentGenerator.parseMarkdown('# Title\n\n<!-- lcid:page-1 -->\n# Page 1\n\n<!-- lcid:page-1 -->\n## Article 1.1');
    parsed.errors.length.should.equal(1);
    parsed.errors[0].should.match(/duplicate lcid/);
  });

  it('should not flag the document title or the Glossary/Resources/Help section dividers as missing an lcid', function(done) {
    documentGenerator.generateMarkdown(sampleData(), stubDb({}), function(error, markdown) {
      should.not.exist(error);
      documentGenerator.parseMarkdown(markdown).errors.should.eql([]);
      done();
    });
  });
});
