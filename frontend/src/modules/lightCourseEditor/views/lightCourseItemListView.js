// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  /**
   * Generic add/edit/reorder/remove list editor for the Light Course Editor's extension-gated
   * content lists (glossary/resource/help-item entries - Phase 4's "Glossary/resources entries"
   * and "Help extension editor" sections). Each entry is a flat object with a stable `_id` (per
   * Phase 2's item-ID convention) plus whatever text/select fields are configured.
   *
   * Gated on the owning extension being selected, per the main plan ("if a course doesn't have
   * the glossary or resources extension selected, the editor will say so rather than let entries
   * be added and then quietly dropped") - callers pass `isEnabled` based on
   * `pluginSelections.extensions`.
   *
   * options:
   *   - items: the array to edit (mutated in place; this.getItems() also returns it)
   *   - fields: [{ key, label, type: 'text'|'textarea'|'select', options: [] }]
   *   - isEnabled: boolean
   *   - disabledMessageKey: l10n key shown instead of the editor when isEnabled is false
   *   - emptyItem: function returning a new blank item's extra fields (merged with a fresh _id)
   */
  var LightCourseItemListView = OriginView.extend({
    className: 'light-course-item-list',

    events: {
      'click .light-course-item-list-add': 'onAddClicked',
      'click .light-course-item-list-remove': 'onRemoveClicked',
      'click .light-course-item-list-move-up': 'onMoveUpClicked',
      'click .light-course-item-list-move-down': 'onMoveDownClicked',
      'change .light-course-csv-file': 'onImportFileChanged',
      'click .light-course-csv-import': 'onImportClicked',
      'change [data-item-field]': 'onFieldChanged',
      'blur [data-item-field]': 'onFieldChanged'
    },

    preRender: function(options) {
      this.items = options.items;
      this.fields = options.fields;
      this.isEnabled = options.isEnabled;
      this.disabledMessageKey = options.disabledMessageKey;
      this.emptyItem = options.emptyItem || function() { return {}; };
      this.importExtension = options.importExtension;
      this.courseModel = options.courseModel;
      this.saveImport = options.saveImport;
    },

    postRender: function() {
      this.renderItems();
      this.setViewToReady();
    },

    getItems: function() {
      return this.items;
    },

    renderItems: function() {
      if (!this.isEnabled) {
        this.$el.html('<p class="light-course-item-list-disabled">' + Origin.l10n.t('app.' + this.disabledMessageKey) + '</p>');
        return;
      }
      var self = this;
      var $container = $('<div class="light-course-item-list-rows"></div>');
      this.items.forEach(function(item, index) {
        $container.append(self.renderRow(item, index));
      });
      this.$el.html('').append($container).append(
        '<button class="btn secondary light-course-item-list-add">' + Origin.l10n.t('app.lightcourseadditem') + '</button>'
      );
      if (this.importExtension && !this.courseModel.isLocked()) this.renderImport();
    },

    renderImport: function() {
      var extension = this.importExtension;
      var url = 'api/content/lightcourse/' + encodeURIComponent(this.courseModel.id || this.courseModel.get('_id')) +
        '/data-import/' + extension;
      this.importUrl = url;
      this.$el.append(
        '<div class="light-course-csv">' +
        '<h4>' + Origin.l10n.t('app.editordataimport') + '</h4>' +
        '<p>' + Origin.l10n.t('app.dataimportrequiredcolumns') + ': <code>' +
        (extension === 'glossary' ? 'term, description' :
          'title, _type, description, _link, filename, _isGlobal, _forceDownload, _id') + '</code></p>' +
        '<p><a href="' + url + '/template" download>' + Origin.l10n.t('app.dataimportdownloadtemplate') + '</a></p>' +
        '<form class="light-course-csv-form" enctype="multipart/form-data">' +
        '<label>' + Origin.l10n.t('app.dataimportfile') +
        '<input type="file" name="file" class="light-course-csv-file" accept=".csv"></label>' +
        '<label>' + Origin.l10n.t('app.dataimportmode') +
        '<select class="light-course-csv-mode"><option value="append">' + Origin.l10n.t('app.dataimportappend') +
        '</option><option value="replace">' + Origin.l10n.t('app.dataimportreplace') + '</option></select></label>' +
        '<button type="button" class="btn secondary light-course-csv-import" disabled>' +
        Origin.l10n.t('app.dataimportbutton') + '</button></form>' +
        '<p class="light-course-csv-feedback" role="status" aria-live="polite"></p></div>'
      );
    },

    onImportFileChanged: function(event) {
      this.$('.light-course-csv-import').prop('disabled', this.importPending || !event.target.files.length);
    },

    onImportClicked: function(event) {
      event.preventDefault();
      if (this.importPending || this.courseModel.isLocked()) return;
      var self = this, mode = this.$('.light-course-csv-mode').val();
      Origin.Notify.confirm({
        type: 'warning',
        title: Origin.l10n.t('app.dataimportconfirmtitle'),
        text: Origin.l10n.t(mode === 'replace' ? 'app.dataimportconfirmreplace' : 'app.dataimportconfirmappend',
          { extension: Origin.l10n.t(this.importExtension === 'glossary' ? 'app.lightcourseglossary' : 'app.lightcourseresources') }),
        destructive: mode === 'replace',
        callback: function(confirmed) {
          if (confirmed && !self.importDisposed && !self.courseModel.isLocked() && !self.importPending) self.performImport(mode);
        }
      });
    },

    importFeedback: function(message, error) {
      this.$('.light-course-csv-feedback').toggleClass('error', !!error).text(message);
    },

    performImport: function(mode) {
      var self = this;
      this.importPending = true;
      this.$('.light-course-csv-import').prop('disabled', true);
      this.importFeedback(Origin.l10n.t('app.dataimportinprogress'));
      this.saveImport(function(error) {
        if (self.importDisposed) return;
        if (error) return self.finishImport(Origin.l10n.t('app.lightcoursecsvpreparefailed'), true);
        self.updateItemsFromModel();
        self.uploadImport(mode);
      });
    },

    updateItemsFromModel: function() {
      var saved = this.courseModel.get(this.importExtension === 'glossary' ? 'glossaryItems' : 'resourceItems').slice();
      this.items.length = 0;
      var items = this.items;
      saved.forEach(function(item) { items.push(item); });
    },

    uploadImport: function(mode) {
      var self = this;
      this.$('.light-course-csv-form').ajaxSubmit({
        url: this.importUrl,
        type: 'POST',
        dataType: 'json',
        success: function(response) {
          if (self.importDisposed) return;
          var items = mode === 'replace' ? [] : self.items.slice();
          var ids = new Set(items.filter(function(item) { return item._id; }).map(function(item) { return item._id; }));
          var collision = (response.items || []).some(function(item) {
            if (!item._id) return false;
            if (ids.has(item._id)) return true;
            ids.add(item._id);
            return false;
          });
          if (collision) return self.finishImport(Origin.l10n.t('app.lightcoursecsvduplicateids'), true);
          items = items.concat(response.items);
          self.items.length = 0;
          items.forEach(function(item) { self.items.push(item); });
          self.courseModel.set(self.importExtension === 'glossary' ? 'glossaryItems' : 'resourceItems', self.items, { silent: true });
          self.saveImport(function(error) {
            if (self.importDisposed) return;
            if (error) {
              self.renderItems();
              return self.finishImport(Origin.l10n.t('app.lightcoursecsvsavefailed'), true);
            }
            // Pick up IDs assigned by the normal save, keeping subsequent imports and edits stable.
            self.updateItemsFromModel();
            self.renderItems();
            var message = Origin.l10n.t('app.dataimportsuccess', { imported: response.items.length, total: items.length });
            if (response.skipped) message += ' ' + Origin.l10n.t('app.dataimportskipped', { skipped: response.skipped });
            (response.errors || []).forEach(function(entry) { message += ' ' + entry.row + ': ' + entry.message; });
            self.finishImport(message, false);
          });
        },
        error: function(xhr) {
          if (self.importDisposed) return;
          var response = xhr.responseJSON || {};
          var message = response.message || Origin.l10n.t('app.dataimporterror');
          (response.errors || []).forEach(function(entry) { message += ' ' + entry.row + ': ' + entry.message; });
          self.finishImport(message, true);
        }
      });
    },

    finishImport: function(message, error) {
      this.importPending = false;
      this.importFeedback(message, error);
      var input = this.$('.light-course-csv-file')[0];
      this.$('.light-course-csv-import').prop('disabled', !input || !input.files.length);
    },

    remove: function() {
      this.importDisposed = true;
      return OriginView.prototype.remove.apply(this, arguments);
    },

    renderRow: function(item, index) {
      var self = this;
      var $row = $('<div class="light-course-item-list-row" data-index="' + index + '"></div>');
      this.fields.forEach(function(field) {
        var $field;
        if (field.type === 'textarea') {
          $field = $('<textarea></textarea>').val(item[field.key] || '');
        } else if (field.type === 'select') {
          $field = $('<select></select>');
          (field.options || []).forEach(function(option) {
            $field.append($('<option></option>').attr('value', option).text(option).prop('selected', item[field.key] === option));
          });
        } else {
          $field = $('<input type="text">').val(item[field.key] || '');
        }
        $field.attr('placeholder', field.label);
        if (field.readOnly) {
          $field.prop('readOnly', true).attr('data-item-readonly-field', field.key).attr('aria-label', field.label);
        } else {
          $field.attr('data-item-field', field.key);
        }
        $row.append($('<label></label>').text(field.label)).append($field);
      });
      $row.append(
        '<span class="light-course-item-list-actions">' +
        '<button class="btn-icon light-course-item-list-move-up" title="' + Origin.l10n.t('app.lightcoursemoveup') + '"><i class="fa fa-arrow-up"></i></button>' +
        '<button class="btn-icon light-course-item-list-move-down" title="' + Origin.l10n.t('app.lightcoursemovedown') + '"><i class="fa fa-arrow-down"></i></button>' +
        '<button class="btn-icon light-course-item-list-remove" title="' + Origin.l10n.t('app.remove') + '"><i class="fa fa-trash-o"></i></button>' +
        '</span>'
      );
      return $row;
    },

    onFieldChanged: function(event) {
      var $target = $(event.currentTarget);
      var index = $target.closest('.light-course-item-list-row').data('index');
      this.items[index][$target.data('item-field')] = $target.val();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onAddClicked: function(event) {
      event && event.preventDefault();
      this.items.push(Object.assign({ _id: '' }, this.emptyItem()));
      this.renderItems();
      var self = this;
      Origin.trigger('lightCourseEditor:autosave', function(error) {
        if (error || self.importDisposed || !self.courseModel) return;
        self.updateItemsFromModel();
        self.$('[data-item-readonly-field="_id"]').each(function(index) {
          $(this).val(self.items[index]._id || '');
        });
      });
    },

    onRemoveClicked: function(event) {
      event && event.preventDefault();
      var index = $(event.currentTarget).closest('.light-course-item-list-row').data('index');
      this.items.splice(index, 1);
      this.renderItems();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onMoveUpClicked: function(event) {
      event && event.preventDefault();
      this.moveItem($(event.currentTarget).closest('.light-course-item-list-row').data('index'), -1);
    },

    onMoveDownClicked: function(event) {
      event && event.preventDefault();
      this.moveItem($(event.currentTarget).closest('.light-course-item-list-row').data('index'), 1);
    },

    moveItem: function(index, direction) {
      var newIndex = index + direction;
      if (newIndex < 0 || newIndex >= this.items.length) {
        return;
      }
      var item = this.items.splice(index, 1)[0];
      this.items.splice(newIndex, 0, item);
      this.renderItems();
      Origin.trigger('lightCourseEditor:autosave');
    }
  }, {
    template: 'lightCourseItemList'
  });

  return LightCourseItemListView;
});
