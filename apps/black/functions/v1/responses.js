/*
 * BLACK live gateway — Cloudflare Pages Function at /v1/responses.
 *
 * GET  /v1/responses  -> { live, engines }  (which engines have keys configured)
 * POST /v1/responses  -> RAMBO-shaped response (same contract as rambo-router-phase1 responses.ts)
 * POST with { stream: true } -> text/event-stream of live events (see "Live stream" below):
 *   route, engine, delta, switch, synth, ping, done, error
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
const ENGINE_TIMEOUT_MS = 45000;   // per engine in a live (streamed) brief; a slow engine is skipped, not fatal
const SYNTH_TIMEOUT_MS = 50000;
const PARTIAL_MIN_CHARS = 400;     // a timed-out engine that already wrote this much is kept as a partial answer
const SYNTH_CANDIDATE_CHARS = 7000; // trim each candidate before synthesis so the judge answers faster

export async function onRequestGet({ env }) {
  return json({ live: engines(env).length > 0 && !!env.BLACK_ACCESS_CODE, engines: engines(env).map((e) => LABEL[e]) });
}

export async function onRequestPost({ request, env, waitUntil }) {
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

  if (body.stream === true) return live({ env, waitUntil, mode, tier, order, messages, taskType, requestId, started });

  try {
    if (mode === "executive" && order.length >= 2) {
      const ex = await executive({ env, order, messages, taskType, requestId, started });
      return ex.failures ? allFailed(ex.failures) : json(ex);
    }
    // Single answer with ordered fallback.
    const reasons = [REASON[taskType], "MODE_" + mode.toUpperCase()];
    if (mode === "executive") reasons.push("EXECUTIVE_NEEDS_TWO_ENGINES");
    const failures = [];
    for (let i = 0; i < order.length; i++) {
      try {
        const r = await call(order[i], env, tier, messages);
        if (i > 0) reasons.push("FALLBACK_FROM_" + order[0].toUpperCase());
        return json(shape({ requestId, mode, started, provider: order[i], model: r.model, text: r.text, reasons, fallbackUsed: i > 0, usage: r.usage }));
      } catch (e) { failures.push(failure(order[i], e)); }
    }
    return allFailed(failures);
  } catch (e) {
    return json({ error: "INTERNAL_ERROR", detail: String((e && e.message) || e).slice(0, 160) }, 500);
  }
}

// Executive Mode: up to 3 engines in parallel, disagreements flagged, one synthesis.
async function executive({ env, order, messages, taskType, requestId, started }) {
  const panel = order.slice(0, 3);
  const settled = await Promise.allSettled(panel.map((e) => call(e, env, "deep", messages)));
  const candidates = [];
  const failures = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled" && s.value.text && s.value.text.trim()) candidates.push({ provider: panel[i], model: s.value.model, text: s.value.text });
    else failures.push(s.status === "fulfilled" ? { engine: LABEL[panel[i]], error: "empty answer" } : failure(panel[i], s.reason));
  });
  if (!candidates.length) return { failures };
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
  catch { synth = null; }
  if (!synth || !synth.text || !synth.text.trim()) synth = { model: candidates[0].model, text: candidates[0].text + "\nDISAGREEMENTS: none" };

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
    if (!r.ok) {
      const e = j && j.error;
      const msg = typeof e === "string" ? e : (e && e.message) || (j && j.message) || r.statusText || "";
      throw new Error(`${r.status} ${String(msg)}`.trim());
    }
    return j;
  } finally { clearTimeout(t); }
}

// ---------- Live stream (POST { stream: true }) ----------
// Sends Server-Sent Events as the work happens, so the console can show each engine working:
//   route  {mode, taskType, reasons, engines:[{engine,label,model}], judge}
//   engine {engine, label, model, status: thinking|writing|done|failed|skipped, ms, tokens, chars, partial, error}
//   delta  {target: <engine>|"final", text}
//   switch {from, to, reason}            (fallback to the next engine)
//   synth  {status: thinking|writing|done|skipped, label, model}
//   ping   {t}                           (keep-alive every 8s)
//   done   <same body as the JSON response>
//   error  {error, engines?}
function live({ env, waitUntil, mode, tier, order, messages, taskType, requestId, started }) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  let closed = false;
  const send = (event, data) => {
    if (closed) return Promise.resolve();
    return w.write(enc.encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n")).catch(() => { closed = true; });
  };
  const ping = setInterval(() => send("ping", { t: Date.now() - started }), 8000);

  const job = (async () => {
    try {
      const executive = mode === "executive" && order.length >= 2;
      await (executive ? liveExecutive : liveSingle)({ env, send, mode, tier, order, messages, taskType, requestId, started });
    } catch (e) {
      await send("error", { error: "INTERNAL_ERROR", detail: String((e && e.message) || e).slice(0, 160) });
    } finally {
      clearInterval(ping);
      closed = true;
      try { await w.close(); } catch {}
    }
  })();
  if (typeof waitUntil === "function") waitUntil(job);

  return new Response(readable, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" }
  });
}

function engineInfo(env, provider, tier) {
  return { engine: provider, label: LABEL[provider], model: model(env, provider, tier) };
}

// Batches token deltas (~every 90ms) so the browser repaints smoothly without one event per token.
function deltaPump(send, target) {
  let buf = "", t = null;
  const flush = () => { t = null; if (buf) { const x = buf; buf = ""; send("delta", { target, text: x }); } };
  return {
    push(txt) { if (!txt) return; buf += txt; if (!t) t = setTimeout(flush, 90); },
    end() { if (t) clearTimeout(t); flush(); }
  };
}

// Runs one engine with live status + deltas. Never throws: returns { ok, ... }.
async function runEngine({ env, send, provider, tier, messages, target, timeoutMs, system }) {
  const info = engineInfo(env, provider, tier);
  const t0 = Date.now();
  let chars = 0, writing = false;
  const pump = deltaPump(send, target || provider);
  await send("engine", { ...info, status: "thinking" });
  const r = await stream(provider, env, tier, messages, {
    timeoutMs, system,
    onDelta(txt) {
      if (!writing) { writing = true; send("engine", { ...info, status: "writing", ms: Date.now() - t0 }); }
      chars += txt.length; pump.push(txt);
    }
  });
  pump.end();
  const ms = Date.now() - t0;
  const text = (r.text || "").trim();
  if (text && (!r.error || text.length >= PARTIAL_MIN_CHARS)) {
    const partial = !!r.error;
    await send("engine", { ...info, model: r.model || info.model, status: "done", ms, chars: text.length, tokens: r.usage && r.usage.outputTokens, partial });
    return { ok: true, provider, model: r.model || info.model, text, usage: r.usage, partial, ms };
  }
  const err = r.error ? failure(provider, r.error) : { engine: LABEL[provider], error: "empty answer" };
  await send("engine", { ...info, status: "failed", ms, error: err.error });
  return { ok: false, provider, failure: err };
}

async function liveSingle({ env, send, mode, tier, order, messages, taskType, requestId, started }) {
  const reasons = [REASON[taskType], "MODE_" + mode.toUpperCase()];
  if (mode === "executive") reasons.push("EXECUTIVE_NEEDS_TWO_ENGINES");
  await send("route", { mode, taskType, reasons, engines: order.map((e) => engineInfo(env, e, tier)), judge: null });
  const failures = [];
  for (let i = 0; i < order.length; i++) {
    if (i > 0) await send("switch", { from: LABEL[order[i - 1]], to: LABEL[order[i]], reason: failures[failures.length - 1].error });
    const r = await runEngine({ env, send, provider: order[i], tier, messages, target: "final", timeoutMs: ENGINE_TIMEOUT_MS });
    if (r.ok) {
      if (i > 0) reasons.push("FALLBACK_FROM_" + order[0].toUpperCase());
      if (r.partial) reasons.push("PARTIAL_TIMEOUT");
      for (let j = i + 1; j < order.length; j++) await send("engine", { ...engineInfo(env, order[j], tier), status: "skipped" });
      return send("done", shape({ requestId, mode, started, provider: r.provider, model: r.model, text: r.text, reasons, fallbackUsed: i > 0, usage: r.usage }));
    }
    failures.push(r.failure);
  }
  return send("error", { error: "ALL_ENGINES_FAILED", engines: failures });
}

async function liveExecutive({ env, send, order, messages, taskType, requestId, started }) {
  const panel = order.slice(0, 3);
  const judge = order.includes("anthropic") ? "anthropic" : panel[0];
  const synthTier = env.SYNTH_TIER === "deep" ? "deep" : "smart";
  await send("route", {
    mode: "executive", taskType, reasons: [REASON[taskType], "EXECUTIVE_PARALLEL_" + panel.length],
    engines: panel.map((e) => engineInfo(env, e, "deep")), judge: engineInfo(env, judge, synthTier)
  });

  const results = await Promise.all(panel.map((p) => runEngine({ env, send, provider: p, tier: "deep", messages, timeoutMs: ENGINE_TIMEOUT_MS })));
  const good = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok).map((r) => r.failure);
  if (!good.length) return send("error", { error: "ALL_ENGINES_FAILED", engines: failures });

  const candidates = good.map((r) => ({ model: LABEL[r.provider] + " · " + r.model + (r.partial ? " (partial)" : ""), text: r.text }));
  const reasons = [REASON[taskType], "EXECUTIVE_PARALLEL_" + good.length];
  if (good.length === 1) {
    await send("synth", { status: "skipped", label: LABEL[good[0].provider], model: good[0].model });
    return send("done", shape({ requestId, mode: "executive", started, provider: good[0].provider, model: good[0].model, text: good[0].text,
      reasons: [REASON[taskType], "EXECUTIVE_ONLY_ONE_ENGINE_ANSWERED"], fallbackUsed: true, executive: { candidates, disagreements: [] } }));
  }

  const brief = messages[messages.length - 1].content;
  const synthPrompt =
    "Executive brief:\n" + brief + "\n\n" +
    good.map((c, i) => `--- Answer ${i + 1} (${LABEL[c.provider]}) ---\n${c.text.slice(0, SYNTH_CANDIDATE_CHARS)}`).join("\n\n") +
    "\n\nWrite ONE executive synthesis: the best combined answer with a clear recommendation. " +
    "Then, on the very last line, write 'DISAGREEMENTS:' followed by a semicolon-separated list of material points where the answers disagree, or 'none'.";
  const sInfo = engineInfo(env, judge, synthTier);
  await send("synth", { status: "thinking", label: sInfo.label, model: sInfo.model });
  const pump = deltaPump(send, "final");
  let writing = false;
  const s = await stream(judge, env, synthTier, [{ role: "user", content: synthPrompt }], {
    timeoutMs: SYNTH_TIMEOUT_MS,
    onDelta(txt) { if (!writing) { writing = true; send("synth", { status: "writing", label: sInfo.label, model: sInfo.model }); } pump.push(txt); }
  });
  pump.end();

  let synthText = (s.text || "").trim();
  if (!synthText || (s.error && synthText.length < PARTIAL_MIN_CHARS)) {
    // Synthesis failed: hand back the strongest (longest) candidate instead of an error.
    const best = good.slice().sort((a, b) => b.text.length - a.text.length)[0];
    await send("synth", { status: "skipped", label: LABEL[best.provider], model: best.model, error: s.error ? failure(judge, s.error).error : "empty" });
    return send("done", shape({ requestId, mode: "executive", started, provider: good.map((c) => LABEL[c.provider]).join(" + "), model: "best candidate · " + LABEL[best.provider],
      text: best.text, reasons: reasons.concat("SYNTHESIS_SKIPPED"), fallbackUsed: true, executive: { candidates, disagreements: [] } }));
  }
  await send("synth", { status: "done", label: sInfo.label, model: s.model || sInfo.model });
  const m = synthText.match(/\n?\**DISAGREEMENTS:?\**\s*(.*)\s*$/i);
  const disagreements = m && !/^none\.?$/i.test(m[1].trim()) ? m[1].split(";").map((x) => x.trim()).filter(Boolean).slice(0, 5) : [];
  const text = m ? synthText.slice(0, m.index).trim() || synthText : synthText;
  return send("done", shape({ requestId, mode: "executive", started, provider: good.map((c) => LABEL[c.provider]).join(" + "), model: "synthesis by " + LABEL[judge],
    text, reasons, fallbackUsed: good.length < panel.length, executive: { candidates, disagreements } }));
}

// Streaming provider calls. Returns { model, text, usage, error? } and never throws.
async function stream(provider, env, tier, messages, { onDelta, timeoutMs, system }) {
  const m = model(env, provider, tier);
  const sys = system || SYSTEM;
  const out = { model: m, text: "", usage: {} };
  const add = (t) => { if (t) { out.text += t; onDelta(t); } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || TIMEOUT_MS);
  try {
    if (provider === "perplexity") {
      // Agent API: answered in one piece (web search runs server side), then shown at once.
      const convo = messages.map((x) => (x.role === "user" ? "User: " : "Assistant: ") + x.content).join("\n\n");
      const j = await postJson("https://api.perplexity.ai/v1/agent", { authorization: "Bearer " + env.PERPLEXITY_API_KEY }, { effort: m, input: sys + "\n\n" + convo }, ctl.signal);
      out.model = j.model ? "web · " + j.model : "web search";
      add(agentText(j));
      return out;
    }
    let url, headers, payload, onData;
    if (provider === "anthropic") {
      url = "https://api.anthropic.com/v1/messages";
      headers = { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" };
      payload = { model: m, max_tokens: 4096, system: sys, messages, stream: true };
      onData = (j) => {
        if (j.type === "message_start" && j.message) { out.model = j.message.model || m; out.usage.inputTokens = j.message.usage && j.message.usage.input_tokens; }
        else if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta") add(j.delta.text);
        else if (j.type === "message_delta" && j.usage) out.usage.outputTokens = j.usage.output_tokens;
        else if (j.type === "error") throw new Error((j.error && j.error.message) || "stream error");
      };
    } else if (provider === "openai" || provider === "xai") {
      url = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
      headers = { authorization: "Bearer " + (provider === "openai" ? env.OPENAI_API_KEY : env.XAI_API_KEY) };
      payload = { model: m, messages: [{ role: "system", content: sys }, ...messages], stream: true };
      if (provider === "openai") payload.stream_options = { include_usage: true };
      onData = (j) => {
        if (j.model) out.model = j.model;
        const d = j.choices && j.choices[0] && j.choices[0].delta;
        if (d && typeof d.content === "string") add(d.content);
        if (j.usage) { out.usage.inputTokens = j.usage.prompt_tokens; out.usage.outputTokens = j.usage.completion_tokens; }
      };
    } else if (provider === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`;
      headers = { "x-goog-api-key": env.GEMINI_API_KEY };
      payload = {
        systemInstruction: { parts: [{ text: sys }] },
        contents: messages.map((x) => ({ role: x.role === "assistant" ? "model" : "user", parts: [{ text: x.content }] }))
      };
      onData = (j) => {
        ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).forEach((p) => add(p.text || ""));
        if (j.usageMetadata) { out.usage.inputTokens = j.usageMetadata.promptTokenCount; out.usage.outputTokens = j.usageMetadata.candidatesTokenCount; }
      };
    } else throw new Error("UNKNOWN_PROVIDER");

    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload), signal: ctl.signal });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const e = j && (Array.isArray(j) ? j[0] && j[0].error : j.error);
      const msg = typeof e === "string" ? e : (e && e.message) || (j && j.message) || r.statusText || "";
      throw new Error(`${r.status} ${String(msg)}`.trim());
    }
    await readSse(r.body, onData);
    return out;
  } catch (e) {
    out.error = e;
    return out;
  } finally { clearTimeout(timer); }
}

async function postJson(url, headers, payload, signal) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload), signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j && j.error;
    const msg = typeof e === "string" ? e : (e && e.message) || (j && j.message) || r.statusText || "";
    throw new Error(`${r.status} ${String(msg)}`.trim());
  }
  return j;
}

// Reads an SSE body and calls onData(json) for each `data:` line (ignores [DONE] and non-JSON).
async function readSse(body, onData) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      onData(j);
    }
  }
}

// ---------- helpers ----------
// Per-engine failure detail: provider label, HTTP status and the provider's error message. Never includes keys.
function failure(provider, e) {
  const m = e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e || "unknown");
  // Some providers echo a masked key in the message; strip anything key-shaped.
  return { engine: LABEL[provider] || provider, error: m.replace(/\b(sk|xai|pplx|AIza)[\w*.-]{4,}/g, "[key]").slice(0, 200) };
}
// 424, not 502: Cloudflare replaces 502 bodies with its own error page, which hid this detail.
function allFailed(failures) {
  return json({ error: "ALL_ENGINES_FAILED", engines: failures }, 424);
}
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
