define(function(require) {
  var Origin = require('core/origin');

  function id(tag) {
    return typeof tag === 'string' ? tag : tag && tag._id;
  }

  function options(collection) {
    var tags = Object.create(null);
    collection.each(function(model) {
      (model.get('tags') || []).forEach(function(tag) {
        var key = id(tag);
        if (key && (!tags[key] || tags[key].title === key && tag.title)) {
          tags[key] = { _id: key, title: tag.title || key };
        }
      });
    });
    return Object.keys(tags).map(function(key) { return tags[key]; }).sort(function(a, b) {
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    });
  }

  function selected() {
    if (!this.tagPicker) return this.model.get('tags') || [];
    return this.tagPicker.items.map(function(key) {
      return { _id: key, title: this.tagPicker.options[key].title };
    }, this);
  }

  function error(response, key) {
    Origin.Notify.alert({ type: 'error', text: response && response.responseJSON && response.responseJSON.message ||
      Origin.l10n.t(key) });
  }

  function initialize() {
    if (this.tagPicker) this.tagPicker.destroy();
    var self = this;
    var tags = this.model.get('tags') || [];
    this._initializingTags = true;
    this._tagRequests = this._tagRequests || [];
    this.$('.light-course-editor-tags-input').selectize({
      valueField: '_id', labelField: 'title', searchField: ['title'],
      loadingClass: 'selectize-loading', maxItems: null, preload: true,
      options: tags.map(function(tag) { return typeof tag === 'string' ? { _id: tag, title: tag } : tag; }),
      items: tags.map(id),
      createFilter: function(value) { return !!value.replace(/,/g, '').trim(); },
      load: function(query, callback) {
        self._tagRequests.push($.ajax({ url: 'api/autocomplete/tag', type: 'GET' })
          .done(function(data) { if (!self._removed) callback(data); })
          .fail(function(response) {
            if (self._removed || response.statusText === 'abort') return;
            error(response, 'app.lightcoursetagsloaderror');
            callback();
          }));
      },
      create: function(value, callback) {
        self._tagRequests.push($.ajax({
          url: 'api/content/tag', type: 'POST', data: { title: value.replace(/,/g, '').trim() }
        }).done(function(tag) {
          if (self._removed) return;
          if (!tag || !tag._id || typeof tag.title !== 'string') {
            error(null, 'app.lightcoursetagscreateerror');
            return callback();
          }
          callback(tag);
        }).fail(function(response) {
          if (self._removed || response.statusText === 'abort') return;
          error(response, 'app.lightcoursetagscreateerror');
          callback();
        }));
      },
      onChange: function() {
        if (self._initializingTags || self._removed || self.model.isLocked && self.model.isLocked()) return;
        self.model.set('tags', selected.call(self));
        if (self.autosave) self.autosave();
      }
    });
    this.tagPicker = this.$('.light-course-editor-tags-input')[0].selectize;
    this.tagPicker.$control_input.attr('aria-label', Origin.l10n.t('app.lightcoursetags'));
    if (this.model.isLocked && this.model.isLocked()) this.tagPicker.disable();
    this._initializingTags = false;
  }

  function renderTags() {
    this.$('.light-course-list-item-tags').text((this.model.get('tags') || []).map(function(tag) {
      return tag.title || id(tag);
    }).join(', '));
  }

  return { initialize: initialize, selected: selected, error: error, id: id, options: options, renderTags: renderTags };
});
