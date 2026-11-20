# Phases 4 and 5 Report: Blueprint and Rebuild

- **Date**: 2026-11-20
- **Phase 4 exit criterion (spec 10)**: every section traces to a finding, a competitor pattern or a playbook rule.
- **Phase 5 exit criterion**: full rebuild without breaking the layout; after-scores measured.
- **Result**: **Both met on the pages tested** (one live store page through the whole pipeline, several runs, plus fixture integration tests). Not demonstrated across the corpus. Some spec items were not built (listed below).

## Phase 4: blueprint

| Spec item | Where | Notes |
|---|---|---|
| F5.1 CRO playbook | `blueprint/playbook.ts` | Seven deterministic rules (delivery and payment, trust row, reviews, specification table, FAQ, price note, sticky buy bar). A rule fires only when the page lacks the element and measured evidence supports adding it. |
| F5.2 Structure blueprint | `blueprint/structure.ts` | A model call proposes order, headings and depth for the sections the playbook chose. It cannot add or remove sections. If the model is unavailable the playbook defaults are used (`generatedBy: fallback`). |
| F5.3 Arbiter | `blueprint/arbiter.ts` | **Deterministic code, not a model** (decision recorded in `DECISIONS.md`). Drops duplicates and unsupported sections, verifies every anchor against the real snapshot, chains sections that share an anchor, lists deterministic fixes, and writes a decision log. |
| F5.4 Section to component mapping | `blueprint/arbiter.ts` | Each section is placed next to a captured component (price, add-to-cart, description, reviews). Sections that must not sit above the buy button also get below-the-fold alternates (before a footer-like element, or after main). |

Traceability is enforced by the schema (`justifications` has at least one entry) and tested.

## Phase 5: rebuild and verify

| Spec item | Where | Notes |
|---|---|---|
| F6.1 Section writer | `rebuild/writer.ts` | One model call per section (sticky bar and price note are deterministic templates). Facts come only from captured and platform data. Illustrative content carries a Sample chip. |
| F6.2 Patches and class validator | `rebuild/applier.ts`, `rebuild/sanitize.ts` | Model HTML is untrusted: scripts, iframes, forms, inline styles, event handlers and `javascript:` links are stripped, and classes outside the store's whitelist are removed (repair pass), with a scoped fallback when most classes are unusable. The model never applies patches. |
| Patch modes | `rebuild/applier.ts` | Server mode edits the snapshot with cheerio and verifies every selector first. Runtime mode re-applies the same operations after load with a MutationObserver (tested in a real browser against a page that wipes its DOM after load, and against an observer loop). |
| Deterministic fixes | `rebuild/deterministic.ts` | Title, meta description, alt text, and Product and Breadcrumb structured data, built from captured facts only. A rating is published only if the page shows a real one. |
| F6.6 Verify | `rebuild/verify.ts`, `stages/verify-stage.ts` | Each section is applied cumulatively in a fresh browser and dropped if it adds script errors, makes the page scroll sideways, changes more than the measured noise of pixels above its insertion, or pushes the buy button below the fold on mobile. Alternate placements are tried first. A click test covers the variant selector and gallery. |
| F6.7 Re-score | `stages/verify-stage.ts` | The same scoring functions score the optimised page. Sample content counts toward the after score (spec 7.4), and a second score without it is stored and shown. Per-component evidence attributions are generated. |

## Live results (corpus URL c07 variant, keyword "matte lipstick", through the web app and worker on the Firestore emulator)

| | Visibility | Conversion | PPI |
|---|---|---|---|
| Before | 66.3 | 53 | 35.1 |
| After (with Sample content) | 78.5 | 58 | 45.5 |
| After (without Sample content) | 67.3 | 53 | 35.7 |

All three sections and all deterministic fixes passed verification; the click test found the gallery and variant selector working. Estimated model spend ₹3.90. Elapsed: reproduction visible at +28 s, scores at +2:17, rebuild and after-scores at +4:30 (budget 4:00).

**How to read the gain.** Of the +10.4 PPI, only +0.6 comes from content that is not illustrative (alt text and structured data). The rest comes from Sample reviews, a Sample trust row and Sample FAQ and specification content, which the spec counts but requires to be labelled. The studio shows both numbers next to the score.

## What the runs taught

- Earlier runs scored the rebuilt page **below** the original: sections were being placed above the mobile buy button. Fixes: place button-adjacent sections after the button, never fall back to the heading, add a buy-button guard to verification, add below-the-fold alternates.
- The pixel-damage check was fooled by `vh`-based layouts re-flowing in full-page screenshots; it now uses a fixed tall viewport and a measured noise level.
- Verification once accepted a section that could not be placed at all; "could not be placed" is now a failure.
- The optimised page was first served without its stylesheets (assets live under the reproduction's folder). Found only by looking at the real page; the preview now falls back to the shared assets.
- A worker restart mid-audit left the audit stuck. Audits can now be retried and resume from finished stages.

## Not built or not verified

- **Image studio (F6.5, Should)** is not built: the supplied key has no image-model quota. The `imageConsent` flag is stored but unused.
- **True token streaming** is not implemented. Sections are applied one at a time and the studio reloads the optimised preview as each lands.
- **Blueprint outline in the studio** (spec 4.1 step 7) is not shown; the sections appear as they are built.
- **Section writer quality:** the supplied key has no Gemini 3.1 Pro quota, so writing ran on Flash-class models. Sample FAQ answers deliberately say the seller will confirm when the page does not state a fact, and those answers do not count toward the question score.
- **Runtime patch mode** is tested on a fixture, not on a live hydrating storefront.
- Per-URL results are from one store page; the corpus-wide rebuild run (spec 11.2) has not been done.
