# CV Score: ATS Readiness and Resume Quality

**Built by [Apply Tracker](https://www.apply-tracker.com/)** — free tools to build CVs, check resumes, and track job applications.

`cv-score` is a local CV and resume scoring library and command-line tool. Analyze English PDF, DOCX, or plain-text CVs to get an **estimated score from 0–100**, an explainable breakdown, and practical improvement tips. No job description, AI API key, or CV upload is required.

- JavaScript and TypeScript API, with ESM and CommonJS support.
- PDF, DOCX, and UTF-8 text input.
- Repeatable rules for structure, readable contact details, clear descriptions, and achievements.
- Projects, volunteering, and practical training count as experience equivalents.
- Prioritized advice with illustrative examples; no invented achievements.
- JSON output for integrating into your own tools.

The score is **this package's heuristic estimate**, not a universal score used by companies, an employer-validated assessment, a job-match percentage, or a hiring prediction.

## Install

Requires **Node.js 22.13 or later**.

```sh
npm install cv-score
```

Run the CLI without a permanent installation:

```sh
npx cv-score ./resume.pdf
npx cv-score ./resume.docx --json
cat ./resume.txt | npx cv-score --stdin
```

For repeated terminal use, install globally:

```sh
npm install --global cv-score
cv-score ./resume.pdf
```

## JavaScript and TypeScript

```ts
import { analyzeText, analyzeFile, analyzeBuffer, AtsScoreError } from 'cv-score';
import { readFile } from 'node:fs/promises';

const textResult = analyzeText(`
Alex Morgan
alex@example.com

Projects
Community Workshop | Jan 2023 – Dec 2024
• Coordinated 12 workshops for local residents.
• Supported 40 participants through practical training sessions.
• Created a useful guide for new volunteers.

Skills: Scheduling, communication, team coordination

Training
Community Leadership Certificate | Learning Centre | 2023
`);

console.log(textResult.score);
console.log(textResult.tips);

try {
  const result = await analyzeFile('./resume.pdf');
  console.log(result.categories);
} catch (error) {
  if (error instanceof AtsScoreError) {
    console.error(error.code, error.message, error.guidance);
  } else {
    throw error;
  }
}

const bytes = await readFile('./resume.docx');
const bufferResult = await analyzeBuffer(bytes, 'docx');
```

CommonJS:

```js
const { analyzeText, analyzeFile } = require('cv-score');

const result = analyzeText('Your extracted CV text');
analyzeFile('./resume.docx').then(result => console.log(result.score));
```

### Public API

| Function | Returns | Input |
| --- | --- | --- |
| `analyzeText(text)` | `AnalysisResult` | Extracted English CV text; synchronous |
| `analyzeFile(path)` | `Promise<AnalysisResult>` | Local `.pdf`, `.docx`, or `.txt` file; extensions are case-insensitive |
| `analyzeBuffer(bytes, format)` | `Promise<AnalysisResult>` | `Buffer` or `Uint8Array`; format is `'pdf'`, `'docx'`, or `'text'` |

The package exports its public TypeScript types, `AtsScoreError`, `MAX_INPUT_BYTES`, and `RUBRIC_VERSION`. File URLs, remote URLs, legacy `.doc` files, and image uploads are unsupported. The SDK does not log analysis results.

### Result

Every successful result includes:

| Field | Meaning |
| --- | --- |
| `score` | Integer from 0–100, normalized over assessable points |
| `source` | `'text'`, `'pdf'`, or `'docx'` |
| `rubricVersion` | Version of the scoring rules, currently `1.0.0` |
| `categories` | Each category's earned, available, and full maximum points |
| `checks` | Stable check IDs, explanations, points, and `pass`, `partial`, `fail`, or `unassessed` status |
| `tips` | Failed/partial checks with priority, explanation, recommendation, and example |
| `warnings` | Assessment limitations and document conversion warnings |
| `coverage` | Assessed points out of 100 and IDs of unassessed checks |
| `statistics` | Word and description counts, action verb statements, and quantified statements |
| `attribution` | `{ name: 'Apply Tracker', url: 'https://www.apply-tracker.com/' }` |

The result contains no full copy of the CV or extracted personal details. Tips are ordered by priority, then lost points, then rubric order.

## CLI

```sh
cv-score <cv.pdf|cv.docx|cv.txt> [--json]
cv-score --stdin [--json]
cv-score --help
cv-score --version
```

Quote file paths containing spaces. Use `--` before a filename beginning with a hyphen:

```sh
cv-score "My Resume.pdf" --json
cv-score -- "-resume.txt"
```

Human reports show the score, assessment coverage, category breakdown, tips, limitations, and Apply Tracker link. `--json` emits **only the result object** to stdout. Input errors go to stderr with a nonzero exit code and no partial result. `--stdin` accepts UTF-8 plain text, not binary PDF or DOCX bytes.

## Scoring methodology

Each check awards the points below. Unless stated otherwise, checks are pass/fail.

| Category | Check | Maximum points |
| --- | --- | ---: |
| Machine readability | At least 100 words of extracted text | 10 |
| Machine readability | Fewer than 1% replacement characters (`�`) or unexpected control characters | 5 |
| Machine readability | No detected DOCX tables, multiple columns, or contact details in headers/footers | 10 |
| Recognizable sections | Experience, projects, volunteering, or practical training section with content | 10 |
| Recognizable sections | Skills or competencies section with content | 10 |
| Recognizable sections | Education, training, or certification section with content | 5 |
| Contact information | Readable email address in extracted text | 10 |
| Experience and achievements | Recognized action verbs lead at least 50% of description statements; at least 25% earns 5 points | 10 |
| Experience and achievements | Recognizable dates in experience or equivalent sections | 5 |
| Experience and achievements | At least two description statements with numbers; one earns 5 points | 10 |
| Readability | At least three description statements | 5 |
| Readability | At least 80% of description statements contain no more than 35 words | 5 |
| Readability | No more than 20% duplicate description statements | 5 |

**Formula:** `round(earned points / assessable points × 100)`.

PDF and text inputs cannot establish the DOCX layout check, so their maximum assessable points are **90**, not 100. For example, 72 earned points out of 90 become a score of 80. The unavailable 10 points are neither awarded nor deducted. Always display coverage alongside the score: a text-only score of 100 does not establish that the original file has an ATS-friendly layout. DOCX inputs have 100 assessable points.

Section aliases include headings such as Work History, Academic Projects, Volunteer Experience, Core Competencies, and Education and Training. Markdown headings and `Skills: …` inline sections are accepted. Headings without content earn no points. Description statements come from experience and equivalent sections; bullets and separate paragraphs are accepted, and wrapped bullet lines are joined where possible. There are no bonuses for keyword stuffing or adding more skills.

Action verbs use a fixed English dictionary, including Created, Coordinated, Improved, Led, Managed, Supported, and Trained. This is a writing signal, not a judgment of competence. Metric checks count statements containing numbers after removing recognizable dates, years, email addresses, and phone patterns. They do not verify whether a claim is true or meaningful. Duplicate checks ignore casing and punctuation.

There are no required photographs, street addresses, phone numbers, LinkedIn/GitHub profiles, summaries, or profession-specific keywords. These rules do not account for every career stage, hiring market, CV convention, or ATS vendor. File size itself does not change the score.

DOCX layout findings are conservative risk flags, not proof that every ATS will reject a document. Tables may be legitimate content rather than layout. The checks reflect issues documented in [Greenhouse's resume parsing guidance](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse); the package is not affiliated with or validated by Greenhouse.

### Turn advice into useful changes

Weak: “Responsible for customer service.”

More concrete: “Supported [number] customers per week and improved [process] using [method].”

Use real, supportable details. Where metrics do not fit, describe the scope, deliverable, or observable outcome. A good CV is more valuable than maximizing a heuristic score.

Build and refine your CV with [Apply Tracker's free CV and job search tools](https://www.apply-tracker.com/), then track the applications you send.

## Errors and limits

`AtsScoreError` includes a stable `code`, a readable `message`, and actionable `guidance`.

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Wrong input type, invalid path, invalid UTF-8, or invalid CLI arguments |
| `EMPTY_INPUT` | Empty file or blank text |
| `INPUT_TOO_LARGE` | Input/resource limit exceeded |
| `UNSUPPORTED_FORMAT` | Unsupported format or extension |
| `FILE_NOT_FOUND` | Missing local file |
| `FILE_READ_ERROR` | File cannot be read |
| `CORRUPT_DOCUMENT` | Invalid PDF, DOCX, or document XML |
| `ENCRYPTED_DOCUMENT` | Password-protected PDF or encrypted Word container; legacy Word containers also require re-export |
| `NO_EXTRACTABLE_TEXT` | Image-only document or no usable text; export text or run OCR separately |

Limits are 10 MiB of input (10,485,760 bytes), 100 PDF pages, 1,000 DOCX archive entries, and 50 MiB of expanded DOCX content. Plain-text inputs must be UTF-8. English is the only supported analysis language. PDFs and DOCX files must contain readable text: OCR and password decryption are outside this package's scope.

## Privacy

Analysis runs on the machine executing the package. It makes no CV uploads, AI calls, telemetry requests, or analytics requests. It reads only the supplied file and local parser resources. Document external links are not followed, and DOCX HTML is never rendered. Normal npm installation may download dependencies; scoring does not require network access. Applications using this library control their own storage, logging, and privacy practices.

## Development and publishing

```sh
npm ci
npm run check
npm run verify:package
npm pack
```

Tests use fictional CVs and generate valid PDF/DOCX fixtures locally. Artifact verification installs a packed tarball into a temporary project and checks ESM, CommonJS, declaration files, and the installed CLI.

Publishing is a separate, explicit step. After reviewing the README, package contents, and npm account:

```sh
npm whoami
npm view cv-score name
npm publish --access public
```

An `E404` on the name lookup means it is currently unregistered; it does not reserve the name. Recheck before publishing. `npm pack` builds the package through `prepack`, but does not publish it.

## License

MIT © 2026 Apply Tracker. See [LICENSE](./LICENSE).
