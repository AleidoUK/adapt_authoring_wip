var should = require('should');
var fs = require('fs');
var path = require('path');

var wordcount = require('../lib/lightcoursewordcount');

var FIXTURES_DIR = path.join(__dirname, 'fixtures', 'lightcourse');

function loadFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, relativePath), 'utf8'));
}

describe('countWords', function() {
  it('should count plain text', function() {
    wordcount.countWords('Hello world').should.equal(2);
  });

  it('should strip HTML markup from rich text without merging adjacent words', function() {
    wordcount.countWords('<p>Hello <strong>world</strong>, this is <a href="#">a link</a>.</p>').should.equal(6);
  });

  it('should treat block-level tags as word boundaries', function() {
    wordcount.countWords('<p>First paragraph</p><p>Second paragraph</p>').should.equal(4);
  });

  it('should decode common HTML entities before counting', function() {
    wordcount.countWords('Tom &amp; Jerry &nbsp; are friends').should.equal(5);
  });

  it('should count list items correctly', function() {
    wordcount.countWords('<ul><li>one</li><li>two</li><li>three</li></ul>').should.equal(3);
  });

  it('should return 0 for empty or whitespace/markup-only text', function() {
    wordcount.countWords('').should.equal(0);
    wordcount.countWords('   <p></p>  ').should.equal(0);
    wordcount.countWords(null).should.equal(0);
    wordcount.countWords(undefined).should.equal(0);
  });

  it('should count a non-English/multilingual fixture using the same whitespace-split rule', function() {
    // French (space-separated, like English) - straightforward word count
    wordcount.countWords('Bonjour le monde, ça va?').should.equal(5);
    // Known limitation of the agreed "split on whitespace" rule: space-free languages (e.g.
    // Japanese) count as a single "word" - this is the agreed rule's documented behaviour, not a
    // bug, since no word-segmentation requirement was specified for CJK text.
    wordcount.countWords('こんにちは世界').should.equal(1);
  });
});

describe('walkTranslatableFields', function() {
  it('should walk a component\'s common fields (draft-04 dialect), excluding non-translatable settings fields', function() {
    var componentSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'content', 'component', 'model.schema'), 'utf8'));
    var data = {
      title: 'Welcome Title',
      displayTitle: 'Welcome',
      body: '<p>This is the <strong>body</strong> text.</p>',
      _classes: 'not-translatable-should-be-ignored',
      _isOptional: true
    };
    var fields = wordcount.walkTranslatableFields(componentSchema, data);
    fields.should.containDeep([
      { path: 'title', text: 'Welcome Title' },
      { path: 'displayTitle', text: 'Welcome' },
      { path: 'body', text: '<p>This is the <strong>body</strong> text.</p>' }
    ]);
    fields.length.should.equal(3);
  });

  it('should walk nested item arrays with asset sub-fields (adapt-aleido-help fixture)', function() {
    var propertiesSchema = loadFixture(path.join('adapt-aleido-help', 'properties.schema'));
    var schema = { properties: propertiesSchema.properties.pluginLocations.properties.course.properties._help.properties._items };
    var data = [
      { _classes: '', title: 'Item one', body: 'Body one', _icon: '', _graphic: { src: 'a.png', alt: 'alt text' } }
    ];
    var fields = wordcount.walkTranslatableFields({ properties: { _items: schema.properties } }, { _items: data });
    fields.should.containDeep([
      { path: '_items[0].title', text: 'Item one' },
      { path: '_items[0].body', text: 'Body one' },
      { path: '_items[0]._graphic.alt', text: 'alt text' }
    ]);
  });

  it('should walk a 2020-12 $patch dialect schema (adapt-contrib-glossary fixture), including array items', function() {
    var schema = loadFixture(path.join('adapt-contrib-glossary', 'course.schema.json'));
    var data = loadFixture(path.join('adapt-contrib-glossary', 'example.data.json'));
    var fields = wordcount.walkTranslatableFields(schema, data);
    fields.should.containDeep([
      { path: '_glossary.title', text: 'Glossary' },
      { path: '_glossary._glossaryItems[0].term', text: 'Adapt Framework' },
      { path: '_glossary._glossaryItems[3].term', text: 'Open source' }
    ]);
    fields.length.should.equal(15); // 7 top-level translatable strings + 4 glossary items x 2 fields (term, description)
  });

  it('should return an empty array for missing/undefined data', function() {
    wordcount.walkTranslatableFields({ properties: { title: { type: 'string', translatable: true } } }, undefined).should.eql([]);
    wordcount.walkTranslatableFields(null, { title: 'x' }).should.eql([]);
  });
});

describe('computeWordCount', function() {
  // a stub db - computeWordCount only ever calls db.retrieve('componenttype', { component: ... })
  function stubDb(componentTypesByName) {
    return {
      retrieve: function(collection, search, options, callback) {
        if ('function' === typeof options) {
          callback = options;
        }
        var match = componentTypesByName[search.component];
        callback(null, match ? [match] : []);
      }
    };
  }

  var TEXT_COMPONENT_TYPE = {
    component: 'text',
    properties: {} // common fields (title/displayTitle/body) already cover plain text components
  };

  function page(children) {
    return { _id: 'page-1', type: 'page', children: children };
  }

  it('should count screens as the number of component nodes in the contentTree', function(done) {
    var contentTree = { children: [
      page([
        { _id: 'a1', type: 'article', children: [
          { _id: 'b1', type: 'block', children: [
            { _id: 'c1', type: 'component', _component: 'text', title: 'One', body: '' },
            { _id: 'c2', type: 'component', _component: 'text', title: 'Two', body: '' }
          ]}
        ]}
      ])
    ]};
    wordcount.computeWordCount({ contentTree: contentTree }, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.screens.should.equal(2);
      done();
    });
  });

  it('should sum component word counts into componentWords and total', function(done) {
    var contentTree = { children: [
      page([
        { _id: 'a1', type: 'article', children: [
          { _id: 'b1', type: 'block', children: [
            { _id: 'c1', type: 'component', _component: 'text', title: 'Hello world', body: '<p>Three more words</p>' }
          ]}
        ]}
      ])
    ]};
    wordcount.computeWordCount({ contentTree: contentTree }, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.componentWords.should.equal(5); // "Hello world" (2) + "Three more words" (3)
      result.total.should.equal(5);
      result.components.should.eql([{ _id: 'c1', _component: 'text', words: 5 }]);
      done();
    });
  });

  it('should include glossary/resource/help-content words in the total but not the component screens', function(done) {
    wordcount.computeWordCount({
      contentTree: { children: [] },
      glossaryItems: [{ _id: 'g1', term: 'Term one', description: 'A description' }],
      resourceItems: [{ _id: 'r1', title: 'Resource title', description: 'Another description' }],
      helpContent: { popup: { title: 'Help', body: 'Popup body text', instruction: '' }, items: [{ title: 'Item', body: 'Item body text' }] }
    }, stubDb({}), function(error, result) {
      should.not.exist(error);
      result.screens.should.equal(0);
      result.glossaryWords.should.equal(4); // "Term one" (2) + "A description" (2)
      result.resourceWords.should.equal(4); // "Resource title" (2) + "Another description" (2)
      result.helpWords.should.be.above(0);
      result.total.should.equal(result.componentWords + result.glossaryWords + result.resourceWords + result.helpWords);
      done();
    });
  });

  it('should not count Graphics Notes/Developer Notes or header-data fields (excluded by design, not schema-driven)', function(done) {
    var contentTree = { children: [
      page([
        { _id: 'a1', type: 'article', children: [
          { _id: 'b1', type: 'block', children: [
            {
              _id: 'c1', type: 'component', _component: 'text', title: 'Real content',
              graphicsNotes: 'This should never be counted as a word',
              developerNotes: 'Neither should this'
            }
          ]}
        ]}
      ])
    ]};
    wordcount.computeWordCount({ contentTree: contentTree, headerData: { reviewingInstructions: 'Also never counted' } },
      stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.componentWords.should.equal(2); // only "Real content"
      done();
    });
  });

  it('should cache a component type lookup across multiple nodes using the same component', function(done) {
    var retrieveCalls = 0;
    var db = {
      retrieve: function(collection, search, options, callback) {
        if ('function' === typeof options) {
          callback = options;
        }
        retrieveCalls++;
        callback(null, [TEXT_COMPONENT_TYPE]);
      }
    };
    var contentTree = { children: [
      page([
        { _id: 'a1', type: 'article', children: [
          { _id: 'b1', type: 'block', children: [
            { _id: 'c1', type: 'component', _component: 'text', title: 'One' },
            { _id: 'c2', type: 'component', _component: 'text', title: 'Two' }
          ]}
        ]}
      ])
    ]};
    wordcount.computeWordCount({ contentTree: contentTree }, db, function(error) {
      should.not.exist(error);
      retrieveCalls.should.equal(1); // same component name looked up only once, not per-node
      done();
    });
  });
});
