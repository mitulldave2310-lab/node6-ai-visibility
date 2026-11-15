import type { Check } from "@/lib/audit/analyze";
import { sortChecks, type AuditResponse } from "@/lib/audit/client";

const STATUS_STYLE: Record<Check["status"], { label: string; className: string }> = {
  pass: { label: "Pass", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  warn: { label: "Partial", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" },
  fail: { label: "Fail", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

const GRADE_STYLE: Record<AuditResponse["grade"], string> = {
  A: "text-green-700 dark:text-green-400",
  B: "text-green-700 dark:text-green-400",
  C: "text-amber-700 dark:text-amber-400",
  D: "text-red-700 dark:text-red-400",
  F: "text-red-700 dark:text-red-400",
};

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function AuditReport({ audit }: { audit: AuditResponse }) {
  const checks = sortChecks(audit.checks);
  const passed = audit.checks.filter((c) => c.status === "pass").length;

  return (
    <section aria-labelledby="audit-result-heading" className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 id="audit-result-heading" className="truncate text-lg font-semibold">
            {displayHost(audit.url)}
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {passed} of {audit.checks.length} checks passed
          </p>
        </div>
        <div className="flex shrink-0 items-baseline gap-3">
          <p>
            <span className="text-4xl font-semibold tabular-nums">{audit.score}</span>
            <span className="text-neutral-500"> / 100</span>
          </p>
          <p className={`text-4xl font-bold ${GRADE_STYLE[audit.grade]}`} aria-label={`Grade ${audit.grade}`}>
            {audit.grade}
          </p>
        </div>
      </div>

      {!audit.site_up && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Your homepage did not load for us, so most checks could not run. Fix that first, then run the audit again.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {checks.map((check) => {
          const status = STATUS_STYLE[check.status];
          return (
            <li key={check.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium">{check.name}</h3>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-medium ${status.className}`}>
                  {status.label}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                {check.detail}{" "}
                <span className="text-neutral-500">
                  ({check.earned} of {check.points} points)
                </span>
              </p>
              {check.fix && (
                <p className="mt-3 rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">
                  <span className="font-medium">How to fix: </span>
                  {check.fix}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
