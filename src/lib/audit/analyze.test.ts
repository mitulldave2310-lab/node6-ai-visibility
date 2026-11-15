import { describe, expect, it } from "vitest";
import { analyze, robotsBlocks } from "./analyze";
import { InvalidUrlError, normalizeUrl } from "./fetch-site";

const goodHtml = `<!doctype html><html><head><title>Acme Plumbing in Pune | 24/7 repairs</title>
<meta name="description" content="Acme fixes leaks and installs water heaters for homes and offices across Pune, same day.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Acme"}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script></head>
<body><h1>Plumbers in Pune</h1><h2>How fast can you come?</h2>${"<p>word </p>".repeat(320)}</body></html>`;

const ok = (body: string) => ({ status: 200, body });

describe("robotsBlocks", () => {
  const robots = "User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nUser-agent: PerplexityBot\nDisallow: /\n";
  it("blocks a bot named in a Disallow: / group", () => expect(robotsBlocks(robots, "PerplexityBot")).toBe(true));
  it("falls back to * group", () => expect(robotsBlocks(robots, "Googlebot")).toBe(false));
  it("empty robots blocks nothing", () => expect(robotsBlocks("", "Bingbot")).toBe(false));
});

describe("analyze", () => {
  it("scores a well-built site 100/A", () => {
    const r = analyze({
      url: "https://acme.example",
      home: ok(goodHtml),
      bot: ok(goodHtml),
      robots: ok("User-agent: *\nAllow: /"),
      llms: ok("# Acme Plumbing\nPlumbers in Pune, 24/7."),
      sitemap: ok("<urlset></urlset>"),
    });
    expect(r.score).toBe(100);
    expect(r.grade).toBe("A");
    expect(r.checks).toHaveLength(13);
    expect(r.top_gaps).toHaveLength(0);
  });

  it("scores a down site low without throwing", () => {
    const r = analyze({ url: "https://nope.example", home: { error: "ENOTFOUND" }, bot: { error: "x" }, robots: null, llms: null, sitemap: null });
    expect(r.site_up).toBe(false);
    expect(r.score).toBeLessThanOrEqual(15);
  });

  it("points always sum to 100", () => {
    const r = analyze({ url: "https://x.example", home: null, bot: null, robots: null, llms: null, sitemap: null });
    expect(r.checks.reduce((s, c) => s + c.points, 0)).toBe(100);
  });
});

describe("normalizeUrl", () => {
  it("adds https and strips the path", () => expect(normalizeUrl(" Example.com/about ")).toBe("https://example.com"));
  it("keeps http when given", () => expect(normalizeUrl("http://example.com")).toBe("http://example.com"));
  it.each(["", "localhost", "ftp://example.com", "notaurl", "http://user:pw@example.com"])("rejects %s", (bad) =>
    expect(() => normalizeUrl(bad)).toThrow(InvalidUrlError));
});
