define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var AssetContext = require('../../lightCourseEditor/lightCourseAssetContext');
  var conversionFieldSchema = require('../conversionFieldSchema');

  return OriginView.extend({
    className: 'light-course-conversion-defaults',
    events: {
      'change .light-course-conversion-group': 'onGroupChanged',
      'click .light-course-conversion-save': 'onSave'
    },
    preRender: function() {
      this.values = JSON.parse(JSON.stringify(this.model.get('conversionDefaults') || {}));
      this.editors = [];
    },
    postRender: function() {
      var self = this;
      AssetContext.set(null);
      $.get('api/lightcourseconfig/conversionschema').done(function(groups) {
        if (self.disposed) return;
        self.groups = groups;
        self.renderSelectors();
        self.$('.light-course-conversion-save').prop('disabled', false);
        self.setViewToReady();
      }).fail(function(response) { if (!self.disposed) self.showError(response); });
    },
    renderSelectors: function() {
      var self = this, first;
      this.$('.light-course-conversion-group').each(function() {
        var $select = $(this), category = $select.attr('data-category');
        var groups = self.groups.filter(function(group) { return group.key.split(':')[0] === category; })
          .sort(function(a, b) {
            return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key);
          });
        $select.empty().append($('<option></option>').val('').text(Origin.l10n.t('app.lightcourseconversionselectgroup')));
        groups.forEach(function(group) {
          $select.append($('<option></option>').val(group.key).text(group.label));
        });
        $select.prop('disabled', !groups.length);
        if (!first && groups.length) first = groups[0].key;
      });
      this.selectGroup(first || '');
      this.renderGroup(first || '');
    },
    selectGroup: function(key) {
      this.$('.light-course-conversion-group').each(function() {
        var $select = $(this);
        $select.val(key && key.split(':')[0] === $select.attr('data-category') ? key : '');
      });
    },
    showError: function(response) {
      this.$('.light-course-conversion-error').text(response && response.responseJSON && response.responseJSON.message ||
        Origin.l10n.t('app.errorgeneric'));
      this.setViewToReady();
    },
    readGroup: function() {
      if (!this.currentGroup) return;
      var values = {};
      var previous = this.values[this.currentGroup] || {};
      var group = (this.groups || []).find(function(group) { return group.key === this.currentGroup; }, this);
      (group && group.fields || []).forEach(function(field) {
        if (field.duplicateContainer && Object.prototype.hasOwnProperty.call(previous, field.path)) {
          values[field.path] = previous[field.path];
        }
      });
      this.editors.forEach(function(entry) {
        if (!entry.enabled.prop('checked')) return;
        var value = entry.form.getValue().value;
        if (value === undefined || value === null || typeof value === 'string' && !value.trim()) {
          throw new Error(Origin.l10n.t('app.lightcourseconversionemptydefault', { path: entry.path }));
        }
        values[entry.path] = value;
      });
      this.values[this.currentGroup] = values;
    },
    onGroupChanged: function(event) {
      var key = $(event.currentTarget).val();
      try { this.readGroup(); } catch (error) {
        this.selectGroup(this.currentGroup);
        return this.showError({ responseJSON: { message: error.message } });
      }
      this.selectGroup(key);
      this.$('.light-course-conversion-error').empty();
      this.renderGroup(key);
    },
    renderGroup: function(key) {
      this.editors.forEach(function(entry) { if (entry.form) entry.form.remove(); });
      this.editors = [];
      this.currentGroup = key;
      var group = _.findWhere(this.groups, { key: key }), self = this;
      var $container = this.$('.light-course-conversion-fields').empty();
      if (!group) return;
      if (group.key === 'extension:footer:contentobject') {
        $container.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionfooternavigationhelp')));
      }
      var values = this.values[key] || {};
      group.fields.forEach(function(field) {
        if (field.hidden) return;
        var enabled = Object.prototype.hasOwnProperty.call(values, field.path);
        var $row = $('<section class="light-course-conversion-default-field"></section>');
        var $checkbox = $('<input type="checkbox">').prop('checked', enabled);
        var label = field.itemGraphic ?
          Origin.l10n.t('app.lightcourseconversionitemgraphic', { path: field.path }) :
          field.questionOption || field.pluginOption ? field.schema.title || field.path : field.path;
        if (group.key === 'extension:footer:contentobject' && field.pluginOption) {
          var buttonKeys = {
            '_footer._previous._isRound': 'lightcoursefooterpreviousround',
            '_footer._next._isRound': 'lightcoursefooternextround',
            '_footer._parent._isRound': 'lightcoursefootermenuround'
          };
          if (buttonKeys[field.path]) label = Origin.l10n.t('app.' + buttonKeys[field.path]);
        }
        $row.append($('<label></label>').append($checkbox).append(document.createTextNode(' ' + label)));
        if (field.itemGraphic) $row.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionitemgraphichelp')));
        else if (field.image) $row.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionimagehelp')));
        if (field.videoPlaceholder) $row.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionvideohelp')));
        if (field.questionOption || field.pluginOption) $row.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionquestionhelp')));
        if (group.key === 'component:splash' && field.pluginOption) $row.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionsplashhelp')));
        if (field.navigationOption) $row.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionnavigationhelp')));
        var definition = field.schema;
        var container = definition.type === 'object' || definition.type === 'array' || definition.properties;
        if (container) $row.addClass('light-course-conversion-default-container');
        var entry = { path: field.path, enabled: $checkbox };
        var model = new Backbone.Model({ value: enabled ? values[field.path] : definition.default });
        var schema = { value: conversionFieldSchema(definition, field.path) };
        entry.form = new Backbone.Form({ model: model, schema: schema }).render();
        if (container) $row.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionnestedhelp')));
        $row.append(entry.form.el);
        self.editors.push(entry);
        $container.append($row);
      });
    },
    onSave: function(event) {
      event.preventDefault();
      try { this.readGroup(); } catch (error) {
        return this.showError({ responseJSON: { message: error.message } });
      }
      var self = this;
      this.$('.light-course-conversion-save').prop('disabled', true);
      this.model.save({ conversionDefaults: this.values }, {
        wait: true,
        success: function() {
          if (self.disposed) return;
          self.$('.light-course-conversion-save').prop('disabled', false);
          self.$('.light-course-conversion-error').empty();
          Origin.Notify.alert({ type: 'success', text: Origin.l10n.t('app.lightcourseconfigsaved') });
        },
        error: function(model, response) {
          if (self.disposed) return;
          self.$('.light-course-conversion-save').prop('disabled', false);
          self.showError(response);
        }
      });
    },
    remove: function() {
      this.disposed = true;
      this.editors.forEach(function(entry) { if (entry.form) entry.form.remove(); });
      return OriginView.prototype.remove.apply(this, arguments);
    }
  }, { template: 'lightCourseConversionDefaults' });
});
