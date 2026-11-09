var parseDocument = require('htmlparser2').parseDocument;

var IGNORED_KEYS = ['_id', '_tenantId', '_componentPresetId', '_componentSchemaSnapshot', '_assetId'];
var SOURCES = [
  { type: 'lightcourse', fields: 'title body contentTree glossaryItems resourceItems helpContent' },
  { type: 'lightcoursetemplate', fields: 'name contentSnapshot' },
  { type: 'lightcomponentdefault', fields: 'name values' }
];

function references(value, assets, found, path) {
  function add(id, location) {
    if (!assets.has(id)) return;
    if (!found.has(id)) found.set(id, new Set());
    found.get(id).add(location);
  }
  if (typeof value === 'string') {
    if (assets.has(value)) return add(value, path);
    function walk(nodes) {
      (nodes || []).forEach(function(node) {
        if (['script', 'style'].includes(node.name)) return;
        ['src', 'poster', 'href'].forEach(function(key) {
          var source = node.attribs && node.attribs[key];
          var match = source && /(?:^|\/)api\/content\/lightcourseasset\/([a-f0-9]{24})\/(?:serve|thumb)(?:[?#].*)?$/i.exec(source);
          if (match) add(match[1], path);
        });
        walk(node.children);
      });
    }
    if (value.includes('<')) walk(parseDocument(value).children);
    else {
      var match = /^(?:\/?api\/content\/lightcourseasset\/)([a-f0-9]{24})\/(?:serve|thumb)(?:[?#].*)?$/i.exec(value);
      if (match) add(match[1], path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(function(item, index) { references(item, assets, found, path + '[' + index + ']'); });
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach(function(key) {
      if (!IGNORED_KEYS.includes(key)) references(value[key], assets, found, path ? path + '.' + key : key);
    });
  }
}

async function collect(db, tenantId) {
  var results = await Promise.all([{ type: 'lightcourseasset', fields: '_id' }].concat(SOURCES).map(function(source) {
    return new Promise(function(resolve, reject) {
      db.retrieve(source.type, { _tenantId: tenantId }, { jsonOnly: true, fields: source.fields }, function(error, records) {
        if (error) reject(error); else resolve(records);
      });
    });
  }));
  var assets = new Set(results[0].map(function(asset) { return String(asset._id); }));
  var usage = Object.create(null);
  assets.forEach(function(id) { usage[id] = { count: 0, uses: [] }; });
  SOURCES.forEach(function(source, index) {
    results[index + 1].forEach(function(record) {
      var content;
      if (source.type === 'lightcomponentdefault') content = record.values;
      else {
        var snapshot = source.type === 'lightcoursetemplate' ? record.contentSnapshot || {} : record;
        content = ['body', 'contentTree', 'glossaryItems', 'resourceItems', 'helpContent'].reduce(function(out, key) {
          out[key] = snapshot[key];
          return out;
        }, {});
      }
      var found = new Map();
      references(content, assets, found, '');
      found.forEach(function(paths, id) {
        usage[id].count += paths.size;
        usage[id].uses.push({ type: source.type, id: String(record._id),
          title: record.title || record.name || '', paths: Array.from(paths) });
      });
    });
  });
  return usage;
}

module.exports = { collect: collect };
