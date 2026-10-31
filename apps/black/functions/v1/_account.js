/*
 * BLACK accounts + credits, shared by /v1/me/* and /v1/responses.
 * (Not a route: this file exports no onRequest handler.)
 *
 * Who you are comes from the GetServices (ATLAS) account — the same Google / email sign-in as ATLAS.
 * Credits live in BLACK's D1 database (binding BLACK_DB, table black_credits):
 *   - Every new account gets FREE_CREDITS (50) the first time it uses BLACK.
 *   - A brief costs COSTS[mode] and is charged only after it succeeds.
 *   - Testers (BLACK_TESTERS) have unlimited credits and are never charged.
 *
 * Cloudflare settings (Pages > black-edition > Settings):
 *   BLACK_DB        D1 binding (already used by the BLACK Calendar)
 *   BLACK_TESTERS   optional, comma-separated emails with unlimited credits.
 *                   Defaults to DEFAULT_TESTERS below when not set.
 *   FREE_CREDITS    optional, starting credits for new accounts (default 50)
 *   ATLAS_API_URL   optional, defaults to the live ATLAS API
 */

export const ATLAS_DEFAULT = "https://atlas-api-v2.python-tester.workers.dev";
export const DEFAULT_TESTERS = ["shaheenarifch@gmail.com", "talhachoudary537@gmail.com"];
export const COSTS = { fast: 1, smart: 1, deep: 2, executive: 3 };
const DEFAULT_FREE = 50;
const ME_CACHE_MS = 5 * 60 * 1000;
const meCache = new Map(); // token -> { user, at }

export const atlas = (env) => String(env.ATLAS_API_URL || ATLAS_DEFAULT).replace(/\/+$/, "");
const freeCredits = (env) => { const n = parseInt(env.FREE_CREDITS, 10); return n >= 0 ? n : DEFAULT_FREE; };

// Signed-in user from "Authorization: Bearer <ATLAS session token>", checked with ATLAS (cached 5 min).
export async function userFrom(request, env) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+([A-Za-z0-9_\-]{20,})$/);
  if (!m) return null;
  const token = m[1], hit = meCache.get(token);
  if (hit && Date.now() - hit.at < ME_CACHE_MS) return hit.user;
  const r = await fetch(atlas(env) + "/auth/me", { headers: { authorization: "Bearer " + token } }).catch(() => null);
  if (!r || !r.ok) { meCache.delete(token); return null; }
  const j = await r.json().catch(() => ({}));
  if (!j.authenticated || !j.user || !j.user.id) return null;
  const user = { id: String(j.user.id), email: String(j.user.email || "").trim().toLowerCase() };
  meCache.set(token, { user, at: Date.now() });
  if (meCache.size > 500) meCache.delete(meCache.keys().next().value);
  return user;
}

export function isTester(env, user) {
  if (!user || !user.email) return false;
  const list = String(env.BLACK_TESTERS || "").split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return (list.length ? list : DEFAULT_TESTERS).includes(user.email);
}

let creditsReady = false;
async function ensureCredits(env) {
  if (creditsReady) return;
  await env.BLACK_DB.batch([
    env.BLACK_DB.prepare(`CREATE TABLE IF NOT EXISTS black_credits (user_id TEXT PRIMARY KEY, email TEXT, balance INTEGER NOT NULL, granted INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER)`),
    env.BLACK_DB.prepare(`CREATE TABLE IF NOT EXISTS black_upgrade_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT, plan TEXT NOT NULL, note TEXT, created_at INTEGER)`)
  ]);
  creditsReady = true;
}

// The user's credit status: { unlimited, balance, granted, used, costs }.
// The first call for a new account grants the free starting credits.
export async function credits(env, user) {
  if (isTester(env, user)) return { unlimited: true, tester: true, balance: null, granted: null, used: null, costs: COSTS };
  if (!env.BLACK_DB) throw Object.assign(new Error("Credits aren't switched on yet (BLACK_DB is not connected)."), { status: 503, code: "CREDITS_NOT_CONFIGURED" });
  await ensureCredits(env);
  const now = Date.now(), free = freeCredits(env);
  await env.BLACK_DB.prepare(`INSERT OR IGNORE INTO black_credits (user_id, email, balance, granted, used, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`)
    .bind(user.id, user.email, free, free, now, now).run();
  const r = await env.BLACK_DB.prepare(`SELECT balance, granted, used FROM black_credits WHERE user_id = ?`).bind(user.id).first();
  return { unlimited: false, tester: false, balance: r ? r.balance : 0, granted: r ? r.granted : free, used: r ? r.used : 0, costs: COSTS };
}

// Charges a finished brief. Never goes below zero. Testers are not charged.
export async function charge(env, user, mode) {
  if (isTester(env, user)) return { unlimited: true, tester: true, balance: null, charged: 0 };
  const cost = COSTS[mode] || 1;
  await ensureCredits(env);
  await env.BLACK_DB.prepare(`UPDATE black_credits SET balance = MAX(0, balance - ?), used = used + ?, updated_at = ? WHERE user_id = ?`)
    .bind(cost, cost, Date.now(), user.id).run();
  const r = await env.BLACK_DB.prepare(`SELECT balance FROM black_credits WHERE user_id = ?`).bind(user.id).first();
  return { unlimited: false, tester: false, balance: r ? r.balance : 0, charged: cost };
}

// "Choose plan" while billing isn't connected: the request is saved so it can be activated by hand.
export async function upgradeRequest(env, user, plan, note) {
  const p = ["starter", "pro", "enterprise"].includes(plan) ? plan : null;
  if (!p) throw Object.assign(new Error("Choose Starter, Pro or Enterprise."), { status: 400, code: "BAD_REQUEST" });
  if (!env.BLACK_DB) throw Object.assign(new Error("Upgrade requests aren't switched on yet (BLACK_DB is not connected)."), { status: 503, code: "CREDITS_NOT_CONFIGURED" });
  await ensureCredits(env);
  const id = crypto.randomUUID();
  await env.BLACK_DB.prepare(`INSERT INTO black_upgrade_requests (id, user_id, email, plan, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, user.id, user.email, p, String(note || "").slice(0, 500), Date.now()).run();
  return { ok: true, id, plan: p };
}
