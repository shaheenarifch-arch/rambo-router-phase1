/*
 * BLACK unlock flow.
 * Plan buttons (Starter / Pro) open the console with ?subscribe=<plan>: it signs the visitor in
 * with their GetServices account, then opens Stripe Checkout with a 7-day free trial. The gateway
 * checks the plan on every brief, so this browser flag only skips the window for returning members.
 */
(function () {
  var KEY = "black.access";

  function hasAccess() {
    try { return localStorage.getItem(KEY) === "preview"; } catch (e) { return false; }
  }
  function grantAccess() {
    try { localStorage.setItem(KEY, "preview"); } catch (e) { /* storage blocked: still let them in this visit */ }
  }

  var backdrop = document.getElementById("unlock-modal");
  if (!backdrop) return;
  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    var cta = backdrop.querySelector("[data-plan], [data-enter]");
    if (cta) cta.focus();
  }
  function close() {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    if (lastFocus) lastFocus.focus();
  }
  function enter() {
    grantAccess();
    window.location.href = "app.html";
  }

  document.querySelectorAll("[data-unlock]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (hasAccess()) { window.location.href = "app.html"; return; }
      open();
    });
  });
  backdrop.querySelector("[data-enter]").addEventListener("click", enter);
  backdrop.querySelectorAll("[data-plan]").forEach(function (b) {
    b.addEventListener("click", function () { window.location.href = "app.html?subscribe=" + encodeURIComponent(b.getAttribute("data-plan")); });
  });
  backdrop.querySelectorAll("[data-close]").forEach(function (el) { el.addEventListener("click", close); });
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && backdrop.classList.contains("open")) close(); });

  // Arriving from the Studio "Black Edition" button (…/?unlock=1 or #unlock) opens the modal straight away.
  var params = new URLSearchParams(window.location.search);
  if (params.get("unlock") === "1" || window.location.hash === "#unlock") {
    if (hasAccess()) window.location.replace("app.html"); else open();
  }
})();
