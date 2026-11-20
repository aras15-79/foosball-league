export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!name) return Response.json({ error: "Name is required" }, { status: 400 });

  const exists = await env.DB.prepare("SELECT 1 FROM players WHERE name = ?").bind(name).first();
  if (exists) return Response.json({ error: `${name} is already in the league` }, { status: 409 });

  const player = await env.DB.prepare("INSERT INTO players (name) VALUES (?) RETURNING id, name").bind(name).first();
  return Response.json(player, { status: 201 });
}
