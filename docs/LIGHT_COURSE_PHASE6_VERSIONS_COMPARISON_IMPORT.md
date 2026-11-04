# Phase 6: Versions, Comparison and Document Import

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md). Depends on [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) (version collection, concurrency) and [Phase 5](LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md) (export generator, to build the inverse import parser against the same format).

## Implementation status: done, backend only (no frontend UI this phase)

Validated via the full backend suite (155 passing / the same 14 pre-existing unrelated assetmanager/contentmanager failures as every prior clean run) plus 19 passing direct-Mocha unit tests across [test/lib.lightcourseversiondiff.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcourseversiondiff.js) and [test/lib.lightcoursedocumentimport.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcoursedocumentimport.js), plus a new [test/lib.lightcourseversions.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.lightcourseversions.js) integration suite (version publishing, comparison, and document-import HTTP flows) exercised as part of that full-suite run. Like Phase 5, this phase is backend-only - the **Manual QA checklist** below exercises the HTTP endpoints directly.

**Two explicit product decisions were confirmed with the user before building the import endpoint** (the main plan flags the first as a hard precondition, and the second emerged while designing the text-reapplication logic):
- **Unsaved draft handling: confirm, don't silently discard.** If the current draft differs from its latest published version (or, when nothing has ever been published, the draft has any real content at all), `POST /document-import/...` rejects with `409 { requiresConfirmation: true }` unless the request includes `confirmed=true` - the client is expected to show a warning and let the user explicitly choose to proceed.
- **Strict per-component field mapping.** A component's body in the exported document is the concatenation of however many translatable fields it has, one per line. On import, the edited text is split back into that same number of lines and zip-assigned back onto those fields, in schema order. If the line count no longer matches (a paragraph was added or removed within a component), only *that* component's import is rejected with a specific error - never guessed, never partially applied.

**Two existing pieces turned out to be smaller than a full rebuild**: `POST .../versions` (publish) and the `lightcourseversion` immutability/concurrency enforcement were already fully built and tested in [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) - nothing to add here. `GET .../versions/compare` already existed too, but only as a minimal `pluginSelections`-only diff with an explicit comment flagging it as a Phase 6 placeholder - this phase replaced it with the full ID-keyed content-tree/glossary/resource/help diff the main plan calls for, via a new shared service, [lib/lightcourse/versionDiff.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/lightcourse/versionDiff.js).

**A real pre-existing bug found and fixed while testing the new comparison feature**: comparing a version against itself (`?a=X&b=X`, e.g. to confirm "no changes since publish") returned a `404`, because the lookup query's `_id: { $in: [X, X] }` naturally de-duplicates to a single matching document, failing the old "exactly 2 results" check. Nobody had tested this case before since the old minimal diff was never exercised this way - fixed in `compareVersions()` (plugins/content/lightcourse/index.js) to expect 1 result when `a === b`.

**A `.docx` export/import format inconsistency found and fixed while building the inverse parser**: [Phase 5](LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md)'s `.docx` generator rendered glossary/resource/help *item* headings as a bold run with no real Word heading style, while the Markdown generator used a real `#####` (H5) heading for the same items - an inconsistency invisible until something needed to tell "a real heading" apart from "just bold text" programmatically. Fixed by giving `.docx` items a real `Heading5` paragraph style too (`lib/lightcourse/documentGenerator.js`), so both formats' parsed intermediate representation is uniform and Phase 6's import logic doesn't need format-specific cases.

**No existing XML/zip library was available as a declared dependency for reading `.docx` back** (only `docx`, which is generation-only, plus `unzipper`, already used for other ZIP needs) - added `fast-xml-parser` as a new, explicit direct dependency (confirmed via `npm ls` that it was previously only an undeclared transitive dependency of `mongodb`'s AWS SDK credential providers, not something safe to rely on directly) for `parseDocx()`'s OOXML reading.

**Import validates structure, in full, before applying any text change** - `lib/lightcourse/documentImport.js`'s `importDocument()` always runs `validateStructure()` (missing/unexpected/reordered sections, or anything `parseMarkdown()`/`parseDocx()` itself already flagged) to completion first; text is only ever written in a second pass, and only if every component's field count matched - confirmed by a dedicated test that edits two components at once (one with a structural error, one with a valid text edit) and asserts the valid one's edit was *not* applied either.

**Not built this pass**: the help popup's optional `instruction` field is not re-applied by import (`generateMarkdown()`/`generateDocx()` only emit it conditionally, so it can't use the same strict schema-driven line-count rule the rest of a component's fields use) - edit it via the editor instead; a deliberate, documented scope reduction rather than a guessed partial fix.

## Version creation

`POST api/content/lightcourse/:id/versions` (added in [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)): body includes the requested bump (`minor`/`major`) and the client's last-known `revision`. Server logic: re-read the draft and its latest `lightcourseversion` inside one conditional-update boundary (same mechanism as the optimistic-concurrency save path in Phase 2), compute the next number (first version is `1.0`; minor increments the second number; major increments the first and resets the second to `0`, per the main plan), write a new immutable `lightcourseversion` record, and return the new version. If the conditional check fails (someone else published first), return 409 and let the client re-fetch.

## Comparison

`GET api/content/lightcourse/:id/versions/compare?a=<versionId>&b=<versionId>` (also added in Phase 2): since both versions store a full `contentSnapshot` with stable per-node IDs (IDs are generated once at node-creation time and never regenerated across saves/versions, per [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)'s model design), comparison is a diff keyed by those IDs, not a text-similarity diff:
- Build an ID -> node map for each snapshot.
- Nodes present in both: diff translatable field values (reuse [Phase 5](LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md)'s `walkTranslatableFields` to get comparable path/value pairs from each side) and flag text changes.
- Nodes only in `a`: deleted. Nodes only in `b`: added. A node present in both but with a different parent/index: moved.
- Diff `pluginSelections` (menu/theme/extensions) as a simple set comparison.
- No existing diff/comparison utility was found elsewhere in the codebase to reuse - this is new code, but the ID-keyed approach above is possible specifically because [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) deliberately keeps stable IDs rather than relying on Mongo-assigned ones, so get that design decision locked in Phase 2 before starting this phase.

Older versions remain read-only: `lightcourseversion`'s `hasPermission` (Phase 2) denies `update`/`delete` unconditionally, so "open for review, compared and exported, but not changed" is enforced at the data layer, not just hidden in the UI.

## Document import

Reuses [Phase 5](LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md)'s generator in reverse: parse the same Markdown/`.docx` structure back into a content tree keyed by the embedded stable node IDs.

- **Structural changes are rejected, not guessed.** If headings/identifiers/order don't match the expected shape (reordered blocks, renamed/missing node IDs, added/removed headings), return a specific, actionable error listing what's wrong - never partially import or silently relocate content, per the main plan. This means the parser must validate structure *before* applying any text changes, not interleave validation with mutation.
- Supported formatting (paragraphs, headings, lists, emphasis, links) round-trips through whatever intermediate representation [Phase 5](LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md)'s generator uses internally; anything else is reported as unsupported rather than attempted, per the main plan ("Unsupported styling will be reported, not silently promised as a perfect match").
- Import creates/updates the **draft** based on the latest version, never a version directly - publishing the next version remains an explicit separate action (`POST .../versions`, above), per the main plan.
- **Existing unsaved draft handling is an explicit product decision needed before this is implementable, not a technical detail**: the main plan requires defining whether import requires confirming replacement of an existing unsaved draft, or requires the draft to be saved/versioned first - "never silently discard it." Get this decision recorded before building the import endpoint; it changes the endpoint's request/response contract (a confirmation round-trip vs. a hard precondition check).
- On successful import, append a new version-history row automatically to `headerData.versionHistory` with server-calculated Version/Date/Author/Screens/Words and empty editable Notes/Est. duration, per the main plan and [LIGHT_COURSE_EDITOR.md](LIGHT_COURSE_EDITOR.md).

## Routes

`routes/document-import/index.js`, mirroring the confirmed `routes/import/index.js` shape (`permissions.ignoreRoute(/^\/document-import\/?.*$/)`, own permission check, `PartialImportError`-style typed error handling following [routes/import/index.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/routes/import/index.js)'s existing pattern for returning translated success/failure messages) - `POST /document-import/:tenant/:lightCourseId` accepting the uploaded file.

## Tests

`test/lib.lightcourseversions.js`: version-number sequencing (1.0 -> 1.1 -> 2.0), concurrent-publish 409, immutability enforcement (update/delete rejected on a version even via direct API), comparison correctness against the Phase 1 fixtures (added/deleted/moved/changed nodes, plugin-selection diffs), import validation (structural-change rejection with a specific error, auto version-history row on successful import, draft-replacement confirmation flow once the open product decision above is resolved).

## Manual QA checklist

No new frontend UI this phase, so these checks exercise the HTTP endpoints directly - log in as a Light Editor with an existing light course that has a published version and some draft edits beyond it:

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
