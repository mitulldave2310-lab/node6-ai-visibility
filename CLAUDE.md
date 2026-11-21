# node6 Labs Lead Desk

Main product (Week 6): the Lead Desk at `/desk.html`. Enter a company and Claude researches it, picks the node6 service that fits, names the buyer roles, quotes its evidence and drafts a first message (outbound drafts are never sent). The same engine handles inbound enquiries and hands them to an n8n workflow that emails a person for approval before any reply goes out. See `docs/lead-desk.md`.

The older visibility check (`/visibility.html`, `/api/report`, `/api/audit`) measures website signals only. It does not measure whether AI assistants cite a site.

Users: business owners (public, no login, often on mobile) and node6 Labs as operator.

## Stack
- Next.js 15 App Router, TypeScript strict, Tailwind v4. Deployed on Vercel (push to `main` deploys).
- Claude API via `@anthropic-ai/sdk` with structured outputs: Haiku 5.5 decides, Sonnet 5.5 researches (web search) and writes. Model IDs in `src/lib/desk/constants.ts`.
- n8n Cloud: `node6 Enquiry Desk (Week 6)` receives enquiries (approval by email, Airtable log). Generator: `automation/n8n/build_desk_workflow.py`.
- Tests: Vitest. No database: Airtable (via n8n) is the store.

## Commands
- `npm run dev`: local server on http://localhost:3000 (the desktop app preview in `.claude/launch.json` uses 3123)
- `npm test`: Vitest, must pass before every commit
- Windows: stopping a backgrounded `next start` can orphan the child process. Find it by port (`netstat -ano | findstr :3000`) and stop only that PID. Never kill all node processes.
- `npm run typecheck` and `npm run lint`: must be clean
- `npm run build`: run before pushing anything that touches routes or config
- Quick check: `curl "http://localhost:3000/api/audit?url=example.com"`

## Layout
- `src/app/api/audit/route.ts`: GET `?url=` or POST `{url}` returns the scored audit JSON. Keep it thin.
- `src/lib/audit/analyze.ts`: pure scoring, 13 checks, points sum to 100. No I/O. Mirrors Week 4 `n8n/audit.js`.
- `src/lib/audit/fetch-site.ts`: URL normalising, SSRF guard, fetching. All outbound fetches to user-supplied hosts go through `safeGet`.
- `src/lib/desk/`: Lead Desk engine (`engine.ts`), Claude calls (`claude.ts`), schemas, guardrails and copy check (`guardrails.ts`), business rules (`constants.ts`). Tests in `desk.test.ts` use a fake Claude.
- `src/lib/n8n/desk.ts`: forwards enquiries to the n8n approval workflow.
- `public/desk.html`, `desk.js`, `desk.css`: the Lead Desk page (plain HTML and JS, no React).
- `src/lib/audit/client.ts`: browser-side `requestAudit()` and `sortChecks()`. No React, so it is unit-tested.
- `src/components/`: React components. `AuditForm` (client, owns state) renders `AuditReport` (presentational).
- `docs/brief.md`: product brief summary, Week 6 build order and known limits. Read it before planning a feature.

## Audit API contract (UI and n8n depend on it)
Response: `{ url, site_up, score (0-100), grade (A-F), checks[{id,name,points,earned,status:"pass"|"warn"|"fail",detail,fix}], top_gaps[{id,name,fix,detail}], signals{title,description,h1,schema_types,words,text_sample}, audited_at, took_ms }`.
Errors: `{ error: string }` with 400 (bad input), 422 (domain not found), 500. Error text is user-facing: plain, short, says what to do.
Adding fields is fine. Renaming or removing fields breaks n8n, so don't.
UI: shows every check sorted fail, then warn ("Partial"), then pass, with the `fix` box whenever `fix` is non-empty. `top_gaps` is for n8n and emails. `signals` is input for the Claude report (planned) and isn't shown raw.

## Rules
- Scoring changes: edit `analyze.ts`, update `analyze.test.ts`, keep points summing to 100, and note the change in the PR so the n8n Code node can be updated too.
- Never fetch a user-supplied URL with plain `fetch`. Use `safeGet` (blocks private IPs, checks every redirect).
- Secrets live in env vars only (`ANTHROPIC_API_KEY`, `N8N_WEBHOOK_URL`). Never commit `.env*`. Read them server-side only, never in client components.
- Claude model IDs go in one constants file when added, not scattered.
- Mobile first. The demo audience opens this on their phones.
- UI copy (page text, buttons, client and API errors): plain sentences, say what to do next, no hype words (unlock, supercharge, game-changer), no em dashes, no emojis.
- Look: neutral greys with one accent per grade until brand colours land in `docs/`. Support light and dark (globals.css switches on `prefers-color-scheme`). Font is Geist from `layout.tsx`.
- Git: branch `feat/<name>` or `fix/<name>` off `main`, one commit per coherent change (a feature with its tests is one commit), message says what and why. Don't add dependencies without a reason in the commit message.

## Testing
- Vitest, Node environment, config in `vitest.config.ts`. Tests sit next to the code as `*.test.ts`. The `@/` alias works in tests.
- Put logic in plain modules under `src/lib/` and unit-test those. Components stay thin and are not unit-tested yet (no jsdom or Testing Library, on purpose). Check them in the browser instead.

## Definition of done for a feature
Tests added or updated for any logic and passing, typecheck and lint clean, `npm run build` passes, checked in the browser at 375px and 1280px (no horizontal scroll), in light and dark mode.
