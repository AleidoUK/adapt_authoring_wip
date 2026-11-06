// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var AuditLogView = require('../auditLog/views/auditLogView');

  var ItemHistoryView = AuditLogView.extend({
    getData: function() {
      return {};
    }
  });

  return function(contentType) {
    return function(event) {
      event && event.preventDefault();
      Origin.trigger('modal:open', ItemHistoryView, {
        title: Origin.l10n.t('app.editorauditlog') + (this.model.get('name') || this.model.get('title')
          ? ' - ' + (this.model.get('name') || this.model.get('title')) : ''),
        contentType: contentType,
        contentId: this.model.get('_id'),
        _shouldShowDoneButton: false
      });
    };
  };
});
