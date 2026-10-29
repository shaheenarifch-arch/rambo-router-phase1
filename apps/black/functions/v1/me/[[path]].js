/*
 * BLACK account + calendar — Cloudflare Pages Function at /v1/me/*.
 *
 * Sign-in uses the GetServices (ATLAS) account. BLACK never stores passwords:
 *   POST /v1/me/login            {email, password} -> ATLAS /auth/login -> {token, user}
 *   GET  /v1/me/providers        which social sign-ins ATLAS offers, with their start URLs
 *   GET  /v1/me                  who is signed in + calendar settings   (Authorization: Bearer <token>)
 * Calendar (BLACK's own, stored in Cloudflare D1):
 *   GET    /v1/me/events?from=&to=   BLACK events + events from the user's linked iCal calendar
 *   POST   /v1/me/propose            {text, tz}  brief -> proposed create / reschedule / cancel, with conflicts
 *   POST   /v1/me/events             create (after the user confirms)
 *   PATCH  /v1/me/events/:id         reschedule / edit
 *   DELETE /v1/me/events/:id         cancel
 *   PUT    /v1/me/settings           {icalUrl, tz, videoLink}
 *   GET    /v1/me/feed/:secret.ics   subscribe feed for Google / Outlook / Apple (no sign-in; secret URL)
 *
 * Bindings and secrets (Cloudflare Pages > black-edition > Settings):
 *   BLACK_DB           D1 database binding (tables are created on first use)
 *   TOKEN_KEY          any long random string; encrypts each user's private iCal address at rest
 *   ATLAS_API_URL      optional, defaults to the live ATLAS API
 *   ANTHROPIC_API_KEY  already set for the gateway; used to understand scheduling briefs
 */

const ATLAS_DEFAULT = "https://atlas-api-v2.python-tester.workers.dev";
const SITE = "https://black.getservices.ai";
const ME_CACHE_MS = 5 * 60 * 1000;
const ICAL_CACHE_MS = 5 * 60 * 1000;
const DAY = 86400000;
const meCache = new Map();   // token -> { user, at }
const icalCache = new Map(); // url -> { events, at }

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const parts = [].concat(params.path || []).filter(Boolean);
  const method = request.method.toUpperCase();
  try {
    return await route(ctx, parts, method);
  } catch (e) {
    if (e && e.status) return json({ error: e.code || "BAD_REQUEST", detail: e.message }, e.status);
    return json({ error: "INTERNAL_ERROR", detail: String((e && e.message) || e).slice(0, 160) }, 500);
  }
}

async function route({ request, env }, parts, method) {
  {
    // ---- no sign-in needed ----
    if (parts[0] === "login" && method === "POST") return login(request, env);
    if (parts[0] === "providers" && method === "GET") return providers(env);
    if (parts[0] === "feed" && method === "GET") return feed(env, String(parts[1] || "").replace(/\.ics$/i, ""));

    // ---- signed in ----
    const user = await userFrom(request, env);
    if (!user) return json({ error: "SIGN_IN_REQUIRED" }, 401);
    if (!parts.length && method === "GET") return meInfo(env, user, request);
    if (!env.BLACK_DB) return json({ error: "CALENDAR_NOT_CONFIGURED" }, 503);
    await ensureSchema(env);

    if (parts[0] === "settings" && method === "PUT") return saveSettings(request, env, user);
    if (parts[0] === "profile" && method === "PUT") return saveProfile(request, env, user);
    if (parts[0] === "propose" && method === "POST") return propose(request, env, user);
    if (parts[0] === "events") {
      if (!parts[1] && method === "GET") return listEvents(request, env, user);
      if (!parts[1] && method === "POST") return createEvent(request, env, user);
      if (parts[1] && method === "PATCH") return updateEvent(request, env, user, parts[1]);
      if (parts[1] && method === "DELETE") return cancelEvent(env, user, parts[1]);
    }
    return json({ error: "NOT_FOUND" }, 404);
  }
}

// ---------------- identity (ATLAS) ----------------
const atlas = (env) => String(env.ATLAS_API_URL || ATLAS_DEFAULT).replace(/\/+$/, "");

async function login(request, env) {
  const b = await body(request);
  if (!b.email || !b.password) throw bad("Enter your email and password.");
  const r = await fetch(atlas(env) + "/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: String(b.email).trim(), password: String(b.password) })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) return json({ error: "LOGIN_FAILED", detail: j.error || j.message || "That email and password didn't match." }, r.status === 429 ? 429 : 401);
  return json({ token: j.token, user: { id: j.user && j.user.id, email: j.user && j.user.email } });
}

async function providers(env) {
  const r = await fetch(atlas(env) + "/auth/providers").catch(() => null);
  const j = r && r.ok ? await r.json().catch(() => ({})) : {};
  // ATLAS answers { google: true, microsoft: false, password: true, ... }; older shapes were lists.
  const raw = Array.isArray(j.providers) ? j.providers : Array.isArray(j) ? j
    : ["google", "microsoft"].filter((id) => j[id] === true).map((id) => ({ id }));
  const list = raw
    .map((p) => (typeof p === "string" ? { id: p } : p))
    .filter((p) => p && p.id && p.enabled !== false)
    .map((p) => ({
      id: p.id, label: p.label || p.name || ({ google: "Google", microsoft: "Microsoft" }[p.id]) || p.id.charAt(0).toUpperCase() + p.id.slice(1),
      url: atlas(env) + "/auth/oauth/" + encodeURIComponent(p.id) + "?redirect=" + encodeURIComponent(SITE + "/app.html")
    }));
  return json({ providers: list, signupUrl: "https://app.getservices.ai/#/signup" });
}

async function userFrom(request, env) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+([A-Za-z0-9_\-]{20,})$/);
  if (!m) return null;
  const token = m[1], hit = meCache.get(token);
  if (hit && Date.now() - hit.at < ME_CACHE_MS) return hit.user;
  const r = await fetch(atlas(env) + "/auth/me", { headers: { authorization: "Bearer " + token } }).catch(() => null);
  if (!r || !r.ok) { meCache.delete(token); return null; }
  const j = await r.json().catch(() => ({}));
  if (!j.authenticated || !j.user || !j.user.id) return null;
  const user = { id: String(j.user.id), email: j.user.email || "" };
  meCache.set(token, { user, at: Date.now() });
  if (meCache.size > 500) meCache.delete(meCache.keys().next().value);
  return user;
}

async function meInfo(env, user, request) {
  const out = { user, calendar: { configured: !!env.BLACK_DB } };
  if (env.BLACK_DB) {
    await ensureSchema(env);
    const s = await settings(env, user);
    out.calendar = {
      configured: true, linked: !!s.ical_url, tz: s.tz || null, videoLink: s.video_link || "",
      feedUrl: new URL(request.url).origin + "/v1/me/feed/" + s.feed_secret + ".ics"
    };
    const p = await env.BLACK_DB.prepare(`SELECT display_name FROM black_profiles WHERE user_id = ?`).bind(user.id).first();
    out.profile = { name: (p && p.display_name) || "" };
  }
  return json(out);
}

// What BLACK calls the user ("Shaheen's Command Workspace"), kept with their account so it follows them to any device.
async function saveProfile(request, env, user) {
  const b = await body(request);
  const name = String(b.name || "").replace(/[<>"`]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  await env.BLACK_DB.prepare(`INSERT INTO black_profiles (user_id, display_name, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
    .bind(user.id, name, Date.now()).run();
  return json({ ok: true, name });
}

// ---------------- storage (D1) ----------------
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.BLACK_DB.batch([
    env.BLACK_DB.prepare(`CREATE TABLE IF NOT EXISTS cal_users (user_id TEXT PRIMARY KEY, email TEXT, ical_url TEXT, feed_secret TEXT UNIQUE, tz TEXT, video_link TEXT, updated_at INTEGER)`),
    env.BLACK_DB.prepare(`CREATE TABLE IF NOT EXISTS cal_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, tz TEXT, attendees TEXT, location TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'confirmed', seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER)`),
    env.BLACK_DB.prepare(`CREATE INDEX IF NOT EXISTS cal_events_user_start ON cal_events (user_id, start_ms)`),
    env.BLACK_DB.prepare(`CREATE TABLE IF NOT EXISTS black_profiles (user_id TEXT PRIMARY KEY, display_name TEXT, updated_at INTEGER)`),
    env.BLACK_DB.prepare(`CREATE TABLE IF NOT EXISTS cal_contacts (user_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, updated_at INTEGER, PRIMARY KEY (user_id, name))`)
  ]);
  schemaReady = true;
}

async function settings(env, user) {
  let s = await env.BLACK_DB.prepare(`SELECT * FROM cal_users WHERE user_id = ?`).bind(user.id).first();
  if (!s) {
    s = { user_id: user.id, email: user.email, ical_url: null, feed_secret: secret(), tz: null, video_link: "" };
    await env.BLACK_DB.prepare(`INSERT INTO cal_users (user_id, email, feed_secret, updated_at) VALUES (?, ?, ?, ?)`).bind(user.id, user.email, s.feed_secret, Date.now()).run();
  }
  return s;
}

async function saveSettings(request, env, user) {
  const b = await body(request), s = await settings(env, user);
  let ical = s.ical_url;
  if (b.icalUrl !== undefined) {
    const raw = String(b.icalUrl || "").trim().replace(/^webcal:\/\//i, "https://");
    if (raw) {
      if (!/^https:\/\/\S+$/i.test(raw)) throw bad("Paste the calendar's private iCal address (it starts with https:// or webcal://).");
      const test = await fetchIcal(raw, true).catch((e) => { throw bad("BLACK couldn't read that calendar link: " + e.message); });
      ical = await seal(env, raw);
      icalCache.set(raw, { events: test, at: Date.now() });
    } else ical = null;
  }
  const tz = b.tz !== undefined ? validTz(b.tz) || null : s.tz;
  const video = b.videoLink !== undefined ? (String(b.videoLink || "").trim().match(/^https:\/\/\S+$/) ? String(b.videoLink).trim() : "") : s.video_link;
  await env.BLACK_DB.prepare(`UPDATE cal_users SET ical_url = ?, tz = ?, video_link = ?, updated_at = ? WHERE user_id = ?`).bind(ical, tz, video, Date.now(), user.id).run();
  return json({ ok: true, linked: !!ical, tz, videoLink: video });
}

// ---------------- events ----------------
function rowToEvent(r) {
  return {
    id: r.id, source: "black", title: r.title, start: r.start_ms, end: r.end_ms, tz: r.tz,
    attendees: safeJson(r.attendees, []), location: r.location || "", notes: r.notes || "", status: r.status
  };
}

async function blackEvents(env, user, from, to) {
  const q = await env.BLACK_DB.prepare(`SELECT * FROM cal_events WHERE user_id = ? AND status = 'confirmed' AND end_ms > ? AND start_ms < ? ORDER BY start_ms LIMIT 500`).bind(user.id, from, to).all();
  return (q.results || []).map(rowToEvent);
}

async function linkedEvents(env, user, from, to) {
  const s = await settings(env, user);
  if (!s.ical_url) return { events: [], error: null };
  try {
    const url = await unseal(env, s.ical_url);
    const all = await fetchIcal(url);
    return { events: expand(all, from, to), error: null };
  } catch (e) { return { events: [], error: "Your linked calendar couldn't be read right now." }; }
}

async function listEvents(request, env, user) {
  const u = new URL(request.url);
  const from = num(u.searchParams.get("from"), Date.now() - DAY);
  const to = Math.min(num(u.searchParams.get("to"), from + 14 * DAY), from + 120 * DAY);
  const [mine, linked] = await Promise.all([blackEvents(env, user, from, to), linkedEvents(env, user, from, to)]);
  const events = mine.concat(linked.events).sort((a, b) => a.start - b.start);
  return json({ events, linkedError: linked.error });
}

function cleanEvent(b, tzFallback) {
  const title = String(b.title || "").trim().slice(0, 140);
  if (!title) throw bad("Give the meeting a title.");
  const start = Number(b.start), end = Number(b.end);
  if (!isFinite(start) || !isFinite(end) || end <= start) throw bad("Check the meeting's start and end time.");
  if (end - start > 12 * 3600000) throw bad("Meetings can be at most 12 hours long.");
  const attendees = (Array.isArray(b.attendees) ? b.attendees : []).slice(0, 30).map((a) => ({
    name: String((a && a.name) || "").trim().slice(0, 80),
    email: String((a && a.email) || "").trim().toLowerCase().slice(0, 120)
  })).filter((a) => a.name || a.email).map((a) => ({ name: a.name || a.email, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email) ? a.email : "" }));
  return {
    title, start, end, tz: validTz(b.tz) || tzFallback || "UTC", attendees,
    location: String(b.location || "").trim().slice(0, 300), notes: String(b.notes || "").trim().slice(0, 2000)
  };
}

async function rememberContacts(env, user, attendees) {
  const withEmail = attendees.filter((a) => a.email && a.name && a.name !== a.email);
  if (!withEmail.length) return;
  await env.BLACK_DB.batch(withEmail.map((a) => env.BLACK_DB.prepare(
    `INSERT INTO cal_contacts (user_id, name, email, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`
  ).bind(user.id, a.name.toLowerCase(), a.email, Date.now())));
}

async function createEvent(request, env, user) {
  const s = await settings(env, user);
  const e = cleanEvent(await body(request), s.tz);
  const id = crypto.randomUUID(), now = Date.now();
  await env.BLACK_DB.prepare(`INSERT INTO cal_events (id, user_id, title, start_ms, end_ms, tz, attendees, location, notes, status, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 0, ?, ?)`)
    .bind(id, user.id, e.title, e.start, e.end, e.tz, JSON.stringify(e.attendees), e.location, e.notes, now, now).run();
  await rememberContacts(env, user, e.attendees);
  return json({ event: { id, source: "black", status: "confirmed", ...e } }, 201);
}

async function ownEvent(env, user, id) {
  const r = await env.BLACK_DB.prepare(`SELECT * FROM cal_events WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
  if (!r) throw Object.assign(new Error("That meeting wasn't found in your BLACK calendar."), { status: 404, code: "NOT_FOUND" });
  return r;
}

async function updateEvent(request, env, user, id) {
  const cur = rowToEvent(await ownEvent(env, user, id));
  const b = await body(request);
  const e = cleanEvent({ ...cur, ...b }, cur.tz);
  await env.BLACK_DB.prepare(`UPDATE cal_events SET title = ?, start_ms = ?, end_ms = ?, tz = ?, attendees = ?, location = ?, notes = ?, status = 'confirmed', seq = seq + 1, updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(e.title, e.start, e.end, e.tz, JSON.stringify(e.attendees), e.location, e.notes, Date.now(), id, user.id).run();
  await rememberContacts(env, user, e.attendees);
  return json({ event: { id, source: "black", status: "confirmed", ...e } });
}

async function cancelEvent(env, user, id) {
  await ownEvent(env, user, id);
  await env.BLACK_DB.prepare(`UPDATE cal_events SET status = 'cancelled', seq = seq + 1, updated_at = ? WHERE id = ? AND user_id = ?`).bind(Date.now(), id, user.id).run();
  return json({ ok: true, id });
}

// ---------------- understanding a scheduling brief ----------------
async function propose(request, env, user) {
  const b = await body(request);
  const text = String(b.text || "").trim().slice(0, 1000);
  if (!text) throw bad("Say what you'd like to schedule.");
  const s = await settings(env, user);
  const tz = validTz(b.tz) || s.tz || "UTC";
  if (!env.ANTHROPIC_API_KEY) throw Object.assign(new Error("Claude isn't configured on the gateway."), { status: 503, code: "NOT_CONFIGURED" });

  const now = Date.now();
  const horizon = await allBusy(env, user, now - DAY, now + 30 * DAY);
  const contacts = ((await env.BLACK_DB.prepare(`SELECT name, email FROM cal_contacts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`).bind(user.id).all()).results || []);
  const upcoming = horizon.filter((e) => e.source === "black").slice(0, 25)
    .map((e) => `${e.id} | ${e.title} | ${localIso(e.start, tz)}`).join("\n") || "(none)";

  const sys = "You turn a scheduling request into JSON for a calendar. Reply with ONLY a JSON object, no prose. Schema: " +
    "{\"action\":\"create\"|\"reschedule\"|\"cancel\"|\"none\",\"title\":string,\"date\":\"YYYY-MM-DD\",\"time\":\"HH:MM\" (24h, local),\"durationMin\":number," +
    "\"attendees\":[{\"name\":string,\"email\":string}],\"location\":string,\"notes\":string,\"eventId\":string|null,\"question\":string|null}. " +
    "Resolve relative dates (tomorrow, Tuesday, next week) against the current local time given. Default duration 30 minutes; default time 10:00 if none given. " +
    "For reschedule or cancel, pick eventId from the upcoming BLACK events list. Use 'none' with a short question if the request is not about scheduling or is too unclear.";
  const prompt = `Current local time: ${localIso(now, tz)} (${tz}, ${new Date(now).toLocaleDateString("en-US", { weekday: "long", timeZone: tz })})\n` +
    `Upcoming BLACK events (id | title | local start):\n${upcoming}\n` +
    `Known contacts: ${contacts.map((c) => c.name + " <" + c.email + ">").join(", ") || "(none)"}\n\nRequest: ${text}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL_FAST || "claude-haiku-5-5", max_tokens: 600, system: sys, messages: [{ role: "user", content: prompt }],
      output_config: { effort: "low" }, ...(/haiku/i.test(env.ANTHROPIC_MODEL_FAST || "claude-haiku-5-5") ? { thinking: { type: "disabled" } } : {}) })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error("BLACK couldn't read that request right now."), { status: 502, code: "PARSE_FAILED" });
  const raw = ((j.content || []).find((c) => c.type === "text") || {}).text || "";
  const p = safeJson((raw.match(/\{[\s\S]*\}/) || [""])[0], null);
  if (!p || !p.action) throw Object.assign(new Error("BLACK couldn't understand that request. Try: \"Schedule a 30-minute call with Sam on Tuesday at 10am\"."), { status: 422, code: "UNCLEAR" });
  if (p.action === "none") return json({ action: "none", question: p.question || "What would you like to schedule, and when?" });

  // Fill attendee emails from known contacts.
  const known = new Map(contacts.map((c) => [c.name.toLowerCase(), c.email]));
  const attendees = (p.attendees || []).map((a) => ({ name: a.name || a.email || "", email: a.email || known.get(String(a.name || "").toLowerCase()) || "" })).filter((a) => a.name);
  const target = p.eventId ? horizon.find((e) => e.id === p.eventId && e.source === "black") : null;
  if ((p.action === "reschedule" || p.action === "cancel") && !target) {
    return json({ action: "none", question: "Which meeting do you mean? I couldn't find it in your BLACK calendar." });
  }
  if (p.action === "cancel") return json({ action: "cancel", tz, event: target });

  const dur = Math.max(5, Math.min(720, Number(p.durationMin) || (target ? (target.end - target.start) / 60000 : 30)));
  const [y, mo, d] = String(p.date || "").split("-").map(Number);
  const [h, mi] = String(p.time || "10:00").split(":").map(Number);
  if (!y || !mo || !d) return json({ action: "none", question: "Which day should it be?" });
  const start = zonedToUtc(y, mo, d, h || 0, mi || 0, 0, tz), end = start + dur * 60000;
  const busy = horizon.filter((e) => !target || e.id !== target.id);
  const conflicts = busy.filter((e) => e.start < end && e.end > start).map((e) => ({ title: e.title, start: e.start, end: e.end, source: e.source }));
  const proposal = {
    title: String(p.title || (target && target.title) || "Meeting").slice(0, 140), start, end, tz,
    attendees: attendees.length ? attendees : (target ? target.attendees : []),
    location: String(p.location || (target && target.location) || s.video_link || "").slice(0, 300), notes: String(p.notes || (target && target.notes) || "").slice(0, 2000)
  };
  return json({
    action: p.action === "reschedule" ? "reschedule" : "create", tz, eventId: target ? target.id : null, proposal,
    conflicts, alternatives: conflicts.length ? freeSlots(busy, start, dur, tz, 2) : [], past: start < now
  });
}

async function allBusy(env, user, from, to) {
  const [mine, linked] = await Promise.all([blackEvents(env, user, from, to), linkedEvents(env, user, from, to)]);
  return mine.concat(linked.events).filter((e) => !e.allDay).sort((a, b) => a.start - b.start);
}

// Next free slots after the wanted time, within 8:00–18:00 local, weekdays first day included.
function freeSlots(busy, wanted, durMin, tz, n) {
  const out = [], step = 30 * 60000, dur = durMin * 60000;
  let t = Math.ceil(Math.max(wanted, Date.now()) / step) * step;
  for (let i = 0; i < 14 * 48 && out.length < n; i++, t += step) {
    const l = localParts(t, tz), endL = localParts(t + dur, tz);
    if (l.hour < 8 || endL.hour > 18 || (endL.hour === 18 && endL.minute > 0) || l.day !== endL.day) continue;
    if (!busy.some((e) => e.start < t + dur && e.end > t)) out.push({ start: t, end: t + dur });
  }
  return out;
}

// ---------------- subscribe feed ----------------
async function feed(env, key) {
  if (!env.BLACK_DB || !/^[A-Za-z0-9]{24,}$/.test(key)) return new Response("Not found", { status: 404 });
  await ensureSchema(env);
  const u = await env.BLACK_DB.prepare(`SELECT user_id FROM cal_users WHERE feed_secret = ?`).bind(key).first();
  if (!u) return new Response("Not found", { status: 404 });
  const q = await env.BLACK_DB.prepare(`SELECT * FROM cal_events WHERE user_id = ? AND end_ms > ? ORDER BY start_ms LIMIT 1000`).bind(u.user_id, Date.now() - 60 * DAY).all();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GetServices.ai//BLACK Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:BLACK", "REFRESH-INTERVAL;VALUE=DURATION:PT15M"];
  (q.results || []).forEach((r) => {
    const e = rowToEvent(r);
    lines.push("BEGIN:VEVENT", "UID:" + e.id + "@black.getservices.ai", "SEQUENCE:" + (r.seq || 0), "DTSTAMP:" + icsDate(r.updated_at || Date.now()),
      "DTSTART:" + icsDate(e.start), "DTEND:" + icsDate(e.end), "SUMMARY:" + icsText(e.title), "STATUS:" + (e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"));
    if (e.location) lines.push("LOCATION:" + icsText(e.location));
    const desc = [e.notes, e.attendees.length ? "With: " + e.attendees.map((a) => a.name + (a.email ? " <" + a.email + ">" : "")).join(", ") : ""].filter(Boolean).join("\n");
    if (desc) lines.push("DESCRIPTION:" + icsText(desc));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" } });
}
function icsDate(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function icsText(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function fold(line) { let out = "", s = line; while (s.length > 74) { out += s.slice(0, 74) + "\r\n "; s = s.slice(74); } return out + s; }

// ---------------- iCal import (Google / Outlook / Apple private address) ----------------
async function fetchIcal(url, strict) {
  const hit = icalCache.get(url);
  if (!strict && hit && Date.now() - hit.at < ICAL_CACHE_MS) return hit.events;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { accept: "text/calendar" }, signal: ctl.signal });
    if (!r.ok) throw new Error("the calendar answered " + r.status);
    const txt = await r.text();
    if (!/BEGIN:VCALENDAR/.test(txt)) throw new Error("that address isn't an iCal calendar");
    const events = parseIcal(txt.slice(0, 5000000));
    icalCache.set(url, { events, at: Date.now() });
    if (icalCache.size > 200) icalCache.delete(icalCache.keys().next().value);
    return events;
  } finally { clearTimeout(t); }
}

const WIN_TZ = {
  "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago", "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles", "GMT Standard Time": "Europe/London", "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris", "Pakistan Standard Time": "Asia/Karachi", "India Standard Time": "Asia/Kolkata",
  "Arabian Standard Time": "Asia/Dubai", "China Standard Time": "Asia/Shanghai", "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney", "UTC": "UTC"
};

function parseIcal(txt) {
  const lines = txt.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events = []; let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur && cur.start != null) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const left = line.slice(0, i), value = line.slice(i + 1);
    const [name, ...ps] = left.split(";");
    const prm = Object.fromEntries(ps.map((p) => { const k = p.indexOf("="); return [p.slice(0, k).toUpperCase(), p.slice(k + 1).replace(/^"|"$/g, "")]; }));
    switch (name.toUpperCase()) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.title = unesc(value); break;
      case "LOCATION": cur.location = unesc(value); break;
      case "STATUS": cur.status = value.toUpperCase(); break;
      case "RRULE": cur.rrule = value; break;
      case "DTSTART": { const t = icalTime(value, prm); cur.start = t.ms; cur.allDay = t.allDay; cur.tzid = t.tz; break; }
      case "DTEND": cur.end = icalTime(value, prm).ms; break;
      case "DURATION": cur.durMs = isoDuration(value); break;
      case "RECURRENCE-ID": cur.recurrenceId = icalTime(value, prm).ms; break;
      case "EXDATE": value.split(",").forEach((v) => cur.exdates.push(icalTime(v, prm).ms)); break;
    }
  }
  events.forEach((e) => {
    if (e.end == null) e.end = e.start + (e.durMs || (e.allDay ? DAY : 3600000));
    e.title = e.title || "(busy)";
  });
  return events.filter((e) => e.status !== "CANCELLED");
}

function icalTime(v, prm) {
  const m = String(v).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return { ms: NaN, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || prm.VALUE === "DATE") return { ms: Date.UTC(+y, +mo - 1, +d), allDay: true, tz: "UTC" };
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false, tz: "UTC" };
  const tz = validTz(prm.TZID) || validTz(WIN_TZ[prm.TZID]) || "UTC";
  return { ms: zonedToUtc(+y, +mo, +d, +h, +mi, +(s || 0), tz), allDay: false, tz };
}

function isoDuration(v) {
  const m = String(v).match(/^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  return ((+m[1] || 0) * 7 * DAY) + ((+m[2] || 0) * DAY) + ((+m[3] || 0) * 3600000) + ((+m[4] || 0) * 60000) + ((+m[5] || 0) * 1000);
}

// Expands recurring events (DAILY / WEEKLY with BYDAY / MONTHLY / YEARLY, INTERVAL, COUNT, UNTIL, EXDATE, moved instances).
function expand(events, from, to) {
  const moved = new Set(events.filter((e) => e.recurrenceId != null).map((e) => e.uid + "@" + e.recurrenceId));
  const out = [];
  const push = (e, start) => {
    const end = start + (e.end - e.start);
    // All-day events keep their calendar date (YYYY-MM-DD) so they don't shift with the viewer's time zone.
    const slack = e.allDay ? DAY : 0;
    if (end + slack > from && start - slack < to) out.push({ id: "ext:" + (e.uid || "") + ":" + start, source: "linked", title: e.title, start, end, allDay: !!e.allDay,
      date: e.allDay ? new Date(start).toISOString().slice(0, 10) : undefined, location: e.location || "", attendees: [] });
  };
  for (const e of events) {
    if (!isFinite(e.start)) continue;
    if (!e.rrule || e.recurrenceId != null) { push(e, e.start); continue; }
    const r = Object.fromEntries(e.rrule.split(";").map((kv) => kv.split("=")).map(([k, v]) => [String(k).toUpperCase(), v]));
    const freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || 0;
    const until = r.UNTIL ? icalTime(r.UNTIL, {}).ms : Infinity;
    const tz = e.tzid || "UTC", base = localParts(e.start, tz);
    const days = r.BYDAY ? r.BYDAY.split(",").map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(d.slice(-2))) : null;
    const ex = new Set(e.exdates);
    let n = 0;
    const baseDay = Date.UTC(base.year, base.month - 1, base.day);
    for (let i = 0; i < 4000; i++) {
      const dayUtc = baseDay + i * DAY, dd = new Date(dayUtc);
      const y = dd.getUTCFullYear(), mo = dd.getUTCMonth() + 1, d = dd.getUTCDate(), wd = dd.getUTCDay();
      let ok = false;
      if (freq === "DAILY") ok = i % interval === 0;
      else if (freq === "WEEKLY") ok = Math.floor((i + base.weekday) / 7) % interval === 0 && (days ? days.includes(wd) : wd === base.weekday);
      else if (freq === "MONTHLY") ok = d === base.day && ((y - base.year) * 12 + (mo - base.month)) % interval === 0;
      else if (freq === "YEARLY") ok = d === base.day && mo === base.month && (y - base.year) % interval === 0;
      else break;
      if (!ok) continue;
      const start = e.allDay ? dayUtc : zonedToUtc(y, mo, d, base.hour, base.minute, base.second, tz);
      if (start > until || start >= to) break;
      n++;
      if (count && n > count) break;
      if (ex.has(start) || moved.has(e.uid + "@" + start)) continue;
      push(e, start);
    }
  }
  return out;
}

// ---------------- time zones ----------------
function validTz(tz) {
  if (!tz || typeof tz !== "string") return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; }
}
const fmtCache = new Map();
function localParts(ms, tz) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); fmtCache.set(tz, f); }
  const p = {}; f.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  const off = (ms) => { const l = localParts(ms, tz); return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - ms; };
  let ts = guess - off(guess);
  const o2 = off(ts);
  if (guess - o2 !== ts) ts = guess - o2;
  return ts;
}
function localIso(ms, tz) {
  const l = localParts(ms, tz), p = (n) => String(n).padStart(2, "0");
  return `${l.year}-${p(l.month)}-${p(l.day)}T${p(l.hour)}:${p(l.minute)}`;
}

// ---------------- crypto (private iCal address at rest) ----------------
async function key(env) {
  if (!env.TOKEN_KEY) return null;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(env.TOKEN_KEY)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, text) {
  const k = await key(env);
  if (!k) throw Object.assign(new Error("Calendar linking isn't set up yet (TOKEN_KEY missing)."), { status: 503, code: "NOT_CONFIGURED" });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(text)));
  return "v1:" + b64(iv) + ":" + b64(ct);
}
async function unseal(env, stored) {
  const [v, iv, ct] = String(stored).split(":");
  if (v !== "v1") throw new Error("bad");
  const k = await key(env);
  if (!k) throw new Error("no key");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, k, unb64(ct)));
}
const b64 = (u8) => btoa(String.fromCharCode.apply(null, Array.from(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------------- helpers ----------------
function secret() { const a = crypto.getRandomValues(new Uint8Array(24)); return Array.from(a, (b) => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 56]).join(""); }
function unesc(s) { return String(s).replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"); }
function safeJson(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }
function num(v, d) { const n = Number(v); return v != null && v !== "" && isFinite(n) ? n : d; }
function bad(msg) { return Object.assign(new Error(msg), { status: 400, code: "BAD_REQUEST" }); }
async function body(request) { try { return await request.json(); } catch { return {}; } }
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
