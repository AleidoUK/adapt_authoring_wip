// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseComponentFormView = require('./lightCourseComponentFormView');
  var WordCount = require('../wordCount');
  var FieldPreview = require('../fieldPreview');

  var HIERARCHY = { page: 'article', article: 'block', block: 'component' };
  var MAX_COMPONENTS_PER_BLOCK = 2;

  function generateStableId() {
    // Matches the shape (not the algorithm) of lib/lightcourse's server-side stable IDs - the
    // server re-mints its own IDs on save for anything missing one, so a collision-resistant
    // client-side placeholder is enough here.
    return 'node-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 10);
  }

  function regenerateNodeIds(node) {
    node._id = generateStableId();
    (node.children || []).forEach(regenerateNodeIds);
    return node;
  }

  function emptyNodeData(type) {
    var base = { _id: generateStableId(), type: type, children: [] };
    if (type === 'component') {
      delete base.children;
      base._component = '';
      base.title = '';
      base.items = [];
      base.graphicsNotes = '';
      base.developerNotes = '';
    }
    return base;
  }

  /**
   * Content tree view (Phase 3's "Editor shell and tree" section). Manages the contentTree as a
   * single in-memory JS object (this.tree), splicing arrays locally and leaving persistence to
   * the editor shell's explicit "Save Draft" action - the Phase 3 doc's recommended, simpler
   * alternative to the full editor's per-node PATCH/jQuery-UI-draggable approach, since the whole
   * tree is one JSON document on the lightcourse model rather than one Mongo document per node.
   */
  var LightCourseTreeView = OriginView.extend({
    className: 'light-course-tree',

    events: {
      'click .light-course-tree-add-page': 'onAddPageClicked',
      'click .light-course-tree-add': 'onAddChildClicked',
      'click .light-course-tree-remove': 'onRemoveClicked',
      'click .light-course-tree-move-up': 'onMoveUpClicked',
      'click .light-course-tree-move-down': 'onMoveDownClicked',
      'click .light-course-tree-edit': 'onEditClicked',
      'click .light-course-tree-copy': 'onCopyClicked',
      'click .light-course-tree-paste': 'onPasteClicked',
      'click .light-course-tree-paste-page': 'onPastePageClicked',
      'click .light-course-tree-cancel-copy': 'onCancelCopyClicked',
      'change .light-course-tree-page-title-input': 'onPageTitleChanged',
      'click .light-course-tree-component-editor-close': 'onCloseEditorClicked',
      'click .light-course-tree-component-editor-cancel': 'onCancelEditorClicked',
      'keydown .light-course-tree-component-editor': 'onEditorKeydown'
    },

    preRender: function() {
      this.tree = JSON.parse(JSON.stringify(this.model.get('contentTree') || {}));
      if (!Array.isArray(this.tree.children)) {
        this.tree.children = [];
      }
      this.openComponentNodeId = null;
      this.openComponentDraft = null;
      this.clipboardNode = null;
    },

    postRender: function() {
      this.renderTree();
      this.clipboardEventNamespace = '.lightCourseClipboard' + this.cid;
      $(document).off(this.clipboardEventNamespace).on(
        'click' + this.clipboardEventNamespace + ' change' + this.clipboardEventNamespace,
        _.bind(this.onOtherActionSelected, this));
      this.setViewToReady();
    },

    renderTree: function() {
      var html = Handlebars.templates['lightCourseTreeRootNodes']({
        children: this.tree.children,
        clipboardType: this.clipboardNode && this.clipboardNode.type,
        // Per-node computed display data (component type display name, body HTML, live word
        // count) - looked up via `{{lookup @root.nodeMeta _id}}` in part_lightCourseTreeNode.hbs.
        // Computed here rather than inline in the template since it needs this.componentTypes
        // and WordCount's schema-driven walk, neither of which Handlebars can reach directly.
        nodeMeta: this.buildNodeMeta(this.tree.children)
      });
      this.$('.light-course-tree-root').html(html);
      this.$('.light-course-tree-copy-status').toggleClass('display-none', !this.clipboardNode);
      this.$('.light-course-tree-copy-status-label').text(this.clipboardNode ?
        Origin.l10n.t('app.lightcourse' + this.clipboardNode.type + 'copied') : '');
    },

    /**
     * Flat map of nodeId -> display metadata and populated fields for every node in the tree,
     * built fresh on every render so it always reflects the live in-memory tree
     * (including a component whose form was just edited but not yet saved).
     */
    buildNodeMeta: function(nodes, out) {
      out = out || {};
      (nodes || []).forEach(function(node) {
        if (!node) {
          return;
        }
        var componentType = _.findWhere(this.componentTypes || [], { component: node._component });
        out[node._id] = {
          componentTypeDisplayName: (componentType && componentType.displayName) || node._component || '',
          wordCount: node.type === 'component' ? WordCount.countComponentWords(node) : 0,
          fields: FieldPreview(node)
        };
        this.buildNodeMeta(node.children, out);
      }, this);
      return out;
    },

    /**
     * Returns the committed contentTree. Open component edits stay in a separate draft until Save.
     */
    getContentTree: function() {
      return this.tree;
    },

    findNode: function(nodeId, nodes, parent) {
      nodes = nodes || this.tree.children;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i]._id === nodeId) {
          return { node: nodes[i], siblings: nodes, index: i };
        }
        if (nodes[i].children) {
          var found = this.findNode(nodeId, nodes[i].children, nodes[i]);
          if (found) {
            return found;
          }
        }
      }
      return null;
    },

    getNodeIdFromEvent: function(event) {
      return $(event.currentTarget).closest('.light-course-tree-node').data('node-id');
    },

    onAddPageClicked: function(event) {
      event && event.preventDefault();
      this.clearClipboard();
      var page = emptyNodeData('page');
      var article = emptyNodeData('article');
      article.children.push(emptyNodeData('block'));
      page.children.push(article);
      this.tree.children.push(page);
      this.renderTree();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onPageTitleChanged: function(event) {
      var $input = $(event.currentTarget);
      var found = this.findNode(this.getNodeIdFromEvent(event));
      if (!found || found.node.type !== 'page') {
        return;
      }
      this.clearClipboard();
      var title = $input.val().trim();
      $input.val(title);
      $input.closest('.light-course-tree-node').find('.light-course-tree-page-heading')
        .text(title || Origin.l10n.t('app.lightcoursepage'));
      if ((found.node.title || '') === title) {
        return;
      }
      found.node.title = title;
      Origin.trigger('lightCourseEditor:autosave');
    },

    onAddChildClicked: function(event) {
      event && event.preventDefault();
      this.clearClipboard();
      var nodeId = this.getNodeIdFromEvent(event);
      var found = this.findNode(nodeId);
      if (!found) {
        return;
      }
      var childType = HIERARCHY[found.node.type];
      if (found.node.type === 'block' && found.node.children.length >= MAX_COMPONENTS_PER_BLOCK) {
        return Origin.Notify.alert({ type: 'warning', text: Origin.l10n.t('app.lightcoursemaxcomponents') });
      }
      found.node.children.push(emptyNodeData(childType));
      this.renderTree();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onRemoveClicked: function(event) {
      event && event.preventDefault();
      this.clearClipboard();
      var nodeId = this.getNodeIdFromEvent(event);
      var self = this;
      Origin.Notify.confirm({
        type: 'warning',
        text: Origin.l10n.t('app.lightcourseconfirmremovenode'),
        callback: function(confirmed) {
          if (!confirmed) {
            return;
          }
          if (self.openComponentNodeId === nodeId) {
            self.closeComponentEditor();
          }
          var found = self.findNode(nodeId);
          if (found) {
            found.siblings.splice(found.index, 1);
            self.renderTree();
            Origin.trigger('lightCourseEditor:autosave');
          }
        }
      });
    },

    onCopyClicked: function(event) {
      event && event.preventDefault();
      var found = this.findNode(this.getNodeIdFromEvent(event));
      if (!found || ['page', 'block', 'component'].indexOf(found.node.type) === -1) {
        return;
      }
      this.clipboardNode = JSON.parse(JSON.stringify(found.node));
      this.renderTree();
    },

    onPasteClicked: function(event) {
      event && event.preventDefault();
      var found = this.findNode(this.getNodeIdFromEvent(event));
      if (!found || !this.clipboardNode || HIERARCHY[found.node.type] !== this.clipboardNode.type) {
        return;
      }
      if (found.node.type === 'block' && found.node.children.length >= MAX_COMPONENTS_PER_BLOCK) {
        return Origin.Notify.alert({ type: 'warning', text: Origin.l10n.t('app.lightcoursemaxcomponents') });
      }
      this.pasteClipboardAt(found.node.children, found.node.children.length);
    },

    onPastePageClicked: function(event) {
      event && event.preventDefault();
      if (!this.clipboardNode || this.clipboardNode.type !== 'page') {
        return;
      }
      var afterNodeId = $(event.currentTarget).attr('data-after-node-id');
      var index = 0;
      if (afterNodeId) {
        var anchor = this.findNode(afterNodeId);
        if (!anchor || anchor.siblings !== this.tree.children) {
          return;
        }
        index = anchor.index + 1;
      }
      this.pasteClipboardAt(this.tree.children, index);
    },

    pasteClipboardAt: function(nodes, index) {
      var pasted = regenerateNodeIds(JSON.parse(JSON.stringify(this.clipboardNode)));
      nodes.splice(index, 0, pasted);
      this.clipboardNode = null;
      this.renderTree();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onCancelCopyClicked: function(event) {
      event && event.preventDefault();
      this.clearClipboard();
    },

    clearClipboard: function() {
      if (!this.clipboardNode) {
        return;
      }
      this.clipboardNode = null;
      this.$('.light-course-tree-paste').remove();
      this.$('.light-course-tree-page-paste-zone').remove();
      this.$('.light-course-tree-copy-status').toggleClass('display-none', true);
      this.$('.light-course-tree-copy-status-label').text('');
    },

    onOtherActionSelected: function(event) {
      if (!this.clipboardNode ||
          !$(event.target).closest('button, a, input, select, textarea, summary, [role="button"]').length ||
          $(event.target).closest('.light-course-tree-copy, .light-course-tree-paste, .light-course-tree-paste-page, .light-course-tree-cancel-copy').length) {
        return;
      }
      this.clearClipboard();
    },

    onMoveUpClicked: function(event) {
      event && event.preventDefault();
      this.moveNode(this.getNodeIdFromEvent(event), -1);
    },

    onMoveDownClicked: function(event) {
      event && event.preventDefault();
      this.moveNode(this.getNodeIdFromEvent(event), 1);
    },

    moveNode: function(nodeId, direction) {
      this.clearClipboard();
      var found = this.findNode(nodeId);
      if (!found) {
        return;
      }
      var newIndex = found.index + direction;
      if (newIndex < 0 || newIndex >= found.siblings.length) {
        return;
      }
      found.siblings.splice(found.index, 1);
      found.siblings.splice(newIndex, 0, found.node);
      this.renderTree();
      Origin.trigger('lightCourseEditor:autosave');
    },

    onEditClicked: function(event) {
      event && event.preventDefault();
      var nodeId = this.getNodeIdFromEvent(event);
      this.openComponentEditor(nodeId);
    },

    openComponentEditor: function(nodeId) {
      this.clearClipboard();
      var found = this.findNode(nodeId);
      if (!found) {
        return;
      }
      if (this.openComponentNodeId) {
        this.closeComponentEditor();
        found = this.findNode(nodeId);
      }
      this.openComponentNodeId = nodeId;
      this.openComponentDraft = JSON.parse(JSON.stringify(found.node));

      var $editor = this.$('.light-course-tree-component-editor');
      $editor.removeClass('display-none');

      this.renderComponentPicker(this.openComponentDraft);
      this.renderComponentForm(this.openComponentDraft);
      // Restore the saved selection without reapplying values over the author's edits.
      this.renderPresetPicker(this.openComponentDraft, false);
      $editor.trigger('focus');
    },

    onEditorKeydown: function(event) {
      if (event.key !== 'Tab' || $(event.target).closest('.scaffold-items-modal').length) {
        return;
      }
      var $editor = this.$('.light-course-tree-component-editor');
      var $focusable = $editor.find('button, input, select, textarea, a[href], [tabindex]')
        .filter(':visible:not(:disabled)').filter(function() { return this.tabIndex >= 0; });
      var first = $focusable[0];
      var last = $focusable[$focusable.length - 1];
      if (!first) {
        event.preventDefault();
        $editor.trigger('focus');
      } else if (event.shiftKey && (event.target === first || event.target === $editor[0])) {
        event.preventDefault();
        $(last).trigger('focus');
      } else if (!event.shiftKey && (event.target === last || event.target === $editor[0])) {
        event.preventDefault();
        $(first).trigger('focus');
      }
    },

    renderComponentPicker: function(node) {
      var $picker = this.$('.light-course-tree-component-editor-component-picker');
      $picker.empty();
      var $label = $('<label>').text(Origin.l10n.t('app.lightcoursecomponenttype'));
      var $select = $('<select class="light-course-tree-component-type-select"></select>');
      $select.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursecomponenttypeselect')));
      (this.componentTypes || []).forEach(function(componentType) {
        var option = $('<option></option>').attr('value', componentType.component).text(componentType.displayName || componentType.component);
        if (componentType.component === node._component) {
          option.attr('selected', 'selected');
        }
        $select.append(option);
      });
      $select.on('change', _.bind(function() {
        // "brand new" only ever means "this node has never had a _component before" - once a
        // type's been chosen once, later changing the type again (on the same node, in this or
        // a future editing session) no longer auto-applies a default preset, per the product
        // requirement that re-applying a preset is always an explicit, deliberate action.
        var isFirstTimeChoice = !node._component;
        delete node._componentPresetId;
        node._component = $select.val();
        this.renderComponentForm(node);
        this.renderPresetPicker(node, isFirstTimeChoice);
      }, this));
      $picker.append($label).append($select);
    },

    /**
     * Component Defaults preset picker (see plugins/content/lightcomponentdefault/) - fetches
     * every preset for the node's current componentType and renders a small adjacent dropdown.
     * Selecting a preset (including the server-flagged default, auto-selected only the very
     * first time a type is chosen for a brand new node) immediately applies its stored values
     * onto the node and re-renders the component form - a deliberate, explicit, overwrite-
     * current-values action every time, not something that re-runs silently on every keystroke.
     */
    renderPresetPicker: function(node, applyDefaultIfAvailable) {
      var $presetPicker = this.$('.light-course-tree-component-editor-preset-picker');
      $presetPicker.empty();
      var componentType = node._component;
      if (!componentType) {
        return;
      }
      var self = this;
      var requestId = this.presetRequestId = (this.presetRequestId || 0) + 1;
      $.get('api/content/lightcomponentdefault', { componentType: componentType }).done(function(presets) {
        if (self.presetRequestId === requestId && self.openComponentNodeId === node._id && node._component === componentType) {
          self.renderPresetSelect(node, presets || [], applyDefaultIfAvailable);
        }
      }).fail(function() {
        if (self.presetRequestId === requestId && self.openComponentNodeId === node._id && node._component === componentType) {
          Origin.Notify.alert({ type: 'error', text: Origin.l10n.t('app.errorgettinglightcoursecomponentpresets') });
        }
      });
    },

    renderPresetSelect: function(node, presets, applyDefaultIfAvailable) {
      var $presetPicker = this.$('.light-course-tree-component-editor-preset-picker');
      $presetPicker.empty();
      if (!presets.length && !node._componentPresetId) {
        return;
      }
      var $label = $('<label>').text(Origin.l10n.t('app.lightcoursecomponentpreset'));
      var $select = $('<select class="light-course-tree-component-preset-select"></select>');
      $select.append($('<option></option>').attr('value', '').text(Origin.l10n.t('app.lightcoursecomponentpresetnone')));
      var defaultPreset = null;
      presets.slice().sort(function(a, b) {
        return (a.name || '').localeCompare(b.name || '');
      }).forEach(function(preset) {
        $select.append($('<option></option>').attr('value', preset._id).text(preset.name));
        if (preset.isDefault) {
          defaultPreset = preset;
        }
      });
      if (node._componentPresetId) {
        if (!_.findWhere(presets, { _id: node._componentPresetId })) {
          $select.append($('<option></option>').attr('value', node._componentPresetId)
            .text(Origin.l10n.t('app.lightcoursecomponentpresetunavailable')).prop('disabled', true));
        }
        $select.val(node._componentPresetId);
      }
      $select.on('change', _.bind(function() {
        var preset = _.findWhere(presets, { _id: $select.val() });
        if (preset) {
          this.applyPresetValues(node, preset);
        } else if (!$select.val()) {
          delete node._componentPresetId;
        }
      }, this));
      $presetPicker.append($label).append($select);

      if (applyDefaultIfAvailable && defaultPreset) {
        $select.val(defaultPreset._id);
        this.applyPresetValues(node, defaultPreset);
      }
    },

    applyPresetValues: function(node, preset) {
      var values = _.omit(preset.values || {}, '_id', 'type', 'children', '_component', '_componentPresetId');
      Object.assign(node, JSON.parse(JSON.stringify(values)));
      node._componentPresetId = preset._id;
      this.renderComponentForm(node);
    },

    renderComponentForm: function(node) {
      var $formContainer = this.$('.light-course-tree-component-editor-form');
      if (this.componentFormView) {
        this.componentFormView.remove();
        this.componentFormView = null;
      }
      if (!node._component) {
        $formContainer.empty();
        return;
      }
      var formModel = new Backbone.Model(node);
      this.componentFormView = new LightCourseComponentFormView({
        model: formModel,
        lightCourseId: this.model.get('_id'),
        includeAudio: (this.model.get('pluginSelections') && this.model.get('pluginSelections').extensions || []).indexOf('audio') !== -1,
        lightCourseRefs: this.buildLightCourseRefs()
      });
      $formContainer.empty().append(this.componentFormView.$el);
    },

    /**
     * Data for the component field editor's "insert glossary/resource reference" CKEditor button
     * (lightCourseRefPlugin.js) - glossary/resource items are only ever offered when their
     * owning extension is actually selected for this course (per the main plan's "if extensions
     * enabled" requirement), same isExtensionSelected() gate lightCourseHeaderView.js's own
     * Menu/Reflection/Help icon pickers use.
     */
    buildLightCourseRefs: function() {
      var extensions = (this.model.get('pluginSelections') && this.model.get('pluginSelections').extensions) || [];
      return {
        glossaryEnabled: extensions.indexOf('glossary') !== -1,
        glossaryItems: this.model.get('glossaryItems') || [],
        resourceEnabled: extensions.indexOf('resources') !== -1,
        resourceItems: this.model.get('resourceItems') || []
      };
    },

    flushOpenComponentForm: function() {
      if (!this.openComponentDraft || !this.componentFormView) {
        return;
      }
      Object.assign(this.openComponentDraft, this.componentFormView.getFormData());
    },

    onCloseEditorClicked: function(event) {
      event && event.preventDefault();
      this.closeComponentEditor();
    },

    onCancelEditorClicked: function(event) {
      event && event.preventDefault();
      this.closeComponentEditor(false);
    },

    closeComponentEditor: function(saveChanges) {
      var nodeId = this.openComponentNodeId;
      var found = nodeId && this.findNode(nodeId);
      var shouldSave = saveChanges !== false && !!found && !!this.openComponentDraft;
      if (shouldSave) {
        this.flushOpenComponentForm();
        found.siblings[found.index] = this.openComponentDraft;
      }
      this.presetRequestId = (this.presetRequestId || 0) + 1;
      this.openComponentNodeId = null;
      this.openComponentDraft = null;
      if (this.componentFormView) {
        this.componentFormView.remove();
        this.componentFormView = null;
      }
      this.$('.light-course-tree-component-editor').addClass('display-none');
      this.renderTree();
      this.$('.light-course-tree-edit').filter(function() {
        return $(this).closest('.light-course-tree-node').data('node-id') === nodeId;
      }).first().trigger('focus');
      if (shouldSave) {
        Origin.trigger('lightCourseEditor:autosave');
      }
    },

    setComponentTypes: function(componentTypes) {
      this.componentTypes = (componentTypes || []).slice().sort(function(a, b) {
        return (a.displayName || a.component).localeCompare(b.displayName || b.component);
      });
      // componentTypes loads asynchronously (api/componenttype), after the tree's own first
      // render - without this, every component's tree-label displayName lookup (buildNodeMeta)
      // silently fell back to the raw, un-pretty `_component` value (e.g. "splash" instead of
      // "Splash") until some unrelated tree mutation happened to trigger a re-render, confirmed
      // live.
      this.renderTree();
    },

    remove: function() {
      if (this.clipboardEventNamespace) {
        $(document).off(this.clipboardEventNamespace);
      }
      this.presetRequestId = (this.presetRequestId || 0) + 1;
      if (this.componentFormView) {
        this.componentFormView.remove();
      }
      OriginView.prototype.remove.apply(this, arguments);
    }
  }, {
    template: 'lightCourseTree'
  });

  return LightCourseTreeView;
});
