# node6 Labs AI Visibility Audit

Public lead magnet: a business owner types their website, gets a live AI visibility score (can ChatGPT, Perplexity and Gemini read and cite them?), reads a Claude-written report, and books a call with node6 Labs. Every audit becomes a lead in the Week 4 n8n pipeline (Airtable + Gmail draft + Slack approval).

Users: business owners (public, no login, often on mobile) and node6 Labs as operator.

## Stack
- Next.js 15 App Router, TypeScript strict, Tailwind v4. Deployed on Vercel (push to `main` deploys).
- Claude API: Haiku for scoring/classification, Sonnet for the written report and emails. Not wired yet.
- n8n Cloud webhook receives each finished audit. Not wired yet.
- Tests: Vitest. No database: Airtable (via n8n) is the store.

## Commands
- `npm run dev`: local server on http://localhost:3000
- `npm test`: Vitest, must pass before every commit
- `npm run typecheck` and `npm run lint`: must be clean
- `npm run build`: run before pushing anything that touches routes or config
- Quick check: `curl "http://localhost:3000/api/audit?url=example.com"`

## Layout
- `src/app/api/audit/route.ts`: GET `?url=` or POST `{url}` returns the scored audit JSON. Keep it thin.
- `src/lib/audit/analyze.ts`: pure scoring, 13 checks, points sum to 100. No I/O. Mirrors Week 4 `n8n/audit.js`.
- `src/lib/audit/fetch-site.ts`: URL normalising, SSRF guard, fetching. All outbound fetches to user-supplied hosts go through `safeGet`.
- `src/lib/claude/`: Claude API calls (planned: report writer, email writer). One file per job.
- `src/lib/n8n/`: webhook client for the Week 4 pipeline (planned).
- `src/components/`: React components for the UI.
- `docs/`: product brief and architecture notes.

## Audit API contract (UI and n8n depend on it)
Response: `{ url, site_up, score (0-100), grade (A-F), checks[{id,name,points,earned,status:"pass"|"warn"|"fail",detail,fix}], top_gaps[{id,name,fix,detail}], signals{title,description,h1,schema_types,words,text_sample}, audited_at, took_ms }`.
Errors: `{ error: string }` with 400 (bad input), 422 (domain not found), 500. Error text is user-facing: plain, short, says what to do.
Adding fields is fine. Renaming or removing fields breaks n8n, so don't.

## Rules
- Scoring changes: edit `analyze.ts`, update `analyze.test.ts`, keep points summing to 100, and note the change in the PR so the n8n Code node can be updated too.
- Never fetch a user-supplied URL with plain `fetch`. Use `safeGet` (blocks private IPs, checks every redirect).
- Secrets live in env vars only (`ANTHROPIC_API_KEY`, `N8N_WEBHOOK_URL`). Never commit `.env*`. Read them server-side only, never in client components.
- Claude model IDs go in one constants file when added, not scattered.
- Mobile first. The demo audience opens this on their phones.
- UI copy: plain sentences, no hype words (unlock, supercharge, game-changer), no em dashes, no emojis.
- Small, focused commits. Don't add dependencies without a reason in the commit message.

## Definition of done for a feature
Tests added or updated and passing, typecheck and lint clean, `npm run build` passes, checked in the browser at 375px width and desktop.
