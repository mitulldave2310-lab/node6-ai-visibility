// Network side of the audit: normalise the user's input, block private addresses, fetch the
// five URLs the scorer needs. Server only (uses node:dns).
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import type { AuditInput, FetchResult } from "./analyze";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const GPTBOT_UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;
const MAX_BODY_BYTES = 2_000_000;

export class InvalidUrlError extends Error {}

/** "Example.com/about" -> "https://example.com". Throws InvalidUrlError on junk. */
export function normalizeUrl(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > 300) throw new InvalidUrlError("Enter a website address.");
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new InvalidUrlError("That doesn't look like a website address.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new InvalidUrlError("Only http and https sites can be audited.");
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") {
    throw new InvalidUrlError("Enter a public website address.");
  }
  if (u.username || u.password) throw new InvalidUrlError("Remove the login details from the address.");
  return `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}`;
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Rejects hosts that resolve to private or loopback addresses (SSRF guard). */
async function assertPublicHost(hostname: string): Promise<void> {
  const addrs = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new InvalidUrlError("That address points to a private network.");
  }
}

/** GET with manual redirects so every hop passes the public-host check. Never throws. */
export async function safeGet(url: string, ua: string): Promise<FetchResult> {
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.port) return { error: "Unsupported destination" };
      const addresses = await lookup(u.hostname, { all: true, family: 4 });
      if (!addresses.length || addresses.some(a => isPrivateIp(a.address))) return { error: "Unavailable public address" };
      const address = addresses[0].address;
      const response = await new Promise<{status:number; body:string; redirect?:string}>((resolve,reject) => {
        const request = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, {
          agent:false, family:4, signal:AbortSignal.timeout(TIMEOUT_MS),
          lookup: (_host, _options, callback) => callback(null,address,4),
          headers: { "User-Agent":ua, Accept:"text/html,application/xml,text/plain,*/*" }
        }, res => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            resolve({status,body:"",redirect:res.headers.location});
            res.destroy();
            return;
          }
          const parts: Buffer[] = [];
          let bytes = 0;
          res.on("data", (part:Buffer) => {
            bytes += part.length;
            if (bytes > MAX_BODY_BYTES) {
              reject(new Error("Response exceeds the audit limit"));
              res.destroy();
            } else parts.push(part);
          });
          res.on("error",reject);
          res.on("end",()=>resolve({status,body:Buffer.concat(parts).toString("utf8")}));
        });
        request.on("error",reject);
        request.end();
      });
      if (response.redirect) {
        current = new URL(response.redirect,current).toString();
        continue;
      }
      return {status:response.status,body:response.body,finalUrl:current};
    }
    return { error: "Too many redirects" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetches everything analyze() needs for one site, in parallel. */
export async function fetchSite(baseUrl: string): Promise<AuditInput> {
  await assertPublicHost(new URL(baseUrl).hostname);
  const [home, bot, robots, llms, sitemap] = await Promise.all([
    safeGet(`${baseUrl}/`, BROWSER_UA),
    safeGet(`${baseUrl}/`, GPTBOT_UA),
    safeGet(`${baseUrl}/robots.txt`, BROWSER_UA),
    safeGet(`${baseUrl}/llms.txt`, BROWSER_UA),
    safeGet(`${baseUrl}/sitemap.xml`, BROWSER_UA),
  ]);
  return { url: baseUrl, home, bot, robots, llms, sitemap };
}

