var docx = require('docx');

function table(image, target, notes, style, bookmark) {
  var width = docx.sectionPageSizeDefaults.WIDTH - docx.sectionMarginDefaults.LEFT - docx.sectionMarginDefaults.RIGHT;
  var half = Math.floor(width / 2);
  var border = { style: docx.BorderStyle.SINGLE, size: 6, color: '999999' };
  var imageChildren = bookmark ? [new docx.Bookmark({ id: bookmark, children: [image] })] : [image];
  var text = [new docx.Paragraph({ style: style, children: [
    new docx.TextRun({ text: 'Connect to: ' + target, italics: true })
  ] })];
  if (notes) text.push(new docx.Paragraph({ style: style, children: notes.split('\n').map(function(line, index) {
    return new docx.TextRun({ text: line, break: index ? 1 : 0, italics: true });
  }) }));
  return new docx.Table({
    width: { size: width, type: docx.WidthType.DXA },
    columnWidths: [half, width - half],
    layout: docx.TableLayoutType.FIXED,
    borders: docx.TableBorders.NONE,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    rows: [new docx.TableRow({ children: [
      new docx.TableCell({ width: { size: half, type: docx.WidthType.DXA },
        children: [new docx.Paragraph({ style: style, children: imageChildren })] }),
      new docx.TableCell({ width: { size: width - half, type: docx.WidthType.DXA },
        margins: { top: 120, bottom: 120, left: 120, right: 120 },
        borders: { top: border, bottom: border, left: border, right: border }, children: text })
    ] })]
  });
}

module.exports = { table: table };
