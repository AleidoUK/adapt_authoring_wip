# Phase 7: Admin Conversion

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md). Depends on [Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md) (icon/plugin validation matrix), [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) (locking/permissions) and [Phase 6](LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md) (only the latest published version is convertible).

## Reuse the existing import pipeline's approach, not full-course CRUD directly

The closest existing reference for "build real `course`/`contentobject`/`article`/`block`/`component` Mongo documents with correct parent-ID remapping and asset import from an external representation" is [plugins/output/adapt/importsource.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/output/adapt/importsource.js) (confirmed sequence: `retrieveImportInfo -> prepare -> installPlugins -> addAssets -> cacheMetadata -> importContent`, ~lines 24-72; `importContent()` creates the Mongo documents and reconnects parent IDs from the cached, ID-remapped JSON). Conversion should follow the same *shape* of pipeline - read the light course's final content, remap IDs, create real content documents in parent-first order, import/relink assets - rather than inventing a new content-creation mechanism. It should **not** call `importsource.js` directly (that module is built around parsing an uploaded ZIP's file layout, which a light course isn't), but should mirror its ID-remapping and ordered-creation strategy.

## Preflight (confirmed validation targets from Phase 1)

Before any write:
- **Component/plugin availability**: every `_component` in the tree has a live `componenttype` record (not just a stored snapshot - see [Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md)'s "missing plugin" handling); same for the selected menu/theme/extensions via `menutype`/`themetype`/`extensiontype`.
- **Required defaults**: every field the installed schema requires but the light editor didn't expose (video/audio/other settings, per [Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md)) has a configured default in `lightcourseconfig` ([Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)) - do not assume a placeholder file's mere presence satisfies the plugin's schema validation; actually validate the composed document against the real schema before writing (reuse whatever schema-validation call [lib/contentmanager.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/contentmanager.js)'s own `create` path already performs, so conversion fails the same way manual content creation would).
- **Image/audio/media assets and unique IDs**: referenced bank assets still exist and belong to the tenant; `uniqueId` values map correctly to `_extensions._uniqueId._id` (per Phase 1) on the right node types.
- **Button/help-screen icon validation, per the confirmed Phase 1 finding**: validate each chosen icon **against its owning extension's specific option list**, not a single shared theme/menu list (`adapt-aleido-menuButton`: 9 options, `adapt-aleido-reflection`: 5 options, `adapt-aleido-help`: 2 options, side-drawer: freeform text so no validation needed, **Back button: not configurable at all - skip validation for it entirely, don't require or reject a value**). Fail with an actionable, per-control error naming the invalid icon and the valid set, not a generic "invalid configuration" message.
- **Glossary/resources/help extension installed-ness**: if the course selected these extensions, confirm they're actually installed in the target framework version before writing (per the main plan).
- **Schema validation and tenant membership** for every node and every referenced asset.

Show all failures together (not fail-fast on the first one) so the admin gets one actionable list per the main plan's "actionable failures before any write."

## Conversion write

1. Create the `course` document, then `contentobject`/`article`/`block`/`component` documents in parent-first order, remapping light-course stable IDs to new Mongo IDs as each parent is created (same dependency order `importsource.js` already uses).
2. Apply selected plugins (menu/theme/extensions) and the admin-configured defaults to the new documents.
3. Assign left/right layout for paired components (per the main plan - this is a `_classes`/layout-field write on the component, following whatever convention the installed theme's two-column block layout already uses - confirm the exact class/field name against the target theme during implementation, it wasn't inspected in this spike).
4. Write the chosen navigation icons into the generated course's config/extension documents at the paths identified in the Phase 1 matrix (e.g. `_help._navItem._icon`, the menuButton extension's own icon field, `_config._drawer._iconClass`) - this is the **one** piece of document header data that *does* carry over, per the main plan.
5. Populate glossary/resources/help extension configuration from the saved entries, carrying resource ID values through unchanged (pending the Phase 1 follow-up on the real resource ID field name).
6. Discard all other document header data and every component's Graphics Notes/Developer Notes - they stay on the light course for reference only (confirmed as already structurally separated from component schema values per [Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md), so "discarding" them is simply never reading those fields during conversion, not an active redaction step).
7. Keep an ID-mapping table (light-course node ID -> new full-course Mongo ID) for audit/troubleshooting.

## Audit trail (confirmed reusable pattern)

[plugins/content/auditlog/](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/auditlog) already provides a working audit-entry pattern via `app.contentmanager.addContentHook('create', '*', {when:'post'}, ...)` (confirmed in `index.js`, ~lines 70-73/88-146), writing entries with `action`/`contentType`/`contentId`/`userId`/`timestamp`/`snapshot`/`changes` to its own `auditlog` collection. Conversion will **already** generate standard `create` audit entries for every new `course`/`contentobject`/`article`/`block`/`component` document for free, since those hooks fire on `app.contentmanager.create(...)` calls regardless of caller. For the light-course-specific ID-mapping record (light ID -> full ID per node, which the generic audit hook doesn't capture), write a dedicated record - either as `metadata` on the course-level audit entry, or as its own small collection (`lightcourseconversionlog`, following the same minimal `ContentPlugin` shape as `lightcoursebankasset`) if per-node queryability is needed for troubleshooting.

## Atomicity and idempotency

No existing Mongo transaction usage was found in this codebase to copy (confirmed: content creation throughout uses sequential `db.create`/`db.update` calls, not Mongo multi-document transactions). Given that, implement conversion as:
1. Write all new documents tagged with a `_lightCourseConversionId` (a generated token) so a failed attempt's partial writes are identifiably group-deletable.
2. On any failure after step 1 begins, delete every document tagged with that token (cleanup), then return the failure - the light course stays editable and unlocked.
3. Only after the full set is written **and** validated (e.g. attempt a schema-level re-read/validate of the new course, "verify the generated course opens and validates before setting the converted state," per the main plan) do you: set `lightcourse.conversionStatus = 'converted'` and `_convertedCourseId`, using the same conditional-update-on-`revision` mechanism from [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) so a retry can't double-lock or double-create.
4. For retried conversions (idempotency): check `conversionStatus` first - if already `converted`, return the existing `_convertedCourseId` rather than creating a second course; if `failed`/`none`, proceed as a fresh attempt (prior partial writes, if any, were already cleaned up in step 2).

## Permissions

Only `SuperAdmin`-equivalent users can call the convert route (`urn:x-adapt:{{tenantid}}/api/content/lightcourse/*/convert`, per [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md) - already covered by `SuperAdmin.json`'s wildcard, no new role grant needed). Only a full administrator can then edit the resulting full course - this is already true automatically, since the new course is a completely ordinary `course` document subject to the existing, unmodified full-course permission rules.

## Tests

`test/lib.lightcourseconversion.js`: successful conversion produces a valid, openable full course and locks only the light course; a missing-plugin/invalid-icon/failed-write preflight failure leaves the light course editable with no partial full-course records; retrying a successful conversion returns the same course rather than duplicating it; retrying a failed conversion cleans up and starts fresh; older light versions remain reviewable/comparable/exportable after locking.
