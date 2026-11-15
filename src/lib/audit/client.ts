// Browser side of the audit: calls /api/audit and turns every outcome into either a result
// or a short, user-facing error message. No React here so it can be tested in Node.
import type { AuditResult, Check } from "./analyze";

export type AuditResponse = AuditResult & { audited_at: string; took_ms: number };

export type AuditOutcome = { ok: true; data: AuditResponse } | { ok: false; error: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const EMPTY_INPUT_ERROR = "Type your website address, e.g. yourbusiness.com";
export const NETWORK_ERROR = "We couldn't reach the audit service. Check your connection and try again.";
export const FALLBACK_ERROR = "The audit failed. Try again in a minute.";

function isAuditResponse(v: unknown): v is AuditResponse {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.score === "number" && typeof r.grade === "string" && Array.isArray(r.checks);
}

export async function requestAudit(input: string, fetchImpl: FetchLike = fetch): Promise<AuditOutcome> {
  const url = input.trim();
  if (!url) return { ok: false, error: EMPTY_INPUT_ERROR };

  let res: Response;
  try {
    res = await fetchImpl("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
    return { ok: false, error: typeof message === "string" && message.trim() ? message : FALLBACK_ERROR };
  }
  if (!isAuditResponse(body)) return { ok: false, error: FALLBACK_ERROR };
  return { ok: true, data: body };
}

const STATUS_ORDER: Record<Check["status"], number> = { fail: 0, warn: 1, pass: 2 };

// Failing checks first, then partial, then passing. Stable within each group, so the API's
// order (most important first) is kept.
export function sortChecks(checks: Check[]): Check[] {
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => STATUS_ORDER[a.c.status] - STATUS_ORDER[b.c.status] || a.i - b.i)
    .map(({ c }) => c);
}
