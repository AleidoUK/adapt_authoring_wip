// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseListItemView = require('./lightCourseListItemView');

  function tagId(tag) {
    return typeof tag === 'string' ? tag : tag && tag._id;
  }

  var LightCourseListView = OriginView.extend({
    className: 'light-course-list',

    events: {
      'click .light-course-list-create': 'onCreateClicked',
      'input .light-course-list-filter-title': 'onFiltersChanged',
      'change .light-course-list-filter-state': 'onFiltersChanged',
      'click .light-course-list-filter-clear': 'onClearFilters'
    },

    preRender: function() {
      this.filters = { title: '', tags: [], state: '' };
      this.itemViews = [];
      this.listenTo(this.collection, 'sync remove reset change:title change:tags change:conversionStatus', this.onCollectionChanged);
    },

    postRender: function() {
      if (this._removed) return;
      var self = this;
      this.$('.light-course-list-filter-tags').selectize({
        valueField: '_id',
        labelField: 'title',
        searchField: ['title'],
        maxItems: null,
        create: false,
        options: this.getTagOptions(),
        onChange: function() { self.onFiltersChanged(); }
      });
      this.tagPicker = this.$('.light-course-list-filter-tags')[0].selectize;
      this.tagPicker.$control_input.attr('aria-label', Origin.l10n.t('app.lightcoursetags'));
      this.tagPicker.$control_input.attr('aria-describedby', 'light-course-list-tag-help');
      this.onCollectionChanged();
      this.fetchRequest = this.collection.fetch({
        success: function() { if (!self._removed) self.setViewToReady(); },
        error: function(collection, response) {
          if (self._removed || response.statusText === 'abort') return;
          self.setViewToReady();
          Origin.Notify.alert({ type: 'error', text: response.responseJSON && response.responseJSON.message ||
            Origin.l10n.t('app.errorgettinglightcourses') });
        }
      });
    },

    getTagOptions: function() {
      var options = Object.create(null);
      this.collection.each(function(model) {
        (model.get('tags') || []).forEach(function(tag) {
          var id = tagId(tag);
          if (id && (!options[id] || options[id].title === id && typeof tag !== 'string' && tag.title)) {
            options[id] = { _id: id, title: typeof tag === 'string' ? tag : tag.title || id };
          }
        });
      });
      return _.sortBy(Object.keys(options).map(function(id) { return options[id]; }), function(tag) {
        return tag.title.toLowerCase();
      });
    },

    onCollectionChanged: function() {
      if (this._removed) return;
      if (this.tagPicker) {
        var picker = this.tagPicker;
        var options = this.getTagOptions();
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
      if (this._removed) return;
      this.filters.title = this.$('.light-course-list-filter-title').val() || '';
      this.filters.state = this.$('.light-course-list-filter-state').val() || '';
      this.filters.tags = this.tagPicker ? this.tagPicker.items.slice() : [];
      this.renderItems();
    },

    onClearFilters: function(event) {
      event && event.preventDefault();
      this.$('.light-course-list-filter-title').val('');
      this.$('.light-course-list-filter-state').val('');
      this.tagPicker.clear(true);
      this.filters = { title: '', tags: [], state: '' };
      this.onCollectionChanged();
    },

    matchesFilters: function(model) {
      var title = this.filters.title.trim().toLowerCase();
      if (String(model.get('title') || '').toLowerCase().indexOf(title) === -1) return false;
      var state = model.get('conversionStatus') === 'converted' ? 'converted' : 'draft';
      if (this.filters.state && state !== this.filters.state) return false;
      var tags = (model.get('tags') || []).map(tagId);
      return this.filters.tags.every(function(id) { return tags.indexOf(id) !== -1; });
    },

    removeItems: function() {
      this.itemViews.forEach(function(view) { view.remove(); });
      this.itemViews = [];
    },

    renderItems: function() {
      if (this._removed) return;
      var $container = this.$('.light-course-list-items');
      this.removeItems();
      $container.empty();
      var matches = this.collection.filter(this.matchesFilters, this);
      this.$('.light-course-list-results').text(Origin.l10n.t('app.lightcourselistresults', {
        shown: matches.length, total: this.collection.length
      }));
      this.$('.light-course-list-filter-clear').prop('disabled',
        !this.filters.title && !this.filters.tags.length && !this.filters.state);
      if (!matches.length) {
        this.$('.light-course-list-empty').text(Origin.l10n.t(this.collection.length ?
          'app.lightcourselistnomatches' : 'app.lightcoursenonetodisplay'));
        this.$('.light-course-list-empty').removeClass('display-none');
        return;
      }
      this.$('.light-course-list-empty').addClass('display-none');
      matches.forEach(function(model) {
        var view = new LightCourseListItemView({ model: model });
        this.itemViews.push(view);
        $container.append(view.$el);
      }, this);
    },

    onCreateClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor/new');
    },

    remove: function() {
      this._removed = true;
      if (this.fetchRequest) this.fetchRequest.abort();
      if (this.tagPicker) this.tagPicker.destroy();
      this.removeItems();
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseList'
  });

  return LightCourseListView;
});
