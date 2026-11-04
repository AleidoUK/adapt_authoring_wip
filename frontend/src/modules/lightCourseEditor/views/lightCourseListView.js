// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseListItemView = require('./lightCourseListItemView');

  var LightCourseListView = OriginView.extend({
    className: 'light-course-list',

    events: {
      'click .light-course-list-create': 'onCreateClicked'
    },

    preRender: function() {
      this.listenTo(this.collection, 'sync', this.renderItems);
      this.listenTo(this.collection, 'remove', this.renderItems);
    },

    postRender: function() {
      this.collection.fetch({
        success: this.setViewToReady.bind(this)
      });
    },

    renderItems: function() {
      var $container = this.$('.light-course-list-items');
      $container.empty();
      if (!this.collection.length) {
        this.$('.light-course-list-empty').removeClass('display-none');
        return;
      }
      this.$('.light-course-list-empty').addClass('display-none');
      this.collection.each(function(model) {
        $container.append(new LightCourseListItemView({ model: model }).$el);
      });
    },

    onCreateClicked: function(event) {
      event && event.preventDefault();
      Origin.router.navigateTo('lightCourseEditor/new');
    }
  }, {
    template: 'lightCourseList'
  });

  return LightCourseListView;
});
