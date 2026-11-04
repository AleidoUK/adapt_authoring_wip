# File Upload Size Limits

The authoring tool supports different file size limits for different media types to optimize storage and performance.

## Configuration

You can configure file upload limits in your `conf/config.json` file:

```json
{
  "maxFileUploadSize": "20MB",
  "maxFileUploadSizes": {
    "image": "1MB",
    "video": "25MB",
    "audio": "10MB",
    "document": "2MB",
    "zip": "500MB",
    "default": "20MB"
  }
}
```

## File Type Categories

The system automatically categorizes uploaded files based on their MIME type:

### Image Files (1MB default)
- image/jpeg, image/jpg
- image/png
- image/gif
- image/webp
- image/svg+xml

### Video Files (25MB default)
- video/mp4
- video/webm
- video/ogg
- video/quicktime

### Audio Files (10MB default)
- audio/mpeg, audio/mp3
- audio/wav
- audio/ogg

### Document Files (2MB default)
- application/pdf
- application/msword
- application/vnd.openxmlformats-officedocument.wordprocessingml.document

### Archive/Import Files (500MB default)
- application/zip
- application/x-zip-compressed
- application/x-tar
- application/gzip

### Other Files
Any file type not listed above will use the `default` size limit (20MB by default).

## Backward Compatibility

The `maxFileUploadSize` setting is still supported for backward compatibility. If `maxFileUploadSizes` is not specified, all file types will use the `maxFileUploadSize` value.

## Size Format

File sizes can be specified using the following units:
- `B` - Bytes
- `KB` - Kilobytes
- `MB` - Megabytes
- `GB` - Gigabytes

Examples: `500KB`, `1MB`, `100MB`, `1GB`

## Usage

When a user uploads a file, the system:
1. Detects the file's MIME type
2. Maps it to a category (image, video, audio, etc.)
3. Applies the appropriate size limit
4. Returns a clear error message if the file exceeds the limit

The error message will indicate the maximum allowed size for that specific file type.
