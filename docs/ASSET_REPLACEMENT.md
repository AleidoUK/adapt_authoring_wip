# Asset Replacement Feature

## Overview

The Asset Replacement feature allows you to replace an existing asset file with a new one while maintaining all references to the asset throughout your courses. This is extremely useful when you need to update an image, video, or other media file without having to manually update every component that uses it.

## Benefits

### Why Replace Instead of Delete and Re-upload?

1. **Preserves References**: All components using the asset will automatically use the new file
2. **Maintains IDs**: The asset keeps the same database ID, so no broken links
3. **Saves Time**: No need to manually update every component that references the asset
4. **Preserves Metadata**: Title, description, and tags are maintained (unless you change them)
5. **Audit Trail**: The replacement is logged in the audit log system

## How to Replace an Asset

### Method 1: From Asset Management View

1. Go to **Asset Management** from the global menu
2. Find the asset you want to replace
3. Click on the asset to view its preview
4. Click the **"Replace"** button in the preview panel
5. Select your new file to upload
6. Optionally update the title, description, or tags
7. Click **"Save"** in the sidebar

### Method 2: From Asset Preview

1. When viewing an asset's preview in the asset management area
2. Look for the **"Replace asset"** button
3. Click it to open the replacement form
4. Follow steps 5-7 from Method 1

## Replacement Process

### What Happens During Replacement

1. **File Validation**: The new file is checked against size limits based on its type
2. **Old File Removal**: The previous file and thumbnail are deleted from storage
3. **New File Upload**: The new file is processed and stored
4. **Thumbnail Generation**: A new thumbnail is created (if applicable)
5. **Database Update**: The asset record is updated with new file information
6. **Reference Preservation**: All component references remain intact. If the replacement file is a different type (eg. a `.png` replaced with a `.jpg`), the stored filename's extension is updated to match the new file, and every course/component reference to that filename is automatically rewritten to the new one.

### Replacing with a different file type

You don't need to replace like-for-like: a `.png` can be replaced with a `.jpg` (or any other asset of the same general type). When the extension changes:

- The asset is renamed so its extension matches the new file (eg. `abc123.png` becomes `def456.jpg`); same-type replacements keep the original filename unchanged.
- Every content item and `courseasset` record found to reference the old filename is updated to the new one automatically, so previews and future exports keep working.
- This rename/reference update only runs when the extension actually changes, so same-type replacements behave exactly as before.

### What Gets Updated

- ✅ File content (the actual file)
- ✅ File name
- ✅ File size
- ✅ MIME type
- ✅ Thumbnail (auto-generated)
- ✅ Modified date
- ✅ Title (if you change it)
- ✅ Description (if you change it)
- ✅ Tags (if you change them)

### What Stays the Same

- ✅ Asset ID
- ✅ Creation date
- ✅ Creator
- ✅ Repository location structure
- ✅ All component references (rewritten automatically if the file type/extension changes)

## File Size Limits

The same file size limits apply as for new uploads:

- **Images**: 1MB maximum
- **Videos**: 25MB maximum
- **Audio**: 10MB maximum
- **Documents**: 2MB maximum
- **Archives/Course imports**: 500MB maximum

See [File Upload Limits Documentation](FILE_UPLOAD_LIMITS.md) for more details.

## Use Cases

### Common Scenarios

1. **Updating Course Images**: Replace an outdated screenshot with a new one
2. **Correcting Mistakes**: Fix a typo in an image or document
3. **Version Updates**: Update documentation PDFs to the latest version
4. **Quality Improvements**: Replace low-resolution images with high-resolution ones
5. **Rebranding**: Update logos or branded images across all courses
6. **Content Updates**: Update instructional videos with improved versions

### Example Workflow

**Scenario**: You have a logo used in 20 different courses and need to update it

**Old Way** (without replacement):
1. Upload new logo as a new asset
2. Find all 20 courses
3. Open each course
4. Find every component using the old logo
5. Replace the asset reference in each component
6. Delete the old logo
7. **Time**: Hours of work

**New Way** (with replacement):
1. Go to Asset Management
2. Find the logo asset
3. Click "Replace"
4. Upload new logo
5. Click "Save"
6. **Time**: 2 minutes

## API Endpoint

### Replace Asset

```http
POST /api/asset/replace
Content-Type: multipart/form-data

Parameters:
- _id (required): The ID of the asset to replace
- file (required): The new file to upload
- title (optional): Updated title
- description (optional): Updated description
- tags (optional): Comma-separated list of tag IDs
```

### Response

```json
{
  "success": true,
  "_id": "507f1f77bcf86cd799439011",
  "message": "Asset replaced successfully"
}
```

## Technical Details

### Backend Implementation

The `replaceAsset` function in `lib/assetmanager.js`:

1. Validates the asset ID exists
2. Retrieves the existing asset record
3. Checks file size limits based on MIME type
4. Deletes old file and thumbnail from storage
5. Generates SHA1 hash for new file
6. Processes and stores new file
7. Creates new thumbnail if applicable
8. Updates database record with new information
9. Returns success response

### Frontend Implementation

The replacement view (`AssetManagementReplaceAssetView.js`):

1. Fetches existing asset data
2. Displays current file information
3. Validates file selection
4. Shows upload progress
5. Handles errors gracefully
6. Refreshes asset list on success

## Troubleshooting

### File Upload Fails

**Problem**: "File size limit exceeded" error

**Solution**: Check the file type and ensure it's within limits
- Images should be under 1MB
- Try compressing images before upload
- For videos, consider reducing quality or length

### Asset Not Found

**Problem**: "Asset not found" error

**Solution**: 
- Ensure you haven't deleted the asset
- Check you have permission to modify the asset
- Try refreshing the asset management page

### Old File Still Appears

**Problem**: Courses still show the old file after replacement

**Solution**:
- Clear your browser cache
- Re-preview or re-publish the course
- Check that the replacement actually completed successfully

### Permission Denied

**Problem**: Cannot replace asset

**Solution**:
- Ensure you have edit permissions for the asset
- Only the creator or admins can replace assets
- Contact your system administrator if needed

## Best Practices

1. **Backup First**: Download the original file before replacing (just in case)
2. **Same Format**: Use the same file format to avoid compatibility issues
3. **Similar Dimensions**: For images, keep similar dimensions to avoid layout issues
4. **Test First**: Test in a single course before replacing widely-used assets
5. **Descriptive Names**: Use clear, descriptive file names
6. **Update Metadata**: Update title/description if the content has changed significantly

## Limitations

- Cannot replace asset with a different type (e.g., replace image with video)
- Cannot undo a replacement (except by replacing again with the original)
- File size limits still apply
- Original file is permanently deleted

## Security and Permissions

- **Read**: Any user with access to the asset can view it
- **Replace**: Only users with edit permissions can replace
- **Audit**: All replacements are logged with user and timestamp

## Future Enhancements

Potential improvements for future versions:

- Version history (keep previous versions)
- Undo replacement functionality
- Batch replacement (replace multiple assets)
- Preview comparison (side-by-side old vs new)
- Automatic backup of replaced assets
- Replace with URL (fetch from external source)

## Related Documentation

- [Asset Management Guide](asset-management.md)
- [File Upload Limits](FILE_UPLOAD_LIMITS.md)
- [Audit Log System](AUDIT_LOG.md)
