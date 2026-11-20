import type { AuditError } from './index.js';

export type AuditErrorCode = AuditError['code'];

/** Base class for every typed pipeline error; carries a plain-language recovery action for the UI. */
export class RankForgeError extends Error {
  constructor(
    readonly code: AuditErrorCode,
    message: string,
    readonly recoveryAction: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = code;
  }

  toAuditError(now: Date = new Date()): AuditError {
    return {
      code: this.code,
      message: this.message,
      recoveryAction: this.recoveryAction,
      details: this.details,
      timestamp: now.toISOString(),
    };
  }
}

export class UserInputError extends RankForgeError {
  constructor(
    message: string,
    recoveryAction = 'Check the product URL and try again.',
    details?: Record<string, unknown>
  ) {
    super('UserInputError', message, recoveryAction, details);
  }
}

export class BlockedSiteError extends RankForgeError {
  constructor(
    message: string,
    readonly reason: 'http_status' | 'challenge_page' | 'empty_body' | 'timeout',
    details?: Record<string, unknown>
  ) {
    super('BlockedSiteError', message, 'Paste the page HTML instead so we can continue.', {
      reason,
      ...details,
    });
  }
}

export class UpstreamModelError extends RankForgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('UpstreamModelError', message, 'Try again in a minute.', details);
  }
}

export class QuotaError extends RankForgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('QuotaError', message, 'Wait a few minutes before starting another audit.', details);
  }
}

export class PatchError extends RankForgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('PatchError', message, 'Re-run the audit; that section was skipped.', details);
  }
}

export class InternalError extends RankForgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('InternalError', message, 'Try again. If it keeps failing, contact support.', details);
  }
}

export function toRankForgeError(err: unknown): RankForgeError {
  if (err instanceof RankForgeError) return err;
  return new InternalError(err instanceof Error ? err.message : String(err));
}
