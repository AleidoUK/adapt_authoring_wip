// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Parses the real installed Adapt Framework's vanilla icon font definitions
 * (<framework root>/src/core/less/_defaults/icons.less) into a plain {className, codepoint} list,
 * for the Light Course Editor's Side Drawer icon picker (frontend/src/modules/lightCourseEditor/
 * views/lightCourseIconPickerView.js).
 *
 * The drawer icon field is deliberately freeform (lib/lightcourse/iconOptions.js's
 * CONTROLS.drawer - confirmed its value is used as a literal CSS class, not an option from a
 * fixed enum, per the framework's own core/templates/nav.hbs), since it isn't restricted to this
 * one font/class set. The vanilla set is still the overwhelmingly common choice though, so a
 * browsable reference - with the real glyph rendered, via the same font files the framework
 * itself ships (served alongside this) - is worth building against the live installed framework
 * checkout rather than a hand-maintained, driftable copy of its ~240 class names.
 *
 * Framework root path confirmed against the same constant routes/download/index.js and
 * plugins/output/adapt/publish.js already use to locate the real per-tenant framework checkout
 * on disk (<tempDir>/<masterTenantID>/adapt_framework) - NOT lib/frameworkhelper.js's own
 * FRAMEWORK_DIR ('<serverRoot>/adapt_framework'), which a live instance's checkout is not
 * actually found under.
 */

var fs = require('fs'),
    path = require('path'),
    configuration = require('../configuration'),
    Constants = require('../outputmanager').Constants;

var FONT_FILES = { woff2: 'vanilla.woff2', woff: 'vanilla.woff' };

// Matches e.g. `.icon-arrow-left   { &:before { content: "\e912"; ...` - non-greedy so only the
// *first* content value per rule is captured. A handful of entries add a second, `.dir-rtl`-
// scoped content override later in the very same block (e.g. icon-arrow-left's mirrored icon) -
// irrelevant here, since a picker only needs one representative glyph per class.
var ICON_RULE_PATTERN = /^\.(icon-[a-z0-9-]+)\s*\{[\s\S]*?content:\s*"\\([0-9a-fA-F]{4})"/gm;

var cachedIcons = null;

function getFrameworkRoot() {
  return path.join(configuration.tempDir, configuration.getConfig('masterTenantID'), Constants.Folders.Framework);
}

function getIconsLessPath() {
  return path.join(getFrameworkRoot(), 'src', 'core', 'less', '_defaults', 'icons.less');
}

/**
 * @param {string} key - 'woff2' or 'woff'
 * @return {string|null} absolute path to that font file, or null for an unrecognised key
 */
function getFontFilePath(key) {
  var filename = FONT_FILES[key];
  return filename ? path.join(getFrameworkRoot(), 'src', 'core', 'fonts', filename) : null;
}

/**
 * @param {callback} next - function(err, icons), icons: [{ className, codepoint }, ...] sorted
 * alphabetically by className. Cached in-memory after the first successful read for the rest of
 * this process's lifetime - a framework re-clone/upgrade needs a server restart to be picked up,
 * same as every other piece of this codebase that reads installed-plugin data from disk once
 * (e.g. lib/schemaWalker.js's own schema-reading callers).
 */
function getVanillaIconClasses(next) {
  if (cachedIcons) {
    return next(null, cachedIcons);
  }
  fs.readFile(getIconsLessPath(), 'utf8', function (error, contents) {
    if (error) {
      return next(error);
    }
    var icons = [];
    var seen = {};
    var match;
    ICON_RULE_PATTERN.lastIndex = 0;
    while ((match = ICON_RULE_PATTERN.exec(contents)) !== null) {
      var className = match[1];
      if (seen[className]) {
        continue;
      }
      seen[className] = true;
      icons.push({ className: className, codepoint: match[2] });
    }
    icons.sort(function (a, b) {
      return a.className.localeCompare(b.className);
    });
    cachedIcons = icons;
    next(null, icons);
  });
}

module.exports = {
  getVanillaIconClasses: getVanillaIconClasses,
  getFontFilePath: getFontFilePath,
  FONT_FILES: FONT_FILES
};
