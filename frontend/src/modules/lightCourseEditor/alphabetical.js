(function(factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else define(factory);
})(function() {
  function label(value) {
    if (value && typeof value.get === 'function') value = value.attributes;
    if (!value || typeof value !== 'object') return value == null ? '' : String(value);
    var keys = ['title', 'displayTitle', 'term', 'name', 'displayName', 'filename', 'className', 'body', '_component'];
    for (var i = 0; i < keys.length; i++) {
      if (typeof value[keys[i]] === 'string' && value[keys[i]].trim()) return value[keys[i]];
    }
    return '';
  }
  function compare(a, b) {
    a = label(a).replace(/<[^>]*>/g, '').trim();
    b = label(b).replace(/<[^>]*>/g, '').trim();
    if (!a || !b) return a ? -1 : b ? 1 : 0;
    return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  }
  return { label: label, compare: compare };
});
