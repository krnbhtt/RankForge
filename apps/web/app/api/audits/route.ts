import { type NextRequest, NextResponse } from 'next/server';
import {
  AuditCreateInputSchema,
  AuditCreateResponseSchema,
  AuditErrorSchema,
} from '@rankforge/schema';
import { validateTargetUrl } from '@rankforge/ssrf';
import { getWebAuditStore } from '@/lib/audit-store';
import { enqueueAuditTask } from '@/lib/task-queue';
import { auditLimiter } from '@/lib/rate-limit';

const CACHE_MAX_AGE_MS = 24 * 3600_000;
const TERMINAL = new Set(['complete', 'failed', 'blocked']);

/** Frees the concurrency slot once the audit reaches a final state, or after 20 minutes at the latest. */
function releaseWhenFinished(auditId: string): void {
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const audit = await getWebAuditStore().getAudit(auditId);
      if ((audit && TERMINAL.has(audit.status)) || Date.now() - started > 20 * 60_000) {
        auditLimiter.release(auditId);
        clearInterval(timer);
      }
    } catch {
      auditLimiter.release(auditId);
      clearInterval(timer);
    }
  }, 10_000);
  timer.unref?.();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseResult = AuditCreateInputSchema.safeParse(body);

    if (!parseResult.success) {
      const errorPayload = AuditErrorSchema.parse({
        code: 'UserInputError',
        message: 'Invalid audit creation input',
        recoveryAction: 'Please supply a valid HTTP or HTTPS product page URL',
        details: { issues: parseResult.error.issues },
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: false, error: errorPayload }, { status: 400 });
    }

    const { url, keyword, imageConsent, userId, refresh } = parseResult.data;

    // SSRF Validation
    const ssrfResult = await validateTargetUrl(url);
    if (!ssrfResult.isValid) {
      const errorPayload = AuditErrorSchema.parse({
        code: 'UserInputError',
        message: ssrfResult.error || 'The requested URL failed SSRF security verification.',
        recoveryAction: 'Provide a publicly accessible e-commerce product URL.',
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: false, error: errorPayload }, { status: 400 });
    }

    const store = getWebAuditStore();
    if (!refresh) {
      // A completed audit of the same page and keyword from the last 24 hours is reused (saves cost, and makes
      // prepared showcase audits open instantly).
      const cached = await store.findRecentComplete(url, keyword, CACHE_MAX_AGE_MS);
      if (cached) {
        return NextResponse.json(
          AuditCreateResponseSchema.parse({ success: true, auditId: cached.auditId, status: 'complete', createdAt: cached.createdAt, cached: true }),
          { status: 200 }
        );
      }
    }

    const auditId = crypto.randomUUID();
    const now = new Date().toISOString();
    const client = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0]?.trim() || 'local';
    const decision = auditLimiter.tryAcquire(client, auditId);
    if (!decision.allowed) {
      const error = AuditErrorSchema.parse({
        code: 'QuotaError',
        message: decision.reason === 'busy' ? 'The studio is running several audits right now.' : 'You have started several audits in a short time.',
        recoveryAction: `Wait about ${decision.retryAfterSeconds} seconds and try again.`,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: false, error }, { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds ?? 30) } });
    }

    // Persist initial audit record
    await store.createAudit({
      auditId,
      wsId: 'default',
      userId: userId || 'anonymous',
      targetUrl: url,
      keyword,
      keywordCandidates: [],
      imageConsent: Boolean(imageConsent),
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      platform: 'unknown',
      patchMode: 'static',
      stageTimings: {
        queued: now,
      },
      createdAt: now,
      updatedAt: now,
      totalCostInr: 0,
    });

    releaseWhenFinished(auditId);
    // Enqueue task asynchronously (unawaited)
    enqueueAuditTask({
      auditId,
      targetUrl: url,
      keyword,
      imageConsent: Boolean(imageConsent),
      fastMode: false,
    });

    const responsePayload = AuditCreateResponseSchema.parse({
      success: true,
      auditId,
      status: 'queued',
      createdAt: now,
    });

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (err) {
    const error = err as Error;
    const errorPayload = AuditErrorSchema.parse({
      code: 'InternalError',
      message: error.message || 'An error occurred while creating the audit',
      recoveryAction: 'Please retry creating the audit job',
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ success: false, error: errorPayload }, { status: 500 });
  }
}
