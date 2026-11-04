# Phase 1: Schema and Compatibility Spike

Part of the [Light Course Editor implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md). See also the [plain-language guide](LIGHT_COURSE_EDITOR.md).

## Objective

Produce a field-mapping matrix and test fixtures grounded in the *actual installed* framework plugins before building the generic editor, word-count traversal, document export/import or conversion. This phase has already been run once (see findings below); it should be re-run whenever the installed framework/plugin set changes meaningfully, since the matrix is only valid for the specific plugin versions it was built against.

## Where the real schemas live

The repository ships the Adapt Authoring Tool (AT) backend, not the framework itself. A real installed Adapt framework checkout exists at:

```text
temp/<jobId>/adapt_framework/src/
  components/   - 46 installed components (adapt-aleido-*, adapt-contrib-*)
  extensions/   - 29 installed extensions
  menu/         - adapt-aleido-tileMenu, adapt-contrib-boxMenu
  theme/        - adapt-theme-aleido, adapt-contrib-vanilla, adapt-theme-aleido-platform
  core/         - base course/config/navigation schema and templates
```

This directory is a build artifact (created by a previous framework install job), not a permanent fixture - do not rely on this exact path existing at build time. The durable mechanism is [lib/bowermanager.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/bowermanager.js), which installs framework plugins via Bower and stores `properties`/`globals` from each plugin's `properties.schema` into the `componenttype`/`extensiontype`/`menutype`/`themetype` Mongo collections (see [plugins/content/component/componenttype.schema](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/component/componenttype.schema), [plugins/content/extension/extensiontype.schema](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/plugins/content/extension/extensiontype.schema)). **The spike's job is to read these DB-stored schemas (or an installed framework checkout) at build time, not to hardcode schema assumptions in code.**

## Two schema dialects - must both be handled

1. **AT's own `model.schema`** files (under `plugins/content/*/model.schema`): JSON Schema draft-04, flat markers, e.g. `plugins/content/component/model.schema` marks `title`/`displayTitle`/`body` with a flat `"translatable": true`.
2. **Framework plugin schemas** (`properties.schema` per component/extension/menu/theme, `course.schema.json` for extensions that patch the base course schema): two further sub-dialects were found in the installed set:
   - Draft-04 `properties.schema` (most extensions/components, e.g. `adapt-aleido-uniqueId/properties.schema`, `adapt-aleido-help/properties.schema`) - flat `"translatable": true`, same as AT's dialect.
   - 2020-12 `$patch`/`$anchor` schemas (`adapt-contrib-glossary/schema/course.schema.json`, `adapt-contrib-resources/schema/course.schema.json`) - translatable fields are marked with nested `"_adapt": {"translatable": true}` instead.

Any schema-walking code (word counts in [Phase 5](LIGHT_COURSE_PHASE5_WORDCOUNTS_EXPORTS.md), the generic component-field renderer in [Phase 3](LIGHT_COURSE_PHASE3_LIST_AND_EDITOR.md)/[Phase 4](LIGHT_COURSE_PHASE4_COMPONENTS_PLUGINS_IMAGES.md)) must check both `field.translatable === true` and `field._adapt && field._adapt.translatable === true`.

## Confirmed field-mapping matrix

| Plugin | Need | Confirmed location/shape | Source |
|---|---|---|---|
| `adapt-aleido-uniqueId` | Where the unique ID is stored | `_extensions._uniqueId._id` on `contentobject` and `component`; course-level is only an `_isEnabled` toggle, no ID value | `extensions/adapt-aleido-uniqueId/properties.schema` |
| `adapt-aleido-audio` | Component/item audio field shape | Separate `pluginLocations.component._audio` block plus a nested per-item audio block; distinct from the common component fields | `extensions/adapt-aleido-audio/properties.schema` |
| `adapt-contrib-glossary` | Course-level glossary entries | `_glossary._glossaryItems[]`, each `{ term, description }` (both `_adapt.translatable: true`); gated by `_glossary._isEnabled` | `extensions/adapt-contrib-glossary/schema/course.schema.json` |
| `adapt-contrib-resources` | Course-level resources config, item-reference/ID convention | **Confirmed, with a significant gap.** `_resources` (`title`, `description`, `_isEnabled`, `_drawerOrder`, `_resourcesItems[]`, ...) is declared identically at **both** course level (`schema/course.schema.json`) and content-object level (`schema/contentobject.schema.json`) - not course-only like glossary. `js/adapt-contrib-resources.js`'s `setupResources()` concatenates the course-level and content-object-level `_resourcesItems` arrays at render time, and `ResourcesView.js` resolves an individual item purely via **array index** (`this.model.get('_resourcesItems')[index]`). **There is no `_id` or any other stable per-item identifier anywhere in the schema or the runtime code.** Any Light Course feature that needs to reference a specific resource item (edit link, version-comparison diff) must mint and persist its own stable ID per item - the framework provides none. See [test/fixtures/lightcourse/README.md](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/fixtures/lightcourse/README.md) for fixtures demonstrating this. | `extensions/adapt-contrib-resources/schema/course.schema.json`, `.../schema/contentobject.schema.json`, `.../js/adapt-contrib-resources.js`, `.../js/ResourcesView.js` |
| `adapt-aleido-help` | Popup text + "linked help page" | Only `_help._popup` (`title`/`body`/`instruction`) and `_help._items[]` (`_icon`, `title`, `body`, `_graphic`) exist. **No separate help-page content node, no style-toggle field.** The product doc's two-style ("pop-up" vs. "graphic walkthrough") choice is not represented in the installed schema - likely `_items` already covers the "walkthrough" case and `_popup` the "pop-up" case as a single combined feature, not a toggle between two mutually exclusive modes. | `extensions/adapt-aleido-help/properties.schema`, `example.json` |
| Button/help-screen icons | Which icons are valid per control | **Not owned by theme or menu.** Each nav-contributing extension owns its own `_icon` Select with its own option list: `adapt-aleido-menuButton` (9 options: home, menu, grid, controls-left, controls-small-left, arrow-left, arrow-left-2, arrow-with-circle-left, chevron-with-circle-left), `adapt-aleido-reflection` (5 options: comment, checklist, list, list-2, ordered-list), `adapt-aleido-help` (2 options: question, info). Side-drawer icon is a **freeform text** field (`_config._drawer._iconClass`), not a Select. **Back button has no icon field in any schema** - fixed via CSS (`core/templates/nav.hbs` renders a bare `<span class="icon">`). `adapt-contrib-vanilla` and `adapt-theme-aleido` `properties.schema` files contain no navigation-icon configuration at all. | `extensions/adapt-aleido-menuButton/properties.schema`, `extensions/adapt-aleido-reflection/properties.schema`, `extensions/adapt-aleido-help/properties.schema`, `core/templates/nav.hbs`, theme `properties.schema` files |
| Component items/graphics | Nested translatable items, graphic fields | Confirmed pattern via `adapt-aleido-help/properties.schema`'s `_items[]`: object arrays with `title`/`body` (`translatable: true`) and a `_graphic.{alt,src}` pair (`alt` translatable, `src` an `"inputType": "Asset:image"` reference) - this `Asset:image` inputType convention is the generic signal to render a graphic selector, usable across components | `extensions/adapt-aleido-help/properties.schema` |

## Per-control button/help-screen icon validation table

To drive Phase 7's conversion preflight (reject a chosen icon that isn't valid for its control, before conversion writes anything). Each nav-contributing control owns its own option list independently - there is no shared theme/menu icon enum to validate against.

| Control | Owning schema path | Valid option list | Freeform or constrained |
|---|---|---|---|
| Menu button | `pluginLocations.contentobject._menuButton._icon` (`adapt-aleido-menuButton/properties.schema`) | `home`, `menu`, `grid`, `controls-left`, `controls-small-left`, `arrow-left`, `arrow-left-2`, `arrow-with-circle-left`, `chevron-with-circle-left` (9 options; default `home`) | Constrained (`Select`) |
| Reflection nav button | `pluginLocations.course._reflection._navItem._icon` (`adapt-aleido-reflection/properties.schema`) | `comment`, `checklist`, `list`, `list-2`, `ordered-list` (5 options; default `comment`) | Constrained (`Select`) |
| Help nav button | `pluginLocations.course._help._navItem._icon` (`adapt-aleido-help/properties.schema`) | `question`, `info` (2 options; default `question`) | Constrained (`Select`) |
| Side-drawer button | `_drawer._iconClass` on the course's `config` document (`core/schema/config.model.schema`; referenced as `_config._drawer._iconClass` in `core/templates/nav.hbs`) | Any CSS class name defined in the active theme (default `icon-list`) | **Freeform text** - no option list to validate against; preflight can only check the field is non-empty, not that the class exists in the theme |
| Back button | *(none - not configurable)* | N/A | **Fixed.** `core/templates/nav.hbs` renders a bare `<span class="icon">` with no bound field; conversion preflight must skip this control entirely rather than error on a missing choice |

`adapt-contrib-vanilla` and `adapt-theme-aleido` `properties.schema` files contain no navigation-icon configuration at all - themes do not own or constrain any of the above.

## Deliverables for this phase

1. **Done.** [lib/schemaWalker.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/schemaWalker.js): given an installed component/extension's stored schema (from `componenttype`/`extensiontype` or a framework checkout), recursively walks it and returns translatable string paths (handling both dialects above), graphic/asset reference paths (`inputType` starting with `Asset:`, or `_backboneForms: "Asset"` in the 2020-12 dialect), and required-field defaults. Reusable as-is by Phase 5's word-count service. Verified in [test/lib.schemawalker.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/lib.schemawalker.js).
2. **Done.** See the updated `adapt-contrib-resources` matrix row above: no stable per-item ID exists anywhere in the schema or runtime - items are addressed purely by array index, and course-level/content-object-level item lists are concatenated at render time.
3. ~~A product decision request (not a code task) for the Light Editor team: reconcile the help-extension "two styles" / "linked help page" requirement in [LIGHT_COURSE_EDITOR.md](LIGHT_COURSE_EDITOR.md) with the installed extension's actual `_popup`/`_items` shape - either scope the requirement down or confirm a newer extension version is planned.~~ **Resolved**: scope the requirement down to match the installed extension's actual `_popup` + `_items` shape; no newer extension version is being waited on.
4. **Done.** See the per-control icon validation table above.
5. **Done.** [test/fixtures/lightcourse/](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/fixtures/lightcourse): `adapt-aleido-help` (nested items + graphic), `adapt-contrib-glossary` (course-level list), `adapt-contrib-resources` (freeform config, no stable item ID) - real schema files plus cleaned example data, documented in that directory's `README.md`.

## Gate, not a blocker

This phase does not block starting Phase 2 (storage/API), since the new collections' shapes don't depend on third-party schema details. It does block starting the generic component-field renderer and conversion logic in Phases 3/4/7, and the word-count/export traversal in Phase 5.

## Manual verification checklist

This phase has no end-user UI, so there's nothing for a QA tester to click through - this is a developer/reviewer checklist for confirming the deliverables are actually correct, to be re-run whenever the installed framework/plugin set changes meaningfully (per the Objective above).

- [ ] Re-run the spike: diff the currently-installed `temp/<jobId>/adapt_framework/src/{components,extensions,menu,theme}` checkout against the file paths cited throughout this document (`adapt-aleido-help`, `adapt-aleido-menuButton`, `adapt-aleido-reflection`, `adapt-contrib-glossary`, `adapt-contrib-resources`) - confirm the cited schema paths/fields still exist and still match the shapes described above.
- [ ] Run `node_modules/.bin/mocha test/lib.schemawalker.js` directly (not the full `grunt test`, which needs a live Mongo and framework checkout) - confirm all tests pass.
- [ ] Spot-check [lib/schemaWalker.js](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/lib/schemaWalker.js) against one schema not already covered by its tests (e.g. an installed `adapt-contrib-*` component not in the fixtures) - confirm the `translatablePaths`/`assetPaths`/`requiredDefaults` it returns look right by eye.
- [ ] Re-read the **Per-control button/help-screen icon validation table** against the real installed `adapt-aleido-menuButton`/`adapt-aleido-reflection`/`adapt-aleido-help`/`core/schema/config.model.schema` files - confirm the option lists/paths/defaults haven't drifted (an extension version bump could add/remove icon options).
- [ ] Confirm [test/fixtures/lightcourse/](/home/laurahooper/Projects/AdaptAuthoring/aleido_authoring/test/fixtures/lightcourse)'s saved schema files still match the real installed files byte-for-byte (`diff` them against the live checkout) - stale fixtures silently validate against an outdated schema shape.
