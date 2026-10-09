import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeText, AtsScoreError, MAX_INPUT_BYTES } from '../src/index';
import { STRONG_CV, WEAK_CV } from './helpers';

const check = (text: string, id: string) => analyzeText(text).checks.find(item => item.id === id)!;

test('a strong CV passes every assessable text check and has explicit layout coverage', () => {
  const result = analyzeText(STRONG_CV);
  assert.equal(result.score, 100);
  assert.equal(result.coverage.assessedPoints, 90);
  assert.deepEqual(result.coverage.unassessedCheckIds, ['docx-layout']);
  assert.equal(result.checks.find(item => item.id === 'docx-layout')!.status, 'unassessed');
  assert.equal(result.categories.reduce((sum, category) => sum + category.maxPoints, 0), 100);
  assert.equal(result.tips.length, 0);
  assert.equal(result.attribution.url, 'https://www.apply-tracker.com/');
  assert.equal(result.statistics.descriptionStatementCount, 4);
});

test('weak CVs get a low bounded score and concrete tips for failed checks', () => {
  const result = analyzeText(WEAK_CV);
  assert.ok(result.score < 30);
  assert.ok(result.tips.some(tip => tip.checkId === 'email' && tip.priority === 'high'));
  assert.ok(result.tips.every(tip => tip.recommendation.length > 0 && tip.example.length > 0));
  assert.ok(result.tips.every(tip => result.checks.some(check => check.id === tip.checkId && ['fail', 'partial'].includes(check.status))));
  assert.ok(!result.tips.some(tip => tip.checkId === 'docx-layout'));
});

test('analysis is deterministic and returned objects do not share mutable attribution', () => {
  const first = analyzeText(STRONG_CV);
  assert.deepEqual(first, analyzeText(STRONG_CV));
  first.attribution.url = 'modified';
  assert.equal(analyzeText(STRONG_CV).attribution.url, 'https://www.apply-tracker.com/');
});

test('projects, volunteering, and practical training work for early-career CVs', () => {
  for (const heading of ['Academic Projects', 'Volunteer Experience', 'Practical Training', 'Apprenticeship Experience']) {
    const text = STRONG_CV.replace('Professional Experience', heading).replace('Core Competencies', 'Skills:');
    assert.equal(analyzeText(text).score, 100, heading);
  }
});

test('recognizes Markdown, inline headings, aliases, and CRLF without requiring optional personal details', () => {
  const text = STRONG_CV.replace('Professional Experience', '## Work History')
    .replace('Core Competencies\n', '**Skills:** ').replace('Education and Training', 'Certifications').replace(/\n/g, '\r\n');
  assert.equal(analyzeText(text).score, 100);
  assert.ok(!analyzeText(text).checks.some(item => /phone|photo|address|linkedin|github/iu.test(item.id)));
});

test('empty headings do not earn section points', () => {
  const text = 'Person\nperson@example.com\nExperience\nSkills\nEducation';
  for (const id of ['experience-section', 'skills-section', 'education-section']) assert.equal(check(text, id).earnedPoints, 0);
});

test('uppercase job titles and skill names are not mistaken for section headings', () => {
  const text = STRONG_CV.replace('Operations Coordinator | Maple Community Services', 'OPERATIONS COORDINATOR')
    .replace('Customer service, scheduling, process improvement, written communication, team coordination, spreadsheet reporting', 'CUSTOMER SERVICE\nTEAM COORDINATION\nSPREADSHEET REPORTING');
  assert.equal(check(text, 'experience-section').earnedPoints, 10);
  assert.equal(check(text, 'skills-section').earnedPoints, 10);
});

test('dates, phone numbers, skills, and numbers outside experience do not count as achievement metrics', () => {
  const text = `Person\nperson@example.com\nSkills: 100 tools\nExperience\nRole | Organization\n2021 – 2024\n• Worked on daily support duties from January 2021 to June 2024.\n• Coordinated tasks with partners by phone at +49 176 12345678.\n• Supported team members by telephone at 212-555-1234.\nEducation\nCourse 2020\nSummary\nImproved output by 50 percent across 100 projects.`;
  const result = analyzeText(text);
  assert.equal(result.statistics.quantifiedStatementCount, 0);
  assert.equal(check(text, 'experience-dates').earnedPoints, 5);
  assert.equal(check(text, 'quantified-evidence').earnedPoints, 0);
  assert.equal(check(text.replace('daily support duties', '12 daily support duties'), 'quantified-evidence').earnedPoints, 5);
});

test('one versus two quantified statements earn half versus full points', () => {
  const prefix = 'Experience\n2021 – 2024\n';
  assert.equal(check(`${prefix}• Improved waiting time by 25 percent.`, 'quantified-evidence').earnedPoints, 5);
  assert.equal(check(`${prefix}• Improved waiting time by 25 percent.\n• Supported 30 visitors each day.`, 'quantified-evidence').earnedPoints, 10);
});

test('action verb thresholds use statement ratios', () => {
  const text = 'Experience\n• Led a busy team through service improvements.\n• Responsible for general administrative duties and customer assistance.\n• Responsible for appointment scheduling and everyday reporting tasks.\n• Responsible for keeping daily records clear and accessible.';
  assert.equal(check(text, 'action-verbs').earnedPoints, 5);
  assert.equal(check(text.replace('Responsible for general', 'Coordinated general'), 'action-verbs').earnedPoints, 10);
});

test('long and repeated statements lose only the appropriate readability points', () => {
  const repeated = '• Supported customers with clear information and useful service recommendations.';
  const text = `Experience\n${repeated}\n${repeated}\n${repeated}\n• Created ${'useful '.repeat(40)}reports.`;
  assert.equal(check(text, 'duplicate-statements').earnedPoints, 0);
  assert.equal(check(text, 'concise-statements').earnedPoints, 0);
  assert.equal(check(text, 'statement-count').earnedPoints, 5);
});

test('wrapped statements remain one logical statement', () => {
  const text = 'Experience\n• Improved service quality by providing clear guidance\nand developing practical procedures for the support team.\n• Supported customers with clear communication and useful resources.\n• Created a useful process guide for new colleagues.';
  assert.equal(analyzeText(text).statistics.descriptionStatementCount, 3);
});

test('corruption threshold is strict and short/odd inputs remain bounded', () => {
  assert.equal(check(`${'a'.repeat(99)}\ufffd`, 'text-encoding').earnedPoints, 0);
  assert.equal(check(`${'a'.repeat(100)}\ufffd`, 'text-encoding').earnedPoints, 5);
  for (const text of ['Hello', 'EXPERIENCE\nHello', STRONG_CV, WEAK_CV, 'a\u0000\ufffd']) {
    const score = analyzeText(text).score;
    assert.ok(Number.isInteger(score) && score >= 0 && score <= 100);
  }
});

test('invalid and oversized text inputs return typed errors with guidance', () => {
  const cases: [unknown, string][] = [[null, 'INVALID_INPUT'], ['', 'EMPTY_INPUT'], [' \n ', 'EMPTY_INPUT'], ['123456', 'NO_EXTRACTABLE_TEXT'], ['x'.repeat(MAX_INPUT_BYTES + 1), 'INPUT_TOO_LARGE']];
  for (const [input, code] of cases) assert.throws(() => analyzeText(input as string), (error: unknown) => error instanceof AtsScoreError && error.code === code && error.guidance.length > 0);
  assert.equal(analyzeText('é'.repeat(MAX_INPUT_BYTES / 2)).score >= 0, true);
  assert.throws(() => analyzeText('é'.repeat(MAX_INPUT_BYTES / 2 + 1)), { code: 'INPUT_TOO_LARGE' });
});
