import { normalizeUrl } from "@/lib/audit/fetch-site";
export async function POST(req:Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return Response.json({error:"Open the form on this website."},{status:403});
  const url = process.env.N8N_WEBHOOK_URL;
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!url || !token) return Response.json({error:"Direct intake is unavailable."},{status:503});
  const b = await req.json().catch(()=>null);
  if (!b || typeof b.name !== "string" || !b.name.trim() || b.name.length>100 || typeof b.email!=="string" || b.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) || b.consent!==true)
    return Response.json({error:"Enter your name, email and consent."},{status:400});
  let website;
  try { website = normalizeUrl(b.website); } catch { return Response.json({error:"Check the website address."},{status:400}); }
  try {
    const r = await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json","X-Intake-Token":token},body:JSON.stringify({"Your name":b.name.trim(),"Work email":b.email.trim(),Website:website,Consent:true})});
    if (r.ok) return Response.json({ok:true});
  } catch {}
  return Response.json({error:"We could not confirm delivery. Please check with node6 Labs before sending again."},{status:502});
}
