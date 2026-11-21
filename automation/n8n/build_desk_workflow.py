#!/usr/bin/env python3
"""
Builds the n8n workflow behind the Lead Desk enquiry form (Week 6).

App (/api/desk/enquiry) researches the enquiry, Claude decides and drafts, then POSTs here.
This workflow logs it in Airtable, emails the approver a decision card with Send reply /
Don't send buttons, and only sends the reply to the enquirer after approval.

Reuses the Week 4 helpers and credential ids (week4/config.json).
Usage: python build_desk_workflow.py   ->  node6-enquiry-desk.json (import into n8n)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEEK4 = os.path.normpath(os.path.join(HERE, "..", "..", "..", "week4", "n8n"))
sys.path.insert(0, WEEK4)
from build_workflow import APPROVER, CFG, Flow, airtable, attach_credentials, if_bool  # noqa: E402

SENDER = CFG["approver_email"]

SHAPE_JS = r"""
const b = $json.body || $json;
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const lines = s => esc(s).split('\n').filter(Boolean);
const li = arr => arr.length ? '<ul>' + arr.map(x => '<li>' + x + '</li>').join('') + '</ul>' : '<p>None.</p>';
const route = { draft: 'Send a reply', ask_for_info: 'Reply and ask for details', manual_review: 'Person to review', disqualify: 'Not a fit' }[b.route] || b.route;
const html =
  '<h2 style="margin:0 0 4px">' + esc(b.company || b.website) + '</h2>' +
  '<p style="margin:0 0 12px;color:#555">' + esc(b.name) + ' &lt;' + esc(b.email) + '&gt; · ref ' + esc(b.reference) + '</p>' +
  '<blockquote style="border-left:3px solid #a73a12;margin:0 0 16px;padding:8px 12px;background:#f5f2e9">' + esc(b.message) + '</blockquote>' +
  '<table cellpadding="6" style="border-collapse:collapse;margin-bottom:12px">' +
  '<tr><td><b>Lead with</b></td><td>' + esc(b.service_label) + '</td></tr>' +
  '<tr><td><b>Fit</b></td><td>Tier ' + esc(b.fit_tier) + ' · ' + esc(b.fit_score) + '/100</td></tr>' +
  '<tr><td><b>Urgency</b></td><td>' + esc(b.urgency) + '</td></tr>' +
  '<tr><td><b>Next step</b></td><td>' + esc(route) + '</td></tr>' +
  '<tr><td><b>Website audit</b></td><td>' + esc(b.audit_score) + '</td></tr></table>' +
  '<p><b>Why:</b> ' + esc(b.service_reason) + '</p>' +
  '<p><b>Verified evidence</b></p>' + li(lines(b.signals_text)) +
  (b.unverified_count ? '<p style="color:#a73a12">' + b.unverified_count + ' claim(s) could not be verified and were left out.</p>' : '') +
  '<p><b>Rules that changed Claude\'s call</b></p>' + li(lines(b.overrides)) +
  '<p><b>Still to find out:</b> ' + esc(b.missing_info || 'nothing major') + '</p>' +
  (b.draft_body
    ? '<hr><p><b>Draft reply</b> (copy check: ' + esc(b.copy_check) + ')</p><p><b>Subject:</b> ' + esc(b.draft_subject) + '</p><pre style="white-space:pre-wrap;font-family:inherit">' + esc(b.draft_body) + '</pre>'
    : '<hr><p><b>No draft was written.</b> Reply to this person yourself.</p>');
return { json: { ...b, approval_html: html, has_draft: !!b.draft_body } };
"""

LOG_FIELDS = r"""={{ JSON.stringify({ typecast: true, records: [{ fields: {
  'Lead ID': $json.reference, 'Created': $json.received_at, 'Source': 'lead-desk',
  'Name': $json.name, 'Email': $json.email, 'Website': $json.website, 'Business': $json.summary,
  'Audit Score': String($json.audit_score), 'Segment': $json.service_label, 'Tier': $json.fit_tier,
  'Fit Score': String($json.fit_score), 'Route': $json.route,
  'Reasons': $json.signals_text + ($json.overrides ? '\n\nRules: ' + $json.overrides : ''),
  'Plan': $json.missing_info, 'Confidence': $json.urgency, 'Status': 'awaiting_approval',
  'Email Subject': $json.draft_subject, 'Email Draft': $json.draft_body, 'Claude Model': 'claude-haiku-5-5 + claude-sonnet-5-5'
} }] }) }}"""


def status(record_expr, value):
    return airtable("PATCH", "Leads",
        "={{ JSON.stringify({ typecast: true, records: [{ id: " + record_expr + ", fields: { 'Status': " + value + " } }] }) }}")


def build():
    f = Flow("node6 Enquiry Desk (Week 6)")
    soft = {"onError": "continueRegularOutput", "alwaysOutputData": True}
    hook = f.node("Desk Enquiry", "n8n-nodes-base.webhook", 2, {
        "httpMethod": "POST", "path": "desk-enquiry", "authentication": "headerAuth",
        "responseMode": "onReceived", "options": {}}, (0, 300))
    shape = f.node("Shape Decision Card", "n8n-nodes-base.code", 2, {"jsCode": SHAPE_JS, "mode": "runOnceForEachItem"}, (240, 300))
    log = f.node("Airtable: Log Enquiry", "n8n-nodes-base.httpRequest", 4.2, airtable("POST", "Leads", LOG_FIELDS), (480, 300), **soft)
    has = f.node("IF Has Draft", "n8n-nodes-base.if", 2, if_bool("={{ $('Shape Decision Card').item.json.has_draft }}"), (720, 300))
    card = "$('Shape Decision Card').item.json"
    approve = f.node("Email: Approve Reply", "n8n-nodes-base.emailSend", 2.1, {
        "operation": "sendAndWait", "fromEmail": f"node6 Lead Desk <{SENDER}>", "toEmail": APPROVER,
        "subject": "={{ 'Approve reply: ' + (" + card + ".company || " + card + ".website) + ' (' + " + card + ".service_label + ', tier ' + " + card + ".fit_tier + ')' }}",
        "message": "={{ " + card + ".approval_html }}",
        "approvalOptions": {"values": {"approvalType": "double", "approveLabel": "Send reply", "disapproveLabel": "Don't send"}},
        "options": {"limitWaitTime": {"values": {"limitType": "afterTimeInterval", "resumeAmount": 24, "resumeUnit": "hours"}}},
    }, (960, 200))
    approved = f.node("IF Approved", "n8n-nodes-base.if", 2, if_bool("={{ $json.data && $json.data.approved }}"), (1200, 200))
    send = f.node("Email: Send Reply", "n8n-nodes-base.emailSend", 2.1, {
        "fromEmail": f"node6 Labs <{SENDER}>", "toEmail": "={{ " + card + ".email }}",
        "subject": "={{ " + card + ".draft_subject }}", "emailFormat": "text",
        "text": "={{ " + card + ".draft_body }}", "options": {"appendAttribution": False},
    }, (1440, 100), **soft)
    rec = "$('Airtable: Log Enquiry').item.json.records[0].id"
    sent = f.node("Airtable: Mark Sent", "n8n-nodes-base.httpRequest", 4.2, status(rec, "$json.error ? 'send_failed' : 'sent'"), (1680, 100), **soft)
    rejected = f.node("Airtable: Mark Not Sent", "n8n-nodes-base.httpRequest", 4.2, status(rec, "'not_approved'"), (1440, 300), **soft)
    review = f.node("Email: Manual Review", "n8n-nodes-base.emailSend", 2.1, {
        "fromEmail": f"node6 Lead Desk <{SENDER}>", "toEmail": APPROVER,
        "subject": "={{ 'Enquiry needs a person: ' + (" + card + ".company || " + card + ".website) }}",
        "emailFormat": "html", "html": "={{ " + card + ".approval_html }}", "options": {"appendAttribution": False},
    }, (960, 420), **soft)
    f.chain(hook, shape, log, has)
    f.link(has, approve, 0)
    f.link(has, review, 1)
    f.link(approve, approved)
    f.link(approved, send, 0)
    f.link(approved, rejected, 1)
    f.link(send, sent)
    return f


if __name__ == "__main__":
    out = os.path.join(HERE, "node6-enquiry-desk.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(attach_credentials(build()).export(CFG.get("n8n_error_workflow_id", "")), fh, indent=2, ensure_ascii=False)
    print("wrote", out)
