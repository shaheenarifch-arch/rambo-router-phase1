/* BLACK Command Workspace — the live login screen in the console.
 * The briefcase-and-glasses agent "builds" each slide (stocks, crypto, strategic portfolio, allocation,
 * assets, meetings and statements, live activity), then the values keep moving.
 * DEMO DATA ONLY: every name, price and position is fictional until real feeds are connected.
 * One 1s timer drives everything and stops when the tab is hidden, a brief is open, or the user pauses.
 */
(function () {
  "use strict";
  var root = document.getElementById("ws");
  if (!root) return;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- demo book (fictional) ----------
  var stocks = [
    { s: "SPY", n: "S&P 500 ETF", p: 582.1, q: 6950, v: 0.0009 },
    { s: "MSFT", n: "Software", p: 428.15, q: 2100, v: 0.0012 },
    { s: "AAPL", n: "Devices", p: 231.9, q: 3800, v: 0.0012 },
    { s: "NVDA", n: "Semis", p: 138.4, q: 4500, v: 0.0022 }
  ];
  var crypto = [
    { s: "BTC", n: "Bitcoin", p: 67420, q: 24.5, v: 0.0018 },
    { s: "ETH", n: "Ether", p: 2610.5, q: 180, v: 0.0022 },
    { s: "SOL", n: "Solana", p: 168.2, q: 1122, v: 0.003 }
  ];
  stocks.concat(crypto).forEach(function (x) { x.o = x.p; });
  var hard = [
    { n: "Lakeview Residence", d: "Leased · 5.8% net yield", v: 1850000, tag: "Est" },
    { n: "Horizon Growth Fund II", d: "NAV Q3 · $180K unfunded", v: 1420000, tag: "Q3" },
    { n: "Executive vehicle", d: "Insured", v: 250000, tag: "Est" },
    { n: "Watch collection", d: "Appraised", v: 400000, tag: "Appraised" }
  ];
  var CASH = 2140000;
  var initiatives = [
    { n: "EMEA expansion", st: "On track", rag: "g", spend: 62, value: 71 },
    { n: "AI platform rollout", st: "Ahead", rag: "g", spend: 48, value: 66 },
    { n: "Ops efficiency program", st: "At risk", rag: "a", spend: 81, value: 54 },
    { n: "M&A pipeline", st: "Review", rag: "r", spend: 35, value: 28 }
  ];
  var targets = { Equities: 45, "Hard & private": 25, Crypto: 15, Cash: 15 };
  var now = new Date();
  function at(h, m) { var d = new Date(now); d.setHours(h, m, 0, 0); return d; }
  var meetings = [
    { t: at(10, 0), n: "Board call", tag: "Brief ready" },
    { t: at(13, 0), n: "Tax advisor", tag: "3 documents" },
    { t: at(16, 30), n: "Deal review", tag: "Deck drafting" }
  ];
  var realMeetings = false, realStatements = false, realCash = false; // true once the signed-in user's calendar replaces the demo meetings
  var statements = [
    { n: "Brokerage · " + monthName(), p: 100 },
    { n: "Private bank · " + monthName(), p: 100 },
    { n: "K-1 tax package", p: 62 },
    { n: "Card statement", p: 30, warn: "1 item untagged" }
  ];
  var history = []; // net worth history for the sparkline
  var events = []; // events per hour (activity chart)
  for (var i = 0; i < 12; i++) events.push(2 + Math.round(Math.random() * 9));
  var feed = [
    ["✔", "Daily NAV computed"], ["✔", "Brokerage statement reconciled"], ["⟳", "Cold vault syncing"],
    ["⚠", "Crypto above 15% target"], ["✔", "Board brief drafted"], ["✔", "Calendar conflicts resolved"]
  ];
  var FEED_POOL = [
    ["✔", "Price feed refreshed"], ["✔", "Dividend posted · MSFT"], ["✔", "Meeting notes summarized"],
    ["⟳", "Rebalance preview running"], ["✔", "Statement page parsed"], ["✔", "FX rates updated"],
    ["⚠", "NVDA moved more than 2%"], ["✔", "Wallet balance confirmed"]
  ];

  // ---------- math ----------
  function sum(a, f) { return a.reduce(function (n, x) { return n + f(x); }, 0); }
  function totals() {
    var eq = sum(stocks, function (x) { return x.p * x.q; });
    var cr = sum(crypto, function (x) { return x.p * x.q; });
    var hd = sum(hard, function (x) { return x.v; });
    var nw = eq + cr + hd + CASH;
    var pnl = sum(stocks.concat(crypto), function (x) { return (x.p - x.o) * x.q; });
    return { eq: eq, cr: cr, hd: hd, cash: CASH, nw: nw, pnl: pnl };
  }
  function step(x) { var r = (Math.random() - 0.48) * 2 * x.v; x.p = Math.max(0.01, x.p * (1 + r)); }
  var base = totals().nw;
  for (var k = 0; k < 30; k++) history.push(base * (0.965 + k * 0.0012 + (Math.random() - 0.5) * 0.006));
  history.push(base);

  // ---------- format ----------
  function money(v, d) {
    var a = Math.abs(v), s = v < 0 ? "−" : "";
    if (d === "c") return s + "$" + a.toLocaleString(undefined, { maximumFractionDigits: a < 1000 ? 2 : 0, minimumFractionDigits: a < 1000 ? 2 : 0 });
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
    return s + "$" + a.toFixed(0);
  }
  function pct(x) { var c = (x.p / x.o - 1) * 100; return (c >= 0 ? "▲ " : "▼ ") + Math.abs(c).toFixed(2) + "%"; }
  function up(x) { return x.p >= x.o; }
  function hm(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function monthName() { return new Date().toLocaleDateString([], { month: "short" }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- slides ----------
  var TODAY = new Date().toLocaleDateString([], { month: "short", day: "numeric" });
  var SLIDES = [
    { id: "overview", doc: "Morning Brief \u00b7 " + TODAY, k: "Executive Summary", h: "Net Worth Today", t: "Net worth", tasks: [["Gemini", "Consolidating 9 accounts"], ["GPT", "Computing today's P&L"], ["Claude", "Writing your morning summary"]] },
    { id: "stocks", doc: "Equities \u00b7 " + TODAY, k: "Market Positions", h: "Stocks", t: "Portfolio", tasks: [["RAMBO", "Connecting market feed"], ["GPT", "Valuing 4 positions"], ["Grok", "Scanning price signals"]] },
    { id: "crypto", doc: "Digital Assets \u00b7 " + TODAY, k: "Wallets & Exchanges", h: "Crypto", t: "Crypto", tasks: [["RAMBO", "Syncing exchange and cold vault"], ["Gemini", "Reconciling 3 wallets"], ["Grok", "Watching volatility"]] },
    { id: "strategic", doc: "Strategic Portfolio \u00b7 FY27", k: "Strategic Portfolio", h: "Initiative Scorecard", t: "Strategy", tasks: [["Claude", "Mapping initiatives to strategy"], ["GPT", "Scoring value against spend"], ["Gemini", "Flagging risks"]] },
    { id: "alloc", doc: "Allocation Review \u00b7 " + TODAY, k: "Portfolio Allocation", h: "Target vs Actual", t: "Allocation", tasks: [["GPT", "Measuring drift from targets"], ["Claude", "Drafting rebalance options"]] },
    { id: "assets", doc: "Asset Register \u00b7 Q3", k: "Hard & Private Assets", h: "Asset Register", t: "Assets", tasks: [["Gemini", "Reading valuations and appraisals"], ["Perplexity", "Checking market comparables"]] },
    { id: "today", doc: "Today \u00b7 " + TODAY, k: "Meetings & Statements", h: "Your Day", t: "Your day", tasks: [["Claude", "Preparing meeting briefs"], ["Gemini", "Parsing statements"], ["RAMBO", "Filing documents"]] },
    { id: "activity", doc: "Agent Activity \u00b7 Live", k: "Live Activity", h: "Agents at Work", t: "Activity", tasks: [["RAMBO", "Streaming agent activity"]] }
  ];
  var viewing = false;

  // ---------- the user's name ("Shaheen Executive Workspace"), remembered on this device and with their account ----------
  var NAME_KEY = "black.name", nameListeners = [];
  function cleanName(n) { return String(n || "").replace(/[<>"`]/g, "").replace(/\s+/g, " ").trim().slice(0, 40); }
  function getName() { try { return cleanName(localStorage.getItem(NAME_KEY)); } catch (e) { return ""; } }
  function storeName(n, sync) {
    n = cleanName(n);
    try { n ? localStorage.setItem(NAME_KEY, n) : localStorage.removeItem(NAME_KEY); } catch (e) {}
    if (sync && window.BLACK_CAL && window.BLACK_CAL.saveName) window.BLACK_CAL.saveName(n);
    nameListeners.forEach(function (f) { f(n); });
  }
  window.BLACK_NAME = {
    get: getName,
    set: function (n) { storeName(n, true); },
    // The account's saved name wins when signing in on a new device; a name typed before signing in is copied up.
    fromAccount: function (n) { n = cleanName(n); if (n && n !== getName()) storeName(n, false); else if (!n && getName() && window.BLACK_CAL) window.BLACK_CAL.saveName(getName()); },
    onChange: function (f) { nameListeners.push(f); }
  };
  var cur = 0, phase = "build", stepN = 0, holdTicks = 0, paused = false, userPaused = false, hidden = false, t0 = Date.now(), n = 0;
  var TICK = 250, STEP_TICKS = 3, HOLD_TICKS = 28; // 0.75s per agent step, ~7s live per slide

  root.innerHTML =
    '<div class="ws-top">' +
      '<div class="ws-who" id="ws-who"></div>' +
      '<div class="ws-nav">' +
        '<button type="button" class="ws-arrow" id="ws-prev" aria-label="Previous view" title="Previous view (\u2190)">\u2039</button>' +
        '<div class="ws-tabs" role="tablist" aria-label="Workspace views" id="ws-tabs">' +
          SLIDES.map(function (x, i) { return '<button role="tab" type="button" data-i="' + i + '">' + esc(x.t) + "</button>"; }).join("") +
        "</div>" +
        '<button type="button" class="ws-arrow" id="ws-next" aria-label="Next view" title="Next view (\u2192)">\u203a</button>' +
      "</div>" +
      '<button type="button" class="ws-play" id="ws-play" aria-label="Pause slides">❚❚</button>' +
    "</div>" +
    '<div class="ws-kpis" id="ws-kpis"></div>' +
    '<div class="ws-cover">' +
      '<div class="ws-status" id="ws-agent"><span class="ws-pulse"></span><b>RAMBO</b><span class="ws-job" id="ws-job"></span><span class="ws-sub" id="ws-sub"></span>' +
        '<button type="button" class="ws-skip" id="ws-skip" title="Skip the build animation and show the finished slide">Skip \u203a</button>' +
        '<button type="button" class="ws-det" id="ws-det" aria-expanded="false" aria-controls="ws-sub" title="Show which agents built this slide">Details \u25b8</button>' +
        '<button type="button" class="ws-exp" id="ws-exp" title="Open this slide in a bigger view">\u2922 Expand</button>' +
        '<span class="ws-clock" id="ws-clock">LIVE</span></div>' +
      '<span class="ws-cover-k" id="ws-cover-k"></span><span class="ws-cover-h gold-text" id="ws-cover-h"></span>' +
      '<div class="ws-slide" id="ws-slide" aria-live="polite"></div>' +
    "</div>" +
    '<div class="ws-upload" role="status"><span class="ws-info" aria-hidden="true">i</span><span><b>You\u2019re seeing test data.</b> Upload your files with the \ud83d\udcce paperclip to see your real-time data: bank statements (OFX, QFX, CSV or PDF), holdings (Excel or CSV) or a calendar (.ics).</span>' +
      '<button type="button" id="ws-upload-btn">\ud83d\udcce Upload files</button></div>';

  var $ = function (id) { return document.getElementById(id); };
  function renderWho(asking) {
    var n = getName(), box = $("ws-who");
    if (n && !asking) {
      box.innerHTML = '<span class="ws-kicker"><span class="ws-name"></span> Executive Workspace</span>' +
        '<button type="button" class="ws-name-edit" id="ws-name-edit" aria-label="Change your name" title="Change what BLACK calls you">\u270e</button>';
      box.querySelector(".ws-name").textContent = n;
      $("ws-name-edit").addEventListener("click", function () { renderWho(true); });
      return;
    }
    box.innerHTML = '<form class="ws-name-ask" id="ws-name-form"><label for="ws-name-in">What should BLACK call you?</label>' +
      '<input id="ws-name-in" maxlength="40" autocomplete="given-name" placeholder="Your first name" required>' +
      '<button type="submit">Save</button>' + (n ? '<button type="button" class="ws-name-x" id="ws-name-x" aria-label="Cancel">\u2715</button>' : "") +
      '<small>Remembered on this device, and with your GetServices account when you sign in.</small></form>';
    var inp = $("ws-name-in"); inp.value = n;
    if (asking) setTimeout(function () { inp.focus(); inp.select(); }, 0);
    $("ws-name-form").addEventListener("submit", function (e) { e.preventDefault(); var v = cleanName(inp.value); if (v) { window.BLACK_NAME.set(v); } });
    if ($("ws-name-x")) $("ws-name-x").addEventListener("click", function () { renderWho(false); });
  }
  renderWho(false);
  window.BLACK_NAME.onChange(function () { renderWho(false); });
  $("ws-upload-btn").addEventListener("click", function () { var b = document.getElementById("attach-btn"); if (b) { b.focus(); b.click(); } });
  $("ws-tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) go(+b.dataset.i); });
  $("ws-prev").addEventListener("click", function () { go((cur - 1 + SLIDES.length) % SLIDES.length); });
  $("ws-next").addEventListener("click", function () { go((cur + 1) % SLIDES.length); });
  $("ws-tabs").addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); go((cur + (e.key === "ArrowRight" ? 1 : -1) + SLIDES.length) % SLIDES.length); $("ws-tabs").children[cur].focus(); }
  });
  $("ws-play").addEventListener("click", function () {
    userPaused = !userPaused;
    $("ws-play").textContent = userPaused ? "▶" : "❚❚";
    $("ws-play").setAttribute("aria-label", userPaused ? "Play slides" : "Pause slides");
  });
  document.addEventListener("visibilitychange", function () { hidden = document.hidden; });
  $("ws-skip").addEventListener("click", function () { if (phase === "build") finishBuild(); });
  $("ws-det").addEventListener("click", function () {
    var on = root.classList.toggle("show-d");
    this.setAttribute("aria-expanded", String(on)); this.textContent = on ? "Details \u25be" : "Details \u25b8";
  });
  $("ws-exp").addEventListener("click", function () { openSlides(cur); });
  $("ws-kpis").addEventListener("click", function (e) { var k = e.target.closest("[data-k]"); if (k) openKpis(+k.dataset.k); });
  root.querySelector(".ws-cover").addEventListener("click", function (e) {
    if (e.target.closest("button,a")) return;
    var r = e.target.closest(".ws-row[data-r]");
    if (r) openRows(cur, r.dataset.g || "", +r.dataset.r); else openSlides(cur);
  });

  function kpis() {
    var t = totals();
    var tasks = 3 + (cur % 3);
    $("ws-kpis").innerHTML =
      kpi("Net worth", money(t.nw), (t.pnl >= 0 ? "▲ " : "▼ ") + (Math.abs(t.pnl) / (t.nw - t.pnl) * 100).toFixed(2) + "% today", t.pnl >= 0, 0) +
      kpi("Today's P&L", (t.pnl >= 0 ? "+" : "") + money(t.pnl), "Stocks and crypto", t.pnl >= 0, 1) +
      kpi("Liquid cash", money(t.cash), realCash ? "From your statement" : (t.cash / t.nw * 100).toFixed(1) + "% of net worth", null, 2) +
      kpi("BLACK agents", tasks + " running", "2 need your approval", null, 3);
  }
  function kpi(k, v, s, good, i) {
    return '<div class="ws-kpi bv-tap" role="button" tabindex="0" data-k="' + i + '" aria-label="Open ' + k + ' in a bigger view"><span>' + k + '</span><b>' + v + '</b><small class="' + (good === true ? "up" : good === false ? "down" : "") + '">' + s + "</small></div>";
  }

  // ---------- bigger views (card viewer) ----------
  var DEMO_HELP = "These are <b>test figures</b>. Upload your statements, holdings or calendar with the \ud83d\udcce paperclip to see your own numbers.";
  var SLIDE_HELP = {
    overview: "Your total net worth: equities, crypto, hard and private assets, and cash, with today\u2019s change. " + DEMO_HELP,
    stocks: "Your stock positions with live price, today\u2019s move and position value. Tap a row for the full holding. " + DEMO_HELP,
    crypto: "Your crypto wallets and exchange balances. Tap a row for the full holding. " + DEMO_HELP,
    today: "Today\u2019s meetings and the statements BLACK is reconciling. Connect your calendar from the Calendar button at the top. " + DEMO_HELP,
    strategic: "Your strategic initiatives: status, budget used and value delivered so far. Tap a row for the full initiative. " + DEMO_HELP,
    alloc: "How your money is split versus your target mix. The white line on each bar is the target; \u26a0 marks drift over half a point. " + DEMO_HELP,
    assets: "Property, private funds and valuables, with how each value was set (estimate, appraisal or fund NAV). " + DEMO_HELP,
    activity: "What BLACK\u2019s agents did in the last 12 hours, newest first."
  };
  function view(list, i) {
    if (!window.BLACK_VIEW) return;
    viewing = true;
    window.BLACK_VIEW.open(list, i, { onClose: function () { viewing = false; } });
  }
  function bvList(pairs) { return '<div class="bv-list">' + pairs.map(function (x) { return "<div><span>" + x[0] + "</span><b>" + x[1] + "</b></div>"; }).join("") + "</div>"; }
  function slideAt(id) { for (var j = 0; j < SLIDES.length; j++) if (SLIDES[j].id === id) return j; return 0; }
  function goAct(i, label) { if (typeof i === "string") i = slideAt(i); return { label: label || "Open full slide \u2192", run: function () { go(i); } }; }
  function openSlides(i) {
    view(SLIDES.map(function (s, j) {
      return { kicker: s.doc, title: s.h, html: '<div class="ws-slide">' + build(j, 99, true) + "</div>", help: SLIDE_HELP[s.id], action: j === cur ? null : goAct(j, "Show on workspace \u2192") };
    }), i);
  }
  function openKpis(i) {
    var t = totals(), all = stocks.concat(crypto);
    var movers = all.slice().sort(function (a, b) { return Math.abs((b.p - b.o) * b.q) - Math.abs((a.p - a.o) * a.q); });
    var nw = function (v) { return money(v) + " \u00b7 " + (v / t.nw * 100).toFixed(1) + "%"; };
    view([
      { kicker: "Net worth", title: money(t.nw, "c"), html: '<p class="bv-sub">' + (t.pnl >= 0 ? "+" : "") + money(t.pnl, "c") + " today</p>" +
          bvList([["Equities", nw(t.eq)], ["Crypto", nw(t.cr)], ["Hard & private", nw(t.hd)], ["Cash", nw(t.cash)]]), help: SLIDE_HELP.overview, action: goAct("overview") },
      { kicker: "Today\u2019s P&L", title: (t.pnl >= 0 ? "+" : "") + money(t.pnl, "c"), html: '<p class="bv-sub">Biggest moves today, stocks and crypto</p>' +
          bvList(movers.map(function (x) { var d = (x.p - x.o) * x.q; return [x.s + " \u00b7 " + x.n, '<span class="' + (d >= 0 ? "up" : "down") + '">' + (d >= 0 ? "+" : "") + money(d) + " (" + pct(x) + ")</span>"]; })),
        help: "Profit or loss since today\u2019s open across your stock and crypto positions. " + DEMO_HELP, action: goAct("stocks") },
      { kicker: "Liquid cash", title: money(t.cash, "c"), html: '<p class="bv-sub">' + (t.cash / t.nw * 100).toFixed(1) + "% of net worth \u00b7 target 15%</p>" +
          bvList(statements.map(function (x) { return [x.n, x.p >= 100 ? (x.warn ? "\u26a0 " + x.warn : "\u2714 Reconciled") : "\u27f3 " + Math.round(x.p) + "%"]; })),
        help: realCash ? "Closing balance from the bank statement you uploaded. Upload more statements to include other accounts." : "Cash you can use now, from your bank and brokerage cash balances. " + DEMO_HELP, action: goAct("today", "Open statements \u2192") },
      { kicker: "BLACK agents", title: (3 + (cur % 3)) + " running", html: '<p class="bv-sub">2 need your approval</p>' +
          bvList(SLIDES[cur].tasks.map(function (x) { return [x[0], x[1]]; }).concat([["Needs approval", "Rebalance preview"], ["Needs approval", "Card statement \u00b7 1 item untagged"]])),
        help: "The AI engines BLACK is running for you right now, and anything waiting for your OK.", action: goAct("activity", "Open activity \u2192") }
    ], i);
  }
  function openRows(idx, g, r) {
    var s = SLIDES[idx], t = totals(), items = [];
    var hold = function (x, tot) {
      return { kicker: s.h, title: x.s + " \u00b7 " + x.n, html: '<div class="bv-big">' + money(x.p, "c") + '</div><p class="bv-sub"><span class="' + (up(x) ? "up" : "down") + '">' + pct(x) + "</span> today</p>" +
        bvList([["Quantity", x.q.toLocaleString()], ["Position value", money(x.p * x.q, "c")], ["Today\u2019s P&L", (x.p >= x.o ? "+" : "") + money((x.p - x.o) * x.q, "c")], ["Share of " + s.h.toLowerCase(), (x.p * x.q / tot * 100).toFixed(1) + "%"]]),
        help: DEMO_HELP, action: know("What's the outlook for " + x.n + " (" + x.s + ") and should I change my position?"), link: quote(x.s, s.id === "crypto") };
    };
    if (s.id === "overview") items = [["Equities", t.eq], ["Crypto", t.cr], ["Hard & private", t.hd], ["Cash", t.cash]].map(function (x, j) {
      return { kicker: "Net worth", title: x[0], html: '<div class="bv-big">' + money(x[1], "c") + '</div><p class="bv-sub">' + (x[1] / t.nw * 100).toFixed(1) + "% of net worth</p>", help: DEMO_HELP, action: [goAct("stocks"), goAct("crypto"), goAct("assets"), goAct("alloc", "Open allocation \u2192")][j] };
    });
    else if (s.id === "stocks") items = stocks.map(function (x) { return hold(x, t.eq); });
    else if (s.id === "crypto") items = crypto.map(function (x) { return hold(x, t.cr); });
    else if (s.id === "today" && g === "m") items = meetings.map(function (x) {
      return { kicker: "Meeting", title: x.n, html: '<div class="bv-big">' + (x.allDay ? "All day" : hm(x.t)) + '</div><p class="bv-sub">' + esc(x.tag || "") + "</p>",
        help: realMeetings ? "From your BLACK calendar." : DEMO_HELP, action: window.BLACK_CAL ? { label: "Open calendar \u2192", run: function () { window.BLACK_CAL.openDrawer(); } } : null };
    });
    else if (s.id === "today") items = statements.map(function (x) {
      return { kicker: "Statement", title: x.n, html: '<div class="bv-big">' + (x.p >= 100 ? "Reconciled" : Math.round(x.p) + "%") + '</div><p class="bv-sub">' + (x.warn ? "\u26a0 " + x.warn : x.p >= 100 ? "All items matched" : "BLACK is matching transactions") + "</p>",
        help: DEMO_HELP, action: { label: "\ud83d\udcce Upload a statement", run: function () { var b = document.getElementById("attach-btn"); if (b) b.click(); } } };
    });
    else if (s.id === "strategic") items = initiatives.map(function (x) {
      return { kicker: "Strategic initiative", title: x.n, html: '<div class="bv-big">' + x.st + "</div>" + bvList([["Budget used", x.spend + "%"], ["Value delivered", x.value + "%"], ["Status", { g: "Green \u00b7 on track", a: "Amber \u00b7 at risk", r: "Red \u00b7 needs review" }[x.rag]]]),
        help: SLIDE_HELP.strategic, action: know("Give me a status brief on " + x.n + ": risks, spend versus value, and what I should decide.") };
    });
    else if (s.id === "alloc") items = [["Equities", t.eq], ["Hard & private", t.hd], ["Crypto", t.cr], ["Cash", t.cash]].map(function (x) {
      var a = x[1] / t.nw * 100, d = a - targets[x[0]];
      return { kicker: "Allocation", title: x[0], html: '<div class="bv-big">' + a.toFixed(1) + '%</div><p class="bv-sub">Target ' + targets[x[0]] + "% \u00b7 " + (d > 0 ? "+" : "") + d.toFixed(1) + " pts</p>" + bvList([["Value", money(x[1], "c")], ["To reach target", (d > 0 ? "Reduce " : "Add ") + money(Math.abs(d) / 100 * t.nw)]]),
        help: SLIDE_HELP.alloc, action: know("Draft rebalance options to bring my " + x[0].toLowerCase() + " allocation back to target, with the trade-offs.") };
    });
    else if (s.id === "assets") items = hard.map(function (x) {
      return { kicker: "Asset", title: x.n, html: '<div class="bv-big">' + money(x.v, "c") + '</div><p class="bv-sub">' + x.d + "</p>" + bvList([["Valuation", x.tag], ["Share of hard & private", (x.v / t.hd * 100).toFixed(1) + "%"]]), help: SLIDE_HELP.assets };
    });
    else if (s.id === "activity") items = feed.slice(0, 5).map(function (f) {
      return { kicker: "Agent activity", title: f[1], html: '<div class="bv-big">' + f[0] + '</div><p class="bv-sub">' + (f[2] ? "At " + f[2] : "Earlier today") + "</p>", help: SLIDE_HELP.activity };
    });
    if (items.length) view(items, r);
  }
  // "Know more": send the question straight to BLACK. RAMBO routes it to the right engine and the answer opens.
  function ask(q) {
    var p = document.getElementById("prompt"), f = document.getElementById("composer"); if (!p) return;
    p.value = q; p.dispatchEvent(new Event("input", { bubbles: true }));
    if (f && f.requestSubmit) f.requestSubmit(); else p.focus();
  }
  function know(q) { return { label: "Know more \u2192", hint: "BLACK answers this right away, using the best engine for it", run: function () { ask(q); } }; }
  function quote(sym, isCrypto) { return { label: (isCrypto ? sym : sym) + " live quote \u2197", url: "https://finance.yahoo.com/quote/" + encodeURIComponent(isCrypto ? sym + "-USD" : sym) }; }

  // ---------- slide renderers ----------
  var plain = false; // true while building html for the viewer (rows are not clickable there)
  function rows(list, fn, n, g) {
    return list.map(function (x, i) {
      return '<div class="ws-row' + (i < n ? " in" : "") + (plain ? "" : ' bv-tap" role="button" tabindex="0" data-r="' + i + '"' + (g ? ' data-g="' + g + '"' : "") + ' aria-label="Open details') + '" style="--d:' + i * 90 + 'ms">' + fn(x) + "</div>";
    }).join("");
  }
  function render(n) { $("ws-slide").innerHTML = build(cur, n, false); }
  function build(idx, n, forView) {
    plain = !!forView;
    var s = SLIDES[idx], t = totals(), html = "";
    var shown = forView || phase !== "build" ? 99 : n;
    if (s.id === "overview") {
      var min = Math.min.apply(null, history), max = Math.max.apply(null, history);
      var pts = history.map(function (v, i) { return (i / (history.length - 1) * 300).toFixed(1) + "," + (70 - (v - min) / (max - min || 1) * 62).toFixed(1); }).join(" ");
      html = '<div class="ws-big"><span>Total net worth</span><b>' + money(t.nw, "c") + '</b><small class="' + (t.pnl >= 0 ? "up" : "down") + '">' + (t.pnl >= 0 ? "+" : "") + money(t.pnl, "c") + " today</small></div>" +
        '<svg class="ws-spark' + (shown > 0 ? " in" : "") + '" viewBox="0 0 300 74" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '"/><polygon points="0,74 ' + pts + ' 300,74"/></svg>' +
        '<div class="ws-split">' + rows([["Equities", t.eq], ["Crypto", t.cr], ["Hard & private", t.hd], ["Cash", t.cash]], function (x) { return "<span>" + x[0] + "</span><b>" + money(x[1]) + "</b>"; }, shown) + "</div>";
    } else if (s.id === "stocks" || s.id === "crypto") {
      var list = s.id === "stocks" ? stocks : crypto;
      var tot = s.id === "stocks" ? t.eq : t.cr;
      html = '<div class="ws-sum"><span>' + (s.id === "stocks" ? "Equities" : "Digital assets") + "</span><b>" + money(tot) + "</b></div>" +
        '<div class="ws-table">' + rows(list, function (x) {
          return '<span class="sym">' + x.s + "<small>" + x.n + "</small></span><span class='px'>" + money(x.p, "c") + '</span><span class="' + (up(x) ? "up" : "down") + '">' + pct(x) + "</span><span class='val'>" + money(x.p * x.q) + "</span>";
        }, shown) + "</div>";
      if (s.id === "crypto") {
        var vault = Math.min(100, 70 + holdTicks * 5);
        html += '<div class="ws-sync"><span>Exchange account ✔ synced</span><span>Cold vault ' + (vault >= 100 ? "✔ synced" : "⟳ " + vault + "%") + '</span><i style="--w:' + vault + '%"></i></div>';
      }
    } else if (s.id === "strategic") {
      html = '<div class="ws-sum"><span>FY27 strategic portfolio</span><b>4 initiatives · 1 at risk</b></div>' +
        rows(initiatives, function (x) {
          return '<span class="rag ' + x.rag + '"></span><span class="nm">' + x.n + "<small>" + x.st + '</small></span><span class="bars"><i class="spend" style="--w:' + x.spend + '%"></i><i class="value" style="--w:' + x.value + '%"></i></span>';
        }, shown) + '<p class="ws-legend"><i class="spend"></i>Budget used <i class="value"></i>Value delivered</p>';
    } else if (s.id === "alloc") {
      var w = { Equities: t.eq, "Hard & private": t.hd, Crypto: t.cr, Cash: t.cash };
      html = '<div class="ws-sum"><span>Allocation vs target</span><b>Rebalance preview ready</b></div>' +
        rows(Object.keys(w), function (k2) {
          var a = w[k2] / t.nw * 100, d = a - targets[k2];
          return '<span class="nm">' + k2 + "<small>" + a.toFixed(1) + "% · target " + targets[k2] + "%" + (Math.abs(d) > 0.5 ? " · " + (d > 0 ? "+" : "") + d.toFixed(1) + " pts ⚠" : "") +
            '</small></span><span class="alloc"><i style="--w:' + a.toFixed(1) + '%"></i><em style="left:' + targets[k2] + '%"></em></span>';
        }, shown);
    } else if (s.id === "assets") {
      html = '<div class="ws-sum"><span>Hard assets & private holdings</span><b>' + money(t.hd) + "</b></div>" +
        rows(hard, function (x) { return '<span class="nm">' + x.n + "<small>" + x.d + "</small></span><b>" + money(x.v) + '</b><span class="tag">' + x.tag + "</span>"; }, shown);
    } else if (s.id === "today") {
      html = '<div class="ws-cols"><div><h5>' + (realMeetings ? "Today · your calendar" : "Today") + "</h5>" +
        (meetings.length ? rows(meetings, function (x) { return "<span class='tm'>" + (x.allDay ? "All day" : hm(x.t)) + "</span><span class='nm'>" + esc(x.n) + "<small>" + esc(x.tag) + "</small></span>"; }, shown, "m")
          : '<div class="ws-row in"><span class="tm">—</span><span class="nm">No meetings today<small>Type "schedule…" to book one</small></span></div>') +
        "</div><div><h5>Statements</h5>" +
        rows(statements, function (x) {
          var st = x.p >= 100 ? (x.warn ? "⚠ " + x.warn : "✔ Reconciled") : "⟳ " + Math.round(x.p) + "%";
          return "<span class='nm'>" + x.n + "<small class='" + (x.p >= 100 && !x.warn ? "up" : x.warn && x.p >= 100 ? "warn" : "") + "'>" + st + "</small></span>";
        }, shown, "s") + "</div></div>";
    } else if (s.id === "activity") {
      var mx = Math.max.apply(null, events);
      html = '<div class="ws-sum"><span>Agent events per hour · last 12h</span><b>' + sum(events, function (x) { return x; }) + " events</b></div>" +
        '<div class="ws-chart">' + events.map(function (v, i) { return '<i style="--h:' + (v / mx * 100).toFixed(0) + '%"' + (i === events.length - 1 ? ' class="now"' : "") + "></i>"; }).join("") + "</div>" +
        '<div class="ws-feed">' + feed.slice(0, 5).map(function (f, i) { return '<div class="ws-row in' + (i === 0 ? " fresh" : "") + (plain ? '"' : ' bv-tap" role="button" tabindex="0" data-r="' + i + '"') + '><span class="tm">' + (f[2] || "") + "</span><span class='ic'>" + f[0] + "</span><span class='nm'>" + f[1] + "</span></div>"; }).join("") + "</div>";
    }
    plain = false;
    return html;
  }

  // One-line agent status: the step being worked on, or the routing trail once built.
  function tasksHtml(k) {
    var t = SLIDES[cur].tasks;
    if (phase !== "build") return trail();
    var x = t[Math.min(k, t.length - 1)];
    return x[0] + " \u00b7 " + x[1];
  }
  function trail() {
    var seen = {}, out = [];
    SLIDES[cur].tasks.forEach(function (x) { if (x[0] !== "RAMBO" && !seen[x[0]]) { seen[x[0]] = 1; out.push(x[0]); } });
    return out.length ? out.join(" · ") : "RAMBO";
  }

  function go(i) {
    cur = i; phase = still ? "live" : "build"; stepN = 0; holdTicks = 0; t0 = Date.now();
    var s = SLIDES[cur];
    $("ws-tabs").querySelectorAll("button").forEach(function (b, j) { b.setAttribute("aria-selected", String(j === cur)); b.tabIndex = j === cur ? 0 : -1; });
    var tb = $("ws-tabs").children[cur], strip = $("ws-tabs");
    if (tb && root.offsetParent) strip.scrollTo({ left: tb.offsetLeft - (strip.clientWidth - tb.offsetWidth) / 2, behavior: still ? "auto" : "smooth" });
    $("ws-cover-k").textContent = s.doc;
    $("ws-cover-h").textContent = s.h;
    $("ws-job").textContent = (phase === "build" ? "Building your " : "Your ") + s.t.toLowerCase();
    var sl = $("ws-slide"); sl.classList.remove("enter"); void sl.offsetWidth; sl.classList.add("enter");
    root.classList.toggle("working", phase === "build");
    root.classList.toggle("built", phase !== "build");
    root.classList.toggle("alert", s.id === "alloc" || s.id === "crypto");
    $("ws-sub").textContent = tasksHtml(0);
    render(0); kpis();
  }

  function finishBuild() {
    phase = "live"; stepN = SLIDES[cur].tasks.length;
    root.classList.remove("working"); root.classList.add("built");
    $("ws-job").textContent = "Your " + SLIDES[cur].t.toLowerCase();
    $("ws-clock").textContent = "LIVE";
    $("ws-sub").textContent = tasksHtml(stepN);
    render(99); kpis();
  }
  function tick() {
    if (paused || hidden || viewing) return;
    n++;
    $("ws-clock").textContent = phase === "build" ? ((Date.now() - t0) / 1000).toFixed(1) + "s" : "LIVE";
    var second = n % 4 === 0;
    if (second) {
      // markets always move
      stocks.concat(crypto).forEach(step);
      history.push(totals().nw); if (history.length > 31) history.shift();
      statements.forEach(function (x) { if (x.p < 100) x.p = Math.min(100, x.p + 4 + Math.random() * 6); });
      if (Math.random() < 0.35) {
        var f = FEED_POOL[Math.floor(Math.random() * FEED_POOL.length)];
        feed.unshift([f[0], f[1], hm(new Date())]); feed.length = Math.min(feed.length, 8);
        events[events.length - 1]++;
      }
    }
    if (phase === "build") {
      if (n % STEP_TICKS) return;
      stepN++;
      if (stepN >= SLIDES[cur].tasks.length) { finishBuild(); return; }
      $("ws-sub").textContent = tasksHtml(stepN);
      render(stepN * 2); kpis();
      return;
    }
    if (!userPaused && ++holdTicks >= HOLD_TICKS) { go((cur + 1) % SLIDES.length); return; }
    if (second) { render(99); kpis(); }
  }

  go(0);
  setInterval(tick, TICK);

  // The console pauses the workspace while a brief is open and resumes it on "New brief".
  window.BLACK_WORKSPACE = {
    pause: function () { paused = true; },
    resume: function () { paused = false; go(cur); },
    // Real meetings from the BLACK calendar: [{ start, title, tag, allDay }]
    // An uploaded bank statement replaces the test statements, and its closing balance becomes Liquid cash.
    setStatement: function (st) {
      if (!realStatements) statements = [];
      realStatements = true;
      statements.unshift({ n: st.label, p: 100, warn: null, real: true });
      statements.length = Math.min(statements.length, 4);
      if (typeof st.closing === "number") { CASH = st.closing; realCash = true; }
      var note = root.querySelector(".ws-upload span:nth-child(2)");
      if (note) note.innerHTML = "<b>Using your statement</b> for Liquid cash and Statements. Other figures are still test data; upload holdings or more statements with the \ud83d\udcce paperclip.";
      kpis(); if (SLIDES[cur].id === "today" || SLIDES[cur].id === "overview") render(99);
    },
    setMeetings: function (list) {
      meetings = (list || []).slice(0, 5).map(function (m) { return { t: new Date(m.start), n: m.title, tag: m.tag || "", allDay: !!m.allDay }; });
      realMeetings = true;
      if (SLIDES[cur].id === "today") render(99);
    }
  };
})();
