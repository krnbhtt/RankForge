/**
 * In-memory limits for the public audit endpoint (specification: rate limits and per-audit spending caps).
 * Per client: a token bucket. Per instance: a cap on audits that are still running. Cloud Run keeps several
 * instances, so these are a first line of defence; the worker's per-audit cost cap is the hard limit.
 */
export interface RateLimitOptions {
  /** Bucket size, and also the refill amount per window. */
  burst: number;
  windowMs: number;
  maxConcurrent: number;
  now?: () => number;
}

export interface RateDecision {
  allowed: boolean;
  reason?: 'rate' | 'busy';
  retryAfterSeconds?: number;
}

export class AuditRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();
  private readonly running = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Consumes a token for `client` and reserves a running slot for `auditId`. */
  tryAcquire(client: string, auditId: string): RateDecision {
    const { burst, windowMs, maxConcurrent } = this.options;
    const t = this.now();
    const bucket = this.buckets.get(client) ?? { tokens: burst, updated: t };
    const refill = ((t - bucket.updated) / windowMs) * burst;
    bucket.tokens = Math.min(burst, bucket.tokens + refill);
    bucket.updated = t;
    if (bucket.tokens < 1) {
      this.buckets.set(client, bucket);
      return { allowed: false, reason: 'rate', retryAfterSeconds: Math.ceil(((1 - bucket.tokens) / burst) * (windowMs / 1000)) };
    }
    if (this.running.size >= maxConcurrent) {
      this.buckets.set(client, bucket);
      return { allowed: false, reason: 'busy', retryAfterSeconds: 30 };
    }
    bucket.tokens -= 1;
    this.buckets.set(client, bucket);
    this.running.add(auditId);
    return { allowed: true };
  }

  /** Frees the running slot when an audit finishes or its dispatch fails. */
  release(auditId: string): void {
    this.running.delete(auditId);
  }

  get runningCount(): number {
    return this.running.size;
  }
}

export const auditLimiter = new AuditRateLimiter({
  burst: Number(process.env.RATE_LIMIT_BURST ?? 5),
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 600_000),
  maxConcurrent: Number(process.env.MAX_CONCURRENT_AUDITS ?? 3),
});
