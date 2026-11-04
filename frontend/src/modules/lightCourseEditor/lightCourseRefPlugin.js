// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Origin = require('core/origin');
  var LightCourseRefPickerView = require('./views/lightCourseRefPickerView');

  var Plugin = window.CKEDITOR.Plugin;
  var Command = window.CKEDITOR.Command;
  var ButtonView = window.CKEDITOR.ButtonView;

  function parseRef(attributeValue) {
    if (!attributeValue) {
      return null;
    }
    try {
      return JSON.parse(attributeValue);
    } catch (error) {
      return null;
    }
  }

  function downcastRef(attributeValue, conversionApi) {
    var ref = parseRef(attributeValue);
    if (!ref) {
      return;
    }
    var writer = conversionApi.writer;
    if (ref.type === 'glossary') {
      return writer.createAttributeElement('a', {
        href: '#',
        'data-glossaryterm': ref.value,
        'class': 'lc-ref lc-ref-glossary'
      }, { priority: 5 });
    }
    if (ref.type === 'resource-open') {
      return writer.createAttributeElement('a', {
        href: '#',
        'data-show-resource': ref.value,
        'class': 'lc-ref lc-ref-resource'
      }, { priority: 5 });
    }
    if (ref.type === 'resource-marker') {
      return writer.createAttributeElement('span', {
        'data-lc-resource-id': ref.value,
        'class': 'lc-ref lc-ref-resource-marker'
      }, { priority: 5 });
    }
  }

  function registerSchemaAndConversion(editor) {
    editor.model.schema.extend('$text', { allowAttributes: 'lcRef' });

    editor.conversion.for('downcast').attributeToElement({
      model: 'lcRef',
      view: downcastRef
    });

    // Every upcast matcher below also matches (and so consumes) the `class` attribute, not just
    // its own specific data-* attribute - confirmed necessary live: without it,
    // GeneralHtmlSupport's own generic wildcard allow-rule (conf/config.json's
    // ckEditorHtmlSupport.allow has a `{name: ".*", classes: true, styles: true}` catch-all)
    // independently claims the leftover, still-unconsumed `class` attribute and wraps the
    // element a second time as its own generic "preserved" element - producing a doubly-nested
    // <span><span>...</span></span> on every reload (the data round-trips through upcast again)
    // for the resource-marker type specifically (the two `<a>`-based types happened not to
    // exhibit this, since CKEditor 5's own core Link feature already claims plain `<a href>`
    // elements first - but consuming `class` explicitly here removes any reliance on that,
    // keeping all three converters equally robust).
    editor.conversion.for('upcast').elementToAttribute({
      view: { name: 'a', classes: ['lc-ref', 'lc-ref-glossary'], attributes: { 'data-glossaryterm': true } },
      model: {
        key: 'lcRef',
        value: function(viewElement) {
          return JSON.stringify({ type: 'glossary', value: viewElement.getAttribute('data-glossaryterm') });
        }
      }
    });
    editor.conversion.for('upcast').elementToAttribute({
      view: { name: 'a', classes: ['lc-ref', 'lc-ref-resource'], attributes: { 'data-show-resource': true } },
      model: {
        key: 'lcRef',
        value: function(viewElement) {
          return JSON.stringify({ type: 'resource-open', value: viewElement.getAttribute('data-show-resource') });
        }
      }
    });
    editor.conversion.for('upcast').elementToAttribute({
      view: { name: 'span', classes: ['lc-ref', 'lc-ref-resource-marker'], attributes: { 'data-lc-resource-id': true } },
      model: {
        key: 'lcRef',
        value: function(viewElement) {
          return JSON.stringify({ type: 'resource-marker', value: viewElement.getAttribute('data-lc-resource-id') });
        }
      }
    });
  }

  /**
   * Wraps the current selection in the `lcRef` attribute, or - if nothing is selected - inserts
   * `label` as new text carrying it (mirrors the common "insert link" UX of using the picked
   * item's own label as the link text when the editor had no selection to wrap).
   */
  class InsertLightCourseRefCommand extends Command {
    execute(ref) {
      var editor = this.editor;
      var model = editor.model;
      var selection = model.document.selection;
      var refAttributeValue = JSON.stringify({ type: ref.type, value: ref.value });

      model.change(function(writer) {
        if (selection.isCollapsed) {
          var text = writer.createText(ref.label || ref.value, { lcRef: refAttributeValue });
          model.insertContent(text, selection.getFirstPosition());
          return;
        }
        var ranges = model.schema.getValidRanges(Array.from(selection.getRanges()), 'lcRef');
        ranges.forEach(function(range) {
          writer.setAttribute('lcRef', refAttributeValue, range);
        });
      });
    }

    refresh() {
      this.isEnabled = true;
    }
  }

  function addToolbarButton(editor, componentName, label, onExecute) {
    editor.ui.componentFactory.add(componentName, function(locale) {
      var button = new ButtonView(locale);
      button.set({ label: label, withText: true, tooltip: true });
      button.on('execute', onExecute);
      return button;
    });
  }

  /**
   * "Insert glossary/resource reference" CKEditor 5 plugin for the Light Course Editor's
   * component field TextAreas (frontend/src/modules/scaffold/backboneFormsOverrides.js's TextArea
   * render() override adds this plugin + its toolbar button(s) only when the field's own schema
   * carries a `lightCourseRefs` config - see schemaFilter.js's attachLightCourseRefs()).
   *
   * Stores a single model text attribute, `lcRef`, as a JSON string: {type, value}, where type is
   * one of:
   *   - 'glossary'        - value is the glossary item's `term` text (matched case-insensitively
   *                          by the real adapt-contrib-glossary extension's own runtime click
   *                          handler - confirmed against its source: `a[data-glossaryterm]`).
   *   - 'resource-open'   - value is the resource item's stable `_id`. Downcasts to
   *                          `data-show-resource`, the attribute name conf/config.json's
   *                          ckEditorHtmlSupport.allow rule already anticipates - correct,
   *                          forward-compatible markup, though the currently-installed
   *                          adapt-contrib-resources@5.6.0 has no click handler for it yet (that
   *                          would need a change in the separate adapt_framework repo), so this
   *                          renders as a real link but doesn't yet do anything when clicked in a
   *                          built course.
   *   - 'resource-marker' - value is the resource item's stable `_id`. Downcasts to a plain,
   *                          non-clickable `<span>` - an authoring-only annotation.
   *
   * This is a genuine custom inline CKEditor 5 feature (its own schema attribute + real
   * upcast/downcast converters), not a GeneralHtmlSupport attribute-preservation hack - modelled
   * on the same "attribute on $text" architecture CKEditor 5's own core Link feature uses
   * (confirmed the standard, documented pattern for this kind of inline annotation). Plugin/
   * Command are real ES2015 classes in CKEditor 5's CDN build (confirmed via live testing - an
   * ES5 Plugin.call(this, editor)-style "subclass" throws "Class constructor cannot be invoked
   * without 'new'"), so this - and InsertLightCourseRefCommand above - use real `class X extends
   * Y`, not Backbone/OriginView's usual ES5 prototype style.
   */
  class LightCourseRefPlugin extends Plugin {
    static get pluginName() {
      return 'LightCourseRef';
    }

    init() {
      var editor = this.editor;
      var config = editor.config.get('lightCourseRefs') || {};

      registerSchemaAndConversion(editor);
      editor.commands.add('insertLightCourseRef', new InsertLightCourseRefCommand(editor));

      if (config.glossaryEnabled && (config.glossaryItems || []).length) {
        addToolbarButton(editor, 'lightCourseGlossaryRef', Origin.l10n.t('app.lightcourserefglossarybutton'), function() {
          Origin.trigger('modal:open', LightCourseRefPickerView, {
            title: Origin.l10n.t('app.lightcourserefglossarypickertitle'),
            _shouldShowDoneButton: false,
            refType: 'glossary',
            items: config.glossaryItems,
            onUpdate: function(ref) {
              if (ref) {
                editor.execute('insertLightCourseRef', ref);
              }
            }
          });
        });
      }

      if (config.resourceEnabled && (config.resourceItems || []).length) {
        addToolbarButton(editor, 'lightCourseResourceRef', Origin.l10n.t('app.lightcourserefresourcebutton'), function() {
          Origin.trigger('modal:open', LightCourseRefPickerView, {
            title: Origin.l10n.t('app.lightcourserefresourcepickertitle'),
            _shouldShowDoneButton: false,
            refType: 'resource',
            items: config.resourceItems,
            onUpdate: function(ref) {
              if (ref) {
                editor.execute('insertLightCourseRef', ref);
              }
            }
          });
        });
      }
    }
  }

  return LightCourseRefPlugin;
});
