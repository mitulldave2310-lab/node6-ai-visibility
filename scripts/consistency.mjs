// Runs real companies through POST /api/desk/research and records how stable the route is.
// Usage: node scripts/consistency.mjs --runs 3 --base http://localhost:3123 --out results/consistency site1.com site2.com ...
// With no sites given, uses the default list below. Writes <out>.json (raw) and <out>.md (summary).
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const runs = Number(opt("runs", "3"));
const base = opt("base", "http://localhost:3123");
const out = opt("out", `results/consistency-${new Date().toISOString().slice(0, 10)}`);
const DEFAULT = [
  "node6labs.com",
  "shaktipumps.com",
  "bluetokaicoffee.com",
  "infosys.com",
  "wonderchef.com",
  "thesleepcompany.in",
  "forbesmarshall.com",
  "ratnamani.com",
  "bombayshavingcompany.com",
  "chaayos.com",
];
const sites = args.length ? args : DEFAULT;

async function runOne(website) {
  const t = Date.now();
  try {
    const res = await fetch(`${base}/api/desk/research`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `test-${website}` }, // local test only: one rate-limit bucket per company
      body: JSON.stringify({ website }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => ({}));
    const sigs = body.verdict?.signals ?? [];
    return {
      website,
      status: res.status,
      ms: Date.now() - t,
      error: body.error ?? null,
      route: body.verdict?.route ?? null,
      tier: body.verdict?.tier ?? null,
      score: body.verdict?.score ?? null,
      service: body.decision?.service ?? null,
      signals: sigs.length,
      verified: sigs.filter((s) => s.verified).length,
      web_verified: sigs.filter((s) => s.verified && String(s.source).startsWith("web:")).length,
      overrides: body.verdict?.overrides ?? [],
      draft: body.draft ? { pass: body.draft.check?.pass ?? null, problems: body.draft.check?.problems ?? [], attempts: body.draft.attempts ?? null } : null,
      raw: body,
    };
  } catch (e) {
    return { website, status: 0, ms: Date.now() - t, error: String(e), route: null };
  }
}

const results = [];
for (const site of sites) {
  for (let r = 1; r <= runs; r++) {
    const row = await runOne(site);
    row.run = r;
    results.push(row);
    console.log(`${site} run ${r}: ${row.status} ${row.route ?? "-"} ${row.tier ?? "-"}/${row.score ?? "-"} ${row.service ?? "-"} verified ${row.verified ?? 0}/${row.signals ?? 0} (web ${row.web_verified ?? 0}) ${Math.round(row.ms / 1000)}s${row.error ? " ERR " + row.error : ""}`);
  }
}

const mode = (xs) => {
  const c = {};
  for (const x of xs) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0];
};
const lines = [
  `# Lead Desk consistency test`,
  ``,
  `Run ${new Date().toISOString()} against ${base}. ${sites.length} companies, ${runs} runs each.`,
  ``,
  `| Company | Routes | Route agreement | Tiers | Services | Verified signals | Seconds (max) |`,
  `|---|---|---|---|---|---|---|`,
];
let agreeSites = 0, ok = 0, total = 0, maxMs = 0, sigTotal = 0, verTotal = 0;
for (const site of sites) {
  const rows = results.filter((r) => r.website === site);
  const good = rows.filter((r) => r.status === 200);
  total += rows.length;
  ok += good.length;
  const routes = good.map((r) => r.route);
  const [, n] = mode(routes.length ? routes : ["none"]);
  const agree = good.length === rows.length && n === rows.length;
  if (agree) agreeSites++;
  const ms = Math.max(...rows.map((r) => r.ms));
  maxMs = Math.max(maxMs, ms);
  const s = good.reduce((a, r) => a + r.signals, 0), v = good.reduce((a, r) => a + r.verified, 0);
  sigTotal += s; verTotal += v;
  lines.push(`| ${site} | ${rows.map((r) => r.route ?? `error ${r.status}`).join(", ")} | ${n}/${rows.length} | ${good.map((r) => r.tier).join(", ")} | ${[...new Set(good.map((r) => r.service))].join(", ")} | ${v}/${s} | ${Math.round(ms / 1000)} |`);
}
lines.push(
  ``,
  `- Successful runs: ${ok}/${total}`,
  `- Companies with the same route on every run: ${agreeSites}/${sites.length}`,
  `- Quoted signals that verified against their source: ${verTotal}/${sigTotal}`,
  `- Slowest run: ${Math.round(maxMs / 1000)}s`,
);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(`${out}.json`, JSON.stringify(results, null, 2));
fs.writeFileSync(`${out}.md`, lines.join("\n") + "\n");
console.log(lines.slice(-4).join("\n"));
console.log(`Saved ${out}.json and ${out}.md`);
