const $ = id => document.getElementById(id);
const el = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text ?? "", ...(cls ? { className: cls } : {}) });
const ROUTES = { draft: "Send a first touch", ask_for_info: "Reply and ask for details", manual_review: "Person to review", disqualify: "Not a fit, no outreach" };
const STEPS = { outbound: ["Reading the website", "Searching the public web", "Claude is deciding", "Drafting and checking the message"],
  enquiry: ["Reading your website", "Reading up on your company", "Matching your need to a service", "Drafting a reply for the team"] };

// Tabs
function show(tab) {
  for (const t of ["research", "enquiry"]) {
    $(t).hidden = t !== tab;
    $("tab-" + t).setAttribute("aria-selected", String(t === tab));
  }
  $("status").textContent = "";
}
$("tab-research").onclick = () => show("research");
$("tab-enquiry").onclick = () => show("enquiry");
document.querySelectorAll("[data-tab]").forEach(a => a.addEventListener("click", () => show(a.dataset.tab)));
if (location.hash === "#enquiry") show("enquiry");

// Progress list driven by elapsed time while the single request runs.
let timer;
function startProgress(mode) {
  const list = $("progress"); list.replaceChildren(...STEPS[mode].map(s => el("li", s)));
  list.hidden = false;
  const items = [...list.children]; let i = 0;
  const tick = () => { items.forEach((li, n) => { li.className = n < i ? "done" : n === i ? "now" : ""; }); if (i < items.length - 1) i++; };
  tick(); timer = setInterval(tick, mode === "outbound" ? 6000 : 7000);
}
function stopProgress(ok) {
  clearInterval(timer);
  if (ok) [...$("progress").children].forEach(li => (li.className = "done"));
  else $("progress").hidden = true;
}

function sourceLine(s) {
  const p = el("span", "", "src");
  const label = s.source === "site" ? "Their website" : s.source === "enquiry" ? "The enquiry" : s.source.startsWith("audit:") ? "Website audit · " + s.source.slice(6) : "Web · " + s.source.slice(4);
  if (s.url) { const a = el("a", label + " ↗"); Object.assign(a, { href: s.url, target: "_blank", rel: "noopener noreferrer" }); p.append(a); } else p.append(label);
  return p;
}

function render(r, sample) {
  $("origin").textContent = (sample ? "SAMPLE · FICTIONAL COMPANY · " : "") + "DECISION CARD · DECIDED BY " + r.author.toUpperCase() + ", CHECKED BY RULES";
  $("who").textContent = r.company || new URL(r.url).hostname;
  $("summary").textContent = r.decision.company_summary;
  $("fit").textContent = `Tier ${r.verdict.tier} · ${r.verdict.score}/100`;
  $("service").textContent = r.decision.service_label;
  $("route").textContent = ROUTES[r.verdict.route];
  $("roles").textContent = r.verdict.roles.join(", ") || "Not clear";
  $("reason").textContent = r.decision.service_reason;
  $("signals").replaceChildren(...r.verdict.signals.map(s => {
    const li = el("li");
    li.append(el("b", s.label + " "), el("span", s.verified ? "Verified" : "Unverified", s.verified ? "ok" : "no"), el("q", s.evidence), sourceLine(s));
    return li;
  }));
  $("overrides").replaceChildren(...(r.verdict.overrides.length ? r.verdict.overrides : ["No rule needed to change Claude's call."]).map(t => el("li", t)));
  $("missing").replaceChildren(...(r.decision.missing_info.length ? r.decision.missing_info : ["Nothing major."]).map(t => el("li", t)));
  const d = r.draft;
  $("draftBox").hidden = !d;
  if (d) {
    $("draftKind").textContent = r.mode === "outbound" ? "FIRST TOUCH · NEVER SENT BY THE DESK" : "REPLY · WAITS FOR APPROVAL";
    $("subject").textContent = "Subject: " + d.subject;
    $("body").textContent = d.body;
    $("copy").textContent = d.check.pass
      ? `Passed the copy check (${d.check.words} words${d.attempts > 1 ? ", after one rewrite" : ""}).`
      : "Needs an edit: " + d.check.problems.join(" ");
  }
  const steps = r.steps.map(s => `${s.name} ${(s.ms / 1000).toFixed(1)}s`).join(" · ");
  $("meta").textContent = `Website audit ${r.audit.earned}/${r.audit.possible} on ${r.audit.verified} verified checks · ${r.research.sources} web sources${r.research.note ? " · " + r.research.note : ""} · ${steps}`;
  $("thanks").hidden = true;
  $("card").hidden = false;
  $("card").focus({ preventScroll: true });
  $("card").scrollIntoView({ block: "start" });
}

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function busy(form, on) { form.querySelectorAll("button,input,textarea").forEach(x => (x.disabled = on)); document.body.classList.toggle("busy", on); }

$("research").addEventListener("submit", async e => {
  e.preventDefault(); const form = e.currentTarget;
  $("status").textContent = ""; $("card").hidden = true; busy(form, true); startProgress("outbound");
  try { render(await post("/api/desk/research", { website: $("website").value, company: $("company").value }), false); stopProgress(true); }
  catch (err) { stopProgress(false); $("status").textContent = err.message; }
  finally { busy(form, false); }
});

$("sample").addEventListener("click", async () => {
  $("status").textContent = "";
  try { render(await (await fetch("/desk-sample.json")).json(), true); } catch { $("status").textContent = "The sample could not load."; }
});

$("enquiry").addEventListener("submit", async e => {
  e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
  $("status").textContent = ""; $("card").hidden = true; $("thanks").hidden = true; busy(form, true); startProgress("enquiry");
  try {
    const r = await post("/api/desk/enquiry", { name: data.get("name"), email: data.get("email"), website: data.get("website"), message: data.get("message"), consent: data.has("consent") });
    stopProgress(true);
    $("thanksText").textContent = `Your reference is ${r.reference}. node6 Labs has read up on your company and drafted a reply. A person checks it before it reaches your inbox.`;
    if (r.debug) render(r.debug, false);
    $("thanks").hidden = false; $("thanks").focus({ preventScroll: true }); $("thanks").scrollIntoView({ block: "start" });
    form.reset();
  } catch (err) { stopProgress(false); $("status").textContent = err.message; }
  finally { busy(form, false); }
});
