import { Buffer } from 'node:buffer';
import { ATTRIBUTION, MAX_INPUT_BYTES, RUBRIC_VERSION } from './constants';
import { AtsScoreError } from './errors';
import { inspectText } from './text';
import type { AnalysisResult, CategoryId, ImprovementTip, InputFormat, ScoreCheck, TipPriority } from './types';

export interface DocumentAssessment {
  source: InputFormat;
  layoutRisks?: string[];
  warnings?: string[];
}

const CATEGORIES: { id: CategoryId; title: string }[] = [
  { id: 'machine-readability', title: 'Machine readability' },
  { id: 'sections', title: 'Recognizable sections' },
  { id: 'contact', title: 'Contact information' },
  { id: 'experience', title: 'Experience and achievements' },
  { id: 'readability', title: 'Readability' },
];

const TIP_CONTENT: Record<string, { priority: TipPriority; recommendation: string; example: string }> = {
  'word-count': {
    priority: 'high',
    recommendation: 'Add relevant experience, projects, skills, and training until the CV contains at least 100 words. Use useful detail rather than filler.',
    example: 'Supported [team or customer group] by [specific responsibility], resulting in [observable outcome].',
  },
  'text-encoding': {
    priority: 'high',
    recommendation: 'Replace corrupted characters and export a fresh document. Copy its text into a plain-text editor to verify that it remains readable.',
    example: 'A reader should be able to copy “Professional Experience” exactly as it appears.',
  },
  'docx-layout': {
    priority: 'high',
    recommendation: 'Use one column, put contact details in the main document body, and replace layout tables with ordinary paragraphs and lists.',
    example: '[Your name]\n[your email]\n\nExperience\n[Role] | [Organization] | [Dates]',
  },
  'experience-section': {
    priority: 'high',
    recommendation: 'Add a clearly labeled Experience, Projects, Volunteer Experience, or Practical Training section with relevant details.',
    example: 'Projects\n[Project name] | [Dates]\nBuilt [deliverable] to help [audience] accomplish [outcome].',
  },
  'skills-section': {
    priority: 'medium',
    recommendation: 'Use a Skills or Core Competencies heading and list specific abilities you can demonstrate. More keywords do not earn extra points.',
    example: 'Skills: [Relevant skill], [Relevant tool], [Relevant method]',
  },
  'education-section': {
    priority: 'low',
    recommendation: 'Include relevant education, certifications, or training under a recognizable heading.',
    example: 'Training\n[Course or certificate] | [Provider] | [Year]',
  },
  'email': {
    priority: 'high',
    recommendation: 'Include a readable email address in the CV body. A link labeled only “Email” may not survive text extraction.',
    example: '[your.name]@example.com',
  },
  'action-verbs': {
    priority: 'medium',
    recommendation: 'Start at least half of your description statements with a concrete action verb such as Led, Created, Supported, or Improved.',
    example: 'Coordinated [activity] for [audience], improving [specific outcome].',
  },
  'experience-dates': {
    priority: 'medium',
    recommendation: 'Add month/year dates or a year range to your experience, projects, volunteering, or practical training.',
    example: '[Role or project] | [Organization] | Jan [year] – Dec [year]',
  },
  'quantified-evidence': {
    priority: 'medium',
    recommendation: 'Where accurate and relevant, add numbers to at least two description statements. Scope, people served, time saved, or output counts can be useful when revenue metrics do not apply.',
    example: 'Supported [number] customers per week while reducing [issue] by [percentage]%. Use only figures you can support.',
  },
  'statement-count': {
    priority: 'medium',
    recommendation: 'Include at least three useful description statements across your experience or projects. Put separate statements on separate lines or in bullets.',
    example: '• Created [deliverable].\n• Supported [audience] through [activity].\n• Improved [process] with [specific change].',
  },
  'concise-statements': {
    priority: 'low',
    recommendation: 'Keep at least 80% of your description statements to 35 words or fewer. Split long statements and remove repeated context.',
    example: 'Improved [process] using [method], saving [time or resources].',
  },
  'duplicate-statements': {
    priority: 'low',
    recommendation: 'Replace repeated statements with distinct responsibilities or outcomes. Each statement should contribute new information.',
    example: 'For one role, describe [responsibility]; for another, describe [different contribution].',
  },
};

export function validateText(text: string): void {
  if (typeof text !== 'string') throw new AtsScoreError('INVALID_INPUT', 'CV text must be a string.', 'Pass extracted CV text to analyzeText(text).');
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    throw new AtsScoreError('INPUT_TOO_LARGE', 'The CV exceeds the 10 MB input limit.', 'Remove unrelated content or export a smaller document.');
  }
  if (!text.trim()) throw new AtsScoreError('EMPTY_INPUT', 'The CV contains no text.', 'Provide a CV with readable text.');
  if (!/\p{L}/u.test(text)) {
    throw new AtsScoreError('NO_EXTRACTABLE_TEXT', 'No usable CV text was found.', 'Export a text-based PDF or DOCX, or run OCR separately before supplying text.');
  }
}

export function analyzeDocumentText(text: string, assessment: DocumentAssessment): AnalysisResult {
  validateText(text);
  const data = inspectText(text);
  const checks: ScoreCheck[] = [];
  const add = (id: string, category: CategoryId, title: string, maxPoints: number, earnedPoints: number | null, message: string) => {
    checks.push({
      id, category, title, maxPoints, earnedPoints: earnedPoints ?? 0, message,
      status: earnedPoints === null ? 'unassessed' : earnedPoints === maxPoints ? 'pass' : earnedPoints === 0 ? 'fail' : 'partial',
    });
  };
  const statementCount = data.statements.length;
  const actionRatio = statementCount ? data.actionCount / statementCount : 0;
  const conciseRatio = statementCount ? data.conciseCount / statementCount : 0;
  const duplicateRatio = statementCount ? data.duplicateCount / statementCount : 1;

  add('word-count', 'machine-readability', 'Enough readable text', 10, data.wordCount >= 100 ? 10 : 0, `${data.wordCount} words detected; this check requires at least 100.`);
  add('text-encoding', 'machine-readability', 'Clean text encoding', 5, data.corruptionRatio < 0.01 ? 5 : 0, `${(data.corruptionRatio * 100).toFixed(2)}% unexpected control or replacement characters; this check requires less than 1%.`);
  add('docx-layout', 'machine-readability', 'Observable DOCX layout risks', 10,
    assessment.layoutRisks === undefined ? null : assessment.layoutRisks.length ? 0 : 10,
    assessment.layoutRisks === undefined
      ? 'DOCX layout inspection is unavailable for this input.'
      : assessment.layoutRisks.length ? `Detected: ${assessment.layoutRisks.join(', ')}.` : 'No tables, multiple columns, or header/footer contact details detected in the DOCX.');
  add('experience-section', 'sections', 'Experience or equivalent', 10, data.hasExperience ? 10 : 0, data.hasExperience ? 'Found an experience, project, volunteering, or practical training section with content.' : 'No recognizable experience or equivalent section with content found.');
  add('skills-section', 'sections', 'Skills or competencies', 10, data.hasSkills ? 10 : 0, data.hasSkills ? 'Found a skills or competencies section with content.' : 'No recognizable skills or competencies section with content found.');
  add('education-section', 'sections', 'Education or training', 5, data.hasEducation ? 5 : 0, data.hasEducation ? 'Found an education, training, or certification section with content.' : 'No recognizable education or training section with content found.');
  add('email', 'contact', 'Readable email address', 10, data.hasEmail ? 10 : 0, data.hasEmail ? 'Found a readable email address.' : 'No readable email address found.');
  add('action-verbs', 'experience', 'Action-oriented descriptions', 10, actionRatio >= 0.5 ? 10 : actionRatio >= 0.25 ? 5 : 0, `${data.actionCount} of ${statementCount} description statements start with a recognized action verb; 50% earns full points and 25% earns half.`);
  add('experience-dates', 'experience', 'Dated experience or projects', 5, data.hasDatedExperience ? 5 : 0, data.hasDatedExperience ? 'Found dates within an experience or equivalent section.' : 'No recognizable dates found within experience or equivalent sections.');
  add('quantified-evidence', 'experience', 'Quantified contributions', 10, data.quantifiedCount >= 2 ? 10 : data.quantifiedCount === 1 ? 5 : 0, `${data.quantifiedCount} description statements contain quantified evidence; two earn full points and one earns half.`);
  add('statement-count', 'readability', 'Useful description statements', 5, statementCount >= 3 ? 5 : 0, `${statementCount} description statements detected; this check requires at least three.`);
  add('concise-statements', 'readability', 'Concise descriptions', 5, statementCount > 0 && conciseRatio >= 0.8 ? 5 : 0, `${data.conciseCount} of ${statementCount} description statements contain 35 words or fewer; this check requires 80%.`);
  add('duplicate-statements', 'readability', 'Distinct descriptions', 5, statementCount > 0 && duplicateRatio <= 0.2 ? 5 : 0, `${data.duplicateCount} duplicate description statements detected; this check allows at most 20%.`);

  const categories = CATEGORIES.map(category => {
    const members = checks.filter(check => check.category === category.id);
    return {
      ...category,
      earnedPoints: members.reduce((sum, check) => sum + check.earnedPoints, 0),
      availablePoints: members.filter(check => check.status !== 'unassessed').reduce((sum, check) => sum + check.maxPoints, 0),
      maxPoints: members.reduce((sum, check) => sum + check.maxPoints, 0),
    };
  });
  const earned = categories.reduce((sum, category) => sum + category.earnedPoints, 0);
  const available = categories.reduce((sum, category) => sum + category.availablePoints, 0);
  const failedChecks = checks.filter(check => check.status === 'fail' || check.status === 'partial');
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  failedChecks.sort((a, b) => {
    const aTip = TIP_CONTENT[a.id]!;
    const bTip = TIP_CONTENT[b.id]!;
    return priorityOrder[aTip.priority] - priorityOrder[bTip.priority]
      || (b.maxPoints - b.earnedPoints) - (a.maxPoints - a.earnedPoints)
      || checks.indexOf(a) - checks.indexOf(b);
  });
  const tips: ImprovementTip[] = failedChecks.map(check => ({
    checkId: check.id,
    title: check.title,
    explanation: check.message,
    ...TIP_CONTENT[check.id]!,
  }));
  const warnings = [...(assessment.warnings ?? [])];
  if (assessment.layoutRisks === undefined) {
    warnings.push('Document layout was not assessed. The score is normalized over 90 assessable points and cannot confirm columns, tables, or header/footer placement.');
  }
  warnings.push('English-only heuristic estimate of ATS readiness and CV quality; not an employer-validated score or a hiring prediction.');

  return {
    score: Math.max(0, Math.min(100, Math.round(earned / available * 100))),
    source: assessment.source,
    rubricVersion: RUBRIC_VERSION,
    categories, checks, tips, warnings,
    coverage: { assessedPoints: available, totalPoints: 100, unassessedCheckIds: checks.filter(check => check.status === 'unassessed').map(check => check.id) },
    statistics: {
      wordCount: data.wordCount,
      descriptionStatementCount: statementCount,
      actionVerbStatementCount: data.actionCount,
      quantifiedStatementCount: data.quantifiedCount,
    },
    attribution: { ...ATTRIBUTION },
  };
}

/** Score an English CV's extracted text synchronously, without reading files or making network calls. */
export function analyzeText(text: string): AnalysisResult {
  return analyzeDocumentText(text, { source: 'text' });
}
