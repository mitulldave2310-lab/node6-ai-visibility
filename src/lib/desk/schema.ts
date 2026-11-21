import { z } from "zod";
import { SERVICES } from "./constants";

// What Claude must return when it judges an account or enquiry. Kept free of numeric
// bounds and array limits (structured outputs ignores some); the guardrails clamp instead.
export const DecisionSchema = z.object({
  company_summary: z.string().describe("One or two plain sentences on what the company does, from the evidence only."),
  fit_tier: z.enum(["A", "B", "C", "X"]).describe("A strong fit, B possible, C weak, X not a fit or not enough to judge."),
  fit_score: z.number().describe("0 to 100."),
  service: z.enum([...SERVICES, "none"]),
  service_reason: z.string().describe("Why this service, in one sentence that points at the evidence."),
  buyer_roles: z.array(z.string()).describe("Up to 3 job titles likely to own this decision. Roles only, never personal names."),
  signals: z.array(z.object({
    label: z.string().describe("Short name for the signal, e.g. 'No online ordering'."),
    evidence: z.string().describe("A short exact quote copied from the named source. Do not paraphrase."),
    source: z.string().describe("One of: site, enquiry, audit:<check id>, web:<number>."),
  })).describe("Up to 5 signals, strongest first."),
  missing_info: z.array(z.string()).describe("What a salesperson would still need to know."),
  next_step: z.enum(["draft_first_touch", "ask_for_info", "manual_review", "disqualify"]),
  urgency: z.enum(["low", "medium", "high"]),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const DraftSchema = z.object({
  subject: z.string(),
  body: z.string().describe("Plain text. No markdown, no placeholders like [Name]."),
  facts_used: z.array(z.string()).describe("Source ids of the signals the email relies on, e.g. site, audit:llms_txt, web:1."),
});
export type Draft = z.infer<typeof DraftSchema>;
