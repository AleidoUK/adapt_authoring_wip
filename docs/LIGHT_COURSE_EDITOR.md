# Light Course Editor

## What are we building?

The Light Course Editor will be a simpler place to plan and write Adapt courses. It will let people build the course structure and enter content without working through all the project settings, extension options and media choices in the full course editor.

A light course is not a published Adapt course. When it is ready, a full administrator can turn its latest saved version into a new full course. The original light course and its earlier versions stay available for reference.

## Getting started

Someone with the Light Editor role will sign in to a list of all light courses in their tenant. They can edit any light course in that list or select **Create** to start a new one. Creating a course means entering its title, optionally choosing a starting template, and selecting **Save**. The new course then appears in the list. An **Edit** button or a double-click on its title opens it.

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

A course contains pages, pages contain articles, articles contain blocks, and blocks contain up to two components. Blocks and components can be reordered inside the tool.

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

Where a course uses the glossary and resources extensions, light editors can maintain their lists directly in the tool instead of opening full plugin settings. A glossary entry has its term and definition. A resource entry has its details plus a resource ID value, which is used elsewhere to link to that resource. Editors can add, edit, reorder and remove entries in both lists.

If a course doesn't have the glossary or resources extension selected, the editor will say so rather than let entries be added and then quietly dropped. These lists carry across when a light course is converted, in the same way as other translatable content.

## Help extension

Where a course uses the help extension, light editors can edit its content directly in the tool: the text shown in the help popup and, where the extension supports it, a separate help page that the popup links out to. This replaces opening the full plugin settings just to change that wording.

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
Word imports update text only and leave screenshots and other images unchanged.

The light editor will show a word count for each component and a total for the course. Counts use translatable content only; the Graphics Notes and Developer Notes fields and the document header sections are not counted. Full-course editors will also have component and course word counts for full courses; the Light Editor role alone will not be able to see those full courses.

Courses can be exported as either a Markdown document or a Word document, chosen from an export menu. The documents will include word-count information. Full-course editors will get these document exports for full courses too. These are additional ways to review and work on content: they do not replace the existing Adapt course ZIP export.

Both Markdown and Word documents exported from a light course can be edited and re-imported. Import updates text and supported formatting in a new draft based on the latest version; the user can review it and explicitly create the next minor or major version. It will not change an older saved version.

Documents are for editing **text**, not rearranging the course. Their headings, identifiers and order must stay the same. Reordering blocks or components is done in the tool. If the document structure has changed, import will explain what is wrong rather than guess where content belongs or partially import it. Common supported formatting, such as paragraphs, headings, lists, emphasis and links, will be preserved where both document types can represent it. Unsupported styling will be reported, not silently promised as a perfect match.

## Turning a light course into a full course

Only a full administrator can convert a light course, and only its latest saved version can be converted. The tool will first check that its components, selected Menu, Theme and Extensions, images, media and required default settings are available and valid. Administrators will have a configuration area for default plugin selections, graphic placeholders and required non-text values, including example/default media files.

Successful conversion creates a new full course with its pages, articles, blocks, components, item text and other translatable content already in place. Selected plugins and configured defaults are applied, including left/right placement for paired components and the chosen Next/Back/Menu/Help/Side Drawer/Reflection icons. A full administrator can then edit the resulting full course in the normal editor.

The document header sections (version history, reviewing instructions, developer information, terminology and the help-screen style choice) and each component's Graphics Notes and Developer Notes are not needed once a full course exists, so none of them carry over - they remain visible on the light course for reference.

The light course becomes read-only **only after** the full course has been created successfully. Its saved versions can still be reviewed, compared and exported. If conversion fails, the light course remains editable and the administrator receives an explanation of what must be fixed.

## What stays in the full editor?

Detailed project settings, full plugin configuration, media selection, final full-course editing and the existing Adapt build/export process remain in the current authoring tool. The Light Course Editor is focused on course structure, translatable content, review, and a reliable handover to a full course.

For build phases and technical acceptance checks, see the [implementation plan](LIGHT_COURSE_IMPLEMENTATION_PLAN.md).