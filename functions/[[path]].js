// Cloudflare Pages -> Worker internal service binding
export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  if (pathname !== '/health' && !pathname.startsWith('/api/')) return context.next();
  if (!context.env.SAFEPASS_API) return Response.json({error:'SAFEPASS_API binding missing'}, {status:503});
  return context.env.SAFEPASS_API.fetch(context.request);
}
