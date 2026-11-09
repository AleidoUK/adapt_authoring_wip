var should = require('should');

var validation = require('../lib/lightcourse/validation');
var idRegeneration = require('../lib/lightcourse/idRegeneration');
var componentLayout = require('../frontend/src/modules/lightCourseEditor/componentLayout');

function validPage(id) {
  return {
    _id: id || 'page-1',
    type: 'page',
    children: [
      { _id: 'article-1', type: 'article', children: [
        { _id: 'block-1', type: 'block', children: [
          { _id: 'component-1', type: 'component' },
          { _id: 'component-2', type: 'component' }
        ]}
      ]}
    ]
  };
}

it('should treat an empty/missing contentTree as valid (a brand new draft)', function() {
  should(validation.validate({})).be.null();
  should(validation.validate({ contentTree: null })).be.null();
});

it('should accept a well-formed multi-page contentTree (root is a { children: [] } container, not a node)', function() {
  var contentTree = { children: [ validPage('page-1'), validPage('page-2') ] };
  should(validation.validate({ contentTree: contentTree })).be.null();
});

it('should reject a contentTree root without a children array', function() {
  var error = validation.validate({ contentTree: { notChildren: [] } });
  error.should.match(/children/);
});

it('should reject a root child that is not a page', function() {
  var contentTree = { children: [ { _id: 'a1', type: 'article', children: [] } ] };
  var error = validation.validate({ contentTree: contentTree });
  error.should.match(/"page"/);
});

it('should reject a block with more than two components', function() {
  var page = validPage();
  page.children[0].children[0].children.push({ _id: 'component-3', type: 'component' });
  var error = validation.validate({ contentTree: { children: [ page ] } });
  error.should.match(/at most two/);
});

it('should reject a component node with children', function() {
  var page = validPage();
  page.children[0].children[0].children[0].children = [{ _id: 'x', type: 'component' }];
  var error = validation.validate({ contentTree: { children: [ page ] } });
  error.should.match(/cannot have children/);
});

describe('idRegeneration', function() {
  it('should regenerate IDs on every page/article/block/component node but not on the root container itself', function() {
    var contentTree = { children: [ validPage('page-1') ] };
    var snapshot = idRegeneration.regenerateSnapshotIds({ contentTree: contentTree });

    should(snapshot.contentTree._id).be.undefined(); // root container has no _id of its own
    snapshot.contentTree.children[0]._id.should.not.equal('page-1');
    snapshot.contentTree.children[0].children[0]._id.should.not.equal('article-1');

    // the regenerated tree must still be valid against the hierarchy rules
    should(validation.validate({ contentTree: snapshot.contentTree })).be.null();
  });

  it('should regenerate glossary/resource item IDs independently of each other', function() {
    var snapshot = idRegeneration.regenerateSnapshotIds({
      glossaryItems: [{ _id: 'g1', term: 'a' }],
      resourceItems: [{ _id: 'r1', title: 'b' }]
    });
    snapshot.glossaryItems[0]._id.should.not.equal('g1');
    snapshot.resourceItems[0]._id.should.not.equal('r1');
    snapshot.glossaryItems[0]._id.should.not.equal(snapshot.resourceItems[0]._id);
  });
});

describe('icon choices', function() {
  it('should accept a valid icon for a control', function() {
    should(validation.validateIconChoices({ menuButton: 'home' })).be.null();
  });

  describe('light-course component layouts', function() {
    [
      [], ['full'], ['left'], ['right'], ['left', 'right'], ['right', 'left'], [undefined], [undefined, undefined],
      [undefined, 'left'], ['right', undefined]
    ].forEach(function(layouts) {
      it('accepts ' + JSON.stringify(layouts) + ' and preserves legacy layouts without changing stored nodes', function() {
        var page = validPage();
        page.children[0].children[0].children = layouts.map(function(layout, index) {
          return { _id: 'component-' + index, type: 'component', _layout: layout };
        });
        var tree = { children: [page] }, before = JSON.stringify(tree);
        should(validation.validate({ contentTree: tree })).be.null();
        JSON.stringify(tree).should.equal(before);
      });
    });
    [['full', 'left'], ['full', 'full'], ['left', 'left'], ['right', 'right'], ['full', undefined], ['invalid'], [null]]
      .forEach(function(layouts) {
        it('rejects invalid layout combinations ' + JSON.stringify(layouts), function() {
          var page = validPage();
          page.children[0].children[0].children = layouts.map(function(layout, index) {
            return { _id: 'component-' + index, type: 'component', _layout: layout };
          });
          validation.validate({ contentTree: { children: [page] } }).should.match(/layout|full component/);
        });
      });
    it('resolves legacy pairs consistently, including a copied block at the root of a subtree', function() {
      var block = { type: 'block', children: [{ _id: 'first', type: 'component' }, { _id: 'second', type: 'component' }] };
      componentLayout.normalize(block);
      block.children.map(function(node) { return node._layout; }).should.eql(['left', 'right']);
      block.children.map(function(node) { return node._id; }).should.eql(['first', 'second']);
    });
    it('honours full-width, half-width and both layout support in flat and wrapped installed schemas', function() {
      componentLayout.choices({ _supportedLayout: { enum: ['full-width'] } }).should.eql(['full']);
      componentLayout.choices({ _supportedLayout: { enum: ['half-width'] }, properties: { type: 'object', properties: {} } })
        .should.eql(['left', 'right']);
      componentLayout.choices({ properties: { _supportedLayout: { enum: ['half-width'] } } }).should.eql(['left', 'right']);
      componentLayout.choices({ properties: { properties: { _supportedLayout: { default: 'both' } } } }).should.eql(['full', 'left', 'right']);
      componentLayout.choices({}).should.eql(['full', 'left', 'right']);
    });
  });

  it('should reject an unsupported icon value with a specific error naming the control and valid options', function() {
    var error = validation.validateIconChoices({ menuButton: 'not-a-real-icon' });
    error.should.match(/menuButton/);
    error.should.match(/not-a-real-icon/);
  });

  it('should treat null/empty-string/undefined icon choices the same as an omitted key - "not yet chosen", not invalid', function() {
    should(validation.validateIconChoices({ menuButton: null })).be.null();
    should(validation.validateIconChoices({ menuButton: '' })).be.null();
    should(validation.validateIconChoices({ menuButton: undefined })).be.null();
  });

  it('should treat a missing/empty iconChoices object as valid (nothing chosen yet)', function() {
    should(validation.validateIconChoices(undefined)).be.null();
    should(validation.validateIconChoices({})).be.null();
  });
});
