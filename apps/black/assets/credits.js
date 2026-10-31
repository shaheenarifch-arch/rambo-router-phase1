/* BLACK credits (console side).
 * - Shows the credits chip in the top bar ("38 credits" / "Tester · Unlimited").
 * - Credits modal: balance, what a credit costs, and plans (Starter / Pro / Enterprise).
 * - Out of credits: the brief box is locked and the plans open instead of sending.
 * - Signed out (or the session expired): back to the sign-in screen.
 * Exposes window.BLACK_CREDITS.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var COSTS = { fast: 1, smart: 1, deep: 2, executive: 3 };
  var state = null; // { unlimited, balance, granted, used, costs }
  var chip = $("credits-btn"), modal = $("credits-modal");

  function token() { try { return localStorage.getItem("black.session") || ""; } catch (e) { return ""; } }
  function toSignIn() { location.replace("index.html?unlock=1"); }

  function api(path, opts) {
    opts = opts || {};
    return fetch("/v1/me" + path, {
      method: opts.method || "GET",
      headers: { "content-type": "application/json", authorization: "Bearer " + token() },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { signOutAndLeave(); throw new Error("Please sign in again."); }
        if (!r.ok) throw new Error(j.detail || "Something went wrong (" + r.status + ").");
        return j;
      });
    });
  }
  function signOutAndLeave() {
    try { localStorage.removeItem("black.session"); localStorage.removeItem("black.user"); } catch (e) {}
    toSignIn();
  }

  function out() { return !!state && !state.unlimited && state.balance <= 0; }
  function canSend(mode) { return !state || state.unlimited || state.balance >= (COSTS[mode] || 1); }

  function render() {
    if (!chip || !state) return;
    chip.hidden = false;
    chip.classList.toggle("out", out());
    chip.classList.toggle("low", !state.unlimited && state.balance > 0 && state.balance <= 10);
    chip.textContent = state.unlimited ? "Tester · Unlimited" : out() ? "Out of credits · Choose plan" : state.balance + " credit" + (state.balance === 1 ? "" : "s");
    chip.title = state.unlimited ? "Tester account: unlimited credits." : "Credits left for live briefs. Tap for details and plans.";
    var p = $("prompt");
    if (p) {
      p.placeholder = out() ? "You're out of credits. Choose a plan to keep briefing BLACK." : (p.dataset.ph || p.placeholder);
      p.readOnly = out();
    }
    if ($("cr-balance")) {
      $("cr-balance").textContent = state.unlimited ? "∞" : String(state.balance);
      $("cr-label").textContent = state.unlimited ? "Tester · unlimited credits" : "credit" + (state.balance === 1 ? "" : "s") + " left";
      $("cr-note").textContent = state.unlimited
        ? "This is a tester account, so briefs are never charged."
        : out() ? "You've used all your credits. Choose a plan below to keep going."
          : "Every new account starts with " + (state.granted || 50) + " free credits. You've used " + (state.used || 0) + ".";
    }
  }
  function set(c) { if (c && typeof c === "object") { state = Object.assign({}, state || {}, c); render(); } }
  function refresh() { return api("/credits").then(function (j) { set(j); return j; }).catch(function () { return null; }); }

  function open(reason) {
    if (!modal) return;
    if (reason) $("cr-note").textContent = reason;
    $("cr-msg").textContent = "";
    modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
  }
  function close() { if (modal) { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); render(); } }

  if (chip) chip.addEventListener("click", function () { open(); });
  if (modal) {
    modal.addEventListener("click", function (e) { if (e.target === modal || e.target.closest("[data-close]")) close(); });
    modal.querySelectorAll("[data-plan]").forEach(function (b) {
      b.addEventListener("click", function () {
        var plan = b.dataset.plan, name = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" }[plan];
        var user = {}; try { user = JSON.parse(localStorage.getItem("black.user") || "{}"); } catch (e) {}
        b.disabled = true;
        api("/upgrade", { method: "POST", body: { plan: plan } }).then(function () {
          $("cr-msg").textContent = "Request sent for " + name + ". Finish the email that just opened, and the GetServices team will activate your plan.";
        }).catch(function (err) {
          $("cr-msg").textContent = err.message + " Your email to the team still works.";
        }).finally(function () {
          b.disabled = false;
          // Also emails the team, so the request is seen right away.
          location.href = "mailto:agents@getservices.ai?subject=" + encodeURIComponent("BLACK upgrade request: " + name) +
            "&body=" + encodeURIComponent("Please activate BLACK " + name + " for my account.\n\nAccount email: " + (user.email || "") + "\n");
        });
      });
    });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal && modal.classList.contains("open")) close(); });

  // Signed out from the account drawer, or the session expired -> back to sign-in.
  if (window.BLACK_CAL && window.BLACK_CAL.onChange) {
    window.BLACK_CAL.onChange(function () { if (!window.BLACK_CAL.signedIn()) toSignIn(); });
  }
  var p0 = $("prompt"); if (p0) p0.dataset.ph = p0.placeholder;
  if (token()) refresh();

  window.BLACK_CREDITS = { token: token, refresh: refresh, set: set, canSend: canSend, isOut: out, open: open, signOut: signOutAndLeave };
})();
