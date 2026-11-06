define(function(require) {
  var Origin = require('core/origin');

  return function(model, options) {
    var request = new XMLHttpRequest();
    var aborted = false;
    function disposed() { return aborted || options.isDisposed(); }
    function fail(response) {
      if (!disposed()) options.error(response || { responseJSON: { message: Origin.l10n.t('app.errorgeneric') } });
    }
    request.open('GET', 'document-export/' + encodeURIComponent(Origin.sessionModel.get('tenantId')) +
      '/' + encodeURIComponent(model.get('_id')) + '?format=docx');
    request.responseType = 'blob';
    request.onabort = function() { aborted = true; };
    request.onload = function() {
      if (disposed()) return;
      if (request.status < 200 || request.status >= 300) {
        var reader = new FileReader();
        reader.onload = function() {
          if (disposed()) return;
          var data;
          try { data = JSON.parse(reader.result); }
          catch (error) { return fail(); }
          fail({ responseJSON: data });
        };
        reader.onerror = function() { fail(); };
        reader.readAsText(request.response);
        return;
      }
      var disposition = request.getResponseHeader('Content-Disposition') || '';
      var encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      var name = /filename="([^"]+)"/i.exec(disposition);
      var filename;
      if (encodedName) {
        try { filename = decodeURIComponent(encodedName[1]); }
        catch (error) { return fail(); }
      } else {
        var tags = (model.get('tags') || []).map(function(tag) {
          return tag && typeof tag.title === 'string' ? tag.title.trim() : '';
        }).filter(Boolean);
        filename = name ? name[1] :
          tags.concat(model.get('title') || 'light-course').join('_').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-').trim() +
            '_v' + (model.get('versionNumber') || model.get('currentVersionNumber') || 'draft') + '.docx';
      }
      var url = URL.createObjectURL(request.response);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      options.success();
    };
    request.onerror = function() { fail(); };
    request.send();
    return request;
  };
});
