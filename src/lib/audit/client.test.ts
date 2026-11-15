import { describe, expect, it, vi } from "vitest";
import type { Check } from "./analyze";
import { EMPTY_INPUT_ERROR, FALLBACK_ERROR, NETWORK_ERROR, requestAudit, sortChecks } from "./client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const audit = {
  url: "https://acme.example",
  site_up: true,
  score: 72,
  grade: "C",
  checks: [],
  top_gaps: [],
  signals: { title: "", description: "", h1: "", schema_types: [], words: 0, text_sample: "" },
  audited_at: "2026-11-15T00:00:00.000Z",
  took_ms: 900,
};

describe("requestAudit", () => {
  it("POSTs the trimmed url and returns the audit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, audit));
    const r = await requestAudit("  acme.example ", fetchImpl);
    expect(r).toEqual({ ok: true, data: audit });
    expect(fetchImpl).toHaveBeenCalledWith("/api/audit", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ url: "acme.example" });
  });

  it("rejects empty input without calling the API", async () => {
    const fetchImpl = vi.fn();
    expect(await requestAudit("   ", fetchImpl)).toEqual({ ok: false, error: EMPTY_INPUT_ERROR });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes the API's error message through", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(422, { error: "We couldn't find that website. Check the spelling." }));
    expect(await requestAudit("nope.invalid", fetchImpl)).toEqual({
      ok: false,
      error: "We couldn't find that website. Check the spelling.",
    });
  });

  it("falls back when the error body is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>Gateway timeout</html>", { status: 504 }));
    expect(await requestAudit("acme.example", fetchImpl)).toEqual({ ok: false, error: FALLBACK_ERROR });
  });

  it("falls back when a 200 body is not an audit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { hello: "world" }));
    expect(await requestAudit("acme.example", fetchImpl)).toEqual({ ok: false, error: FALLBACK_ERROR });
  });

  it("reports a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await requestAudit("acme.example", fetchImpl)).toEqual({ ok: false, error: NETWORK_ERROR });
  });
});

describe("sortChecks", () => {
  const c = (id: string, status: Check["status"]): Check => ({ id, name: id, points: 5, earned: 0, status, detail: "", fix: "" });
  it("puts fail, then warn, then pass, keeping API order within each group", () => {
    const sorted = sortChecks([c("a", "pass"), c("b", "fail"), c("c", "warn"), c("d", "fail"), c("e", "pass")]);
    expect(sorted.map((x) => x.id)).toEqual(["b", "d", "c", "a", "e"]);
  });
});
