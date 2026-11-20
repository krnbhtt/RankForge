import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Runtime configuration for the browser. NEXT_PUBLIC_ variables are fixed at build time, but the preview origin is only
 * known when the services are deployed, so the studio asks for it here.
 */
export function GET() {
  const previewOrigin = process.env.PREVIEW_ORIGIN ?? process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? 'http://localhost:4060';
  return NextResponse.json({ previewOrigin });
}
