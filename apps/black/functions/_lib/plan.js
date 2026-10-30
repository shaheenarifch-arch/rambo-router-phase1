/*
 * BLACK plans on the server: who is signed in, which BLACK plan they have, and how many
 * briefs of each kind are left this billing period. Used by the gateway (/v1/responses)
 * and the account API (/v1/me/plan). Not a route itself (no onRequest exports).
 *
 * Plans and Stripe billing live in ATLAS (src/black-billing.js); this file only asks ATLAS
 * GET /api/black/plan with the user's own GetServices session and counts usage here.
 *
 * Buckets: "quick" = Fast + Smart briefs, "deep", "executive". Counts are kept per billing
 * period in BLACK_DB (black_usage) and reserved before a brief runs, then given back if
 * every engine fails, so a failed brief never uses up the allowance.
 */

const ATLAS_DEFAULT = "https://atlas-api-v2.python-tester.workers.dev";
const PLAN_TTL_MS = 60 * 1000;
const USER_TTL_MS = 5 * 60 * 1000;
const planCache = new Map(); // token -> { plan, at }
const userCache = new Map(); // token -> { user, at }

export const atlas = (env) => String(env.ATLAS_API_URL || ATLAS_DEFAULT).replace(/\/+$/, "");
export const BUCKETS = ["quick", "deep", "executive"];
export const bucketFor = (mode) => (mode === "executive" ? "executive" : mode === "deep" ? "deep" : "quick");

export function bearer(request) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+([A-Za-z0-9_\-]{20,})$/);
  return m ? m[1] : null;
}

function remember(map, token, key, value) {
  map.set(token, { [key]: value, at: Date.now() });
  if (map.size > 500) map.delete(map.keys().next().value);
}

export async function signedInUser(env, token) {
  const hit = userCache.get(token);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.user;
  const r = await fetch(atlas(env) + "/auth/me", { headers: { authorization: "Bearer " + token } });
  if (r.status === 401 || r.status === 403) { userCache.delete(token); return null; }
  if (!r.ok) throw new Error("ATLAS /auth/me " + r.status);
  const j = await r.json().catch(() => ({}));
  if (!j.authenticated || !j.user || !j.user.id) { userCache.delete(token); return null; }
  const user = { id: String(j.user.id), email: j.user.email || "" };
  remember(userCache, token, "user", user);
  return user;
}

// The user's BLACK plan from ATLAS. Cached briefly; an inactive plan is always re-checked,
// so a brief sent right after checkout sees the new plan.
export async function blackPlan(env, token, fresh = false) {
  const hit = planCache.get(token);
  if (!fresh && hit && hit.plan.active && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
  const r = await fetch(atlas(env) + "/api/black/plan", { headers: { authorization: "Bearer " + token } });
  if (r.status === 401 || r.status === 403) { planCache.delete(token); return null; }
  if (!r.ok) throw new Error("ATLAS /api/black/plan " + r.status);
  const j = await r.json().catch(() => ({}));
  const plan = j.black || { active: false };
  remember(planCache, token, "plan", plan);
  return plan;
}

// Usage resets with each billing period (from Stripe); without one, each calendar month.
export function periodKey(plan, now = new Date()) {
  return (plan && plan.period_start) || now.toISOString().slice(0, 7);
}

let usageReady = false;
async function ensureUsage(env) {
  if (usageReady) return;
  await env.BLACK_DB.prepare(`CREATE TABLE IF NOT EXISTS black_usage (user_id TEXT NOT NULL, period TEXT NOT NULL, bucket TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, updated_at INTEGER, PRIMARY KEY (user_id, period, bucket))`).run();
  usageReady = true;
}

export async function usageFor(env, userId, period) {
  const out = { quick: 0, deep: 0, executive: 0 };
  if (!env.BLACK_DB) return out;
  await ensureUsage(env);
  const q = await env.BLACK_DB.prepare(`SELECT bucket, used FROM black_usage WHERE user_id = ? AND period = ?`).bind(userId, period).all();
  (q.results || []).forEach((r) => { if (r.bucket in out) out[r.bucket] = Number(r.used) || 0; });
  return out;
}

// Takes one brief from the allowance if any is left. Atomic: two briefs sent at once
// can't both take the last one.
async function reserve(env, userId, period, bucket, limit) {
  if (!(limit > 0)) return false;
  const r = await env.BLACK_DB.prepare(
    `INSERT INTO black_usage (user_id, period, bucket, used, updated_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(user_id, period, bucket) DO UPDATE SET used = used + 1, updated_at = excluded.updated_at WHERE used < ?`
  ).bind(userId, period, bucket, Date.now(), limit).run();
  return ((r && r.meta && r.meta.changes) || 0) > 0;
}

async function giveBack(env, userId, period, bucket) {
  await env.BLACK_DB.prepare(`UPDATE black_usage SET used = MAX(used - 1, 0), updated_at = ? WHERE user_id = ? AND period = ? AND bucket = ?`)
    .bind(Date.now(), userId, period, bucket).run();
}

function reply(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

// Checks a brief before any engine is called. Returns { response } to send back as is, or
// { user, plan, bucket, release } where release() gives the brief back if it fails.
export async function gate(request, env, mode) {
  const token = bearer(request);
  const signIn = () => ({ response: reply({ error: "SIGN_IN_REQUIRED", detail: "Sign in with your GetServices account to get live answers." }, 401) });
  if (!token) return signIn();
  let user, plan;
  try { [user, plan] = await Promise.all([signedInUser(env, token), blackPlan(env, token)]); }
  catch (e) { return { response: reply({ error: "PLAN_CHECK_FAILED", detail: "BLACK couldn't check your plan just now. Try again in a moment." }, 503) }; }
  if (!user || !plan) return signIn();
  if (!plan.active) return { response: reply({ error: "PLAN_REQUIRED", detail: "Start your 7-day free trial to get live answers.", black: plan }, 402) };
  const bucket = bucketFor(mode);
  const none = { user, plan, bucket, release: async () => {} };
  if (plan.unlimited) return none;
  if (!env.BLACK_DB) return { response: reply({ error: "USAGE_NOT_CONFIGURED", detail: "BLACK's usage store isn't set up yet (BLACK_DB binding)." }, 503) };
  await ensureUsage(env);
  const period = periodKey(plan);
  const limit = Number((plan.allowance || {})[bucket]) || 0;
  if (!(await reserve(env, user.id, period, bucket, limit))) {
    const used = (await usageFor(env, user.id, period))[bucket];
    return { response: reply({ error: "ALLOWANCE_USED", bucket, used, limit, period_end: plan.period_end || null, black: plan }, 402) };
  }
  let given = false;
  return {
    user, plan, bucket,
    release: async () => { if (given) return; given = true; await giveBack(env, user.id, period, bucket).catch(() => {}); }
  };
}

// For the console's Plan & billing panel: plan, usage this period, and when it resets.
export async function planSummary(env, token) {
  const [user, plan] = await Promise.all([signedInUser(env, token), blackPlan(env, token, true)]);
  if (!user || !plan) return null;
  const period = periodKey(plan);
  const usage = plan.active && !plan.unlimited ? await usageFor(env, user.id, period) : { quick: 0, deep: 0, executive: 0 };
  return { black: plan, usage, period };
}

// Test hook: forget cached plans and users.
export function _resetCaches() { planCache.clear(); userCache.clear(); usageReady = false; }
