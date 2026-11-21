import { buildReport, explain, sampleInput } from "@/lib/audit/report";
import { fetchSite, normalizeUrl, InvalidUrlError } from "@/lib/audit/fetch-site";
export const maxDuration = 60;
export async function POST(req: Request) {
  const body = await req.json().catch(()=>null);
  if (body?.sample === true) return Response.json({...buildReport(sampleInput()),sample:true});
  try {
    if (typeof body?.url !== "string") throw new InvalidUrlError("Enter a public website address.");
    const url = normalizeUrl(body.url);
    if (new URL(url).port) throw new InvalidUrlError("Use the public website address without a custom port.");
    return Response.json({...await explain(buildReport(await fetchSite(url))), directIntake:!!(process.env.N8N_WEBHOOK_URL && process.env.N8N_WEBHOOK_TOKEN)});
  } catch (e) {
    return Response.json({error:e instanceof InvalidUrlError ? e.message : "Could not reach this domain. Check its spelling or explore the sample report."},{status:e instanceof InvalidUrlError?400:422});
  }
}

