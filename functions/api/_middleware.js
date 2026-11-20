// Writes require the EDIT_PIN secret when one is configured.
export async function onRequest({ request, env, next }) {
  if (request.method !== "GET" && env.EDIT_PIN && request.headers.get("x-pin") !== env.EDIT_PIN) {
    return Response.json({ error: "Wrong PIN" }, { status: 401 });
  }
  return next();
}
