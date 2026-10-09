import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { PDFDocument, PDFHexString, StandardFonts } from 'pdf-lib';

export const STRONG_CV = readFileSync(new URL('./fixtures/strong.txt', import.meta.url), 'utf8');
export const WEAK_CV = readFileSync(new URL('./fixtures/weak.txt', import.meta.url), 'utf8');
const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function makeDocx(text: string, options: { table?: boolean; columns?: boolean; header?: string; footer?: string; imageOnly?: boolean } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  const paragraphs = options.imageOnly ? '<w:p/>' : text.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`).join('');
  const table = options.table ? '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Layout cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' : '';
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}${table}<w:sectPr><w:cols w:num="${options.columns ? 2 : 1}"/></w:sectPr></w:body></w:document>`);
  for (const kind of ['header', 'footer'] as const) {
    if (options[kind] !== undefined) zip.file(`word/${kind}1.xml`, `<w:${kind === 'header' ? 'hdr' : 'ftr'} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${escapeXml(options[kind]!)}</w:t></w:r></w:p></w:${kind === 'header' ? 'hdr' : 'ftr'}>`);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function makePdf(text?: string, encrypted = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([612, 792]);
  let y = 752;
  if (text) {
    for (const original of text.split('\n')) {
      const wrapped: string[] = [];
      let line = '';
      for (const word of original.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(next, 10) > 532) { wrapped.push(line); line = word; }
        else line = next;
      }
      wrapped.push(line);
      for (const value of wrapped) {
        if (y < 40) { page = pdf.addPage([612, 792]); y = 752; }
        if (value) page.drawText(value, { x: 40, y, font, size: 10 });
        y -= 14;
      }
    }
  } else {
    // A valid raster-only PDF exercises the same text-extraction failure as a scanned CV.
    const image = await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'));
    page.drawImage(image, { x: 40, y: 40, width: 532, height: 712 });
  }
  if (encrypted) {
    // Synthetic Standard security dictionary: the parser must request a password rather than score it.
    const security = pdf.context.obj({ Filter: 'Standard', V: 1, R: 2, O: PDFHexString.of('00'.repeat(32)), U: PDFHexString.of('00'.repeat(32)), P: -4 });
    pdf.context.trailerInfo.Encrypt = pdf.context.register(security);
    pdf.context.trailerInfo.ID = pdf.context.obj([PDFHexString.of('01'.repeat(16)), PDFHexString.of('01'.repeat(16))]);
  }
  return pdf.save({ useObjectStreams: false });
}
