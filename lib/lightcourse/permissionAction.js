// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Normalizes a ContentPlugin action name to the action-name convention used by lib/role/*.json
 * statements ("create"/"read"/"update"/"delete").
 *
 * Confirmed gap in the shared framework: lib/contentmanager.js's ContentPlugin.prototype.retrieve
 * calls hasPermission with the literal action "retrieve" (not "read"), but every role file in
 * lib/role/*.json only ever grants "read"/"create"/"update"/"delete" - so without this mapping, a
 * hasPermission override that falls back to permissions.hasPermission(userId, action, resource)
 * for a genuinely role-based (non-owner, non-super-admin) user would always deny retrieval, since
 * "retrieve" never matches any statement's action list. This has gone unnoticed elsewhere because
 * every existing content type's hasPermission either trivially allows everything (courseasset) or
 * uses helpers.hasCoursePermission's ownership/super-admin shortcuts, which never reach the
 * mismatched literal action-string check. create()/update()/destroy() already pass "create"/
 * "update"/"delete" and need no mapping.
 */
function normalize(action) {
  return action === 'retrieve' ? 'read' : action;
}

module.exports = { normalize: normalize };
