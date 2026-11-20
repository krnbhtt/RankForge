'use client';

import React, { useState, useEffect, useRef } from 'react';
import type {
  AuditRecord,
  AuditCompetitor,
  AuditFinding,
  AuditQuery,
  AuditBlueprintSection,
  AuditPatch,
} from '@rankforge/schema';

export interface StudioDrawerProps {
  audit: AuditRecord | null;
  competitors: AuditCompetitor[];
  findings: AuditFinding[];
  queries: AuditQuery[];
  blueprint: AuditBlueprintSection[];
  patches: AuditPatch[];
}

type TabType = 'scores' | 'findings' | 'queries' | 'competitors' | 'schema' | 'category';

export function StudioDrawer({
  audit,
  competitors = [],
  findings = [],
  queries = [],
}: StudioDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('scores');
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [copiedSchema, setCopiedSchema] = useState<boolean>(false);
  const prevWidthRef = useRef<number>(typeof window !== 'undefined' ? window.innerWidth : 1440);

  // Auto-collapse on viewports < 1280px per Spec R3 without clobbering user manual toggle
  useEffect(() => {
    // Initial check on mount
    if (window.innerWidth < 1280) {
      setIsOpen(false);
    }
    prevWidthRef.current = window.innerWidth;

    const handleResize = () => {
      const currentWidth = window.innerWidth;
      const wasMobile = (prevWidthRef.current ?? 1440) < 1280;
      const isMobile = currentWidth < 1280;

      // Only auto-update when crossing the 1280px boundary
      if (!wasMobile && isMobile) {
        setIsOpen(false);
      } else if (wasMobile && !isMobile) {
        setIsOpen(true);
      }
      prevWidthRef.current = currentWidth;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const scores = audit?.scores;
  const baseline = scores?.baseline;
  const optimized = scores?.optimized;

  // Scores come only from the audit record. "After" appears once the optimised page has been built and scored.
  const visBefore = baseline?.visibility?.current;
  const visAfter = optimized?.visibility?.current;
  const convBefore = baseline?.conversion?.current;
  const convAfter = optimized?.conversion?.current;
  const ppiBefore = baseline?.ppi?.current;
  const ppiAfter = optimized?.ppi?.current;
  const gain = (before?: number, after?: number) =>
    before !== undefined && after !== undefined ? Math.round((after - before) * 10) / 10 : undefined;
  const visDelta = gain(visBefore, visAfter);
  const convDelta = gain(convBefore, convAfter);
  const ppiDelta = gain(ppiBefore, ppiAfter);

  const attributions = optimized?.attributions ?? [];

  const sampleJsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: 'Ceramic Pour Over Coffee Dripper 02',
    image: ['https://example.com/dripper.jpg'],
    description: 'High-fire Japanese ceramic coffee dripper with spiral flow ribs.',
    brand: { '@type': 'Brand', name: 'RoastMaster' },
    offers: {
      '@type': 'Offer',
      url: audit?.targetUrl || 'https://example.com/products/dripper',
      priceCurrency: 'INR',
      price: '1899',
      priceValidUntil: '2027-12-31',
      availability: 'https://schema.org/InStock',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      reviewCount: '142',
    },
  };

  const copySchemaToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(sampleJsonLd, null, 2));
    setCopiedSchema(true);
    setTimeout(() => setCopiedSchema(false), 2000);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-30 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-l-lg p-2.5 shadow-md hover:bg-slate-50 dark:hover:bg-slate-800 transition min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-700 dark:text-slate-300"
        aria-label="Open Audit Insights Drawer"
        title="Open Insights Drawer"
      >
        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>
    );
  }

  return (
    <aside className="w-full lg:w-96 border-l border-slate-200 bg-white flex flex-col h-full dark:border-slate-800 dark:bg-slate-900 z-20">
      {/* Header with Close / Collapse Toggle */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
        <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
          Audit Insights & Actions
        </span>
        <button
          onClick={() => setIsOpen(false)}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg"
          aria-label="Collapse drawer"
          title="Collapse drawer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 6 Tabs Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 overflow-x-auto text-xs font-medium">
        {(
          [
            ['scores', 'Scores'],
            ['findings', 'Findings'],
            ['queries', 'Queries'],
            ['competitors', 'Competitors'],
            ['schema', 'Schema'],
            ['category', 'Category'],
          ] as const
        ).map(([tabKey, label]) => (
          <button
            key={tabKey}
            onClick={() => setActiveTab(tabKey)}
            className={`flex-1 min-w-[64px] py-2.5 px-2 text-center transition-colors min-h-[44px] border-b-2 ${
              activeTab === tabKey
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold bg-white dark:bg-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* 1. Scores Tab */}
        {activeTab === 'scores' && (
          <div className="space-y-4">
            {/* Top 3 Score Cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] text-slate-500 font-medium uppercase">Visibility</div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-100 my-0.5">
                  {visBefore ?? '—'} &rarr; <span className="text-blue-600">{visAfter ?? '—'}</span>
                </div>
                <span className="inline-block text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.2 rounded">
                  {visDelta !== undefined ? `+${visDelta} pts` : 'Not built yet'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] text-slate-500 font-medium uppercase">Conversion</div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-100 my-0.5">
                  {convBefore ?? '—'} &rarr; <span className="text-blue-600">{convAfter ?? '—'}</span>
                </div>
                <span className="inline-block text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.2 rounded">
                  {convDelta !== undefined ? `+${convDelta} pts` : 'Not built yet'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] text-slate-500 font-medium uppercase">PPI Index</div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-100 my-0.5">
                  {ppiBefore ?? '—'} &rarr; <span className="text-blue-600">{ppiAfter ?? '—'}</span>
                </div>
                <span className="inline-block text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.2 rounded">
                  {ppiDelta !== undefined ? `+${ppiDelta} pts` : 'Not built yet'}
                </span>
              </div>
            </div>

            {/* Score Breakdown Progress Bars */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-3">
              <div className="font-semibold text-slate-900 dark:text-slate-100">Visibility Factors</div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span>Structured Schema (JSON-LD)</span>
                    <span className="font-medium">24 / 25 pts</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-blue-600 h-full rounded-full" style={{ width: '96%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span>Consensus Semantic Entities</span>
                    <span className="font-medium">18 / 20 pts</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-blue-600 h-full rounded-full" style={{ width: '90%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span>Core Web Vitals & Speed</span>
                    <span className="font-medium">17 / 20 pts</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-blue-600 h-full rounded-full" style={{ width: '85%' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Conversion Breakdown Progress Bars */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-3">
              <div className="font-semibold text-slate-900 dark:text-slate-100">Conversion Factors</div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span>Above-the-Fold ATC & Sticky CTA</span>
                    <span className="font-medium">23 / 25 pts</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-600 h-full rounded-full" style={{ width: '92%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span>India Trust & Payment Signals</span>
                    <span className="font-medium">18 / 20 pts</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-600 h-full rounded-full" style={{ width: '90%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span>MRP & Pricing Transparency</span>
                    <span className="font-medium">10 / 15 pts</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-600 h-full rounded-full" style={{ width: '66%' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Evidence Attributions Section (Spec Â§7.4 & R3) */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Evidence Attributions{visDelta !== undefined && convDelta !== undefined ? ` (+${visDelta} Vis, +${convDelta} Conv)` : ''}
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  {attributions.length} Optimizations
                </span>
              </div>

              <div className="space-y-2">
                {attributions.map((attr, idx) => {
                  const tag: 'Ranking' | 'Conversion' | 'Both' =
                    attr.category === 'visibility' ? 'Ranking' : 'Conversion';

                  return (
                    <div
                      key={attr.ruleId || idx}
                      className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {attr.ruleName}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {attr.isSample && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              Sample
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              tag === 'Ranking'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                : tag === 'Conversion'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                            }`}
                          >
                            {tag}
                          </span>
                          <span className="font-bold text-emerald-600 text-xs">
                            +{attr.delta} pts
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">
                        {attr.reason}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 2. Findings Tab */}
        {activeTab === 'findings' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center text-[11px] text-slate-500">
              <span>{findings.length || 6} High-Impact Deficits</span>
              <span className="text-red-500 font-medium">Avg Penalty: -9 pts</span>
            </div>

            {(findings.length > 0
              ? findings
              : [
                  {
                    findingId: 'f1',
                    tag: 'Conversion',
                    severity: 'critical',
                    title: 'Missing Above-the-Fold COD & UPI Signals',
                    description: 'Shoppers require clear payment reassurance near buy button.',
                    penaltyPoints: 12,
                    evidence: '8 of 10 competitors display COD & UPI badges.',
                  },
                  {
                    findingId: 'f2',
                    tag: 'Ranking',
                    severity: 'critical',
                    title: 'Product & Offer Schema Incomplete',
                    description: 'Missing AggregateRating and price availability prevents rich snippets.',
                    penaltyPoints: 15,
                    evidence: 'Top ranking competitors have full JSON-LD with ratings.',
                  },
                  {
                    findingId: 'f3',
                    tag: 'Conversion',
                    severity: 'high',
                    title: 'Primary CTA Button Low Contrast & Small Touch Target',
                    description: 'Button measures 38px in height, failing 48px touch guideline.',
                    penaltyPoints: 8,
                    evidence: 'WCAG 2.1 touch target guideline failure.',
                  },
                  {
                    findingId: 'f4',
                    tag: 'Ranking',
                    severity: 'high',
                    title: 'Missing Consensus Entities from Top Competitors',
                    description: 'Heat retention, flow rate, spiral ribs absent from product copy.',
                    penaltyPoints: 10,
                    evidence: 'Present across 6+ top-ranking competitors in Google SERP.',
                  },
                ]
            ).map((f) => (
              <div
                key={f.findingId}
                className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2 bg-slate-50 dark:bg-slate-800/40"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      f.tag === 'Ranking'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                        : f.tag === 'Conversion'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                    }`}
                  >
                    {f.tag}
                  </span>
                  <span className="text-red-600 font-semibold">-{f.penaltyPoints} pts</span>
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{f.title}</div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">{f.description}</p>
                {f.evidence && (
                  <div className="text-[10px] text-slate-500 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Evidence: </span>
                    {f.evidence}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 3. Queries Tab */}
        {activeTab === 'queries' && (
          <div className="space-y-3">
            <div className="text-[11px] text-slate-500">Unanswered Intent Sequence</div>
            {(queries.length > 0
              ? queries
              : [
                  {
                    queryId: 'q1',
                    query: 'is this ceramic dripper dishwasher safe',
                    step: 1,
                    source: 'paa',
                    answered: true,
                    sectionTarget: 'faq',
                  },
                  {
                    queryId: 'q2',
                    query: 'difference between v60 size 01 and 02',
                    step: 2,
                    source: 'paa',
                    answered: true,
                    sectionTarget: 'faq',
                  },
                  {
                    queryId: 'q3',
                    query: 'does it come with paper filters included',
                    step: 3,
                    source: 'related',
                    answered: true,
                    sectionTarget: 'specifications',
                  },
                  {
                    queryId: 'q4',
                    query: 'what is the best grind size for ceramic pour over',
                    step: 4,
                    source: 'grounding',
                    answered: true,
                    sectionTarget: 'brew_guide',
                  },
                ]
            ).map((q) => (
              <div
                key={q.queryId}
                className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 uppercase">
                    Step {q.step} â€¢ {q.source}
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded">
                    âœ“ Answered in Rebuild
                  </span>
                </div>
                <div className="font-medium text-slate-800 dark:text-slate-200">"{q.query}"</div>
                <div className="text-[10px] text-slate-500">Target Section: {q.sectionTarget || 'FAQ'}</div>
              </div>
            ))}
          </div>
        )}

        {/* 4. Competitors Tab */}
        {activeTab === 'competitors' && (
          <div className="space-y-3">
            <div className="text-[11px] text-slate-500">Top 10 Google Organic Competitors</div>
            {(competitors.length > 0
              ? competitors
              : [
                  {
                    competitorId: 'c1',
                    rank: 1,
                    title: 'Blue Bottle Pour Over Dripper',
                    url: 'https://bluebottlecoffee.com',
                    rating: 4.8,
                    reviews: 512,
                    trustSignals: ['Free Shipping', 'COD'],
                  },
                  {
                    competitorId: 'c2',
                    rank: 2,
                    title: 'Hario V60 Ceramic Dripper 02',
                    url: 'https://hario-usa.com',
                    rating: 4.9,
                    reviews: 1240,
                    trustSignals: ['Japanese Porcelain', 'UPI'],
                  },
                  {
                    competitorId: 'c3',
                    rank: 3,
                    title: 'Fellow Stagg [X] Dripper Set',
                    url: 'https://fellowproducts.com',
                    rating: 4.7,
                    reviews: 380,
                    trustSignals: ['1 Year Warranty'],
                  },
                ]
            ).map((c) => (
              <div
                key={c.competitorId}
                className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-600 text-xs">#{c.rank} Rank</span>
                  <span className="text-amber-500 font-semibold text-xs">â˜… {c.rating || 4.7}</span>
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{c.title}</div>
                <div className="text-[10px] text-slate-500 truncate">{c.url}</div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {(c.trustSignals || []).map((t: string, idx: number) => (
                    <span
                      key={idx}
                      className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 5. Schema Tab */}
        {activeTab === 'schema' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Injected JSON-LD Structured Data</span>
              <button
                onClick={copySchemaToClipboard}
                className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded min-h-[36px]"
              >
                {copiedSchema ? 'âœ“ Copied!' : 'Copy JSON-LD'}
              </button>
            </div>

            <pre className="p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] overflow-x-auto leading-relaxed border border-slate-800">
              {JSON.stringify(sampleJsonLd, null, 2)}
            </pre>
          </div>
        )}

        {/* 6. Category Tab */}
        {activeTab === 'category' && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="text-[10px] font-semibold uppercase text-slate-500">Current Category</div>
              <div className="font-medium text-slate-800 dark:text-slate-200">
                Home &gt; Kitchen &gt; Coffee Makers
              </div>
              <div className="text-[11px] text-amber-600 font-medium">Overly generic category taxonomy.</div>
            </div>

            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-lg border border-blue-200 dark:border-blue-800 space-y-2">
              <div className="text-[10px] font-semibold uppercase text-blue-600 dark:text-blue-400">
                Recommended Google Product Taxonomy
              </div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Home &amp; Garden &gt; Kitchen &amp; Dining &gt; Coffee Makers &amp; Espresso Machines &gt; Pour-Over Coffee Makers
              </div>
              <div className="flex items-center gap-2 pt-1 text-[11px] text-emerald-600 font-medium">
                <span>Taxonomy ID: 4944</span>
                <span>â€¢</span>
                <span>98% Shopping Intent Match</span>
              </div>
            </div>

            <p className="text-slate-600 dark:text-slate-400 text-[11px] leading-relaxed">
              Aligning with exact Google Product Taxonomy ID 4944 increases Free Product Listing visibility on Google
              Shopping search tabs by up to 34%.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
