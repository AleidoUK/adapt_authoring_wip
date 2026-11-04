// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseComponentFormView = require('./lightCourseComponentFormView');

  var HIERARCHY = { page: 'article', article: 'block', block: 'component' };
  var MAX_COMPONENTS_PER_BLOCK = 2;

  function generateStableId() {
    // Matches the shape (not the algorithm) of lib/lightcourse's server-side stable IDs - the
    // server re-mints its own IDs on save for anything missing one, so a collision-resistant
    // client-side placeholder is enough here.
    return 'node-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 10);
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
      'click .light-course-tree-component-editor-close': 'onCloseEditorClicked'
    },

    preRender: function() {
      this.tree = JSON.parse(JSON.stringify(this.model.get('contentTree') || {}));
      if (!Array.isArray(this.tree.children)) {
        this.tree.children = [];
      }
      this.openComponentNodeId = null;
    },

    postRender: function() {
      this.renderTree();
      this.setViewToReady();
    },

    renderTree: function() {
      var html = Handlebars.templates['lightCourseTreeRootNodes']({ children: this.tree.children });
      this.$('.light-course-tree-root').html(html);
    },

    /**
     * Returns the current contentTree, flushing any currently-open component form's values back
     * into the corresponding node first. Called by the editor shell when assembling a save.
     */
    getContentTree: function() {
      this.flushOpenComponentForm();
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
      this.tree.children.push(emptyNodeData('page'));
      this.renderTree();
    },

    onAddChildClicked: function(event) {
      event && event.preventDefault();
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
    },

    onRemoveClicked: function(event) {
      event && event.preventDefault();
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
          }
        }
      });
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
    },

    onEditClicked: function(event) {
      event && event.preventDefault();
      var nodeId = this.getNodeIdFromEvent(event);
      this.openComponentEditor(nodeId);
    },

    openComponentEditor: function(nodeId) {
      this.flushOpenComponentForm();
      var found = this.findNode(nodeId);
      if (!found) {
        return;
      }
      this.openComponentNodeId = nodeId;

      var $editor = this.$('.light-course-tree-component-editor');
      $editor.removeClass('display-none');

      this.renderComponentPicker(found.node);
      this.renderComponentForm(found.node);
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
        node._component = $select.val();
        this.renderComponentForm(node);
      }, this));
      $picker.append($label).append($select);
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
        includeAudio: (this.model.get('pluginSelections') && this.model.get('pluginSelections').extensions || []).indexOf('audio') !== -1
      });
      $formContainer.empty().append(this.componentFormView.$el);
    },

    flushOpenComponentForm: function() {
      if (!this.openComponentNodeId || !this.componentFormView) {
        return;
      }
      var found = this.findNode(this.openComponentNodeId);
      if (found) {
        var formData = this.componentFormView.getFormData();
        Object.assign(found.node, formData);
      }
    },

    onCloseEditorClicked: function(event) {
      event && event.preventDefault();
      this.closeComponentEditor();
    },

    closeComponentEditor: function() {
      this.flushOpenComponentForm();
      this.openComponentNodeId = null;
      if (this.componentFormView) {
        this.componentFormView.remove();
        this.componentFormView = null;
      }
      this.$('.light-course-tree-component-editor').addClass('display-none');
      this.renderTree();
    },

    setComponentTypes: function(componentTypes) {
      this.componentTypes = componentTypes;
    },

    remove: function() {
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
