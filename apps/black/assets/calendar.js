/* BLACK account + calendar (console side).
 * - Sign in with the GetServices account (email + password through BLACK's gateway, or Google/Microsoft via ATLAS).
 * - Scheduling briefs ("schedule…", "move…", "cancel…") open a confirmation card; nothing is saved until Create.
 * - Calendar drawer: upcoming meetings (BLACK + linked Google/Outlook iCal), link settings, subscribe link.
 * - Calendar questions ("what's on tomorrow?") get the user's real events added as context.
 * Exposes window.BLACK_CAL.
 */
(function () {
  "use strict";
  var KEY = "black.session", USER_KEY = "black.user";
  var TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } })();
  var $ = function (id) { return document.getElementById(id); };
  var token = read(KEY), user = safe(read(USER_KEY)), info = null, cache = null;
  var listeners = [];

  function read(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function write(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }
  function safe(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Back from Google/Microsoft sign-in: #atlas_session=<token>
  (function capture() {
    var m = location.hash.match(/atlas_session=([A-Za-z0-9_-]+)/);
    if (!m) return;
    token = m[1]; write(KEY, token); user = null; write(USER_KEY, "");
    history.replaceState(null, "", location.pathname + location.search);
  })();

  function api(path, opts) {
    opts = opts || {};
    var h = { "content-type": "application/json" };
    if (token) h.authorization = "Bearer " + token;
    return fetch("/v1/me" + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && path !== "/login") signOut(true);
          if (!r.ok) { var e = new Error(j.detail || friendly(j.error, r.status)); e.code = j.error; e.status = r.status; throw e; }
          return j;
        });
      });
  }
  function friendly(code, status) {
    if (code === "SIGN_IN_REQUIRED") return "Sign in to use your BLACK calendar.";
    if (code === "CALENDAR_NOT_CONFIGURED") return "The BLACK calendar isn't switched on yet (its database isn't connected).";
    return "Something went wrong (" + status + "). Try again.";
  }

  // ---------- account UI ----------
  var acct = $("account-btn"), modal = $("signin-modal"), drawer = $("cal-drawer");
  function emit() { listeners.forEach(function (f) { f(user); }); renderAccount(); }
  function renderAccount() {
    if (!acct) return;
    if (user && user.email) {
      acct.innerHTML = '<span class="av">' + esc(user.email.charAt(0).toUpperCase()) + '</span><span class="lbl">Calendar</span>';
      acct.title = "Signed in as " + user.email;
    } else {
      acct.innerHTML = '<span class="lbl">Sign in</span>';
      acct.title = "Sign in with your GetServices account";
    }
  }
  function refreshMe() {
    if (!token) { user = null; info = null; emit(); return Promise.resolve(null); }
    return api("").then(function (j) {
      user = j.user; info = j.calendar; write(USER_KEY, JSON.stringify(user));
      if (j.profile && window.BLACK_NAME) window.BLACK_NAME.fromAccount(j.profile.name);
      emit();
      if (info && info.configured && info.tz !== TZ) api("/settings", { method: "PUT", body: { tz: TZ } }).catch(function () {});
      loadUpcoming();
      return j;
    }).catch(function () { return null; });
  }
  function signOut(quiet) {
    token = ""; user = null; info = null; cache = null;
    write(KEY, ""); write(USER_KEY, "");
    emit();
    if (drawer) closeDrawer();
    if (!quiet && window.BLACK_WORKSPACE && window.BLACK_WORKSPACE.setMeetings) location.reload();
  }

  if (acct) acct.addEventListener("click", function () { user ? openDrawer() : openSignIn(); });
  function openSignIn(reason) {
    if (!modal) return;
    $("si-reason").textContent = reason || "Use your GetServices account. It's the same login as AI Studio and ATLAS.";
    $("si-error").textContent = "";
    modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
    setTimeout(function () { $("si-email").focus(); }, 30);
    var box = $("si-providers");
    if (box && !box.dataset.loaded) {
      box.dataset.loaded = "1";
      fetch("/v1/me/providers").then(function (r) { return r.json(); }).then(function (j) {
        box.innerHTML = (j.providers || []).map(function (p) { return '<a class="btn btn-ghost" href="' + esc(p.url) + '">Continue with ' + esc(p.label) + "</a>"; }).join("");
        if (j.signupUrl) $("si-signup").href = j.signupUrl;
      }).catch(function () {});
    }
  }
  function closeSignIn() { if (modal) { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); } }
  if (modal) {
    modal.addEventListener("click", function (e) { if (e.target === modal || e.target.closest("[data-close]")) closeSignIn(); });
    $("si-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("si-submit"); btn.disabled = true; btn.textContent = "Signing in…"; $("si-error").textContent = "";
      api("/login", { method: "POST", body: { email: $("si-email").value, password: $("si-password").value } }).then(function (j) {
        token = j.token; write(KEY, token); user = j.user; write(USER_KEY, JSON.stringify(user));
        $("si-password").value = ""; closeSignIn(); refreshMe();
        if (pendingAfterSignIn) { var f = pendingAfterSignIn; pendingAfterSignIn = null; f(); }
      }).catch(function (err) { $("si-error").textContent = err.message; })
        .finally(function () { btn.disabled = false; btn.textContent = "Sign in"; });
    });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeSignIn(); closeDrawer(); } });
  var pendingAfterSignIn = null;

  // ---------- time helpers (browser time zone) ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function toDateInput(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function toTimeInput(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function fromInputs(date, time) { var a = date.split("-").map(Number), b = (time || "00:00").split(":").map(Number); return new Date(a[0], a[1] - 1, a[2], b[0] || 0, b[1] || 0).getTime(); }
  function when(ms, opts) { return new Date(ms).toLocaleString([], opts || { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function hm(ms) { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function dayKey(e) { return e.allDay ? e.date : toDateInput(e.start); }
  function dayLabel(key) {
    var a = key.split("-").map(Number), d = new Date(a[0], a[1] - 1, a[2]), t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((d - t) / 86400000);
    return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  }

  // ---------- upcoming events ----------
  function loadUpcoming() {
    if (!token || !info || !info.configured) return Promise.resolve([]);
    var from = new Date(); from.setHours(0, 0, 0, 0);
    return api("/events?from=" + from.getTime() + "&to=" + (from.getTime() + 14 * 86400000)).then(function (j) {
      cache = j;
      var todayKey = toDateInput(Date.now());
      var today = j.events.filter(function (e) { return dayKey(e) === todayKey; });
      if (window.BLACK_WORKSPACE && window.BLACK_WORKSPACE.setMeetings) {
        window.BLACK_WORKSPACE.setMeetings(today.map(function (e) {
          return { start: e.allDay ? Date.now() : e.start, title: e.title, allDay: e.allDay, tag: (e.source === "black" ? "BLACK" : "Linked calendar") + (e.attendees && e.attendees.length ? " · with " + e.attendees.map(function (a) { return a.name; }).join(", ") : "") };
        }));
      }
      if (drawer && drawer.classList.contains("open")) renderDrawer();
      return j.events;
    }).catch(function () { return []; });
  }

  // ---------- drawer ----------
  function openDrawer() { if (!drawer) return; drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); renderDrawer(); loadUpcoming(); }
  function closeDrawer() { if (drawer) { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); } }
  function renderDrawer() {
    var body = $("cal-body"); if (!body) return;
    if (!info || !info.configured) { body.innerHTML = '<p class="cal-empty">' + esc(friendly("CALENDAR_NOT_CONFIGURED")) + "</p>" + acctFoot(); bindFoot(); return; }
    var evs = (cache && cache.events) || [], groups = {}, order = [];
    evs.forEach(function (e) { var k = dayKey(e); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(e); });
    var list = order.length ? order.map(function (k) {
      return '<div class="cal-day"><h5>' + esc(dayLabel(k)) + "</h5>" + groups[k].map(function (e) {
        return '<div class="cal-ev ' + e.source + '"><span class="t">' + (e.allDay ? "All day" : esc(hm(e.start)) + "<small>" + esc(hm(e.end)) + "</small>") + "</span>" +
          '<span class="n">' + esc(e.title) + "<small>" + (e.source === "black" ? "BLACK" : "Linked calendar") +
          (e.attendees && e.attendees.length ? " · " + esc(e.attendees.map(function (a) { return a.name; }).join(", ")) : "") + "</small></span>" +
          (e.source === "black" ? '<span class="acts"><button type="button" data-move="' + esc(e.id) + '" title="Move">Move</button><button type="button" data-cancel="' + esc(e.id) + '" title="Cancel meeting">Cancel</button></span>' : "") + "</div>";
      }).join("") + "</div>";
    }).join("") : '<p class="cal-empty">No meetings in the next 14 days.</p>';
    body.innerHTML =
      '<button type="button" class="btn btn-gold btn-sm cal-new" id="cal-new">+ New meeting</button>' +
      (cache && cache.linkedError ? '<p class="cal-warn">' + esc(cache.linkedError) + "</p>" : "") + list +
      '<details class="cal-set"' + (info.linked ? "" : " open") + "><summary>Calendar settings</summary>" +
        '<label>Show my Google / Outlook calendar <small>Paste its private iCal address (Google Calendar: Settings → your calendar → “Secret address in iCal format”). Read-only.</small>' +
        '<input id="cal-ical" type="url" placeholder="' + (info.linked ? "Linked ✓  (paste a new address to change, or clear and save to unlink)" : "https://calendar.google.com/calendar/ical/…/private-…/basic.ics") + '"></label>' +
        '<label>Default video link <small>Added to new meetings</small><input id="cal-video" type="url" placeholder="https://zoom.us/j/…" value="' + esc(info.videoLink || "") + '"></label>' +
        '<div class="cal-row"><button type="button" class="btn btn-ghost btn-sm" id="cal-save">Save</button>' + (info.linked ? '<button type="button" class="btn btn-ghost btn-sm" id="cal-unlink">Unlink calendar</button>' : "") + '<span id="cal-msg"></span></div>' +
        '<label>See BLACK meetings in Google Calendar <small>Google Calendar → Other calendars → + → From URL, then paste:</small>' +
        '<div class="cal-row"><input id="cal-feed" readonly value="' + esc(info.feedUrl || "") + '"><button type="button" class="btn btn-ghost btn-sm" id="cal-copy">Copy</button></div></label>' +
        '<p class="cal-tz">Time zone: ' + esc(TZ) + "</p>" +
      "</details>" + acctFoot();
    $("cal-new").addEventListener("click", function () { closeDrawer(); newMeetingCard(); });
    $("cal-save").addEventListener("click", function () { saveSettings(false); });
    if ($("cal-unlink")) $("cal-unlink").addEventListener("click", function () { saveSettings(true); });
    $("cal-copy").addEventListener("click", function () {
      var v = $("cal-feed").value;
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { $("cal-copy").textContent = "Copied"; }).catch(function () { $("cal-feed").select(); });
    });
    body.querySelectorAll("[data-cancel]").forEach(function (b) {
      b.addEventListener("click", function () {
        var ev = evs.find(function (x) { return x.id === b.dataset.cancel; });
        if (!ev || !confirm("Cancel “" + ev.title + "” on " + when(ev.start) + "?")) return;
        api("/events/" + encodeURIComponent(ev.id), { method: "DELETE" }).then(loadUpcoming).catch(function (e) { alert(e.message); });
      });
    });
    body.querySelectorAll("[data-move]").forEach(function (b) {
      b.addEventListener("click", function () {
        var ev = evs.find(function (x) { return x.id === b.dataset.move; });
        if (!ev) return; closeDrawer();
        card({ action: "reschedule", eventId: ev.id, proposal: ev, conflicts: [], alternatives: [] });
      });
    });
    bindFoot();
  }
  function acctFoot() { return '<div class="cal-foot">' + (user ? "Signed in as " + esc(user.email) : "") + ' <button type="button" id="cal-signout">Sign out</button></div>'; }
  function bindFoot() { var b = $("cal-signout"); if (b) b.addEventListener("click", function () { signOut(false); }); }
  function saveSettings(unlink) {
    var b = { videoLink: $("cal-video").value.trim(), tz: TZ };
    var ical = $("cal-ical").value.trim();
    if (unlink) b.icalUrl = ""; else if (ical) b.icalUrl = ical;
    $("cal-msg").textContent = ical && !unlink ? "Checking your calendar…" : "Saving…";
    api("/settings", { method: "PUT", body: b }).then(function () {
      return refreshMe();
    }).then(function () { renderDrawer(); var m = $("cal-msg"); if (m) m.textContent = "Saved ✓"; })
      .catch(function (e) { var m = $("cal-msg"); if (m) { m.textContent = e.message; m.className = "err"; } });
  }
  if (drawer) drawer.addEventListener("click", function (e) { if (e.target === drawer || e.target.closest("[data-close]")) closeDrawer(); });

  // ---------- briefs ----------
  var SCHED = /\b(schedule|book|set ?up|arrange|plan|add|put)\b[^.?!]*\b(meeting|call|sync|review|lunch|dinner|coffee|appointment|interview|stand-?up|1:1|one-on-one|catch-?up|session|demo)\b|^(schedule|book|reschedule)\b|\b(reschedule|move|push|cancel|delete)\b[^.?!]*\b(meeting|call|sync|review|appointment|interview|1:1|catch-?up|session|demo)\b/i;
  var ASK = /\b(what'?s|what is|anything) on (my|the)?\s*(calendar|schedule|agenda|plate)?\b|\bmy (calendar|schedule|agenda|day|week|meetings)\b|\bam i (free|busy|available)\b|\b(free|open) (time|slots?)\b|\bwhen am i free\b|\bmeetings? (today|tomorrow|this week|next week)\b/i;
  function isScheduling(t) { return SCHED.test(t); }
  var ASK2 = /\b(meetings?|calendar|schedule|agenda|appointments?)\b[^.?!]{0,30}\b(today|tonight|tomorrow|this week|next week|this month|next month)\b/i;
  function isCalendarQuestion(t) { return !SCHED.test(t) && (ASK.test(t) || ASK2.test(t)); }
  // True once BLACK has something to read: a linked calendar or BLACK meetings of its own.
  function hasCalendar() { return !!token && !!info && !!info.configured && (!!info.linked || !!(cache && cache.events && cache.events.length)); }

  // Calendar question with no calendar to read: ask to connect or upload instead of a full engine report.
  function connectCard(done) {
    var d = cardShell("Calendar"), box = d.querySelector(".cal-in");
    box.innerHTML = "<p>BLACK can\u2019t see your calendar yet. Connect your calendar, or upload a calendar file with the \ud83d\udcce paperclip, to see your meetings.</p>" +
      '<div class="cal-acts"><button type="button" class="btn btn-gold btn-sm" data-connect>Connect calendar</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-upload>\ud83d\udcce Upload calendar file</button></div>' +
      '<p class="cal-help"><b>Connect</b> shows your Google or Outlook calendar live (paste its private iCal address in calendar settings). ' +
      '<b>Upload</b> reads a one-time .ics, Excel or CSV export.<br>' + ((window.BLACK_ATTACH && window.BLACK_ATTACH.helpHtml) || "") +
      ' \u00b7 <a href="https://support.google.com/calendar/answer/37648?hl=en" target="_blank" rel="noopener">Find Google\u2019s private iCal address</a></p>';
    box.querySelector("[data-connect]").addEventListener("click", function () {
      if (token) return openDrawer();
      pendingAfterSignIn = function () { openDrawer(); };
      openSignIn("Sign in to connect your calendar.");
    });
    box.querySelector("[data-upload]").addEventListener("click", function () { var b = document.getElementById("attach-btn"); if (b) { b.focus(); b.click(); } });
    done && done("BLACK can\u2019t see your calendar yet. Connect your calendar or upload a calendar file to see your meetings.");
  }

  // Compact view of the next 14 days for calendar questions.
  function contextBlock() {
    if (!token || !info || !info.configured) return Promise.resolve("");
    return loadUpcoming().then(function (evs) {
      var lines = evs.slice(0, 60).map(function (e) {
        return "- " + (e.allDay ? dayLabel(e.date) + " (all day)" : when(e.start) + "–" + hm(e.end)) + ": " + e.title +
          (e.attendees && e.attendees.length ? " (with " + e.attendees.map(function (a) { return a.name; }).join(", ") + ")" : "") + (e.source === "linked" ? " [linked calendar]" : "");
      });
      return "[Your calendar, next 14 days, time zone " + TZ + ", now " + when(Date.now()) + "]\n" + (lines.join("\n") || "- No meetings.");
    });
  }

  // ---------- confirmation card ----------
  var thread = $("thread");
  function cardShell(title) {
    var d = document.createElement("div"); d.className = "msg";
    d.innerHTML = '<div class="answer cal-card"><div class="head"><span class="who">BLACK</span><span class="cal-kicker">' + esc(title) + '</span></div><div class="cal-in"></div></div>';
    thread.appendChild(d); d.scrollIntoView({ block: "end" }); return d;
  }
  function propose(text, done) {
    var d = cardShell("Calendar"), box = d.querySelector(".cal-in");
    if (!token) {
      box.innerHTML = '<p>Sign in to schedule with your BLACK calendar. It uses your GetServices account.</p><button type="button" class="btn btn-gold btn-sm">Sign in</button>';
      box.querySelector("button").addEventListener("click", function () { pendingAfterSignIn = function () { d.remove(); propose(text, done); }; openSignIn("Sign in to schedule “" + text.slice(0, 60) + "”."); });
      return done && done(null);
    }
    box.innerHTML = '<span class="thinking"><i></i><i></i><i></i>&nbsp;Checking your calendar…</span>';
    api("/propose", { method: "POST", body: { text: text, tz: TZ } }).then(function (p) {
      d.remove();
      if (p.action === "none") { var q = cardShell("Calendar"); q.querySelector(".cal-in").innerHTML = "<p>" + esc(p.question) + "</p>"; return done && done(null); }
      card(p, done);
    }).catch(function (e) { box.innerHTML = '<p class="error">' + esc(e.message) + "</p>"; done && done(null); });
  }
  function newMeetingCard() {
    var start = Math.ceil((Date.now() + 3600000) / 1800000) * 1800000;
    card({ action: "create", proposal: { title: "", start: start, end: start + 1800000, attendees: [], location: (info && info.videoLink) || "", notes: "" }, conflicts: [], alternatives: [] });
  }

  function card(p, done) {
    var ev = p.action === "cancel" ? p.event : p.proposal;
    var d = cardShell(p.action === "cancel" ? "Cancel meeting" : p.action === "reschedule" ? "Move meeting" : "New meeting"), box = d.querySelector(".cal-in");
    if (p.action === "cancel") {
      box.innerHTML = '<p class="cal-sum"><b>' + esc(ev.title) + "</b><br>" + esc(when(ev.start)) + " – " + esc(hm(ev.end)) + "</p>" +
        '<div class="cal-acts"><button type="button" class="btn btn-gold btn-sm" data-go>Cancel meeting</button><button type="button" class="btn btn-ghost btn-sm" data-keep>Keep it</button></div>';
      box.querySelector("[data-go]").addEventListener("click", function () {
        api("/events/" + encodeURIComponent(ev.id), { method: "DELETE" }).then(function () {
          box.innerHTML = '<p class="cal-ok">✓ Cancelled <b>' + esc(ev.title) + "</b> (" + esc(when(ev.start)) + ").</p>";
          loadUpcoming(); done && done("Cancelled **" + ev.title + "** (" + when(ev.start) + ").");
        }).catch(function (e) { alert(e.message); });
      });
      box.querySelector("[data-keep]").addEventListener("click", function () { d.remove(); done && done(null); });
      return;
    }
    var dur = Math.round((ev.end - ev.start) / 60000);
    var durs = [15, 30, 45, 60, 90, 120]; if (durs.indexOf(dur) < 0) durs.push(dur); durs.sort(function (a, b) { return a - b; });
    box.innerHTML =
      '<div class="cal-form">' +
        '<label class="wide">Title<input data-f="title" value="' + esc(ev.title) + '" placeholder="Meeting title" maxlength="140"></label>' +
        '<label>Date<input data-f="date" type="date" value="' + toDateInput(ev.start) + '"></label>' +
        '<label>Time<input data-f="time" type="time" step="300" value="' + toTimeInput(ev.start) + '"></label>' +
        '<label>Length<select data-f="dur">' + durs.map(function (m) { return '<option value="' + m + '"' + (m === dur ? " selected" : "") + ">" + (m < 60 ? m + " min" : (m / 60) + " h") + "</option>"; }).join("") + "</select></label>" +
        '<div class="wide"><span class="lab">With</span><div class="cal-people" data-people></div><button type="button" class="link" data-add>+ Add person</button></div>' +
        '<label class="wide">Video link or place<input data-f="location" value="' + esc(ev.location || "") + '" placeholder="https://zoom.us/j/… or an address"></label>' +
        '<label class="wide">Notes<textarea data-f="notes" rows="2" placeholder="Agenda, prep…">' + esc(ev.notes || "") + "</textarea></label>" +
      "</div>" +
      '<div class="cal-conf" data-conf></div>' +
      '<div class="cal-acts"><button type="button" class="btn btn-gold btn-sm" data-go>' + (p.action === "reschedule" ? "Move meeting" : "Create meeting") + '</button><button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><span class="cal-tzn">' + esc(TZ) + "</span></div>";
    var people = box.querySelector("[data-people]");
    function addPerson(a) {
      var r = document.createElement("div"); r.className = "person";
      r.innerHTML = '<input placeholder="Name" value="' + esc(a.name || "") + '"><input type="email" placeholder="email (for invites later)" value="' + esc(a.email || "") + '"><button type="button" aria-label="Remove">✕</button>';
      r.querySelector("button").addEventListener("click", function () { r.remove(); });
      people.appendChild(r);
    }
    (ev.attendees || []).forEach(addPerson);
    box.querySelector("[data-add]").addEventListener("click", function () { addPerson({}); people.lastChild.querySelector("input").focus(); });
    var f = function (k) { return box.querySelector('[data-f="' + k + '"]'); };
    function conf(list, alts) {
      var c = box.querySelector("[data-conf]");
      if (!list || !list.length) { c.innerHTML = p.past ? '<p class="cal-warn">⚠ That time is in the past.</p>' : ""; return; }
      c.innerHTML = '<p class="cal-warn">⚠ Clashes with ' + list.map(function (x) { return "<b>" + esc(x.title) + "</b> (" + esc(hm(x.start)) + "–" + esc(hm(x.end)) + ")"; }).join(", ") + "</p>" +
        (alts && alts.length ? '<div class="cal-alts"><span>Free instead:</span>' + alts.map(function (a) { return '<button type="button" data-alt="' + a.start + '">' + esc(when(a.start)) + "</button>"; }).join("") + "</div>" : "");
      c.querySelectorAll("[data-alt]").forEach(function (b) {
        b.addEventListener("click", function () { var t = +b.dataset.alt; f("date").value = toDateInput(t); f("time").value = toTimeInput(t); c.innerHTML = '<p class="cal-ok">✓ Free at ' + esc(when(t)) + "</p>"; });
      });
    }
    conf(p.conflicts, p.alternatives);
    if (!ev.title) setTimeout(function () { f("title").focus(); }, 30);
    box.querySelector("[data-x]").addEventListener("click", function () { d.remove(); done && done(null); });
    box.querySelector("[data-go]").addEventListener("click", function () {
      var go = box.querySelector("[data-go]");
      var start = fromInputs(f("date").value, f("time").value), end = start + Number(f("dur").value) * 60000;
      var att = Array.prototype.map.call(people.querySelectorAll(".person"), function (r) { var i = r.querySelectorAll("input"); return { name: i[0].value.trim(), email: i[1].value.trim() }; })
        .filter(function (a) { return a.name || a.email; });
      var payload = { title: f("title").value.trim(), start: start, end: end, tz: TZ, attendees: att, location: f("location").value.trim(), notes: f("notes").value.trim() };
      if (!payload.title) { f("title").focus(); return; }
      go.disabled = true; go.textContent = "Saving…";
      var req = p.action === "reschedule" ? api("/events/" + encodeURIComponent(p.eventId || ev.id), { method: "PATCH", body: payload }) : api("/events", { method: "POST", body: payload });
      req.then(function (r) {
        var e = r.event, withs = e.attendees.length ? " · with " + e.attendees.map(function (a) { return a.name; }).join(", ") : "";
        box.innerHTML = '<p class="cal-ok">✓ ' + (p.action === "reschedule" ? "Moved" : "Added") + " <b>" + esc(e.title) + "</b> · " + esc(when(e.start)) + "–" + esc(hm(e.end)) + esc(withs) + "</p>" +
          (e.location ? '<p class="cal-sub">' + esc(e.location) + "</p>" : "") +
          '<div class="cal-acts"><button type="button" class="btn btn-ghost btn-sm" data-open>Open calendar</button></div>';
        box.querySelector("[data-open]").addEventListener("click", openDrawer);
        loadUpcoming();
        done && done((p.action === "reschedule" ? "Moved" : "Scheduled") + " **" + e.title + "** · " + when(e.start) + "–" + hm(e.end) + withs + ".");
      }).catch(function (e) { go.disabled = false; go.textContent = p.action === "reschedule" ? "Move meeting" : "Create meeting"; conf([], []); box.querySelector("[data-conf]").innerHTML = '<p class="error">' + esc(e.message) + "</p>"; });
    });
  }

  renderAccount();
  if (token) refreshMe();

  window.BLACK_CAL = {
    isScheduling: isScheduling, isCalendarQuestion: isCalendarQuestion, propose: propose, contextBlock: contextBlock,
    hasCalendar: hasCalendar, connectCard: connectCard,
    signedIn: function () { return !!token; },
    saveName: function (name) { return token && info && info.configured ? api("/profile", { method: "PUT", body: { name: name } }).catch(function () {}) : Promise.resolve(); }, openSignIn: openSignIn, openDrawer: openDrawer,
    onChange: function (f) { listeners.push(f); }
  };
})();
