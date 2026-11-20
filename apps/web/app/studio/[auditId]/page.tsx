'use client';

import React from 'react';
import Link from 'next/link';
import { useAuditStream } from '@/hooks/use-audit-stream';
import { StudioTimeline } from '@/components/studio/timeline';
import { StudioPreviewContainer } from '@/components/studio/preview-container';
import { StudioDrawer } from '@/components/studio/drawer';
import { useAuditReport } from '@/hooks/use-audit-report';

export default function StudioPage({ params }: { params: { auditId: string } }) {
  const { auditId } = params;
  const {
    audit,
    competitors,
    findings,
    queries,
    blueprint,
    patches,
    status,
    stage,
    progressPercent,
    elapsedSeconds,
  } = useAuditStream(auditId);
  const bundle = useAuditReport(auditId, status);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans">
      {/* Top Application Bar */}
      <nav className="h-14 border-b border-slate-200 bg-white px-4 flex items-center justify-between dark:border-slate-800 dark:bg-slate-900 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-slate-900 dark:text-white hover:opacity-80 transition text-base"
          >
            <span className="w-7 h-7 rounded bg-blue-600 text-white flex items-center justify-center font-black text-sm">
              RF
            </span>
            <span>RankForge AI</span>
          </Link>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span className="text-xs text-slate-500 font-mono truncate max-w-xs hidden sm:inline">
            Audit ID: {auditId}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {audit?.targetUrl && (
            <a
              href={audit.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white flex items-center gap-1 hidden md:flex min-h-[36px]"
            >
              <span>Target Storefront</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition min-h-[36px] flex items-center"
          >
            New Audit
          </Link>
        </div>
      </nav>

      {/* Slim Live Progress Stepper Timeline */}
      <StudioTimeline
        status={status}
        stage={stage}
        progressPercent={progressPercent}
        elapsedSeconds={elapsedSeconds}
      />

      {/* Main Studio Area: Split View + Collapsible Right Drawer */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Synced Bi-Directional Split View Preview */}
        <StudioPreviewContainer
          auditId={auditId}
          status={status}
          stage={stage}
          targetUrl={audit?.targetUrl}
          error={audit?.error}
          optimisedVersion={`${patches.filter((p) => p.status === 'applied').length}:${status}`}
        />

        {/* Collapsible 6-Tab Insights Drawer */}
        <StudioDrawer
          audit={audit}
          competitors={competitors}
          findings={findings}
          queries={queries}
          blueprint={blueprint}
          patches={patches}
          bundle={bundle}
        />
      </div>
    </div>
  );
}
