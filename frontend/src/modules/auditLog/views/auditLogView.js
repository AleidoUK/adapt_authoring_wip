// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');
  var OriginView = require('core/views/originView');
  var Origin = require('core/origin');
  var lightFieldChanges = require('../lightFieldChanges');
  
  var AuditLogView = OriginView.extend({
    
    tagName: 'div',
    className: 'audit-log-view',
    
    events: {
      'click .audit-log-item': 'onLogItemClick',
      'change .audit-filter-action': 'onFilterChange',
      'change .audit-filter-user': 'onFilterChange',
      'change .audit-filter-type': 'onFilterChange',
      'change .audit-filter-content': 'onFilterChange',
      'click .audit-load-more': 'onLoadMore'
    },
    
    initialize: function(options) {
      this.courseId = this.model ? this.model.get('courseId') : (options && options.courseId);
      // Light Course Editor reuse: content-type/content-id scoped logs (light courses have no
      // _courseId to key off, since they're a single flat document, not a course/contentobject/
      // article/block/component tree) - falls back to the courseId-based endpoint above when
      // neither is supplied, so the full-course editor's existing usage is unaffected.
      this.contentType = this.model ? this.model.get('contentType') : (options && options.contentType);
      this.contentId = this.model ? this.model.get('contentId') : (options && options.contentId);
      this.logs = [];
      this.filteredLogs = [];
      this.currentPage = 0;
      this.pageSize = 50;
      this.filters = {
        action: 'all',
        user: 'all',
        type: 'all',
        contentId: 'all'
      };
      
      this.listenTo(Origin, 'auditLog:refresh', this.loadLogs);
      this.loadLogs();
    },
    
    preRender: function() {
      this.setViewToReady();
    },
    
    postRender: function() {
      this.renderLogs();
    },
    
    loadLogs: function() {
      var self = this;
      var url = this.contentType
        ? ('api/auditlog/content/' + this.contentType + '/' + this.contentId + '?limit=500')
        : ('api/auditlog/course/' + this.courseId + '?limit=500');

      $.ajax({
        url: url,
        type: 'GET',
        success: function(data) {
          // belt-and-braces: ensure newest-first regardless of what order the server returned
          self.logs = (data || []).slice().sort(function(a, b) {
            return new Date(b.timestamp) - new Date(a.timestamp);
          });
          self.applyFilters();
          self.renderLogs();
        },
        error: function(error) {
          Origin.Notify.alert({
            type: 'error',
            text: Origin.l10n.t('app.errorloadingauditlogs')
          });
        }
      });
    },
    
    applyFilters: function() {
      var self = this;
      
      this.filteredLogs = this.logs.filter(function(log) {
        if (self.filters.action !== 'all' && log.action !== self.filters.action) {
          return false;
        }
        
        if (self.filters.user !== 'all' && log.userName !== self.filters.user) {
          return false;
        }
        
        if (self.filters.type !== 'all' && log.contentType !== self.filters.type) {
          return false;
        }
        
        if (self.filters.contentId !== 'all' && String(log.contentId) !== self.filters.contentId) {
          return false;
        }
        
        return true;
      });
    },
    
    // picks the most recent title seen for each content id of the given type, for the content-id filter options
    getUniqueContentItems: function(type) {
      var map = {};
      this.logs.forEach(function(log) {
        if (log.contentType !== type) {
          return;
        }
        var id = String(log.contentId);
        if (!map[id] || new Date(log.timestamp) > new Date(map[id].timestamp)) {
          map[id] = { contentId: id, contentTitle: log.contentTitle, timestamp: log.timestamp };
        }
      });
      return Object.keys(map).map(function(id) {
        return map[id];
      }).sort(function(a, b) {
        return (a.contentTitle || '').localeCompare(b.contentTitle || '');
      });
    },
    
    renderLogs: function() {
      var self = this;
      var $container = this.$('.audit-logs-container');
      
      if (!$container.length) {
        $container = $('<div class="audit-logs-container"></div>');
        this.$el.append($container);
      }
      
      $container.empty();
      
      // Add filters
      this.renderFilters($container);
      
      // Add logs
      var logsToShow = this.filteredLogs.slice(0, (this.currentPage + 1) * this.pageSize);
      
      if (logsToShow.length === 0) {
        $container.append('<div class="audit-no-logs">No audit logs found</div>');
        return;
      }
      
      logsToShow.forEach(function(log) {
        $container.append(self.renderLogItem(log));
      });
      
      // Add load more button if needed
      if (logsToShow.length < this.filteredLogs.length) {
        $container.append('<button class="btn audit-load-more">Load More</button>');
      }
    },
    
    renderFilters: function($container) {
      var self = this;
      var uniqueUsers = _.uniq(this.logs.map(function(log) { return log.userName; }));
      var uniqueTypes = _.uniq(this.logs.map(function(log) { return log.contentType; }));
      
      var filtersHtml = '<div class="audit-filters">' +
        '<select class="audit-filter-action">' +
        '<option value="all"' + (this.filters.action === 'all' ? ' selected' : '') + '>All Actions</option>' +
        '<option value="create"' + (this.filters.action === 'create' ? ' selected' : '') + '>Create</option>' +
        '<option value="update"' + (this.filters.action === 'update' ? ' selected' : '') + '>Update</option>' +
        '<option value="delete"' + (this.filters.action === 'delete' ? ' selected' : '') + '>Delete</option>' +
        '</select>' +
        '<select class="audit-filter-user">' +
        '<option value="all"' + (this.filters.user === 'all' ? ' selected' : '') + '>All Users</option>';
      
      uniqueUsers.forEach(function(user) {
        filtersHtml += '<option value="' + self.escapeHtml(user) + '"' + (self.filters.user === user ? ' selected' : '') + '>' + self.escapeHtml(user) + '</option>';
      });
      
      filtersHtml += '</select>' +
        '<select class="audit-filter-type">' +
        '<option value="all"' + (this.filters.type === 'all' ? ' selected' : '') + '>All Types</option>';
      
      uniqueTypes.forEach(function(type) {
        filtersHtml += '<option value="' + self.escapeHtml(type) + '"' + (self.filters.type === type ? ' selected' : '') + '>' + self.escapeHtml(type) + '</option>';
      });
      
      filtersHtml += '</select>';
      
      // only show the id filter once a specific type has been chosen
      if (this.filters.type !== 'all') {
        var items = this.getUniqueContentItems(this.filters.type);
        filtersHtml += '<select class="audit-filter-content">' +
          '<option value="all"' + (this.filters.contentId === 'all' ? ' selected' : '') + '>All ' + self.escapeHtml(this.filters.type) + 's</option>';
        
        items.forEach(function(item) {
          var label = item.contentId + (item.contentTitle ? ' (' + item.contentTitle + ')' : '');
          filtersHtml += '<option value="' + item.contentId + '"' + (self.filters.contentId === item.contentId ? ' selected' : '') + '>' + self.escapeHtml(label) + '</option>';
        });
        
        filtersHtml += '</select>';
      }
      
      filtersHtml += '</div>';
      
      $container.append(filtersHtml);
    },
    
    renderLogItem: function(log) {
      var isLightEditor = ['lightcourse', 'lightcoursetemplate', 'lightcomponentdefault', 'lightcourseconfig', 'lightcourseasset']
        .indexOf(this.contentType) !== -1;
      if (isLightEditor) {
        log = Object.assign({}, log, { changes: lightFieldChanges(log.changes, this.inferValueType.bind(this)) });
      }
      var title = isLightEditor
        ? this.escapeHtml(log.changes.length ? _.uniq(log.changes.map(function(change) { return change.field; })).join(', ')
          : Origin.l10n.t(log.action === 'update' ? 'app.lightcourseauditnofields' : 'app.lightcourseaudit' + log.action))
        : (log.contentTitle ? this.escapeHtml(log.contentTitle) : '<em>(untitled)</em>');
      var actionClass = 'audit-action-' + log.action;
      var timestamp = new Date(log.timestamp);
      var timeAgo = this.getTimeAgo(timestamp);
      
      var html = '<div class="audit-log-item ' + actionClass + '" data-log-id="' + log._id + '">' +
        '<div class="audit-log-header' + (isLightEditor ? ' audit-log-header-light' : '') + '">' +
        '<span class="audit-action-badge">' + log.action.toUpperCase() + '</span>' +
        '<span class="audit-content-type">' + this.escapeHtml(log.contentType) + '</span>' +
        '<span class="audit-content-title">' + title + '</span>' +
        '<span class="audit-content-id" title="Content ID' + (log.parentId ? ' (Parent ID)' : '') + '">' + log.contentId + (log.parentId ? ' (' + log.parentId + ')' : '') + '</span>' +
        '<span class="audit-user-email" title="User">' + this.escapeHtml(log.userEmail || log.userName) + '</span>' +
        '<span class="audit-timestamp" title="' + timestamp.toLocaleString() + '">' + timeAgo + '</span>' +
        '</div>' +
        '<div class="audit-log-details">' +
        '<div class="audit-log-user">' +
        '<i class="icon icon-user"></i> ' + this.escapeHtml(log.userName) + (log.userEmail ? ' (' + this.escapeHtml(log.userEmail) + ')' : '') +
        '</div>' +
        '<ul class="audit-log-meta">' +
        '<li><strong>Content ID:</strong> ' + log.contentId + '</li>' +
        (log.parentId ? '<li><strong>Parent ID:</strong> ' + log.parentId + '</li>' : '') +
        (log.courseId ? '<li><strong>Course ID:</strong> ' + log.courseId + '</li>' : '') +
        '<li><strong>Full timestamp:</strong> ' + timestamp.toLocaleString() + '</li>' +
        '</ul>';
      
      if (log.changes && log.changes.length > 0) {
        html += '<div class="audit-log-changes">' +
          '<strong>Changes:</strong>' +
          '<ul>';
        
        log.changes.forEach(function(change) {
          var changeIcon = this.getChangeIcon(change.changeType);
          var changeText = this.formatChange(change);
          html += '<li>' +
            '<i class="' + changeIcon + '"></i> ' +
            '<strong>' + this.escapeHtml(change.field) + ':</strong> ' +
            changeText +
            '</li>';
        }.bind(this));
        
        html += '</ul></div>';
      } else if (log.snapshot) {
        html += this.renderSnapshotDetails(log.snapshot);
      }
      
      html += '</div>'; // .audit-log-details
      
      html += '</div>';
      
      return html;
    },
    
    renderSnapshotDetails: function(snapshot) {
      var ignoredKeys = ['_id', '__v', '_tenantId', '_isDeleted', 'createdAt', 'updatedAt', 'createdBy'];
      var html = '<div class="audit-log-snapshot">' +
        '<strong>Details:</strong>' +
        '<ul>';
      
      Object.keys(snapshot).forEach(function(key) {
        if (ignoredKeys.indexOf(key) !== -1) {
          return;
        }
        
        var value = snapshot[key];
        if (typeof value === 'undefined' || value === null || value === '') {
          return;
        }
        
        html += '<li><strong>' + this.escapeHtml(key) + ':</strong> ' + this.formatValue(value, this.inferValueType(key, value)) + '</li>';
      }.bind(this));
      
      html += '</ul></div>';
      
      return html;
    },
    
    inferValueType: function(fieldName, value) {
      if (/_graphic|image|thumbnail|src|_backgroundImage/.test(fieldName)) {
        return 'image';
      }
      if (/_media|video|mp4|webm/.test(fieldName)) {
        return 'video';
      }
      if (/audio|mp3|ogg/.test(fieldName)) {
        return 'audio';
      }
      if (typeof value === 'boolean') {
        return 'boolean';
      }
      if (typeof value === 'number') {
        return 'number';
      }
      if (Array.isArray(value)) {
        return 'array';
      }
      if (typeof value === 'object') {
        return 'object';
      }
      return 'text';
    },
    
    getChangeIcon: function(changeType) {
      var iconMap = {
        'text': 'icon icon-edit',
        'image': 'icon icon-picture',
        'video': 'icon icon-film',
        'audio': 'icon icon-volume-up',
        'number': 'icon icon-calculator',
        'boolean': 'icon icon-check',
        'array': 'icon icon-list',
        'object': 'icon icon-folder'
      };
      
      return iconMap[changeType] || 'icon icon-pencil';
    },
    
    formatChange: function(change) {
      var oldVal = this.formatValue(change.oldValue, change.changeType);
      var newVal = this.formatValue(change.newValue, change.changeType);
      
      if (change.changeType === 'image' || change.changeType === 'video' || change.changeType === 'audio') {
        return '<span class="change-media">Media changed</span>';
      }
      
      if (typeof change.oldValue === 'undefined' || change.oldValue === null) {
        return '<span class="change-new">New: ' + newVal + '</span>';
      }
      
      if (typeof change.newValue === 'undefined' || change.newValue === null) {
        return '<span class="change-deleted">Deleted: ' + oldVal + '</span>';
      }
      
      return '<span class="change-from">' + oldVal + '</span> → <span class="change-to">' + newVal + '</span>';
    },
    
    formatValue: function(value, changeType) {
      if (typeof value === 'undefined' || value === null) {
        return '<em>null</em>';
      }
      
      if (typeof value === 'string' && value.length > 100) {
        return this.escapeHtml(value.substring(0, 100) + '...');
      }
      
      if (typeof value === 'object') {
        return this.escapeHtml(JSON.stringify(value).substring(0, 100));
      }
      
      return this.escapeHtml(String(value));
    },
    
    escapeHtml: function(str) {
      if (str === null || typeof str === 'undefined') {
        return '';
      }
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    
    getTimeAgo: function(date) {
      var seconds = Math.floor((new Date() - date) / 1000);
      
      var intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
      };
      
      for (var key in intervals) {
        var interval = Math.floor(seconds / intervals[key]);
        if (interval >= 1) {
          return interval + ' ' + key + (interval > 1 ? 's' : '') + ' ago';
        }
      }
      
      return 'Just now';
    },
    
    onFilterChange: function(e) {
      var $target = $(e.currentTarget);
      var filterType = $target.hasClass('audit-filter-action') ? 'action' :
                       $target.hasClass('audit-filter-user') ? 'user' :
                       $target.hasClass('audit-filter-type') ? 'type' : 'contentId';
      
      this.filters[filterType] = $target.val();
      // changing the type invalidates whichever content-id was previously selected
      if (filterType === 'type') {
        this.filters.contentId = 'all';
      }
      this.currentPage = 0;
      this.applyFilters();
      this.renderLogs();
    },
    
    onLoadMore: function() {
      this.currentPage++;
      this.renderLogs();
    },
    
    onLogItemClick: function(e) {
      var $item = $(e.currentTarget);
      $item.toggleClass('expanded');
    }
    
  }, {
    template: 'auditLog'
  });
  
  return AuditLogView;
});
