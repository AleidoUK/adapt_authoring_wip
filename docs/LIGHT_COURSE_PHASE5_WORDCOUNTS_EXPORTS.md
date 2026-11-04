# Phase 5: Shared Translatable Word Counts and Exports

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md). Depends on [Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md) for the schema-walking rules and [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) for the export-snapshot collection.

## Implementation status: done, backend only (no frontend UI this phase)

Validated via the full backend suite (123 passing / the same 14 pre-existing unrelated assetmanager/contentmanager failures as every prior clean run - confirmed no regressions from the `lightcourseexport` schema change or the new word-count/document-export routes) plus 33 passing direct-Mocha unit tests across [test/lib.lightcoursewordcount.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcoursewordcount.js) and [test/lib.lightcoursedocuments.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcoursedocuments.js). This phase is backend-only (word-count endpoints + document-export route/generator) - there is no new frontend UI to smoke-test via the build pipeline, so the **Manual QA checklist** below is scoped to exercising the HTTP endpoints directly (e.g. via the browser/`curl`/Postman) rather than a live editor session.

**Two real bugs found and fixed while building the document generator** ([lib/lightcourse/documentGenerator.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/lightcourse/documentGenerator.js)): (1) a `level` computation bug that leaked `.docx`-specific heading-level enums into the format-agnostic block-collection step, corrupting Markdown heading levels; (2) the round-trip parser initially flagged the document title and the fixed "## Glossary"/"## Resources"/"## Help" section-divider headings as structural errors (missing `lcid` comments), and body text leaked across those dividers - fixed by treating them as "furniture" headings (no `lcid` expected, but still reset the current-block pointer) and switching glossary/resource/help items to real `#####` Markdown headings instead of `**bold**` text.

**A schema gap found while wiring the export route**: [plugins/content/lightcourseexport/model.schema](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/lightcourseexport/model.schema) originally required `_versionId`, which would have made it impossible to export (and persist a point-in-time copy of) the current **draft** - contradicting the main plan's "allow exporting... the latest draft only if clearly labelled as a draft". Fixed by making `_versionId` optional and adding a required `_lightCourseId` (present on both draft and version exports) plus an `isDraft` boolean.

**Full-course word count is deliberately scoped to component/screen counts only** (`GET /api/content/course/:id/wordcount`) - it does not walk course-level extension content (glossary/resources patched onto the real course schema via `pluginLocations.course.*`), since resolving which extensions are enabled for a full course requires the same `Origin.editor.data`-dependent complexity already identified as a blocker for the frontend `Schemas()` wrapper in Phases 3/4. Revisit if full-course editors need glossary/resource words included in their total.

**Document-export route** ([routes/document-export/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/routes/document-export/index.js)) follows the `routes/export/index.js` convention exactly (own top-level directory, auto-discovered by [lib/router.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/router.js)'s directory scan, `permissions.ignoreRoute(...)`, manual tenant/permission check) and resolves either a `lightcourse` draft or a `lightcourseversion` by ID, trying the draft collection first. It fetches the relevant content-plugin instance via the standard `app.contentmanager.getContentPlugin(...)` (not a direct `require` of the plugin file) so permission checks go through the exact same `hasPermission()` override each plugin already defines. `.docx` output is base64-encoded into the same `renderedText` string field the Markdown export uses, rather than introducing a separate binary-file-storage mechanism, since these are expected to be small, text-centric documents.

## No existing word-count/schema-walking utility (confirmed, build new)

A repo-wide search (excluding `node_modules` and the `temp/` framework checkout) found no existing word-count or generic "walk a schema for translatable fields" utility anywhere in this codebase. [lib/outputmanager.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/outputmanager.js)'s `getCourseJSON()`/`getConfigJson()` (confirmed ~lines 94-183) flatten Mongo documents into the export JSON shape but do nothing with translatable-field semantics. This must be built from scratch as a new, shared service.

## Shared service design

Create `lib/lightcoursewordcount.js` (or `plugins/content/lightcourse/wordcount.js` if kept plugin-local) exposing a single schema-walking function used by **both** the light-course word-count endpoint and the full-course word-count feature referenced in the main plan ("Existing full-course editors can see translatable word counts... For full courses use the same service with the full-course access checks"):

```js
function walkTranslatableFields(schema, data) {
  // returns [{ path, text }] for every stored string where:
  //   schema.translatable === true            (AT model.schema / draft-04 properties.schema dialect)
  //   OR schema._adapt && schema._adapt.translatable === true   (2020-12 $patch dialect, e.g. glossary/resources)
  // recurses into object/array children using schema.properties / schema.items
}
```

This is the direct deliverable from [Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md)'s fixture work - use the same fixtures as the function's unit tests. Explicitly **exclude** `Graphics Notes`, `Developer Notes` and all document header fields (version history, reviewing instructions, developer information, terminology, button/help-icon choices) from the traversal - these are stored outside the schema-driven field set already (per [Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md)'s design), so they are naturally excluded as long as the walker only ever receives the real component/course schemas, never the header-data structure.

## Word-count rule

Strip HTML markup, decode entities, normalize whitespace, then split on whitespace to count words - agree and unit-test this against rich-text fixtures (bold/links/lists) and at least one non-English/multilingual fixture, per the main plan. Apply the same tokenizer to per-component and course-level totals so they sum consistently. A "screen" is one component - the screen count is just `contentTree` component-node count (no new logic needed beyond a tree walk already required for rendering).

## Endpoints

- `GET api/content/lightcourse/:id/wordcount` (draft) and `GET api/content/lightcourseversion/:id/wordcount` (version) - call the shared service against the stored `contentTree`/`contentSnapshot` plus `pluginSelections`-resolved component/extension schemas.
- Full-course equivalent: `GET api/content/course/:id/wordcount`, added as a custom route in [plugins/content/course/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/course/index.js)'s `initialize()` (same place `/duplicatecourse/:id` is added, confirmed), reusing the same `walkTranslatableFields` service and existing `CourseContent.prototype.hasPermission` checks - so full-course editors get this without any light-role grant, per the main plan's explicit requirement that this doesn't widen light-role access.

## Document export (Markdown and `.docx`)

No existing reusable "build a document from a course" utility exists either - the nearest relative is [plugins/output/adapt/export.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/output/adapt/export.js)'s ZIP-building pipeline, which is architecturally the right template to follow (build to a temp directory, then package/stream) but produces framework-runnable output, not a reviewable document - this needs a new, separate generator.

- New plugin or library module (not reusing `plugins/output/adapt`) that walks a `lightcourseversion.contentSnapshot` (or the current draft) and the document header data, emitting Markdown directly and `.docx` via a library such as `docx` (Node) - pick one during implementation; no existing dependency for this was found in `package.json`, so it's a new dependency to add.
- **Stable node ID embedding: resolved as a product decision.** Markdown: an invisible `<!-- lcid:<nodeId> -->` HTML comment on its own line directly above each heading/block (trivial regex to parse on import, preserved by plain-text/Markdown editors). `.docx`: a named Word bookmark (`lcid_<nodeId>`) wrapping each heading/paragraph, using the `docx` library's bookmark support (invisible, survives normal Word editing). If a comment/bookmark is missing or duplicated on import, surface it as a structural-validation error per this phase's "reject, don't guess" rule - never fall back to guessing the ID from position/text.
- **New routes**, following the confirmed `routes/export`/`routes/import` convention (own top-level `routes/<name>/index.js`, dynamically picked up by [lib/router.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/router.js)'s directory scan, confirmed ~lines 18-21): `routes/document-export/index.js` exposing `GET /document-export/:tenant/:lightCourseOrVersionId?format=markdown|docx`, calling `permissions.ignoreRoute(/^\/document-export\/?.*$/)` and doing its own tenant/permission check exactly as [routes/export/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/routes/export/index.js) does (`helpers.hasCoursePermission` equivalent, swapped for the light-course permission check from [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)).
- Allow exporting any immutable version, and the latest draft only if clearly labelled as a draft in the generated document's header, per the main plan.
- Full-course document export/import reuses the same generator against `course`/`contentobject`/`article`/`block`/`component` documents instead of a `lightcourseversion` snapshot - keep the input to the generator an abstract "resolved content tree + header data" shape so both callers can feed it without the generator knowing which content type it came from.

## Export persistence (point-in-time copy)

Per the main plan, "exporting a document must also persist a point-in-time copy of its rendered text and any referenced images, keyed to that export/version, so earlier exports remain retrievable even after the draft changes further." Use the `lightcourseexport` collection introduced in [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) (`_versionId`, `format`, `renderedText`, `assetSnapshotRefs`, `exportedAt`) - write a record every time `document-export` succeeds, and serve historical exports by record ID rather than by re-rendering the (possibly since-changed) draft/version.

## Tests

Unit tests for the schema walker (both dialects, nested items, HTML stripping, multilingual fixtures using [Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md)'s saved fixtures), screen-count correctness, and document round-trip (export then re-parse structure/IDs) - add under `test/lib.lightcoursewordcount.js` and `test/lib.lightcoursedocuments.js`, following the confirmed Mocha/Supertest/`should` convention (auto-discovered by `test/entry.js`).

## Manual QA checklist

No new frontend UI this phase, so these checks exercise the HTTP endpoints directly rather than the editor's own screens - log in as a Light Editor (or use an authenticated browser/Postman session) and, for a light course with at least one component, a glossary entry, a resource entry and some help content saved:

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
