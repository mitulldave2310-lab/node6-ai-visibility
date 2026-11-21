// Rules that sit after Claude. Claude suggests; this file decides what is allowed through.
// Pure functions only, so every rule is unit-tested.
import { BANNED_PHRASES, LIMITS } from "./constants";
import type { Decision, Draft } from "./schema";

export interface WebSource { id: string; url: string; title: string; quote: string }

export interface Sources {
  site: string;              // homepage title, description, h1 and visible text
  enquiry: string;           // the visitor's own words ("" for outbound)
  audit: Record<string, string>; // check id -> "name: detail"
  web: WebSource[];          // cited snippets from web research
  siteUp: boolean;
}

export type Mode = "outbound" | "enquiry";

export interface CheckedSignal {
  label: string; evidence: string; source: string;
  verified: boolean; url?: string;
}

export type Route = "draft" | "ask_for_info" | "manual_review" | "disqualify";

export interface Verdict {
  route: Route;
  tier: Decision["fit_tier"];
  score: number;
  signals: CheckedSignal[];
  roles: string[];
  overrides: string[];  // plain-language notes on every rule that changed Claude's call
}

export const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/[–—-]/g, " ")
    .replace(/[^\p{L}\p{N}%$.,:/ ]/gu, " ").replace(/\s+/g, " ").trim();

/** True when the quote really appears in the source Claude named. */
export function verifySignal(evidence: string, source: string, src: Sources): { ok: boolean; url?: string } {
  const quote = norm(evidence);
  if (quote.length < 4) return { ok: false };
  const inText = (text: string) => norm(text).includes(quote);
  if (source === "site") return { ok: inText(src.site) };
  if (source === "enquiry") return { ok: !!src.enquiry && inText(src.enquiry) };
  if (source.startsWith("audit:")) {
    const detail = src.audit[source.slice(6)];
    return { ok: !!detail && inText(detail) };
  }
  if (source.startsWith("web:")) {
    const hit = src.web.find(w => w.id === source);
    return hit ? { ok: inText(hit.quote) || inText(hit.title), url: hit.url } : { ok: false };
  }
  return { ok: false };
}

export function applyGuardrails(d: Decision, src: Sources, mode: Mode): Verdict {
  const overrides: string[] = [];
  const score = Math.max(0, Math.min(100, Math.round(Number(d.fit_score) || 0)));
  const signals = d.signals.slice(0, LIMITS.maxSignals).map(s => {
    const v = verifySignal(s.evidence, s.source, src);
    return { label: s.label, evidence: s.evidence, source: s.source, verified: v.ok, url: v.url };
  });
  const dropped = signals.filter(s => !s.verified).length;
  if (dropped) overrides.push(`${dropped} signal${dropped > 1 ? "s" : ""} could not be matched to the source and ${dropped > 1 ? "were" : "was"} marked unverified.`);
  const verified = signals.filter(s => s.verified);

  const roles = d.buyer_roles.slice(0, LIMITS.maxRoles).filter(r => r.trim() && !/\b(mr|mrs|ms|dr)\.?\s/i.test(r));

  let route: Route = ({ draft_first_touch: "draft", ask_for_info: "ask_for_info", manual_review: "manual_review", disqualify: "disqualify" } as const)[d.next_step];
  let tier = d.fit_tier;
  const set = (r: Route, why: string) => { if (route !== r) { overrides.push(why); route = r; } };

  if (!src.siteUp && !src.enquiry.trim() && !verified.some(s => s.source.startsWith("web:")))
    set("manual_review", "The website did not load and no web source could be verified, so there is nothing to judge.");
  if (verified.length === 0) set("manual_review", "No signal could be verified against a source, so a person should review it.");
  if (mode === "outbound") {
    if (route === "draft" && !(tier === "A" || tier === "B")) set("manual_review", `Fit tier ${tier} is below the bar for a first-touch draft (A or B).`);
    if (d.service === "none" && route !== "manual_review") { set("disqualify", "No node6 service fits, so no draft is written."); tier = "X"; }
  } else {
    // A real person wrote in. Never silently drop them: weak fits still get a polite reply for review.
    if (route === "disqualify") set("ask_for_info", "Enquiries are never dropped automatically. A short reply is drafted for a person to approve or reject.");
  }
  return { route, tier, score, signals, roles, overrides };
}

export interface CopyCheck { pass: boolean; problems: string[]; words: number }

/** Pre-send checks on any draft. Mirrors the gtm skill's copy checker rules that can be automated. */
export function checkCopy(draft: Draft, verdict: Verdict, mode: Mode, src: Sources): CopyCheck {
  const problems: string[] = [];
  const text = `${draft.subject}\n${draft.body}`;
  const words = draft.body.split(/\s+/).filter(Boolean).length;
  const limit = mode === "outbound" ? LIMITS.outboundWords : LIMITS.replyWords;
  if (words > limit) problems.push(`Body is ${words} words. Keep it under ${limit}.`);
  if (/[—–]/.test(text)) problems.push("Contains a long dash. Use a comma or full stop.");
  if (/\[[^\]]+\]|\{\{|<[a-z]+>/i.test(text)) problems.push("Contains a placeholder or markup.");
  const lower = text.toLowerCase();
  for (const p of BANNED_PHRASES) if (lower.includes(p)) problems.push(`Uses "${p}".`);
  const verifiedIds = new Set(verdict.signals.filter(s => s.verified).map(s => s.source));
  const used = draft.facts_used.filter(id => verifiedIds.has(id));
  if (used.length === 0) problems.push("Does not rely on any verified signal.");
  // Every number in the email must appear somewhere in the evidence (no invented figures).
  const corpus = norm([src.site, src.enquiry, ...Object.values(src.audit), ...src.web.map(w => w.quote)].join(" "));
  for (const n of new Set(draft.body.match(/\d[\d,.%]*/g) ?? [])) {
    const clean = n.replace(/[.,]$/, "");
    if (clean.length > 1 && !corpus.includes(clean.toLowerCase())) problems.push(`The figure "${clean}" is not in the evidence.`);
  }
  return { pass: problems.length === 0, problems, words };
}
