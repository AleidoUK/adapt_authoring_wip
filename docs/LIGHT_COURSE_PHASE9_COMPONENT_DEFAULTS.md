# Phase 9: Component Defaults

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md). Adds a new concept one level below [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)'s `lightcourseconfig` (tenant-wide, course-level defaults) and [Phase 3](LIGHT_COURSE_PHASE3_LIST_AND_EDITOR.md)/[Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md)'s `lightcoursetemplate` (whole-course snapshots): a library of reusable, named, component-level field-value presets ("Component Defaults"), one or many per installed component type, with at most one flagged as *the* default for its type at any time.

## Implementation status: done

Validated via `grunt handlebars:compile`, `generate-lang-json`, `requireBundle`/`requirejs:dev` and `less:dev` (all succeed, the new admin/editor files and templates are present in the compiled bundle/lang output) plus the full backend suite run via `grunt test` (185 passing, the same 14 pre-existing unrelated `assetmanager`/`contentmanager` failures as every prior clean run per [Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md) - confirmed no regressions). No live browser session - manual QA should follow [Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md)'s own checklist pattern against the new preset picker described below.

## Backend: `plugins/content/lightcomponentdefault/`

A new content type, modelled directly on [plugins/content/lightcoursetemplate/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/lightcoursetemplate/index.js)'s tenant-isolation/`hasPermission` pattern, with freeform, deliberately-unvalidated `values` storage the same way [plugins/content/lightcourseconfig/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/lightcourseconfig/index.js) treats `graphicPlaceholders`/`requiredDefaults` - a preset's `values` bag is whatever subset of a component's own editable fields (title/body/items/graphicsNotes/developerNotes/etc) the admin chose to set, applied as-is onto a target node by the editor.

- [model.schema](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/lightcomponentdefault/model.schema): `name` (required string), `description` (string), `componentType` (required string - the same value as a content-tree component node's `_component`), `values` (freeform object), `isDefault` (boolean, default `false`).
- [index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/lightcomponentdefault/index.js): standard CRUD via the generic `/api/content/lightcomponentdefault` route (no extra routes needed, confirmed `GET /api/content/:type` already supports filtering by any model field via the query string, e.g. `?componentType=text` - used by the editor's preset picker below). `create()`/`update()` enforce the "at most one `isDefault: true` per `componentType` per tenant" singleton rule server-side: before writing a record with `isDefault: true`, any other record sharing that tenant + `componentType` with `isDefault: true` is cleared first (on update, the effective `componentType` is resolved from the delta or, if absent, the existing record, the same pre-retrieve-then-merge pattern `lightcoursetemplate`'s own `update()` override already uses for `contentSnapshot`).
- [lib/role/LightEditor.json](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/role/LightEditor.json): one new read-only statement added, matching the existing `lightcoursetemplate`/`lightcourseconfig` lines exactly. CourseCreator/SuperAdmin need no changes - their existing `/api/content/*`/`/*` wildcard statements already cover full management.

## Frontend: "Component Defaults" admin section (`frontend/src/modules/lightCourseAdmin/`)

A new, parallel CRUD list/editor pair, admin-only (same wildcard-only `featurePermissions` gate as the existing Templates/Config nav items, so a Light Editor never sees it), wired into [index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/index.js) as a new global menu entry (`sortOrder: 6`) and `lightCourseComponentDefaults` router events:

- [models/lightCourseComponentDefaultModel.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/models/lightCourseComponentDefaultModel.js) / [collections/lightCourseComponentDefaultCollection.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/collections/lightCourseComponentDefaultCollection.js) - thin wrappers over `api/content/lightcomponentdefault`, no flatten/wrap needed (unlike `lightCourseTemplateModel.js`) since the schema's fields are already flat.
- [views/lightCourseComponentDefaultListView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/views/lightCourseComponentDefaultListView.js) (+ [views/lightCourseComponentDefaultListItemView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/views/lightCourseComponentDefaultListItemView.js)) - lists every preset with its component type's installed display name (from `GET api/componenttype`, the same source the tree view's own "add component" picker uses) and whether it's currently flagged default for that type, with a "Set as default" action per row (a `PATCH`-style `{ isDefault: true }` save - clearing any previous default for that type is left entirely to the server-side enforcement above; the row re-renders via the collection's own `sync` event bubbling).
- [views/lightCourseComponentDefaultCreateView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/views/lightCourseComponentDefaultCreateView.js) - a create modal (name/description/component type/isDefault), the same `modal:open` convention as `lightCourseTemplateCreateView.js`, needed up front here (unlike a template's name-only create) because the field-value form shown next depends entirely on the chosen component type.
- [views/lightCourseComponentDefaultEditorView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/views/lightCourseComponentDefaultEditorView.js) - name/description/component-type-select/isDefault fields, plus the actual field-value editing form, built by reusing [lightCourseEditor/views/lightCourseComponentFormView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseEditor/views/lightCourseComponentFormView.js) directly (required via a relative path, confirmed to resolve correctly through `requirejs:dev`) against a plain `Backbone.Model` wrapping `_component` + the preset's current `values` - exactly the shape that view already expects, so no changes to it were needed.
- New i18n keys added to [lang/en.json](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseAdmin/lang/en.json) following the existing `app.lightcourse...` naming convention (`app.lightcoursecomponentdefaults`, `app.errorgettinglightcoursecomponentdefault`, etc.).

## Frontend: Light Course Editor integration

Preset selection is scoped to [lightCourseEditor/views/lightCourseTreeView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseEditor/views/lightCourseTreeView.js), shared by light courses and course templates. The full/legacy course editor does not use this picker. When the component-type `<select>` built by `renderComponentPicker` changes (including the very first selection on a brand new node), a new `renderPresetPicker` fetches that type's presets (`GET api/content/lightcomponentdefault?componentType=<type>`) and renders a small adjacent preset `<select>` (a "-- none --" option, plus one per preset, next to the type picker):

- If the node had no `_component` before this change (a brand new node's very first type choice) and a preset is flagged default for the new type, that preset is pre-selected and its `values` are applied immediately (`Object.assign`'d onto the node, then the field-value form is re-rendered).
- The selected preset ID is stored on the component as `_componentPresetId`, alongside the applied field values. Reopening the component restores that selection without reapplying the preset over manual edits. Course templates and new courses created from them retain both the selection and the values; only content-node IDs are regenerated.
- Changing an existing component's type clears its preset selection and does not automatically apply another default. Choosing "-- none --" clears the preset selection but keeps the current field values. If a saved preset has been removed, the dropdown shows "Saved preset unavailable" and the component retains its saved values.
- Changing the preset dropdown's selection, at any time, immediately re-applies that preset's `values` onto the node and re-renders the form, overwriting current field values - an explicit, deliberate action per the product requirement, never triggered silently (e.g. by typing in a field).

New i18n keys added to [lightCourseEditor/lang/en.json](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseEditor/lang/en.json): `app.lightcoursecomponentpreset`, `app.lightcoursecomponentpresetnone`.

The shared rich-text editor lifecycle handles reading/removing fields before CKEditor finishes
initializing. Removed fields are not initialized later, pending editor instances are destroyed
when they become ready, and an early save reads the textarea's current value. This prevents
applying a preset immediately after choosing a component type from breaking the field form.
Preset requests are ignored after switching components/types or closing the editor.

Previously saved components without `_componentPresetId` keep their field values but have no
recoverable preset selection. Select the intended preset once and save to retain it.

## Tests

### Populated fields in the tree

Course and template editors share a recursive preview of every populated node field, including
instructions, graphic/developer notes, nested item values, and stored settings.
Component Unique ID appears once beside the title in small grey text, not in the expanded field
list. Unique ID and audio values remain visible even when their extensions are disabled.
Empty strings/objects/lists and internal IDs, node types, schema snapshots, and preset IDs are
omitted; numeric zero and boolean false remain visible. Schema titles are used as labels where
available, with readable field-name labels otherwise. Rich-text fields retain their formatting,
while other values are escaped and preserve line breaks.

[test/lib.lightcomponentdefault.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcomponentdefault.js), modelled on [test/lib.lightcourseadmin.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcourseadmin.js)'s `adminAgent`/Light-Editor-role `editorAgent` setup. Covers: admin create/update/delete; Light Editor read access; Light Editor rejected on create/update/delete (asserted as "not a 200, `success: false`" rather than a literal 403 - confirmed `lib/contentmanager.js`'s generic content POST/PUT/DELETE routes only special-case `ContentTypeError`/`ContentConflictError`, mapping every other error including a denied `ContentPermissionError` to a flat 500; only the separate `/content/:type/query` GET route special-cases `ContentPermissionError` to 403 - a pre-existing, framework-wide REST-layer behaviour affecting every content type's create/update/delete permission denials, out of scope to change here); the single-default-per-`componentType` enforcement on both create and update; and that different `componentType` values each keep an independent default unaffected by one another.
