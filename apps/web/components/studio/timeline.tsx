'use client';

import React from 'react';
import type { AuditStatus } from '@rankforge/schema';

export interface StudioTimelineProps {
  status: AuditStatus;
  stage: string;
  progressPercent: number;
  elapsedSeconds: number;
}

interface StageStep {
  id: AuditStatus;
  label: string;
  shortLabel: string;
}

const STAGES: StageStep[] = [
  { id: 'queued', label: 'Queued', shortLabel: 'Queue' },
  { id: 'capturing', label: 'Capturing', shortLabel: 'Capture' },
  { id: 'captured', label: 'Captured', shortLabel: 'DOM' },
  { id: 'awaiting_keyword', label: 'Keywords', shortLabel: 'Keys' },
  { id: 'discovering', label: 'Discovering', shortLabel: 'SERP' },
  { id: 'competitors', label: 'Competitors', shortLabel: 'Comps' },
  { id: 'analysing', label: 'Analysing', shortLabel: 'Analyse' },
  { id: 'analysed', label: 'Analysed', shortLabel: 'Gaps' },
  { id: 'blueprinted', label: 'Blueprinted', shortLabel: 'Plan' },
  { id: 'rebuilding', label: 'Rebuilding', shortLabel: 'Rebuild' },
  { id: 'verifying', label: 'Verifying', shortLabel: 'Verify' },
  { id: 'complete', label: 'Complete', shortLabel: 'Done' },
];

const STAGE_TO_STATUS_MAP: Record<string, AuditStatus> = {
  init: 'queued',
  scrape_target: 'capturing',
  detect_platform: 'captured',
  keyword_resolution: 'awaiting_keyword',
  discover_competitors: 'discovering',
  crawl_competitors: 'competitors',
  gap_analysis: 'analysing',
  gap_synthesis: 'analysed',
  cro_playbook: 'blueprinted',
  generate_patches: 'rebuilding',
  verify_dom_and_scores: 'verifying',
  finalize: 'complete',
};

export function StudioTimeline({
  status,
  stage,
  progressPercent,
  elapsedSeconds,
}: StudioTimelineProps) {
  const isFailed = status === 'failed';
  const isBlocked = status === 'blocked';
  const isComplete = status === 'complete';

  // Compute active stepper index without resetting to 0 on blocked/failed
  const currentStepIndex = STAGES.findIndex((s) => s.id === status);
  let activeIndex = 0;
  if (currentStepIndex >= 0) {
    activeIndex = currentStepIndex;
  } else if (stage && STAGE_TO_STATUS_MAP[stage]) {
    const mappedIdx = STAGES.findIndex((s) => s.id === STAGE_TO_STATUS_MAP[stage]);
    activeIndex = mappedIdx >= 0 ? mappedIdx : 0;
  } else if (progressPercent > 0) {
    activeIndex = Math.min(
      STAGES.length - 1,
      Math.max(0, Math.floor((progressPercent / 100) * (STAGES.length - 1)))
    );
  }

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}s`;
  };

  const getStatusDescription = () => {
    switch (status) {
      case 'queued':
        return 'Task queued for worker initialization...';
      case 'capturing':
        return 'Rendering target URL in Playwright Chromium...';
      case 'captured':
        return 'DOM AST extracted and platform detected.';
      case 'awaiting_keyword':
        return 'Resolving high-intent product keyword candidates...';
      case 'discovering':
        return 'Querying Google SERP grounding for top 10 competitors...';
      case 'competitors':
        return 'Parallel crawling top 10 competitor product storefronts...';
      case 'analysing':
        return 'Executing SEO entity & CRO conversion gap audits...';
      case 'analysed':
        return 'Gap synthesis complete. Computing baseline scorecards...';
      case 'blueprinted':
        return 'CRO playbook & section rebuild architecture synthesized.';
      case 'rebuilding':
        return 'Streaming section patches live into sandbox DOM...';
      case 'verifying':
        return 'Verifying DOM layout integrity, CWV, and score uplift...';
      case 'complete':
        return 'Audit complete. Optimized storefront and before/after ready.';
      case 'blocked':
        return 'Site blocked crawler access — paste HTML to continue';
      case 'failed':
        return 'Audit execution failed';
      default:
        return `Pipeline step: ${stage}`;
    }
  };

  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-2">
        {/* Top Bar: Title, Status Message, Elapsed Timer */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                isComplete
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                  : isFailed
                  ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
                  : isBlocked
                  ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
                  : 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800'
              }`}
            >
              {!isComplete && !isFailed && !isBlocked && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping mr-1.5" />
              )}
              {isBlocked && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5" />
              )}
              {isFailed && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5" />
              )}
              {status.toUpperCase()}
            </span>
            <span className="text-slate-600 dark:text-slate-300 truncate max-w-md md:max-w-xl">
              {getStatusDescription()}
            </span>
          </div>

          <div className="flex items-center gap-4 text-slate-500 dark:text-slate-400 font-mono">
            <span>Elapsed: {formatTimer(elapsedSeconds)}</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {progressPercent}%
            </span>
          </div>
        </div>

        {/* 12-Step Progress Stepper */}
        <div className="relative pt-2 pb-1">
          {/* Background Track */}
          <div className="absolute top-1/2 left-0 right-0 h-0.5 -translate-y-1/2 bg-slate-200 dark:bg-slate-800" />
          {/* Active Fill Track */}
          <div
            className={`absolute top-1/2 left-0 h-0.5 -translate-y-1/2 transition-all duration-300 ${
              isFailed
                ? 'bg-red-500'
                : isBlocked
                ? 'bg-amber-500'
                : isComplete
                ? 'bg-emerald-500'
                : 'bg-blue-600'
            }`}
            style={{ width: `${progressPercent}%` }}
          />

          {/* Stepper Nodes */}
          <div className="relative flex justify-between">
            {STAGES.map((step, idx) => {
              const isPast = idx < activeIndex;
              const isCurrent = idx === activeIndex;

              let nodeClass = 'bg-white border-2 border-slate-300 dark:bg-slate-900 dark:border-slate-700';
              let labelClass = 'text-slate-400 dark:text-slate-600';

              if (isPast) {
                nodeClass = 'bg-blue-600 text-white';
                labelClass = 'text-slate-600 dark:text-slate-300';
              } else if (isCurrent) {
                if (isFailed) {
                  nodeClass = 'bg-red-600 ring-4 ring-red-100 dark:ring-red-900/60 text-white';
                  labelClass = 'font-semibold text-red-600 dark:text-red-400';
                } else if (isBlocked) {
                  nodeClass = 'bg-amber-500 ring-4 ring-amber-100 dark:ring-amber-900/60 text-white';
                  labelClass = 'font-semibold text-amber-600 dark:text-amber-400';
                } else {
                  nodeClass = 'bg-blue-600 ring-4 ring-blue-100 dark:ring-blue-900/60 text-white';
                  labelClass = 'font-semibold text-blue-600 dark:text-blue-400';
                }
              }

              return (
                <div key={step.id} className="flex flex-col items-center group">
                  <div
                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all ${nodeClass}`}
                  >
                    {isPast && (
                      <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                  <span
                    className={`text-[10px] mt-1 select-none hidden md:block ${labelClass}`}
                  >
                    {step.shortLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
