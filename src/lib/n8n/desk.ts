// Hands a finished enquiry (decision + draft) to the n8n approval workflow.
import type { DeskResult } from "@/lib/desk/engine";

export interface EnquiryContact { name: string; email: string; message: string }

export function deskWebhookConfigured() {
  return !!(process.env.N8N_DESK_WEBHOOK_URL && process.env.N8N_WEBHOOK_TOKEN);
}

/** Flat payload so the n8n nodes can read fields without parsing. */
export function toPayload(ref: string, contact: EnquiryContact, r: DeskResult) {
  const verified = r.verdict.signals.filter(s => s.verified);
  return {
    reference: ref,
    received_at: new Date().toISOString(),
    name: contact.name, email: contact.email, message: contact.message,
    website: r.url, company: r.company,
    service: r.decision.service, service_label: r.decision.service_label, service_reason: r.decision.service_reason,
    fit_tier: r.verdict.tier, fit_score: r.verdict.score, urgency: r.decision.urgency,
    route: r.verdict.route, summary: r.decision.company_summary,
    buyer_roles: r.verdict.roles.join(", "),
    missing_info: r.decision.missing_info.join("; "),
    signals_text: verified.map(s => `${s.label}: "${s.evidence}" (${s.source})`).join("\n"),
    unverified_count: r.verdict.signals.length - verified.length,
    overrides: r.verdict.overrides.join("\n"),
    audit_score: `${r.audit.earned}/${r.audit.possible}`,
    draft_subject: r.draft?.subject ?? "", draft_body: r.draft?.body ?? "",
    copy_check: r.draft ? (r.draft.check.pass ? "pass" : r.draft.check.problems.join("; ")) : "no draft",
    signals: r.verdict.signals, steps: r.steps,
  };
}

export async function forwardEnquiry(payload: ReturnType<typeof toPayload>): Promise<boolean> {
  const url = process.env.N8N_DESK_WEBHOOK_URL; const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!url || !token) return false;
  try {
    const res = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-Intake-Token": token },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch { return false; }
}
