(function(factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else define(factory);
})(function() {
  var VALUES = ['full', 'left', 'right'];

  function effective(components) {
    var explicit = components.map(function(node) { return node._layout; });
    return components.map(function(node, index) {
      if (node._layout !== undefined) return node._layout;
      if (components.length === 1) return 'full';
      if (explicit.indexOf('left') !== -1) return 'right';
      if (explicit.indexOf('right') !== -1) return 'left';
      return index === 0 ? 'left' : 'right';
    });
  }

  function validate(components) {
    if (components.length > 2) return 'A block may contain at most two components.';
    var layouts = effective(components);
    if (layouts.some(function(value) { return VALUES.indexOf(value) === -1; })) {
      return 'Component layout must be full, left or right.';
    }
    if (layouts.length === 2 && (layouts.indexOf('full') !== -1 || layouts[0] === layouts[1])) {
      return 'A block must contain one full component or one left and one right component.';
    }
    return null;
  }

  function choices(schema) {
    var fields = Object.assign({}, schema, schema && schema.properties,
      schema && schema.properties && schema.properties.properties);
    var supported = fields._supportedLayout;
    var values = supported && (supported.enum || [supported.default]);
    if (!values || values.indexOf('both') !== -1) return VALUES.slice();
    return VALUES.filter(function(layout) {
      return values.indexOf(layout === 'full' ? 'full-width' : 'half-width') !== -1;
    });
  }

  function normalize(tree) {
    if (tree.type === 'block') {
      var layouts = effective(tree.children || []);
      (tree.children || []).forEach(function(component, index) { component._layout = layouts[index]; });
    }
    (tree.children || []).forEach(function(node) {
      normalize(node);
    });
    return tree;
  }

  return { values: VALUES, effective: effective, validate: validate, choices: choices, normalize: normalize };
});
