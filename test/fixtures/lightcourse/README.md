# Light Course Editor test fixtures

Fixtures captured from the real installed Adapt framework checkout used by the
[Phase 1 schema spike](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/docs/LIGHT_COURSE_PHASE1_SCHEMA_SPIKE.md)
(`temp/<jobId>/adapt_framework/src`), **not** hand-written/placeholder schemas. Re-run the
spike and refresh these files whenever the installed plugin set changes meaningfully.

Each directory pairs the plugin's real schema file(s) (verbatim copies, valid JSON) with a
cleaned `example.data.json` (comments stripped from the plugin's shipped `example.json` so it
parses as plain JSON) demonstrating realistic stored data for that schema.

## `adapt-aleido-help/`

Representative **installed component/extension with nested items + a graphic field**.

- `properties.schema`: draft-04 dialect, flat `"translatable": true`. Stored DB shape
  (`extensiontype.properties`) is this file's top-level `properties` value, i.e.
  `{ pluginLocations: { course: { _help: { ... } } } }`.
- Demonstrates: `_items[]` nested object array (title/body translatable, `_graphic.src` using
  the `"inputType": "Asset:image"` convention, `_graphic.alt` translatable).

## `adapt-contrib-glossary/`

Representative **course-level extension with a list**.

- `course.schema.json`: 2020-12 `$patch`/`$anchor` dialect patching the base `course` schema.
  Translatable fields use nested `"_adapt": { "translatable": true }` instead of the flat
  marker used by `adapt-aleido-help`.
- Demonstrates: `_glossary._glossaryItems[]`, each `{ term, description }`, both translatable.

## `adapt-contrib-resources/`

Representative **extension with freeform config and no stable per-item ID** - the
Phase 1 matrix gap, confirmed during Phase 1 implementation:

- `course.schema.json` and `contentobject.schema.json`: both 2020-12 `$patch` dialect. `_resources`
  config (and its `_resourcesItems[]` array) can be declared at **both** course and
  content-object level simultaneously.
- Confirmed via `extensions/adapt-contrib-resources/js/adapt-contrib-resources.js`
  (`setupResources()`): course-level and content-object-level `_resourcesItems` arrays are
  concatenated at render time, and individual items are addressed **purely by array index**
  (`this.model.get('_resourcesItems')[index]` in `ResourcesView.js`) - there is no `_id` or
  other stable identifier per resource item anywhere in the schema or the runtime code. Any
  light-course editor feature needing to reference a specific resource item (e.g. an edit link,
  a diff/version comparison) must mint and store its own stable ID for each item rather than
  relying on one from the framework.
- `example.data.json` includes both the course-level and content-object-level shapes side by
  side to make this concatenation behaviour explicit for anyone writing against these fixtures.

## Reuse

Used by [test/lib.schemawalker.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.schemawalker.js)
to validate [lib/schemaWalker.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/schemaWalker.js)
against both schema dialects. Intended for reuse by Phase 4 (component/plugin field rendering),
Phase 5 (word counts, multilingual fixtures) and Phase 6 (version comparison fixtures) per the
main implementation plan.
