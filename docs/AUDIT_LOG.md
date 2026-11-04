# Audit Log Feature

## Overview

The Audit Log feature provides comprehensive change tracking for all content operations in the authoring tool. It automatically logs create, update, and delete operations with detailed information about what changed, who made the change, and when.

## Features

### Automatic Tracking
- **Create Operations**: Logs when new content is created
- **Update Operations**: Tracks field-by-field changes with before/after values
- **Delete Operations**: Captures snapshots before deletion

### Change Detection
The system intelligently categorizes changes by type:
- **Text changes**: Title, body, description fields
- **Image changes**: Graphics, thumbnails, background images
- **Video changes**: Media files, video assets
- **Audio changes**: Audio files and assets
- **Number changes**: Numeric values
- **Boolean changes**: On/off, true/false toggles
- **Array changes**: Lists and collections
- **Object changes**: Complex nested data

### User Information
Each log entry includes:
- User ID
- User email/name
- Timestamp (with human-readable "time ago" display)
- IP address (optional)
- User agent (optional)

## Accessing the Audit Log

### From the Course Menu
1. Open your course in the editor
2. Click on the course settings menu
3. Select "Change History" or "Audit Log"
4. View the complete history of changes

### API Endpoints

#### Get logs for a course:
```http
GET /api/auditlog/course/:courseId?limit=100&skip=0
```

#### Get logs for specific content:
```http
GET /api/auditlog/content/:contentType/:contentId
```

## Filtering and Sorting

The audit log view provides several filtering options:

- **By Action**: Filter by create, update, or delete operations
- **By User**: See changes made by specific users
- **By Content Type**: Filter by article, block, component, etc.
- **By Date**: Chronological sorting (most recent first)

## Data Structure

### Audit Log Entry Schema
```json
{
  "action": "create|update|delete",
  "contentType": "article|block|component|etc",
  "contentId": "ObjectId",
  "courseId": "ObjectId",
  "userId": "ObjectId",
  "userName": "user@example.com",
  "timestamp": "ISO 8601 date string",
  "changes": [
    {
      "field": "fieldName",
      "oldValue": "previous value",
      "newValue": "new value",
      "changeType": "text|image|video|etc"
    }
  ],
  "snapshot": { /* complete object snapshot */ }
}
```

## Performance Considerations

- Logs are created asynchronously to avoid impacting user operations
- Only significant changes are logged (ignores `updatedAt`, `__v`, etc.)
- Pagination is used to load large log sets efficiently
- Default limit: 100 entries per request

## Security and Permissions

- **Read Access**: All users can view audit logs for their content
- **Create Access**: Only the system can create audit logs
- **Update Access**: Audit logs cannot be updated (immutable)
- **Delete Access**: Only administrators can delete audit logs

## Integration

The audit log system integrates seamlessly with the content management hooks:

```javascript
// Automatically triggered on content changes
app.contentmanager.addContentHook('create', '*', { when: 'post' }, auditCreate);
app.contentmanager.addContentHook('update', '*', { when: 'post' }, auditUpdate);
app.contentmanager.addContentHook('destroy', '*', { when: 'pre' }, auditDestroy);
```

## UI Features

### Visual Indicators
- **Green badge**: Create operations
- **Blue badge**: Update operations
- **Red badge**: Delete operations

### Change Display
- **Expandable items**: Click to see detailed changes
- **Before/After values**: Color-coded comparison
- **Icons**: Visual indicators for different change types
- **Time ago**: Human-readable timestamps

### Load More
- Initial load: 50 entries
- Click "Load More" to load additional entries
- Smooth scrolling and performance optimized

## Best Practices

1. **Regular Review**: Periodically review audit logs to track team activity
2. **Training**: Use audit logs to identify common editing patterns
3. **Debugging**: Check logs when unexpected changes occur
4. **Compliance**: Maintain logs for audit and compliance purposes
5. **Archive**: Consider archiving old logs for long-term projects

## Troubleshooting

### Logs not appearing
- Check that the auditlog content plugin is loaded
- Verify database connectivity
- Check user permissions

### Performance issues
- Reduce the number of logs loaded per request
- Apply filters to narrow down results
- Consider archiving older logs

### Missing change details
- Ensure the content type is properly registered
- Check that field names are correctly detected
- Verify the change detection algorithm is working

## Future Enhancements

Potential improvements for future versions:
- Export logs to CSV/PDF
- Advanced search and filtering
- Change comparison view
- Restore from snapshot functionality
- Email notifications for important changes
- Retention policies for automatic log cleanup
