# Phase 3 Report: Analysis

- **Date**: 2026-11-20
- **Exit criterion (spec 10)**: scores repeat within ±3 points; every finding has evidence.
- **Result**: **MET on the URL tested** (one corpus URL, three consecutive live runs: spread 0 for Visibility, Conversion and PPI; 16 of 16 findings carry evidence). It has not been demonstrated across the corpus.

## What was built

| Spec item | Where | Notes |
|---|---|---|
| F4.3 Product JSON-LD validation | `analysis/schema-audit.ts` | Pure code. Product, Offer, Brand and BreadcrumbList required and recommended properties, each rule with evidence. |
| F4.5 On-page audit | `analysis/onpage-audit.ts` | Title and meta, single H1, heading hierarchy, canonical, alt text, file names, image count, hero preload. Pure code. |
| F4.4 Core Web Vitals | `analysis/psi.ts` | PageSpeed Insights (mobile). Falls back to LCP and CLS measured in our own mobile Chromium when PSI is unavailable (see limits). |
| F4.1, F4.2 Entity and query gap | `analysis/entity-gap.ts` | Model judges, code verifies: an entity counts as present only if its words occur on the page; a question counts as answered only if the quoted evidence is on the page. The journey uses only SERP questions. Temperature 0 and a fixed seed. |
| F4.6 Visual CRO audit | `analysis/visual-cro.ts` | Vision pass over target mobile and desktop plus two competitors. The model answers a fixed yes/no rubric and lists findings with screenshot regions; code converts the rubric to points. Run twice; averaged if the two scores differ by more than 10 points. |
| F4.7, F4.8 Tone, trust and category | `analysis/trust-category.ts`, `taxonomy.ts` | Tone and trust score 0 to 4, and a Google Product Taxonomy path validated against the official taxonomy file. |
| F4.10 Scoring | `packages/scoring` (Phase 0) wired through `analysis/signals.ts` | Same functions will score the optimised page. A metric that could not be measured is left out and the rest rescaled, not scored as zero. |
| Findings | `analysis/findings.ts` | Each finding has tag, severity, penalty points and evidence (measured value, competitor count or screenshot region). A finding without evidence fails the stage. |

The analysis stage (`stages/analysis-stage.ts`) runs the four analyses in parallel, writes findings, the question journey and the baseline scores, and stores `analysis.json`.

## Live results (corpus URL c07, 11 competitors)

| Run | Visibility | Conversion | PPI | Findings | Time |
|---|---|---|---|---|---|
| 1 | 60.4 | 54 | 32.6 | 16 | 78 s |
| 2 | 60.4 | 54 | 32.6 | 16 | 25 s |
| 3 | 60.4 | 54 | 32.6 | 16 | 33 s |

Before the fixes below the same page gave Visibility 45 and 49.4 (spread 4.4), so the first version missed the ±3 target.

End-to-end through the web app and worker on the Firestore emulator (the same Sugar lipstick page, keyword "matte lipstick"): 13 findings, baseline Visibility 78.5, Conversion 61, PPI 47.9, estimated model spend ₹6.33 (cap ₹25). These numbers differ from the table above because that run captured a different competitor set (different consensus entities and questions); the inputs differed, not the scoring.

## What changed because of the runs

- A model-written question journey moved the query score between runs. The journey is now fixed to the SERP questions, and analysis calls use temperature 0 and a seed.
- Unmeasured Core Web Vitals scored 0 and cost 20 points. They are now excluded and the score rescaled; a local lab measurement is used when PSI is down.
- Model claims are checked against the page text before they affect a score.

## Limits and honest caveats

- **One URL, not the corpus.** Repeatability was measured on c07 only. The model quota on this key (below) made a wider run impractical in one day.
- **Gemini 3.1 Pro has no quota on this key**, so the visual audit and other Pro-role calls ran on Flash-class models through the fallback chain. Quality is lower than the specification intends.
- **PageSpeed Insights** needs credentials that were not supplied; the unauthenticated quota was exhausted. Core Web Vitals came from our own unthrottled mobile run (source "lab"), which is more optimistic than PSI's throttled run and has no INP.
- **Cloud Natural Language API** was not used (no credentials). Entity salience weighting is therefore equal-weight, and sentiment is judged by the model.
- **Consensus entities are matched by normalised phrase.** Model-written entity names rarely match exactly across competitors, so few entities reach the "4+ competitors" bar; on c07 the entity component scored 0. Clustering similar phrases would fix this and is not done.
- **A visual finding reported the price as "RS. 0.00".** That was visible in the captured screenshot; it may be a capture artifact (price loaded after our request rules) rather than a store defect, and has not been checked against a normal browser.
- Gemini 3.5 Flash's daily free-tier limit (20 requests per day per model) was exhausted during development; later calls ran on the fallback models.
