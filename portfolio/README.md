# node6 Labs Audit & Lead Desk

**Mitull Dave | Product development and workflow automation**

A business owner can check their website, inspect the evidence behind one recommended fix and ask node6 Labs for help. On the agency side, a workflow qualifies incoming enquiries, records them in Airtable and drafts a follow-up for approval.

[Watch the 30-second product demo](../submission/Backup-demo.mp4)

![The report for node6 Labs showing its first action and the evidence behind a 95 out of 100 score](../submission/02-first-action.png)

## What the owner sees

On 19 November 2026, the checker awarded node6labs.com 95 out of 100 points. The FAQ check accounted for the five-point gap. The parser found one question-style heading on the homepage. A developer can inspect that source, and someone on the delivery team can decide which buyer questions deserve an answer.

The report shows the source and points for each of its 13 checks. If a source is unavailable, the report leaves those points out of the denominator. The score measures observable website signals. Measuring mentions in AI answers would require a separate citation test.

## What happens when someone wants help

The visitor can read the report without giving an email address. Requesting a conversation opens the agency intake form. Once a visitor submits their details, the n8n workflow runs a website audit, asks Claude to qualify the enquiry, and writes the lead to Airtable. A reviewer can approve or reject the personalized follow-up before it goes out.

On 12 November, a form test with a 57-point audit reached the hot-lead route, created the Airtable record and sent the approved follow-up. A separate rejection test exercised the decision to withhold an email. Those runs tested the agency workflow. The later public-app test reached the intake page and stopped before submitting contact information.

## How the three builds fit together

| Build | Contribution to the product |
| --- | --- |
| Week 4 | The agency workflow, qualification prompts, approval step and error handling. A VAPI voice intake adapter was exercised with simulated tool calls. |
| Week 5 | The Next.js app, public URL validation and reusable audit API. |
| Week 6 | The evidence report, prioritized fix, mobile experience, sample data and consent-based handoff. |

The published preview ran its first-action selection with audit rules. The Claude explanation path is implemented and requires a configured API key and a verified live run. An optional authenticated webhook supports an in-app callback form. The preview currently opens the hosted intake form.

## Engineering walkthrough

- [Audit and scoring code](../src/lib/audit/)
- [Agency automation source and prompts](../automation/)
- [Environment and intake setup](../docs/week6-setup.md)
- [Website test evidence](../submission/Week-6-and-Milestone-4-write-up.pdf)

To reproduce the workflow templates, run `python automation/n8n/build_workflow.py` from the repository root. The generator defaults to the example configuration. To run the workflows on your own accounts, copy `automation/config.example.json` to `automation/config.json`, supply your instance settings, generate the workflows, and connect your credentials inside n8n.

## What I would measure after launch

I would follow one consented enquiry from its original report to the reviewer's decision and measure the time to an approved response. The current evidence covers functional tests. Conversion and client acquisition remain open questions.
