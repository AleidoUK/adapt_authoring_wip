# Phase 7: Admin Conversion

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md).

## Administrator workflow

1. Open **Light Course > Conversion Defaults** and configure any required fallback values.
2. Save the Light Course and create its final saved version. The current draft must match the latest saved version's content, tags and button icon choices.
3. Select **Convert to Full Course** in the Light Course editor. Preflight reads the source, installed schemas, settings and assets without writing course records.
4. Resolve all reported errors. Review the proposed replacements, including the original value, fallback and field path.
5. Explicitly approve the review and conversion. Successful conversion opens the new course in the normal Full Course editor.

Both conversion endpoints require tenant-wide administrator update permission, not merely Light Editor access. Conversion also requires the usual permission to create a Full Course; the administrator who converts it becomes its creator. Changes affecting the proposed conversion, including draft content, required defaults or managed asset state, invalidate the review and require preflight again.

## Separate Conversion Defaults

Conversion Defaults are stored in the tenant's `lightcourseconfig.conversionDefaults`. They do not change Component Defaults, existing Light Course content or templates. The screen lists configurable required fields from installed core/component/plugin schemas; internal IDs and ownership fields are not configurable.

Separate **Content types**, **Components**, **Extensions**, **Menus** and **Themes**
dropdowns list entries alphabetically by their displayed name. Only one entry is
active at a time; selecting another retains edits in memory until **Save** stores
all changes. Categories with no configurable required fields are disabled.

Values are grouped by:

- `core:<type>`, for example `core:course` or `core:config`;
- `component:<component>`, for example `component:graphic`;
- `extension:<extension>:<location>`, for example `extension:help:course`;
- `menu:<menu>:<location>` and `theme:<theme>:<location>`.

Paths are relative to the group's schema, using `[]` for each existing array item. For example:

```json
{
  "component:graphic": {
    "_graphic.large": "<light-course-image-bank-id>",
    "_graphic.small": "<light-course-image-bank-id>"
  },
  "component:accordion": {
    "_items[]._graphic.src": "<light-course-image-bank-id>"
  }
}
```

Required fields, all schema-declared images and supported question options can be configured. Required objects
expand into normal controls for their nested fields. Inside item arrays, only
required fields without a valid installed default are shown; optional fields and
fields with usable defaults are hidden. Values such as `false` and `0` count as
defaults when valid for the field, whereas an invalid/empty required text default
does not. Hidden item fields use valid installed defaults; existing optional
values in configured fallback items are retained when there is no usable default.
Other required arrays have inline item controls with Add/Remove actions. This filter
does not affect fields outside item arrays or the separate **Graphic placeholder
for all items** controls. Media fields use the placeholder bank picker.
The container checkbox enables the whole composed object/array as a fallback;
this does not make optional children required or allow overwriting valid authored
values. Enabled empty scalar values and schema-invalid configured values are
rejected. Defaults for temporarily unavailable plugin groups remain stored.

For every component, `_supportedLayout` and the whole `_items` array editor are
hidden from Conversion Defaults. Layout support comes from the installed plugin;
authored item arrays are maintained in the Light Course. Individual required item
fields without usable defaults and the separate per-item graphic placeholders
remain available. Other content types and plugin settings are unchanged.

Where a required object/array also has individually listed descendant controls,
the grouped container is hidden to avoid showing the same settings twice (for
example `_columns` versus `_columns._large`, `_columns._medium` and
`_columns._small`). Individual controls and per-item graphic placeholders remain.
Containers without individually listed fields keep their grouped editor.
Previously saved grouped fallbacks remain stored and retain their existing
conversion behaviour; hiding a duplicate does not delete configuration.

Conversion preserves valid authored values, including optional empty fields except
for explicitly enabled image fallbacks, Media/Immersive Video/Video Wall MP4, supported question options and Flow/Timeline navigation fallbacks. For missing/invalid required
values, it proposes a configured Conversion Default or, if none is configured, a
valid installed-schema default. For item fields with a usable installed default,
that default takes precedence over older custom per-item defaults (except the
explicit per-item graphic placeholders). Valid authored values are still kept.
Existing nested objects are completed field by
field rather than replaced wholesale. Defaults for array items apply only to
existing items unless the array itself requires a fallback.

### Graphic placeholders for all items

Base images, main component graphics, mobile images and other image fields
declared by the installed schema appear whether required or optional. Enabling
an image fallback fills only missing/invalid values, creates a missing graphic
object when needed, and preserves authored valid images and sibling fields such
as alt text. Unconfigured optional images remain unchanged.

Image fields inside item arrays have a separate **Graphic placeholder for all
items** checkbox and picker, even when the image is optional. For example,
`component:accordion` can configure `_items[]._graphic.src`. Enable each relevant
path to fill missing, empty, schema-invalid, missing-file or wrong-MIME graphics
in existing items. Valid authored graphics, alt text, item text, order and other
fields remain unchanged. The source Light Course is never changed.

These controls are derived only from actual image asset fields in the installed
item schema. Components with text-only items do not get a synthetic
`_items[]._graphic.src` placeholder. Each supported item image path has its own
control, including plugin-specific paths.

Missing graphic objects are created only as needed for this explicit setting;
missing/empty item arrays are not populated by it. It applies to each existing
item, including nested item arrays. Replacements still require preflight approval,
and an invalid/unavailable placeholder blocks conversion.

An existing saved **whole `_items` array** setting is different: it supplies an entire fallback
array when a required array is absent, invalid in type, or shorter than its
required minimum. It does not merge an example item's graphic into existing
items. This whole-array editor is no longer shown for components; use the per-item
graphic picker for missing graphics instead.

### Question options

Component Conversion Defaults also show these boolean options wherever declared
by the installed component schema: **Display Model Answer**, **Display item
correctness**, **Display Feedback**, **Display Marking**, **Display Attempts**,
**Randomise answers**, **Record interaction** and **Enable item scoring**.
Unsupported options are not invented for components that lack them.

The first checkbox enables a custom fallback; the labelled setting checkbox
chooses its true/false value. Enabled fallbacks fill missing/invalid settings and
appear in preflight for approval. Valid authored `true` and `false` values are
preserved. Unticked optional settings retain normal installed behaviour; required
settings still use normal required-field fallback rules.

### Flow and Timeline navigation

Flow and Timeline expose all individually declared fields within `_navigation`,
including enabling navigation, showing the first item, the icon, button text,
aria label and instruction. Only fields supported by the installed schema appear;
there is no duplicate whole-navigation editor.

Enable each fallback separately. Enabled navigation fallbacks fill missing,
empty or schema-invalid values, creating the navigation object if necessary.
Valid authored values, including `false`, are preserved. Unticked optional fields
retain normal installed behaviour. Icon choices come from the installed schema.

### Splash navigation

Splash exposes **Navigate to the main menu** and **Navigate to the next page/menu**
as individual boolean fallbacks where supported by its installed schema. Valid
authored settings are preserved except for the first-page and last-page cases below. When the custom navigation ID is empty,
conversion fills it with the newly created ID of the next page in the saved
structure. On the last page, where no custom target is present, conversion instead
sets main-menu navigation on and next-page navigation off, even if configured
fallbacks differ. An existing custom ID is never replaced. The installed Splash
runtime must support the main-menu option for that last-page fallback to work.
When the first page contains Splash, its menu tile is hidden, selected Footer is
disabled and selected Hero is enabled with its background image disabled on that page.
These settings override existing values on the first Splash page. Course
Start settings are enabled with forced routing to the new first-page ID. The
Splash uses its custom target instead of automatic next-page navigation, since
hidden pages are excluded from the available runtime's next-page calculation.
Existing custom targets are preserved. Other pages and course-level extension
settings are unchanged; these changes do not apply without a first-page Splash.

In a course with submenus, there may be at most one Splash page and it must be
at the root. Conversion makes it the forced start regardless of where the
submenu appears in the saved alphabetical order and replaces its custom target
with the ID of the first submenu. The first submenu must contain a page.

### Footer navigation

When Footer is selected, conversion sets each page's Previous and Next button
enabled state and custom link from the saved page order, replacing existing
values for those fields. Next links to the following page except on the last page.
Previous links to the preceding page except on the first page, and the first page
after a Splash does not link back to the Splash. Without a Splash, only the first
page has no Previous button. In flat courses, conversion blocks if Splash occurs
on more than one page or outside the first page. Individual circular-button fallbacks are available
for Previous, Next and Menu where the installed Footer schema supports them.
Page-level Footer enablement is unchanged except on a first page containing
Splash, as described above; other authored settings are unchanged.
For submenu courses, Previous/Next traverse pages in saved structure order across
menus and skip the submenu containers. The root Splash remains excluded as a
Previous target even when it sorts after a submenu.

### Tile Menu, Hero and Styling options

Tile Menu / contentobject exposes **Display item as a button** (called
**Display graphic as a clickable button** by older schemas) and **Remove default
link button**, where declared by the installed schema. Hero / course and
Hero / contentobject expose **Hide the default page header**, **Make full width** and **Enable background image**.
Styling / contentobject exposes **Set the content full width**.
Each has a separate fallback-enable checkbox and true/false setting. Enabled
fallbacks fill missing/invalid values only, preserve authored booleans and sibling
settings, and appear in preflight for approval. Unconfigured optional values are
filled from the selected menu's installed settings. Selected extensions and the
selected theme also receive their normal installed settings where values are
missing, after configured overrides have been applied. Extension globals and
explicit theme variable defaults are initialized too.
Authored values are preserved.

### Media and Immersive Video MP4

Media and Immersive Video also expose the optional `_media.mp4` field as an individual
video-bank picker. Enabling this fallback fills a missing/empty/invalid MP4 value,
including an unavailable managed asset or one with a non-video MIME type.
Valid authored video references and sibling media settings are preserved.
The placeholder is validated and migrated into Full Course Asset Management,
like image placeholders; invalid placeholders block preflight. Leaving it
unticked keeps the normal optional-field behaviour.

Video Wall exposes `_items[]._media.mp4` as a separate video-bank picker for all
existing items. The same opt-in missing/invalid-only rules apply; configured
placeholders take precedence over installed defaults for missing item videos.
Valid videos, captions, posters, text and item order are preserved. Missing media
objects are created as needed, but no items are added or arrays replaced.

Every replacement requires explicit review approval; no placeholders are silently written into the Light Course. Placeholder-bank usage counts include Conversion Defaults.

## Preflight and mapping

The implementation is split between [schema normalization](../lib/lightcourse/conversionSchema.js), the [installed schema catalogue](../lib/lightcourse/conversionCatalog.js), the [pure planner](../lib/lightcourse/conversionPlan.js) and the [conversion service](../lib/lightcourse/conversion.js).

Preflight checks:

- latest saved version, unchanged draft, valid tree, unique stable node IDs and supported component layouts;
- installed components and selected menu/theme/extensions, including menu/theme package names;
- composed records against inherited installed schemas, with aggregated required-field and type/option failures;
- managed asset availability, tenant ownership, stored files, MIME category and checksums;
- authored Unique IDs and per-control icons against their owning installed extension schemas.

Required managed media, and optional images with an explicitly configured
graphic placeholder, may use a valid fallback when missing or of the wrong type,
but only as a review proposal. Other invalid optional media and unresolved assets
in rich text block conversion rather than being silently removed. External HTTP(S)
media URLs remain external; their remote availability is not checked.

Conversion creates ordinary course/page/article/block/component records in parent-first order with fresh Mongo IDs, maintaining a stable-node-to-Mongo-ID map. It updates the single config automatically created by the course creation hook. Selected plugins are enabled; menu/theme short identifiers are mapped to installed package names. Component layouts use `_layout: full|left|right`.

Authored titles, body/instruction and installed-schema content fields carry across. Where the Light Course has a title but no separate display title, that title also becomes the Full Course display title. Explicit display titles, including empty ones, are preserved. Tags, glossary entries, resource entries and their `_id` values, help content and supported button icons are retained. The Back button is fixed and is not configurable.

Authored `uniqueId` maps to `_extensions._uniqueId._id` on pages and components, requiring the Unique ID extension. Article/block Unique IDs currently block conversion because the installed extension does not support those owners.

Graphics/Developer Notes, comments, screenshot references, component presets and document-header metadata other than supported button icons remain solely in the Light Course.

Referenced Light Course bank assets are copied through the ordinary Asset Management importer, reusing existing deduplicated assets where applicable. Existing ordinary assets are reused. Schema media fields, managed rich-text URLs, resource `_assetId` and help `_graphicAssetId` are rewritten to `course/assets/<filename>`. Courseasset associations identify the actual owning record and parent.

## API

- `GET /api/lightcourseconfig/conversionschema`: administrator-only required-field catalogue.
- `POST /api/content/lightcourse/:id/conversion/preflight`: returns `{ hash, versionNumber, proposals, errors, ready }`.
- `POST /api/content/lightcourse/:id/conversion`: accepts `{ hash, approved: true }`, recomputes preflight and returns `{ courseId, idMap }` on success.

Both conversion endpoints return the existing `{ courseId, converted: true }` for a source already converted. Concurrent or interrupted conversions return HTTP 409 rather than creating another course. Authentication/authorization failures return 401/403; invalid or stale approval returns 409. Preflight errors must be resolved before writing.

## Locking, validation and rollback

Before writing, conversion atomically reserves the source revision, sets `conversionStatus: converting` and persists `conversionAttempt` with its token, planned course ID and ID map. The source cannot be edited or deleted during conversion.

Created course/content records carry an editor-only `_lightCourseConversionId`; config is associated through `_courseId`. After writing, conversion re-reads records, validates them through the actual database models and checks that composed schema-field values survived persistence. A dedicated source audit entry records the version and ID mapping, in addition to ordinary content-creation history.

Only then does a conditional update set `conversionStatus: converted` and `_convertedCourseId`. The original content and saved versions remain available for reading, comparison and export.

On a caught failure, conversion removes the attempt's generated content/config/courseasset records and dedicated conversion audit entry. Newly imported assets are removed only if unused; existing/reused assets are never deleted by rollback. Normal create audit entries can remain as evidence of the failed attempt. Successful cleanup unlocks the original for correction and retry.

### Interrupted conversion recovery

There is **no automatic stale-lock reset or recovery endpoint**. A process interruption, or a failure to clean up, leaves the source `converting`. Cleanup failures explicitly report that administrator attention is required.

An administrator must first establish that the conversion process is no longer running, then inspect the persisted `conversionAttempt`, its course ID/token/ID map, generated records and logs. Verify and remove only that attempt's incomplete output and unused newly imported assets before clearing its lock. Do not clear the lock while a worker is still running, delete reused assets or mark an unverified partial course as converted. Take a database backup before manual recovery.

## Verification

[Isolated tests](../test/lib.lightcourseconversion.js) cover required-only defaults, unchanged source snapshots, plugin/layout/icon validation, permissions, asset checks, explicit/stale approval, concurrency, parent/asset ID mapping, persistence validation, retry, rollback and recovery locks. Related suites cover placeholder usage, history, saved-version imports, CSV imports and Light Course validation.

These are isolated tests with mocked persistence, not a live database/browser conversion. Restart the application to load the new backend/schema code, refresh the rebuilt frontend and validate a representative disposable course end to end before converting production content.
