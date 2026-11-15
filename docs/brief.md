# Product brief (Week 5)

The full brief is a PDF submitted with the Week 5 assignment. This is the short version Claude Code needs.

- **Problem:** node6 Labs wants 10 new clients a month, and every audit and lead reply depends on Kunal doing it by hand.
- **Users:** business owners (public, no login, mostly on phones) who want to know if ChatGPT, Perplexity and Gemini can read their site; node6 Labs as operator.
- **Solution:** type a website, get a live score with fixes, read a Claude-written "why this score" report (Week 6), book a call. The lead posts to the Week 4 n8n webhook, which qualifies (Haiku), stores (Airtable) and drafts Kunal's reply (Sonnet) for approval.
- **Hosting:** Vercel instead of the LMS's Replit: push-to-deploy, preview URLs per branch, no cold start at Demo Day.
- **Claude:** scoring is deterministic code; Claude explains the score but never sets it. Haiku for short structured judgments, Sonnet for text a person reads.
- **Week 6 done when:** a stranger finishes the flow on phone and desktop without help, and the demo runs in 5 minutes.
- **KPIs:** audits completed per week, audit-to-booked-call rate, Kunal's minutes per lead. Baselines are measured from Week 6.

## Week 6 build order
1. Claude report writer in `src/lib/claude/` (system prompt, Sonnet, JSON output, model IDs in one constants file).
2. Book-a-call form and webhook client in `src/lib/n8n/` (`N8N_WEBHOOK_URL`).
3. Polish: validation, error states, rate limit on `/api/audit`, demo-safe sample sites.

## Known limits
- The score measures whether AI can read the site, not whether it actually cites it.
- Homepage plus robots.txt, llms.txt and sitemap only.
- n8n still has its own copy of the 13 checks until it takes the score from this API.
