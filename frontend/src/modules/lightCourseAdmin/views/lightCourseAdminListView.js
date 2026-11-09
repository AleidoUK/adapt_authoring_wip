define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var Tags = require('../../lightCourseEditor/tagEditor');

  return OriginView.extend({
    events: {
      'input .light-course-admin-filter-search': 'onFiltersChanged',
      'change .light-course-admin-filter-type': 'onFiltersChanged',
      'change .light-course-admin-filter-status': 'onFiltersChanged',
      'click .light-course-admin-filter-clear': 'onClearFilters'
    },

    preRender: function() {
      this.filters = { search: '', type: '', status: '', tags: [] };
      this.itemViews = [];
      this.listenTo(this.collection, 'sync remove reset change', this.onCollectionChanged);
    },

    postRender: function() {
      if (this.disposed) return;
      var self = this;
      var $tags = this.$('.light-course-admin-filter-tags');
      if ($tags.length) {
        $tags.selectize({
          valueField: '_id', labelField: 'title', searchField: ['title'], maxItems: null, create: false,
          options: Tags.options(this.collection),
          onChange: function() { self.onFiltersChanged(); }
        });
        this.tagPicker = $tags[0].selectize;
        this.tagPicker.$control_input.attr('aria-label', Origin.l10n.t('app.lightcoursetags'));
        this.tagPicker.$control_input.attr('aria-describedby', 'light-course-template-filter-tag-help');
      }
      this.onCollectionChanged();
      this.fetchRequest = this.collection.fetch({
        success: function() { if (!self.disposed) self.setViewToReady(); },
        error: function(collection, response) {
          if (self.disposed || response.statusText === 'abort') return;
          self.setViewToReady();
          Origin.Notify.alert({ type: 'error', text: response.responseJSON && response.responseJSON.message ||
            Origin.l10n.t(self.loadError) });
        }
      });
    },

    onCollectionChanged: function() {
      if (this.disposed) return;
      if (this.tagPicker) {
        var picker = this.tagPicker, options = Tags.options(this.collection);
        var ids = options.map(function(tag) { return tag._id; });
        Object.keys(picker.options).forEach(function(id) {
          if (ids.indexOf(id) === -1 && picker.items.indexOf(id) === -1) picker.removeOption(id, true);
        });
        options.forEach(function(tag) {
          if (picker.options[tag._id]) picker.updateOption(tag._id, tag);
          else picker.addOption(tag);
        });
        picker.refreshOptions(false);
      }
      this.renderItems();
    },

    onFiltersChanged: function() {
      if (this.disposed) return;
      this.filters = {
        search: this.$('.light-course-admin-filter-search').val() || '',
        type: this.$('.light-course-admin-filter-type').val() || '',
        status: this.$('.light-course-admin-filter-status').val() || '',
        tags: this.tagPicker ? this.tagPicker.items.slice() : []
      };
      this.renderItems();
    },

    onClearFilters: function(event) {
      event && event.preventDefault();
      this.$('.light-course-admin-filter-search, .light-course-admin-filter-type, .light-course-admin-filter-status').val('');
      if (this.tagPicker) this.tagPicker.clear(true);
      this.filters = { search: '', type: '', status: '', tags: [] };
      this.onCollectionChanged();
    },

    matchesFilters: function(model) {
      var search = this.filters.search.trim().toLowerCase();
      if (!(this.searchFields || []).some(function(field) {
        return String(model.get(field) || '').toLowerCase().indexOf(search) !== -1;
      })) return false;
      if (this.filters.type && model.get(this.typeField) !== this.filters.type) return false;
      if (this.filters.status && (model.get('isDefault') === true ? 'default' : 'other') !== this.filters.status) return false;
      var tags = (model.get('tags') || []).map(Tags.id);
      return this.filters.tags.every(function(id) { return tags.indexOf(id) !== -1; });
    },

    createItemView: function(model) {
      return new this.ItemView({ model: model });
    },

    renderItems: function() {
      if (this.disposed) return;
      this.itemViews.forEach(function(view) { view.remove(); });
      this.itemViews = [];
      var $container = this.$(this.listSelector + '-items').empty();
      var matches = this.collection.filter(this.matchesFilters, this);
      this.$('.light-course-admin-filter-results').text(Origin.l10n.t('app.lightcoursefilterresults', {
        shown: matches.length, total: this.collection.length
      }));
      this.$('.light-course-admin-filter-clear').prop('disabled',
        !this.filters.search && !this.filters.type && !this.filters.status && !this.filters.tags.length);
      this.$(this.listSelector + '-empty').text(Origin.l10n.t(this.collection.length ?
        'app.lightcoursefilternomatches' : this.emptyMessage)).toggleClass('display-none', !!matches.length);
      matches.forEach(function(model) {
        var view = this.createItemView(model);
        this.itemViews.push(view);
        $container.append(view.$el);
      }, this);
    },

    remove: function() {
      this.disposed = true;
      if (this.fetchRequest) this.fetchRequest.abort();
      if (this.tagPicker) this.tagPicker.destroy();
      this.itemViews.forEach(function(view) { view.remove(); });
      OriginView.prototype.remove.apply(this, arguments);
    }
  });
});
