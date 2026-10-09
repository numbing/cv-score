import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { analyzeText, MAX_INPUT_BYTES } from '../src/index';
import { makeDocx, makePdf, STRONG_CV, WEAK_CV } from './helpers';

function cli(args: string[], input?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), ...args], {
    encoding: 'utf8', ...(input === undefined ? {} : { input }), timeout: 30_000, maxBuffer: 1024 * 1024,
  });
}

test('stdin JSON is exactly a result object with attribution and no banner/logs', () => {
  const output = cli(['--stdin', '--json'], STRONG_CV);
  assert.equal(output.status, 0, output.stderr);
  assert.equal(output.stderr, '');
  assert.deepEqual(JSON.parse(output.stdout), analyzeText(STRONG_CV));
});

test('human reports show score, breakdown, advice, limits, and Apply Tracker backlink', () => {
  const output = cli(['--stdin'], WEAK_CV);
  assert.equal(output.status, 0);
  for (const phrase of ['Estimated score:', 'Machine readability:', 'Improvement tips:', 'Example:', '90/100 rubric points', 'not an employer-validated score', 'https://www.apply-tracker.com/']) assert.ok(output.stdout.includes(phrase), phrase);
});

test('help and version succeed without CV input', () => {
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes('cv-score <cv.pdf|cv.docx|cv.txt>'));
  assert.ok(help.stdout.includes('https://www.apply-tracker.com/'));
  assert.equal(cli(['--version']).stdout, '1.0.0\n');
});

test('invalid arguments, empty stdin, missing files and oversize input fail on stderr without JSON output', () => {
  for (const [args, input, code] of [
    [[], undefined, 'INVALID_INPUT'], [['--unknown'], undefined, 'INVALID_INPUT'],
    [['--stdin', 'cv.txt'], '', 'INVALID_INPUT'], [['one.txt', 'two.txt'], undefined, 'INVALID_INPUT'],
    [['--stdin', '--json'], '', 'EMPTY_INPUT'], [['missing-cv.txt', '--json'], undefined, 'FILE_NOT_FOUND'],
    [['--stdin', '--json'], 'x'.repeat(MAX_INPUT_BYTES + 1), 'INPUT_TOO_LARGE'],
  ] as const) {
    const output = cli([...args], input);
    assert.equal(output.status, 1, output.stderr);
    assert.equal(output.stdout, '');
    assert.ok(output.stderr.includes(code));
  }
});

test('PDF and DOCX CLI JSON remains clean even when document parsers initialize', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cv-score-cli-'));
  try {
    for (const [extension, bytes] of [['pdf', await makePdf(STRONG_CV)], ['docx', await makeDocx(STRONG_CV)]] as const) {
      const path = join(directory, `My CV.${extension}`);
      await writeFile(path, bytes);
      const output = cli([path, '--json']);
      assert.equal(output.status, 0, output.stderr);
      assert.equal(output.stderr, '');
      assert.equal(JSON.parse(output.stdout).score, 100);
      assert.equal(JSON.parse(output.stdout).source, extension);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
