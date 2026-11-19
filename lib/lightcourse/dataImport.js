var fs = require('fs');
var formidable = require('formidable');
var database = require('../database');
var usermanager = require('../usermanager');
var configuration = require('../configuration');
var logger = require('../logger');
var csv = require('../extensionCsv');

function handler(plugin, template) {
  return function(req, res) {
    var user = usermanager.getCurrentUser(), extension = req.params.extension;
    function fail(status, message, errors) {
      return res.status(status).json({ success: false, message: message, errors: errors || [] });
    }
    if (!user || !user.tenant) return fail(401, 'Please log in to import course data.');
    if (!Object.prototype.hasOwnProperty.call(csv.config, extension)) return fail(400, 'Unsupported CSV extension.');
    database.getDatabase(function(error, db) {
      if (error) return fail(500, error.message);
      db.retrieve('lightcourse', { _id: req.params.id }, { jsonOnly: true }, function(error, courses) {
        if (error) return fail(500, error.message);
        if (!courses || !courses.length) return fail(404, 'Light course not found.');
        var course = courses[0];
        plugin.hasPermission('update', user._id, user.tenant._id, course, function(error, allowed) {
          if (error) return fail(500, error.message);
          if (!allowed) return fail(403, 'You cannot import data into this course.');
          var selected = course.pluginSelections && course.pluginSelections.extensions || [];
          if (!selected.includes(extension)) return fail(400, 'The ' + extension + ' extension is not selected for this course.');
          if (template) {
            var settings = csv.config[extension];
            var lines = [settings.columns, settings.sampleRow].map(function(row) {
              return row.map(function(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }).join(',');
            });
            res.set({
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': 'attachment; filename="' + extension + '-import-template.csv"'
            });
            return res.status(200).send(lines.join('\r\n') + '\r\n');
          }
          var form = new formidable.IncomingForm();
          form.maxFileSize = configuration.getMaxFileUploadSize('text/csv');
          form.parse(req, function(error, fields, files) {
            if (error) return fail(400, error.message);
            var file = files.file;
            if (!file || !file.path) return fail(400, 'No CSV file was uploaded.');
            fs.readFile(file.path, 'utf8', function(readError, content) {
              fs.unlink(file.path, function(cleanupError) {
                if (cleanupError) logger.log('error', 'Failed to remove Light Course CSV upload: ' + cleanupError.message);
                if (readError) return fail(500, 'Failed to read uploaded CSV file.');
                var result;
                try {
                  result = csv.parse(extension, content);
                } catch (parseError) {
                  return fail(400, 'Failed to parse CSV: ' + parseError.message);
                }
                if (!result.items.length) return fail(400, 'No valid rows found in CSV.', result.errors);
                res.status(200).json({ items: result.items, errors: result.errors, skipped: result.errors.length });
              });
            });
          });
        });
      });
    }, user.tenant._id);
  };
}

module.exports = handler;
