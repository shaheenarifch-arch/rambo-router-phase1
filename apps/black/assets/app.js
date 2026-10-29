/* BLACK Console — talks to the RAMBO gateway (POST /v1/responses) or runs in Preview mode. */
(function () {
  "use strict";
  var CFG = window.BLACK_CONFIG || {};
  // Same-origin gateway (functions/v1/responses.js) unless config.js points elsewhere.
  var API = (CFG.apiBase || "").replace(/\/+$/, "");
  var LIVE = false;
  var STORE = "black.briefs";
  var CODE_KEY = "black.code";
  function getCode() { try { return localStorage.getItem(CODE_KEY) || ""; } catch (e) { return ""; } }
  function setCode(v) { try { v ? localStorage.setItem(CODE_KEY, v) : localStorage.removeItem(CODE_KEY); } catch (e) {} }

  // Same deterministic rules as the RAMBO TaskClassifier (classifier.ts), so the hint matches the router.
  var RULES = [
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
  var LABELS = {
    debugging: "Debugging", coding: "Coding", architecture: "Architecture", seo_content: "SEO content",
    product_research: "Product research", market_analysis: "Market analysis", business_strategy: "Business strategy",
    summarization: "Summary", extraction: "Extraction", general_chat: "General"
  };
  function classify(text) {
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(text)) return RULES[i][1];
    return "general_chat";
  }

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    prompt: $("prompt"), send: $("send"), form: $("composer"), thread: $("thread"), welcome: $("welcome"),
    scroll: $("scroll"), detect: $("detect"), history: $("history"), status: $("status"), statusText: $("status-text"),
    rail: $("rail"), scrim: $("scrim"), railToggle: $("rail-toggle"), greeting: $("greeting"), studio: $("studio-link")
  };

  var mode = "smart";
  var busy = false;
  var briefs = load();
  var current = null; // { id, title, mode, messages: [{role, content, meta?}] }

  // ---------- setup ----------
  var h = new Date().getHours();
  el.greeting.textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  el.studio.href = CFG.studioUrl || "https://studio.getservices.ai";
  var ENGINES = [];
  function setStatus() {
    el.status.classList.toggle("live", LIVE);
    if (LIVE) { el.statusText.textContent = "Live · " + ENGINES.join(" · "); el.status.title = "Connected to the BLACK gateway"; }
    else if (ENGINES.length) { el.statusText.textContent = "Preview · enter access code"; el.status.title = "Enter your access code for live answers"; }
    else { el.statusText.textContent = "Preview mode"; el.status.title = "The live gateway isn't configured yet"; }
  }
  function probe() {
    fetch(API + "/v1/responses", { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : { live: false, engines: [] }; })
      .then(function (j) { ENGINES = j.engines || []; LIVE = !!j.live && !!getCode(); setStatus(); })
      .catch(function () { ENGINES = []; LIVE = false; setStatus(); });
  }
  el.status.addEventListener("click", function () {
    if (!ENGINES.length) return;
    var v = window.prompt(LIVE ? "Change your BLACK access code (leave empty to switch to Preview):" : "Enter your BLACK access code for live answers:", getCode());
    if (v === null) return;
    setCode(v.trim()); probe();
  });
  setStatus(); probe();

  document.querySelectorAll(".modes button").forEach(function (b) {
    b.addEventListener("click", function () { setMode(b.dataset.m); el.prompt.focus(); });
  });
  document.querySelectorAll(".tile").forEach(function (t) {
    t.addEventListener("click", function () {
      if (t.dataset.mode) setMode(t.dataset.mode);
      el.prompt.value = t.dataset.prompt; onInput(); el.prompt.focus();
    });
  });
  el.prompt.addEventListener("input", onInput);
  el.prompt.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.form.requestSubmit(); }
  });
  el.form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
  $("new-brief").addEventListener("click", function () { newBrief(); closeRail(); });
  el.railToggle.addEventListener("click", function () { el.rail.classList.contains("open") ? closeRail() : openRail(); });
  el.scrim.addEventListener("click", closeRail);
  renderHistory();
  el.prompt.focus();

  function setMode(m) {
    mode = m;
    document.querySelectorAll(".modes button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.m === m)); });
  }
  function onInput() {
    var v = el.prompt.value;
    el.prompt.style.height = "auto";
    el.prompt.style.height = Math.min(el.prompt.scrollHeight, 220) + "px";
    el.send.disabled = busy || !v.trim();
    el.detect.innerHTML = v.trim() ? "Detected: <b>" + LABELS[classify(v)] + "</b>" : "";
  }
  function openRail() { el.rail.classList.add("open"); el.scrim.classList.add("open"); el.railToggle.setAttribute("aria-expanded", "true"); }
  function closeRail() { el.rail.classList.remove("open"); el.scrim.classList.remove("open"); el.railToggle.setAttribute("aria-expanded", "false"); }

  // ---------- briefs ----------
  function load() { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch (e) { return []; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(briefs.slice(0, 30))); } catch (e) {} }
  function newBrief() {
    current = null; el.thread.innerHTML = ""; el.welcome.style.display = ""; el.prompt.value = ""; onInput(); renderHistory(); el.prompt.focus();
    if (window.BLACK_WORKSPACE) window.BLACK_WORKSPACE.resume();
  }
  function openBrief(id) {
    var b = briefs.find(function (x) { return x.id === id; }); if (!b) return;
    current = b; setMode(b.mode || "smart"); el.thread.innerHTML = ""; el.welcome.style.display = "none";
    if (window.BLACK_WORKSPACE) window.BLACK_WORKSPACE.pause();
    b.messages.forEach(function (m) { m.role === "user" ? addUser(m.content) : addAnswer(m.meta || {}, m.content); });
    renderHistory(); closeRail(); scrollEnd();
  }
  function renderHistory() {
    el.history.innerHTML = "";
    if (!briefs.length) { el.history.innerHTML = '<li class="empty">Your briefs will appear here.</li>'; return; }
    briefs.forEach(function (b) {
      var li = document.createElement("li"), btn = document.createElement("button");
      btn.textContent = b.title; btn.title = b.title;
      if (current && current.id === b.id) btn.classList.add("active");
      btn.addEventListener("click", function () { openBrief(b.id); });
      li.appendChild(btn); el.history.appendChild(li);
    });
  }

  // ---------- send ----------
  function submit() {
    var text = el.prompt.value.trim(); if (!text || busy) return;
    if (!current) {
      current = { id: String(Date.now()), title: text.slice(0, 60), mode: mode, messages: [] };
      briefs.unshift(current);
    }
    current.mode = mode;
    current.messages.push({ role: "user", content: text });
    save(); renderHistory();
    el.welcome.style.display = "none";
    if (window.BLACK_WORKSPACE) window.BLACK_WORKSPACE.pause();
    addUser(text);
    el.prompt.value = "";
    dispatch(classify(text));
  }

  // Sends the current brief (also used by Retry, which re-sends without adding a new message).
  function dispatch(taskType) {
    busy = true; onInput();
    var pending = addPending();
    var started = performance.now();
    var job = LIVE ? callRambo(taskType, pending) : preview(current.messages[current.messages.length - 1].content, taskType);
    job.then(function (res) {
      pending.remove();
      res.meta.latencyMs = res.meta.latencyMs || Math.round(performance.now() - started);
      addAnswer(res.meta, res.content);
      current.messages.push({ role: "assistant", content: res.content, meta: res.meta });
      save();
    }).catch(function (err) {
      pending.remove();
      addError(err && err.message ? err.message : "Something went wrong.", function () { dispatch(taskType); });
    }).finally(function () { busy = false; onInput(); scrollEnd(); el.prompt.focus(); });
  }

  function callRambo(taskType, card) {
    var body = {
      applicationId: CFG.applicationId || "black",
      mode: mode,
      taskType: taskType,
      stream: true,
      messages: current.messages.map(function (m) { return { role: m.role, content: m.content }; }),
      output: { format: "markdown" }
    };
    return fetch(API + "/v1/responses", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "text/event-stream", "x-black-access": getCode() },
      body: JSON.stringify(body)
    }).then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (r.ok && ct.indexOf("text/event-stream") > -1 && r.body && r.body.getReader) return readStream(r.body, card, taskType);
      // Errors (and any gateway without streaming) come back as JSON.
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(errorText(r.status, j));
        return toResult(j, taskType, card.timeline());
      });
    });
  }

  // Reads the gateway's live events and feeds the Live Engines panel until "done" or "error".
  function readStream(stream, card, taskType) {
    var reader = stream.getReader(), dec = new TextDecoder(), buf = "", result = null, failure = null;
    function handle(block) {
      var ev = "message", data = "";
      block.split("\n").forEach(function (l) {
        if (l.indexOf("event:") === 0) ev = l.slice(6).trim();
        else if (l.indexOf("data:") === 0) data += l.slice(5).trim();
      });
      if (!data) return;
      var d; try { d = JSON.parse(data); } catch (e) { return; }
      if (ev === "done") result = toResult(d, taskType, card.timeline());
      else if (ev === "error") failure = d;
      else card.event(ev, d);
    }
    function pump() {
      return reader.read().then(function (x) {
        if (x.done) {
          if (buf.trim()) handle(buf);
          if (result) return result;
          if (failure) throw new Error(failure.error === "ALL_ENGINES_FAILED" ? errorText(424, failure) : "BLACK hit a problem: " + (failure.detail || failure.error) + ".");
          throw new Error("The connection closed before BLACK finished. Try again.");
        }
        buf += dec.decode(x.value, { stream: true });
        var i;
        while ((i = buf.indexOf("\n\n")) > -1) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
        return pump();
      });
    }
    return pump();
  }

  function toResult(j, taskType, timeline) {
    var c = j.output && j.output.content;
    return {
      content: typeof c === "string" ? c : JSON.stringify(c, null, 2),
      meta: {
        mode: j.mode || mode, taskType: taskType,
        provider: j.routing && j.routing.provider, model: j.routing && j.routing.model,
        reasons: (j.routing && j.routing.reasonCodes) || [], fallback: !!(j.routing && j.routing.fallbackUsed),
        cost: j.usage && j.usage.estimatedCostUsd, latencyMs: j.latency && j.latency.totalMs,
        candidates: (j.executive && j.executive.candidates) || null,
        disagreements: (j.executive && j.executive.disagreements) || [],
        timeline: timeline && timeline.length ? timeline : null
      }
    };
  }
  function errorText(status, j) {
    if (status === 401 || status === 403) { LIVE = false; setStatus(); return "Your access code wasn't accepted. Tap the status badge at the top to enter it again."; }
    if (status === 413) return "That brief is too long. Shorten it or start a new brief.";
    if (status === 502) return "Every engine failed to answer this time. Try again in a moment.";
    if (status === 424) return "Every engine failed to answer. " + ((j && j.engines) || []).map(function (f) { return f.engine + ": " + f.error; }).join(" · ");
    if (status === 429) return "You're sending briefs quickly. Wait a moment and try again.";
    if (status === 503) return "No intelligence engine is available right now. Try again shortly.";
    return "The gateway returned " + status + (j && j.error ? " (" + j.error + ")" : "") + ".";
  }

  // Preview mode: no model is called. Shows how the brief would be routed, clearly labelled.
  function preview(text, taskType) {
    var deep = ["architecture", "coding", "business_strategy", "debugging", "market_analysis"].indexOf(taskType) > -1 || mode === "deep" || mode === "executive";
    var engine = mode === "fast" ? "fast engine" : deep ? "deep reasoning engine" : "balanced engine";
    var lines = [
      "### Preview mode",
      "Live answers are off in this browser, so no model was called for this brief.",
      "",
      "### How this brief would be routed",
      "- **Task detected:** " + LABELS[taskType],
      "- **Mode:** " + cap(mode),
      "- **Engine:** " + engine
    ];
    if (mode === "executive") lines.push("- **Executive Mode:** sent to at least two independent models in parallel, with disagreements flagged and one synthesis returned");
    lines.push("", ENGINES.length ? "Tap the status badge at the top and enter your access code to get live answers." : "The live gateway isn't configured yet.");
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ content: lines.join("\n"), meta: { preview: true, mode: mode, taskType: taskType, reasons: ["PREVIEW_NO_MODEL_CALLED"] } });
      }, 650);
    });
  }

  // ---------- render ----------
  function addUser(text) {
    var d = document.createElement("div"); d.className = "msg user";
    var b = document.createElement("div"); b.className = "bubble"; b.textContent = text;
    d.appendChild(b); el.thread.appendChild(d); scrollEnd();
  }
  var STATUS = { queued: "Queued", thinking: "Thinking…", writing: "Writing…", done: "Done", failed: "Failed", skipped: "Standby" };
  // Live Engines card: shows RAMBO's route, each engine's status, timer and output as it streams in.
  function addPending() {
    var d = document.createElement("div"); d.className = "msg";
    var a = document.createElement("div"); a.className = "answer live-card";
    a.innerHTML =
      '<div class="head"><span class="who">BLACK</span><span class="clock">0.0s</span></div>' +
      '<div class="rambo"><span class="rpulse"></span><b>RAMBO</b> <span class="rline">' + (LIVE ? "Analysing your brief…" : "Preview: no model is called") + "</span></div>" +
      '<ol class="engines"></ol><div class="switches"></div>' +
      '<div class="cand-tabs" hidden></div><div class="cand-view body" hidden></div>' +
      '<div class="final-head" hidden></div><div class="body final"></div>';
    d.appendChild(a); el.thread.appendChild(d); scrollEnd();
    var $q = function (s) { return a.querySelector(s); };
    var t0 = performance.now(), rows = {}, order = [], texts = {}, active = null, renderT = null, finalText = "";
    var tick = setInterval(function () {
      $q(".clock").textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s";
      order.forEach(function (k) {
        var r = rows[k];
        if (r.status === "thinking" || r.status === "writing") r.time.textContent = ((performance.now() - r.t0) / 1000).toFixed(1) + "s";
      });
    }, 100);
    function row(info) {
      var k = info.engine;
      if (rows[k]) return rows[k];
      var li = document.createElement("li"); li.className = "eng queued";
      li.innerHTML = '<span class="dot"></span><span class="name"></span><span class="model"></span><span class="st">Queued</span><span class="time"></span><span class="stat"></span>';
      li.querySelector(".name").textContent = info.label;
      li.querySelector(".model").textContent = info.model || "";
      $q(".engines").appendChild(li);
      rows[k] = { li: li, label: info.label, model: info.model, status: "queued", t0: performance.now(), time: li.querySelector(".time") };
      order.push(k); return rows[k];
    }
    function setRow(info) {
      var r = row(info);
      if (info.status === "thinking" && r.status !== "thinking") r.t0 = performance.now();
      r.status = info.status; if (info.model) { r.model = info.model; r.li.querySelector(".model").textContent = info.model; }
      r.li.className = "eng " + info.status + (info.partial ? " partial" : "");
      var st = STATUS[info.status] || info.status;
      if (info.status === "failed") st = "Failed · " + (info.error || "error");
      if (info.status === "done" && info.partial) st = "Done (cut off at time limit)";
      if (info.status === "skipped") st = "Standby · not needed";
      r.li.querySelector(".st").textContent = st;
      if (typeof info.ms === "number" && (info.status === "done" || info.status === "failed")) r.time.textContent = (info.ms / 1000).toFixed(1) + "s";
      var bits = [];
      if (info.tokens) bits.push(info.tokens + " tokens"); else if (info.chars) bits.push(info.chars + " chars");
      if (bits.length) r.li.querySelector(".stat").textContent = bits.join(" · ");
      r.ms = info.ms; r.tokens = info.tokens; r.partial = info.partial; r.error = info.error;
    }
    function tab(k) {
      var tabs = $q(".cand-tabs"); tabs.hidden = false; $q(".cand-view").hidden = false;
      if (!tabs.querySelector('[data-k="' + k + '"]')) {
        var b = document.createElement("button"); b.type = "button"; b.dataset.k = k; b.textContent = rows[k] ? rows[k].label : k;
        b.addEventListener("click", function () { active = k; paint(); });
        tabs.appendChild(b);
      }
      if (!active) active = k;
    }
    function paint() {
      renderT = null;
      $q(".cand-tabs").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.k === active)); });
      if (active) $q(".cand-view").innerHTML = md(texts[active] || "") + (rows[active] && rows[active].status === "writing" ? '<span class="caret"></span>' : "");
      if (finalText) $q(".final").innerHTML = md(finalText) + '<span class="caret"></span>';
      scrollEnd();
    }
    function later() { if (!renderT) renderT = setTimeout(paint, 120); }
    return {
      remove: function () { clearInterval(tick); d.remove(); },
      timeline: function () {
        return order.map(function (k) { var r = rows[k]; return { label: r.label, model: r.model, status: r.status, ms: r.ms, tokens: r.tokens, partial: !!r.partial, error: r.error }; });
      },
      event: function (ev, x) {
        if (ev === "route") {
          var many = x.engines.length > 1 && x.mode === "executive";
          $q(".rline").textContent = (x.mode === "executive" ? "Executive · " : cap(x.mode) + " · ") + (LABELS[x.taskType] || x.taskType) +
            (many ? " → " + x.engines.length + " engines in parallel" + (x.judge ? ", synthesis by " + x.judge.label : "") : " → " + x.engines[0].label + " first, " + (x.engines.length - 1) + " on standby");
          x.engines.forEach(function (e) { row(e); });
          if (x.judge && many) row({ engine: "_synth", label: "Synthesis · " + x.judge.label, model: x.judge.model });
        } else if (ev === "engine") {
          setRow(x);
        } else if (ev === "synth") {
          setRow({ engine: "_synth", label: "Synthesis", status: x.status === "skipped" ? "skipped" : x.status, model: x.model });
          if (x.status === "writing" || x.status === "thinking") { var fh = $q(".final-head"); fh.hidden = false; fh.textContent = "BLACK synthesis · " + x.label + " is writing the final answer"; }
          if (x.status === "skipped") { var fh2 = $q(".final-head"); fh2.hidden = false; fh2.textContent = "Synthesis skipped · using the strongest answer from " + x.label; }
        } else if (ev === "switch") {
          var s2 = document.createElement("p"); s2.className = "switch";
          s2.textContent = "↪ " + x.from + " didn't answer (" + x.reason + "). Switching to " + x.to + ".";
          $q(".switches").appendChild(s2);
        } else if (ev === "delta") {
          if (x.target === "final") finalText += x.text;
          else { texts[x.target] = (texts[x.target] || "") + x.text; tab(x.target); }
          later();
        }
      }
    };
  }
  function addError(msg, retry) {
    var d = document.createElement("div"); d.className = "msg";
    d.innerHTML = '<div class="answer"><p class="error"></p></div>';
    d.querySelector(".error").textContent = msg;
    if (retry) {
      var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm retry"; b.textContent = "Retry this brief";
      b.addEventListener("click", function () { if (busy) return; d.remove(); retry(); });
      d.querySelector(".answer").appendChild(b);
    }
    el.thread.appendChild(d);
  }
  function addAnswer(meta, content) {
    var d = document.createElement("div"); d.className = "msg";
    var a = document.createElement("div"); a.className = "answer";
    a.innerHTML = '<div class="head"><span class="who">BLACK</span></div><div class="body"></div><div class="trail"></div>';
    a.querySelector(".body").innerHTML = md(content);
    var trail = a.querySelector(".trail");
    if (meta.preview) chip(trail, "Preview", "no model called", true);
    if (meta.mode) chip(trail, "Mode", cap(meta.mode));
    if (meta.taskType) chip(trail, "Task", LABELS[meta.taskType] || meta.taskType);
    if (meta.provider) chip(trail, "Engine", meta.provider + (meta.model ? " · " + meta.model : ""));
    if (meta.fallback) chip(trail, "Fallback", "used", true);
    if (typeof meta.latencyMs === "number") chip(trail, "Latency", (meta.latencyMs / 1000).toFixed(1) + "s");
    if (typeof meta.cost === "number") chip(trail, "Cost", "$" + meta.cost.toFixed(4));
    if (meta.reasons && meta.reasons.length) chip(trail, "Why", meta.reasons.join(", "));
    if (meta.timeline) meta.timeline.forEach(function (t) {
      var mark = t.status === "done" ? (t.partial ? "◐" : "✓") : t.status === "failed" ? "✕" : "–";
      chip(trail, mark + " " + t.label, (t.model ? t.model + " · " : "") + (typeof t.ms === "number" ? (t.ms / 1000).toFixed(1) + "s" : STATUS[t.status] || t.status) + (t.error ? " · " + t.error : ""), t.status === "failed");
    });
    if (meta.disagreements && meta.disagreements.length) {
      meta.disagreements.forEach(function (x) { chip(trail, "Disagreement", x, true); });
    }
    if (meta.candidates && meta.candidates.length) {
      var det = document.createElement("details"); det.className = "cands";
      det.innerHTML = "<summary>View " + meta.candidates.length + " candidate answers</summary>";
      meta.candidates.forEach(function (c, i) {
        var cd = document.createElement("div"); cd.className = "c";
        cd.innerHTML = "<strong></strong>" + md(c.text || "");
        cd.querySelector("strong").textContent = "Candidate " + (i + 1) + (c.model ? " · " + c.model : "");
        det.appendChild(cd);
      });
      a.appendChild(det);
    }
    d.appendChild(a); el.thread.appendChild(d);
  }
  function chip(parent, k, v, warn) {
    var s = document.createElement("span"); s.className = "chip" + (warn ? " warn" : "");
    var b = document.createElement("b"); b.textContent = k + ": ";
    s.appendChild(b); s.appendChild(document.createTextNode(v)); parent.appendChild(s);
  }
  function scrollEnd() { requestAnimationFrame(function () { el.scroll.scrollTop = el.scroll.scrollHeight; }); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Minimal, safe markdown: escape first, then format headings, bold, inline code, code blocks, lists, paragraphs.
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function inline(s) {
    return s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }
  function md(src) {
    var out = [], blocks = esc(src || "").split(/```/);
    blocks.forEach(function (chunk, i) {
      if (i % 2) { out.push("<pre><code>" + chunk.replace(/^\w*\n/, "") + "</code></pre>"); return; }
      var list = null;
      chunk.split("\n").forEach(function (line) {
        var t = line.trim();
        if (/^[-*] /.test(t)) { if (!list) { list = []; } list.push("<li>" + inline(t.slice(2)) + "</li>"); return; }
        if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; }
        if (!t) return;
        var hm = t.match(/^#{1,4} (.*)/);
        out.push(hm ? "<h3>" + inline(hm[1]) + "</h3>" : "<p>" + inline(t) + "</p>");
      });
      if (list) out.push("<ul>" + list.join("") + "</ul>");
    });
    return out.join("");
  }
})();
