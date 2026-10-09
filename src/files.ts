import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { analyzeDocumentText, analyzeText } from './analyze';
import { MAX_INPUT_BYTES } from './constants';
import { AtsScoreError } from './errors';
import { EMAIL_PATTERN } from './text';
import type { AnalysisResult, InputFormat } from './types';

const MAX_EXPANDED_DOCX_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1000;
const MAX_PDF_PAGES = 100;

function validateBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array)) throw new AtsScoreError('INVALID_INPUT', 'CV bytes must be a Buffer or Uint8Array.', 'Pass document bytes to analyzeBuffer(bytes, format).');
  if (!bytes.byteLength) throw new AtsScoreError('EMPTY_INPUT', 'The CV file is empty.', 'Provide a file containing a CV.');
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new AtsScoreError('INPUT_TOO_LARGE', 'The CV exceeds the 10 MB input limit.', 'Export a smaller document or remove high-resolution images.');
}

function readUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new AtsScoreError('INVALID_INPUT', 'The text file is not valid UTF-8.', 'Save the CV text with UTF-8 encoding.', { cause });
  }
}

function pdfLines(items: TextItem[]): string {
  const ordered = items.filter(item => item.str.length > 0).map(item => ({
    text: item.str,
    x: Number(item.transform[4]), y: Number(item.transform[5]),
    width: item.width, height: Math.abs(item.height),
  })).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: typeof ordered[] = [];
  for (const item of ordered) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - item.y) <= Math.max(2, Math.min(row[0]!.height, item.height) * 0.25)) row.push(item);
    else rows.push([item]);
  }
  return rows.map(row => {
    row.sort((a, b) => a.x - b.x);
    let result = '';
    let previous: (typeof ordered)[number] | undefined;
    for (const item of row) {
      const gap = previous ? item.x - previous.x - previous.width : 0;
      if (previous && gap > Math.max(1, item.height * 0.12) && !/\s$/u.test(result) && !/^\s/u.test(item.text)) result += ' ';
      result += item.text;
      previous = item;
    }
    return result;
  }).join('\n');
}

async function analyzePdf(bytes: Uint8Array): Promise<AnalysisResult> {
  if (Buffer.from(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) {
    throw new AtsScoreError('CORRUPT_DOCUMENT', 'The file is not a recognizable PDF.', 'Export the original CV as a valid PDF or provide a DOCX/text file.');
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(bytes), // PDF.js may take ownership; never detach the caller's bytes.
    verbosity: 0,
    stopAtErrors: true,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw new AtsScoreError('INPUT_TOO_LARGE', 'The PDF exceeds the 100-page processing limit.', 'Provide only the pages belonging to the CV.');
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        pages.push(pdfLines(content.items.filter((item): item is TextItem => 'str' in item)));
      } finally { page.cleanup(); }
    }
    const text = pages.join('\n\n');
    if (!/\p{L}/u.test(text)) throw new AtsScoreError('NO_EXTRACTABLE_TEXT', 'The PDF contains no extractable CV text.', 'Export a text-based PDF or run OCR separately, then analyze the extracted text.');
    return analyzeDocumentText(text, { source: 'pdf' });
  } catch (cause) {
    if (cause instanceof AtsScoreError) throw cause;
    if (cause instanceof Error && cause.name === 'PasswordException') {
      throw new AtsScoreError('ENCRYPTED_DOCUMENT', 'The PDF is password protected.', 'Export an unencrypted copy of the CV before scoring it.', { cause });
    }
    throw new AtsScoreError('CORRUPT_DOCUMENT', 'The PDF could not be parsed.', 'Export a fresh PDF from the original document or try DOCX/plain text.', { cause });
  } finally { await task.destroy(); }
}

function visitXml(value: unknown, visitor: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) { for (const child of value) visitXml(child, visitor); return; }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) { visitor(key, child); visitXml(child, visitor); }
}

async function analyzeDocx(bytes: Uint8Array): Promise<AnalysisResult> {
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new AtsScoreError('ENCRYPTED_DOCUMENT', 'This Word file is encrypted or uses the legacy .doc container.', 'Export an unencrypted .docx file; legacy .doc files are unsupported.');
  }
  try {
    const [{ default: JSZip }, { XMLParser, XMLValidator }, { default: mammoth }] = await Promise.all([
      import('jszip'), import('fast-xml-parser'), import('mammoth'),
    ]);
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (entries.length > MAX_ARCHIVE_ENTRIES) throw new AtsScoreError('INPUT_TOO_LARGE', 'The DOCX contains too many archive entries.', 'Export a simpler CV document.');
    // Bound decompressed bytes before handing the archive to the Word parser.
    let expandedSize = 0;
    for (const entry of entries) {
      // JSZip uses a legacy readable-stream implementation without async iteration.
      const stream = new Readable().wrap(entry.nodeStream() as Readable);
      try {
        for await (const chunk of stream) {
          expandedSize += (chunk as Buffer).byteLength;
          if (expandedSize > MAX_EXPANDED_DOCX_BYTES) throw new AtsScoreError('INPUT_TOO_LARGE', 'The DOCX exceeds the 50 MB expanded-content limit.', 'Remove embedded images and unrelated content, then export a smaller CV.');
        }
      } finally { stream.destroy(); }
    }
    const document = zip.file('word/document.xml');
    if (!document || !zip.file('[Content_Types].xml')) throw new Error('Missing DOCX document parts');
    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false });
    const parseXml = (xml: string): unknown => {
      if (/<!DOCTYPE|<!ENTITY/iu.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid document XML');
      return parser.parse(xml);
    };
    const parsed = parseXml(await document.async('string'));
    const riskSet = new Set<string>();
    visitXml(parsed, (key, value) => {
      if (key === 'tbl') riskSet.add('tables');
      if (key === 'cols') {
        for (const cols of Array.isArray(value) ? value : [value]) {
          if (typeof cols === 'object' && cols !== null) {
            const attributes = cols as Record<string, unknown>;
            if (Number(attributes['@_num']) > 1 || (Array.isArray(attributes.col) && attributes.col.length > 1)) riskSet.add('multiple columns');
          }
        }
      }
    });
    for (const part of zip.file(/^word\/(?:header|footer)\d*\.xml$/u)) {
      const pieces: string[] = [];
      visitXml(parseXml(await part.async('string')), (key, value) => {
        if (key === 't') {
          for (const item of Array.isArray(value) ? value : [value]) {
            if (typeof item === 'string' || typeof item === 'number') pieces.push(String(item));
            else if (item && typeof item === 'object' && '#text' in item) pieces.push(String(item['#text']));
          }
        }
      });
      const contact = pieces.join('');
      if (EMAIL_PATTERN.test(contact) || /\+?\d[\d ()-]{7,}\d/u.test(contact)) riskSet.add('contact details in headers or footers');
    }
    // Raw text extraction never renders HTML or follows external document links.
    const extracted = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    if (!/\p{L}/u.test(extracted.value)) throw new AtsScoreError('NO_EXTRACTABLE_TEXT', 'The DOCX contains no extractable CV text.', 'Add readable text to the document or run OCR separately before analyzing text.');
    const warnings = extracted.messages.length ? ['The DOCX parser reported conversion warnings; verify the document text and section boundaries.'] : [];
    return analyzeDocumentText(extracted.value, { source: 'docx', layoutRisks: [...riskSet], warnings });
  } catch (cause) {
    if (cause instanceof AtsScoreError) throw cause;
    if (cause instanceof Error && /encrypted/iu.test(cause.message)) throw new AtsScoreError('ENCRYPTED_DOCUMENT', 'The DOCX archive is encrypted.', 'Export an unencrypted DOCX before scoring it.', { cause });
    throw new AtsScoreError('CORRUPT_DOCUMENT', 'The DOCX could not be parsed.', 'Export a fresh .docx file from the original document or try PDF/plain text.', { cause });
  }
}

/** Analyze document bytes locally; formats are 'pdf', 'docx', or 'text'. */
export async function analyzeBuffer(bytes: Uint8Array, format: InputFormat): Promise<AnalysisResult> {
  if (!['text', 'pdf', 'docx'].includes(format)) throw new AtsScoreError('UNSUPPORTED_FORMAT', 'Supported formats are pdf, docx, and text.', 'Pass one of these format identifiers to analyzeBuffer.');
  validateBytes(bytes);
  if (format === 'text') return analyzeText(readUtf8(bytes));
  return format === 'pdf' ? analyzePdf(bytes) : analyzeDocx(bytes);
}

/** Analyze a local .pdf, .docx, or UTF-8 .txt CV; URLs are not accepted. */
export async function analyzeFile(path: string): Promise<AnalysisResult> {
  if (typeof path !== 'string' || !path.trim()) throw new AtsScoreError('INVALID_INPUT', 'A local CV file path is required.', 'Pass a path ending in .pdf, .docx, or .txt.');
  const extension = extname(path).toLowerCase();
  const format: InputFormat | undefined = extension === '.pdf' ? 'pdf' : extension === '.docx' ? 'docx' : extension === '.txt' ? 'text' : undefined;
  if (!format) throw new AtsScoreError('UNSUPPORTED_FORMAT', 'Only .pdf, .docx, and .txt files are supported.', 'Export legacy Word documents, images, or other formats as PDF, DOCX, or UTF-8 text.');
  let file;
  try {
    file = await open(path, 'r');
    const info = await file.stat();
    if (!info.isFile()) throw new AtsScoreError('INVALID_INPUT', 'The CV path must refer to a regular file.', 'Provide a local PDF, DOCX, or text file.');
    if (info.size > MAX_INPUT_BYTES) throw new AtsScoreError('INPUT_TOO_LARGE', 'The CV exceeds the 10 MB input limit.', 'Export a smaller CV.');
    // Bounded reads also protect against a file growing after stat().
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - size));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_INPUT_BYTES) throw new AtsScoreError('INPUT_TOO_LARGE', 'The CV exceeds the 10 MB input limit.', 'Export a smaller CV.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return await analyzeBuffer(Buffer.concat(chunks), format);
  } catch (cause) {
    if (cause instanceof AtsScoreError) throw cause;
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') throw new AtsScoreError('FILE_NOT_FOUND', 'The CV file was not found.', 'Check the file path and try again.', { cause });
    throw new AtsScoreError('FILE_READ_ERROR', 'The CV file could not be read.', 'Check that the path is a readable regular file.', { cause });
  } finally { await file?.close(); }
}
