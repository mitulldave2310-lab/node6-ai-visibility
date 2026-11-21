# Lead Desk (Week 6 product)

Page: `/desk.html` (the root redirects there). The Week 5/6 visibility check stays at `/visibility.html`.

## Two ways in, one engine
- **Research a company** (`POST /api/desk/research {website, company?}`): outbound. Returns a decision card and a first-touch draft. The app never sends it.
- **Send an enquiry** (`POST /api/desk/enquiry {name, email, website, message, consent}`): inbound. Same engine, then the result goes to the n8n workflow `node6 Enquiry Desk (Week 6)`, which emails the approver a decision card with Send reply / Don't send buttons.

## Engine (`src/lib/desk/`)
1. Read the website and run the 13 audit checks (`fetchSite`, `buildReport`).
2. Web research: Sonnet 5.5 with the web search tool, at most 3 searches. Cited snippets become `web:<n>` sources.
3. Decision: Haiku 5.5 with structured output (`DecisionSchema`): service, fit tier and score, buyer roles, quoted signals, missing info, next step.
4. Guardrails (`guardrails.ts`): every quote is checked against the source it names; unverified signals are marked. No verified signal means manual review. Outbound drafts only for tier A or B. Enquiries are never dropped.
5. Draft: Sonnet 5.5 with structured output, then `checkCopy` (word limit, no long dashes, banned phrases, no placeholders, every number must appear in the evidence, must use a verified fact). One automatic rewrite if it fails.

Business rules (ICP, services, limits, banned phrases) live in `constants.ts`. Model IDs too.

## Environment
| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | Both routes. Without it they return 503 with a plain message. |
| `N8N_DESK_WEBHOOK_URL` | Enquiries. Production URL of the `Desk Enquiry` webhook node. |
| `N8N_WEBHOOK_TOKEN` | Enquiries. Must match the Header Auth credential on the webhook (header name `X-Intake-Token`). |
| `DESK_DEBUG=1` | Local only. Enquiry route returns the decision card and works without n8n. |

## n8n setup
1. `python automation/n8n/build_desk_workflow.py` (reads `week4/config.json` for credential ids).
2. Import `automation/n8n/node6-enquiry-desk.json` into n8n.
3. On the `Desk Enquiry` node, create a Header Auth credential: name `X-Intake-Token`, value = the same secret as `N8N_WEBHOOK_TOKEN`.
4. Publish the workflow, copy the production webhook URL into `N8N_DESK_WEBHOOK_URL`.

## Cost per run (rough)
One research call with up to 3 searches, one Haiku decision, one or two Sonnet drafts. Routes are rate limited per connection (8 research and 5 enquiries per 10 minutes per server instance).
