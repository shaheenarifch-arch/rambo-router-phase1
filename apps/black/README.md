# BLACK Edition (black.getservices.ai)

Static front end for BLACK™, the dark-and-gold executive edition of GetServices.ai, powered by the RAMBO router.

| File | Purpose |
|---|---|
| `index.html` | Landing page with the **Unlock BLACK** button, unlock modal and the live "Your agents, at work" executive showcase (inline SVG + ~3 KB JS, no images) |
| `app.html` | BLACK Console: briefs, Fast / Smart / Deep / Executive modes, routing trail |
| `config.js` | Runtime config (`apiBase`, `applicationId`, `studioUrl`) |
| `assets/black.css` | Shared dark + gold design tokens and components |
| `assets/unlock.js` | Unlock flow (plan buttons open the console checkout) |
| `assets/plan.js` | Plan & billing panel in the console: sign-in prompt, 7-day free trial checkout, usage meters, Manage billing |
| `functions/_lib/plan.js` | Server-side plan check: GetServices sign-in, BLACK plan from ATLAS, monthly brief allowances counted in `BLACK_DB` |
| `assets/app.js` | Console logic; calls `POST /v1/responses` (streamed) and shows the Live Engines panel |
| `assets/workspace.js` / `workspace.css` | Command Workspace on the console home: live slides for net worth, stocks, crypto, strategic portfolio, allocation, assets, meetings and statements, activity (demo data) |
| `assets/attach.js` | Excel/CSV upload: read in the browser with SheetJS (cdnjs, loaded on first use); a compact data summary is added to the brief. Nothing is stored server side |
| `assets/calendar.js` / `calendar.css` | Sign-in with the GetServices account, scheduling confirmation cards, calendar drawer, calendar context for briefs |
| `functions/v1/me/[[path]].js` | Account + BLACK Calendar API (D1): login proxy to ATLAS, events, scheduling proposals, iCal import, subscribe feed |
| `functions/v1/responses.js` | Live gateway (Claude, GPT, Gemini, Perplexity, Grok) |

## How the unlock works today
- **Unlock BLACK** opens the modal; **Enter BLACK** grants preview access in that browser and opens the console.
- `https://black.getservices.ai/?unlock=1` opens the modal directly. The AI Studio "Black Edition" button links here.
- Plans: **Starter $99/mo** and **Pro $299/mo** with a 7-day free trial, and **Enterprise** by enquiry. Billing is Stripe through ATLAS (`atlas-api` `src/black-billing.js`). The gateway checks the signed-in user's plan and allowance on every brief.

## Live answers
`functions/v1/responses.js` is a Cloudflare Pages Function on this same project, so the console calls it at `/v1/responses` on the same domain.
- **GET** returns which engines are configured. **POST** takes the RAMBO request shape and returns the RAMBO response shape.
- Routing follows RAMBO's rules: classify the task, pick the engine, fall back to the next one if it fails.
  Code goes to GPT, strategy and writing to Claude, market research to Perplexity then Grok, and extraction to Gemini.
- **Executive** mode runs up to three engines in parallel. Claude merges their answers and flags where they disagree.
- **Live stream:** POST with `"stream": true` returns Server-Sent Events (`route`, `engine`, `delta`, `switch`, `synth`, `done`, `error`) so the console shows each engine working, model switches and text as it is written.
- Each engine gets 45s in a live brief. A slow engine is skipped (or kept as a partial answer) instead of failing the brief. Empty answers are dropped before synthesis.
- **Fast** and **Smart** give quick answers (under ~120 words) with key data, one inline chart when numbers matter, and up to 3 source links. **Full report →** re-runs the brief in Deep mode. Deep and Executive stay detailed.
- Synthesis uses the Smart model tier for speed. Set `SYNTH_TIER=deep` to use the Deep tier.
- Add these secrets in Cloudflare (Pages > black-edition > Settings > Variables and secrets). Any engine without a key is skipped.
  - `BLACK_DB` binding (required for plans: counts briefs per billing period); `ATLAS_API_URL` optional
  - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `XAI_API_KEY`
  - Optional model overrides: `ANTHROPIC_MODEL`, `OPENAI_MODEL_DEEP` and so on (see the top of the function file).
- Live answers need a signed-in GetServices account with an active BLACK plan; the status badge opens Plan & billing. Owners: set `BLACK_OWNER_EMAILS` on ATLAS for unlimited access.
- NotebookLM isn't included because it has no public API for answering questions. Briefs with an attached spreadsheet or bank statement use the Docs Analyst route instead (Gemini first, then Claude and GPT).

## Deploy (Cloudflare Pages)
- Connect this repo, set **root directory** to `apps/black`, no build command, output directory `/`.
- Add custom domain `black.getservices.ai`. Only the `black` CNAME is added; leave the app., api., root and mail records alone.

## Local preview
```bash
cd apps/black && python3 -m http.server 8090
# open http://localhost:8090
```

## BLACK Calendar (setup)
1. **D1 database:** Cloudflare → Storage & Databases → D1 → Create `black-calendar`. Then Pages → black-edition → Settings → Bindings → add **D1 database**, variable name `BLACK_DB`. Tables are created automatically on first use.
2. **Secret `TOKEN_KEY`:** any long random string. It encrypts each user's private iCal address.
3. **Optional `ATLAS_API_URL`:** defaults to the live ATLAS API.
4. Redeploy.
- Sign-in uses the GetServices (ATLAS) account. Email and password go through `/v1/me/login`, server to server.
- Google and Microsoft sign-in need `https://black.getservices.ai` in ATLAS's allowed origins (atlas-api PR).
- Scheduling briefs ("schedule…", "move…", "cancel…") open a confirmation card. Nothing is saved until **Create**.
- Calendar questions ("what's on tomorrow?") send the next 14 days of events to the engines as context.
- Not included yet: email invites (Phase 2) and reminders (Phase 3).
