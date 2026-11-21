// node6 Lead Desk: every tunable business rule lives here.
// Model IDs are kept in one place (CLAUDE.md rule).

export const MODELS = {
  // Short structured judgment: which service, how good a fit, what is missing.
  decide: "claude-haiku-5-5",
  // Public web research and any text a prospect reads.
  research: "claude-sonnet-5-5",
  write: "claude-sonnet-5-5",
} as const;

export const SERVICES = [
  "web_development",
  "ecommerce",
  "automation",
  "ai_transformation",
  "software_development",
  "digital_transformation",
  "game_development",
] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service | "none", string> = {
  web_development: "Web development",
  ecommerce: "eCommerce",
  automation: "Automation",
  ai_transformation: "AI transformation",
  software_development: "Software development",
  digital_transformation: "Digital transformation",
  game_development: "Game development",
  none: "No clear fit",
};

// Assumption to confirm with node6 Labs. Edit this text, not the prompt.
export const ICP = `node6 Labs is a technology agency. Good-fit accounts:
- Small and mid-size businesses (roughly 10 to 500 people), in India or abroad.
- They sell to customers or other businesses and depend on their website, an online store or repeat manual work.
- Clear signs of need: an outdated, slow or thin website; no way to buy or enquire online; manual processes (orders, quotes, follow-ups, reports); hiring for digital, IT or operations roles; recent expansion, a new location, product launch or funding.
Poor fit: very large enterprises with in-house engineering teams, other agencies or freelancers offering the same services, students, job seekers, and anything with no business behind it.`;

export const SENDERS = {
  outbound: "Mitull", // drafts only, never sent by the app
  reply: "node6 Labs",
};

export const LIMITS = {
  outboundWords: 120,
  replyWords: 180,
  maxSignals: 5,
  maxRoles: 3,
  webSearches: 3,
};

// Phrases that make an email read as AI-written or salesy. Checked on every draft.
export const BANNED_PHRASES = [
  "unlock", "supercharge", "game-changer", "game changer", "revolutionary", "revolutionize",
  "paradigm shift", "harness", "delve", "synergy", "leverage", "cutting-edge", "cutting edge",
  "i hope this email finds you", "i hope this finds you", "just checking in", "touch base",
  "move the needle", "here's the thing", "let that sink in",
];
