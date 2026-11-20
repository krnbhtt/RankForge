# Deck updates

The submitted deck is not in this repository, so these are the exact changes to make to it. They match what the build actually does (specification 3.2 and 11.4).

## Model roles (replace the model slide)

| Role | Model | Notes |
|---|---|---|
| Keyword inference, entity extraction, gap analysis, tone and category | Gemini 3.5 Flash | Falls back to other Flash-class models when a daily quota is used up |
| Visual conversion audit of screenshots | **Gemini 3.1 Pro** (not Gemini Omni) | Gemini Omni is a video-generation model and is not used for auditing |
| Blueprint structure and section writing | Gemini 3.1 Pro | Same fallback chain |
| AI-cited sources (GEO view) | Gemini Search Grounding | Needs Search Grounding quota; shows "unavailable" without it |
| Improved and generated images | Nano Banana 2; Nano Banana Pro for the hero | Only with the user's consent; every image is labelled Sample |
| Product category check | Google Product Taxonomy file, matched in code | Cloud Natural Language API is not used |
| Core Web Vitals | PageSpeed Insights, with a local mobile measurement as fallback | |

## Claims to keep honest

- Say "scores are computed in code; the model writes and judges, it never scores" (this is true).
- Say "illustrative content is always labelled Sample and the score without it is shown" (this is true).
- Do not claim 90% reproduction fidelity: the measured figure is in `docs/phases/PHASE-1-REPORT.md`.
- Do not claim the 9-of-10 unseen-URL result until `pnpm exam` has produced `docs/unseen-results.csv`.

## Architecture slide

Three Cloud Run services (`rf-web`, `rf-worker`, `rf-preview`), Firestore for live state, Cloud Storage for artifacts, Cloud Tasks for the job queue, Secret Manager for keys. Preview pages run on their own origin in a sandboxed iframe.
