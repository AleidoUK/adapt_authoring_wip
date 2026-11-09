# Phase 5: Shared Translatable Word Counts and Exports

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md). Depends on [Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md) for the schema-walking rules and [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) for the export-snapshot collection.

## Word editing workflow

The light course editor now has a **Word export / import** toolbar button. This is
Word-only and is not exposed in the template editor. Export saves the committed
draft first, downloads a `.docx` and records the export snapshot; persistence or
download failures are shown rather than treated as successful exports.

New Word documents use safe sequential section bookmarks and tagged rich-text
content controls for editable fields, with their
course ID, node IDs and exact field paths mapped in the `LightCourseWord` custom
property. Text fields are labelled separately from read-only contextual headings.
Each editable field has an Aleido-green outline (`@aleido-green`, `#61C6A2`).
Rich-text paragraphs also have green borders visible when the control is not selected.
The unique-ID control has a green text border; its adjacent word count is outside
the control and remains read-only. Controls cannot be deleted through normal Word
editing, but their contents can be replaced, extended with paragraphs or cleared.
The control tag, rather than the positions of its internal bookmark, identifies
the entire editable field. Grey labels and course context headings stay outside.
Word may move bookmark/comment range markers beside a paragraph inside its box;
these markers are accepted without becoming text or adding paragraph breaks.
Documents use Calibri with 12 pt body text and smaller 8 pt grey field labels;
the document title and section headings use `#61C6A2`, matching `@aleido-green`
in the authoring interface. Word stores the hex colour directly, and tests verify
it matches the LESS definition.
headings retain their larger sizes. The editable text remains its normal colour. Article and
block sections (including their field labels) are omitted from the Word document.
Their IDs remain in the mapping, so the course's articles, blocks and stored values
are preserved unchanged on import; pages and components remain visible.
Existing empty strings are included so they can be populated or cleared.
Page titles, page instructions, component translatable fields,
author Unique IDs, graphics/developer notes and glossary/resource/help text are
editable. Component Unique IDs precede the editable Title field, displayed as
`c-01_01_010 | 100 words` in 8 pt grey Calibri, without a Unique Id label.
The count is read-only and uses the core schema-based component word-count rules
at export time; it excludes review placeholders, labels and non-translatable notes/IDs.
Keep the count unchanged when editing the ID; it is never imported as part of the ID.
Other field values
remain 12 pt. Fields have a blank line's spacing between them. Graphics/developer
notes are italic. Every empty editable field (including visually blank rich text)
has a reviewer placeholder; replace it to add content. Leaving it unchanged
preserves the original empty value and markup.
Component context headings use the installed component display name (for example,
Text or Splash), without the editable title. Page context headings use the saved
section terminology and position (Section 1 or Topic 1), without the page title.

Version history, developer information and terminology use read-only tables.
Opening-page section headings have a blank line's spacing before them.
These tables, reviewing instructions and tags appear at the top. Missing developer/terminology settings
show the same defaults as the editor controls. Buttons/icons, menu content,
plugin selections and the general instructional headings are omitted.
The editable content starts on a new page, as does each topic.
These settings have no editable field bookmarks and never
overwrite course settings on import. Menu title/body edits in older mapped Word
documents are also ignored; edit these in the course editor instead. Historical
exports use the saved version's settings, not the current draft's.
Older snapshots without a recorded course title use the parent course's current
title; recorded historical titles are preserved. Word filenames start with the
course's tag titles, separated by underscores:
`{tag1}_{tag2}_{coursename}_v{version}.docx`. Tags retain their saved order;
historical exports use the tags recorded in that version, not the current draft.
Without tags, the filename remains `{coursename}_v{version}.docx`.
Unsafe filename characters are replaced, and Unicode names are preserved. An
unpublished course without a version uses `vdraft`.
Word-count rules are unchanged.

Word exports embed managed light-course images from component graphic fields
(including nested items), help graphics and rich-text image references as
read-only previews beside their content. PNG, JPEG, GIF and BMP are supported;
large images are scaled proportionally to fit the page. Unavailable, external
or unsupported images have a visible notice with their source instead.
Image previews are not imported, and Word edits never replace course assets.
The exported binary snapshot contains the embedded image bytes.
Non-item previews appear directly below the editable title, before the body.
Item previews follow that item's title/content, before the next item.
Each component also has an optional **Component screenshot** asset field below
its title in the light-course, template and component-default editors. This uses
the existing light-course image bank and appears below the title in tree/saved
version previews and Word exports. The screenshot reference is retained in
drafts, templates and saved versions; Word import never changes it.

New Word exports have Track Changes enabled by default. Import automatically
accepts tracked revisions in the imported text: insertions and move destinations
are retained; deletions and move sources are removed. Deleted paragraph marks
merge adjacent paragraphs. Formatting revisions use their current properties,
not the recorded previous formatting. New boxed exports preserve paragraphs,
line breaks, headings, bold, italics, underline, strikethrough, nested numbered/bulleted
lists, paragraph alignment and safe web/email/relative links in rich-text fields.
Plain text fields remain plain text. Word font, size and colour choices are not imported.
Unchanged fields preserve their exact original HTML, including attributes outside
the supported formatting subset. Changed fields use safely generated HTML for
that subset; arbitrary HTML, editable tables and embedded media are not supported.
Fields already containing tables/media must be edited in the course editor.
Older bookmark-only exports retain their existing plain-paragraph import behavior.
The uploaded Word file itself is not rewritten.
Keep the exported boxes and course headings intact; validation runs on the accepted
document and still rejects unknown, missing, duplicate, moved or reordered field
controls and course structure changes. Internal field bookmarks can be removed
without losing the field mapping. Older documents still require their bookmarks.
Import resolves field-label, read-only and heading styles from `word/styles.xml`
by their names, so Word can regenerate internal style IDs without causing
false bookmark/table errors. Unknown styles do not bypass the existing checks.
Page/component context headings are not
editable title fields: changing one rejects the whole import, even when its
labelled Title field is unchanged. Edit the value beneath the Title label instead.
The exported settings tables are read-only; their value edits are ignored,
and adding editable tables is unsupported. Older mapped documents retain their
original field layout on import.
Import targets this same draft and does not
create, delete or rearrange course elements. Import requires a minor (part) or major
(full) version choice, saves a new immutable version, and activates its content as
the editable draft without changing previous saved versions. Markdown endpoints remain unchanged
and have no new UI. See [Word import rules](LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md#word-import-workflow)
for validation and rich-text limitations.

## Original phase validation (backend)

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
