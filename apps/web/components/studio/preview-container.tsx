'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditError, AuditStatus } from '@rankforge/schema';

export const PREVIEW_ORIGIN = process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? 'http://localhost:4060';

export interface StudioPreviewContainerProps {
  auditId: string;
  status: AuditStatus;
  stage?: string;
  targetUrl?: string;
  error?: AuditError;
}

type Viewport = 'desktop' | 'mobile';

const VIEWPORT_WIDTH: Record<Viewport, number> = { desktop: 1440, mobile: 390 };

const CAPTURE_STEP_LABEL: Record<string, string> = {
  init: 'Getting ready',
  scrape_target: 'Opening your page',
  render_page: 'Loading your page in a browser',
  proxy_assets: 'Saving styles, scripts and images',
  extract_page: 'Reading the page content',
};

const PREVIEW_READY_STATUSES = new Set<AuditStatus>([
  'captured',
  'awaiting_keyword',
  'discovering',
  'competitors',
  'analysing',
  'analysed',
  'blueprinted',
  'rebuilding',
  'verifying',
  'complete',
]);

export function previewUrl(auditId: string, variant: 'current' | 'optimised', origin = PREVIEW_ORIGIN): string {
  return `${origin.replace(/\/$/, '')}/preview/${encodeURIComponent(auditId)}/${variant}/`;
}

function CaptureSkeleton({ stage }: { stage?: string }) {
  const label = CAPTURE_STEP_LABEL[stage ?? 'init'] ?? 'Rebuilding your page';
  return (
    <div
      role="status"
      aria-live="polite"
      className="h-full p-8 space-y-6 animate-pulse"
    >
      <div className="h-6 rounded bg-slate-200 dark:bg-slate-800 w-2/3" />
      <div className="h-64 rounded-lg bg-slate-200 dark:bg-slate-800" />
      <div className="space-y-3">
        <div className="h-4 rounded bg-slate-200 dark:bg-slate-800 w-3/4" />
        <div className="h-4 rounded bg-slate-200 dark:bg-slate-800 w-1/2" />
      </div>
      <p className="text-sm text-center text-slate-600 dark:text-slate-400">{label}…</p>
    </div>
  );
}

function HtmlPasteForm({ auditId }: { auditId: string }) {
  const [html, setHtml] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('sending');
    setProblem(null);
    try {
      const res = await fetch(`/api/audits/${encodeURIComponent(auditId)}/html`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      const json = (await res.json()) as { success: boolean; error?: AuditError };
      if (!res.ok || !json.success) {
        setProblem(json.error ? `${json.error.message} ${json.error.recoveryAction}` : 'Something went wrong. Please try again.');
        setState('idle');
        return;
      }
      setState('sent');
    } catch {
      setProblem('We could not reach the server. Check your connection and try again.');
      setState('idle');
    }
  };

  if (state === 'sent') {
    return (
      <p role="status" className="text-sm text-slate-700 dark:text-slate-300">
        Thanks. We are rebuilding your page from the HTML you pasted.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      <label htmlFor="paste-html" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
        Paste the page source
      </label>
      <p id="paste-help" className="text-xs text-slate-600 dark:text-slate-400">
        Open the product page, press Ctrl+U (or Cmd+Option+U), select all, copy, and paste it here.
      </p>
      <textarea
        id="paste-html"
        aria-describedby="paste-help"
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        rows={6}
        spellCheck={false}
        className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={state === 'sending' || html.trim().length === 0}
        className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {state === 'sending' ? 'Sending…' : 'Use this HTML'}
      </button>
    </form>
  );
}

function ProblemCard({ auditId, status, error }: { auditId: string; status: AuditStatus; error?: AuditError }) {
  const blocked = status === 'blocked';
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-4 text-center">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {blocked ? 'This store would not let us open the page' : 'We could not rebuild this page'}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {error?.message ?? 'Something went wrong while opening the page.'}
        </p>
        {blocked ? (
          <HtmlPasteForm auditId={auditId} />
        ) : (
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            {error?.recoveryAction ?? 'Start a new audit to try again.'}
          </p>
        )}
      </div>
    </div>
  );
}

function PreviewFrame({
  title,
  src,
  viewport,
  frameRef,
}: {
  title: string;
  src: string;
  viewport: Viewport;
  frameRef: React.RefObject<HTMLIFrameElement>;
}) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frameWidth = VIEWPORT_WIDTH[viewport];
  const scale = box.width > 0 ? Math.min(1, box.width / frameWidth) : 1;
  const scaledWidth = frameWidth * scale;

  return (
    <div ref={paneRef} className="relative h-full w-full overflow-hidden bg-white dark:bg-slate-900">
      <iframe
        ref={frameRef}
        title={title}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        loading="lazy"
        style={{
          width: frameWidth,
          height: scale > 0 ? box.height / scale : 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          marginLeft: Math.max(0, (box.width - scaledWidth) / 2),
          border: 0,
        }}
      />
    </div>
  );
}

export function StudioPreviewContainer({ auditId, status, stage, targetUrl, error }: StudioPreviewContainerProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const leftRef = useRef<HTMLIFrameElement | null>(null);
  const rightRef = useRef<HTMLIFrameElement | null>(null);

  const onMessage = useCallback((event: MessageEvent) => {
    if (event.origin !== new URL(PREVIEW_ORIGIN).origin) return;
    const data = event.data as { source?: string; type?: string; ratio?: number } | null;
    if (!data || data.source !== 'rf-preview' || data.type !== 'scroll' || typeof data.ratio !== 'number') return;
    const from = event.source;
    const target =
      from === leftRef.current?.contentWindow ? rightRef.current : from === rightRef.current?.contentWindow ? leftRef.current : null;
    target?.contentWindow?.postMessage({ source: 'rf-studio', type: 'scroll-to', ratio: data.ratio }, PREVIEW_ORIGIN);
  }, []);

  useEffect(() => {
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onMessage]);

  const capturing = (status === 'queued' || status === 'capturing') && !(status === 'capturing' && stage === 'extract_page');
  const problem = status === 'blocked' || status === 'failed';
  // The snapshot is stored before extraction finishes, so the page can be shown one step early.
  const ready = PREVIEW_READY_STATUSES.has(status) || (status === 'capturing' && stage === 'extract_page');

  return (
    <div className="flex flex-col flex-1 h-full min-w-0 bg-slate-100 dark:bg-slate-950 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800 text-xs">
        <div className="min-w-0 flex items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-slate-200">Your page</span>
          {targetUrl && (
            <span className="truncate max-w-[240px] font-mono text-slate-500 hidden sm:inline" title={targetUrl}>
              {targetUrl}
            </span>
          )}
        </div>

        <div role="group" aria-label="Preview size" className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
          {(['desktop', 'mobile'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewport === mode}
              onClick={() => setViewport(mode)}
              className={`min-h-[36px] rounded-md px-3 py-1.5 font-medium transition-colors ${
                viewport === mode
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {mode === 'desktop' ? 'Desktop' : 'Mobile'}
            </button>
          ))}
        </div>

        <span className="font-semibold text-slate-800 dark:text-slate-200">Optimised version</span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
        <section aria-label="Current page" className="min-h-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          {capturing && <CaptureSkeleton stage={stage} />}
          {problem && <ProblemCard auditId={auditId} status={status} error={error} />}
          {ready && (
            <PreviewFrame
              title="Your current product page"
              src={previewUrl(auditId, 'current')}
              viewport={viewport}
              frameRef={leftRef as React.RefObject<HTMLIFrameElement>}
            />
          )}
        </section>

        <section aria-label="Optimised page" className="min-h-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          {ready ? (
            <PreviewFrame
              title="The optimised product page"
              src={previewUrl(auditId, 'optimised')}
              viewport={viewport}
              frameRef={rightRef as React.RefObject<HTMLIFrameElement>}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-8 text-center text-sm text-slate-600 dark:text-slate-400">
              {problem
                ? 'The optimised page appears here once your page is open.'
                : 'The optimised page will be built here after we have a copy of your page.'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
