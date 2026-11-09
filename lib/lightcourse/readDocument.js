var docx = require('docx');
var wordFields = require('./wordFields');
var wordImages = require('./wordImages');
var richText = require('./wordRichText');

function learnerField(field) {
  return !field.path.split(/[.[\]]+/).some(function(part) {
    return /^(?:aria.*|a11y.*|accessib.*|screenreader.*|alt|longdescription|attribution|uniqueid|graphicsnotes|developernotes|comments)$/i
      .test(part.replace(/^_/, ''));
  });
}

function text(field) {
  return richText.fromHtml(field.text, field.richText, false, true).map(function(paragraph) {
    var value = paragraph.runs.map(function(run) { return run.text || ''; }).join('').trim();
    return value && paragraph.list ? '- ' + value : value;
  }).filter(Boolean).join('\n');
}

async function build(data, blocks, db, options) {
  var entries = [], images = [];
  var maxLevel = blocks.some(function(block) { return block.readLevel; }) ? 5 : 4;
  function heading(value, level) {
    if (value) entries.push({ type: 'heading', text: value, level: level });
  }
  function includeImage(entry) {
    return entry.path === 'screenshotAssetId' ? options.screenshots : options.images;
  }
  function image(entry) {
    if (!includeImage(entry)) return;
    images.push(entry);
    entries.push({ type: 'image', image: entry });
  }
  function fieldsContent(fields, providedImages, level, titlePath) {
    fields = fields.filter(learnerField);
    var contentImages = (providedImages || []).filter(learnerField)
      .concat(options.images ? wordImages.htmlImages(fields) : []).filter(includeImage);
    var root = { prefix: '', level: level, children: [], images: [] };
    function groupFor(path) {
      var group = root, pattern = /\[(\d+)\]/g, match;
      while ((match = pattern.exec(path))) {
        var prefix = path.slice(0, pattern.lastIndex);
        var child = group.children.find(function(entry) { return entry.prefix === prefix; });
        if (!child) {
          child = { prefix: prefix, array: path.slice(0, match.index), index: Number(match[1]),
            level: Math.min(maxLevel, group.level + 1), children: [], images: [] };
          // Image-only items have no configured text fields; retain their array position.
          var siblings = group.children.filter(function(entry) { return entry.array === child.array; });
          var after = siblings.find(function(entry) { return entry.index > child.index; });
          var position = after ? group.children.indexOf(after) : siblings.length ?
            group.children.indexOf(siblings[siblings.length - 1]) + 1 : group.children.length;
          group.children.splice(position, 0, child);
        }
        group = child;
      }
      return group;
    }
    fields.forEach(function(field) { groupFor(field.path).children.push(field); });
    contentImages.forEach(function(entry) { groupFor(entry.path).images.push(entry); });
    function render(group) {
      var titleKey = group.prefix ? group.prefix + '.title' : titlePath;
      var displayKey = group.prefix ? group.prefix + '.displayTitle' : 'displayTitle';
      var title = group.children.find(function(entry) { return entry.path === displayKey; }) ||
        group.children.find(function(entry) { return entry.path === titleKey; });
      if (title) heading(text(title), group.level);
      if (group === root) group.images.forEach(image);
      group.children.forEach(function(entry) {
        if (entry.children) return render(entry);
        if (entry.path === titleKey || entry.path === displayKey) return;
        var isTitle = /(?:^|\.)(?:title|displayTitle|term)$/.test(entry.path);
        if (isTitle && entry.path.endsWith('.title') && group.children.some(function(other) {
          return other.path === entry.path.replace(/title$/, 'displayTitle');
        })) return;
        var value = text(entry);
        if (isTitle) heading(value, Math.min(maxLevel, group.level + 1));
        else if (value) entries.push({ type: 'text', text: value });
      });
      if (group !== root) group.images.forEach(image);
    }
    render(root);
  }

  var courseFields = wordFields.courseFields(data);
  var title = courseFields.find(function(field) { return field.path === 'title'; });
  courseFields.filter(function(field) { return field.path !== 'title'; }).forEach(function(field) {
    var value = text(field);
    if (value) entries.push({ type: 'text', text: value });
    wordImages.htmlImages([field]).forEach(image);
  });
  blocks.filter(function(block) { return block.readLevel || block.level === 1 || block.level === 4; }).forEach(function(block) {
    if (block.level === 4) entries.push({ type: 'componentType', text: block.heading });
    fieldsContent(block.fields || [], block.images, block.readLevel || (block.level === 1 ? 1 : 2), 'title');
  });

  var extensions = data.pluginSelections && data.pluginSelections.extensions || [];
  function section(name, label, items, titleKey, bodyKey) {
    if (!extensions.includes(name)) return;
    var start = entries.length;
    (items || []).forEach(function(item) {
      var fields = wordFields.fixedFields(item, titleKey, bodyKey);
      if (name === 'resources' && item._link) fields.push(wordFields.field('_link', item._link, false));
      var graphics = item._graphic && item._graphic.src ?
        [{ path: '_graphic.src', src: item._graphic.src, alt: item._graphic.alt || '' }] : [];
      fieldsContent(fields, graphics, 2, titleKey);
    });
    if (entries.length > start) entries.splice(start, 0, { type: 'heading', text: label, level: 1 });
  }
  section('glossary', 'Glossary', data.glossaryItems, 'term', 'description');
  section('resources', 'Resources', data.resourceItems, 'title', 'description');
  var help = data.helpContent || {};
  section('help', 'Help', (help.popup ? [help.popup] : []).concat(help.items || []), 'title', 'body');

  await wordImages.load(images, db, data.imageAssets);
  return {
    title: title ? text(title) : '',
    entries: entries.map(function(entry) {
      if (entry.type !== 'image') return entry;
      var loaded = entry.image;
      if (loaded.error) return { type: 'notice', text: 'Image unavailable: ' + loaded.error };
      var image = loaded.options;
      return {
        type: 'image', imageType: image.type,
        src: 'data:image/' + (image.type === 'jpg' ? 'jpeg' : image.type) + ';base64,' + image.data.toString('base64'),
        alt: loaded.alt || '', width: image.transformation.width, height: image.transformation.height
      };
    })
  };
}

function generateDocx(content) {
  var paragraphs = [];
  if (content.title) paragraphs.push(new docx.Paragraph({ text: content.title, heading: docx.HeadingLevel.TITLE }));
  content.entries.forEach(function(entry) {
    if (entry.type === 'componentType') return;
    if (entry.type === 'image') {
      paragraphs.push(new docx.Paragraph({ children: [new docx.ImageRun({
        type: entry.imageType, data: Buffer.from(entry.src.split(',')[1], 'base64'),
        transformation: { width: entry.width, height: entry.height }, altText: {
          title: entry.alt, description: entry.alt, name: entry.alt
        }
      })] }));
    } else {
      entry.text.split('\n').forEach(function(line) {
        paragraphs.push(new docx.Paragraph({
          children: [new docx.TextRun({ text: line, bold: entry.type === 'heading' })],
          heading: entry.type === 'heading' ? docx.HeadingLevel['HEADING_' + entry.level] : undefined
        }));
      });
    }
  });
  return docx.Packer.toBuffer(new docx.Document({
    title: content.title,
    styles: { default: {
      document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 160 } } },
      title: { run: { bold: true, size: 48, color: '000000' } },
      heading1: { run: { bold: true, size: 36, color: '000000' } },
      heading2: { run: { bold: true, size: 28, color: '000000' } },
      heading3: { run: { bold: true, size: 24, color: '000000' } },
      heading4: { run: { bold: true, size: 22, color: '000000' } },
      heading5: { run: { bold: true, size: 20, color: '000000' } }
    } },
    sections: [{ children: paragraphs }]
  }));
}

module.exports = { build: build, generateDocx: generateDocx };
