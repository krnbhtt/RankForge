# Project Status: RankForge AI

**Last updated**: 2026-11-20. Phases follow section 10 of the specification.

## Current position: Phases 1 to 3 built; Phase 4 (blueprint) is next

| Phase | State | Exit criterion | Result |
|---|---|---|---|
| 0 Foundations | Complete | Stub job shows every status live | Met |
| 1 Capture | Built | 90% of corpus reproduces with no visible difference; gallery and variants work | **Not met**: 12 of 18 (66.7%). `docs/phases/PHASE-1-REPORT.md` |
| 2 Competitors | Built | 7+ usable competitors per corpus URL within budget | **Partly met**: see `docs/phases/PHASE-2-REPORT.md` |
| 3 Analysis | Built | Scores repeat within ±3; every finding has evidence | **Met on the URL tested** (spread 0, 3 runs): `docs/phases/PHASE-3-REPORT.md` |
| 4 Blueprint | Not started | | |
| 5 Rebuild | Not started (the worker still runs the Phase 0 stub for these stages) | | |
| 6 Studio | Partly (real preview, findings, competitors, scores; other panels still Phase 0 mock) | | |
| 7 Hardening | Not started | | |

## What runs for real today

Submit a URL in the studio: the worker captures and reproduces the page, finds competitors for the keyword (given or inferred), captures and profiles them, runs the analyses, and writes findings and baseline Visibility, Conversion and PPI scores. State lives in Firestore (emulator verified) or the local file store. Everything after analysis (blueprint, rebuild, verify) is still a stub, so the studio shows an honest empty state for the optimised page and "Not built yet" for after-scores.

## Known gaps

See `docs/KNOWN_ISSUES.md`: Docker worker image unverified (daemon hangs here), free-tier Gemini quota (no Pro or Search Grounding, 20 requests per day per model), no PageSpeed or Natural Language API credentials, WooCommerce and Magento untested against live stores, remaining Phase 0 mock panels in the studio.

## Local run

`pnpm install`, then `pnpm dev:worker` (4050), `pnpm --filter @rankforge/preview dev` (4060), `pnpm dev:web` (3000). Put `SERP_API_KEY` and `GEMINI_API_KEY` in `.env.local` (git-ignored). For Firestore: start the emulator (`firebase.json`) and set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. `pnpm corpus` runs the visual-regression corpus.
