/*
 * BLACK live gateway — Cloudflare Pages Function at /v1/responses.
 *
 * GET  /v1/responses  -> { live, engines }  (which engines have keys configured)
 * POST /v1/responses  -> RAMBO-shaped response (same contract as rambo-router-phase1 responses.ts)
 *
 * Secrets (Cloudflare Pages > black-edition > Settings > Variables and secrets):
 *   BLACK_ACCESS_CODE   required: briefs must send header x-black-access with this value
 *   ANTHROPIC_API_KEY   Claude
 *   OPENAI_API_KEY      GPT
 *   GEMINI_API_KEY      Gemini
 *   PERPLEXITY_API_KEY  Perplexity (live web search)
 *   XAI_API_KEY         Grok (xAI)
 * Optional model overrides: ANTHROPIC_MODEL, ANTHROPIC_MODEL_DEEP, ANTHROPIC_MODEL_FAST,
 *   OPENAI_MODEL, OPENAI_MODEL_DEEP, OPENAI_MODEL_FAST, GEMINI_MODEL, GEMINI_MODEL_FAST,
 *   XAI_MODEL, XAI_MODEL_DEEP, XAI_MODEL_FAST.
 * Engines without a key are skipped; routing falls back to the next configured engine.
 */

const DEFAULT_MODELS = {
  anthropic: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5", deep: "claude-opus-5-5" },
  openai: { fast: "gpt-5.4-mini", smart: "gpt-5.6-sol", deep: "gpt-5.6-sol" },
  gemini: { fast: "gemini-4-argon", smart: "gemini-4-argon", deep: "gemini-4-argon" },
  perplexity: { fast: "fast", smart: "medium", deep: "high" }, // Agent API "effort" levels
  xai: { fast: "grok-4-1-fast-non-reasoning", smart: "grok-4.6", deep: "grok-4.6" }
};

const LABEL = { anthropic: "Claude", openai: "GPT", gemini: "Gemini", perplexity: "Perplexity", xai: "Grok" };

// Same deterministic rules as RAMBO's TaskClassifier (classifier.ts).
const RULES = [
  [/\b(debug|error|exception|stack trace|fails?)\b/i, "debugging"],
  [/\b(code|typescript|javascript|python|api|function|class)\b/i, "coding"],
  [/\b(architecture|system design|database schema|microservice)\b/i, "architecture"],
  [/\b(seo|keyword|meta description|search ranking)\b/i, "seo_content"],
  [/\b(product|supplier|listing|sku|catalog)\b/i, "product_research"],
  [/\b(market|competitor|trend)\b/i, "market_analysis"],
  [/\b(strategy|business plan|roadmap|launch)\b/i, "business_strategy"],
  [/\b(summarize|summary)\b/i, "summarization"],
  [/\b(extract|parse|fields?)\b/i, "extraction"]
];
const TASKS = new Set(RULES.map((r) => r[1]).concat("general_chat"));

// Preferred engine order per task. The first engine with a key wins; the rest are fallbacks.
const ROUTES = {
  coding: ["openai", "anthropic", "gemini"],
  debugging: ["openai", "anthropic", "gemini"],
  architecture: ["anthropic", "openai", "gemini"],
  business_strategy: ["anthropic", "openai", "gemini"],
  market_analysis: ["perplexity", "xai", "gemini", "anthropic", "openai"],
  product_research: ["perplexity", "gemini", "xai", "openai", "anthropic"],
  seo_content: ["anthropic", "perplexity", "openai", "gemini"],
  summarization: ["anthropic", "gemini", "openai"],
  extraction: ["gemini", "openai", "anthropic"],
  general_chat: ["anthropic", "openai", "gemini", "xai", "perplexity"]
};
const REASON = {
  coding: "CODING_SPECIALIST", debugging: "CODING_SPECIALIST", architecture: "DEEP_REASONING",
  business_strategy: "EXECUTIVE_WRITING", market_analysis: "LIVE_WEB_RESEARCH", product_research: "LIVE_WEB_RESEARCH",
  seo_content: "LONG_FORM_WRITING", summarization: "SYNTHESIS", extraction: "STRUCTURED_EXTRACTION", general_chat: "GENERAL_DEFAULT"
};

const SYSTEM =
  "You are BLACK, the executive AI of GetServices.ai. Answer for a busy executive: lead with the answer or recommendation, " +
  "then the reasoning, risks and next steps. Use short markdown sections (### headings) and bullet points. Be specific and concise. " +
  "If you are unsure or lack current data, say so plainly instead of guessing.";

const MAX_MESSAGES = 12;
const MAX_CHARS = 24000;
const TIMEOUT_MS = 55000;

export async function onRequestGet({ env }) {
  return json({ live: engines(env).length > 0 && !!env.BLACK_ACCESS_CODE, engines: engines(env).map((e) => LABEL[e]) });
}

export async function onRequestPost({ request, env }) {
  if (!env.BLACK_ACCESS_CODE) return json({ error: "GATEWAY_NOT_CONFIGURED" }, 503);
  if (!safeEqual(request.headers.get("x-black-access") || "", env.BLACK_ACCESS_CODE)) return json({ error: "ACCESS_DENIED" }, 401);
  const available = engines(env);
  if (!available.length) return json({ error: "NO_ENGINES_CONFIGURED" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "VALIDATION_ERROR" }, 400); }
  const messages = Array.isArray(body.messages)
    ? body.messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-MAX_MESSAGES)
    : [];
  if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "VALIDATION_ERROR" }, 400);
  if (messages.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) return json({ error: "BRIEF_TOO_LONG" }, 413);

  const mode = ["fast", "smart", "deep", "executive"].includes(body.mode) ? body.mode : "smart";
  const lastUser = messages[messages.length - 1].content;
  const taskType = TASKS.has(body.taskType) ? body.taskType : classify(lastUser);
  const tier = mode === "executive" ? "deep" : mode;
  const order = (ROUTES[taskType] || ROUTES.general_chat).filter((e) => available.includes(e));
  const requestId = crypto.randomUUID();
  const started = Date.now();

  try {
    if (mode === "executive" && order.length >= 2) {
      return json(await executive({ env, order, messages, taskType, requestId, started }));
    }
    // Single answer with ordered fallback.
    const reasons = [REASON[taskType], "MODE_" + mode.toUpperCase()];
    if (mode === "executive") reasons.push("EXECUTIVE_NEEDS_TWO_ENGINES");
    let lastErr;
    for (let i = 0; i < order.length; i++) {
      try {
        const r = await call(order[i], env, tier, messages);
        if (i > 0) reasons.push("FALLBACK_FROM_" + order[0].toUpperCase());
        return json(shape({ requestId, mode, started, provider: order[i], model: r.model, text: r.text, reasons, fallbackUsed: i > 0, usage: r.usage }));
      } catch (e) { lastErr = e; }
    }
    return json({ error: "ALL_ENGINES_FAILED", detail: String(lastErr && lastErr.message || lastErr).slice(0, 200) }, 502);
  } catch (e) {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

// Executive Mode: up to 3 engines in parallel, disagreements flagged, one synthesis.
async function executive({ env, order, messages, taskType, requestId, started }) {
  const panel = order.slice(0, 3);
  const settled = await Promise.allSettled(panel.map((e) => call(e, env, "deep", messages)));
  const candidates = [];
  settled.forEach((s, i) => { if (s.status === "fulfilled") candidates.push({ provider: panel[i], model: s.value.model, text: s.value.text }); });
  if (!candidates.length) throw new Error("EXECUTIVE_ALL_FAILED");
  if (candidates.length === 1) {
    const c = candidates[0];
    return shape({ requestId, mode: "executive", started, provider: c.provider, model: c.model, text: c.text, reasons: [REASON[taskType], "EXECUTIVE_ONLY_ONE_ENGINE_ANSWERED"], fallbackUsed: true, executive: { candidates: candidates.map(cand), disagreements: [] } });
  }

  const brief = messages[messages.length - 1].content;
  const synthPrompt =
    "Executive brief:\n" + brief + "\n\n" +
    candidates.map((c, i) => `--- Answer ${i + 1} (${LABEL[c.provider]}) ---\n${c.text}`).join("\n\n") +
    "\n\nWrite ONE executive synthesis: the best combined answer with a clear recommendation. " +
    "Then, on the very last line, write 'DISAGREEMENTS:' followed by a semicolon-separated list of material points where the answers disagree, or 'none'.";
  const judge = order.includes("anthropic") ? "anthropic" : candidates[0].provider;
  let synth;
  try { synth = await call(judge, env, "deep", [{ role: "user", content: synthPrompt }]); }
  catch { synth = { model: candidates[0].model, text: candidates[0].text + "\nDISAGREEMENTS: none" }; }

  const m = synth.text.match(/\n?\**DISAGREEMENTS:?\**\s*(.*)\s*$/i);
  const disagreements = m && !/^none\.?$/i.test(m[1].trim()) ? m[1].split(";").map((s) => s.trim()).filter(Boolean).slice(0, 5) : [];
  const text = m ? synth.text.slice(0, m.index).trim() : synth.text;
  return shape({
    requestId, mode: "executive", started, provider: candidates.map((c) => LABEL[c.provider]).join(" + "), model: "synthesis by " + LABEL[judge],
    text, reasons: [REASON[taskType], "EXECUTIVE_PARALLEL_" + candidates.length], fallbackUsed: candidates.length < panel.length,
    executive: { candidates: candidates.map(cand), disagreements }
  });
}
const cand = (c) => ({ model: LABEL[c.provider] + " · " + c.model, text: c.text });

// ---------- providers (native fetch, no SDKs — same approach as RAMBO's adapters) ----------
function model(env, provider, tier) {
  const up = provider.toUpperCase();
  const t = tier === "deep" ? "_DEEP" : tier === "fast" ? "_FAST" : "";
  return env[up + "_MODEL" + t] || (tier === "smart" ? env[up + "_MODEL"] : null) || env[up + "_MODEL"] || DEFAULT_MODELS[provider][tier];
}

async function call(provider, env, tier, messages) {
  const m = model(env, provider, tier);
  if (provider === "anthropic") {
    const j = await post("https://api.anthropic.com/v1/messages", {
      "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01"
    }, { model: m, max_tokens: 4096, system: SYSTEM, messages });
    return { model: j.model || m, text: (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n"), usage: { inputTokens: j.usage?.input_tokens, outputTokens: j.usage?.output_tokens } };
  }
  if (provider === "openai") {
    const j = await post("https://api.openai.com/v1/chat/completions", { authorization: "Bearer " + env.OPENAI_API_KEY },
      { model: m, messages: [{ role: "system", content: SYSTEM }, ...messages] });
    return { model: j.model || m, text: j.choices?.[0]?.message?.content || "", usage: { inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens } };
  }
  if (provider === "xai") {
    const j = await post("https://api.x.ai/v1/chat/completions", { authorization: "Bearer " + env.XAI_API_KEY },
      { model: m, messages: [{ role: "system", content: SYSTEM }, ...messages] });
    return { model: j.model || m, text: j.choices?.[0]?.message?.content || "", usage: { inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens } };
  }
  if (provider === "gemini") {
    const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { "x-goog-api-key": env.GEMINI_API_KEY }, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: messages.map((x) => ({ role: x.role === "assistant" ? "model" : "user", parts: [{ text: x.content }] }))
    });
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    return { model: m, text, usage: { inputTokens: j.usageMetadata?.promptTokenCount, outputTokens: j.usageMetadata?.candidatesTokenCount } };
  }
  if (provider === "perplexity") {
    // Perplexity Agent API (Sonar Chat Completions was retired 2026-09-27). Web search is built in.
    const convo = messages.map((x) => (x.role === "user" ? "User: " : "Assistant: ") + x.content).join("\n\n");
    const j = await post("https://api.perplexity.ai/v1/agent", { authorization: "Bearer " + env.PERPLEXITY_API_KEY },
      { effort: m, input: SYSTEM + "\n\n" + convo });
    return { model: j.model ? "web · " + j.model : "web search", text: agentText(j), usage: {} };
  }
  throw new Error("UNKNOWN_PROVIDER");
}

function agentText(j) {
  if (typeof j.output_text === "string") return j.output_text;
  const parts = [];
  (j.output || []).forEach((o) => (o.content || []).forEach((c) => { if (typeof c.text === "string") parts.push(c.text); }));
  return parts.join("\n");
}

async function post(url, headers, payload) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return j;
  } finally { clearTimeout(t); }
}

// ---------- helpers ----------
function engines(env) {
  return ["anthropic", "openai", "gemini", "perplexity", "xai"].filter((e) => env[e.toUpperCase() + "_API_KEY"]);
}
function classify(text) {
  for (const [re, t] of RULES) if (re.test(text)) return t;
  return "general_chat";
}
function shape({ requestId, mode, started, provider, model, text, reasons, fallbackUsed, usage, executive }) {
  if (!text || !text.trim()) throw new Error("EMPTY_ANSWER");
  const out = {
    requestId, responseId: crypto.randomUUID(), status: "completed", mode,
    output: { type: "markdown", content: text },
    routing: { provider: LABEL[provider] || provider, model, reasonCodes: reasons.filter(Boolean), fallbackUsed: !!fallbackUsed },
    usage: usage || {}, latency: { totalMs: Date.now() - started }
  };
  if (executive) out.executive = executive;
  return out;
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
