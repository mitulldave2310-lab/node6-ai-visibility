#!/usr/bin/env python3
"""
Builds the importable n8n workflows and the VAPI assistant config for Week 4.

Sources of truth (edit these, then re-run):
  ../config.json (copy of config.example.json)  base IDs, channel, models, URLs
  audit.js                                      AI visibility scoring
  ../prompts/*.md                               Claude system prompts

Outputs:
  node6-lead-engine.json     main workflow (form + voice triggers, Claude, Airtable, Gmail)
  node6-error-handler.json   error workflow (email alert + Airtable log)
  ../vapi/assistant.json     VAPI assistant (Claude brain, ElevenLabs voice, n8n tool)

Usage: python build_workflow.py
"""

import json
import os
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


cfg_path = os.path.join(ROOT, "config.json")
if not os.path.exists(cfg_path):
    cfg_path = os.path.join(ROOT, "config.example.json")
CFG = json.loads(read(cfg_path))
QUALIFY_PROMPT = read(os.path.join(ROOT, "prompts", "qualify-system.md"))
EMAIL_PROMPT = read(os.path.join(ROOT, "prompts", "followup-email-system.md"))
VOICE_PROMPT = read(os.path.join(ROOT, "prompts", "voice-agent-system.md"))
AUDIT_JS = read(os.path.join(HERE, "audit.js")).replace(
    'if (typeof module !== "undefined") module.exports = { analyze, robotsBlocks };', "")

BASE = CFG["airtable_base_id"]
AIRTABLE = f"https://api.airtable.com/v0/{BASE}"
APPROVER = CFG["approver_email"]
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
GPTBOT_UA = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)"


# ------------------------------------------------------------------ helpers

class Flow:
    def __init__(self, name):
        self.name = name
        self.nodes = []
        self.conns = {}

    def node(self, name, type_, version, params, pos, **extra):
        n = {"parameters": params, "id": str(uuid.uuid5(uuid.NAMESPACE_URL, self.name + name)),
             "name": name, "type": type_, "typeVersion": version, "position": list(pos)}
        n.update(extra)
        self.nodes.append(n)
        return name

    def link(self, src, dst, out=0):
        outs = self.conns.setdefault(src, {"main": []})["main"]
        while len(outs) <= out:
            outs.append([])
        outs[out].append({"node": dst, "type": "main", "index": 0})

    def chain(self, *names):
        for a, b in zip(names, names[1:]):
            self.link(a, b)

    def export(self, error_workflow=""):
        return {"name": self.name, "nodes": self.nodes, "connections": self.conns, "pinData": {},
                "active": False,
                "settings": {"executionOrder": "v1", "saveManualExecutions": True,
                             "errorWorkflow": error_workflow},
                "meta": {"templateCredsSetupCompleted": False}}


def code(js, each=True):
    p = {"jsCode": js}
    if each:
        p["mode"] = "runOnceForEachItem"
    return p


def http_get(url_expr, ua):
    return {"url": url_expr, "sendHeaders": True,
            "headerParameters": {"parameters": [{"name": "User-Agent", "value": ua}]},
            "options": {"allowUnauthorizedCerts": True, "timeout": 8000,
                        "redirect": {"redirect": {"followRedirects": True, "maxRedirects": 5}},
                        "response": {"response": {"fullResponse": True, "neverError": True,
                                                  "responseFormat": "text"}}}}


SOFT = {"onError": "continueRegularOutput", "alwaysOutputData": True}
RETRY = {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 3000}


def claude_call(body_expr):
    return {"method": "POST", "url": "https://api.anthropic.com/v1/messages",
            "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
            "sendHeaders": True,
            "headerParameters": {"parameters": [{"name": "anthropic-version", "value": "2026-10-21"},
                                                {"name": "content-type", "value": "application/json"}]},
            "sendBody": True, "specifyBody": "json", "jsonBody": body_expr,
            "options": {"timeout": 90000}}


def airtable(method, path, body_expr):
    return {"method": method, "url": f"{AIRTABLE}/{path}",
            "authentication": "predefinedCredentialType", "nodeCredentialType": "airtableTokenApi",
            "sendBody": True, "specifyBody": "json", "jsonBody": body_expr, "options": {"timeout": 20000}}


def if_bool(expr):
    return {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                           "conditions": [{"id": str(uuid.uuid4()), "leftValue": expr, "rightValue": True,
                                           "operator": {"type": "boolean", "operation": "true",
                                                        "singleValue": True}}],
                           "combinator": "and"}, "options": {}}


def if_equals(expr, value):
    return {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                           "conditions": [{"id": str(uuid.uuid4()), "leftValue": expr, "rightValue": value,
                                           "operator": {"type": "string", "operation": "equals"}}],
                           "combinator": "and"}, "options": {}}


def sticky(flow, name, text, pos, w=420, h=260, color=7):
    flow.node(name, "n8n-nodes-base.stickyNote", 1,
              {"content": text, "height": h, "width": w, "color": color}, pos)


# ------------------------------------------------------------------ code node bodies

NORMALIZE_JS = r"""
// Turns a form submission or a VAPI tool call into one lead shape.
const j = $json;
const msg = (j.body && j.body.message) || null;
let lead = { source: 'form', tool_call_id: '' };

if (msg) {
  const list = msg.toolCallList || msg.toolCalls || [];
  const tc = list[0] || ((msg.toolWithToolCallList || [])[0] || {}).toolCall || {};
  let args = (tc.function && tc.function.arguments) || tc.arguments || {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
  const call = msg.call || {};
  lead = {
    source: 'voice',
    tool_call_id: tc.id || '',
    name: args.name || '',
    email: args.email || '',
    phone: args.phone || (call.customer && call.customer.number) || (msg.customer && msg.customer.number) || '',
    website: args.website || '',
    business: args.business || args.business_type || '',
    city: args.city || '',
    consent: true,
    vapi_call_id: call.id || '',
  };
} else {
  lead = {
    source: 'form',
    tool_call_id: '',
    name: j['Your name'] || '',
    email: j['Work email'] || '',
    phone: j['Phone (optional)'] || '',
    website: j['Website'] || '',
    business: j['What does your business do?'] || '',
    city: j['City'] || '',
    consent: !!j['Consent'],
    vapi_call_id: '',
  };
}

const domain = String(lead.website).trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#].*$/, '').replace(/\s+/g, '');
const email = String(lead.email).trim().toLowerCase();
const problems = [];
// Domain must look public: letters in the TLD, no raw IPs, no localhost.
if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain) || /localhost|\.local$|\.internal$/.test(domain)) problems.push('website missing or not a public domain');
if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) problems.push('email looks invalid');
if (!email && !lead.phone) problems.push('no email or phone');
if (!lead.consent) problems.push('no consent');

return {
  json: {
    ...lead,
    email,
    domain,
    base_url: domain ? 'https://' + domain : '',
    lead_id: 'L-' + Date.now().toString(36).toUpperCase(),
    received_at: new Date().toISOString(),
    valid: problems.length === 0,
    invalid_reason: problems.join('; '),
  },
};
"""

SCORE_JS = AUDIT_JS + r"""
// ---- n8n wrapper: read the five fetch results and score them.
const pick = (n) => { try { return $(n).item.json; } catch (e) { return null; } };
const lead = $('Normalize Lead').item.json;
const audit = analyze({
  url: lead.base_url,
  home: pick('Fetch Homepage'),
  bot: pick('Fetch as GPTBot'),
  robots: pick('Fetch robots.txt'),
  llms: pick('Fetch llms.txt'),
  sitemap: pick('Fetch sitemap.xml'),
});
return { json: { ...lead, audit } };
"""

QUALIFY_REQ_JS = r"""
// Builds the Claude request. System prompt is cached; lead data goes in the user turn.
const SYSTEM = __QUALIFY_PROMPT__;
const l = $json;
const schema = {
  type: 'object', additionalProperties: false,
  required: ['segment', 'tier', 'fit_score', 'route', 'reasons', 'top_gaps', 'recommended_plan', 'voice_summary', 'confidence'],
  properties: {
    segment: { type: 'string', enum: ['manufacturing', 'professional_services', 'companies', 'healthcare', 'education', 'hospitality', 'retail', 'agency', 'unknown'] },
    tier: { type: 'string', enum: ['A', 'B', 'C', 'X'] },
    fit_score: { type: 'integer', description: '0 to 100' },
    route: { type: 'string', enum: ['hot', 'nurture', 'disqualify', 'manual_review'] },
    reasons: { type: 'array', items: { type: 'string' } },
    top_gaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['gap', 'plain_explanation'],
      properties: { gap: { type: 'string' }, plain_explanation: { type: 'string' } } } },
    recommended_plan: { type: 'string', enum: ['Starter', 'Growth', 'None'] },
    voice_summary: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};
const input = {
  lead: { name: l.name, email: l.email ? 'provided (hidden for privacy)' : 'missing', phone: l.phone ? 'provided (hidden for privacy)' : 'missing',
          business: l.business, city: l.city, website: l.domain, source: l.source },
  audit: { site_up: l.audit.site_up, score: l.audit.score, grade: l.audit.grade,
           checks: l.audit.checks.map(c => ({ name: c.name, status: c.status, earned: c.earned, points: c.points, detail: c.detail })),
           signals: l.audit.signals },
};
return { json: { request: {
  model: '__QUALIFY_MODEL__',
  max_tokens: 4000,
  output_config: { effort: 'low', format: { type: 'json_schema', schema } },
  system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'Qualify this inbound lead.\n\n' + JSON.stringify(input, null, 1) }],
} } };
"""

PARSE_QUALIFY_JS = r"""
// Reads Claude's JSON, then applies hard rules Claude can't override.
const lead = $('Score AI Visibility').item.json;
const res = $json;
let q = null, err = '';
if (res.error) err = 'Claude call failed: ' + (res.error.message || JSON.stringify(res.error)).slice(0, 300);
else if (res.stop_reason === 'refusal') err = 'Claude declined this request';
else {
  const block = (res.content || []).find(b => b.type === 'text');
  try { q = JSON.parse(block.text); } catch (e) { err = 'Could not parse Claude output'; }
}
if (!q) q = { segment: 'unknown', tier: 'X', fit_score: 0, route: 'manual_review', reasons: [err],
              top_gaps: lead.audit.top_gaps.slice(0, 3).map(g => ({ gap: g.name, plain_explanation: g.fix })),
              recommended_plan: 'None', confidence: 'low',
              voice_summary: `Your site scored ${lead.audit.score} out of 100. The full report is on its way to your email.` };

const guard = [];
if (lead.audit.score > 88 && q.route !== 'disqualify') { q.route = 'disqualify'; guard.push('Rule: score above 88'); }
if (!lead.email && !lead.phone) { q.route = 'disqualify'; guard.push('Rule: no contact details'); }
if (!['hot', 'nurture', 'disqualify', 'manual_review'].includes(q.route)) { q.route = 'manual_review'; guard.push('Rule: unknown route'); }
q.reasons = [...(q.reasons || []), ...guard];

const status = { hot: 'drafting', nurture: 'nurture', disqualify: 'disqualified', manual_review: 'manual_review' }[q.route];
return { json: { ...lead, q, status, claude_error: err, usage: res.usage || null } };
"""

AIRTABLE_LEAD_BODY = r"""={{ JSON.stringify({ typecast: true, records: [{ fields: {
  'Lead ID': $json.lead_id, 'Created': $json.received_at, 'Source': $json.source,
  'Name': $json.name, 'Email': $json.email, 'Phone': $json.phone, 'Website': $json.domain,
  'Business': $json.business, 'City': $json.city,
  'Audit Score': String($json.audit.score), 'Audit Grade': $json.audit.grade, 'Site Up': $json.audit.site_up ? 'yes' : 'no',
  'Top Gaps': $json.q.top_gaps.map((g, i) => (i + 1) + '. ' + g.gap + ': ' + g.plain_explanation).join('\n'),
  'Segment': $json.q.segment, 'Tier': $json.q.tier, 'Fit Score': String($json.q.fit_score), 'Route': $json.q.route,
  'Reasons': $json.q.reasons.join('\n'), 'Plan': $json.q.recommended_plan, 'Confidence': $json.q.confidence,
  'Status': $json.status, 'Voice Summary': $json.q.voice_summary, 'Claude Model': '__QUALIFY_MODEL__',
  'Error': $json.claude_error
} }] }) }}"""

REPORT_EMAIL_JS = r"""
// The report the lead asked for. Plain template, no AI-written sales copy.
const l = $('Parse + Guardrails').item.json;
const first = (l.name || '').split(' ')[0] || 'there';
let body;
if (!l.audit.site_up) {
  body = `Hi ${first},\n\nYou asked for an AI visibility check on ${l.domain}. Our checker couldn't load the site, ` +
    `so AI assistants like ChatGPT probably can't read it either. That is the first thing to fix.\n\n` +
    `Kunal from node6 Labs may get in touch about it. If you'd rather not hear from us, reply "no".\n\nnode6 Labs`;
} else {
  const gaps = l.q.top_gaps.slice(0, 3).map((g, i) => `${i + 1}. ${g.gap}: ${g.plain_explanation}`).join('\n');
  body = `Hi ${first},\n\nHere is the quick AI visibility check for ${l.domain}.\n\n` +
    `Score: ${l.audit.score}/100 (grade ${l.audit.grade})\n\nWhat matters most:\n${gaps}\n\n` +
    `This is an automated first pass from 13 checks on your homepage. Kunal from node6 Labs may follow up personally. ` +
    `If you'd rather not hear from us, reply "no".\n\nnode6 Labs`;
}
return { json: { to: l.email, subject: `Your AI visibility report: ${l.audit.score}/100`, body } };
"""

EMAIL_REQ_JS = r"""
const SYSTEM = __EMAIL_PROMPT__;
const l = $('Parse + Guardrails').item.json;
const input = {
  first_name: (l.name || '').split(' ')[0], business: l.business, city: l.city, website: l.domain,
  segment: l.q.segment, audit_score: l.audit.score, site_up: l.audit.site_up,
  failed_checks: l.audit.checks.filter(c => c.status !== 'pass').map(c => ({ check: c.name, detail: c.detail })),
  top_gaps: l.q.top_gaps,
};
const schema = { type: 'object', additionalProperties: false, required: ['subject', 'body'],
  properties: { subject: { type: 'string' }, body: { type: 'string' } } };
return { json: { request: {
  model: '__DRAFT_MODEL__',
  max_tokens: 4000,
  output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
  system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'Write the follow-up email for this lead.\n\n' + JSON.stringify(input, null, 1) }],
} } };
"""

PARSE_DRAFT_JS = r"""
// Parses the draft and runs a light copy check. Falls back to a template so approval still happens.
const l = $('Parse + Guardrails').item.json;
const res = $json;
let d = null, note = '';
if (!res.error && res.stop_reason !== 'refusal') {
  const block = (res.content || []).find(b => b.type === 'text');
  try { d = JSON.parse(block.text); } catch (e) { d = null; }
}
if (!d) {
  note = 'TEMPLATE (Claude draft failed)';
  const first = (l.name || '').split(' ')[0] || 'there';
  d = { subject: `quick note on ${l.domain}`,
        body: `Hi ${first},\n\nThanks for running the check on ${l.domain}. It scored ${l.audit.score}/100, and the biggest gap is: ${(l.q.top_gaps[0] || {}).plain_explanation || 'see your report'}\n\nWorth a 15-minute call? I can show you what ChatGPT says today when buyers ask for a business like yours.\n\nKunal, node6 Labs` };
}
const banned = /\u2014|game-changer|unlock|supercharge|harness|revolutionary|delve|here's the thing|let that sink in|imagine if/i;
const flags = [];
d.body = d.body.replace(/\s*\u2014\s*/g, ', ');
if (banned.test(d.subject + ' ' + d.body)) flags.push('banned phrase');
const words = d.body.split(/\s+/).length;
if (words > 130) flags.push(words + ' words');
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const approval_html =
  `<p><b>Hot lead:</b> ${esc(l.name)}, ${esc(l.business)} (${esc(l.city || 'city unknown')})<br>` +
  `<b>Site:</b> ${esc(l.domain)} scored <b>${l.audit.score}/100</b> | Tier ${esc(l.q.tier)} | Plan idea: ${esc(l.q.recommended_plan)}<br>` +
  `<b>Why hot:</b> ${esc((l.q.reasons || []).join('; '))}</p>` +
  (note || flags.length ? `<p><b>Check:</b> ${esc([note, flags.join(', ')].filter(Boolean).join(' | '))}</p>` : '') +
  `<hr><p><b>Draft to ${esc(l.email)}</b><br><b>Subject:</b> ${esc(d.subject)}</p><p>${esc(d.body)}</p>`;
return { json: { ...d, note, approval_html, flags: flags.join(', '), record_id: (($('Airtable: Create Lead').item.json.records || [])[0] || {}).id || '' } };
"""

_UNUSED_SLACK_MSG = r"""=*Hot lead:* {{ $('Parse + Guardrails').item.json.name }}, {{ $('Parse + Guardrails').item.json.business }} ({{ $('Parse + Guardrails').item.json.city || 'city unknown' }})
*Site:* {{ $('Parse + Guardrails').item.json.domain }} scored *{{ $('Parse + Guardrails').item.json.audit.score }}/100* | Tier {{ $('Parse + Guardrails').item.json.q.tier }} | Plan idea: {{ $('Parse + Guardrails').item.json.q.recommended_plan }}
*Why hot:* {{ $('Parse + Guardrails').item.json.q.reasons.join('; ') }}
{{ $json.note ? '*Note:* ' + $json.note : '' }}{{ $json.flags ? ' *Copy flags:* ' + $json.flags : '' }}

*Draft to {{ $('Parse + Guardrails').item.json.email }}*
Subject: {{ $json.subject }}

{{ $json.body }}"""

CALL_JS = r"""
// Shapes a VAPI end-of-call report into one Calls row.
const m = $json.body.message || {};
const art = m.artifact || {};
const call = m.call || {};
return { json: { fields: {
  'Call ID': call.id || '',
  'Started': m.startedAt || call.startedAt || new Date().toISOString(),
  'Ended Reason': m.endedReason || '',
  'Caller Number': (call.customer && call.customer.number) || (m.customer && m.customer.number) || '',
  'Duration (s)': String(m.durationSeconds || ''),
  'Summary': m.summary || (m.analysis && m.analysis.summary) || '',
  'Transcript': (m.transcript || art.transcript || '').slice(0, 90000),
  'Recording URL': m.recordingUrl || art.recordingUrl || '',
  'Cost': String(m.cost || ''),
} } };
"""

ERROR_JS = r"""
const e = $json.execution || {};
return { json: {
  time: new Date().toISOString(),
  workflow: ($json.workflow || {}).name || '',
  node: e.lastNodeExecuted || '',
  message: ((e.error || {}).message || 'unknown error').slice(0, 1000),
  url: e.url || '',
} };
"""


def fill(js):
    return (js.replace("__QUALIFY_PROMPT__", json.dumps(QUALIFY_PROMPT))
              .replace("__EMAIL_PROMPT__", json.dumps(EMAIL_PROMPT))
              .replace("__QUALIFY_MODEL__", CFG["qualify_model"])
              .replace("__DRAFT_MODEL__", CFG["draft_model"]))


# ------------------------------------------------------------------ main workflow

def build_main():
    f = Flow("node6 Lead Engine (Week 4)")
    X = lambda i: 240 * i
    Y = 300

    sticky(f, "Note: Intake", "## 1. Intake\nTwo triggers, one lead shape.\n- Web form (public URL)\n- VAPI voice agent tool call (Riya)\nBad input goes to the Errors table.", (X(-1) - 40, 40), 700, 220, 4)
    sticky(f, "Note: Audit", "## 2. AI visibility audit\n5 HTTP fetches (homepage, GPTBot test, robots.txt, llms.txt, sitemap) then 13 scored checks. No server needed.", (X(3) - 40, 40), 1300, 220, 5)
    sticky(f, "Note: Claude", "## 3. Claude decides\nHaiku 5.5 qualifies (tier, route, gaps, spoken summary) with a JSON schema. Hard rules override it: score > 88 or no contact = disqualify.", (X(9) - 40, 40), 700, 220, 6)
    sticky(f, "Note: Actions", "## 4. Actions\n- Voice: answer Riya with the score\n- Every lead with email: report sent (they asked for it)\n- Hot: Sonnet 5.5 drafts, **Kunal approves by email**, then email sends\n- Nurture: draft emailed to Kunal only\n- Manual review: email alert", (X(13) - 40, -260), 760, 240, 3)

    # n8n won't run a Respond to Webhook node (needed to answer Riya mid-call) in a workflow
    # started by a Form Trigger, so the form lives in its own workflow and calls this one.
    form = f.node("From Form Intake", "n8n-nodes-base.executeWorkflowTrigger", 1.1,
                  {"inputSource": "passthrough"}, (X(-1), Y))

    vapi = f.node("Webhook: VAPI Tool Call", "n8n-nodes-base.webhook", 2, {
        "httpMethod": "POST", "path": "vapi-audit", "responseMode": "responseNode", "options": {},
    }, (X(-1), Y + 200), webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "node6-vapi-audit")))

    norm = f.node("Normalize Lead", "n8n-nodes-base.code", 2, code(NORMALIZE_JS), (X(0), Y + 100))
    valid = f.node("IF Valid Lead", "n8n-nodes-base.if", 2, if_bool("={{ $json.valid }}"), (X(1), Y + 100))
    f.link(form, norm)
    f.link(vapi, norm)
    f.link(norm, valid)

    # invalid path
    bad = f.node("Airtable: Log Invalid Lead", "n8n-nodes-base.httpRequest", 4.2, airtable("POST", "Errors", r"""={{ JSON.stringify({ typecast: true, records: [{ fields: {
  'Time': $json.received_at, 'Workflow': 'node6 Lead Engine', 'Node': 'IF Valid Lead',
  'Message': 'Invalid lead: ' + $json.invalid_reason, 'Payload': JSON.stringify({ source: $json.source, website: $json.website, email: $json.email }) } }] }) }}"""),
        (X(2), Y + 400), **SOFT)
    badvoice = f.node("IF Voice (invalid)", "n8n-nodes-base.if", 2,
                      if_equals("={{ $('Normalize Lead').item.json.source }}", "voice"), (X(3), Y + 400))
    badresp = f.node("Respond to VAPI (invalid)", "n8n-nodes-base.respondToWebhook", 1.1, {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ results: [{ toolCallId: $('Normalize Lead').item.json.tool_call_id, result: 'I could not run the check: ' + $('Normalize Lead').item.json.invalid_reason + '. Ask the caller to confirm their website and email, then try once more.' }] }) }}",
        "options": {}}, (X(4), Y + 400))
    f.link(valid, bad, 1)
    f.chain(bad, badvoice)
    f.link(badvoice, badresp, 0)

    # audit fetch chain
    base = "={{ $('Normalize Lead').item.json.base_url }}"
    fetches = [
        ("Fetch Homepage", base + "/", BROWSER_UA),
        ("Fetch as GPTBot", base + "/", GPTBOT_UA),
        ("Fetch robots.txt", base + "/robots.txt", BROWSER_UA),
        ("Fetch llms.txt", base + "/llms.txt", BROWSER_UA),
        ("Fetch sitemap.xml", base + "/sitemap.xml", BROWSER_UA),
    ]
    prev = valid
    for i, (name, url, ua) in enumerate(fetches):
        f.node(name, "n8n-nodes-base.httpRequest", 4.2, http_get(url, ua), (X(2 + i), Y), **SOFT)
        f.link(prev, name, 0)
        prev = name

    score = f.node("Score AI Visibility", "n8n-nodes-base.code", 2, code(SCORE_JS), (X(7), Y))
    qreq = f.node("Build Qualify Request", "n8n-nodes-base.code", 2, code(fill(QUALIFY_REQ_JS)), (X(8), Y))
    qcall = f.node("Claude: Qualify Lead", "n8n-nodes-base.httpRequest", 4.2,
                   claude_call("={{ JSON.stringify($json.request) }}"), (X(9), Y), **SOFT, **RETRY)
    parse = f.node("Parse + Guardrails", "n8n-nodes-base.code", 2, code(PARSE_QUALIFY_JS), (X(10), Y))
    create = f.node("Airtable: Create Lead", "n8n-nodes-base.httpRequest", 4.2,
                    airtable("POST", "Leads", fill(AIRTABLE_LEAD_BODY)), (X(11), Y), **SOFT, **RETRY)
    f.chain(prev, score, qreq, qcall, parse, create)

    # branch A (top, runs first): answer the voice agent
    isvoice = f.node("IF From Voice Call", "n8n-nodes-base.if", 2,
                     if_equals("={{ $('Parse + Guardrails').item.json.source }}", "voice"), (X(12), Y - 300))
    resp = f.node("Respond to VAPI", "n8n-nodes-base.respondToWebhook", 1.1, {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ results: [{ toolCallId: $('Parse + Guardrails').item.json.tool_call_id, result: $('Parse + Guardrails').item.json.q.voice_summary }] }) }}",
        "options": {}}, (X(13), Y - 300))
    f.link(create, isvoice)
    f.link(isvoice, resp, 0)

    # branch B: send the requested report
    hasmail = f.node("IF Has Email", "n8n-nodes-base.if", 2, {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                       "conditions": [{"id": str(uuid.uuid4()), "leftValue": "={{ $('Parse + Guardrails').item.json.email }}",
                                       "rightValue": "", "operator": {"type": "string", "operation": "notEmpty", "singleValue": True}}],
                       "combinator": "and"}, "options": {}}, (X(12), Y - 100))
    rep = f.node("Build Report Email", "n8n-nodes-base.code", 2, code(REPORT_EMAIL_JS), (X(13), Y - 100))
    sendrep = f.node("Gmail: Send Report", "n8n-nodes-base.gmail", 2.1, {
        "sendTo": "={{ $json.to }}", "subject": "={{ $json.subject }}", "emailType": "text",
        "message": "={{ $json.body }}", "options": {"appendAttribution": False, "senderName": "node6 Labs"},
    }, (X(14), Y - 100), **SOFT)
    markrep = f.node("Airtable: Mark Report Sent", "n8n-nodes-base.httpRequest", 4.2, airtable(
        "PATCH", "Leads",
        r"""={{ JSON.stringify({ typecast: true, records: [{ id: ($('Airtable: Create Lead').item.json.records || [{}])[0].id, fields: { 'Report Sent': $json.error ? 'failed' : 'yes' } }] }) }}"""),
        (X(15), Y - 100), **SOFT)
    f.link(create, hasmail)
    f.link(hasmail, rep, 0)
    f.chain(rep, sendrep, markrep)

    # branch C: route by fit
    rules = []
    for key in ["hot", "nurture", "disqualify", "manual_review"]:
        rules.append({"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                                     "conditions": [{"id": str(uuid.uuid4()),
                                                     "leftValue": "={{ $('Parse + Guardrails').item.json.q.route }}",
                                                     "rightValue": key, "operator": {"type": "string", "operation": "equals"}}],
                                     "combinator": "and"},
                      "renameOutput": True, "outputKey": key})
    route = f.node("Route by Fit", "n8n-nodes-base.switch", 3.2, {"rules": {"values": rules}, "options": {}},
                   (X(12), Y + 200))
    f.link(create, route)

    # hot
    ereq = f.node("Build Email Request", "n8n-nodes-base.code", 2, code(fill(EMAIL_REQ_JS)), (X(13), Y + 100))
    ecall = f.node("Claude: Draft Follow-up", "n8n-nodes-base.httpRequest", 4.2,
                   claude_call("={{ JSON.stringify($json.request) }}"), (X(14), Y + 100), **SOFT, **RETRY)
    eparse = f.node("Parse Draft + Copy Check", "n8n-nodes-base.code", 2, code(PARSE_DRAFT_JS), (X(15), Y + 100))
    await_ = f.node("Airtable: Awaiting Approval", "n8n-nodes-base.httpRequest", 4.2, airtable("PATCH", "Leads",
        r"""={{ JSON.stringify({ typecast: true, records: [{ id: $json.record_id, fields: { 'Status': 'awaiting_approval', 'Email Subject': $json.subject, 'Email Draft': $json.body } }] }) }}"""),
        (X(16), Y + 100), **SOFT)
    approve = f.node("Gmail: Approve Follow-up", "n8n-nodes-base.gmail", 2.1, {
        "operation": "sendAndWait", "sendTo": APPROVER,
        "subject": "={{ 'Approve follow-up: ' + $('Parse + Guardrails').item.json.domain + ' (' + $('Parse + Guardrails').item.json.audit.score + '/100)' }}",
        "message": "={{ $('Parse Draft + Copy Check').item.json.approval_html }}",
        "approvalOptions": {"values": {"approvalType": "double", "approveLabel": "Send email", "disapproveLabel": "Don't send"}},
        "options": {"appendAttribution": False, "limitWaitTime": {"values": {"limitType": "afterTimeInterval", "resumeAmount": 24, "resumeUnit": "hours"}}},
    }, (X(17), Y + 100))
    approved = f.node("IF Approved", "n8n-nodes-base.if", 2, if_bool("={{ $json.data && $json.data.approved }}"), (X(18), Y + 100))
    send = f.node("Gmail: Send Follow-up", "n8n-nodes-base.gmail", 2.1, {
        "sendTo": "={{ $('Parse + Guardrails').item.json.email }}",
        "subject": "={{ $('Parse Draft + Copy Check').item.json.subject }}", "emailType": "text",
        "message": "={{ $('Parse Draft + Copy Check').item.json.body }}",
        "options": {"appendAttribution": False, "senderName": CFG["sender_name"]},
    }, (X(19), Y), **SOFT)
    sent = f.node("Airtable: Mark Sent", "n8n-nodes-base.httpRequest", 4.2, airtable("PATCH", "Leads",
        r"""={{ JSON.stringify({ typecast: true, records: [{ id: $('Parse Draft + Copy Check').item.json.record_id, fields: { 'Status': $json.error ? 'send_failed' : 'sent' } }] }) }}"""),
        (X(20), Y), **SOFT)
    rejected = f.node("Airtable: Mark Not Sent", "n8n-nodes-base.httpRequest", 4.2, airtable("PATCH", "Leads",
        r"""={{ JSON.stringify({ typecast: true, records: [{ id: $('Parse Draft + Copy Check').item.json.record_id, fields: { 'Status': 'not_approved' } }] }) }}"""),
        (X(19), Y + 200), **SOFT)
    callback = f.node("VAPI: Callback Call (optional)", "n8n-nodes-base.httpRequest", 4.2, {
        "method": "POST", "url": "https://api.vapi.ai/call",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ assistantId: '" + CFG.get("vapi_assistant_id", "") + "', phoneNumberId: '" + CFG.get("vapi_phone_number_id", "") + "', customer: { number: $('Parse + Guardrails').item.json.phone } }) }}",
        "options": {}}, (X(20), Y - 160), disabled=True, **SOFT)
    f.link(route, ereq, 0)
    f.chain(ereq, ecall, eparse, await_, approve, approved)
    f.link(approved, send, 0)
    f.link(approved, rejected, 1)
    f.link(send, sent)
    f.link(send, callback)

    # nurture
    draft = f.node("Gmail: Nurture Draft", "n8n-nodes-base.gmail", 2.1, {
        "resource": "draft", "subject": "={{ 'following up on ' + $('Parse + Guardrails').item.json.domain }}",
        "emailType": "text",
        "message": "={{ 'Hi ' + (($('Parse + Guardrails').item.json.name || '').split(' ')[0] || 'there') + ',\\n\\nChecking in on the AI visibility report for ' + $('Parse + Guardrails').item.json.domain + '. If fixing the gaps is on your list this quarter, I can walk you through it in 15 minutes.\\n\\nKunal, node6 Labs' }}",
        "options": {"sendTo": "={{ $('Parse + Guardrails').item.json.email }}"},
    }, (X(13), Y + 330), **SOFT)
    f.link(route, draft, 1)

    # disqualify: already stored with status disqualified. Nothing else is sent.
    dq = f.node("Done: Disqualified (no contact)", "n8n-nodes-base.noOp", 1, {}, (X(13), Y + 480))
    f.link(route, dq, 2)

    # manual review
    review = f.node("Gmail: Manual Review Alert", "n8n-nodes-base.gmail", 2.1, {
        "sendTo": APPROVER,
        "subject": "={{ 'Needs a human look: ' + $('Parse + Guardrails').item.json.domain }}",
        "emailType": "text",
        "message": "={{ 'Lead: ' + $('Parse + Guardrails').item.json.name + ' / ' + $('Parse + Guardrails').item.json.domain + ' (score ' + $('Parse + Guardrails').item.json.audit.score + '). Reason: ' + $('Parse + Guardrails').item.json.q.reasons.join('; ') }}",
        "options": {"appendAttribution": False, "senderName": "node6 Lead Engine"},
    }, (X(13), Y + 630), **SOFT)
    f.link(route, review, 3)

    # VAPI end-of-call reports -> Calls table
    ev = f.node("Webhook: VAPI Call Events", "n8n-nodes-base.webhook", 2, {
        "httpMethod": "POST", "path": "vapi-events", "responseMode": "onReceived", "options": {},
    }, (X(-1), Y + 800), webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "node6-vapi-events")))
    isend = f.node("IF End-of-Call Report", "n8n-nodes-base.if", 2,
                   if_equals("={{ $json.body.message && $json.body.message.type }}", "end-of-call-report"), (X(0), Y + 800))
    shape = f.node("Shape Call Record", "n8n-nodes-base.code", 2, code(CALL_JS), (X(1), Y + 800))
    logcall = f.node("Airtable: Log Call", "n8n-nodes-base.httpRequest", 4.2, airtable("POST", "Calls",
        "={{ JSON.stringify({ typecast: true, records: [{ fields: $json.fields }] }) }}"), (X(2), Y + 800), **SOFT, **RETRY)
    sticky(f, "Note: Calls", "## 5. Call log\nVAPI posts an end-of-call report (summary, transcript, recording) after every call.", (X(-1) - 40, Y + 640), 700, 140, 2)
    f.chain(ev, isend)
    f.link(isend, shape, 0)
    f.chain(shape, logcall)

    return f


def build_form():
    f = Flow("node6 Form Intake (Week 4)")
    form = f.node("Form: Free AI Visibility Check", "n8n-nodes-base.formTrigger", 2.2, {
        "formTitle": "Free AI visibility check",
        "formDescription": "Find out if ChatGPT, Perplexity and Gemini can read and recommend your business. Takes about a minute. Report by email.",
        "formFields": {"values": [
            {"fieldLabel": "Your name", "requiredField": True},
            {"fieldLabel": "Work email", "fieldType": "email", "requiredField": True},
            {"fieldLabel": "Phone (optional)"},
            {"fieldLabel": "Website", "placeholder": "yourcompany.com", "requiredField": True},
            {"fieldLabel": "What does your business do?", "placeholder": "e.g. industrial valve manufacturer", "requiredField": True},
            {"fieldLabel": "City", "placeholder": "Mumbai"},
            {"fieldLabel": "Consent", "fieldType": "dropdown", "requiredField": True,
             "fieldOptions": {"values": [{"option": "I agree that node6 Labs may email me this report and follow up about it"}]}},
        ]},
        "options": {"appendAttribution": False, "path": "ai-visibility-check"},
    }, (0, 300), webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "node6-form")))
    call = f.node("Send to Lead Engine", "n8n-nodes-base.executeWorkflow", 1.2, {
        "workflowId": {"__rl": True, "value": CFG.get("n8n_main_workflow_id", ""), "mode": "id"},
        "options": {"waitForSubWorkflow": False},
    }, (260, 300))
    f.link(form, call)
    return f


def build_error():
    f = Flow("node6 Error Handler (Week 4)")
    t = f.node("Error Trigger", "n8n-nodes-base.errorTrigger", 1, {}, (0, 300))
    s = f.node("Shape Error", "n8n-nodes-base.code", 2, code(ERROR_JS), (240, 300))
    a = f.node("Gmail: Error Alert", "n8n-nodes-base.gmail", 2.1, {
        "sendTo": APPROVER,
        "subject": "={{ 'node6 workflow failed at ' + $json.node }}",
        "emailType": "text",
        "message": "={{ $json.workflow + ' failed at ' + $json.node + '. ' + $json.message + ' ' + $json.url }}",
        "options": {"appendAttribution": False, "senderName": "node6 Lead Engine"},
    }, (480, 200), **SOFT)
    b = f.node("Airtable: Log Error", "n8n-nodes-base.httpRequest", 4.2, airtable("POST", "Errors",
        "={{ JSON.stringify({ typecast: true, records: [{ fields: { 'Time': $json.time, 'Workflow': $json.workflow, 'Node': $json.node, 'Message': $json.message, 'Execution URL': $json.url } }] }) }}"),
        (480, 400), **SOFT)
    f.link(t, s)
    f.link(s, a)
    f.link(s, b)
    return f



def to_smtp(flow):
    """Gmail OAuth needs a pop-up the browser pane blocks, so mail goes out over SMTP
    (Gmail app password). Converts every Gmail node into an n8n Send Email node."""
    sender = CFG["approver_email"]
    renames = {}
    for n in flow.nodes:
        if n["type"] != "n8n-nodes-base.gmail":
            continue
        p = n["parameters"]
        opts = p.get("options", {})
        name_from = opts.get("senderName", "node6 Labs")
        frm = f"{name_from} <{sender}>"
        if p.get("operation") == "sendAndWait":
            new = {"operation": "sendAndWait", "fromEmail": frm, "toEmail": p["sendTo"],
                   "subject": p["subject"], "message": p["message"],
                   "approvalOptions": p["approvalOptions"],
                   "options": {"limitWaitTime": opts["limitWaitTime"]}}
        elif p.get("resource") == "draft":
            new = {"fromEmail": frm, "toEmail": APPROVER,
                   "subject": "={{ 'Nurture lead, draft to send later: ' + $('Parse + Guardrails').item.json.domain }}",
                   "emailFormat": "text",
                   "text": "={{ 'To: ' + $('Parse + Guardrails').item.json.email + '\\n\\n' + (" + p["message"][3:-2].strip() + ") }}",
                   "options": {"appendAttribution": False}}
            renames[n["name"]] = "Email: Nurture Draft to Kunal"
        else:
            new = {"fromEmail": frm, "toEmail": p["sendTo"], "subject": p["subject"],
                   "emailFormat": "text", "text": p["message"], "options": {"appendAttribution": False}}
        n["parameters"] = new
        n["type"] = "n8n-nodes-base.emailSend"
        n["typeVersion"] = 2.1
        renames.setdefault(n["name"], n["name"].replace("Gmail:", "Email:"))
    for n in flow.nodes:
        if n["name"] in renames:
            n["name"] = renames[n["name"]]
    new_conns = {}
    for src, v in flow.conns.items():
        for outs in v["main"]:
            for c in outs:
                c["node"] = renames.get(c["node"], c["node"])
        new_conns[renames.get(src, src)] = v
    flow.conns = new_conns
    return flow



def attach_credentials(flow):
    """Points each node at the credentials already created in n8n (ids in config.json)."""
    creds = CFG.get("n8n_credentials") or {}
    for n in flow.nodes:
        p = n["parameters"]
        if n["type"] == "n8n-nodes-base.httpRequest":
            if p.get("nodeCredentialType") == "airtableTokenApi" and "airtable" in creds:
                n["credentials"] = {"airtableTokenApi": creds["airtable"]}
            elif "api.anthropic.com" in p.get("url", "") and "anthropic" in creds:
                n["credentials"] = {"httpHeaderAuth": creds["anthropic"]}
        elif n["type"] == "n8n-nodes-base.emailSend" and "smtp" in creds:
            n["credentials"] = {"smtp": creds["smtp"]}
    return flow


def build_vapi():
    hook = CFG["n8n_base_url"].rstrip("/") + "/webhook"
    return {
        "name": "Riya - node6 AI visibility line",
        "firstMessage": "Hi, this is Riya, an AI assistant for node6 Labs. This call is recorded. I can check how ChatGPT and other AI assistants see your website, free. What does your business do?",
        "model": {
            "provider": "anthropic",
            "model": "PICK_LATEST_CLAUDE_SONNET_IN_VAPI_DROPDOWN",
            "messages": [{"role": "system", "content": VOICE_PROMPT}],
            "tools": [{
                "type": "function",
                "async": False,
                "function": {
                    "name": "run_ai_visibility_check",
                    "description": "Runs node6 Labs' AI visibility check on the caller's website, saves the lead, and returns a short spoken summary of the score and the main fix.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "Caller's name"},
                            "business": {"type": "string", "description": "What the business does"},
                            "city": {"type": "string", "description": "City the business serves"},
                            "website": {"type": "string", "description": "Website domain, e.g. example.com"},
                            "email": {"type": "string", "description": "Email for the report, confirmed with the caller"},
                            "phone": {"type": "string", "description": "Phone number if the caller gave a different one"},
                        },
                        "required": ["name", "business", "website", "email"],
                    },
                },
                "messages": [{"type": "request-start", "content": "Give me about twenty seconds, I'm checking how AI assistants see your site."}],
                "server": {"url": hook + "/vapi-audit", "timeoutSeconds": 45},
            }],
        },
        "voice": {"provider": "11labs", "voiceId": CFG["elevenlabs_voice_id"]},
        "transcriber": {"provider": "deepgram", "model": "nova-3", "language": "en"},
        "server": {"url": hook + "/vapi-events"},
        "serverMessages": ["end-of-call-report"],
        "endCallFunctionEnabled": True,
        "maxDurationSeconds": 480,
        "recordingEnabled": True,
    }


def write(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
    print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    write(os.path.join(HERE, "node6-lead-engine.json"), attach_credentials(to_smtp(build_main())).export(CFG.get("n8n_error_workflow_id", "")))
    write(os.path.join(HERE, "node6-error-handler.json"), attach_credentials(to_smtp(build_error())).export())
    write(os.path.join(HERE, "node6-form-intake.json"), build_form().export(CFG.get("n8n_error_workflow_id", "")))
    os.makedirs(os.path.join(ROOT, "vapi"), exist_ok=True)
    write(os.path.join(ROOT, "vapi", "assistant.json"), build_vapi())
