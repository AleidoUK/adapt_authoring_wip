// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var LightCourseComponentFormView = require('./lightCourseComponentFormView');
  var WordCount = require('../wordCount');

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
      var extensions = (this.model.get('pluginSelections') && this.model.get('pluginSelections').extensions) || [];
      var html = Handlebars.templates['lightCourseTreeRootNodes']({
        children: this.tree.children,
        // Shown next to a component's title in its tree label (part_lightCourseTreeNode.hbs, via
        // @root) only when the course actually has the Unique ID extension selected - per direct
        // user request, matching the same isExtensionSelected() gate every other extension-
        // dependent bit of UI already uses elsewhere in this editor.
        uniqueIdEnabled: extensions.indexOf('uniqueId') !== -1,
        // Per-node computed display data (component type display name, body HTML, live word
        // count) - looked up via `{{lookup @root.nodeMeta _id}}` in part_lightCourseTreeNode.hbs.
        // Computed here rather than inline in the template since it needs this.componentTypes
        // and WordCount's schema-driven walk, neither of which Handlebars can reach directly.
        nodeMeta: this.buildNodeMeta(this.tree.children)
      });
      this.$('.light-course-tree-root').html(html);
    },

    /**
     * Flat map of nodeId -> { componentTypeDisplayName, wordCount } for every component node in
     * the tree, built fresh on every render so it always reflects the live in-memory tree
     * (including a component whose form was just edited but not yet saved).
     */
    buildNodeMeta: function(nodes, out) {
      out = out || {};
      (nodes || []).forEach(function(node) {
        if (!node) {
          return;
        }
        if (node.type === 'component') {
          var componentType = _.findWhere(this.componentTypes || [], { component: node._component });
          out[node._id] = {
            componentTypeDisplayName: (componentType && componentType.displayName) || node._component || '',
            wordCount: WordCount.countComponentWords(node)
          };
          return;
        }
        this.buildNodeMeta(node.children, out);
      }, this);
      return out;
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
      Origin.trigger('lightCourseEditor:autosave');
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
      Origin.trigger('lightCourseEditor:autosave');
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
            Origin.trigger('lightCourseEditor:autosave');
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
      Origin.trigger('lightCourseEditor:autosave');
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
      // not a first-time type choice - this node (new or already-placed) already has whatever
      // _component it has as the editor opens, so the preset dropdown only ever starts blank
      // here; see the type-select change handler below for the actual "brand new node" case.
      this.renderPresetPicker(found.node, false);
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
        node._component = $select.val();
        this.renderComponentForm(node);
        this.renderPresetPicker(node, isFirstTimeChoice);
        Origin.trigger('lightCourseEditor:autosave');
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
      $.get('api/content/lightcomponentdefault', { componentType: componentType }).done(function(presets) {
        // the node may have moved on to a different componentType (or the editor closed)
        // by the time this resolves - only render against the node's still-current type.
        if (node._component === componentType) {
          self.renderPresetSelect(node, presets || [], applyDefaultIfAvailable);
        }
      });
    },

    renderPresetSelect: function(node, presets, applyDefaultIfAvailable) {
      var $presetPicker = this.$('.light-course-tree-component-editor-preset-picker');
      $presetPicker.empty();
      if (!presets.length) {
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
      $select.on('change', _.bind(function() {
        var preset = _.findWhere(presets, { _id: $select.val() });
        if (preset) {
          this.applyPresetValues(node, preset);
        }
      }, this));
      $presetPicker.append($label).append($select);

      if (applyDefaultIfAvailable && defaultPreset) {
        $select.val(defaultPreset._id);
        this.applyPresetValues(node, defaultPreset);
      }
    },

    applyPresetValues: function(node, preset) {
      Object.assign(node, preset.values || {});
      this.renderComponentForm(node);
      Origin.trigger('lightCourseEditor:autosave');
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
      if (!this.openComponentNodeId || !this.componentFormView) {
        return;
      }
      var found = this.findNode(this.openComponentNodeId);
      if (found) {
        var formData = this.componentFormView.getFormData();
        Object.assign(found.node, formData);
        Origin.trigger('lightCourseEditor:autosave');
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
