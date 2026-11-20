import { type NextRequest } from 'next/server';
import { getWebAuditStore } from '@/lib/audit-store';

export async function GET(
  _req: NextRequest,
  { params }: { params: { auditId: string } }
) {
  const { auditId } = params;
  const store = getWebAuditStore();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      const sendEvent = (event: string, data: any) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          isClosed = true;
        }
      };

      // 1. Send initial snapshot immediately
      const initialComposite = await store.readComposite(auditId);
      if (initialComposite) {
        sendEvent('audit_update', initialComposite);
        if (
          initialComposite.audit.status === 'complete' ||
          initialComposite.audit.status === 'failed'
        ) {
          sendEvent('done', { status: initialComposite.audit.status });
          controller.close();
          isClosed = true;
          return;
        }
      }

      // 2. Subscribe to change events
      const unsubscribe = store.onAuditChange(auditId, async (record: any) => {
        if (isClosed) return;
        const full = await store.readComposite(auditId);
        if (full) {
          sendEvent('audit_update', full);
        } else {
          sendEvent('audit_update', { audit: record });
        }

        if (record.status === 'complete' || record.status === 'failed') {
          sendEvent('done', { status: record.status });
          cleanup();
          try {
            controller.close();
          } catch {}
          isClosed = true;
        }
      });

      // 3. Heartbeat ping every 15 seconds
      const pingInterval = setInterval(() => {
        if (isClosed) {
          clearInterval(pingInterval);
          return;
        }
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          isClosed = true;
          clearInterval(pingInterval);
        }
      }, 15000);

      const cleanup = () => {
        unsubscribe();
        clearInterval(pingInterval);
      };

      // Handle stream cancellation (e.g. user navigates away)
      _req.signal.addEventListener('abort', () => {
        isClosed = true;
        cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
