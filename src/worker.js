const RULES = {
  duel: { size: 2, winners: 1, points: 3 },
  tournament: { size: 3, winners: 1, points: 2 },
  team: { size: 4, winners: 2, points: 1 },
};
const PIN_WINDOW_MS = 60 * 60 * 1000;
const MAX_PIN_FAILURES = 10;

const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const bad = (error) => json({ error }, 400);
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger))];

function withSecurityHeaders(response) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

async function pinMatches(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((v) => crypto.subtle.digest("SHA-256", enc.encode(v))));
  return crypto.subtle.timingSafeEqual(a, b);
}

// Returns an error response when the write must be refused, otherwise null.
async function authorize(request, env) {
  if (!env.EDIT_PIN) return json({ error: "Editing is disabled until a PIN is configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "Cross-site request blocked" }, 403);
  const type = request.headers.get("content-type") || "";
  if (request.method === "POST" && !type.startsWith("application/json")) return json({ error: "Expected JSON" }, 415);

  const ip = request.headers.get("cf-connecting-ip") || "local";
  const since = Date.now() - PIN_WINDOW_MS;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_failures (ip TEXT NOT NULL, at INTEGER NOT NULL)").run();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_failures WHERE ip = ? AND at > ?").bind(ip, since).first();
  if (n >= MAX_PIN_FAILURES) return json({ error: "Too many wrong PIN attempts, try again in an hour" }, 429);

  if (await pinMatches(request.headers.get("x-pin") || "", env.EDIT_PIN)) return null;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO auth_failures (ip, at) VALUES (?, ?)").bind(ip, Date.now()),
    env.DB.prepare("DELETE FROM auth_failures WHERE at < ?").bind(since),
  ]);
  return json({ error: "Wrong PIN" }, 401);
}

async function getState(env) {
  const [players, matches] = await env.DB.batch([
    env.DB.prepare("SELECT id, name FROM players ORDER BY id"),
    env.DB.prepare("SELECT id, type, players, winners, points, played_at FROM matches ORDER BY played_at, id"),
  ]);
  return json({
    players: players.results,
    matches: matches.results.map((m) => ({ ...m, players: JSON.parse(m.players), winners: JSON.parse(m.winners) })),
  });
}

async function addPlayer(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!name) return bad("Name is required");

  const exists = await env.DB.prepare("SELECT 1 FROM players WHERE name = ?").bind(name).first();
  if (exists) return json({ error: `${name} is already in the league` }, 409);

  const player = await env.DB.prepare("INSERT INTO players (name) VALUES (?) RETURNING id, name").bind(name).first();
  return json(player, 201);
}

async function deletePlayer(id, env) {
  const used = await env.DB.prepare("SELECT 1 FROM matches, json_each(matches.players) WHERE json_each.value = ? LIMIT 1")
    .bind(id)
    .first();
  if (used) return json({ error: "Players with recorded matches cannot be removed" }, 409);
  const { meta } = await env.DB.prepare("DELETE FROM players WHERE id = ?").bind(id).run();
  if (!meta.changes) return json({ error: "Player not found" }, 404);
  return new Response(null, { status: 204 });
}

async function addMatch(request, env) {
  const body = await request.json().catch(() => ({}));
  const rule = RULES[body.type];
  if (!rule) return bad("Unknown match type");

  const players = ids(body.players);
  const winners = ids(body.winners);
  if (players.length !== rule.size) return bad(`This match needs ${rule.size} players`);
  if (winners.length !== rule.winners || !winners.every((w) => players.includes(w))) {
    return bad(`Pick ${rule.winners} winner${rule.winners > 1 ? "s" : ""} from the players`);
  }

  const marks = players.map(() => "?").join(",");
  const { count } = await env.DB.prepare(`SELECT COUNT(*) AS count FROM players WHERE id IN (${marks})`)
    .bind(...players)
    .first();
  if (count !== players.length) return bad("Unknown player");

  const row = await env.DB.prepare(
    "INSERT INTO matches (type, players, winners, points) VALUES (?, ?, ?, ?) RETURNING id, type, points, played_at",
  )
    .bind(body.type, JSON.stringify(players), JSON.stringify(winners), rule.points)
    .first();
  return json({ ...row, players, winners }, 201);
}

async function deleteMatch(id, env) {
  const { meta } = await env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(id).run();
  if (!meta.changes) return json({ error: "Match not found" }, 404);
  return new Response(null, { status: 204 });
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

  const { method } = request;
  if (pathname === "/api/state" && method === "GET") return getState(env);
  if (method !== "POST" && method !== "DELETE") return json({ error: "Not found" }, 404);

  const denied = await authorize(request, env);
  if (denied) return denied;

  if (pathname === "/api/players" && method === "POST") return addPlayer(request, env);
  if (pathname === "/api/matches" && method === "POST") return addMatch(request, env);
  const target = pathname.match(/^\/api\/(players|matches)\/(\d+)$/);
  if (target && method === "DELETE") {
    const id = Number(target[2]);
    return target[1] === "players" ? deletePlayer(id, env) : deleteMatch(id, env);
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    return withSecurityHeaders(await route(request, env));
  },
};
