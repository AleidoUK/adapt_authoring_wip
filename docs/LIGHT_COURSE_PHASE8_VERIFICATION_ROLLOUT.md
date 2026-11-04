# Phase 8: Verification and Rollout

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md). Depends on all prior phases.

## Automated tests (confirmed framework/conventions)

Backend: Mocha + Supertest + `should`, confirmed via [test/lib.assetmanager.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.assetmanager.js) (`var request = require('supertest')`, `var should = require('should')`, `before(function(done){...})`/`it('should...', function(done){...})`). Run via `npm test` -> `grunt test` -> the `mochaTest` Grunt task over `test/*.js` (confirmed in [Gruntfile.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/Gruntfile.js) ~lines 147-150/320). [test/entry.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/entry.js) dynamically loads every `.js` file under `test/` (confirmed ~lines 160-168) and bootstraps a test tenant/user from [test/testConfig.json](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/testConfig.json)/[test/testData.json](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/testData.json) - **new test files just need to be dropped under `test/`, no loader/registry changes required.** This phase consolidates and completes the test files stubbed in each prior phase:

- `test/lib.lightcoursemanager.js` ([Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)) - tenant/role permission checks, concurrency conflicts, cross-tenant access, bank-asset delete denial.
- `test/lib.lightcoursewordcount.js` / `test/lib.lightcoursedocuments.js` ([Phase 5](LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md)) - schema traversal (both dialects), notes/header exclusion, document round-trip.
- `test/lib.lightcourseversions.js` ([Phase 6](LIGHT_COURSE_PHASE6_VERSIONS_COMPARISON_IMPORT.md)) - version increments, comparisons, import validation/version-history auto-append.
- `test/lib.lightcourseconversion.js` ([Phase 7](LIGHT_COURSE_PHASE7_ADMIN_CONVERSION.md)) - default mapping, icon preflight/mapping, atomicity/idempotency, audit trail.
- Add icon-preflight, audio-field-gating, glossary/resource/help conversion, and template-cloning cases explicitly - these are called out in the main plan's acceptance scenarios and should each have a direct test, not just incidental coverage inside the broader conversion test.

**No frontend/browser test framework exists in this repository today** (confirmed: no Jest/QUnit/Jasmine setup found under `frontend/`). Introducing one is a scope decision for this phase, not a pre-existing capability to simply extend - options are (a) add a minimal browser test harness now (cost: new tooling, new CI step), or (b) rely on the manual/pilot verification below for the frontend list/editor/reordering/documents/templates/conversion flows and defer automated browser coverage. Record whichever is chosen in this document once decided, since it changes the rollout checklist below.

## Regression coverage

Run the existing course/asset/export test suites unchanged (`test/lib.assetmanager.js`, any existing course/export/import tests already under `test/`) to confirm the new `lightcourse*` collections, roles and routes don't alter existing behaviour - particularly: confirm `lib/role/CourseCreator.json` was **not** edited (per [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md), full-course editors must not gain light-course access), and confirm [lib/assetmanager.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/assetmanager.js)'s `assetUses()`/`ASSET_USAGE_CONTENT_TYPES` scan behaviour is unchanged unless [Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md)'s open question about surfacing light-course usage there was deliberately resolved.

## Pilot

Per the main plan: pilot with real installed components/plugins (the actual framework checkout inspected in [Phase 1](LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md), not synthetic fixtures) and two tenants, specifically exercising:
- The two confirmed Phase 1 gaps in practice: a course using the help extension (confirm the `_popup`/`_items`-only shape is acceptable to real reviewers) and a course using every icon-bearing extension (confirm the per-extension icon validation in [Phase 7](LIGHT_COURSE_PHASE7_ADMIN_CONVERSION.md) behaves sensibly with real option lists).
- Cross-tenant isolation with two real tenants, not just unit-test fixtures.
- At least one full round trip: create -> edit -> version -> export document -> edit document -> import -> new version -> convert -> edit resulting full course.

## Migration and release

- **Roles**: new tenants get `LightEditor.json` automatically via `installDefaultRoles` ([lib/rolemanager.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/rolemanager.js), confirmed ~lines 454-503, reads every file in `lib/role`). Existing tenants need `syncDefaultRoles` (~lines 504-550) to pick up the new role file - confirm this runs as part of normal deploy/upgrade (check [upgrade.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/upgrade.js) at repo root) rather than only at fresh install.
- **Config**: no `migrations/*.js` entry is strictly required just to add new collections (they're created on first write via the `ContentPlugin`/Mongoose mechanism confirmed in [Phase 2](LIGHT_COURSE_PHASE2_STORAGE_API_AUTH.md)), but if a default `lightcourseconfig` record per existing tenant is wanted at rollout (rather than lazily created on first admin visit), write a one-off migration under `migrations/`, following the confirmed `migrate-mongo` convention (`async up(db, client)`/`async down(db, client)`, run via `npx migrate-mongo up -f conf/migrations.js`, confirmed against [migrations/20220908105711-convertarialabels.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/migrations/20220908105711-convertarialabels.js)).
- **Existing courses are untouched**: confirmed by construction - every new collection and route is additive (new `plugins/content/<name>/` directories, new `lib/role/LightEditor.json`), and no existing `model.schema`/role file is modified except exactly as specified (nothing - `CourseCreator.json`/`AuthenticatedUser.json`/`SuperAdmin.json` are not edited by this feature at all).
- **Feature flag**: no existing feature-flag mechanism was identified during this spike (not investigated in depth - if required, check [lib/configuration.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/configuration.js)'s `conf/config.json`-driven config pattern for a simple boolean gate on module registration/route mounting before assuming one needs to be built).
- **User/admin instructions**: update [LIGHT_COURSE_EDITOR.md](LIGHT_COURSE_EDITOR.md) and this plan's phase documents to reflect final shipped behaviour (especially the two confirmed gaps - help extension shape, button icon coverage) once implementation settles, rather than leaving the product doc describing unimplemented behaviour.

## Final acceptance check

Re-run the main plan's 12 acceptance scenarios as a checklist against the finished build, plus the two gap-driven scenarios added by this spike (help extension real shape; per-extension icon validation including the non-configurable Back button) before calling rollout complete.
