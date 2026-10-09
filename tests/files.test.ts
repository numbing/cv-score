import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { analyzeBuffer, analyzeFile, analyzeText, AtsScoreError, MAX_INPUT_BYTES } from '../src/index';
import type { InputFormat } from '../src/index';
import { makeDocx, makePdf, STRONG_CV } from './helpers';

test('UTF-8 buffers produce the same result as text analysis', async () => {
  assert.deepEqual(await analyzeBuffer(Buffer.from(STRONG_CV), 'text'), analyzeText(STRONG_CV));
  await assert.rejects(analyzeBuffer(Buffer.from([0xff, 0xfe]), 'text'), { code: 'INVALID_INPUT' });
});

test('real PDF text extraction preserves content checks and leaves caller bytes intact', async () => {
  const bytes = await makePdf(STRONG_CV);
  const before = Buffer.from(bytes);
  const result = await analyzeBuffer(bytes, 'pdf');
  assert.equal(result.score, 100);
  assert.equal(result.source, 'pdf');
  assert.equal(result.coverage.assessedPoints, 90);
  assert.equal(result.statistics.descriptionStatementCount, 4);
  assert.deepEqual(Buffer.from(bytes), before);
  assert.equal((await analyzeBuffer(bytes, 'pdf')).score, result.score);
});

test('real DOCX extraction inspects single-column layout and earns full coverage', async () => {
  const result = await analyzeBuffer(await makeDocx(STRONG_CV), 'docx');
  assert.equal(result.score, 100);
  assert.equal(result.source, 'docx');
  assert.equal(result.coverage.assessedPoints, 100);
  assert.deepEqual(result.coverage.unassessedCheckIds, []);
  assert.equal(result.checks.find(item => item.id === 'docx-layout')!.earnedPoints, 10);
});

test('tables, multiple columns, and header/footer contact details cause actionable layout findings', async () => {
  for (const [options, expected] of [
    [{ table: true }, 'tables'], [{ columns: true }, 'multiple columns'],
    [{ header: 'mira@example.com' }, 'contact details in headers or footers'],
    [{ footer: '+49 176 12345678' }, 'contact details in headers or footers'],
  ] as const) {
    const result = await analyzeBuffer(await makeDocx(STRONG_CV, options), 'docx');
    const layout = result.checks.find(item => item.id === 'docx-layout')!;
    assert.equal(layout.earnedPoints, 0);
    assert.ok(layout.message.includes(expected));
    assert.ok(result.tips.some(tip => tip.checkId === 'docx-layout' && tip.priority === 'high'));
  }
  const benign = await analyzeBuffer(await makeDocx(STRONG_CV, { header: 'Mira Patel', footer: 'Page 1' }), 'docx');
  assert.equal(benign.checks.find(item => item.id === 'docx-layout')!.earnedPoints, 10);
});

test('scanned PDFs and textless DOCX files yield useful errors instead of misleading scores', async () => {
  for (const [bytes, format] of [[await makePdf(), 'pdf'], [await makeDocx('', { imageOnly: true }), 'docx']] as const) {
    await assert.rejects(analyzeBuffer(bytes, format), (error: unknown) => error instanceof AtsScoreError && error.code === 'NO_EXTRACTABLE_TEXT' && /OCR/u.test(error.guidance));
  }
});

test('password-protected PDFs and encrypted Word containers are rejected explicitly', async () => {
  await assert.rejects(analyzeBuffer(await makePdf(STRONG_CV, true), 'pdf'), { code: 'ENCRYPTED_DOCUMENT' });
  await assert.rejects(analyzeBuffer(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'docx'), { code: 'ENCRYPTED_DOCUMENT' });
});

test('malformed documents and non-Word ZIP archives are rejected', async () => {
  const zip = new JSZip();
  zip.file('note.txt', 'Not a Word document');
  for (const [bytes, format] of [[Buffer.from('Not a PDF'), 'pdf'], [Buffer.from('%PDF-1.7\ntruncated'), 'pdf'], [Buffer.from('Not a ZIP'), 'docx'], [await zip.generateAsync({ type: 'nodebuffer' }), 'docx']] as const) {
    await assert.rejects(analyzeBuffer(bytes, format), { code: 'CORRUPT_DOCUMENT' });
  }
  const docx = await JSZip.loadAsync(await makeDocx(STRONG_CV));
  docx.file('word/document.xml', '<w:document><broken>');
  await assert.rejects(analyzeBuffer(await docx.generateAsync({ type: 'nodebuffer' }), 'docx'), { code: 'CORRUPT_DOCUMENT' });
  docx.file('word/document.xml', '<!DOCTYPE root [<!ENTITY unsafe "value">]><root/>');
  await assert.rejects(analyzeBuffer(await docx.generateAsync({ type: 'nodebuffer' }), 'docx'), { code: 'CORRUPT_DOCUMENT' });
});

test('buffer size, empty inputs, and unsupported formats are checked before parsing', async () => {
  await assert.rejects(analyzeBuffer(Buffer.alloc(0), 'pdf'), { code: 'EMPTY_INPUT' });
  await assert.rejects(analyzeBuffer(Buffer.alloc(MAX_INPUT_BYTES + 1), 'docx'), { code: 'INPUT_TOO_LARGE' });
  await assert.rejects(analyzeBuffer(Buffer.from('text'), 'png' as InputFormat), { code: 'UNSUPPORTED_FORMAT' });
  await assert.rejects(analyzeBuffer(null as unknown as Uint8Array, 'pdf'), { code: 'INVALID_INPUT' });
});

test('file API accepts uppercase extensions, paths with spaces, and rejects bad paths/files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cv-score-files-'));
  try {
    const path = join(directory, 'My CV.TXT');
    await writeFile(path, STRONG_CV);
    assert.equal((await analyzeFile(path)).score, 100);
    const docx = join(directory, 'My CV.docx');
    await writeFile(docx, await makeDocx(STRONG_CV));
    assert.equal((await analyzeFile(docx)).source, 'docx');
    const pdf = join(directory, 'My CV.pdf');
    await writeFile(pdf, await makePdf(STRONG_CV));
    assert.equal((await analyzeFile(pdf)).source, 'pdf');
    await assert.rejects(analyzeFile(join(directory, 'missing.txt')), { code: 'FILE_NOT_FOUND' });
    await assert.rejects(analyzeFile(join(directory, 'CV.doc')), { code: 'UNSUPPORTED_FORMAT' });
    await assert.rejects(analyzeFile(''), { code: 'INVALID_INPUT' });
    await writeFile(path, Buffer.alloc(MAX_INPUT_BYTES + 1));
    await assert.rejects(analyzeFile(path), { code: 'INPUT_TOO_LARGE' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
