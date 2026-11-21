// Under the hood: renders the six views from /underhood-data.json (saved live test runs).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ROUTE = { draft: "Draft written", ask_for_info: "Ask for info", manual_review: "Manual review", disqualify: "Disqualified" };
const sec = (ms) => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + "s";
const VIEWS = ["overview", "pipeline", "runs", "guardrails", "automation", "stack"];

function show(v) {
  if (!VIEWS.includes(v)) v = "overview";
  for (const id of VIEWS) $("v-" + id).hidden = id !== v;
  document.querySelectorAll(".views a").forEach((a) => { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

function kpis(t) {
  const items = [
    [`${t.companies - 2}/${t.companies}`, "companies got the same decision on all 3 runs"],
    [`${t.verified}/${t.signals}`, "quotes matched their source word for word"],
    [`${t.draftsPassFirst}/${t.drafts}`, "drafts passed the copy check first time"],
    [sec(t.medianMs), `median time per company (slowest ${sec(t.maxMs)})`],
    ["₹7–10", "estimated API cost per company"],
  ];
  $("kpis").innerHTML = items.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
}

function pipeline(m) {
  const steps = [
    ["Code", "Read the site", "Read website", "Fetches the page through a guard that blocks private addresses, then scores 13 checks.", true],
    ["Claude Sonnet 5.5", "Research the web", "Web research", "Up to 3 searches. Only text the search tool cites becomes a source."],
    ["Claude Haiku 5.5", "Decide", "Claude decision", "Structured output: service, tier, buyer roles, quoted signals, next step."],
    ["Code", "Check", null, "Every quote matched to its source, then routing rules. Runs in milliseconds.", true],
    ["Claude Sonnet 5.5", "Draft", "Draft", "Only for tier A or B. Copy check, one automatic rewrite if it fails."],
  ];
  const max = Math.max(...Object.values(m));
  $("pipe").innerHTML = steps.map(([who, name, key, p, code]) => {
    const ms = key ? m[key] : 5;
    return `<div class="step${code ? " code" : ""}"><div><div class="who">${who}</div><h3>${name}</h3></div>
      <div class="bar" aria-hidden="true"><span style="width:${Math.max(0.4, (ms / max) * 100)}%"></span></div>
      <div class="t">${key ? sec(ms) : "&lt;0.1s"}</div><p>${p}</p></div>`;
  }).join("");
}

function runs(all) {
  const bySite = new Map();
  for (const r of all) {
    if (!bySite.has(r.site)) bySite.set(r.site, []);
    bySite.get(r.site).push(r);
  }
  const list = $("runlist");
  list.innerHTML = [...bySite].map(([site, rs]) => {
    const main = rs.filter((r) => !r.rerun);
    const good = rs.filter((r) => r.status === 200);
    const routes = main.filter((r) => r.status === 200).map((r) => r.route);
    const stable = routes.length === 3 && routes.every((x) => x === routes[0]);
    const note = main.some((r) => r.status !== 200) ? "3 runs failed on a DNS error, re-run below" : stable ? `${ROUTE[routes[0]]} on all 3 runs` : "Decision changed between runs";
    const dots = rs.map((r) => `<span class="dot ${r.status === 200 ? r.route : "err"}" title="${esc(r.rerun ? "Re-run " : "Run ")}${r.run}: ${esc(r.status === 200 ? ROUTE[r.route] : "failed")}"></span>`).join("");
    return `<li><button type="button" data-site="${esc(site)}" aria-pressed="false"><span class="site">${esc(site)}</span><span class="dots">${dots}</span><small>${esc(note)} · ${good.length} usable runs</small></button></li>`;
  }).join("");
  list.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-site]");
    if (!b) return;
    list.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    const rs = bySite.get(b.dataset.site).filter((r) => r.status === 200);
    renderCard(rs, 0);
    if (matchMedia("(max-width:980px)").matches) $("card").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const first = list.querySelector("button[data-site='jyoticeramic.com']") || list.querySelector("button");
  first?.click();
}

function renderCard(rs, i) {
  const r = rs[i];
  const c = $("card");
  if (!r) { c.innerHTML = `<p class="empty">No usable run for this company.</p>`; return; }
  const tabs = rs.length > 1 ? `<div class="tabs" role="group" aria-label="Choose run">${rs.map((x, j) => `<button type="button" data-i="${j}" aria-pressed="${j === i}">${x.rerun ? "Re-run" : "Run"} ${x.run}</button>`).join("")}</div>` : "";
  const sigs = r.signals.map((s) => `<div class="sig"><b>${esc(s.label)}</b> <span class="${s.ok ? "ok" : "no"}">${s.ok ? "Verified" : "Not verified"}</span>
      <q>${esc(s.quote)}</q><span class="src">${s.source === "site" ? "Their website" : s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)} ↗</a>` : esc(s.source)}</span></div>`).join("");
  const draft = r.draft ? `<h4>Draft first email · never sent by the desk</h4><div class="draftbox"><b>Subject: ${esc(r.draft.subject)}</b>${esc(r.draft.body)}</div>
      <p class="time">${r.draft.pass ? `Passed the copy check (${r.draft.words} words)` : "Failed the copy check, flagged for a person"}${r.draft.attempts > 1 ? " after one rewrite" : ""}.</p>` : `<h4>Draft</h4><p class="sum">No draft: ${esc(ROUTE[r.route])}. Drafts are written only for tier A or B.</p>`;
  c.innerHTML = `${tabs}<h3>${esc(r.site)}</h3><p class="sum">${esc(r.summary)}</p>
    <div class="facts"><div><small>Fit</small><b>Tier ${esc(r.tier)} · ${esc(r.score)}/100</b></div><div><small>Lead with</small><b>${esc(r.service)}</b></div>
    <div><small>Next step</small><b>${esc(ROUTE[r.route])}</b></div><div><small>Who buys</small><b>${esc(r.roles.join(", ") || "None")}</b></div></div>
    <p class="sum">${esc(r.reason)}</p>
    <h4>Evidence (${r.signals.filter((s) => s.ok).length} of ${r.signals.length} verified)</h4>${sigs}
    ${r.overrides.length ? `<h4>Rules that changed Claude's call</h4>${r.overrides.map((o) => `<p class="over">${esc(o)}</p>`).join("")}` : ""}
    ${draft}
    <p class="time">${r.steps.map((s) => `${esc(s.name)} ${sec(s.ms)}`).join(" · ")} · total ${sec(r.ms)} · ${r.webSources} web sources</p>`;
  c.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => renderCard(rs, +b.dataset.i)));
}

function caught(all) {
  const seen = new Set();
  const items = [];
  for (const r of all) for (const s of r.signals) if (!s.ok) {
    const k = r.site + s.quote;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(`<li><span class="co">${esc(r.site)} · claimed source ${esc(s.source === "site" ? "their website" : s.source)}</span><b>${esc(s.label)}</b><q>${esc(s.quote)}</q><span class="no">Not found word for word in that source, shown as unverified</span></li>`);
  }
  $("caught").innerHTML = items.join("") || "<li>No unverified quotes in this data.</li>";
}

function flow() {
  const N = [
    ["Desk Enquiry", "Webhook, token required", 20, 132, "trigger"],
    ["Shape Decision Card", "Builds the email", 190, 132],
    ["Airtable: Log Enquiry", "Every enquiry stored", 370, 132],
    ["IF Has Draft", "", 550, 132, "gate"],
    ["Email: Approve Reply", "Waits for one tap", 730, 40],
    ["Email: Manual Review", "Person writes reply", 730, 224],
    ["IF Approved", "", 900, 40, "gate"],
  ];
  // The 10 steps of the live n8n workflow. Approval outcomes stack under "IF Approved".
  const OUT = [
    ["Email: Send Reply", "Reply goes out", 900, 132, "out"],
    ["Airtable: Mark Sent", "Status updated", 900, 210],
    ["Airtable: Mark Not Sent", "Declined, nothing sent", 900, 306],
  ];
  const w = 150, h = 56;
  const node = ([t, s, x, y, cls = ""]) => `<g class="node ${cls}" transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="8"/><text x="12" y="${s ? 24 : 33}">${esc(t)}</text>${s ? `<text class="sub" x="12" y="42">${esc(s)}</text>` : ""}</g>`;
  const curve = (x1, y1, x2, y2, label = "") => `<path d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}"/>` + (label ? `<text class="lbl" x="${x1 + 20}" y="${(y1 + y2) / 2 + 4}">${label}</text>` : "");
  const edges = [
    curve(170, 160, 190, 160), curve(340, 160, 370, 160), curve(520, 160, 550, 160),
    curve(700, 152, 730, 68, "draft"), curve(700, 168, 730, 252, "no draft"),
    curve(880, 68, 900, 68),
    `<path d="M975,96 L975,132"/><text class="lbl" x="982" y="119">Send</text>`,
    `<path d="M975,188 L975,210"/>`,
    `<path d="M1050,68 C1066,68 1066,334 1050,334"/><text class="lbl" x="990" y="292">Don't send</text>`,
  ];
  const svg = $("flow");
  svg.setAttribute("viewBox", "0 30 1070 340");
  svg.innerHTML = edges.join("") + N.map(node).join("") + OUT.map(node).join("");
}

// Screenshots listed in the data file's "shots" array, e.g. [{"src":"/underhood/approval-email.png","caption":"..."}]
function shots(list = []) {
  $("shots").innerHTML = list.map((s) => `<figure><img src="${esc(s.src)}" alt="${esc(s.caption)}" loading="lazy"><figcaption>${esc(s.caption)}</figcaption></figure>`).join("");
}

(async () => {
  show(location.hash.slice(1));
  flow();
  try {
    const d = await (await fetch("/underhood-data.json")).json();
    shots(d.shots);
    $("tested").textContent = new Date(d.testedOn).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    kpis(d.totals);
    pipeline(d.stepMedianMs);
    runs(d.runs);
    caught(d.runs);
  } catch {
    $("kpis").innerHTML = "<div><span>The test data could not load. Refresh the page.</span></div>";
  }
})();
