#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { analyzeBuffer, analyzeFile, AtsScoreError } from './index';
import { ATTRIBUTION, MAX_INPUT_BYTES, PACKAGE_VERSION } from './constants';
import type { AnalysisResult } from './types';

const HELP = `CV Score: ATS Readiness and Resume Quality

Usage:
  cv-score <cv.pdf|cv.docx|cv.txt> [--json]
  cv-score --stdin [--json]

Options:
  --stdin       Read UTF-8 plain text from standard input
  --json        Write only the analysis result as JSON
  --help, -h    Show this help
  --version, -v Show the package version

English-only local analysis. No job description, API key, or upload needed.
Maximum input size: 10 MB. Scores are estimates, not hiring predictions.

Built by ${ATTRIBUTION.name} — ${ATTRIBUTION.url}
`;

async function readStdin(): Promise<Buffer> {
  if (process.stdin.isTTY) throw new AtsScoreError('INVALID_INPUT', 'No text was piped to stdin.', 'Pipe a UTF-8 text CV into cv-score --stdin.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size > MAX_INPUT_BYTES) throw new AtsScoreError('INPUT_TOO_LARGE', 'The stdin input exceeds 10 MB.', 'Provide only the CV text.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function render(result: AnalysisResult): string {
  const lines = [
    'CV Score: ATS Readiness and Resume Quality',
    `Estimated score: ${result.score}/100`,
    `Assessment coverage: ${result.coverage.assessedPoints}/${result.coverage.totalPoints} rubric points`,
    '',
    ...result.categories.map(category => `${category.title}: ${category.earnedPoints}/${category.availablePoints} assessable points`),
    '', 'Improvement tips:',
  ];
  if (!result.tips.length) lines.push('All assessable checks passed. Review the limitations below before relying on the score.');
  for (const [index, tip] of result.tips.entries()) {
    lines.push(`${index + 1}. [${tip.priority}] ${tip.title}`, `   ${tip.explanation}`, `   ${tip.recommendation}`, `   Example: ${tip.example.replace(/\n/g, '\n   ')}`, '');
  }
  lines.push('Limitations:', ...result.warnings.map(warning => `- ${warning}`), '', `Built by ${result.attribution.name} — ${result.attribution.url}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      stdin: { type: 'boolean' }, json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true, strict: true,
  });
  if (values.help) { process.stdout.write(HELP); return; }
  if (values.version) { process.stdout.write(`${PACKAGE_VERSION}\n`); return; }
  if (positionals.length > 1 || (values.stdin && positionals.length)) {
    throw new AtsScoreError('INVALID_INPUT', 'Choose either one CV file or --stdin.', 'Run cv-score --help for usage examples.');
  }
  if (!values.stdin && positionals.length === 0) {
    throw new AtsScoreError('INVALID_INPUT', 'Provide a CV file or --stdin.', 'Run cv-score --help for usage examples.');
  }
  const result = values.stdin ? await analyzeBuffer(await readStdin(), 'text') : await analyzeFile(positionals[0]!);
  process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : render(result));
}

main().catch((error: unknown) => {
  if (error instanceof AtsScoreError) process.stderr.write(`${error.code}: ${error.message}\n${error.guidance}\n`);
  else if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS')) {
    process.stderr.write('INVALID_INPUT: Unrecognized or invalid CLI arguments.\nRun cv-score --help for usage examples.\n');
  } else process.stderr.write('ERROR: CV analysis failed unexpectedly.\nTry exporting the CV again or use plain text.\n');
  process.exitCode = 1;
});
