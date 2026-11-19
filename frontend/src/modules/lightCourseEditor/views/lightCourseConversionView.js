define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  return OriginView.extend({
    className: 'light-course-conversion',
    events: {
      'click .light-course-conversion-review': 'review',
      'click .light-course-conversion-create': 'confirmConversion'
    },
    postRender: function() {
      this.review();
      this.setViewToReady();
    },
    url: function() { return 'api/content/lightcourse/' + encodeURIComponent(this.model.id) + '/conversion'; },
    busy: function(busy) {
      this.pending = busy;
      this.$('button').prop('disabled', busy);
      this.$('.light-course-conversion-create').prop('disabled', busy || !this.plan || !this.plan.ready);
    },
    showError: function(response) {
      this.plan = null;
      this.busy(false);
      this.$('.light-course-conversion-status').text(response && response.responseJSON && response.responseJSON.message ||
        Origin.l10n.t('app.errorgeneric'));
    },
    review: function(event) {
      if (event) event.preventDefault();
      if (this.pending) return;
      var self = this;
      this.plan = null;
      this.busy(true);
      this.$('.light-course-conversion-status').text(Origin.l10n.t('app.lightcourseconversionchecking'));
      $.ajax({ url: this.url() + '/preflight', type: 'POST' }).done(function(plan) {
        if (self.disposed) return;
        if (plan.converted) return self.onConverted(plan);
        self.plan = plan;
        var $review = self.$('.light-course-conversion-results').empty();
        $review.append($('<h3></h3>').text(Origin.l10n.t('app.lightcourseconversionversion', { version: plan.versionNumber })));
        (plan.errors || []).forEach(function(error) {
          $review.append($('<p class="error"></p>').text(error.node + ' / ' + error.path + ': ' + error.message));
        });
        (plan.proposals || []).forEach(function(proposal) {
          $review.append($('<div class="light-course-conversion-proposal"></div>')
            .append($('<strong></strong>').text(proposal.node + ' / ' + proposal.path))
            .append($('<pre></pre>').text(JSON.stringify({ previous: proposal.previous, fallback: proposal.value,
              source: proposal.source }, null, 2))));
        });
        self.$('.light-course-conversion-status').text(Origin.l10n.t(plan.ready ?
          'app.lightcourseconversionready' : 'app.lightcourseconversionblocked'));
        self.busy(false);
      }).fail(function(response) { if (!self.disposed) self.showError(response); });
    },
    confirmConversion: function(event) {
      event.preventDefault();
      if (this.pending || !this.plan || !this.plan.ready) return;
      var self = this;
      Origin.Notify.confirm({
        type: 'warning',
        title: Origin.l10n.t('app.lightcourseconvert'),
        text: Origin.l10n.t('app.lightcourseconversionconfirm'),
        destructive: true,
        callback: function(confirmed) {
          if (!confirmed || self.disposed || self.pending || !self.plan) return;
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
      Origin.trigger('modal:close');
      Origin.router.navigateTo('editor/' + result.courseId + '/menu');
    },
    remove: function() {
      this.disposed = true;
      return OriginView.prototype.remove.apply(this, arguments);
    }
  }, { template: 'lightCourseConversion' });
});
