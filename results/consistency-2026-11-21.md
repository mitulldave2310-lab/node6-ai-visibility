# Lead Desk consistency test

Run 2026-11-21T06:34:42.438Z against http://localhost:3123. 10 companies, 3 runs each.

| Company | Routes | Route agreement | Tiers | Services | Verified signals | Seconds (max) |
|---|---|---|---|---|---|---|
| node6labs.com | disqualify, disqualify, disqualify | 3/3 | X, X, X | none | 9/9 | 15 |
| infosys.com | disqualify, disqualify, disqualify | 3/3 | X, X, X | none | 7/8 | 20 |
| forbesmarshall.com | disqualify, disqualify, disqualify | 3/3 | X, X, X | none | 7/8 | 21 |
| shaktipumps.com | error 422, error 422, error 422 | 1/3 |  |  | 0/0 | 2 |
| bluetokaicoffee.com | draft, draft, draft | 3/3 | B, B, B | digital_transformation, ecommerce | 12/12 | 28 |
| jyoticeramic.com | draft, draft, draft | 3/3 | B, B, B | web_development | 13/13 | 26 |
| uniklinger.com | draft, draft, draft | 3/3 | B, B, B | web_development | 13/13 | 23 |
| thewholetruthfoods.com | draft, draft, draft | 3/3 | B, B, B | ecommerce | 10/12 | 26 |
| bakingo.com | draft, draft, draft | 3/3 | B, B, B | automation | 11/11 | 26 |
| wonderchef.com | draft, manual_review, draft | 2/3 | B, C, B | ecommerce, web_development | 12/12 | 30 |

- Successful runs: 27/30
- Companies with the same route on every run: 8/10
- Quoted signals that verified against their source: 94/98
- Slowest run: 30s

## Notes
- Shakti Pumps failed all 3 runs with "We couldn't find that website". DNS resolved fine minutes later, so this was a temporary lookup failure, not the engine. Re-run: `consistency-2026-11-21-shakti-rerun.md`. Those 3 runs all succeeded but gave three different routes (disqualify, disqualify, ask_for_info; tiers C, X, C). It's a borderline account (a listed manufacturer near the top of the size range in the ICP), and the desk does not settle on one answer for it.
- Wonderchef went draft, manual review, draft (tier B, C, B).
- Combined: 10 companies, 30 successful scored runs. 8 of 10 got the same route on all 3 runs. The 2 that wavered are borderline fits, and the clear fits (both yes and no) were stable.
- Drafts: 17 written, 17 passed the copy check on the first attempt, none needed a rewrite. Every draft came from a tier B route.
- Quotes: 103 of 107 quoted signals verified against their named source. Unverified ones are shown as unverified on the card.
- Latency: slowest successful run 38s, under the 60s limit.
