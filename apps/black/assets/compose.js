/* BLACK composer tools: Web search switch, "Choose engines" (Executive mode) and Shortcuts ("/" in the brief box).
 * Exposes window.BLACK_COMPOSE = { web(), engines(), onMode(mode), menuOpen() }.
 * - Web: Auto (RAMBO decides) -> On (always search the live web) -> Off (answer from the engines' own knowledge).
 * - Engines: Auto (RAMBO picks) or the user's own 2-3 engines; Executive mode runs them side by side.
 * - Shortcuts: built-in snippets plus the user's own, saved to their GetServices account (/v1/me/shortcuts).
 */
(function () {
  "use strict";
  var CFG = window.BLACK_CONFIG || {};
  var API = (CFG.apiBase || "").replace(/\/+$/, "");
  var $ = function (id) { return document.getElementById(id); };
  var prompt = $("prompt"), box = document.querySelector(".composer .box");
  var webBtn = $("web-toggle"), engBtn = $("engine-pick"), scBtn = $("sc-btn"), engPop = $("engine-pop"), scPop = $("sc-pop");
  if (!prompt || !box || !webBtn || !engBtn || !scBtn || !engPop || !scPop) return;

  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function token() { return get("black.session", ""); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- Web search switch ----------
  var WEB = {
    auto: { label: "Web: Auto", tip: "Web search: Auto. RAMBO searches the live web when your brief needs current facts. Click to change." },
    on: { label: "Web: On", tip: "Web search: On. Every brief is answered with live web results and source links. Click to change." },
    off: { label: "Web: Off", tip: "Web search: Off. Answers come from the engines' own knowledge, without the live web (Perplexity is left out). Click to change." }
  };
  var web = WEB[get("black.web", "auto")] ? get("black.web", "auto") : "auto";
  function paintWeb() {
    webBtn.querySelector("span").textContent = WEB[web].label;
    webBtn.title = WEB[web].tip; webBtn.setAttribute("aria-label", WEB[web].tip);
    webBtn.classList.toggle("on", web !== "auto");
  }
  webBtn.addEventListener("click", function () {
    web = web === "auto" ? "on" : web === "on" ? "off" : "auto";
    put("black.web", web); paintWeb();
  });
  paintWeb();

  // ---------- Choose engines (Executive) ----------
  var ALL = [];         // [{ id, label }] engines the gateway has keys for
  var chosen = [];      // [] = Auto
  try { chosen = JSON.parse(get("black.engines", "[]")) || []; } catch (e) { chosen = []; }
  var mode = "smart";
  fetch(API + "/v1/responses", { headers: { accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
    var ids = j.ids || [], labels = j.engines || [];
    ALL = ids.map(function (id, i) { return { id: id, label: labels[i] || id }; });
    chosen = chosen.filter(function (id) { return ids.indexOf(id) > -1; });
    if (chosen.length < 2) chosen = [];
    paintEng();
  }).catch(function () {});
  function label(id) { var e = ALL.filter(function (x) { return x.id === id; })[0]; return e ? e.label : id; }
  function paintEng() {
    engBtn.hidden = mode !== "executive";
    engBtn.querySelector("span").textContent = chosen.length ? chosen.map(label).join(" · ") : "Engines: Auto";
    engBtn.title = chosen.length ? "Executive runs " + chosen.map(label).join(", ") + " side by side. Click to change." : "RAMBO picks the best engines for each brief. Click to choose your own 2 or 3.";
  }
  function openEng() {
    closeSc();
    var auto = !chosen.length;
    engPop.innerHTML =
      '<p class="pop-h">Choose engines <span>Executive mode</span></p>' +
      '<label class="pick"><input type="radio" name="eng-mode" value="auto"' + (auto ? " checked" : "") + '> <span><b>Auto</b> · RAMBO picks the best engines for each brief (recommended)</span></label>' +
      '<label class="pick"><input type="radio" name="eng-mode" value="mine"' + (auto ? "" : " checked") + '> <span><b>My engines</b> · pick 2 or 3 to answer side by side</span></label>' +
      '<div class="eng-list">' + (ALL.length ? ALL.map(function (e) {
        return '<label class="chk"><input type="checkbox" value="' + esc(e.id) + '"' + (chosen.indexOf(e.id) > -1 ? " checked" : "") + "> " + esc(e.label) + "</label>";
      }).join("") : '<span class="pop-help">No engines are live yet. Sign in to load them.</span>') + "</div>" +
      '<p class="pop-msg" aria-live="polite"></p>' +
      '<p class="pop-help">Each engine answers on its own, then Claude writes one synthesis and flags disagreements. Uses 3 credits like any Executive brief. ' +
      'Perplexity always searches the web; Grok and Perplexity are skipped for image briefs. <a href="/engines/" target="_blank" rel="noopener">About the engines</a></p>' +
      '<div class="pop-row"><button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><button type="button" class="btn btn-gold btn-sm" data-save>Save</button></div>';
    var list = engPop.querySelector(".eng-list"), msg = engPop.querySelector(".pop-msg");
    function sync() {
      var mine = engPop.querySelector('input[value="mine"]').checked;
      list.classList.toggle("off", !mine);
      var boxes = list.querySelectorAll("input"), n = list.querySelectorAll("input:checked").length;
      boxes.forEach(function (b) { b.disabled = !mine || (!b.checked && n >= 3); });
      msg.textContent = mine && n < 2 ? "Pick at least 2 engines (up to 3)." : "";
    }
    engPop.addEventListener("change", sync);
    sync();
    engPop.querySelector("[data-x]").onclick = closeEng;
    engPop.querySelector("[data-save]").onclick = function () {
      var mine = engPop.querySelector('input[value="mine"]').checked;
      var picked = Array.prototype.map.call(list.querySelectorAll("input:checked"), function (b) { return b.value; });
      if (mine && picked.length < 2) { msg.textContent = "Pick at least 2 engines (up to 3), or choose Auto."; return; }
      chosen = mine ? picked.slice(0, 3) : [];
      put("black.engines", JSON.stringify(chosen)); paintEng(); closeEng(); prompt.focus();
    };
    engPop.hidden = false; engBtn.setAttribute("aria-expanded", "true");
  }
  function closeEng() { engPop.hidden = true; engBtn.setAttribute("aria-expanded", "false"); }
  engBtn.addEventListener("click", function () { engPop.hidden ? openEng() : closeEng(); });

  // ---------- Shortcuts ----------
  var BUILT_IN = [
    { id: "b1", name: "Keep it brief", text: "Keep it brief: at most 3 bullet points.", builtIn: true },
    { id: "b2", name: "Cite sources", text: "Cite sources with links for every key fact.", builtIn: true },
    { id: "b3", name: "Board tone", text: "Write it for a board of directors: formal, concise and decision-focused.", builtIn: true },
    { id: "b4", name: "Add a chart", text: "Include one chart of the key numbers.", builtIn: true },
    { id: "b5", name: "Action items", text: "End with a short list of action items with owners and dates.", builtIn: true }
  ];
  var mine = [];
  try { mine = JSON.parse(get("black.shortcuts", "[]")) || []; } catch (e) { mine = []; }
  function api(method, path, body) {
    return fetch(API + "/v1/me/shortcuts" + (path || ""), {
      method: method, headers: { "content-type": "application/json", authorization: "Bearer " + token() }, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.detail || j.error || "HTTP " + r.status); return j; }); });
  }
  function loadMine() {
    if (!token()) return;
    api("GET").then(function (j) { mine = j.shortcuts || []; put("black.shortcuts", JSON.stringify(mine)); if (!scPop.hidden) paintSc(); }).catch(function () {});
  }
  loadMine();
  function all() { return mine.concat(BUILT_IN); }

  // Menu state: "slash" (typed "/query" in the box) or "browse" (opened from the button).
  var sc = { open: false, how: "browse", start: -1, q: "", items: [], at: 0, form: false };
  function matches(q) {
    q = q.toLowerCase();
    return all().filter(function (s) { return !q || s.name.toLowerCase().indexOf(q) > -1 || s.text.toLowerCase().indexOf(q) > -1; });
  }
  function openSc(how, start, q) {
    closeEng();
    sc.open = true; sc.how = how; sc.start = start; sc.q = q || ""; sc.at = 0; sc.form = false;
    paintSc(); scPop.hidden = false; scBtn.setAttribute("aria-expanded", "true");
  }
  function closeSc() { sc.open = false; sc.form = false; scPop.hidden = true; scBtn.setAttribute("aria-expanded", "false"); }
  function paintSc() {
    if (sc.form) return paintForm();
    sc.items = matches(sc.q);
    if (sc.at >= sc.items.length) sc.at = 0;
    scPop.innerHTML = '<p class="pop-h">Shortcuts <span>' + (sc.how === "slash" ? "↑↓ to move · Enter to insert · Esc to close" : "click one to add it to your brief") + "</span></p>" +
      '<ul class="sc-list" role="listbox" aria-label="Shortcuts">' + (sc.items.length ? sc.items.map(function (s, i) {
        return '<li role="option" data-i="' + i + '" aria-selected="' + (i === sc.at) + '"' + (i === sc.at ? ' class="on"' : "") + '><b>/' + esc(s.name) + "</b><small>" + esc(s.text) + "</small>" +
          (s.builtIn ? '<em>Built-in</em>' : '<button type="button" class="sc-del" data-del="' + esc(s.id) + '" aria-label="Delete shortcut ' + esc(s.name) + '" title="Delete this shortcut">✕</button>') + "</li>";
      }).join("") : '<li class="empty">No shortcut matches “' + esc(sc.q) + "”.</li>") + "</ul>" +
      '<div class="pop-row"><button type="button" class="btn btn-ghost btn-sm" data-new>+ New shortcut</button></div>' +
      '<p class="pop-help">Type <b>/</b> in the brief box to use a shortcut. Yours are saved to your GetServices account, so they are on every device.</p>';
  }
  function paintForm() {
    scPop.innerHTML = '<p class="pop-h">New shortcut</p>' +
      (token() ? '<label class="fld">Name <input type="text" id="sc-name" maxlength="40" placeholder="e.g. Investor tone"></label>' +
        '<label class="fld">Text it adds to your brief <textarea id="sc-text" rows="3" maxlength="1000" placeholder="e.g. Write it for investors: numbers first, upside and risks."></textarea></label>' +
        '<p class="pop-msg" aria-live="polite"></p>' +
        '<div class="pop-row"><button type="button" class="btn btn-ghost btn-sm" data-back>Back</button><button type="button" class="btn btn-gold btn-sm" data-add>Save shortcut</button></div>' +
        '<p class="pop-help">Use it later by typing <b>/</b> and its name. Up to 40 shortcuts.</p>'
        : '<p class="pop-help">Sign in with your GetServices account to save your own shortcuts.</p><div class="pop-row"><button type="button" class="btn btn-ghost btn-sm" data-back>Back</button></div>');
    var n = $("sc-name"); if (n) n.focus();
  }
  function insert(s) {
    var v = prompt.value, pos = prompt.selectionStart == null ? v.length : prompt.selectionStart;
    if (sc.how === "slash" && sc.start > -1) {
      var end = sc.start + 1 + sc.q.length;
      var before = v.slice(0, sc.start), after = v.slice(end);
      prompt.value = before + s.text + (after.charAt(0) === " " ? "" : " ") + after;
      pos = (before + s.text + " ").length;
    } else {
      var pre = v.slice(0, pos), post = v.slice(pos);
      var lead = pre && !/\s$/.test(pre) ? " " : "";
      prompt.value = pre + lead + s.text + " " + post;
      pos = (pre + lead + s.text + " ").length;
    }
    closeSc(); prompt.focus();
    try { prompt.setSelectionRange(pos, pos); } catch (e) {}
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  }
  scPop.addEventListener("mousedown", function (e) { if (e.target.closest("li[data-i]")) e.preventDefault(); }); // keep the caret in the box
  scPop.addEventListener("click", function (e) {
    var del = e.target.closest("[data-del]");
    if (del) {
      e.stopPropagation();
      var id = del.getAttribute("data-del");
      mine = mine.filter(function (s) { return s.id !== id; }); put("black.shortcuts", JSON.stringify(mine)); paintSc();
      api("DELETE", "/" + encodeURIComponent(id)).catch(function () { loadMine(); });
      return;
    }
    var li = e.target.closest("li[data-i]");
    if (li) return insert(sc.items[+li.getAttribute("data-i")]);
    if (e.target.closest("[data-new]")) { sc.form = true; return paintSc(); }
    if (e.target.closest("[data-back]")) { sc.form = false; return paintSc(); }
    if (e.target.closest("[data-add]")) {
      var name = $("sc-name").value.trim(), text = $("sc-text").value.trim(), msg = scPop.querySelector(".pop-msg");
      if (!name || !text) { msg.textContent = "Add a name and the text it should add."; return; }
      msg.textContent = "Saving…";
      api("POST", "", { name: name, text: text }).then(function (j) {
        mine.push(j.shortcut); put("black.shortcuts", JSON.stringify(mine));
        sc.form = false; sc.q = ""; paintSc();
      }).catch(function (err) { msg.textContent = "Couldn't save: " + err.message; });
    }
  });
  scBtn.addEventListener("click", function () { sc.open && sc.how === "browse" ? closeSc() : openSc("browse", -1, ""); });

  // "/" at the start of the box or after a space opens the menu; the text after it filters.
  prompt.addEventListener("input", function () {
    var v = prompt.value, pos = prompt.selectionStart;
    var m = /(^|\s)\/([^\s/]{0,30})$/.exec(v.slice(0, pos));
    if (m) { var start = pos - m[2].length - 1; if (!sc.open || sc.how !== "slash" || sc.start !== start || sc.q !== m[2]) { if (sc.open && sc.how === "slash" && sc.start === start) { sc.q = m[2]; sc.at = 0; paintSc(); } else openSc("slash", start, m[2]); } }
    else if (sc.open && sc.how === "slash") closeSc();
  });
  // Registered before app.js, so Enter picks a shortcut instead of sending while the menu is open.
  prompt.addEventListener("keydown", function (e) {
    if (!sc.open || sc.form) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeSc(); return; }
    if (sc.how !== "slash" || !sc.items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); e.stopImmediatePropagation();
      sc.at = (sc.at + (e.key === "ArrowDown" ? 1 : sc.items.length - 1)) % sc.items.length; paintSc();
      var on = scPop.querySelector("li.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    } else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault(); e.stopImmediatePropagation(); insert(sc.items[sc.at]);
    }
  });
  // Outside clicks close the menus. composedPath() still holds the menu when a click re-drew its contents.
  document.addEventListener("click", function (e) {
    var path = e.composedPath ? e.composedPath() : [];
    var inside = function (els) { return els.some(function (x) { return path.indexOf(x) > -1; }); };
    if (!engPop.hidden && !inside([engPop, engBtn])) closeEng();
    if (sc.open && !inside([scPop, scBtn, prompt])) closeSc();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeEng(); if (sc.open) closeSc(); } });

  window.BLACK_COMPOSE = {
    web: function () { return web; },
    engines: function () { return mode === "executive" && chosen.length >= 2 ? chosen.slice() : null; },
    engineLabels: function () { return chosen.map(label); },
    onMode: function (m) { mode = m; paintEng(); if (m !== "executive") closeEng(); },
    menuOpen: function () { return sc.open; }
  };
})();
