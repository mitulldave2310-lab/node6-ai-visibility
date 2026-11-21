# Week 6 local setup

Run npm ci and npm run dev from this folder. Open the address printed by Next.js. The original Week 5 API remains at /api/audit. The Week 6 report is at /api/report.

## Claude explanation

Set ANTHROPIC_API_KEY in the server environment and optionally set ANTHROPIC_MODEL to a Messages-compatible model available to that account. Restart the server. A successful model selection is labelled Claude in the report. Otherwise the page labels the rule-based explanation Audit rules.

## Consent-based intake

The default handoff opens the Week 4 public intake form. To accept requests inside the checker, import docs/week6-n8n-intake.json into the Week 4 n8n instance, verify the existing Lead Engine workflow ID, and attach a Header Auth credential named X-Intake-Token to the webhook node. After activating it, set N8N_WEBHOOK_URL to its production HTTPS endpoint and N8N_WEBHOOK_TOKEN to the matching secret on the app server. Restart the app. Only visitors who submit the consent form send contact details.

## Demo Day

The submission folder contains the write-up, five-slide PDF, editable Gamma import text and timed run of show. The fictional sample requires no network credentials. For a live Claude demo, confirm the author line before presenting. Complete the event-specific observations after Demo Day.
