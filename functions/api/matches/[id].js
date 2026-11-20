export async function onRequestDelete({ params, env }) {
  const { meta } = await env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(Number(params.id)).run();
  if (!meta.changes) return Response.json({ error: "Match not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
