import { describe, expect, it } from "vitest";
import type { DeskAI } from "./claude";
import { runDesk } from "./engine";
import { applyGuardrails, checkCopy, verifySignal, type Sources } from "./guardrails";
import type { Decision, Draft } from "./schema";

const HTML = `<html><head><title>Shree Valves | Industrial valves Pune</title>
<meta name="description" content="Ball and gate valves for chemical plants since 1998."></head>
<body><h1>Industrial valves for chemical plants</h1><p>Call us for a quote. Orders by phone and email only.</p>
<p>New plant opening in Chakan this year.</p></body></html>`;

const site = { status: 200, body: HTML, finalUrl: "https://shreevalves.example/" };
const fakeSite = async () => ({ url: "https://shreevalves.example", home: site, bot: site,
  robots: { status: 200, body: "User-agent: *\nAllow: /" }, llms: { status: 404, body: "" }, sitemap: { status: 404, body: "" } });

const src: Sources = {
  site: "Shree Valves | Industrial valves Pune\nOrders by phone and email only. New plant opening in Chakan this year.",
  enquiry: "", audit: { llms_txt: "llms.txt: Not found (HTTP 404)" },
  web: [{ id: "web:1", url: "https://news.example/a", title: "Shree Valves expands", quote: "Shree Valves will add 40 jobs at its Chakan site" }],
  siteUp: true,
};

const decision = (over: Partial<Decision> = {}): Decision => ({
  company_summary: "Makes industrial valves.", fit_tier: "A", fit_score: 82, service: "ecommerce",
  service_reason: "Orders only by phone.", buyer_roles: ["Managing Director", "Head of Sales"],
  signals: [
    { label: "No online ordering", evidence: "Orders by phone and email only", source: "site" },
    { label: "Expansion", evidence: "will add 40 jobs at its Chakan site", source: "web:1" },
  ],
  missing_info: ["Order volume"], next_step: "draft_first_touch", urgency: "medium", ...over,
});

const goodDraft: Draft = { subject: "Orders at Shree Valves", body: "Hi, I saw orders at Shree Valves are by phone and email only, and you are adding 40 jobs at Chakan. Would an online quote form help your sales team? Mitull", facts_used: ["site", "web:1"] };

describe("verifySignal", () => {
  it("accepts an exact quote from the named source, ignoring case and quotes", () => {
    expect(verifySignal("orders by PHONE and email only", "site", src).ok).toBe(true);
    expect(verifySignal("“will add 40 jobs at its Chakan site”", "web:1", src)).toEqual({ ok: true, url: "https://news.example/a" });
    expect(verifySignal("Not found", "audit:llms_txt", src).ok).toBe(true);
  });
  it("rejects paraphrases, wrong sources and unknown ids", () => {
    expect(verifySignal("They only take phone orders", "site", src).ok).toBe(false);
    expect(verifySignal("Orders by phone and email only", "web:1", src).ok).toBe(false);
    expect(verifySignal("anything", "web:9", src).ok).toBe(false);
    expect(verifySignal("ok", "site", src).ok).toBe(false);
  });
});

describe("applyGuardrails", () => {
  it("lets a verified A fit through to a draft", () => {
    const v = applyGuardrails(decision(), src, "outbound");
    expect(v.route).toBe("draft");
    expect(v.overrides).toEqual([]);
    expect(v.signals.every(s => s.verified)).toBe(true);
  });
  it("sends to manual review when no signal can be verified", () => {
    const v = applyGuardrails(decision({ signals: [{ label: "x", evidence: "made up claim here", source: "site" }] }), src, "outbound");
    expect(v.route).toBe("manual_review");
    expect(v.overrides.join(" ")).toMatch(/could not be matched/);
  });
  it("blocks outbound drafts below tier B", () => {
    expect(applyGuardrails(decision({ fit_tier: "C" }), src, "outbound").route).toBe("manual_review");
  });
  it("never drops an enquiry, even when Claude says disqualify", () => {
    const v = applyGuardrails(decision({ next_step: "disqualify", fit_tier: "X" }), { ...src, enquiry: "Need a store" }, "enquiry");
    expect(v.route).toBe("ask_for_info");
  });
  it("clamps the score and strips personal names from roles", () => {
    const v = applyGuardrails(decision({ fit_score: 140, buyer_roles: ["Mr. Shah", "CEO", "COO", "CFO"] }), src, "outbound");
    expect(v.score).toBe(100);
    expect(v.roles).toEqual(["CEO", "COO"]);
  });
});

describe("checkCopy", () => {
  const v = applyGuardrails(decision(), src, "outbound");
  it("passes a short, grounded draft", () => {
    expect(checkCopy(goodDraft, v, "outbound", src)).toMatchObject({ pass: true, problems: [] });
  });
  it("catches dashes, hype words, placeholders, invented figures and ungrounded drafts", () => {
    const bad: Draft = { subject: "Unlock growth", body: "Hi [Name] — we helped 300 firms grow.", facts_used: ["web:7"] };
    const r = checkCopy(bad, v, "outbound", src);
    expect(r.pass).toBe(false);
    expect(r.problems.join(" ")).toMatch(/long dash/);
    expect(r.problems.join(" ")).toMatch(/unlock/);
    expect(r.problems.join(" ")).toMatch(/placeholder/);
    expect(r.problems.join(" ")).toMatch(/"300"/);
    expect(r.problems.join(" ")).toMatch(/verified signal/);
  });
});

function fakeAI(over: Partial<DeskAI> = {}): DeskAI & { writes: number } {
  const ai = {
    writes: 0,
    async research() { return { notes: "Adding 40 jobs.", web: src.web }; },
    async decide() { return decision(); },
    async write() { ai.writes++; return goodDraft; },
    ...over,
  };
  return ai;
}

describe("runDesk", () => {
  it("runs the full outbound path and labels Claude as the author", async () => {
    const r = await runDesk({ mode: "outbound", url: "https://shreevalves.example", company: "Shree Valves" }, { fetchSite: fakeSite, ai: fakeAI() });
    expect(r.author).toBe("Claude");
    expect(r.verdict.route).toBe("draft");
    expect(r.draft?.check.pass).toBe(true);
    expect(r.decision.service_label).toBe("eCommerce");
    expect(r.steps.map(s => s.name)).toEqual(["Read website", "Web research", "Claude decision", "Draft"]);
  });
  it("keeps going when web research fails, and says so", async () => {
    const ai = fakeAI({ async research() { throw new Error("down"); } });
    const r = await runDesk({ mode: "outbound", url: "https://shreevalves.example" }, { fetchSite: fakeSite, ai });
    expect(r.research.searched).toBe(false);
    expect(r.verdict.signals.find(s => s.source === "web:1")?.verified).toBe(false);
    expect(r.verdict.route).toBe("draft"); // the site quote still verifies
  });
  it("rewrites once when the copy check fails", async () => {
    let n = 0;
    const ai = fakeAI({ async write() { n++; return n === 1 ? { ...goodDraft, body: goodDraft.body + " — unlock it." } : goodDraft; } });
    const r = await runDesk({ mode: "outbound", url: "https://shreevalves.example" }, { fetchSite: fakeSite, ai });
    expect(n).toBe(2);
    expect(r.draft).toMatchObject({ attempts: 2, check: { pass: true } });
  });
  it("writes no outbound draft for a poor fit", async () => {
    const ai = fakeAI({ async decide() { return decision({ fit_tier: "X", service: "none", next_step: "disqualify" }); } });
    const r = await runDesk({ mode: "outbound", url: "https://shreevalves.example" }, { fetchSite: fakeSite, ai });
    expect(r.verdict.route).toBe("disqualify");
    expect(r.draft).toBeNull();
  });
  it("always drafts a reply for a real enquiry", async () => {
    const ai = fakeAI({ async decide() { return decision({ next_step: "ask_for_info", signals: [{ label: "Wants a store", evidence: "sell our valves online", source: "enquiry" }] }); } });
    const r = await runDesk({ mode: "enquiry", url: "https://shreevalves.example", enquiry: "We want to sell our valves online to plant buyers.", contactName: "Asha" }, { fetchSite: fakeSite, ai });
    expect(r.verdict.route).toBe("ask_for_info");
    expect(r.verdict.signals[0].verified).toBe(true);
    expect(r.draft).not.toBeNull();
  });
});
