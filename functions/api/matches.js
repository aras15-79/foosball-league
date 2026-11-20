const RULES = {
  duel: { size: 2, winners: 1, points: 3 },
  tournament: { size: 3, winners: 1, points: 2 },
  team: { size: 4, winners: 2, points: 1 },
};

const bad = (error) => Response.json({ error }, { status: 400 });
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger))];

export async function onRequestPost({ request, env }) {
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
  return Response.json({ ...row, players, winners }, { status: 201 });
}
