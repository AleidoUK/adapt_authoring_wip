# Audit Log Integration Guide

## Overview
The audit log feature has been successfully integrated into the course editor sidebar. Users can now access change history directly from the course menu.

## Files Modified

### 1. Frontend Router Integration
**File:** `frontend/src/modules/editor/index.js`
- Added `'./auditLog/index'` to module dependencies
- Added `case 'auditlog':` to the route switch statement to handle audit log routes

### 2. Sidebar Template
**File:** `frontend/src/modules/editor/global/templates/partials/part_editorCommon.hbs`
- Added new sidebar button:
```handlebars
<div class="sidebar-row">
  <button class="editor-common-sidebar-auditlog">
    <span class="editor-common-sidebar-auditlog-inner">
      <i class="fa fa-chevron-right primary-color"/></i>{{ t 'app.editorauditlog'}}
    </span>
  </button>
</div>
```

### 3. Sidebar View
**File:** `frontend/src/modules/sidebar/views/sidebarItemView.js`
- Added click event handler: `'click button.editor-common-sidebar-auditlog': 'viewAuditLog'`
- Added method `viewAuditLog()` that navigates to the audit log page

### 4. Audit Log Module
**File:** `frontend/src/modules/editor/auditLog/index.js` (NEW)
- Created editor module that handles the `editor:auditlog` event
- Sets up breadcrumbs and back navigation
- Initializes the AuditLogView with the course ID

### 5. Audit Log View Update
**File:** `frontend/src/modules/auditLog/views/auditLogView.js`
- Updated `initialize()` to accept courseId from either model or options
- Ensures backward compatibility with direct instantiation

### 6. Localization
**File:** `routes/lang/en.json`
- Added translation key: `"app.editorauditlog": "Change history"`

## How It Works

### Navigation Flow
1. User clicks "Change history" button in course sidebar
2. `sidebarItemView.viewAuditLog()` is called
3. Router navigates to `editor/{courseId}/auditlog`
4. Editor module triggers `editor:auditlog` event
5. Audit log module initializes view with course context
6. AuditLogView loads and displays logs for the course

### URL Pattern
```
#/editor/{courseId}/auditlog
```
Example: `#/editor/507f1f77bcf86cd799439011/auditlog`

### Breadcrumb Navigation
- Dashboard > Course Name > Change history
- Back button returns to menu or page (context-aware)

## Features Available

### Light editor item history

Component defaults, course templates, course/page defaults (the tenant configuration), and
placeholder assets have **Change history** buttons. Templates and component defaults expose
the button in both the list and editor. History opens in a read-only modal without navigating
away from unsaved edits and is scoped to that item's content type and ID.

Metadata saves, cloning, deletion, template promotion from a version, initial config creation,
asset uploads, and automatic clearing of a previous component default use the content-manager
audit hooks. Automatic default switching records the change against the old preset as well as
the new one. Updated timestamps are server-generated on saves; list dates include the time.
Templates retain their timestamps for display, but clones get new IDs and timestamps.

Only changes made after audit logging was enabled (and after these write paths were wired)
are available; existing missing history cannot be reconstructed.
- ✅ View all changes for the current course
- ✅ Filter by action (create/update/delete)
- ✅ Filter by user
- ✅ Filter by content type
- ✅ View detailed field-by-field changes
- ✅ Pagination (load more)
- ✅ Human-readable timestamps
- ✅ Color-coded action badges

## Testing Checklist
- [ ] Button appears in course sidebar
- [ ] Clicking button navigates to audit log page
- [ ] Logs display for current course only
- [ ] Filters work correctly
- [ ] Back button returns to previous page
- [ ] Breadcrumbs display correctly
- [ ] No console errors
- [ ] Pagination works
- [ ] Mobile responsive

## API Endpoints Used
- `GET /api/auditlog/course/:courseId` - Fetch logs for a specific course
- Query parameters: `limit`, `skip` for pagination

## Permissions
- Currently, all authenticated users can view audit logs for courses they have access to
- Future enhancement: Add role-based permissions for audit log access

## Future Enhancements
1. Export audit logs to CSV/PDF
2. Advanced filtering (date range, specific fields)
3. Real-time updates using WebSockets
4. Email notifications for important changes
5. Restore from snapshot functionality
6. Comparison view for before/after values
7. Search functionality across logs

## Troubleshooting

### Audit Log Not Appearing
- Verify the backend plugin is loaded: Check `plugins/content/auditlog/`
- Check browser console for JavaScript errors
- Verify API endpoint is accessible: Test `GET /api/auditlog/course/{courseId}`

### No Logs Displayed
- Ensure content changes have been made after plugin installation
- Check database for `auditlog` collection
- Verify hooks are registered in the backend plugin

### Navigation Issues
- Clear browser cache
- Check that all modified files have been deployed
- Verify RequireJS module paths are correct

## Related Documentation
- [Audit Log Feature](AUDIT_LOG.md) - Complete feature documentation
- [File Upload Limits](FILE_UPLOAD_LIMITS.md) - File size configuration

## Support
For issues or questions, please check:
1. Browser developer console for errors
2. Server logs for backend issues
3. Database logs for query problems
