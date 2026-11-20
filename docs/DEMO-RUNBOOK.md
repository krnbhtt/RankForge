# Demo-day runbook

Follows specification 11.4 (checklist) and 11.5 (five-minute script). Written for the live demo at the buildathon.

## The day before

- [ ] Search and AI credits are available: open the Start screen. If a yellow "credits are used up" notice shows, the demo must use prepared examples (see Fallback).
- [ ] Run the exit test once: `pnpm exam` (10 unseen URLs). It stops with a clear message if credits are out; use `--resume` to continue. Results go to `docs/unseen-results.csv`.
- [ ] Prepare **three showcase audits** on pages and keywords you will not change: run each once through the studio, confirm the score went up, and note the studio links. They then open instantly and appear under "Prepared examples".
- [ ] Record a backup run (see below) and keep a copy on the laptop and a phone.
- [ ] Confirm the billed Gemini key and SERP plan, so no quota error appears mid-demo.

## One hour before

- [ ] `gcloud run services update rf-worker --min-instances=1` and the same for `rf-web` (removes cold starts). After the demo set them back to 0.
- [ ] Two warm-up runs on the venue network (use pages not in the showcase, so they are not served from cache).
- [ ] Open the three showcase audits in separate tabs.
- [ ] Mobile hotspot ready as a backup network.

## Five-minute script

1. **0:00 The problem.** "Every merchant asks two questions: why am I not ranking, why am I not converting."
2. **0:30 Live run.** Paste the judge's URL (or a prepared one). The reproduction of their own page appears on the left within about 20 seconds.
3. **1:15 Competitors.** Cards stream into the Competitors tab; point at a skipped site: "blocked, handled automatically".
4. **1:45 Diagnosis.** Summary tab: read one ranking reason and one conversion reason aloud. Open Findings and show the evidence line.
5. **2:30 Rebuild.** Plan tab: "every section is backed by something we measured". Watch the right-hand page fill in; click a numbered tag to show Ranking, Conversion or Both, the Sample chip and the reason.
6. **3:45 Result.** Scores tab: before and after, and the note that Sample content is shown separately. Schema tab for the structured data; Category tab for the taxonomy check.
7. **4:15 Google stack.** Antigravity, ADK-style staged agents, Gemini, Search Grounding (where quota allows), Cloud Run, Firestore, Cloud Storage.
8. **4:45 Close.** Store owners get a diagnosis; agencies get the Workspace.

## Fallback ladder

1. **A run is slow:** say so and narrate the Plan tab; the page keeps filling in.
2. **Credits used up:** the studio shows a clear notice. Open a prepared example from the Start screen and run the same script. Say plainly that today's live allowance is used and this is a stored run.
3. **Venue network fails:** switch to the hotspot. If that fails, play the backup recording.
4. **A site blocks the capture:** use the HTML paste form shown on the page; keep a pasted-HTML example ready.

## Backup recording

`pnpm record:backup` records a full run of the studio (about five minutes) into `docs/demo/backup-run.webm`, using a page and keyword whose search results are cached, so it works even when credits are used up. Re-record it after any visible UI change. Keep the file outside git if it is large.

## Rehearsal log

| Date | Network | URL | Completed | Problems |
|---|---|---|---|---|
| | | | | |
