# Project Status: RankForge AI

**Last updated**: 2026-11-20. Phases follow section 10 of the specification.

## Current position: the whole pipeline runs for real; deployment and rehearsal are not done

| Phase | State | Exit criterion | Result |
|---|---|---|---|
| 0 Foundations | Complete | Stub job shows every status live | Met |
| 1 Capture | Built | 90% of corpus reproduces; gallery and variants work | **Not met**: 14 of 18 within 2%, 11 of 18 with the interactive copy. `phases/PHASE-1-REPORT.md` |
| 2 Competitors | Built | 7+ usable competitors per corpus URL | **Partly met**: 4 of the 5 URLs tried. `phases/PHASE-2-REPORT.md` |
| 3 Analysis | Built | Scores repeat within ±3; every finding has evidence | **Met on the URL tested.** `phases/PHASE-3-REPORT.md` |
| 4 Blueprint | Built | Every section traces to evidence | **Met** (enforced by schema, tested). `phases/PHASE-4-5-REPORT.md` |
| 5 Rebuild | Built (no image studio) | Rebuild without breaking layout; after-scores measured | **Met on the pages tested.** Same report |
| 6 Studio | Built (no Workspace screen) | A newcomer explains both failures | **Not tested with a person.** `phases/PHASE-6-7-REPORT.md` |
| 7 Hardening | Partly | 9 of 10 unseen URLs complete | **Not run.** Nothing deployed; images never built |

## What runs today

Submit a URL in the studio. The worker captures and reproduces the page, finds competitors for the keyword, captures and profiles them, runs the analyses, writes findings and baseline scores, builds a blueprint, rebuilds the page section by section, verifies it in a fresh browser, and re-scores it. State lives in Firestore (emulator verified) or the local file store. One live run takes about 4.5 minutes and an estimated ₹4.

## Known gaps

See `docs/KNOWN_ISSUES.md`. The main ones: free-tier Gemini quota and exhausted SERP credits (so few live runs), no deployment, Docker images unbuilt (daemon hangs), no image generation, no Workspace screen, WooCommerce and Magento untested on live stores.

## Local run

`pnpm install`. Put `SERP_API_KEY` and `GEMINI_API_KEY` in `.env.local` (git-ignored). Start the Firestore emulator (`firebase.json`) and set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, or leave it unset for the file store. Then start the worker (`pnpm --filter @rankforge/worker exec tsx src/index.ts`, port 4050), the preview service (`pnpm --filter @rankforge/preview exec tsx src/index.ts`, port 4060) and the web app (`pnpm dev:web`, port 3000). Avoid `tsx watch` while an audit is running: a restart kills the run (use the retry endpoint to resume). `pnpm corpus` runs the visual-regression corpus.
