var should = require('should');

var versionDiff = require('../lib/lightcourse/versionDiff');

// a stub db - versionDiff only ever calls db.retrieve('componenttype', { component: ... }) via
// lib/lightcoursewordcount.js#resolveComponentSchema, same convention as
// test/lib.lightcoursewordcount.js's computeWordCount stub.
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

var TEXT_COMPONENT_TYPE = { component: 'text', properties: {} };

function page(children) {
  return { _id: 'page-1', type: 'page', children: children };
}

function baseTree() {
  return { children: [
    page([
      { _id: 'a1', type: 'article', children: [
        { _id: 'b1', type: 'block', children: [
          { _id: 'c1', type: 'component', _component: 'text', title: 'Hello world', body: '<p>Unchanged</p>' },
          { _id: 'c2', type: 'component', _component: 'text', title: 'Second component', body: '' }
        ]}
      ]}
    ])
  ]};
}

describe('diffContentTree', function() {
  it('should report no differences between two identical trees', function(done) {
    versionDiff.diffContentTree(baseTree(), baseTree(), stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.should.eql({ added: [], deleted: [], moved: [], changed: [] });
      done();
    });
  });

  it('should report a node only present in the second tree as added', function(done) {
    var treeB = baseTree();
    treeB.children[0].children[0].children[0].children.push({ _id: 'c3', type: 'component', _component: 'text', title: 'New', body: '' });
    versionDiff.diffContentTree(baseTree(), treeB, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.added.should.eql(['c3']);
      result.deleted.should.eql([]);
      done();
    });
  });

  it('should report a node only present in the first tree as deleted', function(done) {
    var treeB = baseTree();
    treeB.children[0].children[0].children[0].children.pop(); // remove c2
    versionDiff.diffContentTree(baseTree(), treeB, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.deleted.should.eql(['c2']);
      result.added.should.eql([]);
      done();
    });
  });

  it('should report a node present in both but at a different position as moved', function(done) {
    var treeB = baseTree();
    var block = treeB.children[0].children[0].children[0];
    block.children.reverse(); // c1/c2 -> c2/c1
    versionDiff.diffContentTree(baseTree(), treeB, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      var movedIds = result.moved.map(function(m) { return m.id; }).sort();
      movedIds.should.eql(['c1', 'c2']);
      done();
    });
  });

  it('should report a component whose translatable field text changed', function(done) {
    var treeB = baseTree();
    treeB.children[0].children[0].children[0].children[0].title = 'Hello universe';
    versionDiff.diffContentTree(baseTree(), treeB, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.changed.length.should.equal(1);
      result.changed[0].id.should.equal('c1');
      result.changed[0].fieldChanges[0].from.should.equal('Hello world');
      result.changed[0].fieldChanges[0].to.should.equal('Hello universe');
      done();
    });
  });

  it('should not flag a structural (non-component) node as changed, even if unrelated attributes differ', function(done) {
    var treeB = baseTree();
    treeB.children[0].children[0].someExtraAttribute = 'ignored'; // articles carry no translatable fields
    versionDiff.diffContentTree(baseTree(), treeB, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.changed.should.eql([]);
      done();
    });
  });
});

describe('diffFixedItems (glossary/resources)', function() {
  it('should detect added, deleted and changed items by stable _id', function() {
    var a = [{ _id: 'g1', term: 'Adapt', description: 'A framework.' }, { _id: 'g2', term: 'Removed', description: '...' }];
    var b = [{ _id: 'g1', term: 'Adapt', description: 'An e-learning framework.' }, { _id: 'g3', term: 'New term', description: '...' }];
    var result = versionDiff.diffFixedItems(a, b, ['term', 'description']);
    result.added.should.eql(['g3']);
    result.deleted.should.eql(['g2']);
    result.changed.length.should.equal(1);
    result.changed[0].id.should.equal('g1');
    result.changed[0].fieldChanges[0].path.should.equal('description');
  });
});

describe('diffHelpContent', function() {
  it('should diff the popup (as a synthetic "help-popup" item) and the items list together', function() {
    var a = { popup: { title: 'Need help?', body: 'Click here.' }, items: [{ _id: 'h1', title: 'Item one', body: 'Body one' }] };
    var b = { popup: { title: 'Need help?', body: 'Click the icon.' }, items: [{ _id: 'h1', title: 'Item one', body: 'Body one' }] };
    var result = versionDiff.diffHelpContent(a, b);
    result.changed.length.should.equal(1);
    result.changed[0].id.should.equal('help-popup');
  });
});

describe('diffPluginSelections', function() {
  it('should flag menu/theme/extensions changes independently', function() {
    var a = { menu: 'menu-a', theme: 'theme-a', extensions: ['ext-1'] };
    var b = { menu: 'menu-b', theme: 'theme-a', extensions: ['ext-1', 'ext-2'] };
    versionDiff.diffPluginSelections(a, b).should.eql({ menu: true, theme: false, extensions: true });
  });

  it('should not be sensitive to extensions array order', function() {
    var a = { extensions: ['ext-1', 'ext-2'] };
    var b = { extensions: ['ext-2', 'ext-1'] };
    versionDiff.diffPluginSelections(a, b).extensions.should.be.false();
  });
});

describe('diffSnapshots', function() {
  it('should combine contentTree/glossary/resource/help/pluginSelections diffs with a hasChanges flag', function(done) {
    var snapshotA = { contentTree: baseTree(), pluginSelections: { menu: 'menu-a' }, glossaryItems: [], resourceItems: [], helpContent: {} };
    var snapshotB = JSON.parse(JSON.stringify(snapshotA));
    versionDiff.diffSnapshots(snapshotA, snapshotB, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.hasChanges.should.be.false();
      done();
    });
  });

  it('should set hasChanges to true when only a plugin selection differs', function(done) {
    var snapshotA = { contentTree: baseTree(), pluginSelections: { menu: 'menu-a' }, glossaryItems: [], resourceItems: [], helpContent: {} };
    var snapshotB = JSON.parse(JSON.stringify(snapshotA));
    snapshotB.pluginSelections.menu = 'menu-b';
    versionDiff.diffSnapshots(snapshotA, snapshotB, stubDb({ text: TEXT_COMPONENT_TYPE }), function(error, result) {
      should.not.exist(error);
      result.hasChanges.should.be.true();
      result.pluginSelectionsChanged.menu.should.be.true();
      done();
    });
  });
});
