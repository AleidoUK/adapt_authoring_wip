# Light Course Editor

## What are we building?

The Light Course Editor will be a simpler place to plan and write Adapt courses. It will let people build the course structure and enter content without working through all the project settings, extension options and media choices in the full course editor.

A light course is not a published Adapt course. When it is ready, a full administrator can turn its latest saved version into a new full course. The original light course and its earlier versions stay available for reference.

## Getting started

Someone with the Light Editor role will sign in to a list of all light courses in their tenant. They can edit any light course in that list or select **Create** to start a new one. Creating a course means entering its title, optionally choosing a starting template, and selecting **Save**. The new course then appears in the list. An **Edit** button or a double-click on its title opens it.

Select **Clone** on any course, including a converted one, to open an independent editable copy named "Copy of ..." with no saved versions or conversion link. Change its **Course title** at the top of the editor; this is also the title shown on the course menu. The title autosaves and can be edited until conversion. Its content, tags, plugin choices, header settings and asset references are retained; component comments and version history are not copied, as when starting from a template.

This role is for the light-course area only: it does not give access to the full-course dashboard or other full-course management areas. People who already edit full courses will keep their existing access; being a light editor alone will not give someone access to full-course information.

## Starting from a template

When creating a new course, an editor can start from a blank course or from a template. A template is a ready-made structure, such as a standard set of pages, articles and blocks with example components already in place, along with suggested plugin choices and starter glossary or resource entries. Choosing a template fills in the new course as a normal, editable draft; nothing about it stays linked back to the template, so changing the new course never changes the template.

Administrators manage the list of available templates: they can build one from scratch, or turn any existing light course version into a template for others to reuse. Templates are there to save repetitive setup, not to restrict what an editor can change afterwards.

Courses and templates share the authoring tool's tag catalogue. Both editors let
you select existing tags or create new ones, and both list pages show a **Tags**
column. A course started from a template inherits its tags; later changes to
either remain independent. Template tag changes are saved with **Save template**.
The course list's existing title, tags and state filters are unchanged.

## Document headers

At the top of every light course sits a set of header sections aimed at reviewers and whoever later builds the full course. Other than the button icon choices, none of this information is carried into the full course on conversion - it exists to support drafting, review and handover.

**Version history** is a table with one row per export: Version (the course's current 1.0/1.1/2.0 number), Date, Author, Notes, No. of screens, No. of words and Est. duration. Version, Date, Author and the two counts are calculated and not editable; Notes and Est. duration are free text. A screen is counted as one component. A new row is added automatically whenever an exported document is re-imported, or an editor can add one manually.

**Instructions for reviewing this document** is a short explanation shown to anyone reviewing an export. Each export keeps its own stored copy, including its text and any referenced images, so earlier exports stay available even as the draft keeps changing.

**Important information for developers** captures the decisions a developer needs before building the full course: whether navigation is linear or non-linear, whether the layout is full or standard, whether tracking is by completion, assessment, or both, and whether a reflection tool is needed. The course's selected Extensions (see Images and plugin choices below) are also shown here.

**Terminology** lets the editor choose the words the course should use: Section or Topic, Course or Module, and Assessment or Quiz.

**Buttons** is where the editor picks an icon for Next, Back, Menu, Help, Side Drawer and Reflection from the Vanilla font icons supported by each control; the first option listed is always the default. A linked choice records which style of help screen is needed - a pop-up with icons and explanations, or a graphic walkthrough of the course with pop-up labels. Unlike the rest of this header, the chosen button icons do carry through to the full course's navigation when it is converted, wherever the resulting theme and menu support them.

## Building the course

A course contains pages, pages contain articles, articles contain blocks, and blocks contain up to two components.

In both Light Course and course template editors, articles with blocks have a
second **Add Block** button below the last block. It adds a block to the same
article, just like the button at the top. Adding a page, submenu, article or block
scrolls the new element into view.

Use the disclosure arrow beside a page, article or block to hide or expand its
contents. These start expanded and retain their open/closed state while you
work in the editor. Adding a new element expands its parents so it is visible.
Collapsing a row does not change the saved course content.
Block labels show their component types, for example **Block (Text, Graphic)**,
even when collapsed. The names update as components are added, removed or changed.

Use **Add submenu** to add a root-level submenu, then use a page's **Location**
choice to move it between the course root and a submenu. A submenu can also
create a page directly. Move all pages out before removing a submenu. Nested
submenus are not supported in the light editor.

Light Course lists and pickers are alphabetical (case-insensitive, with natural
number ordering). This includes courses, templates, component defaults, assets
and reference pickers. Glossary entries use their term; resource/help entries
use their title (or body when untitled). Component item lists retain the order
in which items were added and can be reordered with up/down arrows. New items
are added at the end.

The content tree preserves its authored sibling order. Use the up/down arrows on
page, article, block and component item rows to move an item before or after its
siblings; changes autosave and carry through to previews and exports. Explicit left/right
component layouts are unchanged. Version history, comments and audit events
retain chronological ordering rather than being alphabetised.

Each component has a **Layout** choice: **full**, **left** or **right**, subject to its installed component type's supported layouts. A block can contain one full-width component or up to two half-width components, one left and one right. Adding or pasting a second component beside a full-width component asks for confirmation before changing it to left and placing the new component on the right. Full-width-only types cannot be paired. Changing a paired component's side swaps its sibling to the opposite side. Components appear side by side in the tree, stacking on narrower screens. These controls are shared by course and template editors; component defaults can also record a layout.

Existing components without a saved layout are interpreted as full when alone, or left/right in their existing order when paired. Both light- and full-course Word exports show the layout beside the component's unique ID and word count. Layout labels are read-only and do not change saved layouts on Word import.

The component editor will have the same straightforward layout for every installed component. A dropdown lets the editor choose from all components currently available in the authoring tool. Common content fields include title, display title, body, instruction and a unique ID where applicable. Editors can add items to a component; for each item, they will see the text fields marked as translatable in that component's schema.

Editors will not need to select video files here. The tool will use administrator-configured defaults for the media and other required settings when it creates a full course. Where a component or item needs a graphic, the editor can choose an image from a shared light-course image bank. Where the audio extension is among the course's selected Extensions, components and their items also show an audio field, worked the same way.

Each component also has two fields only the light editor sees: Graphics Notes and Developer Notes, for free-text guidance on graphics work and implementation. Like the header sections above, these notes are not carried into the full course.

## Images and plugin choices

Light editors can add images to the shared bank, attach them to a course and remove them from a course. Removing an image from a course does not delete it from the bank. Light editors cannot delete images from the bank, including ones they uploaded. Administrators will manage bank removal and configure a default placeholder for each graphic field.

Each light course has one selected Menu, one selected Theme and a selection of Extensions. The editor will show installed options as a simple selection list rather than the full plugin settings. Administrators will choose which plugins are selected for new courses by default, such as bookmarking and uniqueId where available.

If a plugin is later removed, its saved information will remain visible but read-only. The administrator will need to resolve the missing plugin before converting the course. If a plugin is updated, existing content will stay in place and any new translatable fields will appear in the light editor.

## Glossary and resources

Where a course uses the glossary and resources extensions, light editors can maintain their lists directly in the tool instead of opening full plugin settings. A glossary entry has its term and definition. A resource entry has its details plus a resource ID value, which is used elsewhere to link to that resource. Editors can add, edit and remove entries in both lists; entries are ordered alphabetically.

Each resource row displays its **Unique ID** in a read-only, copyable field. New resources receive their ID when saved.

Both Light and Full Course **Content Preview**, their content-only Word exports
and their storyboard Word exports show **Unique ID: ...** beneath each resource
title when an ID is present. The ID is reference-only: changing it in a Light
Course Word document does not change the stored ID on import. Resource IDs do
not contribute to word counts.

If a course doesn't have the glossary or resources extension selected, the editor will say so rather than let entries be added and then quietly dropped. These lists carry across when a light course is converted, in the same way as other translatable content.

Each enabled list also has **Data import** controls. Download its CSV template, choose a file, then append to the current list or replace it after confirmation. The columns and boolean values match Full Course Data Import. Rows missing required values are skipped and reported; a file with no valid rows leaves the list unchanged. Resource IDs must be unique within the resulting list; leave an ID blank to generate one automatically. Imports use the normal draft autosave, revision checks and history, and are unavailable on converted (locked) courses. A save error is shown explicitly rather than reporting a successful import.

## Help extension

Where a course uses the help extension, light editors can edit its popup and
items directly in the tool. If the extension supports a Navigation Button
Custom Link ID and the course has a page titled **Help**, conversion links the
Help button to that page's generated ID. The page remains normal course content,
not content stored inside the Help extension.

If a course doesn't have the help extension selected, this content stays hidden rather than being entered and then discarded. Like the glossary and resources lists, it carries across unchanged when the light course is converted.

## Saving and versions

**Save Draft** keeps work in progress editable. **Create Version** takes a permanent, non-editable snapshot. The first version is 1.0. New versions can be created only from the latest version: the editor chooses a minor step, such as 1.0 to 1.1, or a major step, such as 1.0 to 2.0.

Earlier versions can be opened for review, compared and exported, but not changed. A comparison will show differences in text, course structure and selected plugins. If two people edit the same draft at once, the tool will warn about a conflicting save rather than silently replace someone's work.

## Word counts and documents

Components have an optional **Component screenshot** image below their title in
the component editor, including template and component-default editors. Choose
or upload it through the light-course image bank. It is also shown in course
previews and below the component title in Word exports. Other component images
appear below the title in Word, while item images follow their item's content.
Images in both light- and full-course Word exports are limited to half the usable
page width, keeping their proportions without enlarging smaller images.
Word imports update text and component discussions, leaving screenshots and other images unchanged.

The light editor will show a word count for each component and a total for the course. Counts use translatable content only; the Graphics Notes and Developer Notes fields and the document header sections are not counted. Full-course editors will also have component and course word counts for full courses; the Light Editor role alone will not be able to see those full courses.

Courses can be exported as either a Markdown document or a Word document, chosen from an export menu. The documents will include word-count information. Full-course editors will get these document exports for full courses too. These are additional ways to review and work on content: they do not replace the existing Adapt course ZIP export.

Both Markdown and Word documents exported from a light course can be edited and re-imported. Import updates text and supported formatting in a new draft based on the latest version; the user can review it and explicitly create the next minor or major version. It will not change an older saved version.

Documents are for editing **text**, not rearranging the course. Their headings, identifiers and order must stay the same. Reordering blocks or components is done in the tool. If the document structure has changed, import will explain what is wrong rather than guess where content belongs or partially import it. Common supported formatting, such as paragraphs, headings, lists, emphasis and links, will be preserved where both document types can represent it. Unsupported styling will be reported, not silently promised as a perfect match.

## Content preview, content-only Word and PDF

Select **Content preview** in the light-course editor for a content-only overlay. Course,
page, component and item titles use bold headings of different sizes. The pane
shows each component's type in small text above its title (also included when
printing); the content-only Word export remains free of these type labels. It
includes learner-facing text and enabled glossary, resources and help content,
without field labels, IDs, layout labels, review notes, accessibility settings
or discussions. Empty fields and disabled associated fields are omitted.

**Show images** controls content images, while **Show screenshots** independently
controls component screenshots. Images are on initially; screenshots are off. These settings apply to
the pane, **Export content to Word** and **Print / PDF**. Included images keep
their proportions and the half-text-width limit; unavailable images produce a
visible notice.

The separate content-only Word document is for reading/auditing and cannot be
imported. The existing storyboard Word export/import remains unchanged.
**Print / PDF** prints only the reading content, not the editor or its controls.
Choose **Save as PDF** in the browser's print dialog; browsers do not allow the
tool to set the printer/PDF destination.

Content preview uses the saved course content, saving committed editor changes first;
unfinished component dialogs must still be saved separately. Content preview is also
available for locked courses. If another user changes the course after opening
Content preview, close it and reload the editor before exporting.

### Full courses

Full-course editors have a **Content Preview** sidebar button directly beneath
**Export storyboard**. It opens the same overlay, with images shown by default,
screenshots hidden by default, component-type captions, content-only Word export
and Print / PDF. Page, article, block, component and item headings retain their
hierarchy; learner-facing text and enabled glossary, resources and help are
included without review notes, IDs or accessibility settings. Images come only
from the current tenant's asset library and retain the half-page-width limit.

The full-course preview reads saved content across the whole course, not just
the current page. Save any open editing forms before opening it. Neither this
preview nor its Word export changes course data or supports Word import. The
existing storyboard export remains unchanged.

## Component comments

Light courses have a **Comments** section in each component editor. Add a plain-text
comment or reply, including replies to replies. Use the component's **Save** action
to keep discussion changes; **Cancel** discards them along with other component edits.
Replies start collapsed. Use **Show replies** or **Hide replies** on a comment to
expand or collapse its replies, including nested discussions. Adding a reply
expands its thread automatically. Resolved discussions use the Aleido blue text colour.
A comment icon follows the component's full/left/right label when it has active
comments: black while any thread is unresolved, or the same blue when all threads
are resolved. Deleted comments do not contribute to the indicator.
Authors may edit or delete only their own comments. Delete replies before deleting
their parent. Any course editor may resolve or reopen a thread; reopen it before
adding more replies. Converted courses remain read-only.

Word exports include native Word comments anchored to the component heading.
Every reply is referenced in the document so Word can display the whole thread.
Component headings use **Heading 2**; older Heading 4 exports remain importable.
Import adds new comments and replies, updates existing comment text, and restores
resolved/reopened status when the Word processor supplies it. Re-importing the
same reviewed document does not duplicate its comments. Removing a comment from
Word does not delete it from the tool, and previously tool-deleted comments are
not resurrected by an older document.
If an earlier import created an identifiable duplicate Word thread, re-importing
the reviewed document combines it with the original and keeps both sets of replies.
Ambiguous matches are reported rather than merging separate discussions.

Add Word comments within a single component's heading or content, not across
components or on page/course headings. Keep existing replies in their original
threads. Only text comments are supported. Reviewer names are retained; a unique
matching tool user's name or email links the author, otherwise the name stays as
external reviewer text without creating an account. Reply/status support depends
on the Word processor retaining modern threaded-comment metadata.

Discussions are not copied with components or into templates, are excluded from
word counts, and are not available in templates, component defaults or full courses.
Markdown exports/imports do not transfer discussions.

## Turning a light course into a full course

Only a full administrator can convert a light course, and only its latest saved version can be converted. Save current edits and create a new version if the draft has changed since that version.

Administrators configure missing required values under **Light Course > Conversion Defaults**, separately from Component Defaults. These settings never change existing light content. All schema-declared images, including optional main and mobile graphics, are available as explicit fallbacks. Enabled image fallbacks fill only missing/invalid images, preserving valid authored images. **Graphic placeholder for all items** appears only for image fields declared in the component's item schema; it preserves item text and order without replacing the array. Optional component fields remain unchanged unless an image, Media/Immersive Video/Video Wall MP4, supported question-option or Flow/Timeline navigation fallback is explicitly enabled. Selected extensions, menu and theme also receive their normal installed settings wherever values are missing, along with extension globals and theme variable defaults; configured conversion overrides take precedence.

The **Convert to Full Course** button is enabled once a version exists. Select it to run a read-only check of installed plugins, required fields, layouts, navigation icons and assets. The review lists issues by location and shows proposed defaults, their sources and current values. Extension-specific overrides are applied only for extensions selected in the course. When issues are present, **Export issues to CSV** downloads the current check's saved version, locations, fields, messages and technical identifiers; proposed defaults are not included. It does not edit content: close the review to fix issues in the Light Course or Conversion Defaults, create a new version if course content changed, and run the check again. Once the check passes, approving applies all listed defaults together before conversion starts. A failed check or conversion also displays its error in an OK dialog. After conversion, the button changes to **Jump to Full Course** and opens the converted course.

Successful conversion creates a new full course with its pages, articles, blocks, components, item text and other translatable content already in place. Selected plugins, paired component layouts, glossary/resources/help, resource IDs and supported navigation icons carry across. The Back button is fixed, not configurable. Images are copied to ordinary Asset Management or reuse an identical existing asset. The new course opens in the normal editor.

Page/component Unique IDs require the selected Unique ID extension. Article/block Unique IDs currently prevent conversion because the installed extension does not support those owners.

In flat courses, Splash components with no custom navigation target receive the converted ID of the next page in the saved structure. On the last page, conversion enables main-menu navigation instead; this requires a Splash runtime that supports the main-menu option. Existing custom targets are preserved.
When the first page contains Splash, conversion hides its menu tile, disables selected Footer, enables selected Hero without its background image on that page, and sets it as the forced course start page. The Splash uses its custom target instead of automatic next-page navigation so it can navigate from a hidden menu item. These changes do not apply when the first page has no Splash.

For courses with submenus, the single Splash page must be at the course root. It
becomes the forced course start and targets the first page in the first submenu,
overriding any authored Splash destination. That page is hidden from the menu.
Submenus become full-course menu objects and their pages become children of
those menus.

When Footer is selected, conversion sets Previous and Next buttons and their links from page order, replacing existing values for those fields. In submenu courses, it follows the displayed order of pages across submenu boundaries, skipping the submenu containers. The first page after Splash has no Previous button. In flat courses, Splash must be on the first page only; otherwise conversion reports an issue. Footer's circular-button settings can be configured separately.
For submenu courses, the hidden first submenu page has only its Parent button
enabled. The submenu menu has only Previous enabled, linking to that hidden page
with the title "Select here to return to the introduction screen." and a square
button. The hidden page is excluded from normal Previous/Next navigation, so the
following submenu page has no Previous link back to it. Hero is disabled on the
submenu menu. If Help is selected and a page is titled **Help**, the Help button
links to that page; its Footer has only native Previous enabled, with no custom
link, Parent or Next.

The document header sections (version history, reviewing instructions, developer information, terminology and the help-screen style choice) and each component's Graphics Notes and Developer Notes are not needed once a full course exists, so none of them carry over - they remain visible on the light course for reference.

The light course is temporarily locked while conversion runs and remains read-only after successful conversion. Its saved versions can still be reviewed, compared and exported. A failed conversion removes its partial output and restores editing if cleanup succeeds. An interrupted conversion or cleanup failure stays locked for administrator inspection rather than allowing duplicate or incomplete output.

See [admin conversion details](LIGHT_COURSE_PHASE7_ADMIN_CONVERSION.md) for configuration, API and recovery guidance.

## What stays in the full editor?

Detailed project settings, full plugin configuration, media selection, final full-course editing and the existing Adapt build/export process remain in the current authoring tool. The Light Course Editor is focused on course structure, translatable content, review, and a reliable handover to a full course.

For build phases and technical acceptance checks, see the [implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md).