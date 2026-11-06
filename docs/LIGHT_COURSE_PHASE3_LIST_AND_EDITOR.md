# Phase 3: Light-Course List and Editor

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md). Depends on [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) for the API surface.

## Implementation status: done, with scoped-down simplifications

Built under [frontend/src/modules/lightCourseEditor/](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseEditor), registered in [modules.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/modules.js). Validated via `grunt handlebars:compile`, `less:dev`, `generate-lang-json` and `requirejs:dev` (all succeed with no errors, and the built bundle includes every new file) - **not** via a live browser session, since no frontend test harness exists in this repo (confirmed below) and setting one up was out of scope for this phase. See the **Manual QA checklist** at the bottom of this document for what a human should verify in a real browser before sign-off.

A real architectural gap was found and worked around: `modules/scaffold/index.js`'s `Scaffold.buildForm()`/`./schemas.js`'s `Schemas()` - the thing this doc originally pointed to for "Generic component-field rendering" - read `Origin.editor.data.config`/`.menutypes`/`.themetypes` unconditionally, which are **only** populated inside the full-course editor; calling them from the Light Course Editor would throw. `Origin.schemas` itself (the raw, un-trimmed combined schema data `Schemas()` wraps) is populated globally and independently at app start, so [views/lightCourseComponentFormView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseEditor/views/lightCourseComponentFormView.js) reads `Origin.schemas.get(componentName)` directly and builds a `Backbone.Form` itself (reusing every editor type already registered on `Backbone.Form.editors` by the scaffold module, e.g. Asset/List - just not `Scaffold.buildForm()`'s dispatcher), with field filtering done by [schemaFilter.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/lightCourseEditor/schemaFilter.js) (the "translatable/Asset-only" filter this phase's deliverable 1 asked for).

Simplifications made given the "no sortable component exists, no frontend test harness exists" constraints already called out below:
- **Tree reordering** uses move-up/move-down buttons, not jQuery UI draggable/droppable - this is still "a local array-splice + whole-tree `model.save()`", exactly option 2's recommendation, just via buttons instead of drag gestures. Revisit as a UX polish pass once there's a way to validate drag interactions in a real browser.
- **One component editor overlay at a time**, shared by course and template editors. The existing form appears in a fixed, scrollable panel with Save and Cancel beside each other, without a visible "Component" heading. The Unique ID label and field appear above Title when available. Save commits field, component-type and preset changes; Cancel discards them. Open edits are isolated from background autosaves until Save. Nested item and asset editors continue to open above the overlay.
- **Copy and paste pages, blocks and components** within either light editor. Copy a page to show Paste Page buttons before, between and after pages; choose a gap to insert the complete copied page there. Copy a block, then Paste Block on the destination article; copy a component, then Paste Component on the destination block. Block/component copies are appended to the destination. All copies have independent stored values and fresh internal IDs for every copied node. Preset selections and author-entered Unique ID values are retained; edit the latter where a different label is needed. Copy takes a snapshot without saving. A successful Paste saves through the normal save/autosave flow and clears all paste buttons. Cancel copy or selecting another editing action also clears them; selecting another Copy replaces the snapshot. Pasting a component into a full block warns without changing the tree or consuming the copy, respecting the two-component limit.
- **Add Page** creates one article containing one empty block in both light editors, ready for adding components. Existing pages and the separate Add Article/Add Block actions are unchanged.
- **Page titles** can be edited using the labelled text field beneath each page heading in both light editors. The saved title appears as an H1; untitled pages show "Page". Titles are retained when saving, copying pages, or creating courses from templates.
- **Course details and settings** appear at the bottom of the light course editor in a collapsed-by-default panel. Open it to access version history, reviewing/developer information, terminology, icons, menu content and plugin selections. The toolbar, save status and warning banners remain visible above the tree. Collapse/expand retains field values and existing save behaviour. Template-editor layout is unchanged.
- **The help extension's "pop-up vs. graphic walkthrough" style toggle is not rendered** - per [Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md)'s resolved finding, the installed extension has no such toggle to render in the first place.
- **`contentTree` root shape corrected**: building the tree view against [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)'s original single-page-root shape surfaced that a course has *multiple* pages (per the main plan) - fixed in `lib/lightcourse/validation.js`/`idRegeneration.js` to `{ children: [<page nodes>] }`, with new unit coverage in [test/lib.lightcoursevalidation.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcoursevalidation.js) (this phase hadn't had dedicated tests for that module before).
- **"Create from template" now has a server endpoint**: [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) only built the "promote version to template" direction; `lightcourse.create()` was extended to accept `_templateId` and apply the template's content (ID-regenerated) via the same shared helper, since the create view genuinely needs this to work.

## Module shape (confirmed conventions)

Frontend modules are AMD modules listed in [frontend/src/modules/modules.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/modules.js) and register behaviour by listening to `Origin` events rather than exporting a router - confirmed via [frontend/src/modules/assetManagement/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/assetManagement/index.js) (`router:assetManagement`, `globalMenu:assetManagement:open`) and [frontend/src/modules/projects/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/projects/index.js). Create `frontend/src/modules/lightCourseEditor/` with the same shape:

```text
frontend/src/modules/lightCourseEditor/
  index.js                     # listens for router:lightCourseEditor, globalMenu:lightCourseEditor:open
  models/lightCourseModel.js    # Backbone.Model, urlRoot: 'api/content/lightcourse'
  collections/lightCourseCollection.js  # url: 'api/content/lightcourse/query' (or a custom list endpoint)
  views/
    lightCourseListView.js       # tenant-wide list: title/updated/latest version/state/actions
    lightCourseListItemView.js
    lightCourseCreateView.js     # title + template picker + Save
    lightCourseEditorView.js     # outer editor shell: header sections + tree
    lightCourseHeaderView.js     # version history table, reviewing instructions, dev info, terminology, buttons
    lightCourseTreeView.js       # pages -> articles -> blocks -> components
  templates/*.hbs
```

- Add `'modules/lightCourseEditor/index'` to [modules.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/modules.js)'s dependency list.
- Route: `:module(/*route1)(/*route2)(/*route3)(/*route4)` (confirmed in [frontend/src/core/router.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/core/router.js)) gives `lightCourseEditor`, `lightCourseEditor/<id>` for free; dispatch on `route1` inside the module's `router:lightCourseEditor` handler the same way `assetManagement/index.js` dispatches list/new/edit/replace.

## Navigation and permission gating (confirmed pattern)

Follow [frontend/src/modules/userManagement/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/userManagement/index.js) exactly: define a `featurePermissions` array matching the Light Editor role's resources from [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) (e.g. `"*/content/lightcourse:create"`, `"*/content/lightcourse:read"`), call `Origin.permissions.addRoute('lightCourseEditor', data.featurePermissions)` on `origin:dataReady login:changed`, and only call `Origin.globalMenu.addItem(...)` when `Origin.permissions.hasPermissions(data.featurePermissions)` returns true - this is how the UI is hidden from users without the role (by omission, not a disabled button), confirmed as the only existing nav-gating pattern in this codebase ([frontend/src/core/permissions.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/core/permissions.js) `hasPermissions`/`addRoute`/`checkRoute`, [frontend/src/core/router.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/core/router.js) `verifyRoute`). Admins (who also hold `SuperAdmin`/wildcard permissions) will satisfy this check too and can enter the light area explicitly, per the main plan.

Full-course editors who are *not* light editors must not see this menu item - this falls out automatically from the permission check above as long as `lightcourse*` resources are never added to `lib/role/CourseCreator.json` (see [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)).

## List view

Model closely on [frontend/src/modules/assetManagement/views/assetManagementCollectionView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/assetManagement/views/assetManagementCollectionView.js)'s confirmed `fetchCollection`/`resetCollection`/`appendAssetItem` pattern and its matching [assetModel.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/assetManagement/models/assetModel.js) (`idAttribute: '_id'`, `urlRoot`) / [assetCollection.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/assetManagement/collections/assetCollection.js) (`url` + query params) pair. List columns: title, updated date, latest version, draft/converted state, edit/review actions - all available directly from the `lightcourse` model fields defined in Phase 2.

Create flow: title field + template picker (populated from `GET api/content/lightcoursetemplate`) + Save, per [LIGHT_COURSE_EDITOR.md](LIGHT_COURSE_EDITOR.md). "Edit button or title double-click opens it" - implement both as triggers to the same navigate-to-editor action.

## Editor shell and tree

**No generic reusable sortable/reorderable Backbone component exists in this codebase** (confirmed: the full editor's reordering is bespoke per level - [frontend/src/modules/editor/contentObject/views/editorPageArticleView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/editor/contentObject/views/editorPageArticleView.js), [editorPageBlockView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/editor/contentObject/views/editorPageBlockView.js) and [editorPageComponentView.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/editor/contentObject/views/editorPageComponentView.js) each implement their own jQuery UI `.draggable()`/`.droppable()` logic with paste-zone views). Two implementation options:
1. **Reuse the pattern, not the code**: write a new, simpler `lightCourseTreeView`-family using the same jQuery UI draggable/droppable + paste-zone approach, scoped down since the light tree only needs page/article/block/component (no menu-layer nesting) and a hard cap of two components per block (reject a third drop client-side *and* rely on the Phase 2 server-side validation as the source of truth).
2. Since the light course tree lives as one JSON document (`contentTree` on the `lightcourse` model, per Phase 2) rather than one Mongo document per node, reordering is a local array-splice + `model.save()` of the whole tree, **not** a per-node PATCH with `_sortOrder`/`_parentId` like the full editor's `.sortable()` `stop` handler does. This is simpler to implement correctly and avoids needing the full editor's parent-ID-recalculation logic at all - recommended.

Block/component add-remove and "up to two components, left/right when paired" follow the product doc directly; enforce the two-component cap in the "add component" UI action.

## Header sections (confirmed as a fresh build - no existing equivalent)

Render at the top of `lightCourseEditorView`: version history table (server-calculated Version/Date/Author/Screens/Words columns from the `lightcourse.headerData.versionHistory` array, editable Notes/Est. duration cells, manual add-row action), reviewing instructions (plain textarea), developer information (navigation linearity/layout/tracking/reflection dropdowns+checkbox), terminology dropdowns, button/help-screen icon pickers. Each icon picker's option list and default (first option) comes from the Phase 1 per-extension matrix, **not** a single shared list - the Buttons section needs to fetch `extensiontype` records (already permitted via the Light Editor role's `extensiontype:read`) to populate each picker's options dynamically rather than hardcoding them, so an extension upgrade's icon set is reflected automatically.

## Generic component-field rendering (reuse opportunity, confirmed)

[frontend/src/modules/scaffold/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/scaffold/index.js)'s `Scaffold.buildForm({ model })` already turns an arbitrary installed component's schema into an editable Backbone-Forms form generically (confirmed: [frontend/src/modules/editor/component/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/frontend/src/modules/editor/component/index.js) uses exactly this mechanism for the full editor, keyed off the model's `_component` value). **Reuse `Origin.scaffold.buildForm` directly for the light editor's component forms** instead of writing a second schema-to-form renderer - this is the single highest-leverage reuse opportunity found in this spike. It will need two adjustments, both isolated to [Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md):
1. A field-visibility filter so only `translatable`/`Asset:image` (and, when the audio extension is selected, audio) fields render - not settings/style fields - matching "common content fields include title, display title, body, instruction and uniqueId where applicable" from the product doc.
2. Registering `Graphics Notes`/`Developer Notes` as two extra always-present fields that are not part of the installed component's own schema at all (they're light-editor-only, per the main plan) - add them via `Scaffold.addCustomField`/a wrapper schema rather than injecting them into the real component schema.

## Empty/loading/conflict/validation states

Use the 409 conditional-update response from [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) to show a conflict banner on save failure (offer reload-and-reapply, not silent overwrite, per the main plan's concurrency requirement). Validation errors from the server (hierarchy, asset ownership, icon validity) should surface inline next to the relevant tree node/field, not as a generic toast only.

## Tests

No existing frontend/browser test framework was found in this repository (confirmed: no Jest/QUnit/Jasmine setup under `frontend/`). Phase 8 will need to decide whether to introduce one or rely on manual/pilot verification for the frontend; this phase should not assume a frontend test harness exists. Static validation was run instead: `grunt handlebars:compile`, `less:dev`, `generate-lang-json` and `requirejs:dev` all succeed with no errors, and `frontend/build/js/origin.js` includes every new file - this confirms the templates parse, the LESS compiles, the language strings merge, and every `define()`/`require()` path resolves correctly, but it does **not** confirm the UI actually looks or behaves correctly in a browser. Use the checklist below for that.

## Manual QA checklist

Run this against a real build (`grunt build`) and a real browser session, logged in as a user with the `Light Editor` role, before considering this phase ready for pilot use. Each item references the relevant product requirement from [LIGHT_COURSE_EDITOR.md](LIGHT_COURSE_EDITOR.md).

**Navigation and access**
- [ ] A user with the `Light Editor` role sees a "Light Course Editor" item in the global menu; a user with only `Course Creator` does not.
- [ ] A full admin (`Super Admin`) also sees the item and can enter the area.
- [ ] Being a light editor alone does not add a full-course dashboard link, and does not grant access if the full-course dashboard URL is entered directly.

**List and create**
- [ ] The list page loads and shows all light courses in the tenant (not just the current user's own), with title, last-updated date, latest version (or "Draft only"), and state columns populated correctly.
- [ ] **Create** opens a title + template picker + Save form; Save with an empty title shows a validation message and does not submit.
- [ ] Creating with no template selected produces a blank course (empty tree, no plugin selections).
- [ ] Creating with a template selected produces a course whose structure/text matches the template, but whose node IDs are visibly independent (confirm by checking the network response's `contentTree`/`glossaryItems` `_id` values against the template's, per the Phase 2 checklist).
- [ ] After Save, the new course appears in the list; both the **Edit** button and a double-click on its title in the list open the same editor.

**Editor shell, header sections**
- [ ] Version history table renders, Notes/Est. duration cells are editable, other columns are not, and "Add row" appends a manual row.
- [ ] Reviewing instructions textarea, developer-info dropdowns/checkbox, and terminology dropdowns all persist their values across a Save Draft + page reload.
- [ ] Button icon pickers (Menu, Reflection, Help) are populated from the *installed* extensions' real option lists (cross-check against the [Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md) icon table) - not a hardcoded list - and default to the first option when nothing has been chosen yet.
- [ ] Side Drawer icon is a freeform text field, not a dropdown.
- [ ] There is intentionally no "pop-up vs. graphic walkthrough" style toggle anywhere (per Phase 1's resolved finding) - confirm this isn't expected to appear once the help extension work (below) is checked.

**Plugin selections**
- [ ] Menu/Theme selects are populated from installed menutype/themetype records and are single-select; Extensions render as a checklist, not single-select.
- [ ] Changing a selection and saving persists it; reloading the editor shows the saved selection.

**Content tree**
- [ ] "Add page" adds a top-level page; a course can have more than one page.
- [ ] Add article/block/component buttons only appear on the appropriate parent level, and add a correctly-typed child.
- [ ] A block already holding two components hides/disables its "add component" action (or shows the max-components warning) rather than silently accepting a third.
- [ ] Move up/down buttons reorder siblings at every level and the new order survives a Save Draft + reload.
- [ ] Remove prompts for confirmation and removes the node and everything nested inside it.
- [ ] Clicking a component's Edit button opens its field editor; clicking a *different* component's Edit button while one is already open correctly saves the first one's in-progress edits before opening the second (no silent data loss).
- [ ] The "add component" dropdown lists every currently-installed component type by display name.

**Component editor (generic field rendering)**
- [ ] Only translatable text fields and image (`Asset:image`) fields render for a chosen component - no settings/style fields (classes, visibility toggles, etc.) appear.
- [ ] `uniqueId` appears (mapped from `_extensions._uniqueId._id`) only for components where the installed uniqueId extension applies.
- [ ] Graphics Notes and Developer Notes always appear, for every component, even ones whose own schema has no such fields - and are clearly visually distinct from the component's real fields.
- [ ] With the audio extension selected among the course's Extensions, an audio field appears on components/items; with it deselected, the field is absent.
- [ ] Choosing an image field opens/uses the shared light-course asset bank, not the full-course asset picker.
- [ ] If a component's installed type has been removed since the course was last saved, the node renders a "missing plugin" state with the previously-saved values shown read-only, rather than erroring.

**Glossary, resources, help**
- [ ] With the glossary extension selected, a glossary term/definition list is editable (add/edit/reorder/remove); with it deselected, the UI clearly says the extension isn't selected rather than silently allowing entries to be added.
- [ ] Same check for resources (entries plus the resource-ID value) and the help extension (popup text, and the items list where the extension supports it).

**Saving, concurrency, and locking**
- [ ] Save Draft persists all sections (header, plugins, tree, glossary/resources/help) in one action and shows a success confirmation.
- [ ] Open the same course in two browser tabs as the same user, save a change in tab 1, then attempt to save a *different* change in tab 2 - confirm tab 2 shows the conflict banner (not a silent overwrite) and that "Reload" discards tab 2's unsaved change and reloads the latest saved state.
- [ ] After an admin converts a course (once Phase 7 exists) or after manually setting `conversionStatus` to `converted` for a test record, reopening the course in the editor shows it as read-only (no Save Draft/Create Version actions, or they're disabled) while still allowing the content to be viewed.
- [ ] "Create Version" is only ever offered from the latest version state (not from an older, already-superseded version) and the resulting version number follows the minor/major rule correctly (1.0 -> 1.1 -> 2.0 etc.) end-to-end through the UI, not just via direct API calls.

**Validation surfacing**
- [ ] Trigger a server-side validation failure (e.g. a malformed hierarchy via direct API manipulation, or an invalid icon choice) and confirm the error surfaces inline near the relevant field/tree node in the UI, not only as a generic toast.
