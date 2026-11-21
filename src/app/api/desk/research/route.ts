// POST /api/desk/research { website, company? } -> decision card + first-touch draft (never sent)
import { fetchSite, InvalidUrlError, normalizeUrl } from "@/lib/audit/fetch-site";
import { createDeskAI } from "@/lib/desk/claude";
import { runDesk } from "@/lib/desk/engine";
import { claudeConfigured, fail, rateLimited } from "@/lib/desk/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!claudeConfigured()) return Response.json({ error: "Claude is not configured on this server yet." }, { status: 503 });
  if (rateLimited(req)) return Response.json({ error: "Too many runs from this connection. Try again in ten minutes." }, { status: 429 });
  const body = await req.json().catch(() => null);
  try {
    if (typeof body?.website !== "string" || !body.website.trim()) throw new InvalidUrlError("Enter the company's website, e.g. company.com");
    const company = typeof body.company === "string" ? body.company.slice(0, 120) : "";
    const url = normalizeUrl(body.website);
    const result = await runDesk({ mode: "outbound", url, company }, { fetchSite, ai: createDeskAI() });
    return Response.json(result);
  } catch (e) { return fail(e); }
}
