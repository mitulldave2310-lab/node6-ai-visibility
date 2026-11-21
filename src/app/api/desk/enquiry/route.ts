// POST /api/desk/enquiry { name, email, website, message, consent } -> researched, drafted, sent to n8n for approval
import { fetchSite, InvalidUrlError, normalizeUrl } from "@/lib/audit/fetch-site";
import { createDeskAI } from "@/lib/desk/claude";
import { runDesk } from "@/lib/desk/engine";
import { claudeConfigured, fail, rateLimited } from "@/lib/desk/http";
import { forwardEnquiry, toPayload } from "@/lib/n8n/desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return Response.json({ error: "Open the form on this website." }, { status: 403 });
  if (!claudeConfigured()) return Response.json({ error: "Enquiries are paused while the server is set up. Please email node6 Labs directly." }, { status: 503 });
  if (rateLimited(req, 5)) return Response.json({ error: "Too many enquiries from this connection. Try again in ten minutes." }, { status: 429 });
  const b = await req.json().catch(() => null);
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 100) : "";
  const email = typeof b?.email === "string" ? b.email.trim().slice(0, 254) : "";
  const message = typeof b?.message === "string" ? b.message.trim().slice(0, 2000) : "";
  if (!name || !EMAIL.test(email) || message.length < 15 || b?.consent !== true)
    return Response.json({ error: "Add your name, a work email, a few words about what you need, and tick the consent box." }, { status: 400 });
  try {
    if (typeof b?.website !== "string" || !b.website.trim()) throw new InvalidUrlError("Add your company website so we can read up before replying.");
    const url = normalizeUrl(b.website);
    const result = await runDesk({ mode: "enquiry", url, enquiry: message, contactName: name }, { fetchSite, ai: createDeskAI() });
    const reference = "E-" + Date.now().toString(36).toUpperCase();
    const forwarded = await forwardEnquiry(toPayload(reference, { name, email, message }, result));
    if (!forwarded && process.env.DESK_DEBUG !== "1")
      return Response.json({ error: "We read your enquiry but could not pass it to the team. Please email node6 Labs directly." }, { status: 502 });
    return Response.json({ ok: true, reference, forwarded, ...(process.env.DESK_DEBUG === "1" ? { debug: result } : {}) });
  } catch (e) { return fail(e); }
}
