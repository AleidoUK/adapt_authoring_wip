# Light Course Editor: Implementation Plan

This is the build plan for the agreed light-course workflow. The companion plain-language guide is [Light Course Editor](LIGHT_COURSE_EDITOR.md). This document describes an intended design, not functionality that is already shipped.

## Scope and working model

- A light course is tenant-scoped structured content, separate from a full Adapt course. It has one editable draft, immutable numbered versions, selected plugins, and a conversion state.
- Light editors can list, create, edit, version, compare, import, and export all light courses in their tenant. They cannot open full-course management or delete bank assets.
- Existing full-course editors can see translatable word counts and export Markdown/Word for full courses; they do not gain light-course access solely from that role.
- Only full administrators configure light-course defaults, convert the latest light version, and edit the resulting full course. Conversion locks the light course only on success.
- The existing Adapt ZIP export/import remains unchanged. Document export/import is a separate workflow.

## Architecture and data contracts

Create separate models/collections for light courses, immutable versions, and tenant-scoped configuration and image-bank membership. Use the existing database, asset storage, authentication and permission conventions where they are suitable, without reusing the full-course CRUD endpoints for light content. Every API query and mutation must scope by tenant on the server, including reads by ID, image references, version retrieval, import, and export.

A light course draft should contain a stable course ID and revision token, title, ordered page/article/block/component tree, plugin choices, glossary and resources lists, selected bank image references, current version pointer, creation/update metadata and conversion status. Each content node and editable field needs a stable ID for document round trips and comparisons. A component records its plugin identity/version and its translatable fields/items, plus any selected graphic references. Keep a snapshot of the field descriptors necessary to display old data when a plugin is later removed; never erase unknown or newly obsolete fields on save. Versions are immutable snapshots with a version number, creator, timestamp, content, plugin choices and schema/format version. Store source and resulting full-course IDs when converted.

Glossary entries and resource entries are stable-ID content lists alongside the page/article/block tree, not components. A glossary entry holds its term and definition. A resource entry holds its translatable details plus a resource ID value, the identifier used elsewhere to reference that resource; validate it is present and unique within the course. Both lists only apply when the corresponding extension is among the course's selected plugins, and both are included in versions, comparisons, word counts and document export/import on the same terms as other translatable content.

The help extension's content is configuration, not a list: its popup text and, where the extension supports it, the separate help page the popup links to. Store it alongside the other selected-plugin configuration, gated on the help extension being selected, and carry it through versions, comparisons and conversion unchanged.

A course template is a separate, reusable record: a stable ID, name/description and a content snapshot in the same shape as a light course version (tree, plugin choices, starter glossary/resource entries). Creating a course from a template copies that snapshot into a brand-new draft with freshly generated stable IDs; the new draft has no ongoing reference to the template, so later edits to either never affect the other. Only administrators create, edit or remove templates; the simplest route is letting an admin promote any existing light course version into a new template record.

On creating the first version, use 1.0. From the latest version, a minor increment changes 1.0 to 1.1 (or 1.1 to 1.2); a major increment changes 1.1 to 2.0. Save only updates the unpublished draft. Creating a version checks the expected draft revision and latest version inside one consistency boundary so simultaneous editors cannot publish the same number. Import creates/updates an unpublished draft based on the latest version; publishing its chosen next version is a separate, explicit action. Define how an existing unsaved draft is handled before importing: require confirmation to replace it or require it to be saved/versioned first; never silently discard it.

Use the effective installed Adapt framework schemas for base content and installed component metadata for plugin fields. Component schemas can have nested objects and arrays: walk them recursively for `translatable` fields and graphic inputs. Respect required defaults and validation at conversion time. `uniqueId` is an editor-facing field whose mapping to the installed unique-ID extension and output schema must be confirmed during the schema spike. Keep component/plugin IDs stable even if display names change.

## Permissions and navigation

Add a dedicated Light Editor role and feature/API permissions. Full administrator access is checked separately for defaults and conversion. Do not give the Light Editor the existing Course Creator permission: it grants broad content and asset access. Do not assume hiding navigation is authorization. The current asset creation flow grants the asset creator delete permission; use a dedicated bank upload path/policy so a light editor cannot delete a shared bank image even if they uploaded it. Deleting from a course removes only that course's reference. Enforce the same rules at every download and asset-serving endpoint.

Route light editors to a list-first home, with a title-and-save create flow, edit button and title double-click. Restrict full dashboard, editor, settings, asset-management and export routes as well as their APIs. An admin may retain full navigation and enter the light area explicitly. Define feature visibility for users with multiple roles rather than relying on route order.

Template management (create, edit, promote-from-version, delete) is an admin-only action; template selection on the create flow is available to any light editor.

## Delivery phases

### 1. Schema and compatibility spike

Inspect installed base schemas, representative installed components with nested items, graphic fields and required media/settings, plus menu/theme/extension metadata. Determine how the unique-ID extension stores identifiers. Inspect the installed glossary and resources extensions: their course-level configuration shape, how resource items declare their ID field and whether it must be unique course-wide or tenant-wide, and how both extensions expect their item lists to be supplied on course creation. Inspect the installed help extension's configuration shape: how its popup text and any linked help page are stored, and whether the page is a separate content node or an embedded field. Record which fields need type-specific default values, how references are encoded, and whether any installed component imposes additional conversion constraints. Produce a field-mapping matrix and test fixtures before implementing the generic editor. This is a gate, not a promise that arbitrary third-party schemas require no special handling.

### 2. Storage, API and authorization

Add tenant-scoped persistence and migrations/setup for light drafts, immutable versions, light configuration, bank membership and templates. Add endpoints for listing/creating/retrieving/saving drafts, reordering nodes, publishing/listing/retrieving/comparing versions, bank selection/upload, import/export, configuration, conversion, glossary/resource entry CRUD and reordering, help-extension content editing, and template listing/creation/promotion/deletion. Validate node hierarchy, a maximum of two components per block, the existence and tenant ownership of referenced assets, one Menu/one Theme selection, and resource ID presence/uniqueness on the server. Use optimistic concurrency for draft edits, version creation, import and conversion. Test cross-tenant ID guessing, locked-course mutations, direct full-course API calls, forbidden bank deletion and cross-tenant template access.

### 3. Light-course list and editor

Build a dedicated frontend module using existing Backbone/Origin patterns. Show tenant-wide light courses as a list with title, updated date, latest version, draft/converted state and edit/review actions. Provide create, Save Draft, Create Version, edit and read-only review. The create flow offers a blank course or any available template; choosing a template clones its snapshot into the new draft with fresh stable IDs. The editor supports adding pages, articles, blocks and up to two components per block; reorder blocks and components in the tool, including left/right positions when paired. Preserve ordering as explicit data, not incidental database order. Provide useful empty, loading, conflict and validation states.

### 4. Components, plugins and images

Populate component choices from installed types; render common title, displayTitle, body, instruction and uniqueId fields where applicable, plus translatable nested item fields. Let users add/remove items. Show graphic selectors only where the effective schema declares a graphic field. Do not expose video/audio selection in the light editor. Populate a plugin list with exactly one selected Menu, one Theme and multiple selectable Extensions; seed new courses from admin-configured defaults (including bookmarking/uniqueId where installed and configured). Removed plugins remain recorded and read-only; upgraded plugins retain old content and expose newly translatable fields. Show a conversion warning for missing plugins or defaults.

Provide tenant image-bank listing/upload to light editors and admin-only removal from the bank. Images can be attached/detached from light courses. Admin configuration covers bank governance, default plugin selections, a placeholder for each graphic field and defaults for every required non-text setting, including representative video/audio media. Validate image type/size and references against existing upload limits; do not treat the presence of a default file as proof it satisfies a plugin schema.

Where the glossary and/or resources extensions are among the course's selected plugins, provide a list editor for their entries: add, edit, reorder and remove, with the resource entry's ID field shown and validated for presence and uniqueness. If neither extension is selected, keep the lists hidden rather than letting editors populate content that conversion cannot place anywhere.

Where the help extension is among the course's selected plugins, provide an editor for its popup text and its linked help page content. If the extension isn't selected, keep this content hidden rather than letting editors populate content that conversion cannot place anywhere.

### 5. Shared translatable word counts and exports

Implement a server-side traversal of effective base/component schemas that selects each stored translatable string exactly once, including nested item fields, glossary entries and resource entries. Agree and test a word-count rule for HTML: strip markup, decode entities, normalize whitespace, exclude markup attributes and non-translatable fields, and use the same tokenizer for component and course totals. For full courses use the same service with the full-course access checks; totals include translatable text at course, page, article and block level as well as components, glossary and resources. Expose per-component counts and course totals; test multilingual and rich-text examples.

Export version snapshots as Markdown and `.docx`, including structure, editable text/allowed formatting, stable IDs and word counts. Allow exporting any immutable light version and the latest draft only if it is clearly labelled as a draft. Existing full-course editors can export full courses in these document formats without granting light-role users full-course access. Document export does not replace the existing Adapt ZIP.

### 6. Versions, comparison and document import

Version comparison aligns stable IDs and highlights text, added/deleted/moved nodes and plugin selections. Old versions are read-only and exportable. Document import is for a light course's latest version only. Define one canonical document structure and an allowlist of supported HTML (for example paragraphs, headings, lists, emphasis and links); use structured Markdown and `.docx` parsers/writers, not regex substitutions. Embed stable machine-readable identifiers in both document formats and keep them out of editable prose. Reject missing/duplicated IDs, renamed structural headings, changed order, changed plugin choices and unknown fields with a location-specific error report; allow only text and supported formatting changes. Do not mutate the draft or create a version on a failed import. Provide round-trip fixtures for both formats, including escaping, Unicode, empty fields, nested items and HTML. This is controlled round-tripping, not lossless support for arbitrary Word styling.

### 7. Admin conversion

Convert only the latest published version, by full admin action; require no unversioned draft changes or prompt the admin to publish them first. Preflight component/plugin availability, required properties, defaults, image/media assets, unique IDs, schema validation and tenant membership. Show actionable failures before any write. Create a normal full course and ordered content records using the existing course creation conventions, selecting one Menu/Theme, the chosen Extensions and component types. Assign left/right layouts for paired components and apply field-specific graphic and other required defaults. Preserve all applicable translatable text and items. Where the glossary, resources and/or help extensions are selected, populate their configuration from the saved entries/content, carrying resource ID values through unchanged, and preflight-check that the extensions are actually installed before writing. Keep ID mappings for audit/troubleshooting.

Conversion must be idempotent for retries and behave atomically to users: either a validated full course exists and the light course is locked, or any partial full-course records/assets are cleaned up and the light course remains editable. Verify the generated course opens and validates before setting the converted state. Only a full administrator can edit the result. Older light versions remain reviewable, comparable and exportable after locking.

### 8. Verification and rollout

Add automated unit tests for schema traversal, counts, version increments, comparisons, import validation, default mapping, glossary/resource/help conversion and template cloning; API tests for tenant/role permissions, conflicts and failure recovery; and browser tests for the list, editor, reordering, documents, templates and conversion. Run existing course/asset/export tests to guard against regressions. Pilot with real installed components, plugins and two tenants. Migrate roles/config without changing existing courses, add user/admin instructions, and release behind a feature flag if the deployment supports one.

## Acceptance scenarios

1. A light editor creates a titled course, sees it in a tenant-wide list, adds the full hierarchy, reorders blocks/components, saves a draft and publishes 1.0; another editor in the same tenant can access it, but another tenant cannot.
2. Two simultaneous saves do not silently overwrite one another; only one publication from a given latest version succeeds. Versions 1.0, 1.1 and 2.0 are immutable and comparisons report content, structure and plugin changes.
3. Installed components, nested translatable items, unique IDs and graphics are editable as described; missing plugin metadata stays visible read-only, and newly translatable fields appear after an upgrade.
4. A light editor adds an image to the bank and detaches it from a course, but cannot delete the bank image even by direct API request. Media defaults remain admin-managed.
5. Markdown and Word exports include counts; edited text and supported formatting can be imported against the latest version. Reordered nodes or altered identifiers in either document produce specific errors and no partial changes.
6. Full-course editors can view counts and export Markdown/Word for full courses; the light role cannot read or export those courses.
7. Only a full admin can convert the latest published version. A missing plugin/default or failed write does not lock the light course or leave a usable partial full course. Successful conversion creates a valid editable full course and locks only the light course.
8. A light editor adds glossary terms and resource entries, including resource ID values, to a course that has those extensions selected; conversion carries them into the new full course's extension configuration unchanged. Attempting to add either list to a course without the matching extension selected is blocked with an explanation.
9. An admin creates a template from an existing light course version. A light editor creates a new course from that template and gets a populated, independently editable draft; later edits to the new course or to the template do not affect one another.
10. A light editor edits the help extension's popup text and linked page content on a course that has the extension selected; conversion carries that content into the new full course unchanged. The editor is hidden on a course without the help extension selected.

## Implementation decisions to verify during the spike

- Exact installed-schema mapping for `uniqueId`, graphics, required fields and component items; do not hardcode example schemas as authoritative.
- How stable document IDs are embedded in both formats without confusing editors, and which HTML elements survive both directions.
- How draft replacement is confirmed on import, and whether draft export is needed; version exports and imports remain required.
- How conversion cleanup/transactions work with this deployment's database, asset storage and course creation hooks.
- Exact shape of the installed glossary/resources extensions' course-level configuration, the resource ID field's name and uniqueness scope, and whether either extension can be added to a course after creation or only at full-course creation time.
- Where templates are stored and whether they need their own versioning, or a single current snapshot per template is sufficient; whether templates are tenant-scoped or shared across tenants.
- Exact shape of the installed help extension's configuration: whether its linked page is a plain field or a distinct content node, and whether it supports the same rich-text/formatting rules as other translatable fields.