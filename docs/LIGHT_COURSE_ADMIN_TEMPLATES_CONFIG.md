# Admin: Light Course Template & Default Config Management

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md), which calls for an admin-only screen to manage reusable light course templates and tenant-wide defaults (plugin selections, graphic/audio placeholders, required-field defaults, icon defaults) - called out in the plan but never assigned a concrete UI in [Phase 3](LIGHT_COURSE_PHASE3_LIST_AND_EDITOR.md)/[Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md). Backend storage (`lightcoursetemplate`/`lightcourseconfig` collections and APIs) already existed from [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) - this work adds the missing admin-facing UI plus the backend pieces it needed that didn't exist yet.

## Implementation status: done

Validated via the full backend suite (175 passing / the same 14 pre-existing unrelated assetmanager/contentmanager failures as every prior clean run in this project) plus a frontend rebuild (`requireBundle`, `generate-lang-json`, `less:dev`, `handlebars:compile`, `requirejs:dev`, `babel:dev`) with no errors. Confirmed via `grep` that the new module's code, templates and styles are all present in the final bundled `frontend/build/js/origin.js`/`frontend/build/css/adapt.css`. The dev server was not running for most of this build (it stopped mid-session, unrelated to this work) - **restart it and click through the checklist below before considering this done live.**

**Two explicit scope decisions, confirmed with the user before starting** (via `ask_user`, since the main plan doesn't specify UI depth): build *both* template management and default-config management together (not one now/one later), with **"full editor"** depth for templates (an admin edits a template's actual content tree/plugins/glossary/resources/help directly, not just promote-and-rename) and **"full required defaults"** depth for config (every installed component/extension's required text/asset fields are configurable, not just a hand-picked few).

**A genuine latent bug in the build pipeline was found and fixed while adding this module's translations**: `generate-lang-json`'s frontend-lang-file merge (`Gruntfile.js`) did a shallow top-level spread, so when *more than one* frontend module has its own `lang/en.json` (every one of them is shaped `{ "app": {...} }`), each subsequently-processed module's `app` object silently **replaced**, rather than merged with, every previously-processed module's - confirmed empirically that before this fix, adding this module's `lang/en.json` caused every one of [lightCourseEditor](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseEditor/lang/en.json)'s translations to silently vanish from `temp/lang/en.json` (the file `routes/lang/index.js` actually serves to the client), since `lightCourseAdmin` sorts alphabetically after `lightCourseEditor` and so was processed second. Fixed by deep-merging the `app` key specifically in `Gruntfile.js`'s `generate-lang-json` task - confirmed both modules' keys (and the pre-existing `scaffold` module's differently-shaped `"app.scaffold"` key, untouched by the fix) all survive in the regenerated file.

**Two component/extension-schema fields were added to [lib/schemaWalker.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/schemaWalker.js)'s `walkSchema()` result** (`requiredTranslatablePaths`/`requiredAssetPaths`) to drive the required-defaults section - deliberately scoped to fields that are *both* required *and* translatable/an asset reference, rather than every required field regardless of type, so internal plumbing fields like `_parentId`/`_courseId`/`_isOptional` never show up as something an admin can set an authoring default for. Covered by new unit tests in [test/lib.schemawalker.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.schemawalker.js), additive and non-breaking (every pre-existing assertion in that file still passes unchanged).

**Not wired into content creation this pass - configured and stored centrally, but not yet auto-applied**: `graphicPlaceholders` (named default assets) and `requiredDefaults` (the schema-driven per-component/extension defaults) are fully editable in the new config screen and persist correctly, but nothing in the editor's "add a new component"/"start a new template" flow reads them yet - that would mean teaching `lightCourseEditor`'s tree-building logic to look up and apply these defaults when a node is first created, which is a materially bigger change to an already-tested, working flow than this pass's scope covered. By contrast, `defaultPluginSelections` and `iconDefaults` *are* wired in - `LightCourseContent.prototype.create()` already read `defaultPluginSelections` before this phase ([confirmed](plugins/content/lightcourse/index.js) wired in the preceding session of work); this phase added the equivalent wiring for `iconDefaults` (merged into `headerData.iconChoices` for a brand-new blank course, same "admin default, only for a blank course, only filling in what wasn't already explicitly supplied" rule). If an admin configures a graphic placeholder or required default and it doesn't visibly appear anywhere on a newly-created course/template yet, that's expected for now, not a bug.

## New backend routes

### Starting settings for new templates

New blank templates copy the tenant's current `defaultPluginSelections` (menu, theme, extensions)
and `iconDefaults` into their saved snapshot when created. This is a one-time copy: changing
Light Course Settings later does not change existing templates. Explicit empty selections are
preserved. If no settings record exists, the template starts with empty settings.

The blank-template create request sends only its name and description, omitting `contentSnapshot`.
A supplied snapshot, even an empty one, is treated as explicit content and is not seeded. Clones,
imports, and templates promoted from versions therefore retain their source settings.
The template model preserves `headerData` when reopening, saving, and cloning; courses created
from a template inherit its saved plugin selections and icon choices, not the current settings.
Saving an existing template keeps the user in its editor and shows the saved confirmation.
Use Back to list to leave explicitly. Update acknowledgements preserve the in-memory snapshot
so subsequent edits and saves retain all settings and content.

- `GET /api/lightcourseconfig/mine` (already existed from the preceding session of work) - get-or-create the tenant's singleton `lightcourseconfig` record.
- `GET /api/lightcourseconfig/requireddefaultschema` (new, [plugins/content/lightcourseconfig/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/lightcourseconfig/index.js)) - walks every installed `componenttype` (merged with the shared `plugins/content/component/model.schema` fields, the same way `lib/lightcoursewordcount.js#resolveComponentSchema` does) and `extensiontype`'s schema via `schemaWalker.walkSchema()`, returning `{ components: [...], extensions: [...] }`, each entry `{ key, displayName, requiredTranslatablePaths, requiredAssetPaths }` - only included if it actually has at least one qualifying field, so the admin isn't shown a long list of nothing-configurable types.
- `lightcourseconfig`'s `create()`/`update()` now validate `defaultPluginSelections`/`iconDefaults` (reusing [lib/lightcourse/validation.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/lightcourse/validation.js)'s existing per-field checks against a reshaped payload) before this phase, these two fields could be set to anything via the generic content PUT route and would only ever fail later, confusingly, when a course tried to use them.
- `lightcourse`'s blank-course `create()` now also merges `iconDefaults` into a new course's `headerData.iconChoices` (same pattern as the existing `defaultPluginSelections` wiring).

## New frontend module: `frontend/src/modules/lightCourseAdmin/`

The admin links now live in a **Light Course Administration** submenu: Light Course Settings,
Light Course Placeholder Assets, Light Course Templates, and Component Defaults. Its parent
button expands/collapses inline, supports keyboard activation, and exposes its expanded state
to assistive technology. Selecting a child opens the same existing route and closes the menu.
The existing admin-only permission checks are unchanged.

A separate top-level module (not nested in `lightCourseEditor`), gated the same wildcard-only way [userManagement](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/userManagement/index.js)/[frameworkImport](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/frameworkImport/index.js) are (`["*/*:create","*/*:read","*/*:update","*/*:delete"]` - only a Super Admin-style role satisfies this; a Light Editor never sees either nav item). Two global nav items: **Light Course Templates** and **Light Course Settings**.

- [models/lightCourseTemplateModel.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/models/lightCourseTemplateModel.js): flattens/re-wraps the server's nested `contentSnapshot` to/from top-level attributes (`contentTree`/`pluginSelections`/`glossaryItems`/`resourceItems`/`helpContent`) via `parse()`/`toJSON()`, so `lightCourseEditor`'s own `LightCourseTreeView`/`LightCourseItemListView`/`LightCourseHelpView` sub-views can be reused completely unmodified against a template instance - none of those views needed any changes.
- [views/lightCourseTemplateListView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/views/lightCourseTemplateListView.js) + `lightCourseTemplateListItemView.js`: list templates (name, description, last updated), Edit/Delete (with an "are you sure" confirm, same pattern as the light course list's own delete button) per row, plus two toolbar actions:
  - **Create template**: a small modal (name/description) that immediately creates a blank template and navigates straight to its editor.
  - **Promote from version**: a modal to pick an existing light course, then one of its published versions, plus a name/description, calling the existing (Phase 6) `POST /api/content/lightcoursetemplate/from-version/:versionId` endpoint.
- [views/lightCourseTemplateEditorView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/views/lightCourseTemplateEditorView.js): the full content editor - name/description fields, the same plugin-selections block (menu/theme/extensions) as the light course editor (deliberately duplicated rather than extracted into a shared component, to avoid risking the already-tested light-editor-facing editor under this pass's time constraints - flagged as a known, intentional duplication), and the reused tree/glossary/resources/help sub-views.
- [views/lightCourseConfigView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/views/lightCourseConfigView.js): the four-section settings screen -
  1. **Default plugin selections** (menu/theme/extensions) - same picker pattern as above.
  2. **Graphic & audio placeholders** - freeform named asset slots (add/remove rows, each with a name and an asset picker).
  3. **Required field defaults** - schema-driven, one group per installed component/extension that has a qualifying field (fetched from the new `requireddefaultschema` route), one input (text or asset picker) per required field path.
  4. **Icon defaults** - Menu/Reflection/Help dropdowns, populated from the same `extensiontype`-derived option lists `lightCourseEditor`'s own header view uses (duplicated rather than shared, since this screen's pickers are always visible - there's no "owning extension selected on this course" concept for a tenant-wide default).
- [views/lightCourseConfigAssetPickerView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/views/lightCourseConfigAssetPickerView.js): a small standalone asset picker, deliberately **not** reusing `lightCourseEditor`'s `LightCourseBankAssetFieldView` - that view's "attach to bank" behaviour is scoped to a specific light course via `lightCourseAssetContext.js`, which has no meaning for a tenant-wide default (and reusing it with a stale/unset context risked creating bogus `lightcoursebankasset` records). This picker is a plain `api/asset` reference with no bank-attachment side effects.

## Tests

- [test/lib.schemawalker.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.schemawalker.js): new assertions for `requiredTranslatablePaths`/`requiredAssetPaths` against the existing fixtures (none of which happen to have a required field that's also translatable/an asset) plus a new synthetic-schema test that does exercise both.
- [test/lib.lightcourseadmin.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcourseadmin.js): new tests for `iconDefaults`/`defaultPluginSelections` validation on the config PUT route (reject an invalid icon, reject a non-array `extensions`), the `iconDefaults` -> new-course `headerData.iconChoices` wiring, and the `requireddefaultschema` route's response shape against the real installed component/extension types.
- No frontend test harness exists in this codebase (consistent with every prior phase's UI work) - the **Manual QA checklist** below is the verification path for the new screens themselves.

## Manual QA checklist

Log in as a Super Admin (or any role with the full `*/*` wildcard) - a Light Editor should not see either nav item at all.

**Templates**
- [ ] "Light Course Templates" appears in the global nav for an admin role, and does **not** appear for a Light Editor-only user.
- [ ] The template list shows every existing template (name, description, last updated) with Edit/Delete per row.
- [ ] **Create template**: click Create, enter a name (and optionally a description), confirm - you land directly in that new template's editor.
- [ ] Leave the name blank and try to create - confirm a validation message, not a silent failure.
- [ ] In the template editor: change the name/description, tree (add pages/articles/blocks/components), plugin selections, glossary/resources/help content, then Save - confirm it persists (reload the page and re-open the same template to check).
- [ ] Toggling an extension checkbox (e.g. Glossary) immediately shows/hides that section's editor, same as in the light course editor itself.
- [ ] **Promote from version**: pick an existing light course, pick one of its published versions, give it a name, confirm - a new template appears in the list with that version's content, and editing it afterwards works normally.
- [ ] Delete a template - confirm the "are you sure" warning appears and it's actually removed from the list afterwards.
- [ ] As a Light Editor, confirm a template you just built/edited is selectable from the **Create light course** screen's template picker and produces a new course with that template's content, as before.

**Settings (Light Course Settings)**
- [ ] "Light Course Settings" appears in the global nav for an admin role only (same check as above).
- [ ] Set default plugin selections (menu/theme/a few extensions), Save, reload the page - confirm they're still selected.
- [ ] As a Light Editor, create a brand-new **blank** course (not from a template) - confirm its plugin selections match what was just configured (not the old hardcoded uniqueID/footer/styling/trickle/spoor/hero fallback, unless that's still what was configured).
- [ ] Add a graphic placeholder (give it a name, pick/upload an asset), Save, reload - confirm it's still there. Remove it and confirm it's gone after Save.
- [ ] The required-field-defaults section lists at least one installed component/extension with at least one configurable field (if your installed plugin set has any required translatable/asset fields) - set a value, Save, reload - confirm it persists.
- [ ] Set a Menu/Reflection/Help icon default, Save, reload - confirm it's still selected. Then, as a Light Editor, create a new blank course and open its header section - confirm that icon is pre-selected (still fully editable from there).
- [ ] Try saving an icon default that isn't in the dropdown's own option list (e.g. by inspecting/tampering with the request directly) - confirm the server rejects it with a specific error, not a silent corrupt save.
