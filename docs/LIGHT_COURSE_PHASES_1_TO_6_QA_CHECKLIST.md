# Light Course Editor: Combined Manual QA Checklist (Phases 1-6)

A single, run-through-in-order checklist combining every "Manual QA/verification checklist" from
[Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md) through [Phase 6](LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md)
of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md), for testing
everything built so far in one pass. Each phase's items are unchanged from their source doc (linked
in each section heading) - this file just orders them so you don't have to open six documents.

Phases 7 (Admin Conversion) and 8 (Verification and Rollout) are not yet built, so a few items below
that reference conversion are marked accordingly and can only be smoke-tested, not fully verified,
until then.

## Before you start

- A running instance with a real installed Adapt framework checkout (Phase 1's schema analysis and
  several checks below depend on real installed components/extensions, not synthetic fixtures).
- An admin/Super Admin account, plus the ability to create a new user and assign the `Light Editor`
  role (or a tenant admin UI that can do this).
- At least one component type, and ideally the glossary, resources, help, and audio extensions
  installed, so the extension-gated checks below have something real to exercise.

---

## Phase 1 - Schema spike (developer/reviewer checklist, no UI)

From [LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md#manual-verification-checklist). No end-user UI exists for this phase - these are developer-facing checks, worth re-running whenever the installed framework/plugin set changes.

- [ ] Re-run the spike: diff the currently-installed `temp/<jobId>/adapt_framework/src/{components,extensions,menu,theme}` checkout against the file paths cited in the Phase 1 doc (`adapt-aleido-help`, `adapt-aleido-menuButton`, `adapt-aleido-reflection`, `adapt-contrib-glossary`, `adapt-contrib-resources`) - confirm the cited schema paths/fields still exist and still match the documented shapes.
- [ ] Run `node_modules/.bin/mocha test/lib.schemawalker.js` directly - confirm all tests pass.
- [ ] Spot-check `lib/schemaWalker.js` against one schema not already covered by its tests (e.g. an installed `adapt-contrib-*` component not in the fixtures) - confirm the `translatablePaths`/`assetPaths`/`requiredDefaults` it returns look right by eye.
- [ ] Re-read the Phase 1 doc's per-control button/help-screen icon validation table against the real installed `adapt-aleido-menuButton`/`adapt-aleido-reflection`/`adapt-aleido-help`/`core/schema/config.model.schema` files - confirm the option lists/paths/defaults haven't drifted.
- [ ] Confirm `test/fixtures/lightcourse/`'s saved schema files still match the real installed files byte-for-byte (`diff` them against the live checkout).

## Phase 2 - Storage, API, auth (backend API checklist)

From [LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md#manual-verification-checklist). A manual `curl`/Postman pass against a real running instance, with a realistic admin + light editor pair, not just the fixed automated-test users.

- [ ] Create a user, assign the `Light Editor` role, log in as that user.
- [ ] `POST /api/content/lightcourse` with just a `title` - confirm `201`/`200` with `revision: 0` and sensible defaults (`conversionStatus: "none"`, empty `contentTree`/`pluginSelections`/arrays).
- [ ] `GET /api/content/lightcourse` and `GET /api/content/lightcourse/:id` as that same user - confirm both return the course.
- [ ] `PUT /api/content/lightcourse/:id` with the *current* `revision` - confirm `200` and the stored `revision` incremented by 1.
- [ ] Immediately `PUT` again reusing the *old* (now stale) `revision` - confirm `409`, and that the draft's actual stored content was **not** changed by the rejected request.
- [ ] `POST /api/content/lightcourse/:id/versions` with the current `revision` and `bump: "minor"` - confirm the response `versionNumber` is `"1.0"` on the very first publish, `"1.1"` on a second minor publish, and `"2.0"` after a `bump: "major"` publish.
- [ ] `PUT`/`DELETE` on the resulting `/api/content/lightcourseversion/:id` - confirm both are rejected regardless of role (immutability is enforced even for a tenant admin).
- [ ] Set `conversionStatus` to `"converted"` directly in Mongo for a test draft, then attempt `PUT /api/content/lightcourse/:id` as its owner - confirm it's rejected (locked-after-conversion).
- [ ] As the Light Editor user: `GET /api/content/course` - confirm it's rejected (no full-course access); `POST /api/asset` (upload) succeeds; `DELETE /api/asset/:id` on *that same just-uploaded* asset is rejected (the ownership-auto-grant override); `DELETE /api/asset/:id` on an asset uploaded by a different (admin) user is also rejected.
- [ ] `POST /api/content/lightcoursetemplate` as the admin user, then `POST /api/content/lightcourse` as the Light Editor with `_templateId` set to that template's ID - confirm the created course's `contentTree`/`glossaryItems`/`resourceItems` IDs are all *different* from the template's original IDs, while the structure/text content matches.
- [ ] Log in as a user with **only** the `Course Creator` role (no `Light Editor` role) - confirm `GET /api/content/lightcourse` is rejected, i.e. full-course editors don't automatically gain light-course access.
- [ ] Restart the server once after adding/editing `lib/role/LightEditor.json` and confirm no errors are logged during `installDefaultRoles`/`syncDefaultRoles` role sync.

## Phase 3 - List and editor shell (browser UI checklist)

From [LIGHT_COURSE_PHASE3_LIST_AND_EDITOR.md](LIGHT_COURSE_PHASE3_LIST_AND_EDITOR.md#manual-qa-checklist). Run against a real build (`grunt build`) and a real browser session, logged in as a `Light Editor`.

**Navigation and access**
- [X] A user with the `Light Editor` role sees a "Light Course Editor" item in the global menu; a user with only `Course Creator` does not.
- [X] A full admin (`Super Admin`) also sees the item and can enter the area.
- [X] Being a light editor alone does not add a full-course dashboard link, and does not grant access if the full-course dashboard URL is entered directly.

**List and create**
- [X] The list page loads and shows all light courses in the tenant (not just the current user's own), with title, last-updated date, latest version (or "Draft only"), and state columns populated correctly.
- [ ] **Create** opens a title + template picker + Save form; Save with an empty title shows a validation message and does not submit.
- [ ] Creating with no template selected produces a blank course (empty tree, no plugin selections).
- [ ] Creating with a template selected produces a course whose structure/text matches the template, but whose node IDs are visibly independent (confirm by checking the network response's `contentTree`/`glossaryItems` `_id` values against the template's, per the Phase 2 checklist).
- [ ] After Save, the new course appears in the list; both the **Edit** button and a double-click on its title in the list open the same editor.

**Editor shell, header sections**
- [ ] Version history table renders, Notes/Est. duration cells are editable, other columns are not, and "Add row" appends a manual row.
- [ ] Reviewing instructions textarea, developer-info dropdowns/checkbox, and terminology dropdowns all persist their values across a Save Draft + page reload.
- [ ] Button icon pickers (Menu, Reflection, Help) are populated from the *installed* extensions' real option lists (cross-check against the Phase 1 icon table) - not a hardcoded list - and default to the first option when nothing has been chosen yet.
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
- [ ] After an admin converts a course (**not yet built - Phase 7**) or after manually setting `conversionStatus` to `converted` for a test record, reopening the course in the editor shows it as read-only (no Save Draft/Create Version actions, or they're disabled) while still allowing the content to be viewed.
- [ ] "Create Version" is only ever offered from the latest version state (not from an older, already-superseded version) and the resulting version number follows the minor/major rule correctly (1.0 -> 1.1 -> 2.0 etc.) end-to-end through the UI, not just via direct API calls.

## Phase 4 - Components, plugins and images (browser UI checklist)

From [LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md#manual-qa-checklist). Builds on Phase 3's checklist above - run these once Phase 3's navigation/list/tree checks pass.

- [ ] Open a component's field editor for a component with translatable items (e.g. one with nested `_items[]`) - confirm each item's fields render correctly (add/remove item rows work, text saves correctly) and that only translatable/asset fields appear, never settings/style fields.
- [ ] Confirm a component with a `uniqueId`-mapped extension shows a "Unique ID" field; one without does not.
- [ ] With the audio extension selected among the course's Extensions, confirm an audio field (upload/choose-from-bank + transcript) appears on components; deselect the extension and confirm it disappears.
- [ ] Choose an image field's "Choose from bank" - confirm it lists only images (not audio/other types), shows a "Used in this course" badge on assets already attached to this course, and that selecting one updates the preview thumbnail immediately.
- [ ] "Upload new" on an image/audio field - confirm the file uploads, becomes the field's value, and is attached to this course's bank (re-open "Choose from bank" and confirm it now shows as used).
- [ ] Simulate a removed plugin (clear/rename a `componenttype` record for a type already used in a saved course, or just pick an uninstalled-looking name) and confirm the node renders its last-known values read-only with a "missing plugin" message, rather than failing to render.
- [ ] Toggle the glossary extension on/off in Plugin selections - confirm the glossary editor appears/disappears accordingly (with the "extension not selected" message shown when off) without needing a page reload.
- [ ] Add/edit/reorder/remove glossary entries, then Save Draft + reload - confirm all changes persisted in order.
- [ ] Same checks for resources entries (including the `_type` dropdown and `_link` field) and for help content (popup title/body/instruction plus the items list with icon/title/body) - each gated correctly on its own extension.
- [ ] Confirm there is no "pop-up vs. graphic walkthrough" style choice anywhere in the help editor (per Phase 1's resolved finding).

## Phase 5 - Word counts and document export (backend API checklist, no new UI)

From [LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md](LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md#manual-qa-checklist). No new frontend UI this phase, so these checks exercise the HTTP endpoints directly - log in as a Light Editor (or use an authenticated browser/Postman session) with a light course that has at least one component, a glossary entry, a resource entry and some help content saved.

- [ ] `GET /api/content/lightcourse/:id/wordcount` returns `200` with a plausible `screens`/`componentWords`/`glossaryWords`/`resourceWords`/`helpWords`/`total` breakdown that goes up when you add more text to a component, a glossary term, or help content, and goes down when you remove it.
- [ ] `GET /api/content/lightcourseversion/:id/wordcount` (for a version already published from that draft) returns the **same** counts as the draft had at the moment of publishing, and does **not** change afterwards even if you keep editing the draft.
- [ ] `GET /api/content/course/:id/wordcount` on a real full course returns a plausible component/screen count (glossary/resources on full courses are intentionally excluded from this total - don't expect them to be counted).
- [ ] A Light Editor without access to a given light course gets `403`/`404` (not the word count) from all three endpoints above.
- [ ] `GET /document-export/:tenant/:lightCourseId?format=markdown` downloads a `.md` file; open it in a plain-text editor and confirm: a title heading, one heading per page/article/block/component matching the course's structure, an invisible `<!-- lcid:... -->` comment directly above each of those headings (but **not** above the title or the "## Glossary"/"## Resources"/"## Help" dividers), and - if glossary/resource/help content exists - matching sections with one `#####` heading per entry.
- [ ] `GET /document-export/:tenant/:lightCourseId?format=docx` downloads a `.docx` file that opens correctly in Word/LibreOffice/Google Docs, with the same heading structure as the Markdown export (bookmarks are invisible in normal viewing - no visual check needed for those).
- [ ] Repeat both of the above against a **published version's** ID instead of the draft's - confirm the exported content matches that version's snapshot, not the current (possibly further-edited) draft, and that the document is clearly labelled as a version (not "DRAFT") somewhere in its header.
- [ ] Export the current **draft** and confirm the generated document is clearly labelled as a draft somewhere in its header (e.g. in the title block), distinguishing it from a published version export.
- [ ] After each export above, confirm a new record was persisted (ask an admin/DB check, or re-trigger and confirm timestamps differ) rather than the endpoint silently reusing an old one - exports must remain retrievable as point-in-time copies even after the draft/version changes further.
- [ ] Request an unknown/garbage ID on `/document-export/:tenant/:id` and confirm a `404`, not a `500` or a blank/corrupt file.

## Phase 6 - Versions, comparison and document import (backend API checklist, no new UI)

From [LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md](LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md#manual-qa-checklist). No new frontend UI this phase either - log in as a Light Editor with an existing light course that has a published version and some draft edits beyond it.

- [ ] `POST /api/content/lightcourse/:id/versions` with `bump: "minor"` on a never-published course creates version `1.0`; repeat with `minor` then `major` and confirm `1.1` then `2.0`, per the numbering rule.
- [ ] Publish from two browser tabs/sessions using the same stale `revision` - confirm the second one gets `409` rather than creating a duplicate/corrupt version.
- [ ] `GET /api/content/lightcourse/:id/versions` lists every published version in order.
- [ ] Try `PUT`/`DELETE` directly against a published `lightcourseversion` (e.g. via Postman) - confirm it's rejected regardless of role, since versions are immutable at the data layer.
- [ ] `GET /api/content/lightcourse/:id/versions/compare?a=<v1>&b=<v2>` between two real versions shows the actual added/deleted/moved/changed components and glossary/resource/help items you'd expect from what changed between them, plus any menu/theme/extension changes.
- [ ] Compare a version against itself (`a` and `b` the same ID) - confirm `hasChanges: false`, not an error.
- [ ] With the draft edited since the last publish, `POST /document-import/:tenant/:id` (no `confirmed` field) with an exported-then-reviewed document - confirm it's rejected with `409`/`requiresConfirmation: true` rather than silently overwriting your unsaved edits.
- [ ] Retry the same import with `confirmed=true` - confirm it now succeeds, the edited text appears in the draft, and a new row appears at the bottom of the header's Version History table with the correct Version/Date/Author/Screens/Words (Notes/Est. duration blank and editable).
- [ ] Edit the exported Markdown/`.docx` to delete a page/article/block/component's heading (or its whole section) and re-import - confirm a specific "missing expected section" error, not a partial import or a crash.
- [ ] Reorder two sections in the exported document (e.g. swap two components) and re-import - confirm a specific "reordered" error.
- [ ] Add an extra paragraph inside one component's body text (without touching any other component) and re-import - confirm only that component is reported as an error (naming it specifically) and that every *other* edited component's text change in the same import was **not** applied either (validate-before-apply, not partial).
- [ ] Import the exact same document back unmodified - confirm it succeeds with no changes reported and a version-history row is still added (one row per import, regardless of whether anything textually changed).

---

## A suggested end-to-end run

If you only have time for one pass rather than every item above, this single flow touches the
core of all six phases in order and is the closest thing to the "real" editorial workflow:

1. Create a light course from a template (Phase 2/3) as a Light Editor.
2. Build out a page/article/block/component tree, add a glossary entry, a resource, and help
   content (Phase 3/4), including at least one image field and one audio field (with the audio
   extension selected).
3. Save Draft, check the word count (Phase 5), publish version `1.0` (Phase 2/6).
4. Export the draft as both Markdown and `.docx` (Phase 5), edit the Markdown's text in a plain
   editor, and re-import it with `confirmed=true` (Phase 6) - confirm the text change lands and a
   version-history row appears.
5. Publish version `1.1`, then compare `1.0` vs `1.1` (Phase 6) and confirm the diff matches what
   you actually changed.
