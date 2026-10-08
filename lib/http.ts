/** Errors go to the server log with their real text; the browser only gets a short code. */
export function fail(code: string, status: number, err?: unknown): Response {
  if (err) console.error(`[${code}]`, err);
  return Response.json({ error: code }, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** The caller's address as Vercel reports it, for slowing down guessing. */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || "local";
}
