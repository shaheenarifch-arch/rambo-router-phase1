/*
 * BLACK Edition runtime config.
 * apiBase: URL of the RAMBO gateway proxy that serves POST /v1/responses.
 *          Leave empty to run the console in Preview mode (no live answers).
 *          Never put a RAMBO API key here — the proxy adds it server-side.
 * studioUrl: where "Back to Studio" points.
 */
window.BLACK_CONFIG = {
  apiBase: "",
  applicationId: "black",
  studioUrl: "https://studio.getservices.ai"
};
