// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Per-control button/help-screen icon validation data for the Light Course Editor.
 *
 * Confirmed against the real installed framework checkout in
 * docs/LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md ("Per-control button/help-screen icon validation
 * table"): icon choice is not owned by the theme or menu - each nav-contributing extension owns
 * its own option list independently, so each control must be validated against its own list
 * rather than a single shared theme/menu enum.
 *
 * Reused by:
 *   - Phase 2's lightcourse create/update validation (reject an unsupported icon up front).
 *   - Phase 7's conversion preflight (reject a choice the target theme/menu/extension set can't
 *     satisfy before conversion writes anything).
 */

var CONTROLS = {
  menuButton: {
    schemaPath: 'pluginLocations.contentobject._menuButton._icon',
    owningExtension: 'menuButton',
    options: ['home', 'menu', 'grid', 'controls-left', 'controls-small-left', 'arrow-left', 'arrow-left-2', 'arrow-with-circle-left', 'chevron-with-circle-left'],
    freeform: false
  },
  reflection: {
    schemaPath: 'pluginLocations.course._reflection._navItem._icon',
    owningExtension: 'reflection',
    options: ['comment', 'checklist', 'list', 'list-2', 'ordered-list'],
    freeform: false
  },
  help: {
    schemaPath: 'pluginLocations.course._help._navItem._icon',
    owningExtension: 'help',
    options: ['question', 'info'],
    freeform: false
  },
  drawer: {
    schemaPath: '_drawer._iconClass',
    owningExtension: null, // course config, not an extension
    options: null, // freeform CSS class name - no fixed list to validate against
    freeform: true
  },
  back: {
    schemaPath: null, // not configurable - fixed CSS class, see core/templates/nav.hbs
    owningExtension: null,
    options: null,
    freeform: false,
    fixed: true
  }
};

/**
 * Validates a chosen icon identifier for a given control.
 *
 * @param {string} control - one of the keys in CONTROLS (menuButton/reflection/help/drawer/back)
 * @param {string} iconValue - the value chosen by the editor
 * @return {object} { valid: boolean, reason: string|null }
 */
function validateIcon(control, iconValue) {
  var definition = CONTROLS[control];
  if (!definition) {
    return { valid: false, reason: 'Unknown control "' + control + '"' };
  }
  if (definition.fixed) {
    // Back button: no choice to validate - any submitted value is simply ignored/rejected.
    return { valid: false, reason: 'The Back button has no configurable icon' };
  }
  if (definition.freeform) {
    return { valid: typeof iconValue === 'string' && iconValue.length > 0, reason: 'A freeform icon class is required' };
  }
  var valid = definition.options.indexOf(iconValue) !== -1;
  return { valid: valid, reason: valid ? null : ('"' + iconValue + '" is not a valid option for ' + control + ' (expected one of: ' + definition.options.join(', ') + ')') };
}

module.exports = {
  CONTROLS: CONTROLS,
  validateIcon: validateIcon
};
