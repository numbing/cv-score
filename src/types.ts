export type InputFormat = 'text' | 'pdf' | 'docx';
export type CategoryId = 'machine-readability' | 'sections' | 'contact' | 'experience' | 'readability';
export type CheckStatus = 'pass' | 'partial' | 'fail' | 'unassessed';
export type TipPriority = 'high' | 'medium' | 'low';

export interface ScoreCheck {
  id: string;
  category: CategoryId;
  title: string;
  status: CheckStatus;
  earnedPoints: number;
  maxPoints: number;
  message: string;
}

export interface ScoreCategory {
  id: CategoryId;
  title: string;
  earnedPoints: number;
  /** Points that could actually be assessed for this input. */
  availablePoints: number;
  /** Full category weight, including unassessed checks. */
  maxPoints: number;
}

export interface ImprovementTip {
  checkId: string;
  priority: TipPriority;
  title: string;
  explanation: string;
  recommendation: string;
  /** Illustrative placeholders, never invented claims about the applicant. */
  example: string;
}

export interface AnalysisResult {
  /** Rounded earned / assessable points × 100; not an employer's ATS score. */
  score: number;
  source: InputFormat;
  rubricVersion: string;
  categories: ScoreCategory[];
  checks: ScoreCheck[];
  tips: ImprovementTip[];
  warnings: string[];
  coverage: {
    assessedPoints: number;
    totalPoints: number;
    unassessedCheckIds: string[];
  };
  statistics: {
    wordCount: number;
    descriptionStatementCount: number;
    actionVerbStatementCount: number;
    quantifiedStatementCount: number;
  };
  attribution: { name: string; url: string };
}

export type AtsScoreErrorCode =
  | 'INVALID_INPUT'
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_NOT_FOUND'
  | 'FILE_READ_ERROR'
  | 'CORRUPT_DOCUMENT'
  | 'ENCRYPTED_DOCUMENT'
  | 'NO_EXTRACTABLE_TEXT';
