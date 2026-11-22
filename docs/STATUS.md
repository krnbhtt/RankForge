# Project Status: RankForge AI

**Last updated**: 2026-11-20. Phases follow section 10 of the specification.

## Current position: deployed and live on Cloud Run (project rankforge-ai-demo, asia-south1); full audits complete in the cloud

Live: https://rf-web-gbltmnqhla-el.a.run.app. Search provider is SerpApi (`SERP_PROVIDER=serpapi`). Billing is on a personal account after the event credits account closed; services run with one warm instance each (set back to 0 after the demo). Latest cloud audit: score 37.9 to 43.7 including Sample content.

| Phase | State | Exit criterion | Result |
|---|---|---|---|
| 0 Foundations | Complete | Stub job shows every status live | Met |
| 1 Capture | Built | 90% of corpus reproduces; gallery and variants work | **Not met**: 14 of 18 within 2%, 11 of 18 with the interactive copy. `phases/PHASE-1-REPORT.md` |
| 2 Competitors | Built | 7+ usable competitors per corpus URL | **Partly met**: 4 of the 5 URLs tried. `phases/PHASE-2-REPORT.md` |
| 3 Analysis | Built | Scores repeat within ±3; every finding has evidence | **Met on the URL tested.** `phases/PHASE-3-REPORT.md` |
| 4 Blueprint | Built | Every section traces to evidence | **Met** (enforced by schema, tested). `phases/PHASE-4-5-REPORT.md` |
| 5 Rebuild | Built (image studio behind `FEATURE_IMAGE_GENERATION`, consent-gated) | Rebuild without breaking layout; after-scores measured | **Met on the pages tested.** Same report |
| 6 Studio | Built (Summary and Plan tabs, Workspace screen without sign-in) | A newcomer explains both failures | **Not tested with a person**: protocol in `usability-test.md`, a proxy test was run and its four findings fixed. `phases/PHASE-6-7-REPORT.md` |
| 7 Hardening | Partly | 9 of 10 unseen URLs complete | **Not run.** Needs search credits (`pnpm exam`, stops with a clear notice when they are out). Docker images build and run (worker, preview verified; web build in progress). Nothing deployed: needs gcloud sign-in and a project id |

## What runs today

Submit a URL in the studio. The worker captures and reproduces the page, finds competitors for the keyword, captures and profiles them, runs the analyses, writes findings and baseline scores, builds a blueprint, rebuilds the page section by section, verifies it in a fresh browser, and re-scores it. State lives in Firestore (emulator verified) or the local file store. One live run takes about 4.5 minutes and an estimated ₹4.

## Known gaps

See `docs/KNOWN_ISSUES.md`. The main ones: free-tier Gemini quota and exhausted SERP credits (so few live runs), no deployment (gcloud installed, not signed in), no Google sign-in for the Workspace, WooCommerce and Magento untested on live stores.

## Local run

`pnpm install`. Put `SERP_API_KEY` and `GEMINI_API_KEY` in `.env.local` (git-ignored). Start the Firestore emulator (`firebase.json`) and set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, or leave it unset for the file store. Then start the worker (`pnpm --filter @rankforge/worker exec tsx src/index.ts`, port 4050), the preview service (`pnpm --filter @rankforge/preview exec tsx src/index.ts`, port 4060) and the web app (`pnpm dev:web`, port 3000). Avoid `tsx watch` while an audit is running: a restart kills the run (use the retry endpoint to resume). `pnpm corpus` runs the visual-regression corpus.
