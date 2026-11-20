const RULES = {
  duel: { size: 2, winners: 1, points: 3 },
  tournament: { size: 3, winners: 1, points: 2 },
  team: { size: 4, winners: 2, points: 1 },
};

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const bad = (error) => json({ error }, 400);
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger))];

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

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const { method } = request;
    if (method !== "GET" && env.EDIT_PIN && request.headers.get("x-pin") !== env.EDIT_PIN) {
      return json({ error: "Wrong PIN" }, 401);
    }

    if (pathname === "/api/state" && method === "GET") return getState(env);
    if (pathname === "/api/players" && method === "POST") return addPlayer(request, env);
    if (pathname === "/api/matches" && method === "POST") return addMatch(request, env);
    const del = pathname.match(/^\/api\/matches\/(\d+)$/);
    if (del && method === "DELETE") return deleteMatch(Number(del[1]), env);
    return json({ error: "Not found" }, 404);
  },
};
