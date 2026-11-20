'use client';

import React, { useState, useRef } from 'react';
import type { AuditStatus, AuditPatch } from '@rankforge/schema';

export interface StudioPreviewContainerProps {
  status: AuditStatus;
  targetUrl?: string;
  patches?: AuditPatch[];
}

export function StudioPreviewContainer({
  status,
  targetUrl = 'https://example-store.com/products/ceramic-pour-over-dripper',
}: StudioPreviewContainerProps) {
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile'>('desktop');
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);

  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const rightScrollRef = useRef<HTMLDivElement | null>(null);
  const activeSourceRef = useRef<'left' | 'right' | null>(null);
  const clearTimerRef = useRef<any>(null);
  const rafIdRef = useRef<number | null>(null);

  // Synchronized Bi-Directional Scrolling Logic with high-frequency event protection
  const handleScroll = (source: 'left' | 'right') => {
    // If the other container is the active user scroll source, this event is a programmatic echo
    if (activeSourceRef.current && activeSourceRef.current !== source) {
      return;
    }

    activeSourceRef.current = source;
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      activeSourceRef.current = null;
    }, 120);

    const sourceEl: HTMLDivElement | null =
      source === 'left' ? leftScrollRef.current : rightScrollRef.current;
    const targetEl: HTMLDivElement | null =
      source === 'left' ? rightScrollRef.current : leftScrollRef.current;

    if (sourceEl && targetEl) {
      const maxSource = sourceEl.scrollHeight - sourceEl.clientHeight;
      const maxTarget = targetEl.scrollHeight - targetEl.clientHeight;

      if (maxSource > 0 && maxTarget > 0) {
        const ratio = Math.min(1, Math.max(0, sourceEl.scrollTop / maxSource));
        const targetScrollTop = ratio * maxTarget;

        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
        }
        rafIdRef.current = requestAnimationFrame(() => {
          if (targetEl) {
            targetEl.scrollTop = targetScrollTop;
          }
          rafIdRef.current = null;
        });
      }
    }
  };

  const isScraping = status === 'queued' || status === 'capturing';
  const isGeneratingRebuild =
    status === 'captured' ||
    status === 'awaiting_keyword' ||
    status === 'discovering' ||
    status === 'competitors' ||
    status === 'analysing' ||
    status === 'analysed' ||
    status === 'blueprinted';
  const isRebuildingOrComplete = status === 'rebuilding' || status === 'verifying' || status === 'complete';

  return (
    <div className="flex flex-col flex-1 h-full bg-slate-100 dark:bg-slate-950 overflow-hidden">
      {/* Top Controls Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800 text-xs">
        {/* Left Label */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            Original Storefront
          </span>
          <span className="text-slate-400 font-mono truncate max-w-[240px] hidden sm:inline">
            {targetUrl}
          </span>
        </div>

        {/* Center: Viewport Switcher & Synced Scroll Indicator */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setViewportMode('desktop')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors min-h-[36px] ${
                viewportMode === 'desktop'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
              aria-label="Desktop viewport (1280px)"
            >
              Desktop
            </button>
            <button
              onClick={() => setViewportMode('mobile')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors min-h-[36px] ${
                viewportMode === 'mobile'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
              aria-label="Mobile viewport (375px)"
            >
              Mobile (375px)
            </button>
          </div>

          <span className="hidden md:inline-flex items-center gap-1 px-2 py-1 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-[11px]">
            <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            Scroll Synced
          </span>
        </div>

        {/* Right Label with Sample Chip */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            RankForge Optimised
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
            Sample
          </span>
        </div>
      </div>

      {/* Main Split-View Container */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 p-2 overflow-hidden">
        {/* Left Pane: Original Page */}
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div
            ref={leftScrollRef}
            onScroll={() => handleScroll('left')}
            className={`flex-1 overflow-y-auto ${
              viewportMode === 'mobile' ? 'max-w-[375px] mx-auto border-x border-slate-300 shadow-sm' : 'w-full'
            }`}
          >
            {isScraping ? (
              <div className="p-8 space-y-6 animate-pulse">
                <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded w-2/3" />
                <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded-lg" />
                <div className="space-y-3">
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-3/4" />
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/2" />
                </div>
                <div className="h-10 bg-slate-300 dark:bg-slate-700 rounded w-full" />
                <p className="text-xs text-center text-slate-500">Capturing target storefront via Playwright...</p>
              </div>
            ) : (
              <div className="p-6 space-y-6 text-slate-800 dark:text-slate-200">
                {/* Store Header */}
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3 flex justify-between items-center text-xs text-slate-500">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">RoastMaster Specialty Coffee</span>
                  <span>Cart (0)</span>
                </div>

                {/* Product Title & Breadcrumbs */}
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Home &gt; Kitchen &gt; Coffee Makers</div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    Ceramic Pour Over Coffee Dripper (Cone Style)
                  </h1>
                </div>

                {/* Product Image Gallery Mock */}
                <div className="relative bg-slate-100 dark:bg-slate-800 rounded-lg h-60 flex items-center justify-center border border-slate-200 dark:border-slate-700 text-slate-400">
                  <div className="text-center p-4">
                    <svg className="w-12 h-12 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs">Original Storefront Product Image</span>
                  </div>
                </div>

                {/* Price & Buy Section (Original Deficits: No COD, small button, no MRP) */}
                <div className="space-y-3 price-container">
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">₹1,899</div>
                  <button className="w-full bg-slate-800 text-white py-2 px-4 rounded text-sm hover:bg-slate-700 transition">
                    Add to Cart
                  </button>
                  <p className="text-xs text-slate-500">Standard shipping calculated at checkout.</p>
                </div>

                {/* Description */}
                <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">Product Description</h3>
                  <p>
                    A ceramic coffee dripper designed for brewing delicious pour-over coffee at home.
                    White ceramic finish with cone shape.
                  </p>
                </div>

                {/* Specs */}
                <div className="specs-table border-t border-slate-200 dark:border-slate-800 pt-4 text-xs space-y-1 text-slate-500">
                  <div>Material: Ceramic</div>
                  <div>Color: White</div>
                  <div>Origin: Imported</div>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-8 pb-4 text-center text-xs text-slate-400">
                  © 2026 RoastMaster Coffee Store
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: RankForge Optimised Page */}
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden relative">
          <div
            ref={rightScrollRef}
            onScroll={() => handleScroll('right')}
            className={`flex-1 overflow-y-auto ${
              viewportMode === 'mobile' ? 'max-w-[375px] mx-auto border-x border-slate-300 shadow-sm' : 'w-full'
            }`}
          >
            {isGeneratingRebuild ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-4">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">Benchmarking Competitors</h4>
                  <p className="text-xs text-slate-500 max-w-xs mt-1">
                    Analyzing top 10 SERP competitor storefronts to extract missing trust markers, entities, and FAQ queries.
                  </p>
                </div>
              </div>
            ) : isRebuildingOrComplete ? (
              <div className="p-6 space-y-6 text-slate-800 dark:text-slate-200">
                {/* Store Header */}
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3 flex justify-between items-center text-xs text-slate-500">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">RoastMaster Specialty Coffee</span>
                  <span className="font-medium text-blue-600">Free Express Delivery Activated</span>
                </div>

                {/* Optimised Title & Schema Breadcrumb */}
                <div>
                  <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium mb-1">
                    Home &gt; Kitchen &gt; Coffee Makers &gt; Pour Over Drippers
                  </div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                    <span>Ceramic Pour Over Dripper 02 (Heat-Retention Glaze)</span>
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                      SEO Enriched
                    </span>
                  </h1>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="text-amber-500 font-semibold">★ 4.8</span>
                    <span>(142 Verified Reviews)</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                      Sample
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="text-emerald-600 font-medium">In Stock</span>
                  </div>
                </div>

                {/* Hero Photo with Annotation Dot */}
                <div className="relative bg-slate-100 dark:bg-slate-800 rounded-lg h-60 flex items-center justify-center border border-slate-200 dark:border-slate-700">
                  <div className="text-center p-4">
                    <svg className="w-12 h-12 mx-auto mb-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      High-Definition Optimized Product Showcase
                    </span>
                  </div>
                  {/* Annotation Dot 1 */}
                  <div className="absolute top-3 right-3">
                    <button
                      onClick={() => setActiveAnnotation(activeAnnotation === 'hero' ? null : 'hero')}
                      className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shadow-lg hover:scale-110 transition ring-2 ring-white"
                      title="View Optimization Rationale"
                    >
                      1
                    </button>
                    {activeAnnotation === 'hero' && (
                      <div className="absolute right-0 top-8 w-64 bg-slate-900 text-white p-3 rounded-lg text-xs shadow-xl z-20 space-y-1">
                        <div className="font-semibold text-blue-400">Patch #1: Hero Entity Enrichment</div>
                        <p className="text-slate-300">
                          Added 4.8-star social proof and exact 02 size descriptor matching top 3 competitor consensus.
                        </p>
                        <div className="text-emerald-400 font-medium text-[10px]">+19 pts Visibility</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Price & Rebuilt Buy Section with MRP, COD, UPI */}
                <div className="space-y-3 relative p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">₹1,899</span>
                    <span className="text-sm line-through text-slate-400">MRP ₹2,499</span>
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded">
                      24% OFF
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">Inclusive of all taxes • Free Shipping Across India</div>

                  {/* Primary CTA (52px Touch Target) */}
                  <button className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-lg text-sm hover:bg-blue-700 transition shadow-sm min-h-[52px]">
                    Buy Now — Pay Online or Cash on Delivery
                  </button>

                  {/* Trust Badges (COD, UPI, Easy Returns) */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span>Cash on Delivery (COD) Available</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-blue-600 font-bold">✓</span>
                      <span>Instant UPI / Credit Card / NetBanking</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-amber-600 font-bold">✓</span>
                      <span>7-Day Easy Replacement Guarantee</span>
                    </div>
                  </div>

                  {/* Annotation Dot 2 */}
                  <div className="absolute top-2 right-2">
                    <button
                      onClick={() => setActiveAnnotation(activeAnnotation === 'trust' ? null : 'trust')}
                      className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shadow-lg hover:scale-110 transition ring-2 ring-white"
                      title="View Optimization Rationale"
                    >
                      2
                    </button>
                    {activeAnnotation === 'trust' && (
                      <div className="absolute right-0 top-8 w-64 bg-slate-900 text-white p-3 rounded-lg text-xs shadow-xl z-20 space-y-1">
                        <div className="font-semibold text-emerald-400">Patch #2: India Trust Signal Block</div>
                        <p className="text-slate-300">
                          Eliminated conversion drop-off by visibly offering COD, UPI, MRP discount, and 7-day returns directly above the fold.
                        </p>
                        <div className="text-emerald-400 font-medium text-[10px]">+12 pts Conversion</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Enriched Technical Specs */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3 bg-white dark:bg-slate-900">
                  <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                    Technical Specifications & Competitor Benchmark
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                      <div className="text-slate-500">Brew Capacity</div>
                      <div className="font-medium">1–4 Cups (Size 02)</div>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                      <div className="text-slate-500">Thermal Material</div>
                      <div className="font-medium">High-Fired Porcelain</div>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                      <div className="text-slate-500">Flow Dynamics</div>
                      <div className="font-medium">Spiral Rib Extraction</div>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                      <div className="text-slate-500">Dishwasher Safe</div>
                      <div className="font-medium">Yes (100% Food Grade)</div>
                    </div>
                  </div>
                </div>

                {/* FAQ Accordion Section */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-2 bg-white dark:bg-slate-900">
                  <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                    Frequently Asked Questions (FAQ)
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        Is this ceramic dripper dishwasher safe?
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 mt-1">
                        Yes, the high-fired glaze is 100% dishwasher safe and microwave safe.
                      </div>
                    </div>
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        What filters fit this dripper?
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 mt-1">
                        Compatible with standard 02 cone-shaped paper and cloth filters.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Customer Reviews & Social Proof Synthesis (Spec §6.3 & R3) */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3 bg-white dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <span>Customer Reviews & Ratings</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        Sample
                      </span>
                    </h3>
                    <span className="text-xs text-amber-500 font-semibold">★ 4.8 / 5.0</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">Arjun M.</span>
                        <span className="text-slate-400 text-[10px]">Verified Buyer</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 mt-1">
                        &ldquo;Excellent heat retention compared to plastic drippers. Extraction is noticeably more uniform.&rdquo;
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-8 pb-4 text-center text-xs text-slate-400">
                  © 2026 RoastMaster Coffee Store — Optimised by RankForge AI
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
