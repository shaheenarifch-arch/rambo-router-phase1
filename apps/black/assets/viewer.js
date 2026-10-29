/* BLACK card viewer: opens any card in a bigger view with Back / Next / Close.
 * window.BLACK_VIEW.open(items, index, { onClose }) where each item is
 *   { kicker, title, html, help, action: { label, hint, run }, link: { label, url } }
 * Keyboard: ← → to move, Esc to close. Touch: swipe left / right.
 */
(function () {
  "use strict";
  var root = document.createElement("div");
  root.className = "bv";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "bv-title");
  root.innerHTML =
    '<div class="bv-scrim" data-close></div>' +
    '<div class="bv-card">' +
      '<div class="bv-head"><span class="bv-kicker" id="bv-kicker"></span><span class="bv-count" id="bv-count"></span>' +
        '<button type="button" class="bv-x" data-close aria-label="Close">✕</button></div>' +
      '<h2 class="bv-title gold-text" id="bv-title"></h2>' +
      '<div class="bv-body" id="bv-body"></div>' +
      '<details class="bv-help" id="bv-help-wrap"><summary>What this means</summary><div id="bv-help"></div></details>' +
      '<div class="bv-foot">' +
        '<button type="button" class="btn btn-ghost btn-sm" id="bv-prev">← Back</button>' +
        '<a class="btn btn-ghost btn-sm bv-link" id="bv-link" target="_blank" rel="noopener" hidden></a>' +
        '<button type="button" class="btn btn-gold btn-sm" id="bv-act" hidden></button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="bv-next">Next →</button>' +
      "</div>" +
      '<p class="bv-keys">← → to move · Esc to close · swipe on phone</p>' +
    "</div>";
  document.body.appendChild(root);

  var $ = function (id) { return document.getElementById(id); };
  var items = [], at = 0, opts = {}, lastFocus = null, x0 = null;

  function show() {
    var it = items[at] || {};
    $("bv-kicker").textContent = it.kicker || "";
    $("bv-count").textContent = items.length > 1 ? (at + 1) + " / " + items.length : "";
    $("bv-title").textContent = it.title || "";
    $("bv-body").innerHTML = it.html || "";
    $("bv-help-wrap").hidden = !it.help;
    $("bv-help").innerHTML = it.help || "";
    $("bv-prev").disabled = at === 0;
    $("bv-next").disabled = at >= items.length - 1;
    $("bv-prev").hidden = $("bv-next").hidden = items.length < 2;
    var act = $("bv-act");
    act.hidden = !it.action;
    if (it.action) { act.textContent = it.action.label; act.title = it.action.hint || ""; }
    var ln = $("bv-link");
    ln.hidden = !it.link;
    if (it.link) { ln.textContent = it.link.label; ln.href = it.link.url; ln.title = "Opens in a new tab"; }
  }
  function open(list, index, o) {
    if (!list || !list.length) return;
    items = list; at = Math.max(0, Math.min(index || 0, list.length - 1)); opts = o || {};
    lastFocus = document.activeElement;
    show();
    root.hidden = false;
    document.documentElement.classList.add("bv-open");
    requestAnimationFrame(function () { root.classList.add("on"); $("bv-next").hidden ? root.querySelector(".bv-x").focus() : $("bv-next").focus(); });
  }
  function close() {
    if (root.hidden) return;
    root.classList.remove("on"); root.hidden = true;
    document.documentElement.classList.remove("bv-open");
    if (opts.onClose) opts.onClose();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function go(d) { var n = at + d; if (n < 0 || n >= items.length) return; at = n; show(); }

  root.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) close(); });
  $("bv-prev").addEventListener("click", function () { go(-1); });
  $("bv-next").addEventListener("click", function () { go(1); });
  $("bv-act").addEventListener("click", function () { var it = items[at]; close(); if (it && it.action) it.action.run(); });
  document.addEventListener("keydown", function (e) {
    if (root.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "Tab") { // keep focus inside the viewer
      var f = Array.prototype.filter.call(root.querySelectorAll("button,summary,a[href]"), function (b) { return !b.disabled && !b.hidden && b.offsetParent; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  root.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  root.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });

  // Makes an element open on click or Enter / Space.
  function clickable(el, label) {
    el.setAttribute("role", "button"); el.setAttribute("tabindex", "0");
    if (label) el.setAttribute("aria-label", label);
    el.classList.add("bv-tap");
  }
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("bv-tap")) { e.preventDefault(); e.target.click(); }
  });

  window.BLACK_VIEW = { open: open, close: close, clickable: clickable, isOpen: function () { return !root.hidden; } };
})();
