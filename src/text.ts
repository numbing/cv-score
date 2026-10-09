export const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}/iu;
export const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const MONTH_DATE = new RegExp(`\\b${MONTH}\\.?\\s+(?:19|20)\\d{2}\\b`, 'giu');
const YEAR_RANGE = /\b(?:19|20)\d{2}\s*[-–—/]\s*(?:(?:19|20)\d{2}|present|current|now)\b/giu;
const NUMERIC_DATE = /\b(?:\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2}))\b/gu;
const PHONE_PATTERN = /(?:\+\d[\d ()-]{7,}\d|\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b)/gu;
const BULLET = /^(?:[-*•●▪◦‣–—]|\d+[.)])\s+/u;

const ACTION_VERBS = new Set((
  'achieved adapted administered advised advocated analyzed arranged assembled assessed assisted audited authored automated ' +
  'balanced budgeted built calculated cared coached collaborated collected communicated completed conducted coordinated ' +
  'created cultivated decreased delivered designed developed diagnosed directed documented drove educated eliminated enabled ' +
  'engineered enhanced established evaluated exceeded executed expanded facilitated founded generated grew guided handled ' +
  'implemented improved increased initiated inspected installed instructed introduced investigated launched led maintained ' +
  'managed measured mentored monitored negotiated operated optimized organized oversaw performed planned prepared presented ' +
  'processed produced provided published raised reconciled recruited reduced redesigned researched resolved reviewed scheduled ' +
  'secured served simplified sold streamlined supervised supported taught tested trained transformed translated treated ' +
  'updated volunteered won wrote'
).split(' '));

type SectionKind = 'experience' | 'skills' | 'education' | 'other';
interface Section { kind: SectionKind; lines: string[] }
const HEADINGS = new Map<string, SectionKind>();
function addHeadings(kind: SectionKind, headings: string[]) {
  for (const heading of headings) HEADINGS.set(heading, kind);
}
addHeadings('experience', [
  'experience', 'work experience', 'professional experience', 'employment', 'employment history',
  'career history', 'work history', 'relevant experience', 'professional background', 'professional history',
  'internships', 'internship experience', 'projects', 'personal projects', 'selected projects', 'academic projects',
  'relevant projects', 'project experience', 'research experience', 'research projects', 'volunteering',
  'volunteer experience', 'volunteer work', 'community experience', 'community involvement', 'practical training',
  'apprenticeships', 'apprenticeship experience',
]);
addHeadings('skills', [
  'skills', 'technical skills', 'core skills', 'key skills', 'professional skills', 'competencies',
  'core competencies', 'key competencies', 'areas of expertise', 'expertise', 'skills and competencies',
  'skills & competencies', 'skills and tools', 'skills & tools', 'technical competencies', 'skills summary',
  'skills and abilities',
]);
addHeadings('education', [
  'education', 'education and training', 'education & training', 'training', 'certifications', 'certificates',
  'professional development', 'academic background', 'qualifications', 'education and certifications',
  'education & certifications', 'courses', 'licenses', 'licences', 'licenses and certifications', 'training and certifications',
]);
addHeadings('other', [
  'summary', 'professional summary', 'profile', 'professional profile', 'objective', 'career objective',
  'about me', 'interests', 'hobbies', 'languages', 'references', 'awards', 'achievements', 'publications',
  'additional information', 'contact', 'contact information', 'personal information', 'personal details', 'links',
]);

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function hasActionVerb(statement: string): boolean {
  const firstWord = statement.match(/^[\p{L}]+/u)?.[0]?.toLowerCase();
  return firstWord !== undefined && ACTION_VERBS.has(firstWord);
}

function detectHeading(line: string): { kind: SectionKind; inline: string } | undefined {
  const cleaned = line.replace(/^#{1,6}\s*/, '').replace(/\*\*|__/g, '').trim();
  const colon = cleaned.indexOf(':');
  const candidate = (colon >= 0 ? cleaned.slice(0, colon) : cleaned).replace(/[:|\s]+$/g, '').toLowerCase();
  const kind = HEADINGS.get(candidate);
  if (kind !== undefined) return { kind, inline: colon >= 0 ? cleaned.slice(colon + 1).trim() : '' };
  // Do not guess from uppercase alone: job titles and skill names may be uppercase too.
  return undefined;
}

export function hasDate(text: string): boolean {
  // Use fresh regexes: global regex state must not affect repeat analyses.
  return new RegExp(MONTH_DATE.source, 'iu').test(text)
    || new RegExp(YEAR_RANGE.source, 'iu').test(text)
    || new RegExp(NUMERIC_DATE.source, 'u').test(text)
    || /^\s*(?:19|20)\d{2}\s*$/.test(text);
}

function withoutDatesAndContacts(text: string): string {
  return text
    .replace(new RegExp(EMAIL_PATTERN.source, 'giu'), ' ')
    .replace(PHONE_PATTERN, ' ')
    .replace(MONTH_DATE, ' ')
    .replace(YEAR_RANGE, ' ')
    .replace(NUMERIC_DATE, ' ')
    .replace(/\b(?:19|20)\d{2}\b/gu, ' ');
}

export function hasQuantifiedEvidence(statement: string): boolean {
  if (/^(?:phone|tel(?:ephone)?|mobile|email|contact)\b/iu.test(statement)) return false;
  const remaining = withoutDatesAndContacts(statement);
  // Only description statements reach this check, never skill lists or job headings.
  return countWords(remaining) >= 3 && /(?:[$€£]\s*\d|\b\d+(?:[.,]\d+)*(?:\s*[%+]|[kKmMbB]\b)?)/u.test(remaining);
}

function descriptionStatements(lines: string[]): string[] {
  const statements: string[] = [];
  let current = '';
  const flush = () => {
    if (countWords(current) >= 3) statements.push(current.trim());
    current = '';
  };
  for (const original of lines) {
    const line = original.trim();
    if (!line) { flush(); continue; }
    const isBullet = BULLET.test(line);
    const content = line.replace(BULLET, '').trim();
    const isDescription = hasActionVerb(content) || /^(?:responsible for|duties included|responsibilities included|worked on)\b/iu.test(content);
    const metadata = !isBullet && !isDescription && (
      hasDate(content) || EMAIL_PATTERN.test(content) || /[|]/u.test(content)
      || /^(?:phone|tel|mobile|https?:|www\.)/iu.test(content)
    );
    if (metadata) { flush(); continue; }
    if (isBullet || isDescription) { flush(); current = content; }
    else if (current) current += ` ${content}`;
    else if (countWords(content) >= 6) current = content;
  }
  flush();
  return statements;
}

export function inspectText(text: string) {
  const normalized = text.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/\f/g, '\n');
  const sections: Section[] = [];
  let active: Section = { kind: 'other', lines: [] };
  sections.push(active);
  for (const line of normalized.split('\n')) {
    const heading = detectHeading(line.trim());
    if (heading) {
      active = { kind: heading.kind, lines: heading.inline ? [heading.inline] : [] };
      sections.push(active);
    } else active.lines.push(line);
  }
  const meaningful = sections.filter(section => section.lines.some(line => /\p{L}/u.test(line)));
  const experience = meaningful.filter(section => section.kind === 'experience');
  const statements = experience.flatMap(section => descriptionStatements(section.lines));
  const keys = statements.map(statement => statement.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
  const duplicateCount = keys.length - new Set(keys).size;
  const badCharacters = text.match(/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f\ufffd]/gu)?.length ?? 0;
  return {
    wordCount: countWords(normalized),
    corruptionRatio: badCharacters / Math.max(Array.from(text).length, 1),
    hasExperience: experience.length > 0,
    hasSkills: meaningful.some(section => section.kind === 'skills'),
    hasEducation: meaningful.some(section => section.kind === 'education'),
    hasEmail: EMAIL_PATTERN.test(text),
    hasDatedExperience: experience.some(section => section.lines.some(hasDate)),
    statements,
    actionCount: statements.filter(hasActionVerb).length,
    quantifiedCount: statements.filter(hasQuantifiedEvidence).length,
    conciseCount: statements.filter(statement => countWords(statement) <= 35).length,
    duplicateCount,
  };
}
