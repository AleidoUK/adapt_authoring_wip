var wordcount = require('../lightcoursewordcount');

function plainText(value) {
  return String(value == null ? '' : value)
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, function(match, code) {
      var number = code.charAt(0).toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return number <= 0x10ffff ? String.fromCodePoint(number) : match;
    })
    .replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

function field(path, text, richText) {
  return { path: path, text: text, richText: !!richText || /<\/?[a-z][^>]*>/i.test(text || '') };
}

function reviewFields(fields, node) {
  ['uniqueId', 'graphicsNotes', 'developerNotes'].forEach(function(path) {
    if (!fields.some(function(item) { return item.path === path; })) {
      fields.push(field(path, node[path] || '', path !== 'uniqueId'));
    }
  });
  return fields.filter(function(item) { return item.path === 'uniqueId'; })
    .concat(fields.filter(function(item) { return item.path !== 'uniqueId'; }));
}

function componentFields(schema, node, options) {
  var properties = Object.assign({}, schema.properties,
    schema.properties && schema.properties.properties && schema.properties.properties.properties);
  delete properties.properties;
  var fields = wordcount.walkTranslatableFields({ properties: properties }, node, { includeEmpty: true }).map(function(item) {
    return field(item.path, item.text, /(?:^|\.)(?:body|instruction)$/.test(item.path));
  });
  ['uniqueId', 'graphicsNotes', 'developerNotes'].forEach(function(path) {
    if (typeof node[path] === 'string' && !fields.some(function(item) { return item.path === path; })) {
      fields.push(field(path, node[path], path !== 'uniqueId'));
    }
  });
  return options && options.reviewLayout ? reviewFields(fields, node) : fields;
}

function fixedFields(item, titlePath, bodyPath) {
  var fields = [field(titlePath, item[titlePath] || '', false), field(bodyPath, item[bodyPath] || '', false)];
  if (typeof item.instruction === 'string') fields.push(field('instruction', item.instruction, true));
  return fields;
}

function courseFields(data) {
  return ['title', 'body'].filter(function(path) { return typeof data[path] === 'string'; })
    .map(function(path) { return field(path, data[path], path === 'body'); });
}

function structuralFields(node, options) {
  var fields = ['title', 'body', 'instruction', 'uniqueId', 'graphicsNotes', 'developerNotes']
    .filter(function(path) { return path === 'title' || typeof node[path] === 'string'; })
    .map(function(path) { return field(path, node[path] || '', ['body', 'instruction'].indexOf(path) !== -1); });
  return options && options.reviewLayout ? reviewFields(fields, node) : fields;
}

function importedValue(item, text, html) {
  if (typeof html !== 'string' && plainText(item.text) === text) return item.text;
  if (!item.richText) return text;
  if (typeof html === 'string') return html;
  return text ? '<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '</p><p>') + '</p>' : '';
}

module.exports = {
  plainText: plainText, componentFields: componentFields, fixedFields: fixedFields,
  courseFields: courseFields, structuralFields: structuralFields, field: field, importedValue: importedValue
};
