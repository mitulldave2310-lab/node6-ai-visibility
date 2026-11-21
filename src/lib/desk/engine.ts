// Orchestrates one Lead Desk run: fetch and audit the site, research it, let Claude decide,
// apply the guardrails, then write a draft that must pass the copy check.
import type { AuditInput } from "@/lib/audit/analyze";
import { buildReport } from "@/lib/audit/report";
import type { DeskAI } from "./claude";
import { SERVICE_LABELS } from "./constants";
import { applyGuardrails, checkCopy, type CopyCheck, type Mode, type Sources, type Verdict } from "./guardrails";
import type { Decision, Draft } from "./schema";

export interface DeskRequest {
  mode: Mode;
  url: string;            // already normalised
  company?: string;
  enquiry?: string;
  contactName?: string;
}

export interface DeskResult {
  mode: Mode;
  url: string;
  company: string;
  audit: { earned: number; possible: number; verified: number };
  decision: Decision & { service_label: string };
  verdict: Verdict;
  draft: (Draft & { check: CopyCheck; attempts: number }) | null;
  research: { searched: boolean; sources: number; note: string };
  steps: { name: string; ms: number }[];
  author: "Claude";
}

export interface DeskDeps { fetchSite(url: string): Promise<AuditInput>; ai: DeskAI }

export function buildSources(input: AuditInput, report: ReturnType<typeof buildReport>, enquiry: string): Sources {
  const page = input.home && "body" in input.home ? input.home.body : "";
  const pick = (re: RegExp) => (page.match(re)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const site = [pick(/<title[^>]*>([\s\S]*?)<\/title>/i), pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i), text.slice(0, 6000)]
    .filter(Boolean).join("\n");
  const audit: Record<string, string> = {};
  for (const c of report.checks) if (c.known) audit[c.id] = `${c.name}: ${c.detail}`;
  const siteUp = report.checks.some(c => c.id === "site_loads" && c.known && c.earned > 0) || text.length > 200;
  return { site, enquiry: enquiry.trim(), audit, web: [], siteUp };
}

export async function runDesk(req: DeskRequest, deps: DeskDeps): Promise<DeskResult> {
  const steps: DeskResult["steps"] = [];
  const time = async <T>(name: string, fn: () => Promise<T>) => {
    const t = Date.now(); try { return await fn(); } finally { steps.push({ name, ms: Date.now() - t }); }
  };
  const company = (req.company ?? "").trim();
  const input = await time("Read website", () => deps.fetchSite(req.url));
  const report = buildReport(input);
  const sources = buildSources(input, report, req.enquiry ?? "");

  let notes = ""; let note = "";
  try {
    const r = await time("Web research", () => deps.ai.research(company, req.url));
    notes = r.notes; sources.web = r.web;
    if (!r.web.length) note = "Web research found no citable sources.";
  } catch {
    note = "Web research was unavailable, so the decision uses the website and audit only.";
  }

  const decision = await time("Claude decision", () => deps.ai.decide({ mode: req.mode, company, url: req.url, sources, notes }));
  const verdict = applyGuardrails(decision, sources, req.mode);

  let draft: DeskResult["draft"] = null;
  const shouldWrite = req.mode === "enquiry" ? verdict.route !== "manual_review" || sources.enquiry.length > 0 : verdict.route === "draft";
  if (shouldWrite) {
    let d = await time("Draft", () => deps.ai.write({ mode: req.mode, company, decision, verdict, sources, contactName: req.contactName }));
    let check = checkCopy(d, verdict, req.mode, sources);
    let attempts = 1;
    if (!check.pass) {
      d = await time("Redraft", () => deps.ai.write({ mode: req.mode, company, decision, verdict, sources, contactName: req.contactName, fix: check.problems }));
      check = checkCopy(d, verdict, req.mode, sources);
      attempts = 2;
    }
    draft = { ...d, check, attempts };
    if (!check.pass) verdict.overrides.push("The draft still failed the copy check after one rewrite, so it needs a person's edit.");
  }

  return {
    mode: req.mode, url: req.url, company,
    audit: { earned: report.earned, possible: report.possible, verified: report.checks.filter(c => c.known).length },
    decision: { ...decision, service_label: SERVICE_LABELS[decision.service] },
    verdict, draft,
    research: { searched: !note.startsWith("Web research was unavailable"), sources: sources.web.length, note },
    steps, author: "Claude",
  };
}
