# BLACK Edition (black.getservices.ai)

Static front end for BLACK™, the dark-and-gold executive edition of GetServices.ai, powered by the RAMBO router.

| File | Purpose |
|---|---|
| `index.html` | Landing page with the **Unlock BLACK** button and unlock modal |
| `app.html` | BLACK Console: briefs, Fast / Smart / Deep / Executive modes, routing trail |
| `config.js` | Runtime config (`apiBase`, `applicationId`, `studioUrl`) |
| `assets/black.css` | Shared dark + gold design tokens and components |
| `assets/unlock.js` | Unlock flow (preview access; billing comes later) |
| `assets/app.js` | Console logic; calls `POST {apiBase}/v1/responses` |

## How the unlock works today
- **Unlock BLACK** opens the modal; **Enter BLACK** grants preview access in that browser and opens the console.
- `https://black.getservices.ai/?unlock=1` opens the modal directly. The AI Studio "Black Edition" button links here.
- Payment is not wired yet. The access check is client-side only and is not a paywall.

## Preview vs live
- `apiBase` empty → **Preview mode**: no model is called; each answer shows how the brief would be routed.
- `apiBase` set → the console sends briefs to the RAMBO gateway with `credentials: "include"`.
  Do not put the RAMBO API key in the browser. Put a small proxy (e.g. a Cloudflare Worker) in front of RAMBO that checks the GetServices.ai login and adds `x-api-key`. The RAMBO API also needs CORS enabled for `https://black.getservices.ai` (it is `origin:false` today).

## Deploy (Cloudflare Pages)
- Connect this repo, set **root directory** to `apps/black`, no build command, output directory `/`.
- Add custom domain `black.getservices.ai`. Only the `black` CNAME is added; leave the app., api., root and mail records alone.

## Local preview
```bash
cd apps/black && python3 -m http.server 8090
# open http://localhost:8090
```
