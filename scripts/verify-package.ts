import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDocx, makePdf, STRONG_CV } from '../tests/helpers';

const project = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'cv-score-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command: string, args: string[], cwd = directory) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });

try {
  const packed = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], project)) as { filename: string; files: { path: string }[] }[];
  const artifact = packed[0]!;
  for (const path of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts', 'dist/index.d.cts', 'dist/cli.js', 'README.md', 'LICENSE', 'package.json']) assert.ok(artifact.files.some(file => file.path === path), `Missing ${path}`);
  assert.ok(artifact.files.every(file => file.path.startsWith('dist/') || ['README.md', 'LICENSE', 'package.json'].includes(file.path)), 'Unexpected files in npm artifact');

  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'cv-score-test-consumer', private: true, type: 'module' }));
  // --offline can be requested for local verification once dependencies are cached.
  const flags = process.env.CV_SCORE_VERIFY_OFFLINE === '1' ? ['--offline'] : [];
  run(npm, ['install', join(directory, artifact.filename), '--ignore-scripts', '--no-audit', '--no-fund', ...flags]);
  await writeFile(join(directory, 'cv.txt'), STRONG_CV);
  await writeFile(join(directory, 'cv.pdf'), await makePdf(STRONG_CV));
  await writeFile(join(directory, 'cv.docx'), await makeDocx(STRONG_CV));
  const consumerScript = `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { analyzeText, analyzeFile, analyzeBuffer, AtsScoreError } from 'cv-score';
const require = createRequire(import.meta.url);
const commonjs = require('cv-score');
const text = readFileSync('cv.txt', 'utf8');
// Successful analysis must not need a network request, including parser initialization.
globalThis.fetch = async () => { throw new Error('Unexpected network request during scoring'); };
assert.equal(analyzeText(text).score, 100);
assert.deepEqual(commonjs.analyzeText(text), analyzeText(text));
for (const format of ['pdf', 'docx', 'text']) {
  const extension = format === 'text' ? 'txt' : format;
  assert.equal((await analyzeFile('cv.' + extension)).score, 100);
  assert.equal((await commonjs.analyzeBuffer(readFileSync('cv.' + extension), format)).score, 100);
}
assert.throws(() => analyzeText(''), error => error instanceof AtsScoreError && error.code === 'EMPTY_INPUT');
const pkg = JSON.parse(readFileSync('node_modules/cv-score/package.json', 'utf8'));
assert.equal(pkg.homepage, 'https://www.apply-tracker.com/');
assert.equal(pkg.author.url, pkg.homepage);
assert.equal(pkg.name, 'cv-score');
assert.equal(pkg.version, '1.0.0');
assert.ok(readFileSync('node_modules/cv-score/README.md', 'utf8').includes('**Built by [Apply Tracker](https://www.apply-tracker.com/)**'));
`;
  await writeFile(join(directory, 'consumer.mjs'), consumerScript);
  run(process.execPath, ['consumer.mjs']);

  const typedConsumer = `import { analyzeText, analyzeFile, analyzeBuffer, AtsScoreError, type AnalysisResult, type InputFormat } from 'cv-score';
const result: AnalysisResult = analyzeText('English CV text');
const format: InputFormat = 'pdf';
const buffered: Promise<AnalysisResult> = analyzeBuffer(new Uint8Array(), format);
const file: Promise<AnalysisResult> = analyzeFile('cv.txt');
const error: AtsScoreError = new AtsScoreError('EMPTY_INPUT', 'message', 'guidance');
void [result.score, buffered, file, error.code];
`;
  await writeFile(join(directory, 'consumer.mts'), typedConsumer);
  await writeFile(join(directory, 'consumer.cts'), typedConsumer);
  run(process.execPath, [join(project, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.mts', 'consumer.cts']);

  const installedCli = join(directory, 'node_modules/cv-score/dist/cli.js');
  for (const extension of ['txt', 'pdf', 'docx']) {
    const json = run(process.execPath, [installedCli, `cv.${extension}`, '--json']);
    assert.equal(JSON.parse(json).score, 100);
    assert.equal(JSON.parse(json).attribution.url, 'https://www.apply-tracker.com/');
  }
  const binary = join(directory, 'node_modules/.bin', process.platform === 'win32' ? 'cv-score.cmd' : 'cv-score');
  assert.equal(run(binary, ['--version']), '1.0.0\n');
  assert.ok(run(binary, ['cv.txt']).includes('https://www.apply-tracker.com/'));
  console.log('Packed package verified: ESM, CommonJS, TypeScript declarations, PDF/DOCX/text, offline scoring, CLI, and backlinks.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
