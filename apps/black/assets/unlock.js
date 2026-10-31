/*
 * BLACK unlock flow = sign in.
 * BLACK is open to everyone with a GetServices account (Google or email, the same login as ATLAS).
 * New accounts get 50 free credits; then they choose a plan. The server checks the account and
 * credits on every brief (functions/v1/_account.js), so this page only handles signing in.
 */
(function () {
  var KEY = "black.session", USER_KEY = "black.user";

  function signedIn() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  var backdrop = document.getElementById("unlock-modal");
  if (!backdrop) return;
  var lastFocus = null;
  var $ = function (id) { return document.getElementById(id); };

  // Google sign-in link from ATLAS (falls back to the link already in the page).
  var loaded = false;
  function loadProviders() {
    if (loaded) return; loaded = true;
    fetch("/v1/me/providers").then(function (r) { return r.json(); }).then(function (j) {
      var g = (j.providers || []).filter(function (p) { return p.id === "google"; })[0];
      if (g && g.url && $("ul-google")) $("ul-google").href = g.url;
    }).catch(function () {});
  }

  function open() {
    lastFocus = document.activeElement;
    loadProviders();
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    var cta = $("ul-google");
    if (cta) cta.focus();
  }
  function close() {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    if (lastFocus) lastFocus.focus();
  }

  // Email + password, checked by ATLAS through BLACK's gateway (BLACK never stores passwords).
  var form = $("ul-form");
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("ul-submit"), err = $("ul-error");
    btn.disabled = true; btn.textContent = "Signing in…"; err.textContent = "";
    fetch("/v1/me/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: $("ul-email").value, password: $("ul-password").value }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || !x.j.token) throw new Error(x.j.detail || "That email and password didn't match.");
        try { localStorage.setItem(KEY, x.j.token); localStorage.setItem(USER_KEY, JSON.stringify(x.j.user || {})); } catch (e2) {}
        window.location.href = "app.html";
      })
      .catch(function (e3) { err.textContent = e3.message; btn.disabled = false; btn.textContent = "Sign in with email"; });
  });

  document.querySelectorAll("[data-unlock]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (signedIn()) { window.location.href = "app.html"; return; }
      open();
    });
  });
  backdrop.querySelectorAll("[data-close]").forEach(function (el) { el.addEventListener("click", close); });
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && backdrop.classList.contains("open")) close(); });

  // Arriving from the Studio "Black Edition" button or the console's sign-in gate (…/?unlock=1 or #unlock).
  var params = new URLSearchParams(window.location.search);
  if (params.get("unlock") === "1" || window.location.hash === "#unlock") {
    if (signedIn()) window.location.replace("app.html"); else open();
  }
})();
