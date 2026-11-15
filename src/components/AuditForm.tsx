"use client";

import { useState, type FormEvent } from "react";
import { requestAudit, type AuditResponse } from "@/lib/audit/client";
import { AuditReport } from "./AuditReport";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; data: AuditResponse };

export function AuditForm() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const loading = state.kind === "loading";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setState({ kind: "loading" });
    const outcome = await requestAudit(url);
    setState(outcome.ok ? { kind: "done", data: outcome.data } : { kind: "error", message: outcome.error });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row" noValidate>
        <label htmlFor="audit-url" className="sr-only">
          Your website
        </label>
        <input
          id="audit-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="yourbusiness.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          aria-invalid={state.kind === "error"}
          aria-describedby={state.kind === "error" ? "audit-error" : undefined}
          className="min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-4 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-100 dark:focus:ring-neutral-100/20"
        />
        <button
          type="submit"
          disabled={loading}
          className="min-h-12 shrink-0 rounded-lg bg-neutral-900 px-6 text-base font-medium text-white hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-70 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {loading ? "Checking..." : "Check my site"}
        </button>
      </form>

      <div aria-live="polite">
        {loading && (
          <p className="flex items-center gap-3 text-neutral-600 dark:text-neutral-400">
            <span
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-neutral-100"
            />
            Checking your site the way AI assistants see it. This can take up to 30 seconds.
          </p>
        )}
        {state.kind === "error" && (
          <p
            id="audit-error"
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {state.message}
          </p>
        )}
      </div>

      {state.kind === "done" && <AuditReport audit={state.data} />}
    </div>
  );
}
