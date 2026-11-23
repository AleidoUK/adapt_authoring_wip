// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var _ = require('underscore');
  var Origin = require('core/origin');

  function link(route, title) {
    return '<a href="#/' + route + '">' + _.escape(title) + '</a>';
  }

  function contentLink(courseId, item) {
    var base = 'editor/' + encodeURIComponent(courseId) + '/';
    var route;
    switch (item.type) {
      case 'course': route = base + 'settings'; break;
      case 'config': route = base + 'config'; break;
      case 'page':
      case 'menu':
      case 'article':
      case 'block':
      case 'component':
        route = base + item.type + '/' + encodeURIComponent(item.id) + '/edit';
        break;
    }
    return route ? link(route, item.title) : _.escape(item.title);
  }

  function render(data) {
    var grouped = Object.create(null);
    var markup = '';
    data.courses.forEach(function(course) {
      grouped[course.id] = [];
    });
    var unmatched = [];
    data.components.forEach(function(item) {
      if (grouped[item.courseId]) grouped[item.courseId].push(item);
      else unmatched.push(item);
    });
    data.courses.forEach(function(course) {
      var base = 'editor/' + encodeURIComponent(course.id) + '/menu';
      markup += '<br/><b>' + link(base, course.title) + '</b><br/>';
      grouped[course.id].forEach(function(item) {
        markup += '* ' + contentLink(course.id, item) + '<br/>';
      });
    });
    if (unmatched.length) {
      markup += '<br/><b>' + _.escape(Origin.l10n.t('app.assetusesunknowncourse')) + '</b><br/>';
      unmatched.forEach(function(item) {
        markup += '* ' + _.escape(item.title) + '<br/>';
      });
    }
    return markup;
  }

  function navigate(event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.which > 1) return;
    event.preventDefault();
    var route = $(event.currentTarget).attr('href').slice(2);
    if ($(event.currentTarget).closest('.modal').length) Origin.trigger('modal:onCancel');
    Origin.router.navigateTo(route);
  }

  return { render: render, navigate: navigate };
});
