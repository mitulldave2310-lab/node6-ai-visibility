// node6 Labs AI visibility audit: pure scoring.
// Takes the raw HTTP results for one site and returns a scored audit. No network, no I/O.
// Ported from Week 4 n8n/audit.js (itself a lighter port of geo_audit.py). Keep the
// 13 checks and their points in sync with the n8n Code node until n8n calls this API instead.

export type FetchResult =
  | { status: number; body: string; finalUrl?: string }
  | { error: string }
  | null;

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  id: string;
  name: string;
  points: number;
  earned: number;
  status: CheckStatus;
  detail: string;
  fix: string;
}

export interface AuditInput {
  url: string;
  home: FetchResult;
  bot: FetchResult;
  robots: FetchResult;
  llms: FetchResult;
  sitemap: FetchResult;
}

export interface AuditResult {
  url: string;
  site_up: boolean;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  checks: Check[];
  top_gaps: { id: string; name: string; fix: string; detail: string }[];
  signals: {
    title: string;
    description: string;
    h1: string;
    schema_types: string[];
    words: number;
    text_sample: string;
  };
}

export const SEARCH_BOTS = ["OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "Googlebot", "Bingbot"];

function asText(res: FetchResult): string {
  if (!res || "error" in res) return "";
  return res.body ?? "";
}

function statusOf(res: FetchResult): number {
  if (!res || "error" in res) return 0;
  return res.status || 0;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(re: RegExp, s: string): string {
  const m = re.exec(s);
  return m ? stripTags(m[1]).slice(0, 300) : "";
}

function schemaTypes(html: string): { blocks: number; types: string[] } {
  const types = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let blocks = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      const t = (node as Record<string, unknown>)["@type"];
      if (typeof t === "string") types.add(t);
      if (Array.isArray(t)) t.forEach((x) => types.add(String(x)));
      Object.values(node).forEach(walk);
    }
  };
  while ((m = re.exec(html))) {
    blocks += 1;
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // Broken JSON-LD still counts as an attempt but adds no types.
    }
  }
  return { blocks, types: [...types] };
}

/** robots.txt: is "/" disallowed for this bot? Groups are user-agent blocks. */
export function robotsBlocks(robots: string, bot: string): boolean {
  if (!robots) return false;
  const lines = robots
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
  const groups: { agents: string[]; rules: { key: string; val: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === "disallow" || key === "allow")) cur.rules.push({ key, val });
    }
  }
  const b = bot.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && b.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!group) return false;
  const allowRoot = group.rules.some((r) => r.key === "allow" && r.val === "/");
  const disallowRoot = group.rules.some((r) => r.key === "disallow" && r.val === "/");
  return disallowRoot && !allowRoot;
}

export function analyze({ url, home, bot, robots, llms, sitemap }: AuditInput): AuditResult {
  const checks: Check[] = [];
  const add = (id: string, name: string, points: number, earned: number, detail: string, fix: string) =>
    checks.push({
      id,
      name,
      points,
      earned,
      status: earned >= points ? "pass" : earned > 0 ? "warn" : "fail",
      detail,
      fix: earned >= points ? "" : fix,
    });

  const homeStatus = statusOf(home);
  const html = asText(home);
  const looksHtml = /<html|<body|<head|<title/i.test(html);
  const siteUp = homeStatus >= 200 && homeStatus < 400 && looksHtml;

  add("site_loads", "Homepage loads", 15, siteUp ? 15 : 0,
    siteUp ? `HTTP ${homeStatus}` : `Homepage did not load (HTTP ${homeStatus || "no response"})`,
    "The homepage did not load for an automated visitor. AI assistants can't cite a site they can't open.");

  add("https", "Served over HTTPS", 5, siteUp && /^https:/i.test(url) ? 5 : 0,
    /^https:/i.test(url) ? "HTTPS" : "No HTTPS", "Serve the site over HTTPS.");

  const botStatus = statusOf(bot);
  const botOk = botStatus >= 200 && botStatus < 400;
  add("ai_bot_fetch", "Answers a request identifying as ChatGPT's crawler", 10, siteUp && botOk ? 10 : 0,
    `GPTBot request returned HTTP ${botStatus || "no response"}`,
    "A request identifying as ChatGPT's crawler was refused. Check the firewall or bot-protection settings.");

  const robotsText = statusOf(robots) === 200 ? asText(robots) : "";
  const blocked = SEARCH_BOTS.filter((b) => robotsBlocks(robotsText, b));
  add("robots_ai", "robots.txt lets AI search bots in", 10,
    !siteUp ? 0 : blocked.length === 0 ? 10 : blocked.length < 3 ? 5 : 0,
    blocked.length ? `Blocks: ${blocked.join(", ")}` : robotsText ? "No AI search bot blocked" : "No robots.txt (nothing blocked)",
    `robots.txt blocks ${blocked.join(", ")}. Remove those Disallow rules so AI search can read the site.`);

  const title = firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  add("title", "Page title", 5, title.length >= 10 ? 5 : title ? 2 : 0, title || "Missing",
    "Write a page title that says what the business does and where.");

  const desc =
    (/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ||
      /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html) ||
      [])[1] || "";
  add("meta_description", "Meta description", 5, desc.length >= 50 ? 5 : desc ? 2 : 0,
    desc ? desc.slice(0, 160) : "Missing",
    "Add a meta description: one plain sentence on what you do, for whom, and where.");

  const h1s = html.match(/<h1[\s>]/gi) || [];
  const h1 = firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
  add("h1", "One clear H1 heading", 5, h1s.length === 1 ? 5 : h1s.length > 1 ? 2 : 0,
    h1s.length ? `${h1s.length} H1 found: ${h1}` : "No H1",
    "Use exactly one H1 that names the main service.");

  const schema = schemaTypes(html);
  add("schema", "Structured data (JSON-LD)", 10, schema.blocks ? 10 : 0,
    schema.blocks ? `Types: ${schema.types.join(", ") || "unreadable"}` : "None",
    "Add JSON-LD structured data so AI engines can read the business facts.");

  const entity = schema.types.some((t) =>
    /Organization|LocalBusiness|Corporation|ProfessionalService|Store|MedicalBusiness|EducationalOrganization/i.test(t));
  add("entity_schema", "Organization or LocalBusiness schema", 5, entity ? 5 : 0,
    entity ? "Present" : "Missing",
    "Add Organization or LocalBusiness schema with name, address, phone and sameAs links.");

  const headings = [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((m) => stripTags(m[1]));
  const questions = headings.filter(
    (h) => /\?$/.test(h) || /^(what|how|why|which|who|when|where|can|does|do|is|are|should)\b/i.test(h));
  const faqSchema = schema.types.some((t) => /FAQPage/i.test(t));
  add("faq", "Answers buyer questions (FAQ)", 10, faqSchema || questions.length >= 3 ? 10 : questions.length ? 5 : 0,
    `${questions.length} question headings${faqSchema ? ", FAQPage schema" : ""}`,
    "Add an FAQ section that answers the questions buyers ask ChatGPT, written as real questions.");

  const text = stripTags(html);
  const words = text ? text.split(" ").length : 0;
  add("content_depth", "Enough readable text on the homepage", 10, words >= 300 ? 10 : words >= 120 ? 5 : 0,
    `${words} words`, "The homepage has very little readable text. Say what you sell, to whom, where, and why you.");

  const llmsText = asText(llms);
  const llmsOk = statusOf(llms) === 200 && !/<html/i.test(llmsText) && llmsText.length > 20;
  add("llms_txt", "llms.txt file", 5, llmsOk ? 5 : 0, llmsOk ? "Present" : "Missing",
    "Publish an llms.txt file that summarises the business for AI assistants.");

  const smText = asText(sitemap);
  const smOk = statusOf(sitemap) === 200 && /<urlset|<sitemapindex/i.test(smText);
  add("sitemap", "XML sitemap", 5, smOk ? 5 : 0, smOk ? "Present" : "Missing",
    "Publish /sitemap.xml so crawlers find every page.");

  const score = Math.round(checks.reduce((s, c) => s + c.earned, 0));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  const gaps = checks.filter((c) => c.fix).sort((a, b) => a.earned - a.points - (b.earned - b.points));

  return {
    url,
    site_up: siteUp,
    score,
    grade,
    checks,
    top_gaps: gaps.slice(0, 5).map((g) => ({ id: g.id, name: g.name, fix: g.fix, detail: g.detail })),
    signals: {
      title,
      description: desc.slice(0, 300),
      h1,
      schema_types: schema.types,
      words,
      text_sample: text.slice(0, 1500),
    },
  };
}
