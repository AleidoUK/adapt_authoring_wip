var should = require('should');
var fs = require('fs');
var path = require('path');

var schemaWalker = require('../lib/schemaWalker');

var FIXTURES_DIR = path.join(__dirname, 'fixtures', 'lightcourse');

function loadFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, relativePath), 'utf8'));
}

var EMPTY_RESULT = {
  translatablePaths: [], assetPaths: [], requiredDefaults: {},
  requiredTranslatablePaths: [], requiredAssetPaths: []
};

it('should return empty results for a falsy or non-object schema', function() {
  schemaWalker.walkSchema(null).should.eql(EMPTY_RESULT);
  schemaWalker.walkSchema(undefined).should.eql(EMPTY_RESULT);
});

it('should walk AT\'s own draft-04 model.schema dialect (flat "translatable": true)', function() {
  var schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'content', 'component', 'model.schema'), 'utf8'));
  var result = schemaWalker.walkSchema(schema);

  result.translatablePaths.should.containDeep(['title', 'displayTitle', 'body']);
  result.assetPaths.should.eql([]);
  result.requiredDefaults.should.eql({ _component: '', title: 'New Component Title' });
  // _component is required but not translatable (a plain internal select) - title is both
  result.requiredTranslatablePaths.should.eql(['title']);
  result.requiredAssetPaths.should.eql([]);
});

it('should walk a draft-04 extension properties.schema, including nested item arrays and Asset:<type> graphic fields', function() {
  var propertiesSchema = loadFixture(path.join('adapt-aleido-help', 'properties.schema'));
  // stored componenttype/extensiontype DB shape is the file's top-level `properties` value
  var result = schemaWalker.walkSchema({ properties: propertiesSchema.properties });

  result.translatablePaths.should.eql([
    'pluginLocations.course._help._navItem.ariaLabel',
    'pluginLocations.course._help._popup.title',
    'pluginLocations.course._help._popup.body',
    'pluginLocations.course._help._popup.instruction',
    'pluginLocations.course._help._items[].title',
    'pluginLocations.course._help._items[].body',
    'pluginLocations.course._help._items[]._graphic.alt'
  ]);
  result.assetPaths.should.eql(['pluginLocations.course._help._items[]._graphic.src']);
  result.requiredDefaults.should.eql({ 'pluginLocations.course._help._navItem._icon': 'question' });
  // none of this fixture's translatable/asset fields are themselves required - only the (non-
  // translatable, non-asset) icon select is
  result.requiredTranslatablePaths.should.eql([]);
  result.requiredAssetPaths.should.eql([]);
});

it('should walk a 2020-12 $patch course-schema extension, including nested item arrays, using the "_adapt.translatable" dialect', function() {
  var schema = loadFixture(path.join('adapt-contrib-glossary', 'course.schema.json'));
  var result = schemaWalker.walkSchema(schema);

  result.translatablePaths.should.containDeep([
    '_glossary.title',
    '_glossary.description',
    '_glossary._glossaryItems[].term',
    '_glossary._glossaryItems[].description'
  ]);
  result.assetPaths.should.eql([]);
});

it('should walk a 2020-12 $patch extension using the "_backboneForms": "Asset" asset convention (no sub-type encoded)', function() {
  var schema = loadFixture(path.join('adapt-contrib-resources', 'contentobject.schema.json'));
  var result = schemaWalker.walkSchema(schema);

  result.translatablePaths.should.containDeep([
    '_resources._resourcesItems[].title',
    '_resources._resourcesItems[].description',
    '_resources._resourcesItems[].filename'
  ]);
  result.assetPaths.should.eql(['_resources._resourcesItems[]._link']);
});

it('should not flag a Select-style object inputType as an asset field', function() {
  var schema = loadFixture(path.join('adapt-contrib-resources', 'contentobject.schema.json'));
  var result = schemaWalker.walkSchema(schema);
  result.assetPaths.should.not.containEql('_resources._resourcesItems[]._type');
});

it('should only record requiredDefaults for fields that are both required and declare a default', function() {
  var schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'content', 'component', 'model.schema'), 'utf8'));
  var result = schemaWalker.walkSchema(schema);

  // _parentId/_courseId are required but have no default - must not appear
  Object.keys(result.requiredDefaults).should.not.containEql('_parentId');
  Object.keys(result.requiredDefaults).should.not.containEql('_courseId');
  // _isOptional has a default but is explicitly not required - must not appear
  Object.keys(result.requiredDefaults).should.not.containEql('_isOptional');
});

it('should collect requiredTranslatablePaths/requiredAssetPaths for fields that are both required and translatable/asset', function() {
  var schema = {
    properties: {
      title: { type: 'string', required: true, translatable: true },
      subtitle: { type: 'string', translatable: true }, // translatable but not required
      heroImage: { type: 'string', required: true, inputType: 'Asset:image' },
      icon: { type: 'string', required: true, inputType: { type: 'Select', options: ['a', 'b'] } }, // required but neither
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['graphic'],
          properties: {
            graphic: { type: 'string', inputType: 'Asset:image' },
            label: { type: 'string', translatable: true }
          }
        }
      }
    }
  };
  var result = schemaWalker.walkSchema(schema);

  result.requiredTranslatablePaths.should.eql(['title']);
  result.requiredAssetPaths.should.eql(['heroImage', 'items[].graphic']);
});
