# Feature Access Guide

## How to Access All New Features

### 1. Asset Usage Tracking
**Location**: Asset Management  
**How to access**:
1. Navigate to Asset Management
2. Click on any existing asset
3. In the preview pane, look for "Uses:" field
4. Hover over the info icon to see which courses and components use the asset

**What it shows**:
- List of courses using the asset
- List of components within those courses
- "Not used in any courses" if the asset is unused

---

### 2. Asset Replacement
**Location**: Asset Management  
**How to access**:
1. Navigate to Asset Management
2. Click on an existing asset
3. In the preview pane, click the **"Replace asset"** button (between Edit and Delete)
4. Choose a new file
5. Click Save

**What it does**:
- Replaces the asset file while keeping all references intact
- All components using the old asset will automatically use the new one
- Preserves asset ID, title, and tags
- Old file is deleted, new file takes its place

---

### 3. Audit Log / Change History
**Location**: Course Editor Sidebar  
**How to access**:
1. Open any course in the editor
2. Look at the sidebar (left side menu)
3. Click the **"Change history"** button (clock icon)
4. View all create/update/delete actions

**What it shows**:
- Who made the change (user email)
- What was changed (create/update/delete)
- When it happened (timestamp with "X minutes ago")
- Type of content (course, page, article, block, component)
- What changed (field-by-field differences)

**Filtering**:
- Filter by content type (all, course, page, article, block, component)
- Filter by action (all, create, update, delete)
- Shows most recent changes first

---

### 4. GitHub Integration
**Location**: Course Editor Sidebar  
**How to access**:
1. Open any course in the editor
2. **Export the course first** (Export source button)
3. Look at the sidebar (left side menu)
4. Click the **"Push to GitHub"** button (GitHub icon)
5. First time: Configure repository settings
   - Repository Owner: `your-github-username`
   - Repository Name: `my-course-name`
   - Branch: `main` (or custom branch)
6. Enter commit message
7. Click "Push to GitHub"

**What it does**:
- Pushes course source files to a GitHub repository
- Uses SSH keys (secure, server-side only)
- Tracks who made each commit
- Shows last push timestamp
- Option to force push (overwrites remote)

**Requirements**:
- Server must have SSH key configured
- SSH key must be added to your GitHub account
- Course must be exported before pushing

---

### 5. Type-Specific File Upload Limits
**Location**: Asset Management Upload  
**How to access**:
1. Navigate to Asset Management
2. Click "Upload new asset"
3. See the file size limits displayed

**Limits**:
- **Images**: 1MB
- **Videos**: 25MB
- **Audio**: 10MB
- **Documents**: 2MB
- **Archives** (course imports): 500MB

**Error handling**:
- Shows specific error if file exceeds limit for its type
- Tells you the maximum allowed and what you tried to upload

---

### 6. Custom Style Field (Full Width)
**Location**: Course Settings  
**How to access**:
1. Open any course
2. Go to Project Settings
3. Find the "Custom Style" field
4. It now spans the full width of the form

**What it does**:
- Makes it easier to edit CSS/styling code
- Provides more space for reading and writing styles

---

## Troubleshooting

### "Cannot see GitHub button"
- Make sure you've run `npx grunt build`
- Hard refresh browser (Ctrl+F5)
- Check that server is running
- Verify `lib/application.js` includes githubmanager preload

### "Cannot see Audit Log button"
- Make sure you've run `npx grunt build`
- Hard refresh browser (Ctrl+F5)
- Check server logs for auditlog plugin errors

### "Cannot see Replace Asset button"
- Make sure you've run `npx grunt build`
- Hard refresh browser (Ctrl+F5)
- Make sure you're viewing an existing asset (not creating new)

### "Asset usage shows 0 even though it's used"
- Check server logs when clicking an asset
- Should see "Asset found in component X"
- If not finding matches, the asset may be referenced differently

### "GitHub push fails"
- Check SSH key is configured on server
- Check SSH key is added to GitHub account
- Make sure course is exported first
- Check server logs for detailed error

---

## Quick Command Reference

### Rebuild Frontend
```bash
npx grunt build
```

### Restart Server
```bash
pkill -f "node server"
node server
```

### Check Server Logs
```bash
tail -f logs/server.log
```

### Generate SSH Key
```bash
ssh-keygen -t ed25519 -C "adapt@your-domain.com" -f ~/.ssh/adapt_github
```

---

## Documentation Files

- `docs/AUDIT_LOG.md` - Complete audit log documentation
- `docs/AUDIT_LOG_INTEGRATION.md` - Audit log integration guide
- `docs/ASSET_REPLACEMENT.md` - Asset replacement documentation
- `docs/FILE_UPLOAD_LIMITS.md` - File upload limits documentation
- `docs/GITHUB_INTEGRATION.md` - Complete GitHub integration docs
- `docs/GITHUB_SETUP.md` - Quick GitHub setup guide (5 minutes)

---

## Support

If features are not showing:
1. Run `npx grunt build --force`
2. Restart server
3. Hard refresh browser (Ctrl+F5)
4. Check server logs for errors
5. Verify all files were edited correctly
