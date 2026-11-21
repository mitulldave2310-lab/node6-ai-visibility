const get = id => document.getElementById(id);
const bars = document.querySelector(".bands");
for (let index = 0; index < 13; index++) {
  const bar = document.createElement("b");
  bar.style.setProperty("--i", index);
  bars.append(bar);
}
const text = (tag, value) => Object.assign(document.createElement(tag), {textContent: value});
function showReport(report) {
  get("origin").textContent = report.sample ? "SAMPLE REPORT · FICTIONAL WEBSITE" : "LIVE WEBSITE REPORT";
  get("domain").textContent = new URL(report.url).hostname;
  get("action").textContent = report.action;
  get("reason").textContent = report.reason;
  const first = report.checks.find(c => c.id === report.first);
  get("by").textContent = "Selected by " + report.author + (first ? " · Evidence: " + first.name + " · " + first.detail : "");
  const sourceLine = get("firstSource");
  sourceLine.replaceChildren();
  if (first) {
    const source = text(report.sample ? "span" : "a", first.source);
    if (!report.sample) Object.assign(source, {href:first.source, target:"_blank", rel:"noopener noreferrer"});
    sourceLine.append("Source · ",source);
  }
  get("callback").hidden = !report.directIntake;
  get("external").hidden = !!report.directIntake;
  get("callback").reset();
  get("sent").textContent = "";
  get("callback").dataset.website = report.url;
  get("callback").querySelector("button").disabled = false;
  get("score").textContent = report.possible ? report.earned + " / " + report.possible : "Unscored";
  get("coverage").textContent = report.checks.filter(c=>c.known).length + " of 13 checks verified. Points cover verified website signals. AI citations require a separate test.";
  get("checks").replaceChildren();
  report.checks.forEach((c,i) => {
    const row = document.createElement("details");
    const label = !c.known ? "Couldn’t verify" : {pass:"Pass",warn:"Partial",fail:"Needs work"}[c.status];
    row.append(text("summary", c.name + " · " + label + (c.known ? " (" + c.earned + "/" + c.points + ")" : "")),text("p",c.detail));
    const source = text(report.sample ? "p" : "a", c.source);
    if (!report.sample) Object.assign(source, {href:c.source, target:"_blank", rel:"noopener noreferrer"});
    row.append(source);
    if (c.known && c.fix) row.append(text("p", c.fix));
    get("checks").append(row);
    bars.children[i].style.opacity = !c.known ? ".18" : c.status === "pass" ? "1" : ".45";
  });
  get("service").textContent = "The web development team can help implement website fixes. For work that spans your storefront, internal software or manual processes, node6 Labs also offers eCommerce development and automation.";
  get("contact").hidden = !!report.sample;
  get("report").hidden = false;
  get("report").focus({preventScroll:true});
  get("report").scrollIntoView({block:"start"});
}
async function run(sample) {
  const submit = get("audit").querySelector("button");
  submit.disabled = get("sample").disabled = true;
  get("report").hidden = true;
  document.body.classList.add("busy");
  get("status").textContent = sample ? "Opening the sample report…" : "Reading your homepage and discovery files…";
  try {
    const res = await fetch("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sample ? {sample:true} : {url:get("site").value})});
    const report = await res.json();
    if (!res.ok) throw new Error(report.error || "The audit could not finish.");
    get("status").textContent = "";
    showReport(report);
  } catch (err) {
    get("status").textContent = err.message || "The connection failed. Please try again.";
  } finally {
    submit.disabled = get("sample").disabled = false;
    document.body.classList.remove("busy");
  }
}
get("audit").addEventListener("submit", event=>{event.preventDefault();run(false);});
get("sample").addEventListener("click", ()=>run(true));
get("callback").addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const data=new FormData(form);
  const button=form.querySelector("button");
  button.disabled=true;
  try {
    const res=await fetch("/api/callback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({website:form.dataset.website,name:data.get("name"),email:data.get("email"),consent:data.has("consent")})});
    const result=await res.json();
    if (!res.ok) throw new Error(result.error);
    get("sent").textContent="Your request reached node6 Labs.";
  } catch(e) {get("sent").textContent=e.message;button.disabled=false;}
});

