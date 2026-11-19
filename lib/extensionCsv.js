var helpers = require('./helpers');

var config = {
  glossary: {
    extensionAttr: '_glossary',
    itemsAttr: '_glossaryItems',
    columns: ['term', 'description'],
    requiredFields: ['term', 'description'],
    sampleRow: ['Example term', 'Example description explaining the term'],
    mapRow: function(row) {
      return { term: row.term, description: row.description };
    }
  },
  resources: {
    extensionAttr: '_resources',
    itemsAttr: '_resourcesItems',
    columns: ['title', '_type', 'description', '_link', 'filename', '_isGlobal', '_forceDownload', '_id'],
    requiredFields: ['_type'],
    sampleRow: ['Example resource', 'document', 'Example description', 'https://example.com/file.pdf', 'file.pdf', 'true', 'false', 'example-resource-1'],
    mapRow: function(row) {
      var item = {
        _type: row._type,
        title: row.title || '',
        description: row.description || '',
        _link: row._link || '',
        filename: row.filename || '',
        _isGlobal: /^(true|1|yes)$/i.test(row._isGlobal || ''),
        _forceDownload: /^(true|1|yes)$/i.test(row._forceDownload || '')
      };
      if (row._id) item._id = row._id;
      return item;
    }
  }
};

function parse(extension, content) {
  if (!Object.prototype.hasOwnProperty.call(config, extension)) {
    throw new Error('CSV import is not supported for extension: ' + extension);
  }
  var settings = config[extension];
  var rows = helpers.parseCsv(content), items = [], errors = [];
  rows.forEach(function(row, index) {
    var missing = settings.requiredFields.filter(function(field) {
      return !row[field] || !String(row[field]).trim();
    });
    if (missing.length) {
      errors.push({ row: index + 2, message: 'Missing required field(s): ' + missing.join(', ') });
    } else items.push(settings.mapRow(row));
  });
  return { items: items, errors: errors };
}

module.exports = { config: config, parse: parse };
