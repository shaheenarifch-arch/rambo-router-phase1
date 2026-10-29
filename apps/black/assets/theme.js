/* BLACK theme switch: Dark · Light · Auto (match the device).
 * The choice is remembered on this device and, when signed in, with the GetServices account.
 * The first paint is set by the inline script in <head> so the page never flashes the wrong theme.
 * Exposes window.BLACK_THEME = { get, set, fromAccount }.
 */
(function () {
  "use strict";
  var KEY = "black.theme", MODES = ["dark", "light", "auto"];
  var LABEL = { dark: "Dark", light: "Light", auto: "Auto" };
  var ICON = {
    dark: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    light: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    auto: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>'
  };
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function get() { try { var m = localStorage.getItem(KEY); return MODES.indexOf(m) > -1 ? m : "dark"; } catch (e) { return "dark"; } }
  function resolved(m) { return m === "auto" ? (media && media.matches ? "light" : "dark") : m; }
  function apply(m) {
    var t = resolved(m);
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#faf8f3" : "#050505");
    var b = document.getElementById("theme-btn");
    if (b) {
      var next = MODES[(MODES.indexOf(m) + 1) % MODES.length];
      b.innerHTML = ICON[m] + '<span class="lbl">' + LABEL[m] + "</span>";
      b.setAttribute("aria-label", "Theme: " + LABEL[m] + (m === "auto" ? " (matches your device)" : "") + ". Switch to " + LABEL[next]);
      b.title = "Theme: " + LABEL[m] + (m === "auto" ? " · matches your device" : "") + "\nClick for " + LABEL[next] + (next === "auto" ? " (match your device)" : "");
    }
  }
  function set(m, sync) {
    if (MODES.indexOf(m) < 0) return;
    try { localStorage.setItem(KEY, m); } catch (e) {}
    apply(m);
    if (sync !== false && window.BLACK_CAL && window.BLACK_CAL.saveProfile) window.BLACK_CAL.saveProfile({ theme: m });
  }

  var right = document.querySelector(".topbar .right");
  if (right) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "theme-btn"; b.id = "theme-btn";
    right.insertBefore(b, right.firstChild);
    b.addEventListener("click", function () { var m = get(); set(MODES[(MODES.indexOf(m) + 1) % MODES.length]); });
  }
  apply(get());
  if (media) {
    var onChange = function () { if (get() === "auto") apply("auto"); };
    media.addEventListener ? media.addEventListener("change", onChange) : media.addListener(onChange);
  }

  window.BLACK_THEME = {
    get: get,
    set: set,
    // Signing in on a new device brings the saved theme with it.
    fromAccount: function (m) { if (MODES.indexOf(m) > -1 && m !== get()) set(m, false); }
  };
})();
