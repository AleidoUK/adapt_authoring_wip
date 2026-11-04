# Unpushed Changes Summary

This document records the working-tree state checked on 2026-10-01. It describes staged, unstaged and untracked changes; it does not mean the changes have been committed, pushed, or fully tested.

## Git status at a glance

- Current branch: `develop`, tracking `origin/develop`.
- Local commits ahead of `origin/develop`: 0. The branch is not behind according to the branch status checked.
- Staged: 38 paths, approximately 3,942 additions and 430 deletions in the staged diff.
- Unstaged: 19 paths show differences against the staged copies. `git diff --ignore-cr-at-eol` reports no remaining diff, so these unstaged differences are carriage-return/line-ending changes only, not additional content changes.
- Untracked: `.env`, `aleido_authoring.zip`, `test-extension-schema.js`, and the two Light Course Editor documents. Their contents are not included in the staged diff.

The worktree contains several staged files marked `AM`: they have staged content and a working copy with line-ending-only changes. This summary does not normalize or alter those files.

## Staged implementation changes

### Asset replacement and management

Changes in `lib/assetmanager.js` and the frontend asset-management module add an asset replacement flow. The interface supports replacing a file from the asset view/preview, showing file details and reporting success or failure. The backend replaces the stored file while updating the asset record and metadata, so existing references can continue to use the same asset record. Asset-use lookup is also updated to report which courses/components use an asset, supporting deletion decisions. Related user-facing text was added in `routes/lang/en.json`.

The staged paths are:

- `lib/assetmanager.js`
- `frontend/src/core/helpers.js`
- `frontend/src/modules/assetManagement/index.js`
- `frontend/src/modules/assetManagement/templates/assetManagementPreview.hbs`
- `frontend/src/modules/assetManagement/templates/assetManagementReplaceAsset.hbs`
- `frontend/src/modules/assetManagement/views/AssetManagementReplaceAssetView.js`
- `frontend/src/modules/assetManagement/views/assetManagementModalNewAssetView.js`
- `frontend/src/modules/assetManagement/views/assetManagementNewAssetView.js`
- `frontend/src/modules/assetManagement/views/assetManagementPreviewView.js`

### File-upload limits

Frontend text now describes type-specific upload limits, and the asset-management documentation records the configured limits: images 1 MB, video 25 MB, audio 10 MB, documents 2 MB, and archives/course imports 500 MB. These values are set in both built-in defaults and the local `conf/config.json`.

Related paths: `frontend/src/core/helpers.js`, `routes/lang/en.json`, and `docs/FILE_UPLOAD_LIMITS.md`.

### Audit log

A new audit-log content type and schema record content changes. Hooks capture create, update and pre-delete operations, with update changes represented as before/after values. API routes retrieve logs by course or content item. A course-editor view, template and styles provide a Change History screen linked from the editor. The implementation defines audit logs as immutable to ordinary users, with deletion restricted to administrators.

Related paths:

- `plugins/content/auditlog/index.js`
- `plugins/content/auditlog/model.schema`
- `frontend/src/modules/auditLog/styles/auditLog.less`
- `frontend/src/modules/auditLog/templates/auditLog.hbs`
- `frontend/src/modules/auditLog/views/auditLogView.js`
- `frontend/src/modules/editor/auditLog/index.js`
- `frontend/src/modules/editor/index.js`
- `frontend/src/modules/editor/global/templates/partials/part_editorCommon.hbs`
- `frontend/src/modules/sidebar/views/sidebarItemView.js`
- `routes/lang/en.json`

### GitHub course push integration

New GitHub integration code stores per-course repository configuration, exposes routes to retrieve/save configuration, push and test a connection, and adds a course-editor action and push interface. Configuration includes repository details and branch-related options; SSH key handling and related settings are wired through server configuration. The push flow expects a course export to exist first. Repository auto-creation is represented in the integration flow.

Related paths:

- `lib/github/githubconfig.schema`
- `lib/github/index.js`
- `lib/github/routes.js`
- `lib/githubmanager.js`
- `lib/application.js`
- `lib/configuration.js`
- `frontend/src/modules/github/templates/githubPush.hbs`
- `frontend/src/modules/github/views/githubPushView.js`
- `frontend/src/modules/sidebar/views/sidebarItemView.js`
- `frontend/src/modules/editor/global/templates/partials/part_editorCommon.hbs`
- `routes/lang/en.json`

### Other staged changes

- `lib/dml/mongoose/index.js`: changes to Mongoose/database model handling accompany the audit/GitHub data models.
- `plugins/content/course/model.schema`: marks the custom CSS/LESS field as full-width in the editor.
- `package-lock.json`: root package version changes from 0.11.2 to 0.11.5.
- `server.log`: a log file is staged; review and remove it from the index if it is generated output or contains environment/user data.

### Staged documentation

Seven new guides document asset replacement, audit logging, feature access, upload limits and GitHub integration/setup:

- `docs/ASSET_REPLACEMENT.md`
- `docs/AUDIT_LOG.md`
- `docs/AUDIT_LOG_INTEGRATION.md`
- `docs/FEATURE_ACCESS_GUIDE.md`
- `docs/FILE_UPLOAD_LIMITS.md`
- `docs/GITHUB_INTEGRATION.md`
- `docs/GITHUB_SETUP.md`

## Unstaged changes

Unstaged modifications overlap 19 staged files, including the seven staged guides and new audit-log/GitHub files. The apparent full-file diffs are line-ending changes: ignoring carriage returns leaves no unstaged diff. No separate unstaged behavior change was identified in this check.

## Untracked files

- `docs/LIGHT_COURSE_EDITOR.md`: non-technical description of the proposed Light Course Editor. This is planning documentation, not implemented functionality.
- `docs/LIGHT_COURSE_IMPLEMENTATION_PLAN.md`: implementation plan for that proposed feature. This is not implementation code.
- `test-extension-schema.js`: a standalone helper script that checks an extension directory for `bower.json` and `properties.schema`, parses their JSON and reports basic schema structure/type concerns. It is not staged.
- `.env`: local environment configuration. Its contents were deliberately not read or copied here because it may contain secrets. Review it privately before deciding whether it belongs in version control; normally environment secrets should not be committed.
- `aleido_authoring.zip`: an untracked archive. Inspect its contents and intended use before adding it to version control; archives can be large or contain private/generated data.

## Review notes before pushing

- Review the staged `server.log`; logs are commonly generated output and may contain sensitive data.
- Decide whether `.env`, `aleido_authoring.zip` and `test-extension-schema.js` should be committed. None is currently staged.
- The unstaged line-ending-only changes are separate from the staged feature content. Avoid accidentally staging unrelated line-ending churn if a clean staged patch is desired.
- `git diff --cached --check` reports trailing whitespace in staged files, including `frontend/src/modules/auditLog/views/auditLogView.js`, `plugins/content/auditlog/index.js`, `lib/github/index.js`, `lib/github/routes.js`, `frontend/src/modules/github/views/githubPushView.js`, and `lib/assetmanager.js`. Clean these up if the repository expects whitespace-clean patches.
- Run the relevant automated tests and manually verify asset replacement, audit history, and GitHub push behavior with appropriate permissions and a non-production repository. This summary is not a test report.
- The Light Course Editor is described in documentation only; no Light Course Editor implementation is included in the staged changes listed above.