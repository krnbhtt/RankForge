import { type NextRequest, NextResponse } from 'next/server';
import { HtmlPasteInputSchema, UserInputError, toRankForgeError } from '@rankforge/schema';
import { artifactKeys, createStorageFromEnv } from '@rankforge/storage';
import { getWebAuditStore } from '@/lib/audit-store';
import { enqueueAuditTask } from '@/lib/task-queue';

const AUDIT_ID = /^[a-zA-Z0-9_-]+$/;
const PASTE_ALLOWED_STATUSES = new Set(['blocked', 'failed']);

function fail(err: unknown, status: number) {
  const typed = toRankForgeError(err);
  return NextResponse.json({ success: false, error: typed.toAuditError() }, { status });
}

/** HTML-paste fallback (spec F1.3): re-runs capture for a blocked audit using the pasted page source. */
export async function POST(req: NextRequest, { params }: { params: { auditId: string } }) {
  try {
    const { auditId } = params;
    if (!AUDIT_ID.test(auditId)) {
      return fail(new UserInputError('That audit link is not valid.', 'Start a new audit from the Start screen.'), 400);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(new UserInputError('The request body was not valid JSON.', 'Paste the page HTML and try again.'), 400);
    }
    const parsed = HtmlPasteInputSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'The pasted HTML was not accepted.';
      return fail(new UserInputError(message, 'Copy the full page source and paste it again.'), 400);
    }

    const store = getWebAuditStore();
    const audit = await store.getAudit(auditId);
    if (!audit) {
      return fail(
        new UserInputError('We could not find that audit.', 'Return to the Start screen and begin a new audit.'),
        404
      );
    }
    if (!PASTE_ALLOWED_STATUSES.has(audit.status)) {
      return fail(
        new UserInputError(
          'HTML can only be pasted when the page could not be loaded.',
          'Wait for the current run to finish, or start a new audit.'
        ),
        409
      );
    }

    await createStorageFromEnv().put(artifactKeys.pastedHtml(auditId), parsed.data.html, 'text/html; charset=utf-8');
    await store.updateAudit(auditId, {
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      error: undefined,
    });

    enqueueAuditTask({
      auditId,
      targetUrl: audit.targetUrl,
      keyword: audit.keyword,
      imageConsent: audit.imageConsent,
      fastMode: false,
    });

    return NextResponse.json({ success: true, auditId, status: 'queued' }, { status: 202 });
  } catch (err) {
    return fail(err, 500);
  }
}
