#!/usr/bin/env node
/**
 * Test Extension Schema Validator
 * Checks if an extension has valid schema before upload
 */

const fs = require('fs-extra');
const path = require('path');

if (process.argv.length < 3) {
  console.log('Usage: node test-extension-schema.js <path-to-extension-folder>');
  console.log('Example: node test-extension-schema.js ./plugins/content/extension/adapt-aleido-contentBranching');
  process.exit(1);
}

const extensionPath = path.resolve(process.argv[2]);

console.log('Testing extension at:', extensionPath);
console.log('---');

// Check if directory exists
if (!fs.existsSync(extensionPath)) {
  console.error('❌ ERROR: Directory does not exist:', extensionPath);
  process.exit(1);
}

// Check for bower.json
const bowerPath = path.join(extensionPath, 'bower.json');
if (!fs.existsSync(bowerPath)) {
  console.error('❌ ERROR: bower.json not found');
  process.exit(1);
}

let bower;
try {
  bower = JSON.parse(fs.readFileSync(bowerPath, 'utf8'));
  console.log('✓ bower.json is valid JSON');
  console.log('  Name:', bower.name);
  console.log('  Component:', bower.component);
} catch (e) {
  console.error('❌ ERROR: bower.json is not valid JSON:', e.message);
  process.exit(1);
}

// Check for properties.schema
const schemaPath = path.join(extensionPath, 'properties.schema');
if (!fs.existsSync(schemaPath)) {
  console.error('❌ ERROR: properties.schema not found');
  console.log('   Extensions must have a properties.schema file');
  process.exit(1);
}

let schema;
try {
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  schema = JSON.parse(schemaContent);
  console.log('✓ properties.schema is valid JSON');
} catch (e) {
  console.error('❌ ERROR: properties.schema is not valid JSON:', e.message);
  console.error('   Line/Column:', e.message);
  process.exit(1);
}

// Validate schema structure
console.log('\nSchema validation:');

if (!schema.type) {
  console.warn('⚠ WARNING: schema missing "type" field');
}

if (!schema.properties) {
  console.warn('⚠ WARNING: schema missing "properties" field');
} else {
  console.log('✓ Schema has properties');
  const propCount = Object.keys(schema.properties).length;
  console.log('  Properties count:', propCount);
}

// Check for common schema issues
if (schema.properties) {
  console.log('\nChecking property types:');
  Object.keys(schema.properties).forEach(key => {
    const prop = schema.properties[key];
    if (prop.type) {
      console.log('  -', key + ':', prop.type);
      
      // Check for invalid mongoose types
      if (typeof prop.type === 'string') {
        const invalidTypes = ['Objectid', 'ObjectID', 'objectID'];
        if (invalidTypes.includes(prop.type)) {
          console.error('    ❌ ERROR: Invalid type "' + prop.type + '" (should be lowercase "objectid")');
        }
      }
    }
  });
}

console.log('\n✓ Extension structure looks valid!');
console.log('\nYou can now try uploading this extension through the authoring tool.');
