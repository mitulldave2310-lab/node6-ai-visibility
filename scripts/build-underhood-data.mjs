// Builds public/underhood-data.json for /under-the-hood.html from the saved live test runs.
// Usage: node scripts/build-underhood-data.mjs
import fs from "fs";

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const main = read("results/consistency-2026-11-21.json");
const rerun = read("results/consistency-2026-11-21-shakti-rerun.json").map((r) => ({ ...r, rerun: true }));
const all = [...main, ...rerun];

const runs = all.map((r) => {
  const b = r.raw || {};
  return {
    site: r.website, run: r.run, rerun: !!r.rerun, status: r.status, ms: r.ms, error: r.error || null,
    route: b.verdict?.route ?? null, tier: b.verdict?.tier ?? null, score: b.verdict?.score ?? null,
    service: b.decision?.service_label ?? null, summary: b.decision?.company_summary ?? "",
    reason: b.decision?.service_reason ?? "", roles: b.verdict?.roles ?? [],
    signals: (b.verdict?.signals ?? []).map((s) => ({ label: s.label, quote: s.evidence, source: s.source, ok: !!s.verified, url: s.url || null })),
    overrides: b.verdict?.overrides ?? [], missing: b.decision?.missing_info ?? [],
    steps: b.steps ?? [], webSources: b.research?.sources ?? 0,
    draft: b.draft ? { subject: b.draft.subject, body: b.draft.body, pass: !!b.draft.check?.pass, words: b.draft.check?.words ?? null, attempts: b.draft.attempts ?? 1 } : null,
  };
});

const ok = runs.filter((r) => r.status === 200);
const stepMs = {};
for (const r of ok) for (const s of r.steps) (stepMs[s.name] ||= []).push(s.ms);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sigs = ok.flatMap((r) => r.signals);
const drafts = ok.filter((r) => r.draft);

const out = {
  generated: new Date().toISOString(),
  testedOn: "2026-11-21",
  runs,
  totals: {
    runs: main.length, okRuns: main.filter((r) => r.status === 200).length,
    companies: new Set(main.map((r) => r.website)).size,
    signals: sigs.length, verified: sigs.filter((s) => s.ok).length,
    drafts: drafts.length, draftsPassFirst: drafts.filter((d) => d.draft.pass && d.draft.attempts === 1).length,
    medianMs: median(ok.map((r) => r.ms)), maxMs: Math.max(...ok.map((r) => r.ms)),
  },
  stepMedianMs: Object.fromEntries(Object.entries(stepMs).map(([k, v]) => [k, median(v)])),
};
fs.writeFileSync("public/underhood-data.json", JSON.stringify(out));
console.log(JSON.stringify(out.totals), JSON.stringify(out.stepMedianMs), (fs.statSync("public/underhood-data.json").size / 1024).toFixed(0) + "KB");
