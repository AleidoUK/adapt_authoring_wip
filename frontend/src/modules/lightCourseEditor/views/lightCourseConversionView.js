define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  function fieldLabel(path) {
    return String(path || '').replace(/\[(\d+)\]/g, function(match, index) {
      return '.Item ' + (Number(index) + 1);
    }).split(/[./]/).filter(Boolean).map(function(part) {
      return part.replace(/^_+/, '').replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, function(letter) { return letter.toUpperCase(); });
    }).filter(Boolean).join(' / ');
  }

  function csvCell(value) {
    var text = value === undefined || value === null ? '' : String(value);
    if (/^[\t\r\n]/.test(text) || /^[\s\x00-\x1f]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  return OriginView.extend({
    className: 'light-course-conversion',
    events: {
      'click .light-course-conversion-review': 'review',
      'click .light-course-conversion-create': 'confirmConversion',
      'click .light-course-conversion-export': 'exportIssues'
    },
    postRender: function() {
      this.review();
      this.setViewToReady();
    },
    getData: function() { return {}; },
    url: function() { return 'api/content/lightcourse/' + encodeURIComponent(this.model.id) + '/conversion'; },
    busy: function(busy) {
      this.pending = busy;
      this.$('button').prop('disabled', busy);
      this.$('.light-course-conversion-create').prop('disabled', busy || !this.plan || !this.plan.ready);
    },
    showError: function(response) {
      var self = this, wasConverting = this.converting;
      var message = response && response.responseJSON && response.responseJSON.message ||
        Origin.l10n.t('app.errorgeneric');
      this.plan = null;
      this.$('.light-course-conversion-results').empty();
      if (this.converting) {
        this.converting = false;
        Origin.trigger('modal:enableCancelButton');
      }
      this.busy(false);
      this.$('.light-course-conversion-status').text(message);
      function alert() {
        if (self.disposed || self.pending || self.plan) return;
        Origin.Notify.alert({ type: 'error', text: message, html: false });
      }
      if (wasConverting) setTimeout(alert, 100);
      else alert();
    },
    review: function(event) {
      if (event) event.preventDefault();
      if (this.pending) return;
      var self = this;
      this.plan = null;
      this.busy(true);
      this.$('.light-course-conversion-results').empty();
      this.$('.light-course-conversion-status').text(Origin.l10n.t('app.lightcourseconversionchecking'));
      $.ajax({ url: this.url() + '/preflight', type: 'POST' }).done(function(plan) {
        if (self.disposed) return;
        if (plan.converted) return self.onConverted(plan);
        self.plan = plan;
        var $review = self.$('.light-course-conversion-results').empty();
        $review.append($('<h3></h3>').text(Origin.l10n.t('app.lightcourseconversionversion', { version: plan.versionNumber })));
        self.renderResults($review, plan);
        self.$('.light-course-conversion-status').text(Origin.l10n.t(plan.ready ?
          'app.lightcourseconversionready' : 'app.lightcourseconversionblocked'));
        self.busy(false);
      }).fail(function(response) { if (!self.disposed) self.showError(response); });
    },
    locationLabel: function(node, locations) {
      if (node === 'course' || node === 'config') return Origin.l10n.t('app.lightcourseconversion' + node);
      var path = locations && locations[node];
      if (!path || !path.length) return Origin.l10n.t('app.lightcourseconversionitem') + ' (' + node + ')';
      return path.map(function(part) {
        var type = ['page', 'article', 'block', 'component'].indexOf(part.type) !== -1 ? part.type : 'item';
        var label = Origin.l10n.t('app.lightcourseconversion' + type);
        if (part.component) label += ' (' + part.component + ')';
        return label + (part.title ? ': ' + part.title : '');
      }).join(' / ');
    },
    appendValue: function($container, value) {
      if (value === undefined || value === null || value === '') {
        return $container.text(Origin.l10n.t('app.lightcourseconversionnotset'));
      }
      if (typeof value === 'boolean') {
        return $container.text(Origin.l10n.t(value ? 'app.lightcourseconversionyes' : 'app.lightcourseconversionno'));
      }
      if (typeof value !== 'object') return $container.text(String(value));
      var keys = Object.keys(value);
      if (!keys.length) return $container.text(Array.isArray(value) ? '[]' : '{}');
      var self = this, $list = $('<ul class="light-course-conversion-values"></ul>');
      keys.forEach(function(key) {
        var $item = $('<li></li>');
        $item.append($('<strong></strong>').text(Array.isArray(value) ?
          Origin.l10n.t('app.lightcourseconversionitem') + ' ' + (Number(key) + 1) : fieldLabel(key)));
        var $value = $('<div></div>');
        self.appendValue($value, value[key]);
        $item.append($value);
        $list.append($item);
      });
      return $container.append($list);
    },
    renderResults: function($review, plan) {
      var self = this, errors = plan.errors || [], proposals = plan.proposals || [];
      function heading(entry) {
        var location = self.locationLabel(entry.node, plan.locations);
        return location + (entry.path ? ' - ' + fieldLabel(entry.path) : '');
      }
      function technical(entry) {
        return $('<details class="light-course-conversion-technical"></details>')
          .append($('<summary></summary>').text(Origin.l10n.t('app.lightcourseconversiontechnical')))
          .append($('<p></p>').text(String(entry.node || '') + (entry.path ? ' / ' + entry.path : '')));
      }
      if (errors.length) {
        var $issues = $('<section class="light-course-conversion-issues"></section>')
          .append($('<h3></h3>').text(Origin.l10n.t('app.lightcourseconversionissues', { count: errors.length })))
          .append($('<button type="button" class="btn secondary light-course-conversion-export" disabled></button>')
            .text(Origin.l10n.t('app.lightcourseconversionexportissues')));
        errors.forEach(function(error) {
          $issues.append($('<div class="light-course-conversion-issue"></div>')
            .append($('<strong></strong>').text(heading(error)))
            .append($('<p></p>').text(error.message))
            .append(technical(error)));
        });
        $review.append($issues);
      }
      if (!proposals.length) return $review.append($('<p></p>').text(Origin.l10n.t('app.lightcourseconversionnodefaults')));
      var $defaults = $('<details class="light-course-conversion-defaults-review"></details>')
        .append($('<summary></summary>').text(Origin.l10n.t('app.lightcourseconversiondefaultsreview', { count: proposals.length })));
      proposals.forEach(function(proposal) {
        var $proposal = $('<div class="light-course-conversion-proposal"></div>')
          .append($('<strong></strong>').text(heading(proposal)));
        [['previous', 'previous'], ['fallback', 'value'], ['source', 'source'], ['reason', 'reason']].forEach(function(pair) {
          if (pair[0] === 'reason' && !proposal.reason) return;
          var $value = $('<div></div>');
          var value = proposal[pair[1]];
          if (pair[0] === 'source') {
            var sourceKeys = { 'Installed schema': 'schema', 'Conversion Defaults': 'configured',
              'Conversion Defaults / installed schema': 'fallback' };
            if (sourceKeys[value]) value = Origin.l10n.t('app.lightcourseconversionsource' + sourceKeys[value]);
          }
          self.appendValue($value, value);
          $proposal.append($('<div class="light-course-conversion-value"></div>')
            .append($('<strong></strong>').text(Origin.l10n.t('app.lightcourseconversion' + pair[0]) + ': '))
            .append($value));
        });
        $defaults.append($proposal.append(technical(proposal)));
      });
      $review.append($defaults);
    },
    exportIssues: function(event) {
      event.preventDefault();
      if (this.disposed || this.pending || !this.plan || !this.plan.errors || !this.plan.errors.length) return;
      var self = this, plan = this.plan;
      var rows = [[
        Origin.l10n.t('app.lightcourseconversioncsvversion'),
        Origin.l10n.t('app.lightcourseconversioncsvlocation'),
        Origin.l10n.t('app.lightcourseconversioncsvfield'),
        Origin.l10n.t('app.lightcourseconversioncsvissue'),
        Origin.l10n.t('app.lightcourseconversioncsvnode'),
        Origin.l10n.t('app.lightcourseconversioncsvpath')
      ]];
      plan.errors.forEach(function(error) {
        rows.push([plan.versionNumber, self.locationLabel(error.node, plan.locations), fieldLabel(error.path),
          error.message, error.node, error.path]);
      });
      var csv = '\ufeff' + rows.map(function(row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
      var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      var link = document.createElement('a');
      link.href = url;
      link.download = 'light-course-conversion-issues-v' +
        String(plan.versionNumber || 'unknown').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-') + '.csv';
      try {
        document.body.appendChild(link);
        link.click();
      } finally {
        if (link.parentNode) link.parentNode.removeChild(link);
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      }
    },
    confirmConversion: function(event) {
      event.preventDefault();
      if (this.pending || !this.plan || !this.plan.ready) return;
      var self = this, reviewedHash = this.plan.hash;
      Origin.Notify.confirm({
        type: 'warning',
        title: Origin.l10n.t('app.lightcourseconvert'),
        text: Origin.l10n.t('app.lightcourseconversionconfirm'),
        destructive: true,
        callback: function(confirmed) {
          if (!confirmed || self.disposed || self.pending || !self.plan || self.plan.hash !== reviewedHash) return;
          self.converting = true;
          Origin.trigger('modal:disableCancelButton');
          self.busy(true);
          $.ajax({ url: self.url(), type: 'POST', contentType: 'application/json',
            data: JSON.stringify({ hash: self.plan.hash, approved: true })
          }).done(function(result) {
            if (!self.disposed) self.onConverted(result);
          }).fail(function(response) { if (!self.disposed) self.showError(response); });
        }
      });
    },
    onConverted: function(result) {
      this.model.set({ conversionStatus: 'converted', _convertedCourseId: result.courseId });
      Origin.trigger('modal:onCancel');
      Origin.router.navigateTo('editor/' + result.courseId + '/menu');
    },
    remove: function() {
      this.disposed = true;
      return OriginView.prototype.remove.apply(this, arguments);
    }
  }, { template: 'lightCourseConversion' });
});
