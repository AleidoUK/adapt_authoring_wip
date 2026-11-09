define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');

  function newId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function(value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  return OriginView.extend({
    className: 'light-course-comments',
    events: {
      'click .light-course-comment-reply': 'onReply',
      'click .light-course-comment-edit': 'onEdit',
      'click .light-course-comment-delete': 'onDelete',
      'click .light-course-comment-resolve': 'onResolve',
      'click .light-course-comment-toggle': 'onToggleReplies',
      'click .light-course-comments-cancel': 'onCancel',
      'click .light-course-comments-save': 'onSave',
      'input .light-course-comments-text': 'onTextChanged'
    },

    preRender: function(options) {
      this.node = options.node;
      this.readOnly = !!options.readOnly;
      this.userId = String(Origin.sessionModel.get('id'));
      this.authorName = Origin.sessionModel.get('email');
      this.composerText = '';
      this.expandedComments = new Set();
    },

    postRender: function() {
      if (!this.removed) this.renderDiscussion();
    },

    find: function(id) {
      return (this.node._comments || []).find(function(comment) { return comment._id === id && !comment.deleted; });
    },

    root: function(comment) {
      while (comment && comment.parentId) comment = this.find(comment.parentId);
      return comment;
    },

    eventComment: function(event) {
      event.preventDefault();
      return this.find($(event.currentTarget).closest('.light-course-comment').data('comment-id'));
    },

    canDelete: function(comment) {
      return comment && comment.authorId === this.userId && !(this.node._comments || []).some(function(reply) {
        return reply.parentId === comment._id && !reply.deleted;
      });
    },

    renderDiscussion: function() {
      var active = (this.node._comments || []).filter(function(comment) { return !comment.deleted; });
      var rows = [], pending = active.filter(function(comment) { return !comment.parentId; }).map(function(comment) {
        return { comment: comment, depth: 0, visible: true };
      }).reverse();
      while (pending.length) {
        var item = pending.pop(), root = this.root(item.comment), own = item.comment.authorId === this.userId && !this.readOnly;
        var children = active.filter(function(comment) { return comment.parentId === item.comment._id; });
        var expanded = this.expandedComments.has(item.comment._id);
        rows.push(Object.assign({}, item.comment, {
          indent: Math.min(item.depth, 6) * 16, isReply: !!item.comment.parentId,
          commentId: this.cid + '-comment-' + item.comment._id, toggleId: this.cid + '-toggle-' + item.comment._id,
          hidden: !item.visible, expanded: expanded, replyCount: children.length,
          replyIds: children.map(function(comment) { return this.cid + '-comment-' + comment._id; }, this).join(' '),
          canEdit: own, canDelete: own && this.canDelete(item.comment), canReply: !this.readOnly && !root.resolved,
          canResolve: !this.readOnly && !item.comment.parentId, threadResolved: root.resolved
        }));
        children.reverse().forEach(function(comment) {
          pending.push({ comment: comment, depth: item.depth + 1, visible: item.visible && expanded });
        });
      }
      var parent = this.replyTo && this.find(this.replyTo);
      this.$el.html(Handlebars.templates.lightCourseComments({
        rows: rows, readOnly: this.readOnly, editing: !!this.editingId, replying: !!parent,
        composerId: this.cid + '-comment', composerText: this.composerText, composerDisabled: !!parent && this.root(parent).resolved
      }));
    },

    onTextChanged: function() {
      this.composerText = this.$('.light-course-comments-text').val();
    },

    onToggleReplies: function(event) {
      var comment = this.eventComment(event);
      if (!comment) return;
      if (this.expandedComments.has(comment._id)) this.expandedComments.delete(comment._id);
      else this.expandedComments.add(comment._id);
      this.renderDiscussion();
      this.$('#' + this.cid + '-toggle-' + comment._id).trigger('focus');
    },

    expandReplies: function(comment) {
      while (comment) {
        this.expandedComments.add(comment._id);
        comment = comment.parentId && this.find(comment.parentId);
      }
    },

    onReply: function(event) {
      var comment = this.eventComment(event);
      if (this.readOnly || !comment || this.root(comment).resolved) return;
      this.expandReplies(comment);
      this.replyTo = comment._id;
      this.editingId = null;
      this.composerText = '';
      this.renderDiscussion();
      this.$('.light-course-comments-text').trigger('focus');
    },

    onEdit: function(event) {
      var comment = this.eventComment(event);
      if (this.readOnly || !comment || comment.authorId !== this.userId) return;
      this.editingId = comment._id;
      this.replyTo = null;
      this.composerText = comment.text;
      this.renderDiscussion();
      this.$('.light-course-comments-text').trigger('focus');
    },

    onDelete: function(event) {
      var comment = this.eventComment(event), self = this;
      if (this.readOnly || !this.canDelete(comment)) return this.notify('lightcoursecommentdeleteblocked');
      Origin.Notify.confirm({ type: 'warning', text: Origin.l10n.t('app.lightcoursecommentconfirmdelete'), callback: function(confirmed) {
        if (!confirmed || self.removed) return;
        if (!self.canDelete(comment)) return self.notify('lightcoursecommentdeleteblocked');
        comment.deleted = true;
        comment.text = '';
        comment.updatedAt = new Date().toISOString();
        if (self.editingId === comment._id || self.replyTo === comment._id) self.resetComposer();
        self.renderDiscussion();
      } });
    },

    onResolve: function(event) {
      var comment = this.eventComment(event);
      if (this.readOnly || !comment || comment.parentId) return;
      comment.resolved = !comment.resolved;
      comment.updatedAt = new Date().toISOString();
      this.renderDiscussion();
    },

    resetComposer: function() {
      this.replyTo = this.editingId = null;
      this.composerText = '';
    },

    onCancel: function(event) {
      event.preventDefault();
      this.resetComposer();
      this.renderDiscussion();
    },

    notify: function(key) {
      Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.' + key) });
    },

    onSave: function(event) {
      event.preventDefault();
      if (this.readOnly) return;
      var text = this.$('.light-course-comments-text').val().trim();
      if (!text) return this.notify('lightcoursecommentrequired');
      var now = new Date().toISOString(), existing = this.editingId && this.find(this.editingId);
      if (this.editingId) {
        if (!existing || existing.authorId !== this.userId) return this.notify('lightcoursecommentownonly');
        existing.text = text;
        existing.updatedAt = now;
      } else {
        var parent = this.replyTo && this.find(this.replyTo);
        if (this.replyTo && (!parent || this.root(parent).resolved)) return this.notify('lightcoursecommentclosed');
        if (parent) this.expandReplies(parent);
        this.node._comments = (this.node._comments || []).concat([{
          _id: newId(), parentId: this.replyTo || null, text: text,
          authorId: this.userId, authorName: this.authorName, createdAt: now, updatedAt: now, resolved: false, deleted: false
        }]);
      }
      this.resetComposer();
      this.renderDiscussion();
    },

    remove: function() {
      this.removed = true;
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, { template: 'lightCourseComments' });
});
