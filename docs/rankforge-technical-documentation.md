# RankForge AI — Technical Documentation (MVP)

Nov 20, 2026 · @Karan Bhatt

Google DeepMind × Google Cloud Startup Buildathon India 2026 · Team Yashvi

## 1. Product overview

RankForge AI shows an e-commerce merchant, in one live run, exactly why their product page is not ranking and not converting, by reproducing their page and rebuilding it into the version it should be. The deliverable for the buildathon is a working prototype, live on Google Cloud, built in Google Antigravity, that handles any product URL a judge supplies.

### The two questions the product answers

1. **Why is my product page not ranking?** Missing entities and attributes, unanswered follow-up queries, weak or invalid Product schema, slow Core Web Vitals, poor on-page structure, wrong product category.
2. **Why is my product page not converting?** Buried add-to-cart, unclear price and offer, missing delivery, COD, UPI and returns reassurance, absent reviews and trust signals, mobile friction.

### What the user does and sees

The user enters a product URL, with an optional keyword. RankForge reproduces the page using its own HTML, CSS, JavaScript and images, analyses the top 10 organic competitors, and then rebuilds the reproduction section by section, live on screen. Every addition is tagged **Ranking**, **Conversion** or **Both**, with the evidence behind it. Two scores, Visibility and Conversion, are shown before and after.

### Scope rules

- **Demonstration only.** The optimised page is a visualisation. Nothing is written to the merchant's live store.
- **Agent freedom.** The agent may add any section justified by competitor patterns, CRO best practice, or both: sample reviews, certifications, trust badges, delivery and payment blocks, FAQs, comparison tables and imagery. Visualisation-only elements carry a visible "Sample" label.
- **Competitor assets.** Competitor images and assets may be referenced inside the preview for demonstration; they are never part of any export.
- **Keyword.** Optional. If absent, the tool proposes three to five candidates from the page and competitors, and the user picks one.
- **Category.** The current category is validated against the Google Product Taxonomy and a better one is suggested where needed.
- **Images.** The tool asks the user before generating or improving product images.
- **Language.** English only.

### Users

| User | Need | MVP coverage |
| --- | --- | --- |
| Store owner | Understand why one product page underperforms | Single audit, studio view |
| Agency | Show clients what their pages should become | Workspace with client stores, shareable preview link |

### Buildathon success criteria

1. Live on Google Cloud at a public URL, built with Antigravity, using Gemini, Gemma, Nano Banana, Search Grounding and Agent Skills.
2. At least 9 of 10 unseen product URLs complete end to end during rehearsal.
3. First visible result within 20 seconds; full rebuild within 4 minutes.
4. A judge can watch one run and explain both failures of the page without assistance.

## 2. Feature map

The MVP has 8 modules and 47 features; the 37 marked **Must** are the demo-critical set, and everything marked **Could** is cut first if time runs short. The Tag column records which of the two questions each feature answers.

| ID | Module | Feature | Priority | Tag |
| --- | --- | --- | --- | --- |
| F1.1 | Input | Product URL entry with validation | Must | Both |
| F1.2 | Input | Optional keyword; else 3–5 inferred candidates to choose from | Must | Ranking |
| F1.3 | Input | HTML-paste fallback when the page blocks access | Should | Both |
| F1.4 | Input | Image-generation consent prompt | Must | Conversion |
| F2.1 | Capture | Headless render with lazy-load scroll | Must | Both |
| F2.2 | Capture | Asset proxy: CSS, JS, fonts, images copied to Cloud Storage | Must | Both |
| F2.3 | Capture | Platform detection: Shopify, WooCommerce, Magento, generic | Must | Both |
| F2.4 | Capture | Platform product data (Shopify .json, Woo Store API) | Should | Both |
| F2.5 | Capture | Tracker blocking and cart/checkout stubbing | Must | Both |
| F2.6 | Capture | Hydration detection: server vs runtime patch mode | Must | Both |
| F2.7 | Capture | Component inventory and CSS class whitelist | Must | Conversion |
| F2.8 | Capture | Mobile 390 px and desktop 1440 px screenshots | Must | Conversion |
| F3.1 | Competitors | Top 10 organic results via SERP API | Must | Ranking |
| F3.2 | Competitors | People Also Ask and related searches | Must | Ranking |
| F3.3 | Competitors | AI-cited sources via Gemini Search Grounding | Must | Ranking |
| F3.4 | Competitors | Parallel capture with time budget, skip and backfill | Must | Both |
| F3.5 | Competitors | Section sequence and heading-tree extraction | Must | Both |
| F3.6 | Competitors | Trust, certification, delivery, payment, returns detection | Must | Conversion |
| F3.7 | Competitors | Image-type inventory (lifestyle, infographic, size, packaging) | Should | Conversion |
| F3.8 | Competitors | Consensus model across competitors | Must | Both |
| F4.1 | Analysis | Entity and attribute gap (NL API + Gemini) | Must | Ranking |
| F4.2 | Analysis | Query-sequence map (X → Y → Z) | Must | Ranking |
| F4.3 | Analysis | Product JSON-LD validation | Must | Ranking |
| F4.4 | Analysis | Core Web Vitals via PageSpeed Insights | Must | Both |
| F4.5 | Analysis | On-page audit: title, meta, H1–H3, alt, canonical | Must | Ranking |
| F4.6 | Analysis | Visual CRO audit on screenshots (Gemini 3.1 Pro) | Must | Conversion |
| F4.7 | Analysis | Tone and trust sentiment (NL API) | Should | Conversion |
| F4.8 | Analysis | Google Product Taxonomy category check | Should | Ranking |
| F4.9 | Analysis | India compliance flags: MRP, origin, mandatory certifications | Could | Conversion |
| F4.10 | Analysis | Visibility, Conversion and Page Performance Index | Must | Both |
| F5.1 | Blueprint | CRO playbook skill | Must | Conversion |
| F5.2 | Blueprint | Structure blueprint: section order, H2/H3, depth | Must | Both |
| F5.3 | Blueprint | Arbiter agent with decision log | Must | Both |
| F5.4 | Blueprint | Section-to-component mapping | Must | Both |
| F6.1 | Rebuild | Streaming section-by-section generation | Must | Both |
| F6.2 | Rebuild | Patch operations using whitelisted classes | Must | Both |
| F6.3 | Rebuild | Labelled sample reviews, badges, certifications | Must | Conversion |
| F6.4 | Rebuild | Product JSON-LD graph in schema panel | Must | Ranking |
| F6.5 | Rebuild | Nano Banana image improvement and generation | Should | Conversion |
| F6.6 | Rebuild | Regression: pixel diff, console errors, click test | Should | Both |
| F6.7 | Rebuild | Re-score optimised page | Must | Both |
| F7.1 | Studio | Live progress timeline | Must | Both |
| F7.2 | Studio | Side-by-side with toggle, synced scroll, mobile/desktop | Must | Both |
| F7.3 | Studio | Annotation tags with evidence pop-overs | Must | Both |
| F7.4 | Studio | Score, query map, competitor, category, schema panels | Must | Both |
| F7.5 | Studio | Shareable noindex preview link | Could | Both |
| F8.1 | Workspace | Google sign-in and client-store list for agencies | Could | Both |

## 3. Technical architecture

RankForge runs as three Cloud Run services: a public studio (`rf-web`), a private worker that does all capture, AI and patching (`rf-worker`), and an isolated preview server (`rf-preview`). Firestore carries live job state to the browser, and Cloud Storage holds every heavy artifact.

&#91;embedded content: RankForge architecture · 3 Cloud Run services, 2 data stores, 10 model and API dependencies\]

The studio never waits on the worker: it writes one audit request, then renders whatever the worker has written to Firestore so far. Store JavaScript runs only on the `rf-preview` origin, never on the studio's.

### 3.1 Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Front end | Next.js (App Router), Tailwind, shadcn/ui | Iframe previews and streaming UI; matches the submitted deck |
| Orchestration | Google ADK (TypeScript) with SkillToolset | Native Agent Skills support; Python fallback if needed |
| Capture | Playwright (Chromium) | Renders JavaScript storefronts, screenshots, network interception |
| Parsing | css-tree, parse5, Cheerio, @medv/finder | Class whitelist, server-side patching, stable selectors |
| Verification | pixelmatch, Playwright click tests | Detects layout damage and broken interactions |
| Validation | Zod (shared schemas), custom JSON-LD validator | One source of truth for every data shape |
| State | Firestore (Native mode) | Real-time listeners stream progress at no extra cost |
| Artifacts | Cloud Storage | Snapshots, assets, screenshots, images |
| Queue | Cloud Tasks | Decouples studio from 3–4 minute jobs |
| Hosting | Firebase Hosting → Cloud Run | CDN and custom domain |
| Secrets | Secret Manager | No keys in code or images |
| Build | Google Antigravity, Cloud Build, Artifact Registry | Mandatory IDE; CI/CD to Cloud Run |

### 3.2 Google AI models and their roles

| Model or API | Role in RankForge |
| --- | --- |
| Gemini 3.5 Flash | Keyword inference, competitor extraction, entity normalisation, explanations |
| Gemini 3.1 Pro | Visual CRO audit of screenshots, structure blueprint, arbiter, streaming section writer |
| Gemini Search Grounding | AI-cited competitor sources for the GEO view |
| Gemma (via Gemini API) | Fast, low-cost DOM cleaning and chunk classification |
| Nano Banana 2 / Nano Banana Pro | Improved and generated product imagery (with consent); Pro for the hero image |
| Cloud Natural Language API | Entity salience, sentiment, content classification |
| PageSpeed Insights API | Core Web Vitals, lab and field data |
| Gemini Omni (optional) | A short generated walkthrough clip of the optimised page; not used for auditing, since it is a video-generation model |

Update the deck so the Visual CRO agent is attributed to Gemini 3.1 Pro rather than Gemini Omni.

### 3.3 Design decisions

- **Patch, do not rebuild.** The optimised page is the reproduction plus an ordered patch set, so the store's own design and scripts are preserved.
- **Deterministic where it matters.** Scoring, validation, selectors and diffing are code; LLMs write and judge.
- **Progressive results.** Every stage writes to Firestore on completion; no stage blocks the display.
- **Isolated previews.** Trackers blocked, cart calls stubbed, store scripts confined to `rf-preview`.
- **Time budgets everywhere.** Every network step has a timeout and a fallback, so one slow site never stalls a live demo.

## 4. Workflows

One audit runs as a single job through nine stages, each writing its result to Firestore as soon as it finishes, so the studio fills progressively and never waits on the slowest step.

### 4.1 User journey

1. User opens the studio and pastes a product URL; the keyword field is optional.
2. If no keyword is given, the studio shows 3–5 candidate keywords within about 10 seconds; the user picks one.
3. The studio asks: "Generate improved product images?" (Yes / No). The answer is stored on the job.
4. The reproduced page appears in the left pane within about 20 seconds.
5. Competitor cards stream in as each of the 10 is analysed; skipped sites are shown as skipped.
6. Before-scores and findings appear, each tagged Ranking, Conversion or Both.
7. The blueprint appears as an outline of planned sections in the right pane.
8. The optimised page builds section by section in the right pane.
9. After-scores, the query map, schema panel and category check complete the view.
10. Agency users may copy a shareable preview link.

### 4.2 Audit pipeline

1. **Queue.** `POST /api/audits` validates the URL, creates `audits/{id}` with status `queued`, and enqueues a Cloud Task to the worker.
2. **Capture (target page).** Playwright renders the page at 390 px and 1440 px, scrolls to trigger lazy loading, blocks trackers, stubs non-GET requests, records assets, stores them via the proxy, detects platform and hydration mode, and writes the extraction package. Status `captured`.
3. **Keyword resolution.** Supplied keyword is used directly; otherwise Gemini 3.5 Flash proposes candidates from title, attributes and SERP overlap, and the job waits for the user's choice (status `awaiting_keyword`, 60-second default to the top candidate).
4. **Competitor discovery.** SERP API returns top 10 organic results, People Also Ask and related searches. Gemini with Search Grounding returns AI-cited sources in parallel.
5. **Competitor capture.** Up to 5 parallel Playwright sessions, 25-second budget each. A blocked or slow site is marked `skipped` and replaced from positions 11–15 until 7+ usable competitors exist.
6. **Analysis.** Four skills run in parallel: Entity & Query Gap, Technical & Schema, Visual CRO (top 3–5 competitors only), Trust & Category. Scoring runs in code. Status `analysed`.
7. **Blueprint.** CRO Playbook and Structure skills draft the section plan; the Arbiter resolves conflicts and maps each section to a store component. Status `blueprinted`.
8. **Streaming rebuild.** For each section in order: Gemini 3.1 Pro streams the content, the worker converts the finished section into patch operations, validates classes, and appends them to `outputs/patches`. The studio applies each section as it lands. Images are generated in parallel if consent was given.
9. **Verify.** The worker applies the full patch set in a fresh browser, runs pixel diff, console-error comparison and a click test, then re-scores. Status `complete`.

### 4.3 Failure paths

| Failure | Detection | Behaviour |
| --- | --- | --- |
| Target page blocks access | HTTP 403/429, challenge page, empty body | Status `blocked`; studio offers HTML paste |
| Target page too slow | 45 s render timeout | Retry once without images; then `blocked` |
| Competitor blocked or slow | 25 s budget exceeded | Mark `skipped`, backfill from positions 11–15 |
| Fewer than 5 usable competitors | Count after backfill | Continue, flag "low competitor confidence" |
| Gemini error or rate limit | 429 / 5xx | Exponential backoff, 3 retries, then fail stage with message |
| Generated class not in whitelist | Validator | Repair pass with whitelist; fall back to scoped style block |
| Patch breaks layout | Pixel diff > threshold or new console errors | Drop that section's patch, record in report |
| User never picks keyword | 60 s timer | Use top candidate automatically |

## 5. Agents and Agent Skills

The pipeline is one Google ADK root agent that runs stages in sequence, fans out in parallel where stages are independent, and loads 12 Agent Skills (SKILL.md folders) through ADK's SkillToolset. Deterministic work (scraping, scoring, validation, diffing) runs as plain function tools, never as LLM calls.

### 5.1 Agent graph

1. `RootAuditAgent` (SequentialAgent)
   1. `CaptureTool` (function tool, Playwright)
   2. `KeywordAgent` (LlmAgent, Gemini 3.5 Flash, skill `keyword-resolution`)
   3. `DiscoveryAgent` (ParallelAgent): `SerpTool` + `GroundingAgent` (skill `ai-citation-discovery`)
   4. `CompetitorCaptureTool` (function tool, 5 parallel sessions)
   5. `AnalysisAgent` (ParallelAgent): `EntityQueryGapAgent`, `TechSchemaAgent`, `VisualCroAgent`, `TrustCategoryAgent`
   6. `ScoringTool` (function tool, pure code)
   7. `BlueprintAgent` (SequentialAgent): `StructureAgent` → `ArbiterAgent`
   8. `RebuildLoop` (LoopAgent over blueprint sections): `SectionWriterAgent` → `PatchBuilderTool` → `ClassValidatorTool`
   9. `ImageStudioAgent` (runs alongside step 8 when consent = yes)
   10. `VerifyTool` (function tool: apply, diff, click test, re-score)

### 5.2 Skills

| Skill | Model | Input | Output (JSON schema) |
| --- | --- | --- | --- |
| `keyword-resolution` | Gemini 3.5 Flash | Title, attributes, H1, breadcrumbs | 3–5 keywords with intent and rationale |
| `ai-citation-discovery` | Gemini 3.5 Flash + Search Grounding | Keyword | Resolved URLs of AI-cited sources |
| `competitor-extraction` | Gemma (cleaning) + Gemini 3.5 Flash | Cleaned DOM per competitor | Sections, headings, entities, schema types, trust elements, image types, CTA positions |
| `entity-query-gap` | Gemini 3.5 Flash + NL API | Target and competitor entities, PAA, related searches | Missing entities with frequency; query sequence X → Y → Z with answered flag |
| `tech-schema-audit` | None (code) + Gemini 3.5 Flash for explanations | HTML, JSON-LD, PSI result | Findings with severity and evidence |
| `visual-cro-audit` | Gemini 3.1 Pro (vision) | Target and top 3–5 competitor screenshots | CRO findings with region coordinates for annotation |
| `trust-category` | NL API + Gemini 3.5 Flash | Reviews, copy, current category | Tone and trust score; recommended Google Product Taxonomy category |
| `cro-playbook` | Reference skill | Intent, findings | Applicable best-practice sections |
| `structure-blueprint` | Gemini 3.1 Pro | Consensus model, gaps, playbook, query map | Ordered sections with H2/H3, content type, depth, justification |
| `arbiter` | Gemini 3.1 Pro | Blueprint, conflicts, intent weights | Final blueprint + decision log; component mapping |
| `section-writer` | Gemini 3.1 Pro (streaming) | One blueprint section, component inventory, product data | Section HTML using whitelisted classes, Sample flags, annotation tags |
| `image-studio` | Nano Banana 2; Nano Banana Pro for hero | Store product photo, missing image types | Improved and generated images with captions |

### 5.3 Skill folder layout

```text
packages/skills/
  section-writer/
    SKILL.md            # name, description, step-by-step instructions
    references/
      writing-rules.md  # tone, length per section type, sample-review rules
      section-types.md  # spec table, FAQ, delivery block, reviews, trust row ...
    assets/
      output.schema.json
  cro-playbook/
    SKILL.md
    references/pdp-best-practices.md
  ...
```

### 5.4 Prompting rules (apply to every skill)

- Every LLM call returns JSON through `responseSchema`; no free-text parsing.
- Product facts (price, variants, specs) come only from captured page or platform data; the writer may not invent specifications.
- Sample reviews: 4–6 reviews, mixed 4 and 5 stars, varied length, one minor criticism, product-specific detail, each flagged `sample: true`.
- Certifications and badges shown only when 3+ competitors display them, each flagged `sample: true`.
- Section writer receives the full component inventory and may use only whitelisted classes.
- Temperature 0.2 for analysis skills, 0.7 for section writing.

### 5.5 Day-one verification

Confirm in Antigravity on day one that ADK for TypeScript supports SkillToolset, ParallelAgent and LoopAgent at the version you install. If any is missing, run the worker on ADK for Python and keep the web app in TypeScript; the SKILL.md folders load unchanged in both.

## 6. Data model and API contracts

Firestore holds job state and results that the studio listens to in real time; Cloud Storage holds every heavy artifact; the web service exposes five REST endpoints. All shapes are defined once as Zod schemas in `packages/schema` and shared by the web app and the worker.

### 6.1 Firestore

| Path | Key fields | Written by |
| --- | --- | --- |
| `workspaces/{wsId}` | name, ownerUid, createdAt | Web |
| `workspaces/{wsId}/stores/{storeId}` | domain, platform, label | Web |
| `audits/{auditId}` | wsId, url, keyword, keywordCandidates\[\], imageConsent, status, stage timings, platform, patchMode, scores{before, after}, error | Web, Worker |
| `audits/{auditId}/competitors/{cid}` | url, rank, source (organic or ai\_cited), status (ok or skipped), extraction summary | Worker |
| `audits/{auditId}/findings/{fid}` | category, tag (ranking, conversion, both), severity, title, evidence, competitorCount, region | Worker |
| `audits/{auditId}/queries/{qid}` | text, order, source (paa, related, generated), answeredBefore, answeredBySectionId | Worker |
| `audits/{auditId}/blueprint/{sectionId}` | order, type, h2, h3s\[\], depth, justification, componentRef, status (planned, writing, applied, dropped) | Worker |
| `audits/{auditId}/patches/{pid}` | sectionId, ops\[\], sampleFlags\[\], tags\[\] | Worker |
| `audits/{auditId}/images/{imgId}` | type, gcsPath, sourceImage, prompt, sample | Worker |

Status values: `queued`, `capturing`, `captured`, `awaiting_keyword`, `discovering`, `competitors`, `analysing`, `analysed`, `blueprinted`, `rebuilding`, `verifying`, `complete`, `blocked`, `failed`.

### 6.2 Cloud Storage layout

```text
gs://rankforge-artifacts/{auditId}/
  target/index.html          # rewritten snapshot
  target/assets/{hash}.{ext} # proxied CSS, JS, fonts, images
  target/screens/{mobile,desktop}.png
  target/extraction.json
  competitors/{cid}/extraction.json
  competitors/{cid}/screens/{mobile,desktop}.png
  optimised/index.html       # snapshot with full patch set applied
  optimised/screens/{mobile,desktop}.png
  images/{imgId}.png
  report.json
```

Apply a lifecycle rule deleting objects after 14 days.

### 6.3 REST endpoints (web service)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/audits` | Create audit: `{url, keyword?, imageConsent}` → `{auditId}` |
| POST | `/api/audits/{id}/keyword` | Submit chosen keyword |
| POST | `/api/audits/{id}/html` | HTML-paste fallback for blocked pages |
| GET | `/preview/{id}/{current or optimised}` | Serve sandboxed snapshot, `X-Robots-Tag: noindex` |
| POST | `/internal/tasks/run` | Cloud Tasks target on the worker, OIDC-authenticated |

The studio reads everything else directly from Firestore with real-time listeners, secured by rules allowing reads only to the workspace owner.

### 6.4 Patch operation schema

```json
{
  "sectionId": "sec_04_spec_table",
  "ops": [
    {
      "op": "insertAfter",
      "target": "#ProductInfo-main .product__description",
      "html": "<div class=\"product__accordion accordion\">...</div>",
      "tag": "both",
      "reason": { "ranking": "Adds 9 attributes present on 7 of 10 competitors", "conversion": "Answers sizing and material questions before purchase" },
      "sample": false
    }
  ]
}
```

Allowed `op` values: `setText`, `setAttr`, `insertBefore`, `insertAfter`, `move`, `remove`, `setHeadMeta`, `injectJsonLd`. Selectors are generated with `@medv/finder` from the captured DOM and re-verified before application.

## 7. Scoring model

Two scores out of 100, Visibility and Conversion, are computed in code from findings, and combined into one Page Performance Index. The same functions score the original page and the optimised page, so the before-and-after gain is measured, not estimated.

### 7.1 Visibility (ranking)

| Component | Points | Rule |
| --- | --- | --- |
| Product schema completeness and validity | 25 | Required and recommended Product, Offer, Brand, BreadcrumbList properties present and valid |
| Entity and attribute coverage | 20 | Share of consensus entities (present on 4+ competitors) found on page, salience-weighted |
| Core Web Vitals | 20 | PSI mobile: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; partial credit on a linear scale |
| Query-sequence coverage | 15 | Share of follow-up queries answered by a section or FAQ entry |
| On-page structure | 10 | Title, meta description, single H1 with primary entity, H2/H3 hierarchy, canonical |
| Image SEO | 10 | Alt text, descriptive filenames, 4+ images, hero preloaded |

### 7.2 Conversion

| Component | Points | Rule |
| --- | --- | --- |
| Add-to-cart experience | 25 | ATC above fold on mobile, sticky ATC on long pages, clear variant selection |
| Delivery, payment and returns reassurance | 20 | Delivery estimate or pincode check, COD and UPI shown, returns summary near CTA |
| Trust and proof | 20 | Review count near title, 4+ reviews visible, trust badges, tone-and-trust score |
| Price and offer clarity | 15 | MRP, selling price, discount and taxes stated near CTA |
| Friction and mobile usability | 20 | Tap targets 48 px+, no intrusive interstitials, readable font sizes, no layout shift near CTA |

### 7.3 Page Performance Index

```latex
\text{PPI} = \frac{\text{Visibility} \times \text{Conversion}}{100}
```

The product is deliberate: a page with strong visibility and no conversion path scores low, and so does a well-converting page nobody finds.

### 7.4 Evidence rules

- Every finding stores its evidence: the competitor count, the measured value, or the screenshot region.
- Sample-flagged elements (reviews, badges, certifications) count toward the after-score but are shown with a "Sample" marker next to the score, so the gain is never misrepresented.
- Visual CRO scores from Gemini are converted to points by fixed rubric rules, and the run is repeated once if the two results differ by more than 10 points; the average is used.

## 8. Google Cloud infrastructure and deployment

The prototype runs as three Cloud Run services in `asia-south1` (Mumbai), behind Firebase Hosting, with Firestore, Cloud Storage, Cloud Tasks and Secret Manager. Every command below assumes `PROJECT_ID` and `REGION=asia-south1` are exported.

### 8.1 Services

| Service | Purpose | Config |
| --- | --- | --- |
| `rf-web` | Next.js studio and REST API | 1 GiB, 1 vCPU, concurrency 80, public |
| `rf-worker` | Playwright capture, ADK agents, patching, verification | 4 GiB, 2 vCPU, concurrency 1, timeout 900 s, private |
| `rf-preview` | Serves snapshots from Cloud Storage on a separate origin, `noindex` | 512 MiB, concurrency 80, public |

`rf-preview` sits on its own `*.run.app` origin so reproduced store JavaScript never runs on the studio's origin. The studio embeds it in a sandboxed iframe.

### 8.2 One-time setup

```bash
gcloud config set project $PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com storage.googleapis.com \
  cloudtasks.googleapis.com secretmanager.googleapis.com language.googleapis.com \
  pagespeedonline.googleapis.com firebasehosting.googleapis.com

gcloud artifacts repositories create rankforge --repository-format=docker --location=$REGION
gcloud firestore databases create --location=$REGION
gcloud storage buckets create gs://$PROJECT_ID-artifacts --location=$REGION
gcloud tasks queues create audit-queue --location=$REGION \
  --max-concurrent-dispatches=3 --max-attempts=1

printf '%s' "$GEMINI_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-
printf '%s' "$SERP_KEY"   | gcloud secrets create SERP_API_KEY --data-file=-
printf '%s' "$PSI_KEY"    | gcloud secrets create PSI_API_KEY --data-file=-
```

### 8.3 Service accounts and IAM

| Account | Roles |
| --- | --- |
| `rf-web` | `roles/datastore.user`, `roles/cloudtasks.enqueuer`, `roles/iam.serviceAccountUser` on `rf-tasks`, `roles/secretmanager.secretAccessor` |
| `rf-worker` | `roles/datastore.user`, `roles/storage.objectAdmin` on the artifacts bucket, `roles/secretmanager.secretAccessor`, `roles/serviceusage.serviceUsageConsumer` |
| `rf-tasks` | `roles/run.invoker` on `rf-worker` (used for the OIDC token on each task) |
| `rf-preview` | `roles/storage.objectViewer` on the artifacts bucket |

### 8.4 Worker image

```dockerfile
# Pin to an exact Playwright release that matches package.json
FROM mcr.microsoft.com/playwright:v1.XX.0-noble
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY dist ./dist
COPY packages/skills ./skills
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
```

### 8.5 Deploy commands

```bash
IMG=$REGION-docker.pkg.dev/$PROJECT_ID/rankforge

gcloud run deploy rf-worker --image=$IMG/worker:latest --region=$REGION \
  --service-account=rf-worker@$PROJECT_ID.iam.gserviceaccount.com \
  --memory=4Gi --cpu=2 --concurrency=1 --timeout=900 --cpu-boost \
  --min-instances=0 --max-instances=10 --no-allow-unauthenticated \
  --set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest,SERP_API_KEY=SERP_API_KEY:latest,PSI_API_KEY=PSI_API_KEY:latest \
  --set-env-vars=BUCKET=$PROJECT_ID-artifacts

gcloud run deploy rf-web --image=$IMG/web:latest --region=$REGION \
  --service-account=rf-web@$PROJECT_ID.iam.gserviceaccount.com \
  --memory=1Gi --concurrency=80 --allow-unauthenticated \
  --set-env-vars=WORKER_URL=<rf-worker URL>,TASKS_QUEUE=audit-queue,PREVIEW_ORIGIN=<rf-preview URL>

gcloud run deploy rf-preview --image=$IMG/preview:latest --region=$REGION \
  --service-account=rf-preview@$PROJECT_ID.iam.gserviceaccount.com \
  --memory=512Mi --allow-unauthenticated --set-env-vars=BUCKET=$PROJECT_ID-artifacts
```

On demo day, set `--min-instances=1` on `rf-worker` and `rf-web` to remove cold starts, then set them back to 0.

### 8.6 Long-running jobs

Cloud Run allocates CPU only while a request is open, so the worker keeps the Cloud Tasks request open for the whole audit. When creating each task, set `dispatchDeadline` to 900 s (the HTTP-target maximum is 30 minutes) and attach an OIDC token for `rf-tasks`. The worker writes progress to Firestore throughout, so the studio never depends on the task response.

### 8.7 Firebase Hosting

```json
{ "hosting": { "public": "public",
  "rewrites": [ { "source": "**", "run": { "serviceId": "rf-web", "region": "asia-south1" } } ] } }
```

Confirm that Hosting rewrites support `asia-south1` when you set this up; if not, point the custom domain straight at `rf-web` with a Cloud Run domain mapping.

### 8.8 Firestore security rules

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /audits/{id}/{document=**} {
      allow read: if request.auth != null
        && get(/databases/$(db)/documents/audits/$(id)).data.ownerUid == request.auth.uid;
      allow write: if false; // only the services write, via Admin SDK
    }
    match /workspaces/{ws}/{document=**} {
      allow read, write: if request.auth != null
        && get(/databases/$(db)/documents/workspaces/$(ws)).data.ownerUid == request.auth.uid;
    }
  }
}
```

Add `ownerUid` to each audit document at creation. For a judge-facing demo without sign-in, use Firebase anonymous auth so the same rules apply.

### 8.9 CI/CD

A Cloud Build trigger on `main` builds the three images, pushes them to Artifact Registry, and deploys them with the commands above. A second trigger on `staging` deploys to `-staging` service names for rehearsals. Keep `cloudbuild.yaml` at the repo root, one build step per image and one deploy step per service.

## 9. Antigravity build playbook

Build the whole prototype inside Google Antigravity by giving its agent a fixed rules file, a set of development skills, and one scoped prompt per build task, always in Planning mode, with a human reviewing each implementation plan before execution. Antigravity drives the code; the five team members drive the decisions.

### 9.1 Workspace setup

1. One shared GitHub repository, opened as the Antigravity workspace by every team member on their own branch.
2. Add the rules file (9.2) at the workspace rules location, so every agent session starts with the same constraints.
3. Add development skills to `.agent/skills/` (the Antigravity workspace skills folder): an ADK skill, a Playwright skill and a Cloud Run deploy skill. Google's official agent-skills repository and community ADK skills can be copied in unchanged.
4. Keep the product's runtime skills in `packages/skills/`; these are loaded by ADK at runtime, not by Antigravity.
5. Authenticate the `gcloud` CLI inside the workspace terminal so the agent can run deploy commands you approve.

### 9.2 Rules file

```markdown
# RankForge rules for every agent session
- Stack: pnpm monorepo, TypeScript strict, Next.js App Router (apps/web),
  Node worker with Playwright + Google ADK (services/worker), Zod schemas in packages/schema.
- Never invent a data shape: import it from packages/schema; add new shapes there first.
- All LLM calls return JSON via responseSchema. No free-text parsing.
- Scoring, validation, diffing and selectors are deterministic code, never LLM calls.
- Every pipeline stage writes status + results to Firestore before moving on.
- Every network step has a timeout and a documented fallback.
- Secrets come from environment variables bound to Secret Manager. Never hard-code keys.
- Write unit tests for packages/scoring and packages/schema; run them before finishing.
- Before finishing a task: lint, typecheck, test, and update docs/CHANGELOG.md.
- Ask before running any gcloud command that creates, deletes or deploys resources.
```

### 9.3 Working method

- **Planning mode for every task.** Read the implementation plan the agent produces, correct it, then approve.
- **One task per session**, sized to finish in one sitting. Large tasks drift.
- **Review the walkthrough and diff** before merging; never merge unread agent code into `main`.
- **Use the agent's browser** to test the studio after each UI task: submit a corpus URL and watch the run.
- **Keep a `docs/` folder** with this document exported to Markdown, so the agent can read the architecture.

### 9.4 Build prompts, in order

Paste each prompt as written, after the previous task is merged. Each references this document's sections.

1. **Monorepo.** "Create a pnpm monorepo with apps/web (Next.js App Router, Tailwind, shadcn/ui), services/worker (Node 20, TypeScript), packages/schema (Zod), packages/scoring, packages/skills. Add lint, typecheck and vitest at the root. Read docs/architecture.md sections 6 and 8 first."
2. **Schemas.** "Implement every Firestore document shape in docs section 6.1 and the patch schema in 6.4 as Zod schemas with inferred types. Add tests."
3. **Job flow stub.** "Implement POST /api/audits, Cloud Tasks enqueue with OIDC and dispatchDeadline 900 s, and a worker /internal/tasks/run endpoint that walks the job through every status in section 6.1 with 2-second sleeps, writing to Firestore. Build a studio page that shows the status timeline live."
4. **Capture engine.** "Implement CaptureTool in the worker per section 4.2 step 2: Playwright render at 390 and 1440 px, lazy-load scroll, tracker deny list, non-GET stubbing, asset proxy to Cloud Storage with URL rewriting, platform detection, hydration detection, extraction package, component inventory and CSS class whitelist via css-tree. Write extraction.json and screenshots to the layout in 6.2."
5. **Preview service.** "Implement rf-preview: serve gs snapshots by auditId with X-Robots-Tag noindex. Embed current and optimised previews side by side in the studio in sandboxed iframes with synchronised scrolling and a mobile/desktop toggle."
6. **Discovery.** "Implement SerpTool (top 10 organic, People Also Ask, related searches) and GroundingAgent with skill ai-citation-discovery, resolving grounding redirect URLs. Display the Search entry point as Google requires."
7. **Competitor capture.** "Implement CompetitorCaptureTool: 5 parallel sessions, 25 s budget, skip and backfill from positions 11 to 15, competitor-extraction skill with Gemma cleaning. Stream competitor cards to the studio."
8. **Analysis.** "Implement the four analysis agents in section 5.2 as a ParallelAgent and the scoring functions in section 7 in packages/scoring with full tests."
9. **Blueprint.** "Implement cro-playbook, structure-blueprint and arbiter skills per sections 5.2 and 5.4. Write the blueprint to Firestore and show it as an outline in the studio."
10. **Streaming rebuild.** "Implement the RebuildLoop: section-writer with streaming, PatchBuilderTool, ClassValidatorTool with repair pass, server and runtime patch modes. Apply each section in the optimised preview as it lands, with Ranking/Conversion/Both annotation tags and Sample badges."
11. **Images.** "Implement image-studio with Nano Banana 2 and Nano Banana Pro for the hero, only when imageConsent is true."
12. **Verify.** "Implement VerifyTool: apply full patch set in a fresh browser, pixelmatch diff, console-error comparison, click test on variant selector and gallery, re-score, write after-scores."
13. **Panels.** "Build the score, query-sequence, competitor, category and schema panels and the evidence pop-overs."
14. **Deploy.** "Write the three Dockerfiles and cloudbuild.yaml per section 8, then show me the deploy commands before running them."
15. **Hardening.** "Run the corpus runner script across docs/corpus.csv, collect failures into docs/failures.md grouped by cause, and propose fixes."

## 10. Phased build plan

The build runs in eight phases; Phase 1 (capture and reproduction) is the critical path, and Phases 1, 2 and the studio shell run in parallel once Phase 0 is done. Workstreams: **A** architecture, scoring and orchestration; **B** capture, infrastructure and deployment; **C** agents, skills and prompts; **D** studio front end; **E** corpus, QA, demo and pitch.

| Phase | Goal | Key deliverables | Exit criterion | Lead | Antigravity prompts |
| --- | --- | --- | --- | --- | --- |
| 0 Foundations | Remove setup blockers | GCP project, secrets, monorepo, schemas, job-flow stub, 50-URL corpus | Stub job shows every status live in the studio | A, B, E | 1–3 |
| 1 Capture | Reproduce any product page faithfully | Playwright worker, asset proxy, tracker blocking, platform and hydration detection, extraction, preview service | 90% of corpus reproduces with no visible difference; gallery and variants work | B | 4–5 |
| 2 Competitors | Know what top competitors do | SERP + grounding discovery, parallel capture with backfill, extraction, consensus model | 7+ usable competitors per corpus URL within budget | B, C | 6–7 |
| 3 Analysis | Explain both failures with evidence | Four analysis skills, query map, scoring package | Scores repeat within ±3 points; every finding has evidence | A, C | 8 |
| 4 Blueprint | Design the page it should be | CRO playbook, structure blueprint, arbiter, component mapping | Every section traces to a finding, competitor pattern or playbook rule | C | 9 |
| 5 Rebuild | Transform the page live | Streaming section writer, patch builder, class validator, images, verify | Full rebuild without breaking layout; after-scores measured | A, C | 10–12 |
| 6 Studio | Make results self-explanatory | Timeline, side-by-side, annotations, all panels, share link | A newcomer explains both failures after one run | D | 5, 13 |
| 7 Hardening | Survive any judge URL | Corpus runs, failure fixes, caching, cost caps, warm instances, rehearsal, backup video, deck update | 9 of 10 unseen URLs complete end to end | E, all | 14–15 |

Phase 6 starts in Phase 0 against mock Firestore data, so the studio is ready when real results arrive. Assign the strongest engineer to Phase 1.

## 11. Testing, QA and demo readiness

The prototype is ready for the live demo when 9 of 10 product URLs the team has never seen complete end to end within the performance budgets below, and a cached fallback and backup video are in place.

### 11.1 Test corpus

50 product URLs in `docs/corpus.csv`, refreshed with 20 new unseen URLs before the final rehearsal.

| Platform | URLs | Categories to cover |
| --- | --- | --- |
| Shopify (Dawn and custom themes) | 20 | Apparel, beauty, home, electronics accessories |
| WooCommerce | 12 | Food, handicrafts, wellness |
| Magento / Adobe Commerce | 6 | Electronics, appliances |
| Custom and headless (Next.js, Hydrogen) | 8 | Large D2C brands |
| Marketplaces as targets (expected to block) | 4 | Verifies the blocked path and HTML paste |

### 11.2 Test layers

- **Unit:** `packages/scoring` and `packages/schema` with vitest; every scoring rule has a pass and a fail case.
- **Golden snapshots:** 5 saved pages with known findings; any scoring change that moves a golden score by more than 3 points fails CI.
- **Corpus runner:** a script that submits every corpus URL, records stage timings, failures and scores to `docs/corpus-results.csv`.
- **Visual regression:** pixel diff between live page screenshot and reproduction for every corpus URL; threshold 2% of pixels.
- **Studio check:** Antigravity's browser agent runs one full audit after every UI change.

### 11.3 Performance budgets

| Milestone | Budget |
| --- | --- |
| Reproduced page visible | 20 s |
| Keyword candidates shown (when needed) | 10 s |
| Competitor cards streaming | 60 s |
| Before-scores and findings | 90 s |
| First rebuilt section applied | 120 s |
| Rebuild and after-scores complete | 240 s |

### 11.4 Demo-day checklist

- [ ] `rf-web` and `rf-worker` at min-instances 1, one hour before the slot
- [ ] Gemini, SERP and PSI quotas checked; per-run spending cap active
- [ ] Three cached showcase audits ready to open instantly
- [ ] Backup screen recording of a full run on a laptop, offline
- [ ] Two warm-up runs completed on the venue network
- [ ] Deck updated: Gemini 3.1 Pro for visual CRO; model roles match the build

### 11.5 Demo script (5 minutes)

1. **0:00 The problem.** Two questions every merchant asks: why am I not ranking, why am I not converting.
2. **0:30 Live run.** Paste the judge's URL (or a prepared one). Show the reproduction appearing with the store's own design.
3. **1:15 Competitors.** Cards stream in; point to skipped sites handled automatically.
4. **1:45 Diagnosis.** Before-scores; open three findings, one Ranking, one Conversion, one Both, with evidence.
5. **2:30 Rebuild.** Narrate as sections land: spec table, delivery and COD block, sample reviews with labels, FAQ answering the query sequence.
6. **3:45 Result.** After-scores and Page Performance Index; schema panel; category correction.
7. **4:15 Google stack.** Antigravity, ADK Agent Skills, Gemini 3.5 Flash and 3.1 Pro, Gemma, Nano Banana, Search Grounding, Cloud Run.
8. **4:45 Close.** Who it serves: store owners and agencies.

## 12. Risks, costs and appendices

The largest risk is unreliable reproduction on unfamiliar stores, which is why Phase 1 is the critical path; total spend for build and rehearsals should stay between ₹10,000 and ₹25,000, largely covered by hackathon credits.

### 12.1 Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Reproduction breaks on a judge's URL | Demo fails at step one | Corpus of 70 URLs across platforms; HTML-paste fallback; cached showcase runs |
| Hydrated storefront discards patches | Optimised view looks unchanged | Runtime patch mode with MutationObserver re-apply; sentinel test decides mode |
| Competitor sites block capture | Thin competitor model | Skip and backfill from positions 11–15; low-confidence flag below 5 |
| Gemini quota or latency spike | Rebuild stalls on stage | Queue concurrency 3; retries with backoff; min-instances 1 on demo day |
| Generated sections break theme layout | Visual damage in preview | Class whitelist, repair pass, pixel-diff rejection per section |
| Run exceeds 4 minutes | Judges lose attention | Visual audit on top 3–5 only; streaming display; parallel stages |
| ADK TypeScript lacks a needed agent type | Orchestration rework | Day-one check; fall back to ADK Python worker |
| Venue network unreliable | Live run fails | Mobile hotspot backup; offline recording |

### 12.2 Costs (approximate, verify on Google's pricing pages)

| Item | Per audit | Build and rehearsal period |
| --- | --- | --- |
| Gemini 3.5 Flash, 3.1 Pro and Gemma | ₹20–45 | ₹6,000–13,500 at about 300 runs |
| Nano Banana images (only with consent) | ₹10–25 | ₹1,500–4,000 |
| SERP data API | ₹1–3 | ₹300–900 |
| Natural Language and PageSpeed Insights APIs | Negligible | Under ₹500 |
| Cloud Run, Firestore, Storage, Tasks, Hosting | Negligible | ₹1,000–3,000 |
| **Total** | **₹30–75** | **₹10,000–25,000** |

### 12.3 Repository structure

```text
rankforge/
  apps/web/                 # Next.js studio + REST API
  services/worker/          # Playwright, ADK agents, tools, server.ts
    src/tools/              # capture, competitors, patch, validate, verify, serp, psi
    src/agents/             # root, discovery, analysis, blueprint, rebuild
  services/preview/         # snapshot server for rf-preview
  packages/schema/          # Zod schemas shared by all services
  packages/scoring/         # deterministic scoring + tests
  packages/skills/          # runtime SKILL.md folders loaded by ADK
  .agent/skills/            # Antigravity development skills
  docs/                     # this document, corpus.csv, results, failures
  cloudbuild.yaml
```

### 12.4 Environment variables

| Variable | Service | Source |
| --- | --- | --- |
| `GEMINI_API_KEY` | worker | Secret Manager |
| `SERP_API_KEY` | worker | Secret Manager |
| `PSI_API_KEY` | worker | Secret Manager |
| `BUCKET` | worker, preview | Env var |
| `WORKER_URL` | web | Env var |
| `TASKS_QUEUE`, `TASKS_SA` | web | Env var |
| `PREVIEW_ORIGIN` | web | Env var |
| `NEXT_PUBLIC_FIREBASE_*` | web | Env var (public client config) |

### 12.5 Glossary

| Term | Meaning |
| --- | --- |
| GEO | Generative engine optimisation: being cited in AI answers such as AI Overviews |
| CRO | Conversion rate optimisation |
| PDP | Product detail page |
| Query sequence | The follow-up queries shoppers ask after the main query, in order |
| Consensus model | Elements present on most analysed competitors |
| Patch set | Ordered DOM operations that turn the reproduction into the optimised page |
| Server / runtime mode | Patching before scripts run vs after the storefront hydrates |
| Sample flag | Marks visualisation-only content such as placeholder reviews |
| PPI | Page Performance Index = Visibility × Conversion ÷ 100 |
