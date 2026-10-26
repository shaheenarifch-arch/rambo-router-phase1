/*
 * BLACK Edition runtime config.
 * apiBase: where the gateway lives. Empty = same origin (functions/v1/responses.js on this
 *          Cloudflare Pages project). Never put API keys here — they are Cloudflare secrets.
 * studioUrl: where "Back to Studio" points.
 */
window.BLACK_CONFIG = {
  apiBase: "",
  applicationId: "black",
  studioUrl: "https://studio.getservices.ai"
};
