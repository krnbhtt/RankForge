import { NextResponse } from 'next/server';
import { serviceAuthHeaders } from '@/lib/service-auth';

export const dynamic = 'force-dynamic';

/**
 * Whether today's search and AI credits are available. Read from the worker (which asks the free SERP account endpoint
 * and remembers which models ran out of quota). If the worker cannot be reached the answer is "unknown", never "out".
 */
export async function GET() {
  const workerUrl = process.env.WORKER_URL ?? 'http://localhost:4050';
  try {
    const res = await fetch(`${workerUrl}/internal/quota`, { headers: await serviceAuthHeaders(workerUrl), signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ known: false });
    const q = (await res.json()) as { serp: { configured: boolean; remainingSearches: number | null; ok: boolean }; geminiOk: boolean; geminiConfigured: boolean };
    return NextResponse.json({
      known: true,
      serpOk: q.serp.ok,
      serpRemaining: q.serp.remainingSearches,
      aiOk: q.geminiOk,
      aiConfigured: q.geminiConfigured,
    });
  } catch {
    return NextResponse.json({ known: false });
  }
}
