// POST /api/audit  { "url": "example.com" }  -> scored audit JSON
// GET  /api/audit?url=example.com            -> same, handy for curl and demos
import { NextResponse } from "next/server";
import { analyze } from "@/lib/audit/analyze";
import { fetchSite, InvalidUrlError, normalizeUrl } from "@/lib/audit/fetch-site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function runAudit(input: unknown) {
  if (typeof input !== "string") {
    return NextResponse.json({ error: "Send a url, e.g. { \"url\": \"example.com\" }" }, { status: 400 });
  }
  try {
    const base = normalizeUrl(input);
    const started = Date.now();
    const result = analyze(await fetchSite(base));
    return NextResponse.json({ ...result, audited_at: new Date().toISOString(), took_ms: Date.now() - started });
  } catch (e) {
    if (e instanceof InvalidUrlError) return NextResponse.json({ error: e.message }, { status: 400 });
    // DNS failure on the first lookup means the domain doesn't exist.
    // Node puts the reason in e.code; the message wording differs between local and Vercel.
    const code = e instanceof Error ? `${(e as NodeJS.ErrnoException).code ?? ""} ${e.message}` : "";
    if (/ENOTFOUND|EAI_AGAIN|ENODATA|ESERVFAIL|EAI_NONAME/.test(code)) {
      return NextResponse.json({ error: "We couldn't find that website. Check the spelling." }, { status: 422 });
    }
    console.error("audit failed", e);
    return NextResponse.json({ error: "The audit failed. Try again in a minute." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return runAudit(body?.url);
}

export async function GET(req: Request) {
  return runAudit(new URL(req.url).searchParams.get("url") ?? undefined);
}
