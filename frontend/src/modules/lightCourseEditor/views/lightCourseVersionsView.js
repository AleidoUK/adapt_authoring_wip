define(function(require) {
  var Backbone = require('backbone');
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var FieldPreview = require('../fieldPreview');
  var ComponentLayout = require('../componentLayout');
  var fieldChanges = require('../../auditLog/lightFieldChanges');
  var exportWord = require('../wordExport');

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function valueText(value) {
    if (value === undefined) return Origin.l10n.t('app.lightcourseversionnotrecorded');
    if (value === null || value === '') return Origin.l10n.t('app.lightcourseversionempty');
    if (Array.isArray(value)) return value.map(valueText).join('\n') || Origin.l10n.t('app.lightcourseversionempty');
    if (typeof value === 'object') {
      return Object.keys(value).filter(function(key) {
        return ['_id', '_componentSchemaSnapshot'].indexOf(key) === -1;
      }).map(function(key) { return fieldChanges.label(key) + ': ' + valueText(value[key]); }).join('\n') ||
        Origin.l10n.t('app.lightcourseversionempty');
    }
    return String(value);
  }
  function content(version) {
    var snapshot = copy(version.contentSnapshot || {});
    snapshot.headerData = _.omit(version.headerSnapshot || {}, 'versionHistory');
    if (snapshot.pluginSelections && snapshot.pluginSelections.extensions) snapshot.pluginSelections.extensions.sort();
    if (snapshot.tags) snapshot.tags.sort(function(a, b) {
      return String(a._id || a).localeCompare(String(b._id || b));
    });
    return snapshot;
  }

  function comparison(before, after) {
    function tree(snapshot) {
      var entries = [], byId = Object.create(null);
      function visit(nodes, parentId, path) {
        (nodes || []).forEach(function(node, index) {
          var nodePath = path.concat(fieldChanges.nodeLabel(node, index));
          var entry = { node: node, parentId: parentId, index: index, path: nodePath, element: nodePath.join(' / ') };
          entries.push(entry);
          byId[node._id] = entry;
          visit(node.children, node._id, nodePath);
        });
      }
      visit(snapshot.contentTree && snapshot.contentTree.children, null, []);
      return { entries: entries, byId: byId };
    }
    function location(entry) {
      return (entry.path.slice(0, -1).join(' / ') || Origin.l10n.t('app.lightcoursecourse')) +
        ' / ' + Origin.l10n.t('app.lightcourseversionposition') + ' ' + (entry.index + 1);
    }
    var left = tree(before), right = tree(after);
    var added = right.entries.filter(function(entry) { return !left.byId[entry.node._id]; })
      .map(function(entry) { return { element: entry.element }; });
    var removed = left.entries.filter(function(entry) { return !right.byId[entry.node._id]; })
      .map(function(entry) { return { element: entry.element }; });
    var moved = [];
    function commonOrder(source, other, parentId) {
      return source.entries.filter(function(entry) {
        var match = other.byId[entry.node._id];
        return entry.parentId === parentId && match && match.parentId === parentId;
      }).map(function(entry) { return entry.node._id; });
    }
    right.entries.forEach(function(entry) {
      var previous = left.byId[entry.node._id];
      if (!previous) return;
      if (previous.parentId !== entry.parentId ||
          commonOrder(left, right, entry.parentId).indexOf(entry.node._id) !==
          commonOrder(right, left, entry.parentId).indexOf(entry.node._id)) {
        moved.push({ element: entry.element, before: location(previous), after: location(entry) });
      }
    });
    var fields = [];
    function append(changes, prefix) {
      fieldChanges(changes, function(key, value) {
        return Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value === 'string' ? 'text' : typeof value;
      }, { expandNodes: true, omitEmptyAdditions: true, onItemChange: function(change) {
        var element = prefix ? prefix + ' / ' + change.element : change.element;
        if (change.action === 'added') added.push({ element: element });
        if (change.action === 'removed') removed.push({ element: element });
        if (change.action === 'moved') {
          var parent = (prefix ? prefix + ' / ' : '') + change.parent + ' / ' +
            Origin.l10n.t('app.lightcourseversionposition') + ' ';
          moved.push({ element: element, before: parent + (change.beforeIndex + 1), after: parent + (change.afterIndex + 1) });
        }
      } }).forEach(function(change) {
        fields.push({ field: prefix ? prefix + ' / ' + change.field : change.field,
          before: valueText(change.oldValue), after: valueText(change.newValue) });
      });
    }
    append(_.union(Object.keys(before), Object.keys(after)).filter(function(key) { return key !== 'contentTree'; })
      .map(function(key) { return { field: key, oldValue: before[key], newValue: after[key] }; }));
    _.union(left.entries.map(function(entry) { return entry.node._id; }),
      right.entries.map(function(entry) { return entry.node._id; })).forEach(function(id) {
      var previous = left.byId[id], current = right.byId[id];
      append([{ field: 'contentSnapshot', oldValue: previous && _.omit(previous.node, 'children'),
        newValue: current && _.omit(current.node, 'children') }], (current || previous).element);
    });
    return { added: added, removed: removed, moved: moved, fields: fields,
      hasChanges: !!(added.length || removed.length || moved.length || fields.length) };
  }

  return OriginView.extend({
    className: 'light-course-versions',
    events: {
      'click .light-course-versions-back': 'onBack',
      'click .light-course-version-export': 'onExport',
      'click .light-course-versions-compare': 'onCompare'
    },

    preRender: function(options) {
      this.selectedVersionId = options.selectedVersionId;
      this.versions = [];
    },

    postRender: function() {
      var self = this;
      this.listRequest = this.model.fetchVersions({
        success: function(versions) {
          if (self.disposed) return;
          self.versions = versions.slice().sort(function(a, b) {
            var left = a.versionNumber.split('.').map(Number);
            var right = b.versionNumber.split('.').map(Number);
            return right[0] - left[0] || right[1] - left[1];
          });
          self.$('.light-course-versions-list').html(Handlebars.templates.lightCourseVersionsList({ versions: self.versions }));
          var options = self.versions.map(function(version) {
            return $('<option></option>').val(version._id).text(version.versionNumber);
          });
          self.$('.light-course-versions-from, .light-course-versions-to').empty();
          options.forEach(function(option) { self.$('.light-course-versions-from').append(option.clone()); self.$('.light-course-versions-to').append(option); });
          if (self.versions.length) {
            self.$('.light-course-versions-from').val(self.versions[Math.min(1, self.versions.length - 1)]._id);
            self.$('.light-course-versions-to').val(self.versions[0]._id);
          }
          self.$('.light-course-versions-compare').prop('disabled', !self.versions.length);
          if (self.selectedVersionId) self.viewVersion(self.selectedVersionId);
          self.setViewToReady();
        },
        error: function(response) { if (!self.disposed) self.showError(response); }
      });
    },

    showError: function(response) {
      this.$('.light-course-versions-error').text(response && response.responseJSON && response.responseJSON.message ||
        Origin.l10n.t('app.lightcourseversionloaderror')).prop('hidden', false);
      this.setViewToReady();
    },

    onBack: function(event) {
      event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor/' + this.model.id);
    },

    viewVersion: function(id) {
      var self = this;
      this.selectedVersionId = id;
      this.$('.light-course-versions-error').prop('hidden', true);
      if (this.previewRequest) this.previewRequest.abort();
      this.previewRequest = this.model.fetchVersion(id, {
        success: function(version) {
          if (self.disposed || self.selectedVersionId !== id) return;
          var snapshot = copy(version.contentSnapshot || {});
          ComponentLayout.normalize(snapshot.contentTree || {});
          function nodes(items) {
            return (items || []).map(function(node) {
              return Object.assign({}, node, { label: Origin.l10n.t('app.lightcourse' + node.type),
                fields: FieldPreview(node), children: nodes(node.children) });
            });
          }
          self.$('.light-course-version-preview').html(Handlebars.templates.lightCourseVersionPreview({
            versionNumber: version.versionNumber,
            missingTitle: typeof snapshot.title !== 'string',
            fields: FieldPreview(Object.assign({ type: 'course' }, _.omit(snapshot, 'contentTree'), { headerData: version.headerSnapshot || {} })),
            children: nodes(snapshot.contentTree && snapshot.contentTree.children)
          }));
        },
        error: function(response) { if (!self.disposed && response.statusText !== 'abort') self.showError(response); }
      });
    },

    onExport: function(event) {
      event.preventDefault();
      if (this.disposed || this.exporting) return;
      var id = $(event.currentTarget).data('version-id');
      var version = _.findWhere(this.versions, { _id: id });
      if (!version) return this.showError();
      this.$('.light-course-versions-error').prop('hidden', true);
      this.setExportBusy(true);
      var self = this;
      this.exportRequest = exportWord(new Backbone.Model({
        _id: id, title: version.contentSnapshot && version.contentSnapshot.title || this.model.get('title'),
        versionNumber: version.versionNumber, tags: version.contentSnapshot && version.contentSnapshot.tags || []
      }), {
        isDisposed: function() { return self.disposed; },
        success: function() { self.setExportBusy(false); },
        error: function(response) {
          self.setExportBusy(false);
          self.showError(response);
        }
      });
    },

    setExportBusy: function(busy) {
      this.exporting = busy;
      this.$('.light-course-version-export').prop('disabled', busy);
    },

    onCompare: function(event) {
      event.preventDefault();
      var first = _.findWhere(this.versions, { _id: this.$('.light-course-versions-from').val() });
      var second = _.findWhere(this.versions, { _id: this.$('.light-course-versions-to').val() });
      if (!first || !second) return this.showError();
      this.$('.light-course-versions-error').prop('hidden', true);
      this.$('.light-course-version-comparison').empty();
      if (this.compareRequest) this.compareRequest.abort();
      var self = this;
      this.compareRequest = this.model.compareVersions(first._id, second._id, {
        success: function() {
          if (self.disposed) return;
          self.$('.light-course-version-comparison').html(Handlebars.templates.lightCourseVersionComparison(
            Object.assign({ from: first.versionNumber, to: second.versionNumber }, comparison(content(first), content(second)))));
        },
        error: function(response) { if (!self.disposed && response.statusText !== 'abort') self.showError(response); }
      });
    },

    remove: function() {
      this.disposed = true;
      ['listRequest', 'previewRequest', 'compareRequest', 'exportRequest'].forEach(function(key) { if (this[key]) this[key].abort(); }, this);
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, { template: 'lightCourseVersions' });
});
