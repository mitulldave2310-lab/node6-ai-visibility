import { describe,it,expect } from "vitest";
import { buildReport,sampleInput } from "./report";
describe("Week 6 evidence",()=>{
  it("ranks a verified fix and accounts for every point",()=>{
    const r=buildReport(sampleInput());
    expect(r.checks).toHaveLength(13);
    expect(r.possible).toBe(100);
    expect(r.first).toBe("schema");
  });
  it("excludes refused requests from both sides of the score",()=>{
    const i=sampleInput();
    i.home={status:403,body:"Denied"};
    i.llms=i.sitemap={error:"timeout"};
    const r=buildReport(i);
    expect(r.possible).toBe(0);
    expect(r.first).toBeNull();
  });
  it("keeps a missing discovery file distinct from a timeout",()=>{
    const i=sampleInput();
    i.robots={error:"timeout"};
    const r=buildReport(i);
    expect(r.possible).toBe(90);
    expect(r.checks.find(c=>c.id==="llms_txt")?.known).toBe(true);
  });
});
