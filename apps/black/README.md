# BLACK Edition (black.getservices.ai)

Static front end for BLACK™, the dark-and-gold executive edition of GetServices.ai, powered by the RAMBO router.

| File | Purpose |
|---|---|
| `index.html` | Landing page with the **Unlock BLACK** button, unlock modal and the live "Your agents, at work" executive showcase (inline SVG + ~3 KB JS, no images) |
| `app.html` | BLACK Console: briefs, Fast / Smart / Deep / Executive modes, routing trail |
| `config.js` | Runtime config (`apiBase`, `applicationId`, `studioUrl`) |
| `assets/black.css` | Shared dark + gold design tokens and components |
| `assets/unlock.js` | Unlock flow (preview access; billing comes later) |
| `assets/app.js` | Console logic; calls `POST /v1/responses` (streamed) and shows the Live Engines panel |
| `assets/workspace.js` / `workspace.css` | Command Workspace on the console home: live slides for net worth, stocks, crypto, strategic portfolio, allocation, assets, meetings and statements, activity (demo data) |
| `functions/v1/responses.js` | Live gateway (Claude, GPT, Gemini, Perplexity, Grok) |

## How the unlock works today
- **Unlock BLACK** opens the modal; **Enter BLACK** grants preview access in that browser and opens the console.
- `https://black.getservices.ai/?unlock=1` opens the modal directly. The AI Studio "Black Edition" button links here.
- Payment is not wired yet. The access check is client-side only and is not a paywall.

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
  - `BLACK_ACCESS_CODE` (required)
  - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `XAI_API_KEY`
  - Optional model overrides: `ANTHROPIC_MODEL`, `OPENAI_MODEL_DEEP` and so on (see the top of the function file).
- Users enter the access code by tapping the status badge in the console. Without it they stay in Preview mode.
- NotebookLM isn't included because it has no public API for answering questions.

## Deploy (Cloudflare Pages)
- Connect this repo, set **root directory** to `apps/black`, no build command, output directory `/`.
- Add custom domain `black.getservices.ai`. Only the `black` CNAME is added; leave the app., api., root and mail records alone.

## Local preview
```bash
cd apps/black && python3 -m http.server 8090
# open http://localhost:8090
```
