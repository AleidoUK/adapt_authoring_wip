// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  /**
   * Shared icon-glyph rendering for the vanilla framework's own built-in icon font
   * (lib/lightcourse/iconClasses.js) - factored out of lightCourseIconPickerView.js (which still
   * uses it) so any other view can show a live glyph preview next to an icon-class picker/select
   * without duplicating the font-face injection, per direct request for the Light Course Config
   * admin screen's Menu/Reflection/Help icon defaults.
   *
   * Usage: call ensureReady(callback) once per view before rendering any glyph; callback
   * receives the icon data (or null on failure). Apply the returned/cached `GLYPH_CLASS` plus
   * the icon's own `icon-xxx` class to an element to render the glyph.
   */
  var FONT_STYLE_ELEMENT_ID = 'light-course-icon-glyph-font-face';
  var GLYPH_CLASS = 'light-course-icon-glyph';

  // Fetched once per page load (241+ classes, static for the lifetime of the installed framework
  // checkout - see lib/lightcourse/iconClasses.js's own in-memory server-side cache), shared
  // across every consumer rather than re-fetched per view instance.
  var cachedIconData = null;

  function ensureFontFaceInjected() {
    if (document.getElementById(FONT_STYLE_ELEMENT_ID) || !cachedIconData) {
      return;
    }
    var fontUrls = cachedIconData.fontUrls;
    var rules = cachedIconData.icons.map(function(icon) {
      return '.' + GLYPH_CLASS + '.' + icon.className + ':before { content: "\\' + icon.codepoint + '"; }';
    }).join('\n');
    var css = '@font-face {' +
      ' font-family: "light-course-vanilla-icons";' +
      ' src: url("' + fontUrls.woff2 + '") format("woff2"), url("' + fontUrls.woff + '") format("woff");' +
      ' font-weight: normal; font-style: normal; font-display: block; }\n' +
      '.' + GLYPH_CLASS + ' {' +
      ' font-family: "light-course-vanilla-icons"; font-style: normal; speak: none; }\n' + rules;
    $('<style>').attr('id', FONT_STYLE_ELEMENT_ID).text(css).appendTo('head');
  }

  /**
   * @param {function} callback - function(iconData|null), iconData: { icons: [{className,
   *   codepoint}], fontUrls: {woff, woff2} }
   */
  function ensureReady(callback) {
    if (cachedIconData) {
      return callback(cachedIconData);
    }
    $.get('api/content/lightcourse/icons/classes').done(function(response) {
      cachedIconData = response;
      ensureFontFaceInjected();
      callback(cachedIconData);
    }).fail(function() {
      callback(null);
    });
  }

  return { ensureReady: ensureReady, GLYPH_CLASS: GLYPH_CLASS };
});
