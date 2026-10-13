export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (
    url.pathname !== "/health" &&
    !url.pathname.startsWith("/api/")
  ) {
    return context.next();
  }

  if (!context.env.SAFEPASS_API) {
    return Response.json(
      { error: "Service binding missing" },
      { status: 503 }
    );
  }

  return context.env.SAFEPASS_API.fetch(context.request);
}
