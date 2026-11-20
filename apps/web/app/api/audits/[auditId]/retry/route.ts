import { type NextRequest, NextResponse } from 'next/server';
import { UserInputError, toRankForgeError } from '@rankforge/schema';
import { getWebAuditStore } from '@/lib/audit-store';
import { enqueueAuditTask } from '@/lib/task-queue';

const AUDIT_ID = /^[a-zA-Z0-9_-]+$/;
/** An audit that has not changed for this long while still running is treated as abandoned (worker died). */
const STALE_MS = 3 * 60_000;

function fail(err: unknown, status: number) {
  return NextResponse.json({ success: false, error: toRankForgeError(err).toAuditError() }, { status });
}

/** Re-queues a failed or stalled audit; the worker resumes from the stages that already finished. */
export async function POST(_req: NextRequest, { params }: { params: { auditId: string } }) {
  try {
    const { auditId } = params;
    if (!AUDIT_ID.test(auditId)) return fail(new UserInputError('That audit link is not valid.', 'Start a new audit.'), 400);
    const store = getWebAuditStore();
    const audit = await store.getAudit(auditId);
    if (!audit) return fail(new UserInputError('We could not find that audit.', 'Return to the Start screen and begin a new audit.'), 404);

    const stale = Date.now() - Date.parse(audit.updatedAt) > STALE_MS;
    const retriable = audit.status === 'failed' || (!['complete', 'blocked'].includes(audit.status) && stale);
    if (!retriable) {
      return fail(new UserInputError('This audit is still running or has finished.', 'Wait for it to finish, or start a new audit.'), 409);
    }

    await store.updateAudit(auditId, { status: 'queued', stage: 'init', progressPercent: 5, error: undefined });
    enqueueAuditTask({
      auditId,
      targetUrl: audit.targetUrl,
      keyword: audit.keyword,
      imageConsent: audit.imageConsent,
      fastMode: false,
      resume: true,
    });
    return NextResponse.json({ success: true, auditId, status: 'queued' }, { status: 202 });
  } catch (err) {
    return fail(err, 500);
  }
}
