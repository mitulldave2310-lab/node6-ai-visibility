import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
const env = fs.readFileSync(".env.local", "utf8").match(/^ANTHROPIC_API_KEY=(.+)$/m)[1].trim();
const client = new Anthropic({ apiKey: env });
const msg = await client.messages.create({
  model: "claude-sonnet-5-5", max_tokens: 4000, output_config: { effort: "low" },
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
  messages: [{ role: "user", content: "Research this company: " + (process.argv[2] || "Shree Valves, shreevalves.com") + ". Short factual notes, one fact per line, each backed by a source." }],
});
console.log("stop", msg.stop_reason, "usage", JSON.stringify(msg.usage.server_tool_use));
for (const b of msg.content) {
  if (b.type === "text") console.log("TEXT", JSON.stringify(b.text.slice(0, 120)), "citations:", (b.citations || []).length, (b.citations||[]).map(c=>c.type).join(","));
  else if (b.type === "web_search_tool_result") console.log("RESULT", Array.isArray(b.content) ? b.content.length + " results" : JSON.stringify(b.content));
  else console.log(b.type);
}
