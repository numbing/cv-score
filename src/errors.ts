import type { AtsScoreErrorCode } from './types';

/** Expected input failures with a stable code and actionable guidance. */
export class AtsScoreError extends Error {
  readonly code: AtsScoreErrorCode;
  readonly guidance: string;

  constructor(code: AtsScoreErrorCode, message: string, guidance: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AtsScoreError';
    this.code = code;
    this.guidance = guidance;
  }
}
