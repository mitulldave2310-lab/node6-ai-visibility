// Shared request handling for the Lead Desk routes.
import { InvalidUrlError } from "@/lib/audit/fetch-site";

const hits = new Map<string, number[]>();

/** Best-effort per-instance limit so a public demo can't run up the Claude bill. */
export function rateLimited(req: Request, max = 8, windowMs = 10 * 60_000): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < windowMs);
  recent.push(now); hits.set(ip, recent);
  return recent.length > max;
}

export function claudeConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

export function fail(e: unknown) {
  if (e instanceof InvalidUrlError) return Response.json({ error: e.message }, { status: 400 });
  const code = e instanceof Error ? `${(e as NodeJS.ErrnoException).code ?? ""} ${e.message}` : "";
  if (/ENOTFOUND|EAI_AGAIN|ENODATA|ESERVFAIL|EAI_NONAME|EBUSY/.test(code))
    return Response.json({ error: "We couldn't find that website. Check the spelling." }, { status: 422 });
  console.error("desk run failed", e);
  return Response.json({ error: "The research step failed. Try again in a minute." }, { status: 502 });
}
