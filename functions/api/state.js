export async function onRequestGet({ env }) {
  const [players, matches] = await env.DB.batch([
    env.DB.prepare("SELECT id, name FROM players ORDER BY id"),
    env.DB.prepare("SELECT id, type, players, winners, points, played_at FROM matches ORDER BY played_at, id"),
  ]);
  return Response.json(
    {
      players: players.results,
      matches: matches.results.map((m) => ({ ...m, players: JSON.parse(m.players), winners: JSON.parse(m.winners) })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
