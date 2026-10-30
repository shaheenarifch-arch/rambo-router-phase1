/*
 * BLACK plans in the console: Plan & billing panel, 7-day free trial checkout, Manage billing.
 * Exposes window.BLACK_PLAN { state, refresh, open, close, subscribe, portal, onChange }.
 *
 * Sign-in is the GetServices account (calendar.js keeps the session). Plans are billed by
 * Stripe through ATLAS; the gateway checks the plan and allowance on every brief.
 *   /app.html?subscribe=starter|pro  start that plan's checkout (signing in first if needed)
 *   /app.html?checkout=subscribed    back from Stripe: plan is confirmed, live answers on
 *   /app.html?billing=managed        back from Manage billing: plan is refreshed
 */
(function () {
  "use strict";
  var SESSION = "black.session", PENDING = "black.pendingPlan";
  var HELP = { plans: "/pricing/", terms: "/terms/#billing", enterprise: "/pricing/#enterprise", signup: "https://app.getservices.ai/#/signup" };
  var BUCKET = { quick: "Fast & Smart briefs", deep: "Deep briefs", executive: "Executive briefs" };
  var state = { signedIn: false, loading: false, black: null, usage: null, error: null };
  var listeners = [], panel = null, notice = "";

  function token() { try { return localStorage.getItem(SESSION) || ""; } catch (e) { return ""; } }
  function store(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch (e) {} }
  function stored(k) { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) {} }); if (panel && panel.classList.contains("open")) render(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(cents) { return "$" + Math.round((cents || 0) / 100); }
  function day(s) { if (!s) return ""; var d = new Date(String(s).replace(" ", "T") + "Z"); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }

  function api(path, method, body) {
    return fetch("/v1/me/" + path, {
      method: method || "GET",
      headers: { "content-type": "application/json", authorization: "Bearer " + token() },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.detail || j.error || "BLACK couldn't reach billing (" + r.status + ")."); e.status = r.status; e.code = j.code || j.error; throw e; }
        return j;
      });
    });
  }

  function refresh() {
    state.signedIn = !!token();
    if (!state.signedIn) { state.black = null; state.usage = null; state.loading = false; emit(); return Promise.resolve(state); }
    state.loading = true; emit();
    return api("plan").then(function (j) {
      state.black = j.black || null; state.usage = j.usage || null; state.error = null;
    }).catch(function (e) {
      if (e.status === 401) state.signedIn = false;
      state.error = e.status === 401 ? null : e.message;
    }).then(function () { state.loading = false; emit(); return state; });
  }

  function signIn() {
    if (window.BLACK_CAL && window.BLACK_CAL.openSignIn) window.BLACK_CAL.openSignIn();
    else window.location.href = HELP.signup;
  }

  // Starts Stripe Checkout for a plan (7-day free trial on the first plan). Signs in first if needed.
  function subscribe(plan) {
    if (!token()) { store(PENDING, plan); notice = "Sign in with your GetServices account to start your " + cap(plan) + " trial."; open(); signIn(); return; }
    store(PENDING, "");
    notice = "Opening secure checkout…"; open();
    api("subscribe", "POST", { plan: plan }).then(function (j) {
      if (j.url) window.location.href = j.url;
    }).catch(function (e) {
      notice = e.code === "has_subscription" ? "You already have a BLACK plan. Use Manage billing to change it." : e.message;
      refresh();
    });
  }

  function portal() {
    notice = "Opening Manage billing…"; render();
    api("portal", "POST", {}).then(function (j) { if (j.url) window.location.href = j.url; })
      .catch(function (e) { notice = e.message; render(); });
  }

  // ---------- panel ----------
  function css() {
    if (document.getElementById("bp-style")) return;
    var s = document.createElement("style"); s.id = "bp-style";
    s.textContent =
      ".bp-back{position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.66);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}" +
      ".bp-back.open{display:flex}" +
      ".bp{position:relative;width:min(640px,100%);max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--line-gold,rgba(227,196,107,.35));border-radius:18px;background:var(--panel,#0b0b0b);color:var(--text,#eee);padding:24px 22px;box-shadow:0 30px 80px rgba(0,0,0,.6)}" +
      ".bp h2{margin:0 0 4px;font-size:22px}.bp .bp-sub{margin:0 0 18px;color:var(--muted,#aaa);font-size:14px}" +
      ".bp .bp-x{position:absolute;top:12px;right:12px;background:none;border:0;color:var(--muted,#aaa);font-size:18px;cursor:pointer;padding:6px}" +
      ".bp-plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:0 0 14px}" +
      ".bp-card{border:1px solid var(--line,rgba(255,255,255,.1));border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px;background:rgba(255,255,255,.02)}" +
      ".bp-card.pro{border-color:var(--line-gold,rgba(227,196,107,.45))}" +
      ".bp-card h3{margin:0;font-size:16px;color:var(--gold,#e3c46b)}.bp-price{font-size:26px;font-weight:700}.bp-price small{font-size:13px;font-weight:400;color:var(--muted,#aaa)}" +
      ".bp-card ul{margin:0;padding-left:18px;font-size:13.5px;color:var(--muted,#bbb)}.bp-card li{margin:3px 0}.bp-card .btn{margin-top:auto;text-align:center}" +
      ".bp-status{border:1px solid var(--line,rgba(255,255,255,.1));border-radius:14px;padding:14px 16px;margin:0 0 14px}" +
      ".bp-status b{color:var(--gold,#e3c46b)}.bp-warn{color:#f0b35a}" +
      ".bp-meter{margin:10px 0 0}.bp-meter .row{display:flex;justify-content:space-between;font-size:13.5px;color:var(--muted,#bbb)}" +
      ".bp-bar{height:6px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:4px}.bp-bar i{display:block;height:100%;background:linear-gradient(90deg,#b8902f,#f6e19a)}" +
      ".bp-actions{display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 12px}.bp-note{font-size:14px;color:var(--gold,#e3c46b);margin:0 0 12px;min-height:1px}" +
      ".bp-help{font-size:13px;color:var(--dim,#888);margin:6px 0 0;line-height:1.6}.bp-help a{color:var(--muted,#ccc)}";
    document.head.appendChild(s);
  }
  function build() {
    if (panel) return;
    css();
    panel = document.createElement("div"); panel.className = "bp-back"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-labelledby", "bp-title");
    panel.innerHTML = '<div class="bp"><button type="button" class="bp-x" aria-label="Close">✕</button><div class="bp-body"></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener("click", function (e) {
      if (e.target === panel || e.target.closest(".bp-x")) return close();
      var b = e.target.closest("[data-bp]"); if (!b) return;
      var act = b.getAttribute("data-bp");
      if (act === "signin") signIn();
      else if (act === "portal") portal();
      else if (act === "retry") refresh();
      else if (act.indexOf("plan:") === 0) subscribe(act.slice(5));
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.classList.contains("open")) close(); });
  }
  function planCards(black) {
    var p = (black && black.pricing) || { starter: { name: "Starter", monthly: 9900, allowance: { quick: 1000, deep: 100, executive: 20 } }, pro: { name: "Pro", monthly: 29900, allowance: { quick: 5000, deep: 500, executive: 150 } } };
    var trial = !(black && black.trial_used), days = (black && black.trial_days) || 7;
    function card(k, cls) {
      var x = p[k]; if (!x) return "";
      var a = x.allowance || {};
      return '<div class="bp-card ' + cls + '"><h3>' + esc(x.name) + '</h3><div class="bp-price">' + money(x.monthly) + ' <small>/ month</small></div><ul>' +
        "<li>" + Number(a.quick || 0).toLocaleString() + " Fast &amp; Smart briefs</li><li>" + Number(a.deep || 0).toLocaleString() + " Deep briefs</li><li>" + Number(a.executive || 0).toLocaleString() + " Executive briefs</li><li>All 5 engines, Docs Analyst, BLACK Calendar</li></ul>" +
        '<button type="button" class="btn ' + (cls === "pro" ? "btn-gold" : "btn-ghost") + ' btn-sm" data-bp="plan:' + k + '">' + (trial ? "Start " + days + "-day free trial" : "Choose " + esc(x.name)) + "</button></div>";
    }
    return '<div class="bp-plans">' + card("starter", "") + card("pro", "pro") +
      '<div class="bp-card"><h3>Enterprise</h3><div class="bp-price">Custom</div><ul><li>Team seats and custom allowances</li><li>Dedicated support</li></ul><a class="btn btn-ghost btn-sm" href="' + HELP.enterprise + '">Contact sales</a></div></div>' +
      '<p class="bp-help">' + (trial ? "Card required; you won’t be charged until day " + (days + 1) + ". Cancel any time before then in Manage billing. " : "") +
      'Allowances reset every billing period. <a href="' + HELP.plans + '">Compare plans</a> · <a href="' + HELP.terms + '">Billing terms</a></p>';
  }
  function meters(b, u) {
    var a = b.allowance || {}, out = "";
    ["quick", "deep", "executive"].forEach(function (k) {
      var lim = Number(a[k]) || 0, used = Math.min(Number((u || {})[k]) || 0, lim || Infinity), pct = lim ? Math.min(100, Math.round(used / lim * 100)) : 0;
      out += '<div class="bp-meter"><div class="row"><span>' + BUCKET[k] + "</span><span>" + used.toLocaleString() + " of " + lim.toLocaleString() + '</span></div><div class="bp-bar"><i style="width:' + pct + '%"></i></div></div>';
    });
    return out;
  }
  function render() {
    build();
    var body = panel.querySelector(".bp-body"), b = state.black, h = "";
    h += '<h2 id="bp-title">Plan &amp; billing</h2>';
    if (!state.signedIn) {
      h += '<p class="bp-sub">Sign in with your GetServices account, then start your free trial to get live answers from every engine.</p>' +
        '<div class="bp-actions"><button type="button" class="btn btn-gold btn-sm" data-bp="signin">Sign in</button><a class="btn btn-ghost btn-sm" href="' + HELP.signup + '" target="_blank" rel="noopener">Create an account</a></div>' + planCards(null);
    } else if (state.loading && !b) {
      h += '<p class="bp-sub">Checking your plan…</p>';
    } else if (state.error && !b) {
      h += '<p class="bp-sub bp-warn">' + esc(state.error) + '</p><div class="bp-actions"><button type="button" class="btn btn-ghost btn-sm" data-bp="retry">Try again</button></div>';
    } else if (b && b.unlimited) {
      h += '<div class="bp-status"><b>Owner access</b> · unlimited briefs on every engine.</div>';
    } else if (b && b.active) {
      var line = b.trial ? "Free trial · ends " + day(b.trial_end) + ", then " + money((b.pricing && b.pricing[b.plan] || {}).monthly) + "/month"
        : b.cancel_at_period_end ? "Cancels on " + day(b.period_end) + ". You keep access until then."
        : "Renews " + day(b.period_end);
      h += '<p class="bp-sub">Your allowance resets every billing period' + (b.period_end ? " (next: " + day(b.period_end) + ")" : "") + ".</p>" +
        '<div class="bp-status"><b>BLACK ' + esc(b.name) + "</b> · " + esc(line) +
        (b.past_due ? '<p class="bp-warn" style="margin:8px 0 0">Your last payment failed. Update your card in Manage billing to keep live answers.</p>' : "") +
        (b.trial ? '<p class="bp-help" style="margin:8px 0 0">During the trial, Executive Mode is limited to ' + Number((b.allowance || {}).executive || 0) + " briefs.</p>" : "") +
        meters(b, state.usage) + "</div>" +
        '<div class="bp-actions"><button type="button" class="btn btn-gold btn-sm" data-bp="portal">Manage billing</button><a class="btn btn-ghost btn-sm" href="' + HELP.plans + '">Compare plans</a></div>' +
        '<p class="bp-help">Manage billing opens Stripe’s secure page to change plan, update your card, download invoices or cancel. Need more? <a href="' + HELP.enterprise + '">Talk to us about Enterprise</a>.</p>';
    } else {
      h += '<p class="bp-sub">' + (b && b.trial_used ? "Choose a plan to get live answers again." : "Start your 7-day free trial to get live answers from Claude, GPT, Gemini, Perplexity and Grok.") + "</p>" + planCards(b);
    }
    body.innerHTML = '<p class="bp-note" aria-live="polite">' + esc(notice) + "</p>" + h;
  }
  function open() { build(); render(); panel.classList.add("open"); var f = panel.querySelector("[data-bp], a"); if (f) f.focus(); if (state.signedIn && !state.black && !state.loading) refresh(); }
  function close() { if (panel) panel.classList.remove("open"); notice = ""; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  window.BLACK_PLAN = {
    state: function () { return state; }, refresh: refresh, open: open, close: close,
    subscribe: subscribe, portal: portal, onChange: function (f) { listeners.push(f); }
  };

  // Sign-in / sign-out (calendar.js): refresh the plan, and continue a plan chosen before signing in.
  if (window.BLACK_CAL && window.BLACK_CAL.onChange) window.BLACK_CAL.onChange(function () {
    var was = state.signedIn;
    refresh().then(function () { var p = stored(PENDING); if (!was && state.signedIn && p) subscribe(p); });
  });

  // Arrivals from the Pricing page, Stripe Checkout and Manage billing.
  var q = new URLSearchParams(window.location.search), clean = false;
  var want = q.get("subscribe");
  if (want === "starter" || want === "pro") { clean = true; subscribe(want); }
  if (q.get("checkout") === "subscribed") {
    clean = true; notice = "Welcome to BLACK. Your plan is active; live answers are on."; open();
    // Stripe confirms the plan by webhook, usually within seconds.
    var tries = 0;
    (function poll() { refresh().then(function () { if (!(state.black && state.black.active) && ++tries < 6) setTimeout(poll, 2000); }); })();
  } else if (q.get("billing") === "managed") { clean = true; refresh(); }
  else if (!want) refresh();
  if (clean && window.history && history.replaceState) {
    ["subscribe", "checkout", "session_id", "billing"].forEach(function (k) { q.delete(k); });
    history.replaceState(null, "", window.location.pathname + (q.toString() ? "?" + q : "") + window.location.hash);
  }
})();
